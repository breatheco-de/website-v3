import { describe, expect, it } from "vitest";
import {
  BUILT_IN_ROLE_IDS,
  clearBuiltInRoleDescription,
  getBuiltInDescriptionOverrides,
  getBuiltInRoleCodeDefinition,
  getRole,
  hasBuiltInDescriptionOverride,
  setBuiltInRoleDescription,
} from "./user-store";

describe("built-in role code definitions", () => {
  it("ships code defaults for every built-in id", () => {
    for (const id of BUILT_IN_ROLE_IDS) {
      const def = getBuiltInRoleCodeDefinition(id);
      expect(def, id).toBeTruthy();
      expect(def!.description?.trim().length, id).toBeGreaterThan(20);
      expect(def!.capabilities.length, id).toBeGreaterThan(0);
    }
  });
});

describe("built-in MCP description overrides", () => {
  const roleId = "metrics_viewer";

  it("persists override and exposes it via getRole", () => {
    const before = getRole(roleId)?.description;
    const custom =
      "Read-only metrics dashboards and error logs. Use for triage and reporting — not for running diagnostics jobs, editing SEO, or changing tracking settings. Prefer platform_steward when you need to fix issues.";

    const set = setBuiltInRoleDescription(roleId, custom);
    expect(set.ok).toBe(true);
    expect(getRole(roleId)?.description).toBe(custom);
    expect(hasBuiltInDescriptionOverride(roleId)).toBe(true);
    expect(getBuiltInDescriptionOverrides()[roleId]).toBe(custom);

    const cleared = clearBuiltInRoleDescription(roleId);
    expect(cleared.ok).toBe(true);
    expect(getRole(roleId)?.description).toBe(before);
    expect(hasBuiltInDescriptionOverride(roleId)).toBe(false);
  });

  it("rejects empty descriptions", () => {
    const result = setBuiltInRoleDescription(roleId, "   ");
    expect(result.ok).toBe(false);
  });
});
