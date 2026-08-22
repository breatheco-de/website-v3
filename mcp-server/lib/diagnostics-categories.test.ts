import { describe, expect, it } from "vitest";
import {
  mcpValidatorsFromCategories,
  validatorNamesForCategories,
} from "./diagnostics-categories";

describe("diagnostics-categories", () => {
  it("maps seo category to known seo validators including seo-cluster and seo-cluster-links", () => {
    const names = validatorNamesForCategories(["seo"]);
    expect(names).toContain("seo-cluster");
    expect(names).toContain("seo-cluster-links");
    expect(names).toContain("meta");
    expect(names).not.toContain("redirects");
  });

  it("mcpValidatorsFromCategories returns undefined when categories omitted", () => {
    expect(mcpValidatorsFromCategories(undefined)).toBeUndefined();
    expect(mcpValidatorsFromCategories([])).toBeUndefined();
  });

  it("mcpValidatorsFromCategories returns seo set when categories is seo", () => {
    const names = mcpValidatorsFromCategories(["seo"]);
    expect(names).toBeDefined();
    expect(names!.length).toBeGreaterThan(0);
    expect(names).toContain("seo-cluster");
  });
});
