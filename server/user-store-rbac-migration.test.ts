import { describe, expect, it } from "vitest";
import {
  migrateWebmasterToUserAdmin,
  type RoleDefinition,
  type UserRecord,
} from "./user-store";

describe("migrateWebmasterToUserAdmin", () => {
  it("replaces webmaster with user_admin on users and pending invites", () => {
    const users: Record<string, UserRecord> = {
      alice: {
        id: "alice",
        username: "alice",
        roles: ["webmaster", "metrics_viewer"],
      },
      bob: {
        id: "bob",
        username: "bob",
        roles: ["webmaster", "user_admin"],
      },
    };
    const roles: Record<string, RoleDefinition> = {
      webmaster: { label: "Legacy", capabilities: [] },
      metrics_viewer: { label: "Metrics", capabilities: [{ name: "metrics_view" }] },
    };
    const pendingUsers = {
      "new@test.com": { email: "new@test.com", role: "webmaster", createdAt: "2026-01-01" },
    };

    expect(migrateWebmasterToUserAdmin(users, roles, pendingUsers)).toBe(true);
    expect(users.alice.roles).toEqual(["metrics_viewer", "user_admin"]);
    expect(users.bob.roles).toEqual(["user_admin"]);
    expect(pendingUsers["new@test.com"].role).toBe("user_admin");
    expect(roles.webmaster).toBeUndefined();
    expect(migrateWebmasterToUserAdmin(users, roles, pendingUsers)).toBe(false);
  });
});
