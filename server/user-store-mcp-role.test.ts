import { describe, expect, it } from "vitest";
import { allowedToolNames } from "@shared/mcp-tool-catalog";
import {
  BUILT_IN_ROLE_IDS,
  getBuiltInRoleCodeDefinition,
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

describe("platform_steward architecture caps", () => {
  it("includes content_types_manage and databases_manage", () => {
    const role = getBuiltInRoleCodeDefinition("platform_steward");
    expect(role).toBeTruthy();
    const names = new Set(role!.capabilities.map((g) => g.name));
    expect(names.has("content_types_manage")).toBe(true);
    expect(names.has("databases_manage")).toBe(true);
    const tools = new Set(allowedToolNames(role!.capabilities));
    expect(tools.has("update_content_type")).toBe(true);
    expect(tools.has("reindex_database")).toBe(true);
  });
});

describe("hasCapabilityInRole", () => {
  it("denies when the user is not assigned the role", () => {
    // Unknown user has no roles
    expect(hasCapabilityInRole("nobody-xyz-role-test", "user_admin", "seo_edit")).toBe(false);
    expect(userHasRole("nobody-xyz-role-test", "user_admin")).toBe(false);
  });
});
