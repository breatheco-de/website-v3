import { describe, expect, it } from "vitest";
import { isUsVisitor } from "./usVisitor";

describe("isUsVisitor", () => {
  it("uses the picked location's country code", () => {
    expect(isUsVisitor({ selectedLocation: { country_code: "US" } })).toBe(true);
    expect(isUsVisitor({ selectedLocation: { country_code: "CA" }, geo: { country_code: "US" } })).toBe(false);
    expect(isUsVisitor({ selectedLocation: { country_code: "MX" } })).toBe(false);
  });

  it("falls back to the detected session location when nothing is picked", () => {
    expect(isUsVisitor({ sessionLocation: { country_code: "us" } })).toBe(true);
    expect(isUsVisitor({ sessionLocation: { country_code: "CA" } })).toBe(false);
  });

  it("uses the visitor's geo country for remote / unknown locations", () => {
    expect(isUsVisitor({ selectedLocation: { country_code: "XX" }, geo: { country_code: "US" } })).toBe(true);
    expect(isUsVisitor({ selectedLocation: { country_code: "XX" }, geo: { country_code: "CO" } })).toBe(false);
    expect(isUsVisitor({ sessionLocation: { country_code: "XX" }, geo: { country_code: "US" } })).toBe(true);
  });

  it("is false with no location and no geo", () => {
    expect(isUsVisitor({})).toBe(false);
    expect(isUsVisitor({ sessionLocation: null, geo: {} })).toBe(false);
  });
});
