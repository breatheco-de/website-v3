/**
 * Encryption for saved lead copies (lead outbox payloads and CRM response bodies).
 *
 * Wire format matches event-webhook header secrets: `enc:v1:` + base64([12 IV][16 tag][ciphertext]).
 * Key: LEAD_OUTBOX_ENCRYPTION_KEY (64 hex). No fallback key for writes: without it the
 * outbox is off and leads behave as before. LEAD_OUTBOX_ENCRYPTION_KEY_PREVIOUS is only
 * tried for reads, so a key rotation does not strand leads that are still waiting.
 */

import crypto from "crypto";

const PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export const LEAD_OUTBOX_KEY_ENV = "LEAD_OUTBOX_ENCRYPTION_KEY";
export const LEAD_OUTBOX_PREVIOUS_KEY_ENV = "LEAD_OUTBOX_ENCRYPTION_KEY_PREVIOUS";

export type LeadOutboxKeyStatus = "ok" | "missing";

export class LeadOutboxDecryptError extends Error {
  constructor(message = "Saved copy unreadable (encryption key changed)") {
    super(message);
    this.name = "LeadOutboxDecryptError";
  }
}

function parseKey(raw: string | undefined): Buffer | null {
  const v = raw?.trim() ?? "";
  if (v.length !== 64 || !/^[0-9a-fA-F]+$/.test(v)) return null;
  return Buffer.from(v, "hex");
}

export function leadOutboxKey(): Buffer | null {
  return parseKey(process.env[LEAD_OUTBOX_KEY_ENV]);
}

function previousKey(): Buffer | null {
  return parseKey(process.env[LEAD_OUTBOX_PREVIOUS_KEY_ENV]);
}

export function leadOutboxKeyStatus(): LeadOutboxKeyStatus {
  return leadOutboxKey() ? "ok" : "missing";
}

/** Encrypt with the current key. Returns null when the key is not configured. */
export function encryptLeadOutbox(plaintext: string, key: Buffer | null = leadOutboxKey()): string | null {
  if (!key) return null;
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

function decryptWith(blob: Buffer, key: Buffer): string | null {
  try {
    const iv = blob.subarray(0, IV_BYTES);
    const tag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = blob.subarray(IV_BYTES + TAG_BYTES);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** Decrypt with the current key, then the previous one. Throws LeadOutboxDecryptError when neither works. */
export function decryptLeadOutbox(
  stored: string,
  keys: { current?: Buffer | null; previous?: Buffer | null } = {},
): string {
  if (!stored.startsWith(PREFIX)) throw new LeadOutboxDecryptError();
  const blob = Buffer.from(stored.slice(PREFIX.length), "base64");
  if (blob.length < IV_BYTES + TAG_BYTES) throw new LeadOutboxDecryptError();
  const candidates = [
    keys.current === undefined ? leadOutboxKey() : keys.current,
    keys.previous === undefined ? previousKey() : keys.previous,
  ];
  for (const key of candidates) {
    if (!key) continue;
    const out = decryptWith(blob, key);
    if (out !== null) return out;
  }
  throw new LeadOutboxDecryptError();
}
