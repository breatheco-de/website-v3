import { describe, expect, it } from "vitest";
import { isVariableOverridden, otherLocationDiffs } from "./variable-badges";
import type { VariableDefinition } from "./variable-manager";

const defs: Record<string, VariableDefinition> = {
  "global.phone": {
    default: "+1 default",
    conditions: [
      { query: { location: "madrid-spain" }, value: "+34 madrid" },
      { query: { location: "downtown-miami" }, value: "+1 miami" },
      { query: { locale: "es" }, value: "tel ES" },
      { query: { region: "europe" }, value: "tel EU" },
    ],
  },
};

describe("isVariableOverridden", () => {
  it("is false when default wins", () => {
    expect(
      isVariableOverridden(defs["global.phone"], "global.phone", defs, {
        location: "unknown-city",
        locale: "en",
      }),
    ).toBe(false);
  });

  it("is true when a condition matches", () => {
    expect(
      isVariableOverridden(defs["global.phone"], "global.phone", defs, {
        location: "madrid-spain",
        locale: "en",
      }),
    ).toBe(true);
  });
});

describe("otherLocationDiffs", () => {
  it("lists location conditions that differ from the resolved value", () => {
    const diffs = otherLocationDiffs(defs["global.phone"], "+1 miami");
    expect(diffs).toEqual([
      { location: "madrid-spain", value: "+34 madrid" },
    ]);
  });

  it("returns empty when no location diffs", () => {
    expect(otherLocationDiffs({ default: "x" }, "x")).toEqual([]);
  });
});
