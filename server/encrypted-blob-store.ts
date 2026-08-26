/**
 * AES-256-GCM encrypted local + GCS blob persistence.
 * Same wire format and env as mcp-server/lib/gcs-store.ts:
 *   [12 bytes IV] [16 bytes auth tag] [N bytes ciphertext]
 *   GCS key: mcp-auth/<filename>
 *
 * Env: GCS_BUCKET_NAME, MCP_TOKEN_ENCRYPTION_KEY (64-char hex),
 *      GCS_CREDENTIALS_JSON | GCS_KEY_FILENAME, GCS_PROJECT_ID
 */

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { Storage } from "@google-cloud/storage";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const GCS_PREFIX = "mcp-auth/";

let storage: Storage | null = null;
let bucketName = "";
let encryptionKey: Buffer | null = null;
let _ready = false;

function init(): void {
  if (_ready) return;
  _ready = true;

  const bucket = process.env.GCS_BUCKET_NAME;
  const rawKey = process.env.MCP_TOKEN_ENCRYPTION_KEY;

  if (!bucket) return;
  if (!rawKey || rawKey.length !== 64 || !/^[0-9a-fA-F]+$/.test(rawKey)) return;

  encryptionKey = Buffer.from(rawKey, "hex");
  bucketName = bucket;

  const opts: Record<string, unknown> = {};
  const credJson = process.env.GCS_CREDENTIALS_JSON;
  const projectId = process.env.GCS_PROJECT_ID;
  const keyFilename = process.env.GCS_KEY_FILENAME;

  if (projectId) opts.projectId = projectId;
  if (credJson) {
    try {
      opts.credentials = JSON.parse(credJson);
    } catch {
      console.error("[encrypted-blob-store] Failed to parse GCS_CREDENTIALS_JSON");
      encryptionKey = null;
      return;
    }
  } else if (keyFilename) {
    opts.keyFilename = keyFilename;
  }

  storage = new Storage(opts);
}

export function isEncryptedGcsAvailable(): boolean {
  init();
  return storage !== null && encryptionKey !== null;
}

function encrypt(plaintext: string): Buffer {
  init();
  if (!encryptionKey) throw new Error("MCP_TOKEN_ENCRYPTION_KEY not configured");
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv(ALGO, encryptionKey, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf-8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

function decrypt(blob: Buffer): string {
  init();
  if (!encryptionKey) throw new Error("MCP_TOKEN_ENCRYPTION_KEY not configured");
  if (blob.length < IV_BYTES + TAG_BYTES) {
    throw new Error("blob too short");
  }
  const iv = blob.subarray(0, IV_BYTES);
  const authTag = blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ciphertext = blob.subarray(IV_BYTES + TAG_BYTES);
  const decipher = crypto.createDecipheriv(ALGO, encryptionKey, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf-8");
}

/** Encrypt and upload to mcp-auth/<filename>. No-op without GCS+key. */
export async function encryptedGcsWrite(filename: string, plaintext: string): Promise<void> {
  init();
  if (!storage || !encryptionKey) return;
  try {
    const blob = encrypt(plaintext);
    const gcsKey = `${GCS_PREFIX}${filename}`;
    await storage.bucket(bucketName).file(gcsKey).save(blob, {
      contentType: "application/octet-stream",
      resumable: false,
      metadata: { cacheControl: "no-store" },
    });
  } catch (err) {
    console.error(
      `[encrypted-blob-store] GCS write failed for "${filename}":`,
      (err as Error).message,
    );
  }
}

/** Download and decrypt mcp-auth/<filename>. Null if missing/unavailable. */
export async function encryptedGcsRead(filename: string): Promise<string | null> {
  init();
  if (!storage || !encryptionKey) return null;
  try {
    const gcsKey = `${GCS_PREFIX}${filename}`;
    const file = storage.bucket(bucketName).file(gcsKey);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [blob] = await file.download();
    return decrypt(blob);
  } catch (err) {
    console.error(
      `[encrypted-blob-store] GCS read failed for "${filename}":`,
      (err as Error).message,
    );
    return null;
  }
}

const GCS_DEBOUNCE_MS = 2_000;
const _debounceHandles: Record<string, ReturnType<typeof setTimeout>> = {};
const _latestPayloads: Record<string, () => string> = {};

export function scheduleEncryptedGcsWrite(filename: string, getPayload: () => string): void {
  _latestPayloads[filename] = getPayload;
  if (_debounceHandles[filename]) clearTimeout(_debounceHandles[filename]);
  _debounceHandles[filename] = setTimeout(() => {
    delete _debounceHandles[filename];
    const get = _latestPayloads[filename];
    delete _latestPayloads[filename];
    if (get) {
      encryptedGcsWrite(filename, get()).catch(() => {});
    }
  }, GCS_DEBOUNCE_MS);
}

/** Ensure dir exists; write plaintext JSON (local mirror, gitignored via data/). */
export function writeLocalJson(filePath: string, payload: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, payload, "utf-8");
}

export function readLocalJson(filePath: string): string | null {
  try {
    if (!fs.existsSync(filePath)) return null;
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}
