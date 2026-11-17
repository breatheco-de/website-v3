import { describe, expect, it } from "vitest";
import { isCtaTrackingEditor, resolveBoundCtaPaths } from "./validateCtaTracking";

describe("isCtaTrackingEditor / cta-picker:tracking", () => {
  it("accepts cta-tracking and cta-picker:tracking", () => {
    expect(isCtaTrackingEditor("cta-tracking")).toBe(true);
    expect(isCtaTrackingEditor("cta-picker:tracking")).toBe(true);
    expect(isCtaTrackingEditor("cta-picker")).toBe(false);
    expect(isCtaTrackingEditor("form-settings")).toBe(false);
  });

  it("resolveBoundCtaPaths includes cta-picker:tracking paths", () => {
    const paths = resolveBoundCtaPaths(
      {
        "default:cta.buttons[]": "cta-picker:tracking",
        "default:icon": "icon-picker",
        "course:signup_card.cta_button": "cta-tracking",
      },
      "default",
    );
    expect(paths).toContain("cta.buttons[]");
    expect(paths).not.toContain("signup_card.cta_button");
  });
});
