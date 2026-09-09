import crypto from "crypto";
import fs from "fs";
import path from "path";
import * as userStore from "./user-store";

const ENV_KEY = "WEBLIFY_CONNECTION_TOKEN";
const TOKEN_FILE = "connection-token";
export const WEBLIFY_LOCAL_USERNAME = "weblify-local";

/** Roles for connection-token bootstrap so DebugBubble can configure and edit. */
export const WEBLIFY_OWNER_PACK_ROLES = [
  "user_admin",
  "platform_steward",
  "platform_ops",
  "copy_editor",
  "layout_editor",
  "media_editor",
  "seo_specialist",
  "publisher",
] as const;

export function readWeblifyConnectionToken(): string | null {
  const fromEnv = process.env[ENV_KEY]?.trim();
  if (fromEnv) return fromEnv;
  try {
    const root = process.env.WEBLIFY_PROJECT_ROOT || process.cwd();
    const p = path.join(root, ".local", TOKEN_FILE);
    if (!fs.existsSync(p)) return null;
    const raw = fs.readFileSync(p, "utf-8").trim();
    return raw || null;
  } catch {
    return null;
  }
}

export function connectionTokenMatches(candidate: string | null | undefined): boolean {
  if (!candidate?.trim()) return false;
  const expected = readWeblifyConnectionToken();
  if (!expected) return false;
  try {
    const a = Buffer.from(candidate.trim());
    const b = Buffer.from(expected);
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Ensure bootstrap identity exists with the Weblify owner role pack (union, never strip).
 */
export function ensureWeblifyLocalOwner(): {
  username: string;
  staffId: string;
  roles: string[];
} {
  const username = WEBLIFY_LOCAL_USERNAME;
  const existing = userStore.getUser(username);
  const current = existing ? userStore.getUserRoles(username) : [];
  const merged = [...new Set([...current, ...WEBLIFY_OWNER_PACK_ROLES])];

  if (!existing) {
    userStore.createAdmittedUser({
      username,
      firstName: "Weblify",
      lastName: "Local",
      identity: {
        provider: "weblify",
        providerUserId: "weblify-local",
        handle: "weblify-local",
      },
      roles: merged,
    });
  } else if (merged.length !== current.length || merged.some((r) => !current.includes(r))) {
    userStore.assignRoles(username, merged);
  }

  const staffId =
    userStore.getOrCreateStaffUserId(username) || username;
  return {
    username,
    staffId,
    roles: userStore.getUserRoles(username),
  };
}
