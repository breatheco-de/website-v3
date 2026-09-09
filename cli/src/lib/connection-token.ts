import crypto from "crypto";
import fs from "fs";
import path from "path";

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

export { ENV_KEY as CONNECTION_TOKEN_ENV };
