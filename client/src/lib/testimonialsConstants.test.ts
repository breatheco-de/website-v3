import { describe, expect, it } from "vitest";
import { resolveTestimonialSearchPhrase } from "./testimonialsConstants";

describe("resolveTestimonialSearchPhrase", () => {
  it("resolves {{ single.title }} binds", () => {
    expect(
      resolveTestimonialSearchPhrase("{{ single.program_name | default }}", {
        program_name: "AI Engineering",
      }),
    ).toBe("AI Engineering");
  });

  it("trims plain search strings", () => {
    expect(resolveTestimonialSearchPhrase("  career change  ")).toBe("career change");
  });
});
