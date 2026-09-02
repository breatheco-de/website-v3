import { describe, expect, it } from "vitest";
import {
  bucketUserAgent,
  classifyRuntimeHit,
  fingerprintNotFound,
  incrementByHour,
  is4geeksReferrerHost,
  isAssetPath,
  isRootViteHashAsset,
  isRuntimeIssueProbeSuccess,
  localeFromPath,
  localePrefixFromPath,
  localYmd,
  normalizeRuntimePath,
  pruneRuntimeIssuesState,
  shouldHardDropNotFound,
  stripReferrerQuery,
  emptyRuntimeIssuesState,
  runtimeIssueRecordSchema,
  runtimeIssuesStateSchema,
  utcHourKey,
  windowHitCount,
  aggregateHitsByDay,
  MAX_ISSUES_PER_SITE,
  hasStaffQueryParams,
  isSensitiveQueryKey,
  parseRuntimeQueryAttribution,
  mergeQueryAttribution,
  sortParamKeysForDisplay,
  hasQueryAttribution,
} from "./runtime-issues";

const CHROME =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

describe("normalizeRuntimePath", () => {
  it("strips query and hash and trailing slash", () => {
    expect(normalizeRuntimePath("/foo/bar/?utm=1#x")).toBe("/foo/bar");
    expect(normalizeRuntimePath("https://example.com/us/page/")).toBe("/us/page");
  });

  it("keeps root slash", () => {
    expect(normalizeRuntimePath("/")).toBe("/");
  });
});

describe("localeFromPath", () => {
  it("reads two-letter prefix", () => {
    expect(localeFromPath("/es/coding")).toBe("es");
    expect(localeFromPath("/en/coding")).toBe("en");
    expect(localeFromPath("/coding")).toBe("en");
  });

  it("does not treat unprefixed paths as a visible locale", () => {
    expect(localePrefixFromPath("/es/coding")).toBe("es");
    expect(localePrefixFromPath("/en")).toBe("en");
    expect(localePrefixFromPath("/admin")).toBeNull();
    expect(localePrefixFromPath("/private/preview/x")).toBeNull();
    expect(localeFromPath("/admin")).toBe("en");
  });
});

describe("fingerprintNotFound", () => {
  it("includes site locale and path", () => {
    expect(fingerprintNotFound("site_4geeks-com", "es", "/es/foo/")).toBe(
      "http.not_found|site_4geeks-com|es|/es/foo",
    );
  });
});

describe("stripReferrerQuery", () => {
  it("removes query from absolute URLs", () => {
    expect(stripReferrerQuery("https://x.com/a?b=1")).toBe("https://x.com/a");
  });
});

describe("isAssetPath", () => {
  it("detects common static file extensions on the last segment", () => {
    expect(isAssetPath("/assets/app.js")).toBe(true);
    expect(isAssetPath("/hero.webp")).toBe(true);
    expect(isAssetPath("/chunk.js.map")).toBe(true);
    expect(isAssetPath("/en/blog/old-slug")).toBe(false);
    expect(isAssetPath("/en/ai-2.0")).toBe(false);
  });
});

