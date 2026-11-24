import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  LEGACY_CONNECTION_TOKEN_OWNER,
  isConnectionTokenBootstrapUsername,
  readConnectionOwnerFromDisk,
} from "@shared/connection-token-owner";
import { isProductionMode } from "@shared/paths";
import * as userStore from "./user-store";

const ENV_KEY = "WEBLIFY_CONNECTION_TOKEN";
const TOKEN_FILE = "connection-token";

/** @deprecated Use readConnectionTokenOwnerUsername / ensureConnectionTokenOwner */
export const WEBLIFY_LOCAL_USERNAME = LEGACY_CONNECTION_TOKEN_OWNER;

export { isConnectionTokenBootstrapUsername };

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

function projectRoot(): string {
  return process.env.WEBLIFY_PROJECT_ROOT || process.cwd();
}

export function readWeblifyConnectionToken(): string | null {
  const fromEnv = process.env[ENV_KEY]?.trim();
  if (fromEnv) return fromEnv;
  try {
    const p = path.join(projectRoot(), ".local", TOKEN_FILE);
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

/** Chosen local bootstrap username from env or `.local/connection-owner`. */
export function readConnectionTokenOwnerUsername(): string | null {
  return readConnectionOwnerFromDisk(projectRoot());
}

/** True when username is the configured connection-token bootstrap owner (file or user-store flag). */
export function isConnectionTokenOwnerUsername(username: string | null | undefined): boolean {
  if (!username) return false;
  if (isConnectionTokenBootstrapUsername(username, projectRoot())) return true;
  const user = userStore.getUser(username);
  return Boolean(user?.connectionTokenOwner);
}

/**
 * Ensure bootstrap identity exists with the owner role pack (union, never strip).
 * Requires `.local/connection-owner` (or env). Migrates legacy `weblify-local` when renaming.
 */
export function ensureConnectionTokenOwner(): {
  username: string;
  staffId: string;
  roles: string[];
} {
  const username = readConnectionTokenOwnerUsername();
  if (!username) {
    throw new Error(
      "Connection-token owner missing. Run `npx caxton-cms token` (or set WEBLIFY_CONNECTION_OWNER). See docs/local-connection-token.md",
    );
  }

  const legacy = userStore.getUser(LEGACY_CONNECTION_TOKEN_OWNER);
  if (
    username !== LEGACY_CONNECTION_TOKEN_OWNER &&
    legacy &&
    !legacy.deletedAt &&
    !userStore.getUser(username)
  ) {
    // Migrate legacy weblify-local → new owner name when target does not exist yet.
    const renamed = userStore.renameUser(LEGACY_CONNECTION_TOKEN_OWNER, username);
    if (renamed.ok) {
      userStore.markConnectionTokenOwner(username, true);
    }
  }

  const existing = userStore.getUser(username);
  if (existing && !existing.connectionTokenOwner && !existing.deletedAt) {
    throw new Error(
      `Username "${username}" already exists as a real staff user. Choose a different connection-token owner (npx caxton-cms token --user <name>).`,
    );
  }

  const current = existing ? userStore.getUserRoles(username) : [];
  const merged = [...new Set([...current, ...WEBLIFY_OWNER_PACK_ROLES])];

  if (!existing) {
    userStore.createAdmittedUser({
      username,
      firstName: "Local",
      lastName: "Bootstrap",
      identity: {
        provider: "weblify",
        providerUserId: `connection-token:${username}`,
        handle: username,
      },
      roles: merged,
      connectionTokenOwner: true,
    });
  } else {
    userStore.markConnectionTokenOwner(username, true);
    if (merged.length !== current.length || merged.some((r) => !current.includes(r))) {
      userStore.assignRoles(username, merged);
    }
  }

  const staffId = userStore.getOrCreateStaffUserId(username) || username;
  return {
    username,
    staffId,
    roles: userStore.getUserRoles(username),
  };
}

/** @deprecated Prefer ensureConnectionTokenOwner */
export function ensureWeblifyLocalOwner(): {
  username: string;
  staffId: string;
  roles: string[];
} {
  return ensureConnectionTokenOwner();
}

/** Production + allow-env is a hard misconfiguration (CLI/server boot). */
export function assertConnectionTokenStaffNotEnabledInProduction(): void {
  if (!isProductionMode()) return;
  const raw = process.env.WEBLIFY_ALLOW_CONNECTION_TOKEN_STAFF?.trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes") {
    throw new Error(
      "WEBLIFY_ALLOW_CONNECTION_TOKEN_STAFF must not be set in production. Connection-token staff login is a shared-secret vulnerability. See docs/local-connection-token.md",
    );
  }
}
