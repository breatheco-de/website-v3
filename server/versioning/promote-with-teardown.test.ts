import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const seoGateMock = vi.hoisted(() => ({ result: null as null | Record<string, unknown> }));
vi.mock("../live-entry-seo-gate", () => ({
  assertLiveEntrySeoAndRequiredFields: () => null,
  evaluateLiveEntrySeoAndRequiredFields: () => seoGateMock.result,
}));
vi.mock("../locale-url-slug", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../locale-url-slug")>()),
  assertLocaleUrlAvailable: () => ({ ok: true }),
}));
vi.mock("../routes/_helpers", () => ({ invalidateContentCaches: () => {} }));
vi.mock("../content-events", () => ({ emitEntryLocalePromoted: () => {} }));
vi.mock("../sitemap", () => ({ refreshSitemapEntriesForContentKey: () => {} }));
vi.mock("../ssr-schema", () => ({ clearSsrSchemaCache: () => {} }));
vi.mock("../seo-index", () => ({ syncSeoIndexEntryFromLiveDisk: () => {} }));
vi.mock("../published-at", () => ({ ensurePublishedAtOnce: () => {} }));
vi.mock("../product/funnel-audience-gates", () => ({
  assertFunnelAudienceGates: () => ({ ok: true, warnings: [] }),
}));
const textLimitsMock = vi.hoisted(() => ({
  violations: [] as Array<Record<string, unknown>>,
  calls: [] as Array<{ before: unknown }>,
}));
vi.mock("../text-limits", () => ({
  evaluatePageTextLimitsForSite: (_page: unknown, opts: { before?: unknown }) => {
    textLimitsMock.calls.push({ before: opts.before });
    return textLimitsMock.violations;
  },
}));

const redirectScreenMock = vi.hoisted(() => ({
  result: null as null | { content: string; changed: boolean; skipped: Array<{ from: string; code: string; message: string }> },
}));
vi.mock("../redirect-draft", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../redirect-draft")>();
  return {
    ...actual,
    screenPublishedRedirects: (opts: Parameters<typeof actual.screenPublishedRedirects>[0]) =>
      redirectScreenMock.result ?? actual.screenPublishedRedirects(opts),
  };
});
const redirectCacheMock = vi.hoisted(() => ({ cleared: 0, validations: 0 }));
vi.mock("../redirects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../redirects")>()),
  clearRedirectCache: () => void redirectCacheMock.cleared++,
}));
vi.mock("../services/onSaveValidation", () => ({
  scheduleRedirectsValidation: () => void redirectCacheMock.validations++,
}));

import { resetRegistry } from "../content-types";
import { markFileAsModified } from "../sync-state";
import {
  displayValueChanges,
  promoteVariantWithOptionalTeardown,
  routeSharedFieldsOnPromote,
} from "./promote-with-teardown";
import { recordDraftBase, createMemoryDraftBaseStore, setDraftBaseStore } from "./draft-base";
import { writeDraftMeta } from "./draft-meta";

vi.mock("../sync-state", () => ({ markFileAsModified: vi.fn() }));

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;
let entryDir: string;

function write(rel: string, content: string) {
  const p = path.join(entryDir, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, content, "utf-8");
}
function read(rel: string): string {
  return fs.readFileSync(path.join(entryDir, rel), "utf-8");
}
function load(rel: string): Record<string, any> {
  return yaml.load(read(rel)) as Record<string, any>;
}

function versioningManagerStub() {
  const vPath = () => path.join(entryDir, "versioning.yml");
  return {
    getVersioningContentDir: () => entryDir,
    getVariantFilePath: (_t: string, _s: string, v: string, l: string) => path.join(entryDir, `${v}.${l}.yml`),
    getVersioningForContent: () => (fs.existsSync(vPath()) ? (yaml.load(fs.readFileSync(vPath(), "utf-8")) as any) : null),
    updateVersioning: (_t: string, _s: string, data: unknown) => fs.writeFileSync(vPath(), yaml.dump(data)),
    deleteVersioningConfig: () => {
      if (!fs.existsSync(vPath())) return false;
      fs.unlinkSync(vPath());
      return true;
    },
  };
}