describe("shouldHardDropNotFound", () => {
  it("drops probe paths", () => {
    expect(shouldHardDropNotFound("/.env", CHROME)).toBe(true);
    expect(shouldHardDropNotFound("/.env.production", CHROME)).toBe(true);
    expect(shouldHardDropNotFound("/.env.local", CHROME)).toBe(true);
    expect(shouldHardDropNotFound("/.env.backup", CHROME)).toBe(true);
    expect(shouldHardDropNotFound("/wp-admin/foo", CHROME)).toBe(true);
    expect(shouldHardDropNotFound("/graphql", CHROME, "https://4geeks.com/")).toBe(true);
    expect(shouldHardDropNotFound("/.vite/manifest.json", CHROME)).toBe(true);
    expect(shouldHardDropNotFound("/apple-touch-icon.png", CHROME)).toBe(true);
  });

  it("does not treat .gitignore as a /.git probe prefix", () => {
    expect(shouldHardDropNotFound("/.gitignore", CHROME)).toBe(false);
  });

  it("keeps search and LLM crawlers on page URLs", () => {
    expect(shouldHardDropNotFound("/es/blog/foo", "Googlebot/2.1")).toBe(false);
    expect(shouldHardDropNotFound("/es/blog/foo", "Mozilla/5.0 compatible; bingbot/2.0")).toBe(false);
    expect(shouldHardDropNotFound("/es/blog/foo", "GPTBot/1.0")).toBe(false);
    expect(shouldHardDropNotFound("/es/blog/foo", "facebookexternalhit/1.1")).toBe(false);
    expect(shouldHardDropNotFound("/es/blog/foo", "Mozilla/5.0 (compatible; Bytespider)")).toBe(false);
  });

  it("keeps a Google SERP click", () => {
    expect(shouldHardDropNotFound("/es/blog/foo", CHROME, "https://www.google.com/search")).toBe(false);
  });

  it("keeps a 4Geeks-referrer file 404", () => {
    expect(
      shouldHardDropNotFound(
        "/static/images/loader.gif",
        CHROME,
        "https://classrecordings.4geeks.com/",
      ),
    ).toBe(false);
  });

  it("drops the same gif with no referrer", () => {
    expect(shouldHardDropNotFound("/static/images/loader.gif", CHROME)).toBe(true);
  });

  it("does not treat evil.com/4geeks as internal", () => {
    expect(is4geeksReferrerHost("https://evil.com/4geeks")).toBe(false);
    expect(shouldHardDropNotFound("/static/images/loader.gif", CHROME, "https://evil.com/4geeks")).toBe(
      true,
    );
  });

  it("drops scrapers and HTTP clients", () => {
    expect(shouldHardDropNotFound("/es/blog/foo", "curl/8.0")).toBe(true);
    expect(shouldHardDropNotFound("/es/blog/foo", "Mozilla/5.0 compatible; AhrefsBot/7.0")).toBe(true);
  });

  it("drops root hashed JS even with a 4Geeks referrer", () => {
    expect(isRootViteHashAsset("/FooterDefault-BzTB3rd2.js")).toBe(true);
    expect(
      shouldHardDropNotFound("/FooterDefault-BzTB3rd2.js", CHROME, "https://4geeks.com/"),
    ).toBe(true);
    expect(isRootViteHashAsset("/assets/FooterDefault-BzTB3rd2.js")).toBe(false);
  });

  it("drops junk CSS and layout-variant paths", () => {
    expect(
      shouldHardDropNotFound(
        "/en/location/linear-gradient(rgba(0, 128, 255, 0.05), rgba(0, 0, 0, 0))",
        CHROME,
      ),
    ).toBe(true);
    expect(shouldHardDropNotFound("/en/career-programs/null", CHROME)).toBe(true);
    expect(shouldHardDropNotFound("/en/career-programs/inline", CHROME)).toBe(true);
  });

  it("keeps a missing page for a normal browser", () => {
    expect(shouldHardDropNotFound("/us/missing", CHROME)).toBe(false);
  });

  it("records scrapers when dropScrapers is false", () => {
    expect(shouldHardDropNotFound("/es/blog/foo", "curl/8.0", undefined, false)).toBe(false);
    expect(shouldHardDropNotFound("/es/blog/foo", "curl/8.0", undefined, true)).toBe(true);
  });
});

describe("classifyRuntimeHit", () => {
  it("tags Googlebot as search_crawler, not human", () => {
    const hit = classifyRuntimeHit("/es/blog/foo", "Googlebot/2.1", undefined);
    expect(hit.tags).toContain("search_crawler");
    expect(hit.tags).not.toContain("human");
    expect(hit.likelyBot).toBe(false);
    expect(hit.uaBucket).toBe("search_crawler");
  });

  it("tags GPTBot as llm_crawler", () => {
    expect(classifyRuntimeHit("/x", "GPTBot/1.0", undefined).uaBucket).toBe("llm_crawler");
  });

  it("tags a Google SERP click as human + search_referrer", () => {
    const hit = classifyRuntimeHit("/es/blog/foo", CHROME, "https://www.google.com/search?q=bootcamp");
    expect(hit.tags).toEqual(expect.arrayContaining(["human", "search_referrer"]));
    expect(hit.uaBucket).toBe("desktop");
  });

  it("tags classrecordings as internal", () => {
    const hit = classifyRuntimeHit(
      "/static/images/loader.gif",
      CHROME,
      "https://classrecordings.4geeks.com/",
    );
    expect(hit.tags).toContain("internal");
  });
});

