import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROBOTS_SETTINGS,
  buildRobotsTxtContent,
  extractRobotsMetaFromHtml,
  normalizeIndexingBlock,
  applyXRobotsTag,
  applyXRobotsTagFromHtml,
  resolveEffectiveRobots,
  type RobotsSettings,
} from "./settings";
import { isSeoControlPath } from "./crawl-control";

describe("normalizeIndexingBlock", () => {
  it("prefers indexing_block when set", () => {
    expect(normalizeIndexingBlock({ indexing_block: "ai", block_indexing: true })).toBe("ai");
  });

  it("maps legacy block_indexing true to all", () => {
    expect(normalizeIndexingBlock({ block_indexing: true })).toBe("all");
  });

  it("maps legacy block_indexing false to none", () => {
    expect(normalizeIndexingBlock({ block_indexing: false })).toBe("none");
  });

  it("falls back to none when missing", () => {
    expect(normalizeIndexingBlock(undefined)).toBe("none");
  });
});

describe("buildRobotsTxtContent", () => {
  const base: RobotsSettings = {
    ...DEFAULT_ROBOTS_SETTINGS,
    ai_bots: ["GPTBot", "ClaudeBot"],
    disallow_paths: ["/api/"],
    include_sitemap: true,
  };

  it("disallows all when indexing_block is all", () => {
    const body = buildRobotsTxtContent({ ...base, indexing_block: "all" }, "https://example.com");
    expect(body).toContain("Disallow: /");
    expect(body).not.toContain("GPTBot");
    expect(body).not.toContain("Sitemap:");
  });

  it("allows AI bots when indexing_block is none", () => {
    const body = buildRobotsTxtContent({ ...base, indexing_block: "none" }, "https://example.com");
    expect(body).toContain("User-agent: GPTBot");
    expect(body).toMatch(/User-agent: GPTBot\nAllow: \//);
    expect(body).toContain("Sitemap: https://example.com/sitemap.xml");
  });

  it("disallows AI bots when indexing_block is ai", () => {
    const body = buildRobotsTxtContent({ ...base, indexing_block: "ai" }, "https://example.com");
    expect(body).toContain("# Block AI/LLM crawlers");
    expect(body).toMatch(/User-agent: GPTBot\nDisallow: \//);
    expect(body).toMatch(/User-agent: ClaudeBot\nDisallow: \//);
    expect(body).toContain("Allow: /");
    expect(body).toContain("Sitemap: https://example.com/sitemap.xml");
  });
});

describe("extractRobotsMetaFromHtml / applyXRobotsTag", () => {
  it("extracts robots meta in either attribute order", () => {
    expect(
      extractRobotsMetaFromHtml('<meta name="robots" content="noindex, nofollow" />'),
    ).toBe("noindex, nofollow");
    expect(
      extractRobotsMetaFromHtml('<meta content="index, follow" name="robots">'),
    ).toBe("index, follow");
  });

  it("sets X-Robots-Tag from page robots", () => {
    const headers: Record<string, string> = {};
    applyXRobotsTag(
      { setHeader: (n, v) => { headers[n] = v; } },
      undefined,
      "noindex",
    );
    expect(headers["X-Robots-Tag"]).toBe("noindex");
  });

  it("applyXRobotsTagFromHtml uses meta from HTML when site is not fully blocked", () => {
    const headers: Record<string, string> = {};
    applyXRobotsTagFromHtml(
      { setHeader: (n, v) => { headers[n] = v; } },
      '<html><head><meta name="robots" content="noindex, follow" /></head></html>',
    );
    expect(headers["X-Robots-Tag"]).toBe("noindex, follow");
  });
});

describe("resolveEffectiveRobots with defaults", () => {
  it("defaults to index, follow", () => {
    expect(resolveEffectiveRobots(undefined)).toBe("index, follow");
    expect(resolveEffectiveRobots("")).toBe("index, follow");
  });
});

describe("isSeoControlPath", () => {
  it("allows robots.txt and sitemap.xml", () => {
    expect(isSeoControlPath("/robots.txt")).toBe(true);
    expect(isSeoControlPath("/sitemap.xml")).toBe(true);
    expect(isSeoControlPath("/us/blog")).toBe(false);
  });
});

describe("shouldHardDenyLlmCrawler with default site settings", () => {
  it("does not deny when indexing_block defaults to none", async () => {
    const { shouldHardDenyLlmCrawler } = await import("./settings");
    expect(shouldHardDenyLlmCrawler("GPTBot/1.0")).toBe(false);
    expect(shouldHardDenyLlmCrawler("Mozilla/5.0 compatible; Googlebot/2.1")).toBe(false);
  });
});
