import { describe, expect, it, vi } from "vitest";

vi.mock("./component-registry", () => ({
  loadAllFieldEditors: () => ({ hero: { form: "form-settings" } }),
}));
vi.mock("./content-types", () => ({ getContentTypeConfig: () => undefined }));
vi.mock("./location-catalog", () => ({
  locationNameIndex: () => ({ known: new Set<string>(), hidden: new Set<string>() }),
}));

import {
  FORM_LOCATION_HIDDEN_CODE,
  FORM_LOCATION_MISMATCH_CODE,
  FORM_LOCATION_MISSING_CODE,
  FORM_LOCATION_UNKNOWN_CODE,
  editTouchesFormLocation,
  runFormLocationGate,
} from "./form-location-gate";

const index = {
  known: new Set(["madrid-spain", "barcelona-spain", "miami-usa", "old-campus"]),
  hidden: new Set(["old-campus"]),
};
const policy = { entryField: "locations", autodetect: false };
const page = (form: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  ...extra,
  sections: [{ type: "text" }, { type: "hero", form }],
});
const run = (pageData: Record<string, unknown>, p: typeof policy | null = policy) =>
  runFormLocationGate({ pageData, contentType: "landing", policy: p, index });

describe("runFormLocationGate", () => {
  it("passes when the page sets a real location", () => {
    const r = run(page({}, { locations: ["madrid-spain"] }));
    expect(r.errors).toEqual([]);
    expect(r.formSectionIndexes).toEqual([1]);
  });

  it("blocks a form with no location when detection is off", () => {
    const r = run(page({}));
    expect(r.errors.map((e) => e.code)).toEqual([FORM_LOCATION_MISSING_CODE]);
    expect(r.errors[0]!.property_path).toBe("sections[1].form.fields.location");
  });

  it("allows detection when the content type has not opted in or allows it", () => {
    expect(run(page({}), null).errors).toEqual([]);
    expect(run(page({}), { ...policy, autodetect: true }).errors).toEqual([]);
  });

  it("reports wrong names on the page and on the form, and hidden campuses as warnings", () => {
    const r = run(
      page({ fields: { location: { default: "downtown-miami" } } }, { locations: ["barcelona-espana", "old-campus"] }),
    );
    expect(r.errors.map((e) => [e.code, e.values])).toEqual([
      [FORM_LOCATION_UNKNOWN_CODE, ["barcelona-espana"]],
      [FORM_LOCATION_UNKNOWN_CODE, ["downtown-miami"]],
    ]);
    expect(r.warnings.map((w) => w.code)).toContain(FORM_LOCATION_HIDDEN_CODE);
  });

  it("checks wrong form names even without forms.location", () => {
    expect(run(page({ fields: { location: { default: "nowhere" } } }), null).errors[0]!.code).toBe(
      FORM_LOCATION_UNKNOWN_CODE,
    );
  });

  it("fills in {{ entry.* }} before checking", () => {
    const r = run(page({ fields: { location: { default: "{{ entry.campus }}" } } }, { campus: "miami-usa" }));
    expect(r.errors).toEqual([]);
  });

  it("warns when the form overrides the page with a different location", () => {
    const r = run(page({ fields: { location: { default: "miami-usa" } } }, { locations: ["madrid-spain"] }));
    expect(r.errors).toEqual([]);
    expect(r.warnings.map((w) => w.code)).toEqual([FORM_LOCATION_MISMATCH_CODE]);
  });
});

describe("editTouchesFormLocation", () => {
  const gate = run(page({}));
  it("detects edits to form sections and the page field", () => {
    expect(editTouchesFormLocation(gate, { paths: [], sectionIndexes: new Set([1]) })).toBe(true);
    expect(editTouchesFormLocation(gate, { paths: [], sectionIndexes: new Set([0]) })).toBe(false);
    expect(editTouchesFormLocation(gate, { paths: ["locations"], sectionIndexes: new Set() })).toBe(true);
    expect(editTouchesFormLocation(gate, { paths: ["meta.title"], sectionIndexes: new Set() })).toBe(false);
    expect(editTouchesFormLocation(gate, { paths: [], sectionIndexes: null })).toBe(true);
  });
});
