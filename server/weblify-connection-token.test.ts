import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./user-store", () => ({
  getUser: vi.fn(),
  getUserRoles: vi.fn(),
  createAdmittedUser: vi.fn(),
  assignRoles: vi.fn(),
  getOrCreateStaffUserId: vi.fn(),
  hasAnyRole: vi.fn(),
  renameUser: vi.fn(),
  markConnectionTokenOwner: vi.fn(),
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
  WEBLIFY_OWNER_PACK_ROLES,
  ensureConnectionTokenOwner,
} from "./weblify-connection-token";

describe("ensureConnectionTokenOwner", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.WEBLIFY_CONNECTION_OWNER;
    vi.mocked(userStore.getOrCreateStaffUserId).mockReturnValue("dev-alice");
    vi.mocked(userStore.renameUser).mockReturnValue({ ok: true });
  });

  afterEach(() => {
    delete process.env.WEBLIFY_CONNECTION_OWNER;
  });

  it("throws when owner file/env missing", () => {
    expect(() => ensureConnectionTokenOwner()).toThrow(/owner missing/i);
  });

  it("creates flagged owner when missing", () => {
    process.env.WEBLIFY_CONNECTION_OWNER = "dev-alice";
    vi.mocked(userStore.getUser).mockReturnValue(null);
    vi.mocked(userStore.getUserRoles).mockReturnValue([...WEBLIFY_OWNER_PACK_ROLES]);
    const result = ensureConnectionTokenOwner();
    expect(userStore.createAdmittedUser).toHaveBeenCalledWith(
      expect.objectContaining({
        username: "dev-alice",
        connectionTokenOwner: true,
        roles: expect.arrayContaining(["user_admin", "platform_steward"]),
      }),
    );
    expect(result.username).toBe("dev-alice");
  });

  it("rejects colliding real staff user", () => {
    process.env.WEBLIFY_CONNECTION_OWNER = "real-user";
    vi.mocked(userStore.getUser).mockReturnValue({
      id: "x",
      username: "real-user",
      roles: ["user_admin"],
    } as any);
    expect(() => ensureConnectionTokenOwner()).toThrow(/already exists as a real staff user/i);
  });
});

describe("resolveOwnedStaffSession connection token", () => {
  const token = "wfy_test_connection_token_value_xx";

  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.WEBLIFY_CONNECTION_TOKEN;
    delete process.env.WEBLIFY_CONNECTION_OWNER;
    delete process.env.WEBLIFY_PROJECT_ROOT;
    vi.mocked(getStaffSession).mockResolvedValue(null);
    vi.mocked(userStore.getOrCreateStaffUserId).mockReturnValue("dev-alice");
    vi.mocked(userStore.getUserRoles).mockReturnValue([...WEBLIFY_OWNER_PACK_ROLES]);
    vi.mocked(userStore.getUser).mockReturnValue(null);
    vi.mocked(userStore.renameUser).mockReturnValue({ ok: true });
  });

  afterEach(() => {
    delete process.env.WEBLIFY_CONNECTION_TOKEN;
    delete process.env.WEBLIFY_CONNECTION_OWNER;
  });

  it("accepts matching connection token when allowed and owner set", async () => {
    process.env.WEBLIFY_CONNECTION_TOKEN = token;
    process.env.WEBLIFY_CONNECTION_OWNER = "dev-alice";
    vi.mocked(isConnectionTokenStaffAllowed).mockReturnValue(true);
    const resolved = await resolveOwnedStaffSession(token);
    expect(resolved?.username).toBe("dev-alice");
    expect(resolved?.token).toBe(token);
    expect(userStore.createAdmittedUser).toHaveBeenCalled();
  });

  it("rejects matching token when owner missing", async () => {
    process.env.WEBLIFY_CONNECTION_TOKEN = token;
    vi.mocked(isConnectionTokenStaffAllowed).mockReturnValue(true);
    const resolved = await resolveOwnedStaffSession(token);
    expect(resolved).toBeNull();
  });

  it("rejects matching connection token when not allowed", async () => {
    process.env.WEBLIFY_CONNECTION_TOKEN = token;
    process.env.WEBLIFY_CONNECTION_OWNER = "dev-alice";
    vi.mocked(isConnectionTokenStaffAllowed).mockReturnValue(false);
    const resolved = await resolveOwnedStaffSession(token);
    expect(resolved).toBeNull();
  });

  it("rejects wrong token", async () => {
    process.env.WEBLIFY_CONNECTION_TOKEN = token;
    process.env.WEBLIFY_CONNECTION_OWNER = "dev-alice";
    vi.mocked(isConnectionTokenStaffAllowed).mockReturnValue(true);
    const resolved = await resolveOwnedStaffSession("wfy_wrong");
    expect(resolved).toBeNull();
  });
});
