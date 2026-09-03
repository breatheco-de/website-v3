import { describe, expect, it } from "vitest";
import {
  assertUniqueIssueCodes,
  getIssueCodeDefinition,
  resolveIssueSuggestion,
} from "./issueCodeRegistry";
import { listValidators } from "../validators";

describe("issueCodeRegistry", () => {
  it("looks up ORPHAN_PAGE and PARTIALLY_SET_CLUSTER under seo-cluster", () => {
    const orphan = getIssueCodeDefinition("seo-cluster", "ORPHAN_PAGE");
    expect(orphan?.title).toBe("Unclustered page");
    expect(orphan?.suggestion).toMatch(/Prefer joining an existing hub/);
    expect(orphan?.next_actions?.some((a) => a.tool === "list_seo_clusters")).toBe(true);

    const partial = getIssueCodeDefinition("seo-cluster", "PARTIALLY_SET_CLUSTER");
    expect(partial?.title).toBe("Partially set cluster");
    expect(partial?.summary).toMatch(/main_keyword/);
  });

  it("resolveIssueSuggestion prefers instance override", () => {
    expect(resolveIssueSuggestion("seo-cluster", "ORPHAN_PAGE", "Custom fix")).toBe("Custom fix");
    expect(resolveIssueSuggestion("seo-cluster", "ORPHAN_PAGE", "  ")).toMatch(/Prefer joining/);
    expect(resolveIssueSuggestion("seo-cluster", "ORPHAN_PAGE")).toMatch(/Prefer joining/);
    expect(resolveIssueSuggestion("seo-cluster", "UNKNOWN_CODE")).toBeUndefined();
  });

  it("assertUniqueIssueCodes passes for the registry", () => {
    expect(() => assertUniqueIssueCodes()).not.toThrow();
  });

  it("listValidators includes seo-cluster issueCodes", () => {
    const seo = listValidators().find((v) => v.name === "seo-cluster");
    expect(seo?.issueCodes?.ORPHAN_PAGE).toBeDefined();
    expect(seo?.issueCodes?.PARTIALLY_SET_CLUSTER).toBeDefined();
  });
});
