import { describe, expect, it } from "vitest";
import {
  assertUniqueIssueCodes,
  getIssueCodeDefinition,
  isIssueCodeAgentGuidanceComplete,
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

  it("supports title-only definitions without summary", () => {
    const def = getIssueCodeDefinition("seo-cluster", "DUPLICATE_PILLAR");
    expect(def?.title).toBe("Duplicate hub path");
    expect(def?.summary).toBeUndefined();
    expect(def?.next_actions).toBeUndefined();
  });

  it("isIssueCodeAgentGuidanceComplete requires non-empty next_actions", () => {
    expect(isIssueCodeAgentGuidanceComplete(undefined)).toBe(false);
    expect(
      isIssueCodeAgentGuidanceComplete({
        title: "Only title",
      }),
    ).toBe(false);
    expect(
      isIssueCodeAgentGuidanceComplete({
        title: "Empty actions",
        next_actions: [],
      }),
    ).toBe(false);
    expect(
      isIssueCodeAgentGuidanceComplete(getIssueCodeDefinition("seo-cluster", "ORPHAN_PAGE")),
    ).toBe(true);
    expect(
      isIssueCodeAgentGuidanceComplete(getIssueCodeDefinition("seo-cluster", "DUPLICATE_PILLAR")),
    ).toBe(false);
  });

  it("looks up FIELD_JSON_INVALID under editor-field-types", () => {
    const def = getIssueCodeDefinition("editor-field-types", "FIELD_JSON_INVALID");
    expect(def?.title).toBe("Invalid JSON field");
    expect(isIssueCodeAgentGuidanceComplete(def)).toBe(false);
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

  it("listValidators includes seo-cluster and editor-field-types issueCodes", () => {
    const seo = listValidators().find((v) => v.name === "seo-cluster");
    expect(seo?.issueCodes?.ORPHAN_PAGE).toBeDefined();
    expect(seo?.issueCodes?.PARTIALLY_SET_CLUSTER).toBeDefined();
    const editor = listValidators().find((v) => v.name === "editor-field-types");
    expect(editor?.issueCodes?.FIELD_JSON_INVALID?.title).toBe("Invalid JSON field");
  });
});
