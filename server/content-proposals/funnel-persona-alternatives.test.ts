import { describe, it, expect } from "vitest";
import { funnelPersonaAlternativesWarning } from "./funnel-persona-alternatives";

const PERSONAS = [
  { id: "the-career-changer", label: "The Career Changer", role: "No technical background" },
  { id: "the-frustrated-graduate", label: "The Frustrated Graduate", role: "Graduate with basic coding skills" },
];

const lookup = (slug: string) => (slug === "ai-engineering" ? PERSONAS : null);

describe("funnelPersonaAlternativesWarning", () => {
  it("lists every persona on the bound product with the chosen one", () => {
    const w = funnelPersonaAlternativesWarning(
      [
        {
          contentType: "landing",
          slug: "from-developer",
          updates: [
            { field_path: "funnel.stage", value: "consideration" },
            {
              field_path: "funnel.products",
              value: [{ product: "ai-engineering", persona: "the-career-changer" }],
            },
          ],
        },
      ],
      lookup,
    );
    expect(w?.code).toBe("funnel_persona_alternatives");
    expect(w?.details.products).toEqual([
      {
        product: "ai-engineering",
        chosen_personas: ["the-career-changer"],
        entries: ["landing/from-developer"],
        personas: PERSONAS,
      },
    ]);
    expect(w?.message).toContain("not evidence either way");
  });

  it("reads bindings from a whole funnel block", () => {
    const w = funnelPersonaAlternativesWarning(
      [
        {
          contentType: "landing",
          slug: "x",
          updates: [
            {
              field_path: "funnel",
              value: { stage: "awareness", products: [{ product: "ai-engineering", persona: "the-frustrated-graduate" }] },
            },
          ],
        },
      ],
      lookup,
    );
    expect(w?.details.products[0]?.chosen_personas).toEqual(["the-frustrated-graduate"]);
  });

  it("stays silent without a persona, for products:all, unknown products, or single-persona products", () => {
    const entry = (value: unknown) => ({
      contentType: "landing",
      slug: "x",
      updates: [{ field_path: "funnel.products", value }],
    });
    expect(funnelPersonaAlternativesWarning([entry([{ product: "ai-engineering" }])], lookup)).toBeNull();
    expect(funnelPersonaAlternativesWarning([entry("all")], lookup)).toBeNull();
    expect(
      funnelPersonaAlternativesWarning([entry([{ product: "unknown", persona: "p" }])], lookup),
    ).toBeNull();
    expect(
      funnelPersonaAlternativesWarning(
        [entry([{ product: "solo", persona: "only-one" }])],
        () => [{ id: "only-one", label: "Only", role: "r" }],
      ),
    ).toBeNull();
    expect(
      funnelPersonaAlternativesWarning(
        [{ contentType: "landing", slug: "x", updates: [{ field_path: "meta.title", value: "T" }] }],
        lookup,
      ),
    ).toBeNull();
  });
});
