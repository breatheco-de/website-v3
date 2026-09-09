import { describe, expect, it } from "vitest";
import {
  planDatabaseConfigPatch,
  vectorSearchPatchNeedsReindex,
} from "./database-config-patch";

const baseConfig = {
  name: "FAQ",
  source: { type: "local", local: { filename: "items.yml", results_path: "items" } },
  vector_search: { enabled: false, fields: ["question"] },
};

describe("planDatabaseConfigPatch", () => {
  it("returns preview mode when confirm is omitted or false", () => {
    const patch = { description: "Updated FAQ bank" };
    for (const confirm of [undefined, false] as const) {
      const plan = planDatabaseConfigPatch(baseConfig, patch, confirm);
      expect(plan.ok).toBe(true);
      if (!plan.ok) return;
      expect(plan.mode).toBe("preview");
      expect(plan.patch_keys).toEqual(["description"]);
      expect(plan.merged).toMatchObject({ name: "FAQ", description: "Updated FAQ bank" });
      expect(plan.beforeSummary.source_type).toBe("local");
      expect(plan.afterSummary.name).toBe("FAQ");
      expect(plan.needsReindex).toBe(false);
    }
  });

  it("returns apply mode only when confirm is true", () => {
    const plan = planDatabaseConfigPatch(baseConfig, { description: "x" }, true);
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.mode).toBe("apply");
    expect(plan.merged.description).toBe("x");
  });

  it("deep-merges nested source without dropping local filename", () => {
    const plan = planDatabaseConfigPatch(
      baseConfig,
      { source: { type: "local", local: { results_path: "rows" } } },
      true,
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.merged.source).toEqual({
      type: "local",
      local: { filename: "items.yml", results_path: "rows" },
    });
  });

  it("rejects merged config missing name or source", () => {
    const badName = planDatabaseConfigPatch(
      { source: { type: "local" } },
      { description: "x" },
      true,
    );
    expect(badName).toEqual({
      ok: false,
      code: "invalid_merged_config",
      message: "Merged config must include name and source.",
    });

    const wipeSource = planDatabaseConfigPatch(baseConfig, { source: null as unknown as object }, true);
    expect(wipeSource.ok).toBe(false);
  });

  it("flags needsReindex when vector_search becomes enabled", () => {
    const plan = planDatabaseConfigPatch(
      baseConfig,
      { vector_search: { enabled: true, fields: ["question", "answer"] } },
      false,
    );
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.mode).toBe("preview");
    expect(plan.needsReindex).toBe(true);
    expect(plan.afterSummary.vector_search).toEqual({
      enabled: true,
      fields: ["question", "answer"],
    });
  });
});

describe("vectorSearchPatchNeedsReindex", () => {
  it("is false when vector_search is unchanged", () => {
    expect(vectorSearchPatchNeedsReindex(baseConfig, { description: "x" }, baseConfig)).toBe(false);
  });

  it("is false when vector_search is disabled after patch", () => {
    const before = { ...baseConfig, vector_search: { enabled: true, fields: ["q"] } };
    const patch = { vector_search: { enabled: false, fields: ["q"] } };
    const merged = { ...before, ...patch };
    expect(vectorSearchPatchNeedsReindex(before, patch, merged)).toBe(false);
  });
});