describe("bucketUserAgent", () => {
  it("buckets crawlers and devices", () => {
    expect(bucketUserAgent("Googlebot")).toBe("search_crawler");
    expect(bucketUserAgent("Mozilla/5.0 (iPhone)")).toBe("mobile");
  });
});

describe("byHour", () => {
  it("increments total and tags on the UTC hour key", () => {
    const ts = Date.UTC(2026, 7, 14, 1, 15, 0);
    expect(utcHourKey(ts)).toBe("2026-08-14T01");
    const byHour = incrementByHour(undefined, ts, ["search_crawler", "human"]);
    expect(byHour["2026-08-14T01"]).toEqual({
      total: 1,
      search_crawler: 1,
      human: 1,
    });
  });

  it("sums 7 local days in America/Bogota so 01:00 UTC counts as the previous local day", () => {
    const ts = Date.UTC(2026, 7, 14, 1, 0, 0);
    const byHour = incrementByHour(undefined, ts, ["search_crawler"]);
    const issue = { byHour, count: 1, lastSeen: ts };
    const now = Date.UTC(2026, 7, 14, 12, 0, 0);
    expect(localYmd(ts, "America/Bogota")).toBe("2026-08-13");
    expect(windowHitCount(issue, 1, "UTC", now)).toBe(1);
    expect(windowHitCount(issue, 1, "America/Bogota", now)).toBe(0);
    expect(windowHitCount(issue, 7, "America/Bogota", now)).toBe(1);
  });

  it("hides a 20-day-old hour from a 7-day window", () => {
    const ts = Date.UTC(2026, 6, 25, 12, 0, 0);
    const now = Date.UTC(2026, 7, 14, 12, 0, 0);
    const byHour = incrementByHour(undefined, ts, ["human"]);
    expect(windowHitCount({ byHour, count: 1, lastSeen: ts }, 7, "UTC", now)).toBe(0);
    expect(windowHitCount({ byHour, count: 1, lastSeen: ts }, 30, "UTC", now)).toBe(1);
  });
});

describe("aggregateHitsByDay", () => {
  it("puts a 01:00 UTC hit on the previous local day in America/Bogota", () => {
    const ts = Date.UTC(2026, 7, 14, 1, 0, 0);
    const byHour = incrementByHour(undefined, ts, ["search_crawler"]);
    const now = Date.UTC(2026, 7, 14, 12, 0, 0);
    const series = aggregateHitsByDay([{ byHour, count: 1, lastSeen: ts }], {
      windowDays: 7,
      tz: "America/Bogota",
      now,
    });
    expect(series).toHaveLength(7);
    expect(series[0]?.day < series[series.length - 1]!.day).toBe(true);
    const hit = series.find((p) => p.count > 0);
    expect(hit?.day).toBe("2026-08-13");
    expect(hit?.count).toBe(1);
  });

  it("counts only the source tag when source is set", () => {
    const ts = Date.UTC(2026, 7, 13, 12, 0, 0);
    const now = Date.UTC(2026, 7, 14, 12, 0, 0);
    let byHour = incrementByHour(undefined, ts, ["search_crawler", "human"]);
    byHour = incrementByHour(byHour, ts + 3_600_000, ["human"]);
    const issue = { byHour, count: 2, lastSeen: ts };
    const crawler = aggregateHitsByDay([issue], {
      windowDays: 7,
      tz: "UTC",
      now,
      source: "search_crawler",
    });
    expect(crawler.reduce((sum, p) => sum + p.count, 0)).toBe(1);
    const all = aggregateHitsByDay([issue], { windowDays: 7, tz: "UTC", now });
    expect(all.reduce((sum, p) => sum + p.count, 0)).toBe(2);
  });

  it("sums daily counts to windowHitCount across mixed byHour and legacy rows", () => {
    const now = Date.UTC(2026, 7, 14, 12, 0, 0);
    const recentTs = Date.UTC(2026, 7, 13, 12, 0, 0);
    const oldTs = Date.UTC(2026, 6, 25, 12, 0, 0);
    const legacyTs = Date.UTC(2026, 7, 12, 8, 0, 0);
    let byHour = incrementByHour(undefined, oldTs, ["human"]);
    byHour = incrementByHour(byHour, recentTs, ["human"]);
    const issues = [
      { byHour, count: 2, lastSeen: recentTs },
      { count: 5, lastSeen: legacyTs },
    ];
    const windowDays = 7;
    const tz = "UTC";
    const series = aggregateHitsByDay(issues, { windowDays, tz, now });
    const expected = issues.reduce((sum, issue) => sum + windowHitCount(issue, windowDays, tz, now), 0);
    expect(series.reduce((sum, p) => sum + p.count, 0)).toBe(expected);
    expect(expected).toBe(6);
  });
});

