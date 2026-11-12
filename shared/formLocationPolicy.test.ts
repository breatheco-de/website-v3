import { describe, expect, it } from "vitest";
import {
  checkLocationNames,
  formOwnLocation,
  formPageLocationMismatch,
  formSetsLocation,
  pageLocationValues,
  parseFormLocationPolicy,
  resolveFormLocationSource,
  splitLocationValues,
} from "./formLocationPolicy";

const policy = { entryField: "locations", autodetect: false };

describe("parseFormLocationPolicy", () => {
  it("returns null when the content type has not opted in", () => {
    expect(parseFormLocationPolicy({})).toBeNull();
    expect(parseFormLocationPolicy({ forms: {} })).toBeNull();
  });
  it("reads entry_field and autodetect (default true)", () => {
    expect(parseFormLocationPolicy({ forms: { location: { entry_field: "locations" } } })).toEqual({
      entryField: "locations",
      autodetect: true,
    });
    expect(parseFormLocationPolicy({ forms: { location: { autodetect: false } } })).toEqual({
      entryField: null,
      autodetect: false,
    });
  });
});

describe("formOwnLocation", () => {
  it("ignores auto and empty defaults", () => {
    expect(formOwnLocation({ fields: { location: { default: "auto" } } })).toBeNull();
    expect(formOwnLocation({ fields: { location: { default: "" } } })).toBeNull();
    expect(formOwnLocation({ fields: {} })).toBeNull();
    expect(formSetsLocation(null)).toBe(false);
  });
  it("reads a fixed default, an allowed list and a visible required picker", () => {
    expect(formOwnLocation({ fields: { location: { default: "miami-usa" } } })).toEqual({
      mode: "fixed",
      values: ["miami-usa"],
    });
    expect(formOwnLocation({ fields: { location: { allowed: ["madrid-spain", "barcelona-spain"] } } })).toEqual({
      mode: "allowed",
      values: ["madrid-spain", "barcelona-spain"],
    });
    expect(formOwnLocation({ fields: { location: { visible: true, required: true } } })).toEqual({
      mode: "picker",
      values: [],
    });
    expect(formOwnLocation({ fields: { location: { visible: true, default: "miami-usa", allowed: ["a", "b"] } } })).toEqual({
      mode: "picker",
      values: ["a", "b"],
    });
  });
  it("treats a variable that became a list as several fixed values", () => {
    expect(formOwnLocation({ fields: { location: { default: ["lima-peru", "quito-ecuador"] } } })).toEqual({
      mode: "fixed",
      values: ["lima-peru", "quito-ecuador"],
    });
  });
});

describe("pageLocationValues", () => {
  it("reads pointers and hydrated objects", () => {
    expect(pageLocationValues({ locations: ["a", "b"] }, "locations")).toEqual(["a", "b"]);
    expect(pageLocationValues({ locations: [{ slug: "a" }] }, "locations")).toEqual(["a"]);
    expect(pageLocationValues({ locations: "a" }, "locations")).toEqual(["a"]);
    expect(pageLocationValues({}, "locations")).toEqual([]);
    expect(pageLocationValues({ locations: ["a"] }, null)).toEqual([]);
  });
});

describe("resolveFormLocationSource", () => {
  it("form beats page", () => {
    const r = resolveFormLocationSource({
      form: { fields: { location: { default: "miami-usa" } } },
      entry: { locations: ["madrid-spain"] },
      policy,
    });
    expect(r.layer).toBe("form");
    expect(r.locations).toEqual(["miami-usa"]);
  });
  it("uses the page when the form does not set one", () => {
    const r = resolveFormLocationSource({ form: {}, entry: { locations: ["madrid-spain"] }, policy });
    expect(r).toEqual({ layer: "entry", locations: ["madrid-spain"], own: null });
  });
  it("detects only when allowed", () => {
    expect(resolveFormLocationSource({ form: {}, entry: {}, policy }).layer).toBe("missing");
    expect(
      resolveFormLocationSource({ form: {}, entry: {}, policy: { ...policy, autodetect: true } }).layer,
    ).toBe("autodetect");
    expect(resolveFormLocationSource({ form: {}, entry: { locations: ["x"] }, policy: null }).layer).toBe(
      "autodetect",
    );
  });
});

describe("checkLocationNames", () => {
  const index = { known: new Set(["madrid-spain", "old-campus"]), hidden: new Set(["old-campus"]) };
  it("splits unknown and hidden names, skipping unresolved variables", () => {
    expect(checkLocationNames(["madrid-spain", "barcelona-espana", "old-campus", "{{ entry.x }}"], index)).toEqual({
      unknown: ["barcelona-espana"],
      hidden: ["old-campus"],
    });
  });
});

describe("splitLocationValues / mismatch", () => {
  it("splits comma lists and keeps unresolved variables whole", () => {
    expect(splitLocationValues("a, b")).toEqual(["a", "b"]);
    expect(splitLocationValues("{{ global.x }}")).toEqual(["{{ global.x }}"]);
  });
  it("flags a form value outside the page list", () => {
    expect(formPageLocationMismatch(["miami-usa"], ["madrid-spain"])).toBe(true);
    expect(formPageLocationMismatch(["madrid-spain"], ["madrid-spain", "x"])).toBe(false);
    expect(formPageLocationMismatch([], ["madrid-spain"])).toBe(false);
  });
});
