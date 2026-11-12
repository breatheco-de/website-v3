import { describe, expect, it } from "vitest";
import type { ContentIndex, RedirectEntry } from "./content-index";
import { collectExternalRedirects, isCheckoutPathContext, siteOwnHosts } from "./outbound-redirects";

function makeCi(redirects: RedirectEntry[], knownUrls: string[] = []): ContentIndex {
  return {
    getRedirects: () => redirects,
    isKnownUrl: (url: string) => knownUrls.includes(url),
  } as unknown as ContentIndex;
}

const r = (from: string, to: RedirectEntry["to"], extra: Partial<RedirectEntry> = {}): RedirectEntry =>
  ({ from, to, type: "custom", status: 301, source: "test", ...extra }) as RedirectEntry;

const page = {
  sections: [
    { cta: { url: "/apply?cohort=1" } },
    { links: ["/en/compare", "/es/aplicar/", "/en/pricing", "/assets/logo.png", "//cdn.example.com/x"] },
  ],
  _tracking: { content_key: "/ignored" },
};

describe("collectExternalRedirects", () => {
  it("lists internal paths whose redirect leaves the site", () => {
    const ci = makeCi([
      r("/apply", "https://learn.4geeks.com/checkout?plan=x"),
      r("/en/compare", "/en/program-comparison"),
      r("/es/aplicar", { en: "/en/apply", es: "https://learn.4geeks.com/es/checkout" }),
      r("/en/pricing", "https://4geeks.com/en/pricing-new"),
    ]);
    expect(collectExternalRedirects(page, ci, siteOwnHosts({ config: { domain: "4geeks.com" } }))).toEqual({
      "/apply": "learn.4geeks.com",
      "/es/aplicar": "learn.4geeks.com",
    });
  });

  it("follows regex rules and skips custom fallbacks when the page is live", () => {
    const ci = makeCi(
      [
        r("/go/(.*)", "https://learn.4geeks.com/$1"),
        r("/en/compare", "https://partner.example.com/x", { priority: "fallback" }),
      ],
      ["/en/compare"],
    );
    const out = collectExternalRedirects({ a: "/go/checkout", b: "/en/compare" }, ci, ["4geeks.com"]);
    expect(out).toEqual({ "/go/checkout": "learn.4geeks.com" });
  });

  it("returns nothing when no link redirects off-site", () => {
    expect(collectExternalRedirects(page, makeCi([]), ["4geeks.com"])).toEqual({});
  });
});

describe("isCheckoutPathContext", () => {
  it("is true for decision pages and pages without a stage", () => {
    expect(isCheckoutPathContext({ funnel_stage: "decision" })).toBe(true);
    expect(isCheckoutPathContext({ content_key: "page:x" })).toBe(true);
    expect(isCheckoutPathContext({ funnel_stage: "awareness" })).toBe(false);
    expect(isCheckoutPathContext(null)).toBe(false);
  });
});
