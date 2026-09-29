/**
 * MySQL core for the CBS portal. Every read and write in the app goes through
 * this file — no cloud database is used.
 *
 * Connection settings (environment variables, with XAMPP-friendly defaults):
 *   MYSQL_HOST=127.0.0.1  MYSQL_PORT=3306  MYSQL_USER=root
 *   MYSQL_PASSWORD=       MYSQL_DATABASE=cbs
 *   SESSION_SECRET=<any long random string>
 */
import mysql, { type Pool, type PoolConnection, type RowDataPacket } from "mysql2/promise";
import { createHmac, timingSafeEqual } from "crypto";
import { getCookie } from "@tanstack/react-start/server";

let pool: Pool | null = null;

export function db(): Pool {
  if (!pool) {
    pool = mysql.createPool({
      host: process.env["MYSQL_HOST"] || "127.0.0.1",
      port: Number(process.env["MYSQL_PORT"] || 3306),
      user: process.env["MYSQL_USER"] || "root",
      password: process.env["MYSQL_PASSWORD"] ?? "root",
      database: process.env["MYSQL_DATABASE"] || "cbs",
      timezone: "Z",
      connectionLimit: 10,
      typeCast(field, next) {
        if (field.type === "TINY" && field.length === 1) {
          const v = field.string();
          return v === null ? null : v === "1";
        }
        return next();
      },
    });
  }
  return pool;
}

type Row = Record<string, unknown>;

function normalize(row: Row): Row {
  const out: Row = {};
  for (const [k, v] of Object.entries(row)) out[k] = v instanceof Date ? v.toISOString() : v;
  return out;
}

export async function query<T = Row>(
  sql: string,
  params: unknown[] = [],
  conn?: PoolConnection | Pool,
): Promise<T[]> {
  const [result] = await (conn ?? db()).query(sql, params);

  if (Array.isArray(result)) {
    return (result as Row[]).map(normalize) as T[];
  }

  return [];
}

export async function one<T = Row>(sql: string, params: unknown[] = [], conn?: PoolConnection | Pool) {
  const rows = await query<T>(sql, params, conn);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await db().getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}

export async function newId(conn?: PoolConnection | Pool): Promise<string> {
  const row = await one<{ id: string }>("SELECT UUID() AS id", [], conn);
  return row!.id;
}

/* ---------------- Session (signed cookie) ---------------- */

export const SESSION_COOKIE = "cbs_session";
const secret = () => process.env["SESSION_SECRET"] || "cbs-local-dev-secret-change-me";

export function signSession(userId: string): string {
  const body = Buffer.from(
    JSON.stringify({ uid: userId, exp: Date.now() + 1000 * 60 * 60 * 12 }),
  ).toString("base64url");
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verifySession(token: string | undefined): string | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(body, "base64url").toString()) as { uid: string; exp: number };
    return data.exp > Date.now() ? data.uid : null;
  } catch {
    return null;
  }
}

export type Staff = { id: string; email: string; full_name: string | null; roles: string[] };

export async function currentStaff(): Promise<Staff | null> {
  const uid = verifySession(getCookie(SESSION_COOKIE));
  if (!uid) return null;
  const user = await one<{ id: string; email: string; full_name: string | null }>(
    "SELECT id, email, full_name FROM staff_users WHERE id = ?",
    [uid],
  );
  if (!user) return null;
  const roles = await query<{ role: string }>("SELECT role FROM staff_roles WHERE user_id = ?", [uid]);
  return { ...user, roles: roles.map((r) => r.role) };
}

export async function requireStaff(): Promise<Staff> {
  const staff = await currentStaff();
  if (!staff) throw new Error("Please sign in again.");
  return staff;
}

export async function requireAdmin(): Promise<Staff> {
  const staff = await requireStaff();
  if (!staff.roles.includes("admin")) throw new Error("Only administrators can do this.");
  return staff;
}

export async function requireWriter(): Promise<Staff> {
  const staff = await requireStaff();
  if (!staff.roles.some((r) => r === "admin" || r === "operator")) {
    throw new Error("Your role cannot perform financial operations.");
  }
  return staff;
}

export async function audit(
  actorId: string | null,
  action: string,
  entityType: string | null,
  entityId: string | null,
  metadata: Record<string, unknown>,
  conn?: PoolConnection | Pool,
) {
  await query(
    "INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES (?, ?, ?, ?, ?)",
    [actorId, action, entityType, entityId, JSON.stringify(metadata)],
    conn,
  );
}

/* ---------------- Ledger ---------------- */

export type Entry = { ledger_account_id: string; direction: "DEBIT" | "CREDIT"; amount: number };

