import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./user-store", () => ({
  getUser: vi.fn(),
  getUserRoles: vi.fn(),
  createAdmittedUser: vi.fn(),
  assignRoles: vi.fn(),
  getOrCreateStaffUserId: vi.fn(),
  hasAnyRole: vi.fn(),
  getEffectiveCapabilities: vi.fn(() => [{ name: "users_manage" }]),
}));

vi.mock("./staff-session", () => ({
  getStaffSession: vi.fn(),
}));

vi.mock("./staff-github-login", async () => {
  const actual = await vi.importActual<typeof import("./staff-github-login")>(
    "./staff-github-login",
  );
  return {
    ...actual,
    isConnectionTokenStaffAllowed: vi.fn(),
  };
});

import * as userStore from "./user-store";
import { getStaffSession } from "./staff-session";
import { isConnectionTokenStaffAllowed } from "./staff-github-login";
import { resolveOwnedStaffSession } from "./staff-session-resolve";
import {
  WEBLIFY_LOCAL_USERNAME,
  WEBLIFY_OWNER_PACK_ROLES,
  ensureWeblifyLocalOwner,
} from "./weblify-connection-token";

describe("ensureWeblifyLocalOwner", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(userStore.getOrCreateStaffUserId).mockReturnValue("weblify-local");
  });

  it("creates weblify-local with owner pack when missing", () => {
    vi.mocked(userStore.getUser).mockReturnValue(null);
    vi.mocked(userStore.getUserRoles).mockReturnValue([...WEBLIFY_OWNER_PACK_ROLES]);
    const result = ensureWeblifyLocalOwner();
    expect(userStore.createAdmittedUser).toHaveBeenCalledWith(
      expect.objectContaining({
        username: WEBLIFY_LOCAL_USERNAME,
        roles: expect.arrayContaining(["user_admin", "platform_steward", "copy_editor"]),
      }),
    );
    expect(result.username).toBe(WEBLIFY_LOCAL_USERNAME);
  });

  it("unions roles when user exists with weaker set", () => {
    vi.mocked(userStore.getUser).mockReturnValue({
      id: "x",
      username: WEBLIFY_LOCAL_USERNAME,
      roles: ["user_admin"],
    } as any);
    vi.mocked(userStore.getUserRoles)
      .mockReturnValueOnce(["user_admin"])
      .mockReturnValue([...WEBLIFY_OWNER_PACK_ROLES]);
    ensureWeblifyLocalOwner();
    expect(userStore.assignRoles).toHaveBeenCalledWith(
      WEBLIFY_LOCAL_USERNAME,
      expect.arrayContaining(["user_admin", "publisher", "media_editor"]),
    );
  });
});

describe("resolveOwnedStaffSession connection token", () => {
  const token = "wfy_test_connection_token_value_xx";

  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.WEBLIFY_CONNECTION_TOKEN;
    delete process.env.WEBLIFY_PROJECT_ROOT;
    vi.mocked(getStaffSession).mockResolvedValue(null);
    vi.mocked(userStore.getOrCreateStaffUserId).mockReturnValue("weblify-local");
    vi.mocked(userStore.getUserRoles).mockReturnValue([...WEBLIFY_OWNER_PACK_ROLES]);
    vi.mocked(userStore.getUser).mockReturnValue(null);
  });

  afterEach(() => {
    delete process.env.WEBLIFY_CONNECTION_TOKEN;
  });

  it("accepts matching connection token when allowed", async () => {
    process.env.WEBLIFY_CONNECTION_TOKEN = token;
    vi.mocked(isConnectionTokenStaffAllowed).mockReturnValue(true);
    const resolved = await resolveOwnedStaffSession(token);
    expect(resolved?.username).toBe(WEBLIFY_LOCAL_USERNAME);
    expect(resolved?.token).toBe(token);
    expect(userStore.createAdmittedUser).toHaveBeenCalled();
  });

  it("rejects matching connection token when not allowed", async () => {
    process.env.WEBLIFY_CONNECTION_TOKEN = token;
    vi.mocked(isConnectionTokenStaffAllowed).mockReturnValue(false);
    const resolved = await resolveOwnedStaffSession(token);
    expect(resolved).toBeNull();
  });

  it("rejects wrong token", async () => {
    process.env.WEBLIFY_CONNECTION_TOKEN = token;
    vi.mocked(isConnectionTokenStaffAllowed).mockReturnValue(true);
    const resolved = await resolveOwnedStaffSession("wfy_wrong");
    expect(resolved).toBeNull();
  });
});
