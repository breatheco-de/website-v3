import { describe, expect, it } from "vitest";
import {
  containsLegacySingleVar,
  findLegacySingleVarPaths,
  formatEntryTemplateExpr,
  getLegacySingleVarWriteError,
  rewriteSingleVarsToEntryInString,
} from "./entryTemplateVars";

describe("entryTemplateVars", () => {
  it("formats entry expressions", () => {
    expect(formatEntryTemplateExpr("title", "Blog")).toBe("{{ entry.title | Blog }}");
    expect(formatEntryTemplateExpr("title")).toBe("{{ entry.title }}");
  });

  it("rewrites single to entry in strings", () => {
    expect(rewriteSingleVarsToEntryInString("{{ single.title | x }}")).toBe(
      "{{ entry.title | x }}",
    );
    expect(rewriteSingleVarsToEntryInString("Hi {{  single.name }}")).toBe(
      "Hi {{  entry.name }}",
    );
  });

  it("detects legacy single vars", () => {
    expect(containsLegacySingleVar("{{ entry.title }}")).toBe(false);
    expect(containsLegacySingleVar("{{ single.title }}")).toBe(true);
    expect(findLegacySingleVarPaths({ a: "{{ single.x }}" })).toEqual(["a"]);
    expect(getLegacySingleVarWriteError({ a: "{{ single.x }}" })).toMatch(/entry\.\*/);
    expect(getLegacySingleVarWriteError({ a: "{{ entry.x }}" })).toBeNull();
  });
});
