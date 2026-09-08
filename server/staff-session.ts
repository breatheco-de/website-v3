/**
 * Opaque staff sessions we issue after OAuth admission (or that staff paste).
 * Independent of GitHub access tokens.
 */

import crypto from "crypto";
import path from "path";
import {
  readLocalJson,
  writeLocalJson,
  scheduleEncryptedGcsWrite,
  encryptedGcsRead,
} from "./encrypted-blob-store";

const LOCAL_FILE = path.join(process.cwd(), "data", "staff-sessions.json");
const GCS_FILE = "staff-sessions.enc";

export const STAFF_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const EXCHANGE_TTL_MS = 5 * 60 * 1000;

export interface StaffSessionRecord {
  token: string;
  username: string;
  createdAt: number;
  expiresAt: number;
}

const sessions = new Map<string, StaffSessionRecord>();
const exchangeCodes = new Map<string, { token: string; expiresAt: number }>();
let loaded = false;
let loadPromise: Promise<void> | null = null;

async function ensureLoaded(): Promise<void> {
  if (loaded) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    try {
      const gcsRaw = await encryptedGcsRead(GCS_FILE);
      const localRaw = readLocalJson(LOCAL_FILE);
      const raw = gcsRaw || localRaw;
      if (raw) {
        const obj = JSON.parse(raw) as Record<string, StaffSessionRecord>;
        const now = Date.now();
        for (const [token, entry] of Object.entries(obj)) {
          if (entry?.token && entry?.username && entry.expiresAt > now) {
            sessions.set(token, entry);
          }
        }
      }
    } catch (err) {
      console.warn("[staff-session] load failed:", (err as Error).message);
    } finally {
      loaded = true;
      loadPromise = null;
    }
  })();
  return loadPromise;
}

function persist(): void {
  const obj: Record<string, StaffSessionRecord> = {};
  const now = Date.now();
  for (const [k, v] of sessions.entries()) {
    if (v.expiresAt > now) obj[k] = v;
  }
  const payload = JSON.stringify(obj, null, 2);
  try {
    writeLocalJson(LOCAL_FILE, payload);
  } catch (err) {
    console.error("[staff-session] local write failed:", (err as Error).message);
  }
  scheduleEncryptedGcsWrite(GCS_FILE, () => payload);
}

export async function createStaffSession(username: string): Promise<StaffSessionRecord> {
  await ensureLoaded();
  const token = crypto.randomBytes(32).toString("hex");
  const now = Date.now();
  const record: StaffSessionRecord = {
    token,
    username,
    createdAt: now,
    expiresAt: now + STAFF_SESSION_TTL_MS,
  };
  sessions.set(token, record);
  persist();
  return record;
}

export async function getStaffSession(token: string): Promise<StaffSessionRecord | null> {
  await ensureLoaded();
  const entry = sessions.get(token);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    sessions.delete(token);
    persist();
    return null;
  }
  return entry;
}

export async function revokeStaffSession(token: string): Promise<boolean> {
  await ensureLoaded();
  const existed = sessions.delete(token);
  if (existed) persist();
  return existed;
}

export async function revokeAllStaffSessions(username: string): Promise<number> {
  await ensureLoaded();
  let n = 0;
  for (const [token, entry] of sessions.entries()) {
    if (entry.username === username) {
      sessions.delete(token);
      n += 1;
    }
  }
  if (n) persist();
  return n;
}

export async function rekeyStaffSessions(
  oldUsername: string,
  newUsername: string,
): Promise<void> {
  await ensureLoaded();
  let changed = false;
  for (const entry of sessions.values()) {
    if (entry.username === oldUsername) {
      entry.username = newUsername;
      changed = true;
    }
  }
  if (changed) persist();
}

/** One-time code so the browser can pick up a session without putting it in the URL long-term. */
export function createSessionExchangeCode(token: string): string {
  const code = crypto.randomBytes(24).toString("hex");
  exchangeCodes.set(code, { token, expiresAt: Date.now() + EXCHANGE_TTL_MS });
  return code;
}

export function consumeSessionExchangeCode(code: string): string | null {
  const entry = exchangeCodes.get(code);
  exchangeCodes.delete(code);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) return null;
  return entry.token;
}

/** Test helper — not used in production paths. */
export function _resetStaffSessionsForTests(): void {
  sessions.clear();
  exchangeCodes.clear();
  loaded = true;
  loadPromise = null;
}
