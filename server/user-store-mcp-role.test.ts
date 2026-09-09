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
  it("platform_steward includes content_types_manage and databases_manage without row mutators", () => {
    const role = getBuiltInRoleCodeDefinition("platform_steward");
    expect(role).toBeTruthy();
    const names = new Set(role!.capabilities.map((g) => g.name));
    expect(names.has("content_types_manage")).toBe(true);
    expect(names.has("databases_manage")).toBe(true);
    expect(names.has("databases_edit_data")).toBe(false);
    const tools = new Set(allowedToolNames(role!.capabilities));
    expect(tools.has("update_content_type")).toBe(true);
    expect(tools.has("reindex_database")).toBe(true);
    expect(tools.has("create_or_update_database")).toBe(true);
    expect(tools.has("list_databases")).toBe(true);
    expect(tools.has("list_database_items")).toBe(true);
    expect(tools.has("get_database_item")).toBe(true);
    // databases_manage does not authorize row mutators
    expect(tools.has("add_database_item")).toBe(false);
    expect(tools.has("update_database_item")).toBe(false);
    expect(tools.has("delete_database_item")).toBe(false);
  });

  it("databases_edit_data role catalog includes item mutators not create_or_update", () => {
    const tools = new Set(
      allowedToolNames([{ name: "databases_edit_data", databases: ["faq"] }]),
    );
    expect(tools.has("add_database_item")).toBe(true);
    expect(tools.has("update_database_items")).toBe(true);
    expect(tools.has("delete_database_item")).toBe(true);
    expect(tools.has("create_or_update_database")).toBe(false);
    expect(tools.has("reindex_database")).toBe(false);
  });
});

describe("hasCapabilityInRole", () => {
  it("denies when the user is not assigned the role", () => {
    // Unknown user has no roles
    expect(hasCapabilityInRole("nobody-xyz-role-test", "user_admin", "seo_edit")).toBe(false);
    expect(userHasRole("nobody-xyz-role-test", "user_admin")).toBe(false);
  });
});
