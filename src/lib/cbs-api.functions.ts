/**
 * CBS API — the single entry point that connects the core banking records to the
 * wallet and to the payment providers.
 *
 * Every function needs a signed-in staff session and reads/writes MySQL:
 *   cbsRegisterUser        register a user + account + wallet + wallet ledger account
 *   cbsGetBalance          read wallet balances
 *   cbsTransfer            wallet -> wallet double-entry transfer
 *   cbsWalletReload        top up a wallet through any payment provider (live or sandbox)
 *   cbsConfirmWalletReload confirm a pending top-up and post it to the ledger
 *   cbsListPaymentProviders / cbsListWalletTopups  read helpers
 *
 * See example.ts for call examples.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const optionalText = z
  .string()
  .trim()
  .max(255)
  .optional()
  .transform((value) => value || null);

const money = z.coerce.number().positive().max(10_000_000);

const m = () => import("./mysql.server");

type WalletInfo = {
  id: string; wallet_number: string; currency: string; status: string;
  available_balance: string; held_balance: string; pending_balance: string;
  display_name: string | null; organization_id: string | null; ledger_account_id: string | null;
};

async function resolveWallet(walletNumber: string, conn?: import("mysql2/promise").PoolConnection) {
  const { one } = await m();
  const w = await one<WalletInfo>(
    `SELECT w.id, w.wallet_number, w.currency, w.status, w.available_balance, w.held_balance, w.pending_balance,
            p.display_name, COALESCE(p.organization_id, u.organization_id, mc.organization_id) AS organization_id,
            la.id AS ledger_account_id
       FROM wallets w
       JOIN accounts a ON a.id = w.account_id
       JOIN parties p ON p.id = a.party_id
       LEFT JOIN users u ON u.id = p.user_id
       LEFT JOIN merchants mc ON mc.id = p.merchant_id
       LEFT JOIN ledger_accounts la ON la.wallet_id = w.id
      WHERE w.wallet_number = ?${conn ? " FOR UPDATE" : ""}`,
    [walletNumber],
    conn,
  );
  if (!w) throw new Error(`Wallet ${walletNumber} not found.`);
  if (!w.ledger_account_id) throw new Error(`Wallet ${walletNumber} has no ledger account.`);
  return w as WalletInfo & { ledger_account_id: string };
}

/* 1. User registration (user + party + account + wallet + ledger) */
const registerUserSchema = z.object({
  organizationCode: z.string().trim().min(2).max(40),
  clusterCode: z.string().trim().max(40).optional().or(z.literal("")).transform((v) => v || null),
  userCode: z.string().trim().min(2).max(40),
  fullName: z.string().trim().min(2).max(160),
  email: z.string().trim().email().optional().or(z.literal("")).transform((v) => v || null),
  mobile: optionalText,
  kycStatus: z.enum(["UNVERIFIED", "PENDING", "VERIFIED"]).default("UNVERIFIED"),
  currency: z.string().trim().length(3).default("MYR").transform((v) => v.toUpperCase()),
});

export type CbsRegisterUserInput = z.input<typeof registerUserSchema>;

