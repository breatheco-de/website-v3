import type { AuthIdentity, AdmissionResult } from "./staff-auth/types";
import * as userStore from "./user-store";
import { rekeyStaffSessions } from "./staff-session";
import { rekeyUserGitHubToken } from "./github-user-tokens";

const MESSAGES: Record<AdmissionResult extends { ok: false } ? AdmissionResult["code"] : never, string> = {
  auth_email_unverified:
    "Only GitHub accounts with a verified email can sign in. Add a verified email on GitHub and try again.",
  staff_identity_ambiguous:
    "This login matches more than one staff user. Ask an admin to fix emails on the staff list.",
  staff_not_pre_registered:
    "You’re not on the staff list. Ask an admin to pre-register your email.",
  staff_no_role:
    "Your account has no role. Ask an admin to assign one.",
};

function splitDisplayName(displayName?: string): { firstName?: string; lastName?: string } {
  const parts = (displayName || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { firstName: parts[0] };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function uniqueKeys(entries: Array<{ key: string }>): string[] {
  return [...new Set(entries.map((e) => e.key))];
}

function desiredUsername(identity: AuthIdentity): string {
  return (identity.handle || identity.providerUserId).trim();
}

function identityPayload(identity: AuthIdentity) {
  return {
    provider: identity.provider,
    providerUserId: identity.providerUserId,
    handle: identity.handle,
  };
}

function profileFromIdentity(identity: AuthIdentity) {
  const { firstName, lastName } = splitDisplayName(identity.displayName);
  return {
    email: identity.primaryEmail || identity.verifiedEmails[0],
    firstName,
    lastName,
    githubLogin: identity.provider === "github" ? identity.handle : undefined,
  };
}

function maybeRekeyToHandle(currentKey: string, identity: AuthIdentity): string {
  if (identity.provider !== "github" || !identity.handle) return currentKey;
  if (currentKey === identity.handle) return currentKey;
  const existing = userStore.getUser(identity.handle);
  if (existing && existing.username !== currentKey) return currentKey;
  const renamed = userStore.renameUser(currentKey, identity.handle);
  if (!renamed.ok) return currentKey;
  void rekeyUserGitHubToken(currentKey, identity.handle);
  void rekeyStaffSessions(currentKey, identity.handle);
  return identity.handle;
}

function finishUser(username: string): AdmissionResult {
  if (!userStore.hasAnyRole(username)) {
    return { ok: false, code: "staff_no_role", error: MESSAGES.staff_no_role };
  }
  const staffId = userStore.getOrCreateStaffUserId(username) || username;
  return { ok: true, username, staffId };
}

export function admitStaff(identity: AuthIdentity): AdmissionResult {
  const verified = identity.verifiedEmails
    .map((e) => e.toLowerCase().trim())
    .filter(Boolean);
  if (verified.length === 0) {
    return { ok: false, code: "auth_email_unverified", error: MESSAGES.auth_email_unverified };
  }

  const byIdentity = userStore.findUserByIdentity(
    identity.provider,
    identity.providerUserId,
  );
  const byEmail = userStore.findUsersByEmails(verified);
  const existingEntries = [
    ...(byIdentity ? [byIdentity] : []),
    ...byEmail,
  ];
  const existingKeys = uniqueKeys(existingEntries);
  const pending = userStore.peekPendingUsersForEmails(verified);

  const existingEmailSet = new Set(
    existingEntries.flatMap((e) => {
      const emails: string[] = [];
      if (e.user.email) emails.push(e.user.email.toLowerCase().trim());
      if (e.key.includes("@")) emails.push(e.key.toLowerCase().trim());
      return emails;
    }),
  );
  const pendingForNewPerson = pending.filter((p) => !existingEmailSet.has(p.email));

  if (existingKeys.length > 1) {
    return { ok: false, code: "staff_identity_ambiguous", error: MESSAGES.staff_identity_ambiguous };
  }
  if (existingKeys.length === 1 && pendingForNewPerson.length > 0) {
    return { ok: false, code: "staff_identity_ambiguous", error: MESSAGES.staff_identity_ambiguous };
  }
  if (existingKeys.length === 0 && pending.length > 1) {
    const pendingEmails = new Set(pending.map((p) => p.email));
    if (pendingEmails.size > 1) {
      return { ok: false, code: "staff_identity_ambiguous", error: MESSAGES.staff_identity_ambiguous };
    }
  }

  const ident = identityPayload(identity);
  const profile = profileFromIdentity(identity);

  if (userStore.needsBootstrapAdmin()) {
    if (existingKeys.length === 1) {
      let key = existingKeys[0];
      key = maybeRekeyToHandle(key, identity);
      userStore.attachIdentity(key, ident, profile);
      const roles = userStore.getUserRoles(key);
      if (!roles.includes("user_admin")) {
        userStore.assignRoles(key, [...roles, "user_admin"], profile.email);
      }
      return finishUser(key);
    }
    const username = desiredUsername(identity);
    userStore.createAdmittedUser({
      username,
      ...profile,
      identity: ident,
      roles: ["user_admin"],
    });
    return finishUser(username);
  }

  if (existingKeys.length === 1) {
    let key = existingKeys[0];
    key = maybeRekeyToHandle(key, identity);
    userStore.attachIdentity(key, ident, profile);
    return finishUser(key);
  }

  if (pending.length === 1) {
    const claimed = userStore.claimPendingUser(pending[0].email);
    if (!claimed) {
      return { ok: false, code: "staff_not_pre_registered", error: MESSAGES.staff_not_pre_registered };
    }
    const username = desiredUsername(identity);
    userStore.createAdmittedUser({
      username,
      ...profile,
      email: pending[0].email,
      identity: ident,
      roles: [claimed],
    });
    return finishUser(username);
  }

  return { ok: false, code: "staff_not_pre_registered", error: MESSAGES.staff_not_pre_registered };
}
