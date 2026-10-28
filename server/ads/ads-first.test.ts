import { afterEach, describe, expect, it, vi } from "vitest";

const flagged = vi.hoisted(() => ({ types: [] as string[] }));
vi.mock(import("../content-types"), async (importOriginal) => ({
  ...(await importOriginal()),
  getAdsOptimizedTypes: () => flagged.types,
}));

vi.mock(import("../settings"), async (importOriginal) => ({
  ...(await importOriginal()),
  getConsentWindowSettings: () => ({ ask_countries: "default", unknown_country_mode: "notice", accept_days: 365, reject_days: 5 }),
}));

const {
  adsFirstPathIndex,
  adsFirstTypeForPath,
  clearAdsFirstPathIndex,
  injectPageBoot,
  issuePageToken,
  resolvePageBoot,
  verifyPageToken,
} = await import("./ads-first");

type FakeEntry = { slug: string; contentType: string };

function fakeIndex(byType: Record<string, Array<FakeEntry & { urls: Record<string, string> }>>) {
  const findByType = vi.fn((t: string) => byType[t] ?? []);
  return {
    findByType,
    getLocaleUrls: (slug: string, ct: string) => (byType[ct] ?? []).find((e) => e.slug === slug)?.urls ?? {},
  } as unknown as Parameters<typeof adsFirstPathIndex>[1] & { findByType: typeof findByType };
}

afterEach(() => {
  flagged.types = [];
  clearAdsFirstPathIndex();
});

describe("ads-first path index", () => {
  it("maps every locale URL of flagged types and ignores the rest", () => {
    flagged.types = ["landing"];
    const ci = fakeIndex({
      landing: [{ slug: "bootcamp", contentType: "landing", urls: { en: "/en/landing/bootcamp/", es: "https://x.com/es/landing/bootcamp?x=1" } }],
      blog: [{ slug: "post", contentType: "blog", urls: { en: "/en/blog/post" } }],
    });
    expect(adsFirstTypeForPath("site_a", ci, undefined, "/en/landing/bootcamp")).toBe("landing");
    expect(adsFirstTypeForPath("site_a", ci, undefined, "/es/landing/bootcamp?utm_source=x")).toBe("landing");
    expect(adsFirstTypeForPath("site_a", ci, undefined, "/en/blog/post")).toBeNull();
  });

  it("rebuilds when the flagged types change and skips content lookups when none are flagged", () => {
    const ci = fakeIndex({ landing: [{ slug: "a", contentType: "landing", urls: { en: "/en/a" } }] });
    expect(adsFirstPathIndex("site_b", ci).size).toBe(0);
    expect(ci.findByType).not.toHaveBeenCalled();
    flagged.types = ["landing"];
    expect(adsFirstPathIndex("site_b", ci).get("/en/a")).toBe("landing");
    flagged.types = [];
    expect(adsFirstPathIndex("site_b", ci).size).toBe(0);
  });
});

describe("resolvePageBoot", () => {
  const ci = fakeIndex({ landing: [{ slug: "a", contentType: "landing", urls: { en: "/en/a" } }] });
  const res = { locals: { site: { contentRootName: "site_c", contentRoot: "/x", contentIndex: ci } } } as never;
  const req = (headers: Record<string, string> = {}) =>
    ({ headers, ip: "203.0.113.9", socket: {} }) as unknown as Parameters<typeof resolvePageBoot>[0];

  it("leaves the consent mode unset when the country is not known yet (no proxy header)", () => {
    flagged.types = ["landing"];
    expect(resolvePageBoot(req(), res, "/en/a")).toMatchObject({ af: 1, cm: null, fp: 1 });
  });

  it("sets the consent mode from a known country", () => {
    flagged.types = ["landing"];
    expect(resolvePageBoot(req({ "x-country-code": "US" }), res, "/en/a").cm).toBe("notice");
    expect(resolvePageBoot(req({ "x-country-code": "DE" }), res, "/en/a").cm).toBe("ask");
  });

  it("is empty when no content type is flagged", () => {
    expect(resolvePageBoot(req({ "x-country-code": "US" }), res, "/en/a")).toEqual({ af: 0, cm: null, fp: 0, t: "" });
  });
});

describe("page token", () => {
  const now = Date.parse("2026-10-27T12:30:00Z");

  it("verifies for 24 hours on the same site only", () => {
    const token = issuePageToken("site_a", now);
    expect(verifyPageToken("site_a", token, now)).toBe(true);
    expect(verifyPageToken("site_a", token, now + 23 * 3600_000)).toBe(true);
    expect(verifyPageToken("site_a", token, now + 25 * 3600_000)).toBe(false);
    expect(verifyPageToken("site_b", token, now)).toBe(false);
  });

  it("rejects tampered, future and malformed tokens", () => {
    const token = issuePageToken("site_a", now);
    expect(verifyPageToken("site_a", `${token.slice(0, -1)}${token.endsWith("A") ? "B" : "A"}`, now)).toBe(false);
    expect(verifyPageToken("site_a", issuePageToken("site_a", now + 2 * 3600_000), now)).toBe(false);
    expect(verifyPageToken("site_a", "nope", now)).toBe(false);
    expect(verifyPageToken("site_a", undefined, now)).toBe(false);
  });
});

describe("injectPageBoot", () => {
  it("replaces the boot object, including one already injected (cached HTML)", () => {
    const html = `<script>window.__4G_PAGE__ = {"af":0,"cm":null,"fp":0,"t":""};</script>`;
    const once = injectPageBoot(html, { af: 1, cm: "notice", fp: 1, t: "abc.def" });
    expect(once).toContain(`window.__4G_PAGE__ = {"af":1,"cm":"notice","fp":1,"t":"abc.def"};`);
    const twice = injectPageBoot(once, { af: 0, cm: null, fp: 1, t: "zzz.yyy" });
    expect(twice).toContain(`{"af":0,"cm":null,"fp":1,"t":"zzz.yyy"}`);
    expect(twice.match(/__4G_PAGE__/g)).toHaveLength(1);
  });

  it("leaves HTML without the placeholder untouched", () => {
    expect(injectPageBoot("<html></html>", { af: 1, cm: null, fp: 1, t: "x" })).toBe("<html></html>");
  });
});