export const cbsRegisterUser = createServerFn({ method: "POST" })
  .inputValidator((input: CbsRegisterUserInput) => registerUserSchema.parse(input))
  .handler(async ({ data }) => {
    const x = await m();
    const staff = await x.requireWriter();
    return x.tx(async (conn) => {
      const org = await x.one<{ id: string; currency: string }>("SELECT id, currency FROM organizations WHERE code = ?", [data.organizationCode], conn);
      if (!org) throw new Error(`Organization ${data.organizationCode} not found.`);
      const cluster = data.clusterCode
        ? await x.one<{ id: string }>("SELECT id FROM clusters WHERE organization_id = ? AND code = ?", [org.id, data.clusterCode], conn)
        : null;
      const userId = await x.newId(conn);
      const partyId = await x.newId(conn);
      await conn.query(
        `INSERT INTO users (id, organization_id, cluster_id, user_code, full_name, email, mobile, kyc_status, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
        [userId, org.id, cluster?.id ?? null, data.userCode, data.fullName, data.email, data.mobile, data.kycStatus],
      );
      await conn.query(
        "INSERT INTO parties (id, user_id, organization_id, party_type, display_name, status) VALUES (?, ?, ?, 'USER', ?, 'ACTIVE')",
        [partyId, userId, org.id, data.fullName],
      );
      const w = await x.ensureWallet(conn, partyId);
      await x.audit(staff.id, "CBS_REGISTER_USER", "users", userId, { user_code: data.userCode, wallet_number: w.wallet.wallet_number }, conn);
      return {
        userId, userCode: data.userCode, partyId, accountId: w.accountId, accountNumber: w.accountNumber,
        walletId: w.wallet.id, walletNumber: w.wallet.wallet_number, currency: w.wallet.currency, availableBalance: 0,
      };
    });
  });

/* 2. Balance */
const balanceSchema = z
  .object({
    walletNumber: z.string().trim().max(60).optional(),
    userCode: z.string().trim().max(40).optional(),
  })
  .refine((value) => Boolean(value.walletNumber || value.userCode), {
    message: "Provide walletNumber or userCode.",
  });

export type CbsBalanceInput = z.input<typeof balanceSchema>;

export const cbsGetBalance = createServerFn({ method: "POST" })
  .inputValidator((input: CbsBalanceInput) => balanceSchema.parse(input))
  .handler(async ({ data }) => {
    await (await m()).requireStaff();
    const w = await resolveWallet(data.walletNumber ?? `WAL-${data.userCode}`);
    return {
      walletNumber: w.wallet_number, owner: w.display_name, currency: w.currency, status: w.status,
      availableBalance: Number(w.available_balance), heldBalance: Number(w.held_balance), pendingBalance: Number(w.pending_balance),
    };
  });

/* 3. Transfer */
const transferSchema = z.object({
  fromWalletNumber: z.string().trim().min(2).max(60),
  toWalletNumber: z.string().trim().min(2).max(60),
  amount: money,
  note: optionalText,
  reference: z.string().trim().max(60).optional(),
  idempotencyKey: z.string().trim().max(120).optional(),
});

export type CbsTransferInput = z.input<typeof transferSchema>;

export const cbsTransfer = createServerFn({ method: "POST" })
  .inputValidator((input: CbsTransferInput) => transferSchema.parse(input))
  .handler(async ({ data }) => {
    const x = await m();
    const staff = await x.requireWriter();
    if (data.fromWalletNumber === data.toWalletNumber) throw new Error("Cannot transfer to the same wallet.");
    return x.tx(async (conn) => {
      const from = await resolveWallet(data.fromWalletNumber, conn);
      const to = await resolveWallet(data.toWalletNumber, conn);
      if (from.currency !== to.currency) throw new Error("Wallet currencies do not match.");
      if (Number(from.available_balance) < data.amount) throw new Error("Insufficient available balance.");
      const ref = data.reference ?? x.makeReference("TRF");
      const transactionId = await x.postTransaction(conn, {
        reference: ref, transactionType: "TRANSFER",
        description: data.note ?? `Transfer ${data.fromWalletNumber} → ${data.toWalletNumber}`,
        currency: from.currency, organizationId: from.organization_id ?? to.organization_id,
        idempotencyKey: data.idempotencyKey ?? ref, createdBy: staff.id,
        entries: [
          { ledger_account_id: from.ledger_account_id, direction: "DEBIT", amount: data.amount },
          { ledger_account_id: to.ledger_account_id, direction: "CREDIT", amount: data.amount },
        ],
      });
      await conn.query(
        `INSERT INTO transfers (transaction_id, from_wallet_id, to_wallet_id, amount, currency, status, reference, note, created_by)
         VALUES (?, ?, ?, ?, ?, 'POSTED', ?, ?, ?)`,
        [transactionId, from.id, to.id, data.amount, from.currency, ref, data.note, staff.id],
      );
      return { transactionId, reference: ref, amount: data.amount, currency: from.currency };
    });
  });

/* 4. Wallet reload through a payment provider */
const reloadSchema = z.object({
  walletNumber: z.string().trim().min(2).max(60),
  amount: money,
  providerCode: z.string().trim().max(40).optional(),
  methodCode: z.string().trim().max(40).optional(),
  reference: z.string().trim().max(60).optional(),
  description: z.string().trim().max(255).optional(),
});

export type CbsWalletReloadInput = z.input<typeof reloadSchema>;

export const cbsWalletReload = createServerFn({ method: "POST" })
  .inputValidator((input: CbsWalletReloadInput) => reloadSchema.parse(input))
  .handler(async ({ data }) => {
    const x = await m();
    const staff = await x.requireWriter();
    const { createProviderCharge } = await import("./payment-gateway.server");
    const provider = data.providerCode
      ? await x.one<any>("SELECT * FROM payment_providers WHERE enabled = 1 AND status = 'ACTIVE' AND code = ? LIMIT 1", [data.providerCode.toUpperCase()])
      : await x.one<any>("SELECT * FROM payment_providers WHERE enabled = 1 AND status = 'ACTIVE' ORDER BY priority ASC LIMIT 1");
    if (!provider) throw new Error("No enabled payment provider is available.");
    const wallet = await resolveWallet(data.walletNumber);
    const ref = data.reference ?? x.makeReference("RLD");
    const charge = await createProviderCharge(provider as never, {
      reference: ref, amount: data.amount, currency: wallet.currency, methodCode: data.methodCode ?? null,
      description: data.description ?? `Wallet reload ${wallet.wallet_number}`, metadata: { wallet_number: wallet.wallet_number },
    });
    const intentId = await x.newId();
    await x.query(
      `INSERT INTO payment_intents (id, provider_id, method_code, wallet_id, amount, currency, status, environment,
         provider_reference, checkout_url, reference, metadata, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [intentId, provider.id, data.methodCode ?? null, wallet.id, data.amount, wallet.currency, charge.status, provider.environment,
       charge.providerReference, charge.checkoutUrl, ref, JSON.stringify({ simulated: charge.simulated, provider_response: charge.raw }), staff.id],
    );
    let transactionId: string | null = null;
    if (charge.status === "SUCCEEDED") {
      transactionId = await x.tx(async (conn) => {
        const id = await x.postTransaction(conn, {
          reference: ref, transactionType: "WALLET_RELOAD", description: data.description ?? `Wallet reload via ${provider.code}`,
          currency: wallet.currency, organizationId: wallet.organization_id, idempotencyKey: ref, createdBy: staff.id,
          entries: [
            { ledger_account_id: await x.ledgerAccountByCode("1001", conn), direction: "DEBIT", amount: data.amount },
            { ledger_account_id: wallet.ledger_account_id, direction: "CREDIT", amount: data.amount },
          ],
        });
        await conn.query("UPDATE payment_intents SET transaction_id = ? WHERE id = ?", [id, intentId]);
        return id;
      });
    }
    return {
      intentId, reference: ref, status: charge.status,
      provider: { code: provider.code as string, name: provider.name as string, environment: provider.environment as string },
      checkoutUrl: charge.checkoutUrl, simulated: charge.simulated, transactionId, amount: data.amount, currency: wallet.currency,
    };
  });

/** Confirm a pending top-up with the provider and post it to the ledger. */
export const cbsConfirmWalletReload = createServerFn({ method: "POST" })
  .inputValidator((input: { reference: string }) => z.object({ reference: z.string().trim().min(2).max(60) }).parse(input))
  .handler(async ({ data }) => {
    const x = await m();
    const staff = await x.requireWriter();
    const { fetchProviderCharge } = await import("./payment-gateway.server");
    const intent = await x.one<any>("SELECT * FROM payment_intents WHERE reference = ?", [data.reference]);
    if (!intent) throw new Error(`Top-up ${data.reference} not found.`);
    if (intent.status === "SUCCEEDED" && intent.transaction_id) {
      return { reference: data.reference, status: "SUCCEEDED" as const, transactionId: intent.transaction_id as string };
    }
    const provider = await x.one<any>("SELECT * FROM payment_providers WHERE id = ?", [intent.provider_id]);
    if (!provider) throw new Error("Provider not found.");
    const result = await fetchProviderCharge(provider as never, intent.provider_reference ?? data.reference);
    if (result.status !== "SUCCEEDED") {
      await x.query("UPDATE payment_intents SET status = ? WHERE id = ?", [result.status, intent.id]);
      return { reference: data.reference, status: result.status, transactionId: null };
    }
    const wn = await x.one<{ wallet_number: string }>("SELECT wallet_number FROM wallets WHERE id = ?", [intent.wallet_id]);
    const wallet = await resolveWallet(wn?.wallet_number ?? "");
    const transactionId = await x.tx(async (conn) => {
      const id = await x.postTransaction(conn, {
        reference: data.reference, transactionType: "WALLET_RELOAD", description: `Wallet reload via ${provider.code}`,
        currency: wallet.currency, organizationId: wallet.organization_id, idempotencyKey: data.reference, createdBy: staff.id,
        entries: [
          { ledger_account_id: await x.ledgerAccountByCode("1001", conn), direction: "DEBIT", amount: Number(intent.amount) },
          { ledger_account_id: wallet.ledger_account_id, direction: "CREDIT", amount: Number(intent.amount) },
        ],
      });
      await conn.query("UPDATE payment_intents SET status = 'SUCCEEDED', transaction_id = ? WHERE id = ?", [id, intent.id]);
      return id;
    });
    return { reference: data.reference, status: "SUCCEEDED" as const, transactionId };
  });

/* 5. Read helpers */
export const cbsListPaymentProviders = createServerFn({ method: "POST" }).handler(async () => {
  const x = await m();
  await x.requireStaff();
  return (await x.query(
    "SELECT id, code, name, environment, enabled, status, priority, api_base_url, sandbox_base_url FROM payment_providers ORDER BY priority ASC",
  )) as any[];
});

export const cbsListWalletTopups = createServerFn({ method: "POST" })
  .inputValidator((input: { walletNumber?: string } | undefined) =>
    z.object({ walletNumber: z.string().trim().max(60).optional() }).parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const x = await m();
    await x.requireStaff();
    const cols = "pi.id, pi.reference, pi.amount, pi.currency, pi.status, pi.environment, pi.method_code, pi.created_at, pi.provider_id";
    if (data.walletNumber) {
      return (await x.query(
        `SELECT ${cols} FROM payment_intents pi JOIN wallets w ON w.id = pi.wallet_id WHERE w.wallet_number = ? ORDER BY pi.created_at DESC LIMIT 100`,
        [data.walletNumber],
      )) as any[];
    }
    return (await x.query(`SELECT ${cols} FROM payment_intents pi ORDER BY pi.created_at DESC LIMIT 100`)) as any[];
  });
