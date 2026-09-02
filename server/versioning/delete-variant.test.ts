import { describe, expect, it } from "vitest";
import {
  isVariantRegisteredInVersioning,
  parseCleanupOrphanFlag,
  pruneVersioningAfterVariantRemove,
  variantTrafficBlock,
  variantTrafficErrorMessage,
} from "./delete-variant.js";

describe("variantTrafficBlock", () => {
  it("blocks when allocation > 0", () => {
    const existing = {
      en: { variants: [{ slug: "draft-v2", allocation: 25 }] },
    };
    expect(variantTrafficBlock(existing, "en", "draft-v2")).toEqual({
      blocked: true,
      allocation: 25,
    });
  });

  it("allows when allocation is 0", () => {
    const existing = {
      en: { variants: [{ slug: "draft-v2", allocation: 0 }] },
    };
    expect(variantTrafficBlock(existing, "en", "draft-v2")).toEqual({ blocked: false });
  });

  it("allows when slug is not in versioning", () => {
    expect(variantTrafficBlock({ en: { variants: [] } }, "en", "draft-v2")).toEqual({
      blocked: false,
    });
  });
});

describe("pruneVersioningAfterVariantRemove", () => {
  it("removes locale key when last variant for locale is gone", () => {
    const existing = {
      en: { variants: [{ slug: "draft", allocation: 0 }] },
      es: { variants: [{ slug: "draft", allocation: 0 }] },
    };
    const { data, isEmpty } = pruneVersioningAfterVariantRemove(existing, "en", "draft");
    expect(data.en).toBeUndefined();
    expect(data.es?.variants).toHaveLength(1);
    expect(isEmpty).toBe(false);
  });

  it("marks empty when no variants remain in any locale", () => {
    const existing = { en: { variants: [{ slug: "draft", allocation: 0 }] } };
    const { data, isEmpty } = pruneVersioningAfterVariantRemove(existing, "en", "draft");
    expect(Object.keys(data)).toHaveLength(0);
    expect(isEmpty).toBe(true);
  });
});

describe("isVariantRegisteredInVersioning", () => {
  it("detects registered slug", () => {
    const existing = { en: { variants: [{ slug: "ab", allocation: 0 }] } };
    expect(isVariantRegisteredInVersioning(existing, "en", "ab")).toBe(true);
    expect(isVariantRegisteredInVersioning(existing, "en", "missing")).toBe(false);
  });
});

describe("parseCleanupOrphanFlag", () => {
  it("reads query and body", () => {
    expect(parseCleanupOrphanFlag("true", undefined)).toBe(true);
    expect(parseCleanupOrphanFlag(undefined, true)).toBe(true);
    expect(parseCleanupOrphanFlag("false", false)).toBe(false);
  });
});

describe("variantTrafficErrorMessage", () => {
  it("includes allocation percent", () => {
    expect(variantTrafficErrorMessage(10)).toContain("10%");
    expect(variantTrafficErrorMessage(10)).toContain("staff member");
  });
});
