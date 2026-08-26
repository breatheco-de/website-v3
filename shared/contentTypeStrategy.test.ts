import { describe, it, expect } from "vitest";
import {
  parseContentTypeStrategy,
  isValidContentTypeStrategy,
  assertEditorRequiredHasStrategy,
  assertCanClearStrategy,
} from "@shared/contentTypeStrategy";

describe("contentTypeStrategy", () => {
  it("parses valid strategy and rejects incomplete", () => {
    expect(
      parseContentTypeStrategy({
        purpose: "Educational blog posts",
        constraints: ["Prefer clusters"],
      }),
    ).toEqual({
      purpose: "Educational blog posts",
      constraints: ["Prefer clusters"],
    });
    expect(isValidContentTypeStrategy({ purpose: "" })).toBe(false);
    expect(isValidContentTypeStrategy({ purpose: "  ok  " })).toBe(true);
    expect(isValidContentTypeStrategy(null)).toBe(false);
  });

  it("assertEditorRequiredHasStrategy allows optional fields without strategy", () => {
    expect(
      assertEditorRequiredHasStrategy(null, {
        title: { required: false },
      }),
    ).toEqual({ ok: true });
    expect(assertEditorRequiredHasStrategy(null, {})).toEqual({ ok: true });
  });

  it("assertEditorRequiredHasStrategy rejects required without strategy", () => {
    const r = assertEditorRequiredHasStrategy(null, {
      title: { required: true },
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("missing_strategy");
  });

  it("assertEditorRequiredHasStrategy accepts required with strategy", () => {
    expect(
      assertEditorRequiredHasStrategy(
        { purpose: "SEO educational posts" },
        { title: { required: true }, faq: { required: "attached" } },
      ),
    ).toEqual({ ok: true });
  });

  it("assertCanClearStrategy blocks clear when required fields remain", () => {
    const r = assertCanClearStrategy({ title: { required: true } });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe("missing_strategy");
    expect(assertCanClearStrategy({ title: {} }).ok).toBe(true);
  });
});
