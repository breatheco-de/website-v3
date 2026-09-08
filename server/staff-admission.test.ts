import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("./user-store", () => ({
  needsBootstrapAdmin: vi.fn(),
  findUserByIdentity: vi.fn(),
  findUsersByEmails: vi.fn(),
  peekPendingUsersForEmails: vi.fn(),
  claimPendingUser: vi.fn(),
  attachIdentity: vi.fn(),
  createAdmittedUser: vi.fn(),
  assignRoles: vi.fn(),
  getUserRoles: vi.fn(),
  hasAnyRole: vi.fn(),
  getOrCreateStaffUserId: vi.fn(),
  getUser: vi.fn(),
  renameUser: vi.fn(),
}));

vi.mock("./staff-session", () => ({
  rekeyStaffSessions: vi.fn(),
}));

vi.mock("./github-user-tokens", () => ({
  rekeyUserGitHubToken: vi.fn(),
}));

import * as userStore from "./user-store";
import { admitStaff } from "./staff-admission";
import type { AuthIdentity } from "./staff-auth/types";

const identity = (over: Partial<AuthIdentity> = {}): AuthIdentity => ({
  provider: "github",
  providerUserId: "42",
  handle: "alice",
  displayName: "Alice Example",
  verifiedEmails: ["alice@example.com"],
  primaryEmail: "alice@example.com",
  ...over,
});

describe("admitStaff", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(userStore.getOrCreateStaffUserId).mockReturnValue("alice");
    vi.mocked(userStore.hasAnyRole).mockReturnValue(true);
    vi.mocked(userStore.getUserRoles).mockReturnValue(["content_viewer"]);
    vi.mocked(userStore.renameUser).mockReturnValue({ ok: true });
  });

  it("denies when there is no verified email", () => {
    const result = admitStaff(identity({ verifiedEmails: [], primaryEmail: undefined }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("auth_email_unverified");
  });

  it("denies unknown users when not bootstrapping", () => {
    vi.mocked(userStore.needsBootstrapAdmin).mockReturnValue(false);
    vi.mocked(userStore.findUserByIdentity).mockReturnValue(null);
    vi.mocked(userStore.findUsersByEmails).mockReturnValue([]);
    vi.mocked(userStore.peekPendingUsersForEmails).mockReturnValue([]);
    const result = admitStaff(identity());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("staff_not_pre_registered");
  });

  it("bootstraps first admin", () => {
    vi.mocked(userStore.needsBootstrapAdmin).mockReturnValue(true);
    vi.mocked(userStore.findUserByIdentity).mockReturnValue(null);
    vi.mocked(userStore.findUsersByEmails).mockReturnValue([]);
    vi.mocked(userStore.peekPendingUsersForEmails).mockReturnValue([]);
    vi.mocked(userStore.createAdmittedUser).mockReturnValue({
      id: "alice",
      username: "alice",
      roles: ["user_admin"],
    } as any);
    const result = admitStaff(identity());
    expect(result.ok).toBe(true);
    expect(userStore.createAdmittedUser).toHaveBeenCalledWith(
      expect.objectContaining({ roles: ["user_admin"], username: "alice" }),
    );
  });

  it("claims a unique pending invite", () => {
    vi.mocked(userStore.needsBootstrapAdmin).mockReturnValue(false);
    vi.mocked(userStore.findUserByIdentity).mockReturnValue(null);
    vi.mocked(userStore.findUsersByEmails).mockReturnValue([]);
    vi.mocked(userStore.peekPendingUsersForEmails).mockReturnValue([
      { email: "alice@example.com", role: "platform_ops", createdAt: "2020-01-01" },
    ]);
    vi.mocked(userStore.claimPendingUser).mockReturnValue("platform_ops");
    vi.mocked(userStore.createAdmittedUser).mockReturnValue({
      id: "alice",
      username: "alice",
      roles: ["platform_ops"],
    } as any);
    const result = admitStaff(identity());
    expect(result.ok).toBe(true);
    expect(userStore.claimPendingUser).toHaveBeenCalledWith("alice@example.com");
  });

  it("denies ambiguous matches across two users", () => {
    vi.mocked(userStore.needsBootstrapAdmin).mockReturnValue(false);
    vi.mocked(userStore.findUserByIdentity).mockReturnValue(null);
    vi.mocked(userStore.findUsersByEmails).mockReturnValue([
      { key: "a", user: { id: "a", username: "a", email: "alice@example.com", roles: ["content_viewer"] } as any },
      { key: "b", user: { id: "b", username: "b", email: "alice@example.com", roles: ["content_viewer"] } as any },
    ]);
    vi.mocked(userStore.peekPendingUsersForEmails).mockReturnValue([]);
    const result = admitStaff(identity());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("staff_identity_ambiguous");
  });

  it("denies when matched user has no roles", () => {
    vi.mocked(userStore.needsBootstrapAdmin).mockReturnValue(false);
    vi.mocked(userStore.findUserByIdentity).mockReturnValue({
      key: "alice",
      user: { id: "alice", username: "alice", email: "alice@example.com", roles: [] } as any,
    });
    vi.mocked(userStore.findUsersByEmails).mockReturnValue([]);
    vi.mocked(userStore.peekPendingUsersForEmails).mockReturnValue([]);
    vi.mocked(userStore.hasAnyRole).mockReturnValue(false);
    const result = admitStaff(identity());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("staff_no_role");
  });
});