/** Calls the post_transaction procedure on the given connection (use inside tx()). */
export async function postTransaction(
  conn: PoolConnection,
  args: {
    reference: string;
    transactionType: string;
    description: string;
    currency: string;
    organizationId: string | null;
    idempotencyKey: string;
    entries: Entry[];
    createdBy?: string | null;
  },
): Promise<string> {
  await conn.query("CALL post_transaction(?, ?, ?, ?, ?, ?, ?, @cbs_txn)", [
    args.reference,
    args.transactionType,
    args.description,
    args.currency,
    args.organizationId,
    args.idempotencyKey,
    JSON.stringify(args.entries),
  ]);
  const row = await one<{ id: string }>("SELECT @cbs_txn AS id", [], conn);
  if (!row?.id) throw new Error("Ledger posting failed.");
  if (args.createdBy) {
    await conn.query("UPDATE transactions SET created_by = ? WHERE id = ? AND created_by IS NULL", [
      args.createdBy,
      row.id,
    ]);
  }
  return row.id;
}

export function makeReference(prefix: string) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export async function ledgerAccountByCode(code: string, conn?: PoolConnection | Pool) {
  const row = await one<{ id: string }>("SELECT id FROM ledger_accounts WHERE code = ?", [code], conn);
  if (!row) throw new Error(`Ledger account ${code} is missing.`);
  return row.id;
}

/** System adjustment account used for admin debit/credit (created if missing). */
export async function systemAdjustmentAccountId(conn: PoolConnection) {
  await conn.query(
    `INSERT IGNORE INTO ledger_accounts (code, name, account_class, normal_balance, wallet_id, currency, status)
     VALUES ('3001', 'System Adjustment', 'EQUITY', 'CREDIT', NULL, 'MYR', 'ACTIVE')`,
  );
  return ledgerAccountByCode("3001", conn);
}

/**
 * Make sure a party (user or merchant) has an account, wallet and wallet ledger
 * account. Creates any missing piece and returns the wallet details.
 */
export async function ensureWallet(conn: PoolConnection, partyId: string) {
  const party = await one<{
    id: string;
    display_name: string;
    party_type: string;
    code: string | null;
    currency: string | null;
  }>(
    `SELECT p.id, p.display_name, p.party_type,
            COALESCE(u.user_code, m.merchant_code, o.code) AS code,
            COALESCE(ou.currency, om.currency, o.currency) AS currency
       FROM parties p
       LEFT JOIN users u ON u.id = p.user_id
       LEFT JOIN organizations ou ON ou.id = u.organization_id
       LEFT JOIN merchants m ON m.id = p.merchant_id
       LEFT JOIN organizations om ON om.id = m.organization_id
       LEFT JOIN organizations o ON o.id = p.organization_id
      WHERE p.id = ?`,
    [partyId],
    conn,
  );
  if (!party) throw new Error("Account holder not found.");
  const code = party.code ?? partyId.slice(0, 8).toUpperCase();
  const currency = party.currency ?? "MYR";

  let account = await one<{ id: string; account_number: string }>(
    "SELECT id, account_number FROM accounts WHERE party_id = ? ORDER BY created_at LIMIT 1",
    [partyId],
    conn,
  );
  if (!account) {
    const id = await newId(conn);
    await conn.query(
      "INSERT INTO accounts (id, party_id, account_number, account_type, currency, status) VALUES (?, ?, ?, 'WALLET', ?, 'ACTIVE')",
      [id, partyId, `ACC-${code}`, currency],
    );
    account = { id, account_number: `ACC-${code}` };
  }

  let wallet = await one<{ id: string; wallet_number: string; currency: string }>(
    "SELECT id, wallet_number, currency FROM wallets WHERE account_id = ? ORDER BY created_at LIMIT 1",
    [account.id],
    conn,
  );
  if (!wallet) {
    const id = await newId(conn);
    await conn.query(
      "INSERT INTO wallets (id, account_id, wallet_number, currency, status) VALUES (?, ?, ?, ?, 'ACTIVE')",
      [id, account.id, `WAL-${code}`, currency],
    );
    wallet = { id, wallet_number: `WAL-${code}`, currency };
  }

  let ledger = await one<{ id: string }>("SELECT id FROM ledger_accounts WHERE wallet_id = ?", [wallet.id], conn);
  if (!ledger) {
    const id = await newId(conn);
    const prefix = party.party_type === "MERCHANT" ? "2002" : "2001";
    await conn.query(
      `INSERT INTO ledger_accounts (id, code, name, account_class, normal_balance, wallet_id, currency, status)
       VALUES (?, ?, ?, 'LIABILITY', 'CREDIT', ?, ?, 'ACTIVE')`,
      [id, `${prefix}-${code}`, `Wallet liability — ${party.display_name}`, wallet.id, currency],
    );
    ledger = { id };
  }

  return { accountId: account.id, accountNumber: account.account_number, wallet, ledgerAccountId: ledger.id };
}

/* ---------------- Generic list reader (Supabase-style select) ---------------- */

type Relation = { table: string; kind: "one" | "many"; local: string; foreign: string };

