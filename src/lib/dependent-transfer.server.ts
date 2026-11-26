import { z } from "zod";
import type { PoolConnection } from "mysql2/promise";
import { tx, one, ensureWallet, postTransaction, makeReference } from "./mysql.server";
import { CARDS_DDL } from "./cards.functions";

export const transferBody = z.object({
  amount: z.number().positive().max(100000),
  currency: z.string().trim().length(3).default("MYR"),
  note: z.string().trim().max(255).optional(),
  idempotencyKey: z.string().trim().min(6).max(120),
});

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function partyIdForUser(conn: PoolConnection, userId: string) {
  const p = await one<{ id: string; display_name: string }>(
    "SELECT id, display_name FROM parties WHERE user_id = ? AND party_type = 'USER' LIMIT 1",
    [userId],
    conn,
  );
  if (!p) throw new ApiError(404, "PARTY_NOT_FOUND", "Account holder not found.");
  return p;
}

/** Moves money from a guardian's wallet to one of their dependents (double-entry). */
export async function transferGuardianToChild(args: {
  guardianUserId: string;
  childUserId: string;
  amount: number;
  currency: string;
  note?: string | undefined;
  idempotencyKey: string;
  channel: "DEPENDENT" | "CARD";
}) {
  return tx(async (conn) => {
    const link = await one<{ relationship: string }>(
      "SELECT relationship FROM user_dependents WHERE guardian_id = ? AND child_id = ?",
      [args.guardianUserId, args.childUserId],
      conn,
    );
    if (!link) throw new ApiError(403, "NOT_GUARDIAN", "You are not the guardian of this dependent.");

    const child = await one<{ full_name: string; status: string }>(
      "SELECT full_name, status FROM users WHERE id = ?",
      [args.childUserId],
      conn,
    );
    if (!child) throw new ApiError(404, "CHILD_NOT_FOUND", "Dependent not found.");
    if (child.status !== "ACTIVE") throw new ApiError(403, "CHILD_INACTIVE", "Dependent account is not active.");

    const fromParty = await partyIdForUser(conn, args.guardianUserId);
    const toParty = await partyIdForUser(conn, args.childUserId);
    const from = await ensureWallet(conn, fromParty.id);
    const to = await ensureWallet(conn, toParty.id);

    // Lock both wallets in a stable order to avoid deadlocks.
    const ids = [from.wallet.id, to.wallet.id].sort();
    await conn.query("SELECT id FROM wallets WHERE id IN (?, ?) ORDER BY id FOR UPDATE", ids);
    const fw = await one<{ available_balance: string; currency: string; status: string }>(
      "SELECT available_balance, currency, status FROM wallets WHERE id = ?",
      [from.wallet.id],
      conn,
    );
    const tw = await one<{ currency: string; status: string }>(
      "SELECT currency, status FROM wallets WHERE id = ?",
      [to.wallet.id],
      conn,
    );
    if (fw!.status !== "ACTIVE" || tw!.status !== "ACTIVE")
      throw new ApiError(403, "WALLET_INACTIVE", "One of the wallets is not active.");
    if (fw!.currency !== args.currency.toUpperCase() || tw!.currency !== fw!.currency)
      throw new ApiError(400, "CURRENCY_MISMATCH", `Wallet currency is ${fw!.currency}.`);

    // Idempotent replay: return the earlier transfer if the key was used already.
    const existing = await one<{ reference: string }>(
      "SELECT reference FROM transactions WHERE idempotency_key = ?",
      [args.idempotencyKey],
      conn,
    );
    if (!existing && Number(fw!.available_balance) < args.amount)
      throw new ApiError(422, "AVAILABLE_BALANCE_EXCEEDED", `Insufficient balance. Available: ${fw!.currency} ${Number(fw!.available_balance).toFixed(2)}`);

    const reference = existing?.reference ?? makeReference("TRF");
    const description = args.note || `Transfer to dependent ${child.full_name}`;
    const transactionId = await postTransaction(conn, {
      reference,
      transactionType: args.channel === "CARD" ? "CARD_TRANSFER" : "DEPENDENT_TRANSFER",
      description,
      currency: fw!.currency,
      organizationId: null,
      idempotencyKey: args.idempotencyKey,
      entries: [
        { ledger_account_id: from.ledgerAccountId, direction: "DEBIT", amount: args.amount },
        { ledger_account_id: to.ledgerAccountId, direction: "CREDIT", amount: args.amount },
      ],
    });
    if (!existing) {
      await conn.query(
        `INSERT INTO transfers (transaction_id, from_wallet_id, to_wallet_id, amount, currency, status, reference, note)
         VALUES (?, ?, ?, ?, ?, 'POSTED', ?, ?)`,
        [transactionId, from.wallet.id, to.wallet.id, args.amount, fw!.currency, reference, args.note ?? null],
      );
      await conn.query(
        "INSERT INTO audit_logs (action, entity_type, entity_id, metadata) VALUES (?, 'transfers', ?, ?)",
        [args.channel === "CARD" ? "CARD_TRANSFER" : "DEPENDENT_TRANSFER", transactionId,
          JSON.stringify({ reference, amount: args.amount, guardian: args.guardianUserId, child: args.childUserId })],
      ).catch(() => undefined);
    }
    const bal = async (id: string) =>
      Number((await one<{ b: string }>("SELECT available_balance AS b FROM wallets WHERE id = ?", [id], conn))!.b);
    const card = await one<{ card_uid: string; card_type: string; status: string }>(
      "SELECT card_uid, card_type, status FROM dependent_cards WHERE user_id = ?",
      [args.childUserId],
      conn,
    ).catch(() => null);

    return {
      reference,
      status: "SETTLED",
      replayed: !!existing,
      amount: args.amount,
      currency: fw!.currency,
      from: { walletNumber: from.wallet.wallet_number, ownerName: fromParty.display_name, newBalance: await bal(from.wallet.id) },
      to: {
        childId: args.childUserId,
        childName: child.full_name,
        walletNumber: to.wallet.wallet_number,
        cardUid: card?.card_uid ?? null,
        newBalance: await bal(to.wallet.id),
      },
      card,
      note: args.note ?? null,
      timestamp: new Date().toISOString(),
    };
  });
}

/** Finds the dependent a tagged card belongs to. */
export async function childForCard(cardUid: string) {
  await tx(async (c) => { await c.query(CARDS_DDL); });
  const row = await one<{ user_id: string; status: string }>(
    "SELECT user_id, status FROM dependent_cards WHERE card_uid = ?",
    [cardUid.trim().toUpperCase()],
  );
  if (!row) throw new ApiError(404, "CARD_NOT_FOUND", "Card UID not registered in CBS.");
  if (row.status !== "ACTIVE") throw new ApiError(403, "CARD_BLOCKED", `Card is ${row.status}.`);
  return row.user_id;
}

export function errorResponse(e: unknown) {
  const err = e as { status?: number; statusCode?: number; code?: string; message?: string; issues?: unknown };
  if (err?.issues) return Response.json({ success: false, code: "INVALID_REQUEST", message: "Invalid request body.", issues: err.issues }, { status: 400 });
  return Response.json(
    { success: false, code: err?.code ?? "ERROR", message: err?.message ?? "Transfer failed." },
    { status: err?.status ?? err?.statusCode ?? 500 },
  );
}
