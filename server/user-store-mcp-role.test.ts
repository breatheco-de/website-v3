import { describe, expect, it } from "vitest";
import {
  BUILT_IN_ROLE_IDS,
  getRole,
  hasCapabilityInRole,
  userHasRole,
} from "./user-store";

describe("built-in MCP role descriptions", () => {
  it("ships non-empty agent-facing descriptions for built-ins", () => {
    for (const id of BUILT_IN_ROLE_IDS) {
      const role = getRole(id);
      expect(role, id).toBeTruthy();
      expect(role!.description?.trim().length, id).toBeGreaterThan(20);
    }
  });
});

describe("hasCapabilityInRole", () => {
  it("denies when the user is not assigned the role", () => {
    // Unknown user has no roles
    expect(hasCapabilityInRole("nobody-xyz-role-test", "webmaster", "seo_edit")).toBe(false);
    expect(userHasRole("nobody-xyz-role-test", "webmaster")).toBe(false);
  });
});