describe("pruneRuntimeIssuesState", () => {
  it("drops old and caps size", () => {
    const state = emptyRuntimeIssuesState();
    const now = Date.now();
    for (let i = 0; i < MAX_ISSUES_PER_SITE + 10; i++) {
      const fp = `http.not_found|s|en|/p${i}`;
      state.issues[fp] = {
        fingerprint: fp,
        kind: "http.not_found",
        path: `/p${i}`,
        locale: "en",
        count: i,
        firstSeen: now,
        lastSeen: now,
      };
    }
    const oldFp = "http.not_found|s|en|/old";
    state.issues[oldFp] = {
      fingerprint: oldFp,
      kind: "http.not_found",
      path: "/old",
      locale: "en",
      count: 9999,
      firstSeen: 1,
      lastSeen: 1,
    };
    const hashedFp = "http.not_found|s|en|/FooterDefault-BzTB3rd2.js";
    state.issues[hashedFp] = {
      fingerprint: hashedFp,
      kind: "http.not_found",
      path: "/FooterDefault-BzTB3rd2.js",
      locale: "en",
      count: 50,
      firstSeen: now,
      lastSeen: now,
    };
    const pruned = pruneRuntimeIssuesState(state, now);
    expect(Object.keys(pruned.issues).length).toBeLessThanOrEqual(MAX_ISSUES_PER_SITE);
    expect(pruned.issues[oldFp]).toBeUndefined();
    expect(pruned.issues[hashedFp]).toBeUndefined();
  });

  it("drops hour keys older than 30 days", () => {
    const now = Date.UTC(2026, 7, 14, 12, 0, 0);
    const oldTs = now - 40 * 24 * 60 * 60 * 1000;
    const recentTs = now - 2 * 24 * 60 * 60 * 1000;
    const fp = "http.not_found|s|en|/en/page";
    const state = emptyRuntimeIssuesState();
    state.issues[fp] = {
      fingerprint: fp,
      kind: "http.not_found",
      path: "/en/page",
      locale: "en",
      count: 2,
      firstSeen: oldTs,
      lastSeen: recentTs,
      byHour: {
        ...incrementByHour(undefined, oldTs, ["human"]),
        ...incrementByHour(undefined, recentTs, ["human"]),
      },
    };
    const pruned = pruneRuntimeIssuesState(state, now);
    expect(Object.keys(pruned.issues[fp]?.byHour ?? {})).toHaveLength(1);
    expect(pruned.issues[fp]?.count).toBe(1);
  });
});

describe("lastProbe schema", () => {
  it("parses optional lastProbe and treats page/redirect as success", () => {
    const parsed = runtimeIssueRecordSchema.parse({
      fingerprint: "http.not_found|s|en|/hello",
      kind: "http.not_found",
      path: "/hello",
      locale: "en",
      count: 1,
      firstSeen: 1,
      lastSeen: 2,
      lastProbe: {
        at: 3,
        status: "redirect",
        destination: "/us/page",
        chained: true,
        hops: ["/hello", "/mid", "/us/page"],
        httpStatus: 200,
        matchType: "exact",
        entry: { contentType: "page", slug: "page" },
      },
    });
    expect(parsed.lastProbe?.status).toBe("redirect");
    expect(isRuntimeIssueProbeSuccess(parsed.lastProbe?.status)).toBe(true);
    expect(isRuntimeIssueProbeSuccess("not_found")).toBe(false);
    expect(isRuntimeIssueProbeSuccess(undefined)).toBe(false);
  });

  it("allows records without lastProbe", () => {
    const parsed = runtimeIssueRecordSchema.parse({
      fingerprint: "http.not_found|s|en|/hello",
      kind: "http.not_found",
      path: "/hello",
      locale: "en",
      count: 1,
      firstSeen: 1,
      lastSeen: 2,
    });
    expect(parsed.lastProbe).toBeUndefined();
  });
});

