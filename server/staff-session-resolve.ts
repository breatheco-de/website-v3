import * as userStore from "./user-store";
import {
  getStaffSession,
  type StaffSessionRecord,
} from "./staff-session";
import { isConnectionTokenStaffAllowed } from "./staff-github-login";
import {
  connectionTokenMatches,
  ensureWeblifyLocalOwner,
} from "./weblify-connection-token";

const CONNECTION_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface ResolvedStaffSession {
  token: string;
  username: string;
  staffId: string | null;
  roles: string[];
  expiresAt: number;
}

export async function resolveOwnedStaffSession(
  token: string | null | undefined,
): Promise<ResolvedStaffSession | null> {
  if (!token) return null;

  const session = await getStaffSession(token);
  if (session) {
    if (!userStore.getUser(session.username)) return null;
    if (!userStore.hasAnyRole(session.username)) return null;
    return {
      token: session.token,
      username: session.username,
      staffId: userStore.getOrCreateStaffUserId(session.username),
      roles: userStore.getUserRoles(session.username),
      expiresAt: session.expiresAt,
    };
  }

  if (!connectionTokenMatches(token)) return null;
  if (!isConnectionTokenStaffAllowed()) return null;

  const owner = ensureWeblifyLocalOwner();
  return {
    token: token.trim(),
    username: owner.username,
    staffId: owner.staffId,
    roles: owner.roles,
    expiresAt: Date.now() + CONNECTION_TOKEN_TTL_MS,
  };
}

export function staffSessionJson(resolved: ResolvedStaffSession) {
  const capabilities = userStore.getEffectiveCapabilities(resolved.username);
  return {
    valid: true as const,
    capabilities,
    roles: resolved.roles,
    userName: resolved.username,
    username: resolved.username,
    staffId: resolved.staffId,
    expiresAt: new Date(resolved.expiresAt).toISOString(),
  };
}

export function sessionFromRecord(
  session: StaffSessionRecord,
): Promise<ResolvedStaffSession | null> {
  return resolveOwnedStaffSession(session.token);
}
