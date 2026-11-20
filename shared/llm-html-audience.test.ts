import { describe, expect, it } from "vitest";
import {
  describeSectionAudience,
  expandLlmVariableString,
  HIDDEN_LOCATION_SENTINEL,
  sectionsBranchForLlm,
  type LlmLocationCatalog,
} from "./llm-html-audience";

const catalog: LlmLocationCatalog = {
  regionOf(slug) {
    if (slug.endsWith("-mexico") || slug.endsWith("-colombia") || slug === "lima-peru" || slug === "santiago-chile" || slug === "quito-ecuador") {
      return "latam";
    }
    if (slug.endsWith("-spain") || slug.endsWith("-germany") || slug.endsWith("-portugal") || slug.endsWith("-italy") || slug.endsWith("-ireland")) {
      return "europe";
    }
    if (slug.endsWith("-usa")) return "usa-canada";
    return null;
  },
  cityName(slug) {
    if (slug === "mexicocity-mexico") return "Mexico City";
    return slug;
  },
};

const latamCities = [
  "bogota-colombia",
  "lima-peru",
  "mexicocity-mexico",
  "quito-ecuador",
  "santiago-chile",
];

describe("describeSectionAudience", () => {
  it("leaves an unfiltered section unlabeled", () => {
    expect(describeSectionAudience({ type: "hero" }, "en", catalog)).toEqual({ kind: "plain" });
  });

  it("hides the sentinel and does not invent the other regions", () => {
    expect(
      describeSectionAudience({ showOnLocations: [HIDDEN_LOCATION_SENTINEL] }, "en", catalog).kind,
    ).toBe("hidden");
    const both = describeSectionAudience({ showOnRegions: ["latam", "usa-canada"] }, "en", catalog);
    expect(both.kind).toBe("labeled");
    if (both.kind === "labeled") {
      expect(both.text).toBe("Latin America · US & Canada");
      expect(both.text).not.toContain("Europe");
    }
  });

  it("collapses five cities of one region and names a single city", () => {
    const many = describeSectionAudience({ showOnLocations: latamCities }, "en", catalog);
    expect(many.kind).toBe("labeled");
    if (many.kind === "labeled") expect(many.text).toBe("Latin America");

    const one = describeSectionAudience({ showOnLocations: ["mexicocity-mexico"] }, "es", catalog);
    expect(one.kind).toBe("labeled");
    if (one.kind === "labeled") expect(one.text).toBe("Mexico City");
  });
});

describe("expandLlmVariableString", () => {
  const defs = {
    precio: {
      default: "From 16,999",
      by_region: { europe: "From 14,999", latam: "From 12,999" },
    },
  };

  it("keeps the value inside the variable and repeats the glued suffix", () => {
    expect(expandLlmVariableString("{{ precio }}/month", defs, "en", null)).toBe(
      "From 16,999/month (Global) · From 14,999/month (Europe) · From 12,999/month (Latin America)",
    );
  });

  it("keeps one unlabeled value when a filtered section agrees on a non-default price", () => {
    const parts = describeSectionAudience(
      { showOnRegions: ["europe", "latam"] },
      "en",
      catalog,
    );
    expect(parts.kind).toBe("labeled");
    if (parts.kind !== "labeled") return;
    expect(
      expandLlmVariableString(
        "{{ precio }}",
        { precio: { default: "16", by_region: { europe: "12", latam: "12" } } },
        "en",
        parts.parts,
      ),
    ).toBe("12");
  });
  it("drops labels when every region matches the default", () => {
    expect(
      expandLlmVariableString("{{ precio }}", { precio: { default: "10", by_region: { europe: "10" } } }, "en", null),
    ).toBe("{{ precio }}");
  });
});

describe("sectionsBranchForLlm", () => {
  it("branches for a real filter and for a differing region variable", () => {
    expect(
      sectionsBranchForLlm([{ showOnLocations: ["mexicocity-mexico"] }], {}, "en", catalog),
    ).toBe(true);
    expect(
      sectionsBranchForLlm(
        [{ title: "{{ precio }}" }],
        { precio: { default: "1", by_region: { europe: "2" } } },
        "en",
        catalog,
      ),
    ).toBe(true);
    expect(sectionsBranchForLlm([{ title: "Hello" }], {}, "en", catalog)).toBe(false);
    expect(
      sectionsBranchForLlm([{ showOnLocations: [HIDDEN_LOCATION_SENTINEL] }], {}, "en", catalog),
    ).toBe(false);
  });
});
