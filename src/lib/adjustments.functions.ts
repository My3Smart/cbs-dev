import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export type Holder = {
  party_id: string;
  party_type: "USER" | "MERCHANT";
  name: string;
  code: string | null;
  account_number: string | null;
  wallet_number: string | null;
  currency: string | null;
  available_balance: string | null;
};

const holderSql = `
  SELECT p.id AS party_id, p.party_type, p.display_name AS name,
         COALESCE(u.user_code, m.merchant_code) AS code,
         a.account_number, w.wallet_number, w.currency, w.available_balance
    FROM parties p
    LEFT JOIN users u ON u.id = p.user_id
    LEFT JOIN merchants m ON m.id = p.merchant_id
    LEFT JOIN accounts a ON a.party_id = p.id
    LEFT JOIN wallets w ON w.account_id = a.id
   WHERE p.party_type IN ('USER', 'MERCHANT')`;

/** Search users and merchants by name. */
export const searchHolders = createServerFn({ method: "POST" })
  .inputValidator((input: { q: string }) => z.object({ q: z.string().trim().max(100) }).parse(input))
  .handler(async ({ data }) => {
    const x = await import("./mysql.server");
    await x.requireStaff();
    return x.query<Holder>(`${holderSql} AND p.display_name LIKE ? ORDER BY p.display_name LIMIT 50`, [
      `%${data.q}%`,
    ]);
  });

/** Admin debit or credit from the system against a user's/merchant's wallet. */
export const adjustBalance = createServerFn({ method: "POST" })
  .inputValidator((input: { partyId: string; amount: number; direction: "DEBIT" | "CREDIT"; note?: string }) =>
    z
      .object({
        partyId: z.string().uuid(),
        amount: z.coerce.number().positive().max(10_000_000),
        direction: z.enum(["DEBIT", "CREDIT"]),
        note: z.string().trim().max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }) => {
    const x = await import("./mysql.server");
    const staff = await x.requireAdmin();
    return x.tx(async (conn) => {
      const w = await x.ensureWallet(conn, data.partyId);
      const wallet = await x.one<{ available_balance: string; currency: string }>(
        "SELECT available_balance, currency FROM wallets WHERE id = ? FOR UPDATE",
        [w.wallet.id],
        conn,
      );
      const balance = Number(wallet!.available_balance);
      if (data.direction === "DEBIT" && balance < data.amount) {
        throw new Error(`Not enough balance. Available: ${wallet!.currency} ${balance.toFixed(2)}`);
      }
      const org = await x.one<{ organization_id: string | null }>(
        `SELECT COALESCE(u.organization_id, m.organization_id) AS organization_id
           FROM parties p LEFT JOIN users u ON u.id = p.user_id LEFT JOIN merchants m ON m.id = p.merchant_id
          WHERE p.id = ?`,
        [data.partyId],
        conn,
      );
      const system = await x.systemAdjustmentAccountId(conn);
      const isCredit = data.direction === "CREDIT";
      const reference = x.makeReference(isCredit ? "SCR" : "SDR");
      const label = isCredit ? "Credit from system" : "Debit from system";
      const transactionId = await x.postTransaction(conn, {
        reference,
        transactionType: isCredit ? "CREDIT_FROM_SYSTEM" : "DEBIT_FROM_SYSTEM",
        description: data.note ? `${label} — ${data.note}` : label,
        currency: wallet!.currency,
        organizationId: org?.organization_id ?? null,
        idempotencyKey: reference,
        createdBy: staff.id,
        entries: isCredit
          ? [
              { ledger_account_id: system, direction: "DEBIT", amount: data.amount },
              { ledger_account_id: w.ledgerAccountId, direction: "CREDIT", amount: data.amount },
            ]
          : [
              { ledger_account_id: w.ledgerAccountId, direction: "DEBIT", amount: data.amount },
              { ledger_account_id: system, direction: "CREDIT", amount: data.amount },
            ],
      });
      await x.audit(staff.id, isCredit ? "CREDIT_FROM_SYSTEM" : "DEBIT_FROM_SYSTEM", "wallets", w.wallet.id, {
        reference,
        amount: data.amount,
        wallet_number: w.wallet.wallet_number,
      }, conn);
      const after = await x.one<{ available_balance: string }>(
        "SELECT available_balance FROM wallets WHERE id = ?",
        [w.wallet.id],
        conn,
      );
      return { transactionId, reference, label, balance: after!.available_balance, currency: wallet!.currency };
    });
  });
