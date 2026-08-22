import { describe, it, expect } from "vitest";
import {
  isCommonOperationalOnly,
  resolveMicroValidationFlags,
  shouldSkipLiveGate,
} from "./validationScope";

describe("validationScope", () => {
  it("skips gate for locations-only micro writes", () => {
    expect(shouldSkipLiveGate("micro", ["locations"])).toBe(true);
    expect(isCommonOperationalOnly(["locations"])).toBe(true);
  });

  it("skips gate for empty touched paths on micro (structural / unspecified)", () => {
    expect(shouldSkipLiveGate("micro", [])).toBe(true);
    const flags = resolveMicroValidationFlags({ intent: "micro", touchedPaths: [] });
    expect(flags.runFull).toBe(false);
    expect(flags.runSchemaOrgCompanion).toBe(false);
    expect(flags.metaKeys).toEqual([]);
    expect(flags.bodyKeys).toEqual([]);
  });

  it("visibility-only micro write skips meta validation", () => {
    const flags = resolveMicroValidationFlags({
      intent: "micro",
      touchedPaths: ["meta.robots"],
    });
    expect(flags.metaKeys).toEqual([]);
    expect(flags.bodyKeys).toEqual([]);
    expect(flags.runSchemaOrgCompanion).toBe(false);
  });

  it("publish runs full validation even with empty touched paths", () => {
    expect(shouldSkipLiveGate("publish", [])).toBe(false);
    const flags = resolveMicroValidationFlags({ intent: "publish", touchedPaths: [] });
    expect(flags.runFull).toBe(true);
    expect(flags.metaKeys).toBeNull();
    expect(flags.runSchemaOrgCompanion).toBe(true);
    expect(flags.runClusterLinks).toBe(true);
  });
});