const RELATIONS: Record<string, Record<string, Relation>> = {
  users: {
    clusters: { table: "clusters", kind: "one", local: "cluster_id", foreign: "id" },
    organizations: { table: "organizations", kind: "one", local: "organization_id", foreign: "id" },
    parties: { table: "parties", kind: "many", local: "id", foreign: "user_id" },
  },
  merchants: {
    clusters: { table: "clusters", kind: "one", local: "cluster_id", foreign: "id" },
    organizations: { table: "organizations", kind: "one", local: "organization_id", foreign: "id" },
    parties: { table: "parties", kind: "many", local: "id", foreign: "merchant_id" },
  },
  clusters: { organizations: { table: "organizations", kind: "one", local: "organization_id", foreign: "id" } },
  parties: { accounts: { table: "accounts", kind: "many", local: "id", foreign: "party_id" } },
  accounts: {
    wallets: { table: "wallets", kind: "many", local: "id", foreign: "account_id" },
    parties: { table: "parties", kind: "one", local: "party_id", foreign: "id" },
  },
  wallets: { accounts: { table: "accounts", kind: "one", local: "account_id", foreign: "id" } },
  transactions: { organizations: { table: "organizations", kind: "one", local: "organization_id", foreign: "id" } },
  transfers: {
    from_wallet_id: { table: "wallets", kind: "one", local: "from_wallet_id", foreign: "id" },
    to_wallet_id: { table: "wallets", kind: "one", local: "to_wallet_id", foreign: "id" },
  },
  ledger_entries: {
    ledger_accounts: { table: "ledger_accounts", kind: "one", local: "ledger_account_id", foreign: "id" },
    transactions: { table: "transactions", kind: "one", local: "transaction_id", foreign: "id" },
  },
  payment_methods: {
    payment_providers: { table: "payment_providers", kind: "one", local: "provider_id", foreign: "id" },
  },
  payment_intents: {
    payment_providers: { table: "payment_providers", kind: "one", local: "provider_id", foreign: "id" },
    wallets: { table: "wallets", kind: "one", local: "wallet_id", foreign: "id" },
  },
};

export const READABLE_TABLES = [
  "organizations", "clusters", "users", "merchants", "parties", "accounts", "wallets",
  "ledger_accounts", "ledger_entries", "transactions", "transfers", "payment_providers",
  "payment_methods", "payment_intents", "audit_logs",
] as const;

type Node = { alias: string; name: string; fields: string[]; children: Node[] };

function parseSelect(input: string): { fields: string[]; children: Node[] } {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of input) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current.trim());
      current = "";
    } else current += ch;
  }
  if (current.trim()) parts.push(current.trim());

  const fields: string[] = [];
  const children: Node[] = [];
  for (const part of parts) {
    const open = part.indexOf("(");
    if (open === -1) {
      if (part !== "*" && !/^[a-z_][a-z0-9_]*$/.test(part)) throw new Error(`Invalid column ${part}`);
      fields.push(part);
      continue;
    }
    const head = part.slice(0, open).trim();
    const inner = parseSelect(part.slice(open + 1, part.lastIndexOf(")")));
    const [alias, name] = head.includes(":") ? head.split(":").map((s) => s.trim()) : [head, head];
    if (!/^[a-z_][a-z0-9_]*$/.test(alias!) || !/^[a-z_][a-z0-9_]*$/.test(name!)) {
      throw new Error(`Invalid relation ${head}`);
    }
    children.push({ alias: alias!, name: name!, ...inner });
  }
  return { fields, children };
}

function columnsSql(fields: string[], extra: string[]) {
  if (fields.includes("*") || fields.length === 0) return "*";
  return Array.from(new Set([...fields, ...extra])).map((c) => `\`${c}\``).join(", ");
}

async function attach(table: string, rows: Row[], children: Node[]) {
  for (const child of children) {
    const rel = RELATIONS[table]?.[child.name];
    if (!rel) throw new Error(`Unknown relation ${table}.${child.name}`);
    const keys = Array.from(new Set(rows.map((r) => r[rel.local]).filter((v) => v != null)));
    const extra = [rel.foreign, ...child.children.map((c) => RELATIONS[rel.table]?.[c.name]?.local ?? "id")];
    const related = keys.length
      ? await query(
          `SELECT ${columnsSql(child.fields, extra)} FROM \`${rel.table}\` WHERE \`${rel.foreign}\` IN (?)`,
          [keys],
        )
      : [];
    await attach(rel.table, related, child.children);
    for (const row of rows) {
      const matches = related.filter((r) => r[rel.foreign] === row[rel.local]);
      row[child.alias] = rel.kind === "one" ? (matches[0] ?? null) : matches;
    }
  }
}

export async function listTable(args: {
  table: string;
  select: string;
  orderBy: string;
  ascending: boolean;
  limit: number;
}) {
  if (!(READABLE_TABLES as readonly string[]).includes(args.table)) throw new Error("Unknown table.");
  if (!/^[a-z_][a-z0-9_]*$/.test(args.orderBy)) throw new Error("Invalid sort column.");
  const { fields, children } = parseSelect(args.select);
  const extra = [args.orderBy, ...children.map((c) => RELATIONS[args.table]?.[c.name]?.local ?? "id")];
  const rows = await query(
    `SELECT ${columnsSql(fields, extra)} FROM \`${args.table}\` ORDER BY \`${args.orderBy}\` ${args.ascending ? "ASC" : "DESC"} LIMIT ?`,
    [Math.min(Math.max(args.limit, 1), 1000)],
  );
  await attach(args.table, rows, children);
  return rows;
}
