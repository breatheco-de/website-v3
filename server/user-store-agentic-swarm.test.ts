import { describe, expect, it } from "vitest";
import { allowedToolNames } from "@shared/mcp-tool-catalog";
import {
  AGENTIC_SWARM_ROLE_IDS,
  AGENTIC_SWARM_ROLES_BY_ID,
  isAgenticSwarmRoleId,
} from "@shared/agentic-swarm-roles";
import {
  deleteRole,
  ensureAgenticSwarmRoles,
  getRole,
  type RoleDefinition,
} from "./user-store";

describe("agentic swarm roles", () => {
  it("marks pack ids as agentic swarm roles", () => {
    expect(isAgenticSwarmRoleId("swarm_orchestrator")).toBe(true);
    expect(isAgenticSwarmRoleId("user_admin")).toBe(false);
  });

  it("seeds missing agentic roles and skips non-agentic id collisions", () => {
    const roles: Record<string, RoleDefinition> = {
      copy_editor: {
        label: "Staff copy",
        description: "Custom staff role that reused the id",
        capabilities: [{ name: "content_view", contentTypes: ["blog"] }],
      },
    };
    const created = ensureAgenticSwarmRoles(roles);
    expect(created).toBe(true);
    expect(roles.swarm_orchestrator?.agentic).toBe(true);
    expect(roles.copy_editor?.agentic).toBeUndefined();
    expect(roles.copy_editor?.label).toBe("Staff copy");
    expect(roles.publisher?.agentic).toBe(true);
  });

  it("refreshes caps for existing agentic roles without reporting create", () => {
    const roles: Record<string, RoleDefinition> = {};
    expect(ensureAgenticSwarmRoles(roles)).toBe(true);
    roles.seo_specialist = {
      ...roles.seo_specialist!,
      capabilities: [{ name: "metrics_view" }],
      agentic: true,
    };
    expect(ensureAgenticSwarmRoles(roles)).toBe(false);
    const names = new Set(roles.seo_specialist!.capabilities.map((g) => g.name));
    expect(names.has("seo_edit")).toBe(true);
    expect(names.has("content_view")).toBe(true);
  });

  it("loads seeded agentic roles from the store with non-empty descriptions", () => {
    for (const id of AGENTIC_SWARM_ROLE_IDS) {
      const role = getRole(id);
      expect(role, id).toBeTruthy();
      expect(role!.agentic, id).toBe(true);
      expect(role!.description?.trim().length, id).toBeGreaterThan(10);
    }
  });

  it("refuses delete of agentic swarm roles", () => {
    const result = deleteRole("swarm_orchestrator");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/agentic swarm/i);
    expect(getRole("swarm_orchestrator")?.agentic).toBe(true);
  });

  it("exposes a sensible tool palette for each pack role", () => {
    for (const id of AGENTIC_SWARM_ROLE_IDS) {
      const def = AGENTIC_SWARM_ROLES_BY_ID[id];
      const tools = allowedToolNames(def.capabilities);
      expect(tools.length, id).toBeGreaterThan(0);
      expect(tools).toContain("get_current_user");
    }
    const orch = allowedToolNames(AGENTIC_SWARM_ROLES_BY_ID.swarm_orchestrator.capabilities);
    expect(orch).not.toContain("update_fields");
    expect(orch).toContain("list_entries");

    const pub = allowedToolNames(AGENTIC_SWARM_ROLES_BY_ID.publisher.capabilities);
    expect(pub).toContain("publish_draft");
    expect(pub).toContain("promote_variant");
  });
});
