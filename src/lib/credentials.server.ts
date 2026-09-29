/**
 * Encrypts payment provider credentials with AES-256-GCM before they reach
 * MySQL. Key: CREDENTIALS_KEY (falls back to SESSION_SECRET). Decrypted values
 * are only used server-side and are never returned to the browser.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

function key(): Buffer {
  const material =
    process.env["CREDENTIALS_KEY"] || process.env["SESSION_SECRET"] || "cbs-local-dev-credentials-key-change-me";
  return createHash("sha256").update(material).digest();
}

export function encryptCredential(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${data.toString("base64")}`;
}

export function decryptCredential(stored: string): string {
  const [version, iv, tag, data] = stored.split(":");
  if (version !== "v1" || !iv || !tag || !data) throw new Error("Unreadable credential.");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64")), decipher.final()]).toString("utf8");
}

/** Decrypted credential map for a provider in its current environment. */
export async function loadProviderCredentials(providerId: string, environment: string): Promise<Record<string, string>> {
  const { query } = await import("./mysql.server");
  const rows = await query<{ credential_key: string; encrypted_value: string | null }>(
    "SELECT credential_key, encrypted_value FROM payment_provider_credentials WHERE provider_id = ? AND environment = ?",
    [providerId, environment === "production" || environment === "live" ? "production" : "sandbox"],
  );
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (!row.encrypted_value) continue;
    try {
      out[row.credential_key] = decryptCredential(row.encrypted_value);
    } catch {
      /* key rotated or corrupted — treat as not configured */
    }
  }
  return out;
}
