import * as userStore from "./user-store";
import {
  getStaffSession,
  type StaffSessionRecord,
} from "./staff-session";

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
  if (!session) return null;
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
