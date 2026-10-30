import { describe, expect, it } from "vitest";
import { allowedToolNames } from "@shared/mcp-tool-catalog";
import { AGENTIC_SWARM_ROLES_BY_ID } from "@shared/agentic-swarm-roles";
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
  it("platform_steward includes content_types_manage, databases_manage, and press_mentions row edits", () => {
    const role = getBuiltInRoleCodeDefinition("platform_steward");
    expect(role).toBeTruthy();
    const names = new Set(role!.capabilities.map((g) => g.name));
    expect(names.has("content_types_manage")).toBe(true);
    expect(names.has("databases_manage")).toBe(true);
    expect(names.has("databases_view")).toBe(true);
    expect(role!.capabilities.find((g) => g.name === "databases_edit_data")).toEqual({
      name: "databases_edit_data",
      databases: ["press_mentions"],
    });
    const tools = new Set(allowedToolNames(role!.capabilities));
    expect(tools.has("update_content_type")).toBe(true);
    expect(tools.has("reindex_database")).toBe(true);
    expect(tools.has("create_or_update_database")).toBe(true);
    expect(tools.has("list_databases")).toBe(true);
    expect(tools.has("list_database_items")).toBe(true);
    expect(tools.has("get_database_item")).toBe(true);
    expect(tools.has("add_database_item")).toBe(true);
    expect(tools.has("update_database_item")).toBe(true);
    expect(tools.has("delete_database_item")).toBe(true);
  });

  it("platform_steward covers every News Editor capability", () => {
    const steward = getBuiltInRoleCodeDefinition("platform_steward")!.capabilities;
    const newsEditor = [
      { name: "databases_edit_data", databases: ["press_mentions"] },
      { name: "databases_view" },
      { name: "content_view", contentTypes: "*" },
    ];
    for (const grant of newsEditor) expect(steward).toContainEqual(grant);
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

describe("databases_view roles", () => {
  const DB_READ_TOOLS = ["list_databases", "list_database_items", "get_database_item"];
  const DB_WRITE_TOOLS = [
    "add_database_item",
    "add_database_items",
    "update_database_item",
    "update_database_items",
    "delete_database_item",
    "create_or_update_database",
    "reindex_database",
  ];

  const roleCaps: Array<[string, () => Array<{ name: string }> | undefined]> = [
    ["content_viewer", () => getBuiltInRoleCodeDefinition("content_viewer")?.capabilities],
    ...(["copy_editor", "seo_specialist", "translator", "proposal_reviewer"] as const).map(
      (id) =>
        [id, () => AGENTIC_SWARM_ROLES_BY_ID[id].capabilities] as [
          string,
          () => Array<{ name: string }>,
        ],
    ),
  ];

  it.each(roleCaps)("%s can read databases but not change them", (_id, getCaps) => {
    const caps = getCaps();
    expect(caps?.some((g) => g.name === "databases_view")).toBe(true);
    const tools = new Set(allowedToolNames(caps as Parameters<typeof allowedToolNames>[0]));
    for (const t of DB_READ_TOOLS) expect(tools.has(t), t).toBe(true);
    for (const t of DB_WRITE_TOOLS) expect(tools.has(t), t).toBe(false);
  });

  it("other agentic roles do not get databases_view", () => {
    for (const id of ["swarm_orchestrator", "layout_editor", "media_editor", "publisher"] as const) {
      expect(
        AGENTIC_SWARM_ROLES_BY_ID[id].capabilities.some((g) => g.name === "databases_view"),
        id,
      ).toBe(false);
    }
  });
});

describe("hasCapabilityInRole", () => {
  it("denies when the user is not assigned the role", () => {
    // Unknown user has no roles
    expect(hasCapabilityInRole("nobody-xyz-role-test", "user_admin", "seo_edit")).toBe(false);
    expect(userHasRole("nobody-xyz-role-test", "user_admin")).toBe(false);
  });
});
