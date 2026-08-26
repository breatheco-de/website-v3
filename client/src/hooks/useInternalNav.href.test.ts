import { describe, expect, it } from "vitest";
import { normalizeHashQuery, resolveGlobalTemplate } from "./useInternalNav";

describe("resolveGlobalTemplate", () => {
  it("unwraps a whole-string preserved template", () => {
    expect(resolveGlobalTemplate("{{ global.pay | https://4geeks.com/es/payment }}")).toBe(
      "https://4geeks.com/es/payment",
    );
  });

  it("unwraps inline templates inside a longer URL", () => {
    expect(
      resolveGlobalTemplate(
        "https://4geeks.com/es/payment-component?program=ai-flex&plan=pro&cohort={{ global.the_ai_first_professional_cohort | 1713 }}",
      ),
    ).toBe(
      "https://4geeks.com/es/payment-component?program=ai-flex&plan=pro&cohort=1713",
    );
  });

  it("trims spaces around pipe fallback values", () => {
    expect(
      resolveGlobalTemplate(
        "/pay?cohort={{ global.the_career_switcher_cohort | 1717 }}",
      ),
    ).toBe("/pay?cohort=1717");
  });

  it("unwraps multiple inline templates", () => {
    expect(
      resolveGlobalTemplate(
        "/x?a={{ global.a | 1 }}&b={{ global.b | 2 }}",
      ),
    ).toBe("/x?a=1&b=2");
  });

  it("leaves plain URLs unchanged", () => {
    expect(resolveGlobalTemplate("/en/foo?cohort=1713")).toBe("/en/foo?cohort=1713");
  });
});

describe("normalizeHashQuery", () => {
  it("moves query after hash onto the search string", () => {
    expect(
      normalizeHashQuery("/en/career-programs/ai-flex#pricing-6svo9e?cohort=1713"),
    ).toBe("/en/career-programs/ai-flex?cohort=1713#pricing-6svo9e");
  });

  it("works for absolute URLs", () => {
    expect(
      normalizeHashQuery(
        "https://4geeks.com/en/career-programs/ai-flex#pricing-6svo9e?cohort=1713",
      ),
    ).toBe("https://4geeks.com/en/career-programs/ai-flex?cohort=1713#pricing-6svo9e");
  });

  it("merges with an existing search string", () => {
    expect(normalizeHashQuery("/en/ai-flex?plan=pro#pricing?cohort=1713")).toBe(
      "/en/ai-flex?plan=pro&cohort=1713#pricing",
    );
  });

  it("leaves correct ?query#hash alone", () => {
    expect(normalizeHashQuery("/en/ai-flex?cohort=1713#pricing-6svo9e")).toBe(
      "/en/ai-flex?cohort=1713#pricing-6svo9e",
    );
  });

  it("handles hash-only dirty links", () => {
    expect(normalizeHashQuery("#pricing-6svo9e?cohort=1713")).toBe(
      "?cohort=1713#pricing-6svo9e",
    );
  });
});