const ciStub = {
  safeYamlLoad: (raw: string) => yaml.load(raw) as Record<string, unknown>,
  loadCommonData: () => {
    const p = path.join(entryDir, "_common.yml");
    return fs.existsSync(p) ? (yaml.load(fs.readFileSync(p, "utf-8")) as Record<string, unknown>) : null;
  },
  invalidateCommonFields: () => {},
  refresh: () => {},
  refreshAfterRedirectWrite: vi.fn(),
};
const cacheStub = { clearEntryKey: () => {}, flush: async () => {} };

function promote(extra: Record<string, unknown> = {}) {
  return promoteVariantWithOptionalTeardown({
    contentType: "blog",
    slug: "post-a",
    locale: "en",
    variantSlug: "draft",
    author: "tester",
    contentRoot,
    contentRootName: "site_test",
    folder: "blog",
    templateMode: false,
    versioningManager: versioningManagerStub() as never,
    ci: ciStub as never,
    cache: cacheStub as never,
    ...extra,
  });
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "promote-teardown-"));
  contentRoot = path.join(tempDir, "site_test");
  entryDir = path.join(contentRoot, "blog", "post-a");
  fs.mkdirSync(entryDir, { recursive: true });
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    `blog:
  directory: blog
  url_pattern:
    en: /en/blog/:slug
`,
    "utf-8",
  );
  process.chdir(tempDir);
  resetRegistry(contentRoot);
  setDraftBaseStore(createMemoryDraftBaseStore());
  write("_common.yml", "meta:\n  robots: noindex\n  priority: 0.5\nfunnel:\n  stage: awareness\n");
  write("en.yml", "slug: post-a\ntitle: Live title\nseo:\n  main_keyword: live-kw\nsections: []\n");
  write("versioning.yml", "en:\n  variants:\n    - slug: draft\n      allocation: 0\n");
  vi.mocked(markFileAsModified).mockClear();
  redirectScreenMock.result = null;
  redirectCacheMock.cleared = 0;
  redirectCacheMock.validations = 0;
  ciStub.refreshAfterRedirectWrite.mockClear();
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  resetRegistry(contentRoot);
  fs.rmSync(tempDir, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("routeSharedFieldsOnPromote", () => {
  it("moves page-level fields to _common and deletes null markers", () => {
    const routed = routeSharedFieldsOnPromote({
      draftRaw: "title: T\nfunnel:\n  stage: decision\nauthors: null\nmeta:\n  robots: null\n  page_title: P\n",
      commonRaw: "authors:\n  - a\nfunnel:\n  stage: awareness\n",
    });
    const common = yaml.load(routed.commonRaw!) as Record<string, any>;
    const locale = yaml.load(routed.localeRaw) as Record<string, any>;
    expect(common.funnel.stage).toBe("decision");
    expect(common.authors).toBeUndefined();
    expect(locale.funnel).toBeUndefined();
    expect(locale.meta).toEqual({ page_title: "P" });
    expect(routed.localeRaw).not.toContain("null");
  });

  it("keeps robots in the locale file and drops its null removal marker", () => {
    const routed = routeSharedFieldsOnPromote({
      draftRaw: "title: T\nmeta:\n  robots: null\n  priority: 0.4\n",
      commonRaw: "funnel:\n  stage: awareness\n",
    });
    expect(routed.commonChanged).toBe(false);
    expect(routed.paths).toEqual([]);
    expect(yaml.load(routed.localeRaw)).toEqual({ title: "T", meta: { priority: 0.4 } });
  });
});

describe("displayValueChanges", () => {
  it("lists legacy page-level copies that publish replaces with _common.yml", () => {
    const changes = displayValueChanges({
      liveRaw: "title: T\npublished_at: '2026-01-15'\nfunnel:\n  products:\n    - product: x\n      persona: p\n",
      commonBeforeRaw: "published_at: ''\nfunnel:\n  stage: awareness\n  products:\n    - x\n",
      commonAfterRaw: "published_at: ''\nfunnel:\n  stage: awareness\n  products:\n    - x\n",
    });
    expect(changes.map((c) => c.field_path)).toEqual(["published_at", "funnel"]);
    expect(changes[1]!.before).toEqual({ stage: "awareness", products: [{ product: "x", persona: "p" }] });
    expect(changes[1]!.after).toEqual({ stage: "awareness", products: ["x"] });
  });

  it("is silent when the legacy copy matches what remains, or there is none", () => {
    expect(
      displayValueChanges({
        liveRaw: "title: T\nauthors:\n  - a\nmeta:\n  robots: noindex\n",
        commonBeforeRaw: "authors:\n  - a\n",
        commonAfterRaw: "authors:\n  - a\n",
      }),
    ).toEqual([]);
    expect(displayValueChanges({ liveRaw: "title: T\n", commonBeforeRaw: null, commonAfterRaw: null })).toEqual([]);
  });
});

describe("promote: old addresses (meta.redirects)", () => {
  it("publishes without conflicting added addresses, warns, and refreshes redirects", async () => {
    write("draft.en.yml", "slug: post-a\ntitle: Live title\nmeta:\n  redirects:\n    - /en/fresh\n    - /en/taken\nsections: []\n");
    recordDraftBase({ contentType: "blog", slug: "post-a", locale: "en", variant: "draft", contentRoot });
    redirectScreenMock.result = {
      content: "slug: post-a\ntitle: Live title\nmeta:\n  redirects:\n    - /en/fresh\nsections: []\n",
      changed: true,
      skipped: [{ from: "/en/taken", code: "live_content", message: "/en/taken is already a live page. A redirect would hide it." }],
    };
    const res = await promote();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(load("en.yml").meta.redirects).toEqual(["/en/fresh"]);
    const warning = res.warnings.find((w) => w.code === "draft_redirects_skipped");
    expect(warning?.fields).toEqual(["meta.redirects[/en/taken]"]);
    expect(warning?.details).toEqual({ skipped: redirectScreenMock.result.skipped });
    expect(ciStub.refreshAfterRedirectWrite).toHaveBeenCalledWith(path.join(entryDir, "en.yml"));
    expect(redirectCacheMock.cleared).toBe(1);
    expect(redirectCacheMock.validations).toBe(1);
  });

  it("does not touch redirects when the publish leaves old addresses unchanged", async () => {
    write("draft.en.yml", "slug: post-a\ntitle: New title\nsections: []\n");
    recordDraftBase({ contentType: "blog", slug: "post-a", locale: "en", variant: "draft", contentRoot });
    const res = await promote();
    expect(res.ok).toBe(true);
    expect(ciStub.refreshAfterRedirectWrite).not.toHaveBeenCalled();
    expect(redirectCacheMock.cleared).toBe(0);
  });
});

describe("promoteVariantWithOptionalTeardown", () => {
  it("routes funnel to _common, applies draft seo, strips _draft, deletes the last versioning.yml", async () => {
    write(
      "draft.en.yml",
      "slug: post-a\ntitle: Draft title\nseo:\n  main_keyword: draft-kw\nfunnel:\n  stage: decision\nmeta:\n  robots: null\nsections: []\n",
    );
    recordDraftBase({ contentType: "blog", slug: "post-a", locale: "en", variant: "draft", contentRoot });
    const res = await promote();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const common = load("_common.yml");
    expect(common.funnel.stage).toBe("decision");
    expect(common.meta).toEqual({ robots: "noindex", priority: 0.5 });
    const live = read("en.yml");
    expect(live).not.toContain("_draft");
    expect(live).not.toContain("funnel");
    expect(live).not.toContain("null");
    expect(load("en.yml").seo.main_keyword).toBe("draft-kw");
    expect(load("en.yml").title).toBe("Draft title");
    expect(fs.existsSync(path.join(entryDir, "versioning.yml"))).toBe(false);
    expect(fs.existsSync(path.join(entryDir, "draft.en.yml"))).toBe(false);
    expect(res.versioningDeleted).toBe(true);
    expect(res.publishedDiff.map((c) => c.field_path)).toEqual(
      expect.arrayContaining(["funnel", "seo.main_keyword", "title"]),
    );
    expect(res.preApplySnapshot.live).toContain("Live title");
  });

  it("returns schema_org_page_url_mismatch (not seo_gate) with details and leaves live untouched", async () => {
    write("draft.en.yml", "slug: post-a\ntitle: Draft title\nsections: []\n");
    recordDraftBase({ contentType: "blog", slug: "post-a", locale: "en", variant: "draft", contentRoot });
    const mismatch = { section_id: "schema_org-1", field: "url", value: "https://4geeks.com/en/x" };
    seoGateMock.result = {
      code: "schema_org_page_url_mismatch",
      message: "SCHEMA_ORG_PAGE_URL_MISMATCH: …",
      schema_org_page_url_mismatches: [mismatch],
    };
    try {
      const res = await promote({ viaProposalApply: true });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("schema_org_page_url_mismatch");
        expect(res.error).toContain("SCHEMA_ORG_PAGE_URL_MISMATCH");
        expect(res.details).toEqual({ schema_org_page_url_mismatches: [mismatch] });
      }
      expect(load("en.yml").title).toBe("Live title");
    } finally {
      seoGateMock.result = null;
    }
  });

  it("asks before publishing when the live locale file holds a differing legacy page-level copy", async () => {
    write("en.yml", "slug: post-a\ntitle: Live title\nfunnel:\n  stage: consideration\nsections: []\n");
    write("draft.en.yml", "slug: post-a\ntitle: Draft title\nsections: []\n");
    recordDraftBase({ contentType: "blog", slug: "post-a", locale: "en", variant: "draft", contentRoot });

    const blocked = await promote();
    expect(blocked.ok).toBe(false);
    if (!blocked.ok) {
      expect(blocked.code).toBe("display_values_change");
      expect(blocked.details).toMatchObject({
        locale: "en",
        fields: [{ field_path: "funnel", before: { stage: "consideration" }, after: { stage: "awareness" } }],
        paths: { common: "blog/post-a/_common.yml", locale: "blog/post-a/en.yml" },
      });
    }
    expect(load("en.yml").title).toBe("Live title");

    const proposalDry = await promote({ viaProposalApply: true, dryRun: true });
    expect(proposalDry.ok).toBe(true);
    if (proposalDry.ok) {
      expect(proposalDry.warnings.find((w) => w.code === "display_values_change")?.fields).toEqual(["funnel"]);
    }

    const confirmed = await promote({ confirmDisplayChange: true });
    expect(confirmed.ok).toBe(true);
    expect(load("en.yml").funnel).toBeUndefined();
    expect(load("_common.yml").funnel).toEqual({ stage: "awareness" });
  });

  it("keeps live seo when the draft has none", async () => {
    write("draft.en.yml", "slug: post-a\ntitle: Draft title\nsections: []\n");
    recordDraftBase({ contentType: "blog", slug: "post-a", locale: "en", variant: "draft", contentRoot });
    const res = await promote();
    expect(res.ok).toBe(true);
    expect(load("en.yml").seo.main_keyword).toBe("live-kw");
  });

  it("rejects direct publish for swarm roles and drafts linked to a proposal", async () => {
    write("draft.en.yml", "slug: post-a\ntitle: Draft\nsections: []\n");
    recordDraftBase({ contentType: "blog", slug: "post-a", locale: "en", variant: "draft", contentRoot });
    const swarm = await promote({ callerIsSwarm: true });
    expect(swarm.ok).toBe(false);
    if (!swarm.ok) expect(swarm.code).toBe("proposal_required");

    writeDraftMeta(path.join(entryDir, "draft.en.yml"), { proposal: { id: "p-1", env: "production" } }, { skipMark: true });
    const linked = await promote();
    expect(linked.ok).toBe(false);
    if (!linked.ok) {
      expect(linked.code).toBe("draft_in_proposal");
      expect(linked.details).toMatchObject({ proposal_id: "p-1", env: "production" });
    }
    const viaApply = await promote({ viaProposalApply: true });
    expect(viaApply.ok).toBe(true);
  });

  it("rebuilds a stale draft when fields do not overlap", async () => {
    write("draft.en.yml", "slug: post-a\ntitle: Draft title\nsections: []\nseo:\n  main_keyword: live-kw\n");
    recordDraftBase({ contentType: "blog", slug: "post-a", locale: "en", variant: "draft", contentRoot });
    write("en.yml", "slug: post-a\ntitle: Live title\ndescription: Added on live\nseo:\n  main_keyword: live-kw\nsections: []\n");
    const res = await promote();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.warnings.map((w) => w.code)).toContain("draft_rebuilt");
    expect(load("en.yml").title).toBe("Draft title");
    expect(load("en.yml").description).toBe("Added on live");
  });

  it("rejects a stale draft with conflicting fields unless confirmed", async () => {
    write("draft.en.yml", "slug: post-a\ntitle: Draft title\nsections: []\nseo:\n  main_keyword: live-kw\n");
    recordDraftBase({ contentType: "blog", slug: "post-a", locale: "en", variant: "draft", contentRoot });
    write("en.yml", "slug: post-a\ntitle: Staff fixed title\nseo:\n  main_keyword: live-kw\nsections: []\n");
    const res = await promote();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("draft_base_stale");
      expect((res.details?.conflicting_fields as Array<{ field_path: string }>)[0]!.field_path).toBe("title");
    }
    const forced = await promote({ confirmOverwriteNewerLive: true });
    expect(forced.ok).toBe(true);
    expect(load("en.yml").title).toBe("Draft title");
  });

  it("asks for confirmation when the draft has no recorded base and live exists", async () => {
    write("draft.en.yml", "slug: post-a\ntitle: Draft\nsections: []\n");
    const res = await promote();
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("draft_base_unknown");
  });

  it("publishes a first locale without a recorded base", async () => {
    fs.unlinkSync(path.join(entryDir, "en.yml"));
    write("draft.en.yml", "slug: post-a\ntitle: Draft\nsections: []\n");
    const res = await promote();
    expect(res.ok).toBe(true);
  });

  it("a new language of a live page needs its own slug (staff included); a chosen slug is written", async () => {
    write("draft.es.yml", "title: Borrador\nsections: []\n");
    const es = (extra: Record<string, unknown> = {}) => promote({ locale: "es", ...extra });
    const refused = await es();
    expect(refused.ok).toBe(false);
    if (!refused.ok) {
      expect(refused.code).toBe("locale_url_slug_required");
      expect(refused.details).toMatchObject({ locale: "es", current_slug: "post-a", property_path: "slug" });
    }
    expect(fs.existsSync(path.join(entryDir, "es.yml"))).toBe(false);

    const bad = await es({ localeUrlSlugs: { es: "Mal Slug" } });
    expect(!bad.ok && bad.code).toBe("invalid_locale_slug");

    const ok = await es({ localeUrlSlugs: { es: "publicacion-a" } });
    expect(ok.ok).toBe(true);
    expect(load("es.yml").slug).toBe("publicacion-a");
    expect(load("es.yml").title).toBe("Borrador");
  });

  it("keeping the folder word on purpose (explicit slug) publishes and warns when it looks like another language", async () => {
    fs.renameSync(entryDir, path.join(contentRoot, "blog", "what-is-x"));
    entryDir = path.join(contentRoot, "blog", "what-is-x");
    write("draft.es.yml", "slug: what-is-x\ntitle: Borrador\nsections: []\n");
    const res = await promote({ slug: "what-is-x", locale: "es" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.warnings.find((w) => w.code === "slug_locale_mismatch")?.fields).toEqual(["slug"]);
    expect(load("es.yml").slug).toBe("what-is-x");
  });

  it("dry run writes nothing", async () => {
    write("draft.en.yml", "slug: post-a\ntitle: Draft title\nsections: []\n");
    recordDraftBase({ contentType: "blog", slug: "post-a", locale: "en", variant: "draft", contentRoot });
    const before = read("en.yml");
    const res = await promote({ dryRun: true });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.dryRun).toBe(true);
    expect(read("en.yml")).toBe(before);
    expect(fs.existsSync(path.join(entryDir, "draft.en.yml"))).toBe(true);
  });

  it("restores _common.yml when the live write fails", async () => {
    write("draft.en.yml", "slug: post-a\ntitle: Draft\nfunnel:\n  stage: decision\nsections: []\n");
    recordDraftBase({ contentType: "blog", slug: "post-a", locale: "en", variant: "draft", contentRoot });
    const commonBefore = read("_common.yml");
    const realWrite = fs.writeFileSync;
    vi.spyOn(fs, "writeFileSync").mockImplementation(((p: fs.PathOrFileDescriptor, ...rest: unknown[]) => {
      if (String(p).endsWith(`${path.sep}en.yml`)) throw new Error("disk full");
      return (realWrite as (...a: unknown[]) => void)(p, ...rest);
    }) as typeof fs.writeFileSync);
    const res = await promote();
    expect(res.ok).toBe(false);
    vi.restoreAllMocks();
    expect(read("_common.yml")).toBe(commonBefore);
    expect(fs.existsSync(path.join(entryDir, "draft.en.yml"))).toBe(true);
  });

  describe("text limits", () => {
    const violation = {
      label: "H1",
      fields: ["brand_mark.prefix", "brand_mark.highlight", "brand_mark.suffix"],
      section_path: "sections[0]",
      kind: "length",
      actual: 94,
      max: 70,
      text: "x".repeat(94),
      message: "H1 has 94 visible characters (max 70) at sections[0]",
    };
    beforeEach(() => {
      write("draft.en.yml", "slug: post-a\ntitle: Draft\nsections: []\n");
      recordDraftBase({ contentType: "blog", slug: "post-a", locale: "en", variant: "draft", contentRoot });
      textLimitsMock.violations = [violation];
      textLimitsMock.calls = [];
    });
    afterEach(() => {
      textLimitsMock.violations = [];
    });

    it("compares against live and blocks staff until confirmed", async () => {
      const res = await promote();
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("text_limits_exceeded");
        expect(res.error).toContain("confirm to publish anyway");
        expect(res.details).toEqual({ violations: [violation] });
      }
      expect(textLimitsMock.calls[0]!.before).toMatchObject({ title: "Live title" });
      expect(load("en.yml").title).toBe("Live title");

      const confirmed = await promote({ confirmTextLimits: true });
      expect(confirmed.ok).toBe(true);
      if (confirmed.ok) expect(confirmed.warnings.map((w) => w.code)).toContain("text_limits_confirmed");
      expect(load("en.yml").title).toBe("Draft");
    });

    it("agents (MCP) stay blocked even with the confirmation", async () => {
      const res = await promote({ callerIsMcp: true, confirmTextLimits: true });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("text_limits_exceeded");
        expect(res.error).toContain("Shorten it on the draft");
      }
    });

    it("passes when nothing is over the limit", async () => {
      textLimitsMock.violations = [];
      expect((await promote({ callerIsMcp: true })).ok).toBe(true);
    });
  });

  describe("robots change on publish", () => {
    it("asks when a draft without robots would make a noindex page indexable", async () => {
      write("_common.yml", "funnel:\n  stage: awareness\n");
      write("en.yml", "slug: post-a\ntitle: Live title\nmeta:\n  robots: noindex\nsections: []\n");
      write("draft.en.yml", "slug: post-a\ntitle: Draft\nsections: []\n");
      recordDraftBase({ contentType: "blog", slug: "post-a", locale: "en", variant: "draft", contentRoot });
      const res = await promote();
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("robots_change_on_publish");
        expect(res.status).toBe(409);
        expect(res.details).toMatchObject({
          locale: "en",
          live_robots: "noindex",
          draft_robots: "index, follow",
          paths: { locale: "blog/post-a/en.yml" },
        });
      }
      expect(load("en.yml").title).toBe("Live title");
      expect(fs.existsSync(path.join(entryDir, "draft.en.yml"))).toBe(true);
    });

    it("also asks on dry run", async () => {
      write("draft.en.yml", "slug: post-a\ntitle: Draft\nmeta:\n  robots: index, follow\nsections: []\n");
      recordDraftBase({ contentType: "blog", slug: "post-a", locale: "en", variant: "draft", contentRoot });
      const res = await promote({ dryRun: true });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe("robots_change_on_publish");
    });

    it("keep_live publishes the draft but keeps the live robots", async () => {
      write("_common.yml", "funnel:\n  stage: awareness\n");
      write("en.yml", "slug: post-a\ntitle: Live title\nmeta:\n  robots: noindex\n  page_title: Live\nsections: []\n");
      write("draft.en.yml", "slug: post-a\ntitle: Draft\nmeta:\n  robots: index, follow\n  page_title: Draft P\nsections: []\n");
      recordDraftBase({ contentType: "blog", slug: "post-a", locale: "en", variant: "draft", contentRoot });
      const res = await promote({ robotsOnPublish: "keep_live" });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const live = load("en.yml");
      expect(live.title).toBe("Draft");
      expect(live.meta).toEqual({ robots: "noindex", page_title: "Draft P" });
      expect(res.warnings.find((w) => w.code === "robots_on_publish")?.details).toMatchObject({
        choice: "keep_live",
        live_robots: "noindex",
        draft_robots: "index, follow",
      });
    });

    it("keep_live drops the draft's robots when live inherited it from _common.yml", async () => {
      write("draft.en.yml", "slug: post-a\ntitle: Draft\nmeta:\n  robots: index, follow\nsections: []\n");
      recordDraftBase({ contentType: "blog", slug: "post-a", locale: "en", variant: "draft", contentRoot });
      const res = await promote({ robotsOnPublish: "keep_live" });
      expect(res.ok).toBe(true);
      expect(load("en.yml").meta).toBeUndefined();
    });

    it("use_draft publishes the draft's robots", async () => {
      write("draft.en.yml", "slug: post-a\ntitle: Draft\nmeta:\n  robots: index, follow\nsections: []\n");
      recordDraftBase({ contentType: "blog", slug: "post-a", locale: "en", variant: "draft", contentRoot });
      const res = await promote({ robotsOnPublish: "use_draft" });
      expect(res.ok).toBe(true);
      expect(load("en.yml").meta.robots).toBe("index, follow");
    });

    it("does not ask when robots stay the same (spelling of the default included)", async () => {
      write("_common.yml", "funnel:\n  stage: awareness\n");
      write("en.yml", "slug: post-a\ntitle: Live title\nsections: []\n");
      write("draft.en.yml", "slug: post-a\ntitle: Draft\nmeta:\n  robots: Index,Follow\nsections: []\n");
      recordDraftBase({ contentType: "blog", slug: "post-a", locale: "en", variant: "draft", contentRoot });
      const res = await promote();
      expect(res.ok).toBe(true);
      if (res.ok) expect(res.warnings.some((w) => w.code === "robots_on_publish")).toBe(false);
    });

    it("does not ask for a new language with no live file", async () => {
      fs.unlinkSync(path.join(entryDir, "en.yml"));
      write("es.yml", "slug: post-a-es\ntitle: Vivo\nsections: []\n");
      write("draft.en.yml", "slug: post-a-en\ntitle: Draft\nmeta:\n  robots: index, follow\nsections: []\n");
      recordDraftBase({ contentType: "blog", slug: "post-a", locale: "en", variant: "draft", contentRoot });
      const res = await promote();
      if (!res.ok) expect(res.code).not.toBe("robots_change_on_publish");
    });
  });

  it("rejects attached drafts that carry structure", async () => {
    fs.writeFileSync(
      path.join(contentRoot, "content-types.yml"),
      `blog:
  directory: blog
  single_template: true
  url_pattern:
    en: /en/blog/:slug
`,
      "utf-8",
    );
    resetRegistry(contentRoot);
    write("draft.en.yml", "slug: post-a\ntitle: Draft\nsections:\n  - type: hero\n");
    recordDraftBase({ contentType: "blog", slug: "post-a", locale: "en", variant: "draft", contentRoot });
    const res = await promote();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.code).toBe("attached_draft_structure");
      expect(res.details?.property_path).toBe("sections");
    }
  });
});
