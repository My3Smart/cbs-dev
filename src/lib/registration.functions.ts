import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

const optionalText = z.string().trim().max(255).optional().transform((value) => value || null);
const status = z.enum(["ACTIVE", "SUSPENDED", "CLOSED", "PENDING"]);

const registrationSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("organization"),
    code: z.string().trim().min(2).max(40),
    name: z.string().trim().min(2).max(160),
    legalName: optionalText,
    registrationNumber: optionalText,
    email: z.string().trim().email().optional().or(z.literal("")).transform((value) => value || null),
    mobile: optionalText,
    address: z.string().trim().max(500).optional().transform((value) => value || null),
    currency: z.string().trim().length(3).transform((value) => value.toUpperCase()),
    timezone: z.string().trim().min(2).max(80),
    status,
  }),
  z.object({
    kind: z.literal("cluster"),
    organizationId: z.string().uuid(),
    code: z.string().trim().min(2).max(40),
    name: z.string().trim().min(2).max(160),
    region: optionalText,
    status,
  }),
  z.object({
    kind: z.literal("user"),
    organizationId: z.string().uuid(),
    clusterId: z.string().uuid(),
    userCode: z.string().trim().min(2).max(40),
    fullName: z.string().trim().min(2).max(160),
    email: z.string().trim().email().optional().or(z.literal("")).transform((value) => value || null),
    mobile: optionalText,
    kycStatus: z.enum(["UNVERIFIED", "PENDING", "VERIFIED"]),
    password: z.string().min(6).max(200),
    status,
  }),
  z.object({
    kind: z.literal("merchant"),
    organizationId: z.string().uuid(),
    clusterId: z.string().uuid(),
    merchantCode: z.string().trim().min(2).max(40),
    businessName: z.string().trim().min(2).max(160),
    legalName: optionalText,
    registrationNumber: optionalText,
    email: z.string().trim().email().optional().or(z.literal("")).transform((value) => value || null),
    mobile: optionalText,
    businessAddress: z.string().trim().max(500).optional().transform((value) => value || null),
    settlementCycle: z.string().trim().min(2).max(40),
    password: z.string().min(6).max(200),
    status,
  }),
]);

export type RegistrationInput = z.input<typeof registrationSchema>;

export const registerEntity = createServerFn({ method: "POST" })
  .inputValidator((input: RegistrationInput) => registrationSchema.parse(input))
  .handler(async ({ data }) => {
    const m = await import("./mysql.server");
    const staff = await m.requireAdmin();
    let passwordHash: string | null = null;
    if (data.kind === "user" || data.kind === "merchant") {
      const bcrypt = (await import("bcryptjs")).default;
      passwordHash = await bcrypt.hash(data.password, 10);
      await m.ensurePasswordColumns();
    }

    return m.tx(async (conn) => {
      const id = await m.newId(conn);
      const partyId = await m.newId(conn);
      let entityType: string;
      let label: string;

      if (data.kind === "organization") {
        await conn.query(
          `INSERT INTO organizations (id, code, name, legal_name, registration_number, email, mobile, address, currency, timezone, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, data.code, data.name, data.legalName, data.registrationNumber, data.email, data.mobile, data.address, data.currency, data.timezone, data.status],
        );
        await conn.query(
          "INSERT INTO parties (id, organization_id, party_type, display_name, status) VALUES (?, ?, 'ORGANIZATION', ?, ?)",
          [partyId, id, data.name, data.status],
        );
        entityType = "organizations";
        label = data.name;
      } else if (data.kind === "cluster") {
        await conn.query(
          "INSERT INTO clusters (id, organization_id, code, name, region, status) VALUES (?, ?, ?, ?, ?, ?)",
          [id, data.organizationId, data.code, data.name, data.region, data.status],
        );
        entityType = "clusters";
        label = data.name;
      } else if (data.kind === "user") {
        await conn.query(
          `INSERT INTO users (id, organization_id, cluster_id, user_code, full_name, email, mobile, password_hash, kyc_status, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, data.organizationId, data.clusterId, data.userCode, data.fullName, data.email, data.mobile, passwordHash, data.kycStatus, data.status],
        );
        await conn.query(
          "INSERT INTO parties (id, user_id, organization_id, party_type, display_name, status) VALUES (?, ?, ?, 'USER', ?, ?)",
          [partyId, id, data.organizationId, data.fullName, data.status],
        );
        await m.ensureWallet(conn, partyId);
        entityType = "users";
        label = data.fullName;
      } else {
        await conn.query(
          `INSERT INTO merchants (id, organization_id, cluster_id, merchant_code, business_name, legal_name, registration_number, email, mobile, business_address, settlement_cycle, password_hash, status)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [id, data.organizationId, data.clusterId, data.merchantCode, data.businessName, data.legalName, data.registrationNumber, data.email, data.mobile, data.businessAddress, data.settlementCycle, passwordHash, data.status],
        );
        await conn.query(
          "INSERT INTO parties (id, merchant_id, organization_id, party_type, display_name, status) VALUES (?, ?, ?, 'MERCHANT', ?, ?)",
          [partyId, id, data.organizationId, data.businessName, data.status],
        );
        await m.ensureWallet(conn, partyId);
        entityType = "merchants";
        label = data.businessName;
      }

      await m.audit(staff.id, `REGISTER_${data.kind.toUpperCase()}`, entityType, id, { label }, conn);
      return { id, kind: data.kind, label };
    });
  });
