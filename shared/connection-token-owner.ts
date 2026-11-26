/**
 * Connection-token local bootstrap owner — chosen username persisted under `.local/`.
 * Dev-only identity; never a production staff user.
 */

import fs from "fs";
import path from "path";

export const CONNECTION_TOKEN_OWNER_FILE = "connection-owner";
export const CONNECTION_TOKEN_OWNER_ENV = "WEBLIFY_CONNECTION_OWNER";
/** Legacy hardcoded bootstrap username (migrate away; do not create new). */
export const LEGACY_CONNECTION_TOKEN_OWNER = "weblify-local";

const OWNER_RE = /^[a-z][a-z0-9_-]*$/;

export function validateConnectionOwnerUsername(
  raw: string,
): { ok: true; username: string } | { ok: false; error: string } {
  const username = raw.trim().toLowerCase();
  if (!username) {
    return { ok: false, error: "Local staff username is required." };
  }
  if (username.includes("@")) {
    return {
      ok: false,
      error: "Use a local username, not an email. This does not sign you in as a real staff account.",
    };
  }
  if (!OWNER_RE.test(username)) {
    return {
      ok: false,
      error: "Username must match ^[a-z][a-z0-9_-]*$ (lowercase letter, then letters, digits, _ or -).",
    };
  }
  return { ok: true, username };
}

export function normalizeConnectionOwnerUsername(raw: string): string | null {
  const v = validateConnectionOwnerUsername(raw);
  return v.ok ? v.username : null;
}

/** Read owner from env or `.local/connection-owner` under projectRoot. */
export function readConnectionOwnerFromDisk(
  projectRoot: string = process.env.WEBLIFY_PROJECT_ROOT || process.cwd(),
): string | null {
  const fromEnv = process.env[CONNECTION_TOKEN_OWNER_ENV]?.trim();
  if (fromEnv) return normalizeConnectionOwnerUsername(fromEnv);
  try {
    const p = path.join(projectRoot, ".local", CONNECTION_TOKEN_OWNER_FILE);
    if (!fs.existsSync(p)) return null;
    return normalizeConnectionOwnerUsername(fs.readFileSync(p, "utf-8").trim());
  } catch {
    return null;
  }
}

/** True when username matches the configured connection-token bootstrap owner. */
export function isConnectionTokenBootstrapUsername(
  username: string | null | undefined,
  projectRoot?: string,
): boolean {
  if (!username) return false;
  const owner = readConnectionOwnerFromDisk(projectRoot);
  return Boolean(owner && owner === username);
}
