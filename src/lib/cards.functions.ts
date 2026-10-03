import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

export const CARDS_DDL = `CREATE TABLE IF NOT EXISTS dependent_cards (
  id CHAR(36) NOT NULL DEFAULT (UUID()),
  user_id CHAR(36) NOT NULL,
  card_uid VARCHAR(64) NOT NULL,
  card_type VARCHAR(40) NULL,
  card_data TEXT NULL,
  status ENUM('ACTIVE','BLOCKED') NOT NULL DEFAULT 'ACTIVE',
  tagged_by CHAR(36) NULL,
  tagged_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY dependent_cards_user_key (user_id),
  UNIQUE KEY dependent_cards_uid_key (card_uid),
  CONSTRAINT dependent_cards_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB`;

export type DependentCard = {
  id: string;
  card_uid: string;
  card_type: string | null;
  card_data: string | null;
  status: string;
  tagged_at: string;
};

export type DependentRow = {
  id: string;
  user_code: string;
  full_name: string;
  status: string;
  kyc_status: string;
  relationship: string;
  date_of_birth: string | null;
  guardian_id: string;
  guardian_name: string;
  guardian_code: string;
  account_number: string | null;
  wallet_number: string | null;
  available_balance: string | number | null;
  card_uid: string | null;
};

export const listDependents = createServerFn({ method: "GET" }).handler(async () => {
  const m = await import("./mysql.server");
  await m.requireStaff();
  await m.query(CARDS_DDL);
  return m.query<DependentRow>(
    `SELECT u.id, u.user_code, u.full_name, u.status, u.kyc_status, d.relationship, d.date_of_birth,
            g.id AS guardian_id, g.full_name AS guardian_name, g.user_code AS guardian_code,
            (SELECT a.account_number FROM parties p JOIN accounts a ON a.party_id = p.id WHERE p.user_id = u.id LIMIT 1) AS account_number,
            (SELECT w.wallet_number FROM parties p JOIN accounts a ON a.party_id = p.id JOIN wallets w ON w.account_id = a.id WHERE p.user_id = u.id LIMIT 1) AS wallet_number,
            (SELECT w.available_balance FROM parties p JOIN accounts a ON a.party_id = p.id JOIN wallets w ON w.account_id = a.id WHERE p.user_id = u.id LIMIT 1) AS available_balance,
            c.card_uid
       FROM user_dependents d
       JOIN users u ON u.id = d.child_id
       JOIN users g ON g.id = d.guardian_id
       LEFT JOIN dependent_cards c ON c.user_id = u.id
      ORDER BY u.full_name`,
  );
});

export const getDependentCard = createServerFn({ method: "POST" })
  .inputValidator((i: { userId: string }) => z.object({ userId: z.string().min(1).max(64) }).parse(i))
  .handler(async ({ data }) => {
    const m = await import("./mysql.server");
    await m.requireStaff();
    await m.query(CARDS_DDL);
    return m.one<DependentCard>(
      "SELECT id, card_uid, card_type, card_data, status, tagged_at FROM dependent_cards WHERE user_id = ?",
      [data.userId],
    );
  });

export const tagDependentCard = createServerFn({ method: "POST" })
  .inputValidator((i: { userId: string; cardUid: string; cardType?: string; cardData?: string }) =>
    z
      .object({
        userId: z.string().min(1).max(64),
        cardUid: z.string().trim().min(4).max(64).transform((v) => v.toUpperCase()),
        cardType: z.string().trim().max(40).optional(),
        cardData: z.string().max(4000).optional(),
      })
      .parse(i),
  )
  .handler(async ({ data }) => {
    const m = await import("./mysql.server");
    const staff = await m.requireAdmin();
    await m.query(CARDS_DDL);
    const isDependent = await m.one("SELECT id FROM user_dependents WHERE child_id = ?", [data.userId]);
    if (!isDependent) throw new Error("Cards can only be tagged to dependents.");
    const taken = await m.one<{ user_id: string }>("SELECT user_id FROM dependent_cards WHERE card_uid = ?", [data.cardUid]);
    if (taken && taken.user_id !== data.userId) throw new Error("This card is already tagged to another dependent.");
    const existing = await m.one<{ card_uid: string }>("SELECT card_uid FROM dependent_cards WHERE user_id = ?", [data.userId]);
    await m.query(
      `INSERT INTO dependent_cards (user_id, card_uid, card_type, card_data, status, tagged_by)
       VALUES (?, ?, ?, ?, 'ACTIVE', ?)
       ON DUPLICATE KEY UPDATE card_uid = VALUES(card_uid), card_type = VALUES(card_type),
         card_data = VALUES(card_data), status = 'ACTIVE', tagged_by = VALUES(tagged_by), tagged_at = CURRENT_TIMESTAMP`,
      [data.userId, data.cardUid, data.cardType ?? "NFC", data.cardData ?? null, staff.id],
    );
    await m.audit(staff.id, existing ? "CHANGE_DEPENDENT_CARD" : "TAG_DEPENDENT_CARD", "users", data.userId, {
      card_uid: data.cardUid,
      previous_card_uid: existing?.card_uid ?? null,
    });
    return { ok: true };
  });

export const removeDependentCard = createServerFn({ method: "POST" })
  .inputValidator((i: { userId: string }) => z.object({ userId: z.string().min(1).max(64) }).parse(i))
  .handler(async ({ data }) => {
    const m = await import("./mysql.server");
    const staff = await m.requireAdmin();
    await m.query(CARDS_DDL);
    const existing = await m.one<{ card_uid: string }>("SELECT card_uid FROM dependent_cards WHERE user_id = ?", [data.userId]);
    await m.query("DELETE FROM dependent_cards WHERE user_id = ?", [data.userId]);
    await m.audit(staff.id, "REMOVE_DEPENDENT_CARD", "users", data.userId, { card_uid: existing?.card_uid ?? null });
    return { ok: true };
  });
