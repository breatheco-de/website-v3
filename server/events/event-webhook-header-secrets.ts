/**
 * Secret outbound event-webhook headers.
 *
 * The ciphertext lives in event-webhooks.yml (`enc:v1:` + base64). The key is
 * EVENT_WEBHOOK_ENCRYPTION_KEY (64 hex chars) and never leaves the server.
 * Decrypt only when building the POST.
 */

import crypto from "crypto";
import { sanitizeWebhookHeaders } from "@shared/webhookHeaders";

const PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

/** Header names whose values are stored encrypted. Matches the staff preview. */
const SECRET_HEADER_NAME = /auth|token|secret|key|password|bearer/i;

/**
 * A staff echo of a saved secret: bullets plus a short tail.
 * Real tokens are longer than this.
 */
const MASK_RE = /^•{4}.{0,12}$/;

export class EventWebhookHeaderSecretError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EventWebhookHeaderSecretError";
  }
}

export function isSecretWebhookHeaderName(name: string): boolean {
  return SECRET_HEADER_NAME.test(name);
}

export function isEncryptedWebhookHeaderValue(value: string): boolean {
  return value.startsWith(PREFIX);
}

export function isMaskedWebhookHeaderValue(value: string): boolean {
  return MASK_RE.test(value);
}

export function eventWebhookEncryptionKey(): Buffer | null {
  const raw = process.env.EVENT_WEBHOOK_ENCRYPTION_KEY?.trim() ?? "";
  if (raw.length !== 64 || !/^[0-9a-fA-F]+$/.test(raw)) return null;
  return Buffer.from(raw, "hex");
}

function requireKey(): Buffer {
  const key = eventWebhookEncryptionKey();
  if (!key) {
    throw new EventWebhookHeaderSecretError("EVENT_WEBHOOK_ENCRYPTION_KEY is not configured");
  }
  return key;
}

export function encryptWebhookHeaderValue(plaintext: string, key: Buffer = requireKey()): string {
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return PREFIX + Buffer.concat([iv, tag, ciphertext]).toString("base64");
}

export function decryptWebhookHeaderValue(stored: string, key: Buffer = requireKey()): string {
  if (!isEncryptedWebhookHeaderValue(stored)) return stored;
  const blob = Buffer.from(stored.slice(PREFIX.length), "base64");
  if (blob.length < IV_BYTES + TAG_BYTES) {
    throw new EventWebhookHeaderSecretError("Could not decrypt a webhook header");
  }
  try {
    const iv = blob.subarray(0, IV_BYTES);
    const authTag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
    const ciphertext = blob.subarray(IV_BYTES + TAG_BYTES);
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch (err) {
    if (err instanceof EventWebhookHeaderSecretError) throw err;
    throw new EventWebhookHeaderSecretError("Could not decrypt a webhook header");
  }
}

/** Last 4 characters, for staff display. Never the full secret. */
export function redactWebhookHeaderTail(value: string, tailChars: number = 4): string {
  if (!value || value.length <= tailChars) return "••••";
  return `••••${value.slice(-tailChars)}`;
}

/**
 * Value safe to send to the staff UI.
 * Encrypted values are decrypted only to build the tail. If the key is missing, the tail is omitted.
 */
export function redactWebhookHeaderForStaff(stored: string): string {
  if (!stored) return "••••";
  if (!isEncryptedWebhookHeaderValue(stored)) return redactWebhookHeaderTail(stored);
  const key = eventWebhookEncryptionKey();
  if (!key) return "••••";
  try {
    return redactWebhookHeaderTail(decryptWebhookHeaderValue(stored, key));
  } catch {
    return "••••";
  }
}

export function redactWebhookHeadersForStaff(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  const clean = sanitizeWebhookHeaders(headers);
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(clean)) {
    out[name] = isSecretWebhookHeaderName(name) ? redactWebhookHeaderForStaff(value) : value;
  }
  return out;
}

/**
 * Headers for the outbound POST.
 * `enc:v1:` values are decrypted. Legacy plaintext is sent as stored.
 * A missing key fails the call when any header is encrypted.
 */
export function resolveWebhookHeadersForDelivery(
  headers: Record<string, string> | undefined,
): Record<string, string> {
  const clean = sanitizeWebhookHeaders(headers);
  const needsKey = Object.values(clean).some((value) => isEncryptedWebhookHeaderValue(value));
  const key = needsKey ? requireKey() : null;
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(clean)) {
    out[name] = key && isEncryptedWebhookHeaderValue(value)
      ? decryptWebhookHeaderValue(value, key)
      : value;
  }
  return out;
}

/**
 * Decide what to write for one secret header.
 * A masked value keeps the ciphertext already on disk. Legacy plaintext is encrypted
 * when the key exists, and left as-is when it does not. A new plaintext value is encrypted.
 */
export function sealSecretHeaderValue(incoming: string, previous: string | undefined): string {
  if (isEncryptedWebhookHeaderValue(incoming)) return incoming;
  if (isMaskedWebhookHeaderValue(incoming)) {
    if (!previous) {
      throw new EventWebhookHeaderSecretError(
        "A masked header has no saved secret. Paste the full value.",
      );
    }
    if (isEncryptedWebhookHeaderValue(previous)) return previous;
    const key = eventWebhookEncryptionKey();
    if (!key) return previous;
    return encryptWebhookHeaderValue(previous, key);
  }
  if (previous && incoming === previous) {
    const key = eventWebhookEncryptionKey();
    if (!key) return previous;
    return encryptWebhookHeaderValue(previous, key);
  }
  return encryptWebhookHeaderValue(incoming);
}
