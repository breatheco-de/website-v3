import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  CONNECTION_TOKEN_OWNER_ENV,
  CONNECTION_TOKEN_OWNER_FILE,
  LEGACY_CONNECTION_TOKEN_OWNER,
  validateConnectionOwnerUsername,
} from "../../../shared/connection-token-owner.js";

const TOKEN_FILE = "connection-token";
const ENV_KEY = "WEBLIFY_CONNECTION_TOKEN";

export function localDir(projectRoot: string): string {
  const dir = path.join(projectRoot, ".local");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** Mint a new plaintext token; persist for this process/session under .local/ */
export function mintConnectionToken(projectRoot: string): string {
  const token = `wfy_${crypto.randomBytes(24).toString("base64url")}`;
  const dir = localDir(projectRoot);
  fs.writeFileSync(path.join(dir, TOKEN_FILE), token, { mode: 0o600 });
  process.env[ENV_KEY] = token;
  return token;
}

export function readConnectionToken(projectRoot: string): string | null {
  if (process.env[ENV_KEY]?.trim()) return process.env[ENV_KEY]!.trim();
  const p = path.join(projectRoot, ".local", TOKEN_FILE);
  if (!fs.existsSync(p)) return null;
  return fs.readFileSync(p, "utf-8").trim() || null;
}

export function verifyConnectionToken(projectRoot: string, candidate: string | undefined): boolean {
  if (!candidate?.trim()) return false;
  const expected = readConnectionToken(projectRoot);
  if (!expected) return false;
  try {
    return crypto.timingSafeEqual(Buffer.from(candidate.trim()), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function readConnectionOwner(projectRoot: string): string | null {
  const fromEnv = process.env[CONNECTION_TOKEN_OWNER_ENV]?.trim();
  if (fromEnv) {
    const v = validateConnectionOwnerUsername(fromEnv);
    return v.ok ? v.username : null;
  }
  const p = path.join(projectRoot, ".local", CONNECTION_TOKEN_OWNER_FILE);
  if (!fs.existsSync(p)) return null;
  const raw = fs.readFileSync(p, "utf-8").trim();
  if (!raw) return null;
  const v = validateConnectionOwnerUsername(raw);
  return v.ok ? v.username : null;
}

export function writeConnectionOwner(projectRoot: string, username: string): void {
  const v = validateConnectionOwnerUsername(username);
  if (!v.ok) throw new Error(v.error);
  const dir = localDir(projectRoot);
  fs.writeFileSync(path.join(dir, CONNECTION_TOKEN_OWNER_FILE), `${v.username}\n`, {
    mode: 0o600,
  });
  process.env[CONNECTION_TOKEN_OWNER_ENV] = v.username;
}

/** True when local user store still has the legacy bootstrap key. */
export function legacyWeblifyLocalExists(projectRoot: string): boolean {
  const storePath = path.join(projectRoot, ".multisite-user-store.json");
  if (!fs.existsSync(storePath)) return false;
  try {
    const raw = JSON.parse(fs.readFileSync(storePath, "utf-8")) as {
      users?: Record<string, unknown>;
    };
    return Boolean(raw.users?.[LEGACY_CONNECTION_TOKEN_OWNER]);
  } catch {
    return false;
  }
}

export { ENV_KEY as CONNECTION_TOKEN_ENV, validateConnectionOwnerUsername };
