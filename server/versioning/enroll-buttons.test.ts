import { describe, expect, it } from "vitest";
import { countTrackedEnrollButtons } from "./enroll-buttons";
import { countTrackedCtas } from "@shared/validateCtaTracking";

const editors = {
  hero: { "course:signup_card.cta_button": "cta-tracking" },
  enrollment_selector: { "programs[].summary.cta": "cta-tracking" },
};

const hero = (tracking: string, variant = "course") => ({
  type: "hero",
  variant,
  signup_card: { cta_button: { text: "Enroll now", url: "/en/payment-component?program=ai-flex", tracking } },
});

describe("countTrackedCtas", () => {
  it("counts bound CTAs whose tracking is not none", () => {
    expect(countTrackedCtas(hero("add_to_cart"), ["signup_card.cta_button"])).toBe(1);
    expect(countTrackedCtas(hero("none"), ["signup_card.cta_button"])).toBe(0);
    expect(countTrackedCtas(hero("bogus"), ["signup_card.cta_button"])).toBe(0);
  });
});

describe("countTrackedEnrollButtons", () => {
  it("adds up tracked buttons across sections, honoring each section's variant", () => {
    const sections = [
      hero("add_to_cart"),
      hero("add_to_cart", "simple"),
      {
        type: "enrollment_selector",
        programs: [
          { id: "a", summary: { cta: { text: "Go", url: "/checkout", tracking: "click_begin_checkout" } } },
          { id: "b", summary: { cta: { text: "Info", url: "#modal-x", tracking: "none" } } },
        ],
      },
      { type: "faq", items: [] },
    ];
    expect(countTrackedEnrollButtons(sections, editors)).toBe(2);
  });

  it("is zero for a page without sections or tracked buttons", () => {
    expect(countTrackedEnrollButtons(undefined, editors)).toBe(0);
    expect(countTrackedEnrollButtons([hero("none")], editors)).toBe(0);
  });
});
