import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const kindSchema = z.enum(["organization", "cluster", "user", "merchant"]);
export type ProfileKind = z.infer<typeof kindSchema>;

const DEPENDENTS_DDL = `CREATE TABLE IF NOT EXISTS user_dependents (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  guardian_id CHAR(36) NOT NULL,
  child_id CHAR(36) NOT NULL,
  relationship VARCHAR(40) NOT NULL DEFAULT 'CHILD',
  date_of_birth DATE NULL,
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY user_dependents_child_key (child_id),
  KEY user_dependents_guardian_idx (guardian_id),
  CONSTRAINT user_dependents_guardian_fk FOREIGN KEY (guardian_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT user_dependents_child_fk FOREIGN KEY (child_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB`;

export type ProfileAccount = {
  account_number: string;
  account_type: string;
  wallet_number: string | null;
  currency: string | null;
  available_balance: string | number | null;
  pending_balance: string | number | null;
  held_balance: string | number | null;
};

export type ProfileDependent = {
  id: string;
  user_code: string;
  full_name: string;
  relationship: string;
  date_of_birth: string | null;
  status: string;
  wallet_number: string | null;
  available_balance: string | number | null;
};

export type Profile = {
  record: Record<string, string | number | boolean | null>;
  accounts: ProfileAccount[];
  stats: { label: string; value: number }[];
  dependents: ProfileDependent[];
  guardian: { id: string; user_code: string; full_name: string; relationship: string } | null;
};

export const getProfile = createServerFn({ method: "POST" })
  .inputValidator((input: { kind: ProfileKind; id: string }) =>
    z.object({ kind: kindSchema, id: z.string().min(1).max(64) }).parse(input),
  )
  .handler(async ({ data }) => {
    const m = await import("./mysql.server");
    await m.requireStaff();
    const { kind, id } = data;

    const sql: Record<ProfileKind, string> = {
      organization: "SELECT * FROM organizations WHERE id = ?",
      cluster: `SELECT c.*, o.name AS organization_name FROM clusters c
                LEFT JOIN organizations o ON o.id = c.organization_id WHERE c.id = ?`,
      user: `SELECT u.*, o.name AS organization_name, c.name AS cluster_name FROM users u
             LEFT JOIN organizations o ON o.id = u.organization_id
             LEFT JOIN clusters c ON c.id = u.cluster_id WHERE u.id = ?`,
      merchant: `SELECT mm.*, o.name AS organization_name, c.name AS cluster_name FROM merchants mm
                 LEFT JOIN organizations o ON o.id = mm.organization_id
                 LEFT JOIN clusters c ON c.id = mm.cluster_id WHERE mm.id = ?`,
    };
    const record = await m.one(sql[kind], [id]);
    if (!record) throw new Error("Record not found.");

    const partyCol = { organization: "organization_id", user: "user_id", merchant: "merchant_id" } as const;
    let accounts: ProfileAccount[] = [];
    if (kind !== "cluster") {
      const extra = kind === "organization" ? " AND p.party_type = 'ORGANIZATION'" : "";
      accounts = await m.query<ProfileAccount>(
        `SELECT a.account_number, a.account_type, w.wallet_number, w.currency,
                w.available_balance, w.pending_balance, w.held_balance
           FROM parties p
           JOIN accounts a ON a.party_id = p.id
           LEFT JOIN wallets w ON w.account_id = a.id
          WHERE p.${partyCol[kind]} = ?${extra}
          ORDER BY a.created_at`,
        [id],
      );
    }

    const stats: Profile["stats"] = [];
    const count = async (label: string, q: string) => {
      const r = await m.one<{ n: number }>(q, [id]);
      stats.push({ label, value: Number(r?.n ?? 0) });
    };
    if (kind === "organization") {
      await count("Clusters", "SELECT COUNT(*) AS n FROM clusters WHERE organization_id = ?");
      await count("Users", "SELECT COUNT(*) AS n FROM users WHERE organization_id = ?");
      await count("Merchants", "SELECT COUNT(*) AS n FROM merchants WHERE organization_id = ?");
    } else if (kind === "cluster") {
      await count("Users", "SELECT COUNT(*) AS n FROM users WHERE cluster_id = ?");
      await count("Merchants", "SELECT COUNT(*) AS n FROM merchants WHERE cluster_id = ?");
    }

    let dependents: ProfileDependent[] = [];
    let guardian: Profile["guardian"] = null;
    if (kind === "user") {
      await m.query(DEPENDENTS_DDL);
      dependents = await m.query<ProfileDependent>(
        `SELECT u.id, u.user_code, u.full_name, d.relationship, d.date_of_birth, u.status,
                (SELECT w.wallet_number FROM parties p JOIN accounts a ON a.party_id = p.id
                   JOIN wallets w ON w.account_id = a.id WHERE p.user_id = u.id LIMIT 1) AS wallet_number,
                (SELECT w.available_balance FROM parties p JOIN accounts a ON a.party_id = p.id
                   JOIN wallets w ON w.account_id = a.id WHERE p.user_id = u.id LIMIT 1) AS available_balance
           FROM user_dependents d JOIN users u ON u.id = d.child_id
          WHERE d.guardian_id = ? ORDER BY d.created_at`,
        [id],
      );
      guardian = await m.one(
        `SELECT u.id, u.user_code, u.full_name, d.relationship
           FROM user_dependents d JOIN users u ON u.id = d.guardian_id WHERE d.child_id = ?`,
        [id],
      );
    }

    return { record, accounts, stats, dependents, guardian } as unknown as Profile as any as { record: Record<string, string | number | boolean | null>; accounts: ProfileAccount[]; stats: { label: string; value: number }[]; dependents: ProfileDependent[]; guardian: Profile["guardian"] };
  });

