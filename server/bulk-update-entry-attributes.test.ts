import { describe, expect, it } from "vitest";
import { validateBulkEntryAttrUpdates } from "./bulk-update-entry-attributes";

describe("validateBulkEntryAttrUpdates", () => {
  it("allows meta and funnel paths", () => {
    expect(
      validateBulkEntryAttrUpdates([
        { field_path: "meta.robots", value: "index,follow" },
        { field_path: "funnel.stage", value: "decision" },
      ]),
    ).toBeNull();
  });

  it("rejects sections", () => {
    const err = validateBulkEntryAttrUpdates([
      { field_path: "sections.0.title", value: "x" },
    ]);
    expect(err).toMatch(/Disallowed bulk path/);
  });

  it("allows funnel reset", () => {
    expect(
      validateBulkEntryAttrUpdates([{ field_path: "funnel.products", reset: true }]),
    ).toBeNull();
  });

  it("rejects meta reset in bulk", () => {
    const err = validateBulkEntryAttrUpdates([
      { field_path: "meta.robots", reset: true },
    ]);
    expect(err).toMatch(/reset:true is not supported for meta/);
  });
});
