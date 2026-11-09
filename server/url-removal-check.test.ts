import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { AdOnUrl } from "@shared/url-removal";

const h = vi.hoisted(() => ({ adsOnUrl: vi.fn() }));

vi.mock("./ads/ads-by-landing-page", () => ({ adsOnUrl: h.adsOnUrl }));
vi.mock("./link-check/hosts", () => ({ ownHostsForContentRoot: () => ["4geeks.com"] }));
vi.mock("./ab-testing/state", () => ({ abCheckPageLock: () => null }));
vi.mock("./entry-ref", () => ({ resolveEntryRef: (_ci: unknown, ref: { ref: string }) => ({ ok: true, entryId: ref.ref }) }));
vi.mock("./content-index", () => ({ contentIndex: {} }));
vi.mock("./locale-url-slug", () => ({
  entryAgeHours: (v: unknown) => (v ? (Date.now() - Date.parse(String(v))) / 3_600_000 : null),
  readPublishedAtFromCommon: (c: Record<string, unknown> | null) => c?.published_at,
  resolveCurrentLocaleUrl: (o: { locale: string; parsed: { slug?: string }; entryIdentity: string }) =>
    `/${o.locale}/blog/${o.parsed.slug || o.entryIdentity}`,
}));

import { assessUrlRemoval, liveAdsOf } from "./url-removal-check";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "url-removal-"));
const folder = path.join(root, "blog", "foo");
fs.mkdirSync(folder, { recursive: true });
fs.writeFileSync(path.join(folder, "_common.yml"), "x: 1\n");
fs.writeFileSync(path.join(folder, "en.yml"), "slug: foo-en\n");
fs.writeFileSync(path.join(folder, "es.yml"), "slug: foo-es\n");

const old = new Date(Date.now() - 48 * 3_600_000).toISOString();
const ci = {
  contentRoot: root,
  contentRootName: "site_test",
  resolveBaseSlug: (s: string) => s,
  getContentFolderPath: () => folder,
  loadCommonData: () => ({ published_at: old }),
  safeYamlLoad: (raw: string) => ({ slug: raw.split(":")[1]!.trim() }),
};

const liveAd: AdOnUrl = {
  platform: "meta",
  site: "site_test",
  ad_id: "1",
  ad_name: "A",
  campaign_id: "c",
  campaign_name: "C",
  status: "ACTIVE",
  url: null,
  matched_by: "link",
};

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("assessUrlRemoval", () => {
  it("checks every live locale when none are given and flags agent redirect for old pages", async () => {
    h.adsOnUrl.mockImplementation((p: string) => ({
      live: p === "/es/blog/foo-es" ? [liveAd] : [],
      paused: [],
      checked: true,
      sources: [],
    }));
    const r = await assessUrlRemoval({ contentType: "blog", slug: "foo", action: "delete", ci: ci as never });
    expect(r.locales.map((l) => [l.locale, l.url]).sort()).toEqual([
      ["en", "/en/blog/foo-en"],
      ["es", "/es/blog/foo-es"],
    ]);
    expect(r.live_ads).toBe(1);
    expect(r.ads_checked).toBe(true);
    expect(r.locales.every((l) => l.redirect_required_for_agents)).toBe(true);
    expect(h.adsOnUrl).toHaveBeenCalledWith("/es/blog/foo-es", ["4geeks.com"]);
  });

  it("limits to the requested locales and dedupes live ads", async () => {
    h.adsOnUrl.mockReturnValue({ live: [liveAd], paused: [], checked: true, sources: [] });
    const r = await assessUrlRemoval({ contentType: "blog", slug: "foo", locales: ["en", "es"], action: "rename", ci: ci as never });
    expect(r.live_ads).toBe(2);
    expect(liveAdsOf(r)).toHaveLength(1);
    const one = await assessUrlRemoval({ contentType: "blog", slug: "foo", locales: ["en"], action: "unpublish", ci: ci as never });
    expect(one.locales.map((l) => l.locale)).toEqual(["en"]);
  });
});