const dependentSchema = z.object({
  guardianId: z.string().min(1).max(64),
  userCode: z.string().trim().min(2).max(40),
  fullName: z.string().trim().min(2).max(160),
  relationship: z.enum(["CHILD", "SPOUSE", "PARENT", "SIBLING", "OTHER"]),
  dateOfBirth: z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional()
    .or(z.literal(""))
    .transform((v) => v || null),
  email: z.string().trim().email().optional().or(z.literal("")).transform((v) => v || null),
  mobile: z.string().trim().max(40).optional().transform((v) => v || null),
  kycStatus: z.enum(["UNVERIFIED", "PENDING", "VERIFIED"]),
});

export type DependentInput = z.input<typeof dependentSchema>;

export const addDependent = createServerFn({ method: "POST" })
  .inputValidator((input: DependentInput) => dependentSchema.parse(input))
  .handler(async ({ data }) => {
    const m = await import("./mysql.server");
    const staff = await m.requireAdmin();
    await m.query(DEPENDENTS_DDL);

    return m.tx(async (conn) => {
      const guardian = await m.one<{ id: string; organization_id: string; cluster_id: string | null; status: string }>(
        "SELECT id, organization_id, cluster_id, status FROM users WHERE id = ?",
        [data.guardianId],
        conn,
      );
      if (!guardian) throw new Error("Guardian user not found.");
      const isChild = await m.one("SELECT id FROM user_dependents WHERE child_id = ?", [guardian.id], conn);
      if (isChild) throw new Error("A dependent account cannot have its own dependents.");
      const dup = await m.one("SELECT id FROM users WHERE user_code = ?", [data.userCode], conn);
      if (dup) throw new Error("That user code is already in use.");

      const childId = await m.newId(conn);
      const partyId = await m.newId(conn);
      await conn.query(
        `INSERT INTO users (id, organization_id, cluster_id, user_code, full_name, email, mobile, kyc_status, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')`,
        [childId, guardian.organization_id, guardian.cluster_id, data.userCode, data.fullName, data.email, data.mobile, data.kycStatus],
      );
      await conn.query(
        "INSERT INTO parties (id, user_id, organization_id, party_type, display_name, status) VALUES (?, ?, ?, 'USER', ?, 'ACTIVE')",
        [partyId, childId, guardian.organization_id, data.fullName],
      );
      const wallet = await m.ensureWallet(conn, partyId);
      await conn.query(
        "INSERT INTO user_dependents (guardian_id, child_id, relationship, date_of_birth) VALUES (?, ?, ?, ?)",
        [guardian.id, childId, data.relationship, data.dateOfBirth],
      );
      await m.audit(
        staff.id,
        "REGISTER_DEPENDENT",
        "users",
        childId,
        { guardian_id: guardian.id, label: data.fullName, relationship: data.relationship },
        conn,
      );
      return { id: childId, accountNumber: wallet.accountNumber, walletNumber: wallet.wallet.wallet_number };
    });
  });