describe("dropScrapers state", () => {
  it("parses old JSON without dropScrapers", () => {
    const parsed = runtimeIssuesStateSchema.parse({
      version: 1,
      updatedAt: 1,
      issues: {},
    });
    expect(parsed.dropScrapers).toBeUndefined();
  });

  it("prune keeps dropScrapers", () => {
    const now = Date.now();
    const state = emptyRuntimeIssuesState();
    state.dropScrapers = false;
    state.issues["http.not_found|s|en|/us/keep"] = {
      fingerprint: "http.not_found|s|en|/us/keep",
      kind: "http.not_found",
      path: "/us/keep",
      locale: "en",
      count: 1,
      firstSeen: now,
      lastSeen: now,
    };
    const pruned = pruneRuntimeIssuesState(state, now);
    expect(pruned.issues["http.not_found|s|en|/us/keep"]).toBeDefined();
    expect(pruned.dropScrapers).toBe(false);
  });
});

describe("hasStaffQueryParams", () => {
  it("detects staff preview keys", () => {
    expect(hasStaffQueryParams("force_variant=draft-a")).toBe(true);
    expect(hasStaffQueryParams("?variant=draft-a&utm_source=google")).toBe(true);
    expect(hasStaffQueryParams("edit=1")).toBe(true);
    expect(hasStaffQueryParams("cache=false")).toBe(true);
  });

  it("allows normal marketing params", () => {
    expect(hasStaffQueryParams("utm_source=google&utm_campaign=test")).toBe(false);
    expect(hasStaffQueryParams("")).toBe(false);
  });
});

describe("parseRuntimeQueryAttribution", () => {
  it("splits utm source/medium/campaign and other keys", () => {
    const parsed = parseRuntimeQueryAttribution(
      "utm_source=meta&utm_medium=paid&utm_campaign=q1&gclid=abc&utm_content=hero",
    );
    expect(parsed?.source).toEqual(["meta"]);
    expect(parsed?.medium).toEqual(["paid"]);
    expect(parsed?.campaign).toEqual(["q1"]);
    expect(parsed?.other?.gclid).toEqual(["abc"]);
    expect(parsed?.other?.utm_content).toEqual(["hero"]);
  });

  it("normalizes keys and decodes values", () => {
    const parsed = parseRuntimeQueryAttribution("UTM_SOURCE=Google%20Ads");
    expect(parsed?.source).toEqual(["Google Ads"]);
  });

  it("drops sensitive keys", () => {
    const parsed = parseRuntimeQueryAttribution("utm_source=meta&token=secret&ref=abc");
    expect(parsed?.source).toEqual(["meta"]);
    expect(parsed?.other?.token).toBeUndefined();
    expect(parsed?.other?.ref).toEqual(["abc"]);
  });

  it("isSensitiveQueryKey matches substrings", () => {
    expect(isSensitiveQueryKey("access_token")).toBe(true);
    expect(isSensitiveQueryKey("gclid")).toBe(false);
  });
});

describe("mergeQueryAttribution", () => {
  it("unions distinct values per key", () => {
    const merged = mergeQueryAttribution(
      { campaign: ["a"], other: { gclid: ["1"] } },
      { campaign: ["b"], other: { gclid: ["2"], ref: ["x"] } },
    );
    expect(merged?.campaign).toEqual(["a", "b"]);
    expect(merged?.other?.gclid).toEqual(["1", "2"]);
    expect(merged?.other?.ref).toEqual(["x"]);
  });
});

describe("hasQueryAttribution", () => {
  it("detects any captured query fields", () => {
    expect(hasQueryAttribution(undefined)).toBe(false);
    expect(hasQueryAttribution({ source: ["meta"] })).toBe(true);
    expect(hasQueryAttribution({ other: { gclid: ["abc"] } })).toBe(true);
    expect(hasQueryAttribution({})).toBe(false);
  });
});

describe("sortParamKeysForDisplay", () => {
  it("puts utm_* keys first", () => {
    expect(sortParamKeysForDisplay(["gclid", "utm_content", "ref", "utm_term"])).toEqual([
      "utm_content",
      "utm_term",
      "gclid",
      "ref",
    ]);
  });
});
