import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeHashQuery, resolveGlobalTemplate, resolveQsTokens } from "./useInternalNav";

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

describe("resolveQsTokens", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("encodes an already-encoded fallback only once", () => {
    vi.stubGlobal("window", { location: { search: "?cohort=1536" } });
    const fallback =
      "%7B%22product%22%3A%22ai-engineering%22%2C%22persona%22%3A%22the-career-changer%22%7D";
    const href = resolveQsTokens(
      `https://4geeks.com/checkout?plan=ai-engineering-registration-fee&cohort={qs:cohort|sept-2026}&gtm_payload={qs:gtm_payload|${fallback}}`,
    );
    const params = new URL(href).searchParams;
    expect(params.get("cohort")).toBe("1536");
    expect(params.get("gtm_payload")).toBe(
      '{"product":"ai-engineering","persona":"the-career-changer"}',
    );
    expect(href).not.toContain("%257B");
  });

  it("encodes a plain fallback once", () => {
    vi.stubGlobal("window", { location: { search: "" } });
    expect(resolveQsTokens("https://4geeks.com/checkout?cohort={qs:cohort|sept-2026}")).toBe(
      "https://4geeks.com/checkout?cohort=sept-2026",
    );
  });

  it("re-encodes a present query value once", () => {
    const json = '{"product":"ai-engineering"}';
    vi.stubGlobal("window", {
      location: { search: `?gtm_payload=${encodeURIComponent(json)}` },
    });
    const href = resolveQsTokens(
      "https://4geeks.com/checkout?gtm_payload={qs:gtm_payload|%7B%22unused%22%7D}",
    );
    expect(new URL(href).searchParams.get("gtm_payload")).toBe(json);
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
