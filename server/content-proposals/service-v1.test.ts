import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { createHash } from "crypto";
import { splitByFieldScope } from "@shared/field-scope";
import { setAtPath, deleteAtPath, cloneJson } from "@shared/object-path";
import { clearSiteSqliteCacheForTests, getSiteSqlite } from "../db";
import { ensurePipelineDb, resetPipelineDbCache } from "../pipeline-db/runner";
import { listEvents } from "../events/event-store";
import { setLiveServerForTests } from "../live-server";
import { hashVariantFileContents, type DraftProposalLink } from "../versioning/draft-meta";
import type { FieldChange } from "../versioning/draft-base";
import type { ProposalDraftRef, ProposalDraftStore } from "./draft-store";
import {
  absorbDraftEdit,
  createProposalService,
  exportAllProposals,
  isSystemDraftEditor,
  replaceProposalsFromSnapshot,
  toProposalSummary,
  type IdeaSeoHubFacts,
  type IdeaSeoTargetDeps,
  type PromoteEntryOpts,
  type PromoteEntryResult,
  type ProposalEntryInput,
  type ProposalEntryRow,
} from "./service";

const SITE = `site_proposal-v1-test-${Date.now()}`;
const SUMMARY = "Rewrite the page title so it matches the main keyword and the search intent of the post. ".repeat(2);

function rmSite(): void {
  const dir = path.join("data", SITE.replace(/\//g, "-"));
  if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
}

type FakeDraft = {
  data: Record<string, unknown>;
  base: Record<string, unknown>;
  link: DraftProposalLink | null;
  alloc: number | null;
  baseStatus: "ok" | "stale" | "unknown";
};

const keyOf = (r: ProposalDraftRef) => `${r.contentType}/${r.slug}/${r.locale}/${r.variant}`;
const hash = (v: unknown) => createHash("sha256").update(JSON.stringify(v)).digest("hex").slice(0, 16);

function fakeDraftStore(live: Record<string, Record<string, unknown>> = {}) {
  const drafts = new Map<string, FakeDraft>();
  const entries = new Set<string>(["blog/hello", "blog/other"]);
  const liveOf = (r: ProposalDraftRef) => live[`${r.contentType}/${r.slug}/${r.locale}`] ?? null;
  const removed: string[] = [];
  const store: ProposalDraftStore = {
    entryExists: (ct, slug) => entries.has(`${ct}/${slug}`),
    exists: (r) => drafts.has(keyOf(r)),
    liveExists: (e) => live[`${e.contentType}/${e.slug}/${e.locale}`] != null,
    pathOf: (r) => path.join(os.tmpdir(), "fake-drafts", keyOf(r)),
    pickVariant(e, id, o) {
      const free = (v: string) => !drafts.has(keyOf({ ...e, variant: v }));
      if (!o?.ownName && free("draft")) return "draft";
      return `draft-p${id.replace(/[^a-z0-9]/gi, "").slice(0, 6).toLowerCase()}`;
    },
    create(r, opts) {
      if (!entries.has(`${r.contentType}/${r.slug}`)) {
        if (!opts.newEntry) return { ok: false, code: "entry_not_found", error: "no page" };
        entries.add(`${r.contentType}/${r.slug}`);
      }
      const base = cloneJson(liveOf(r) ?? (opts.seo ? { seo: opts.seo } : {}));
      drafts.set(keyOf(r), { data: cloneJson(base), base, link: null, alloc: 0, baseStatus: "ok" });
      return { ok: true };
    },
    allocation: (r) => drafts.get(keyOf(r))?.alloc ?? null,
    isAttached: () => false,
    structureError: (r) => {
      const d = drafts.get(keyOf(r));
      return d && Array.isArray(d.data.layout) ? "layout is not allowed" : null;
    },
    reset(r) {
      const d = drafts.get(keyOf(r))!;
      d.base = cloneJson(liveOf(r) ?? {});
      d.data = cloneJson(d.base);
      d.baseStatus = "ok";
    },
    snapshotRaw: (r) => (drafts.has(keyOf(r)) ? JSON.stringify(drafts.get(keyOf(r))!.data) : null),
    restoreRaw(r, raw) {
      drafts.get(keyOf(r))!.data = JSON.parse(raw);
    },
    async write(r, updates) {
      const d = drafts.get(keyOf(r));
      if (!d) return { ok: false, code: "draft_missing", error: "missing" };
      if (updates.some((u) => u.field_path === "boom")) return { ok: false, code: "write_failed", error: "boom" };
      for (const u of updates) {
        if (u.reset || u.op === "remove") deleteAtPath(d.data, u.field_path);
        else setAtPath(d.data, u.field_path, u.value);
      }
      return { ok: true, warnings: [] };
    },
    fingerprint: (r) => (drafts.has(keyOf(r)) ? hash(drafts.get(keyOf(r))!.data) : null),
    carriesCommon: (r) => {
      const d = drafts.get(keyOf(r));
      return d ? Object.keys(splitByFieldScope(d.data).common).length > 0 : false;
    },
    readLink: (r) => drafts.get(keyOf(r))?.link ?? null,
    link(r, link) {
      const d = drafts.get(keyOf(r));
      if (d) d.link = link;
    },
    async remove(r) {
      drafts.delete(keyOf(r));
      removed.push(keyOf(r));
      return { entryDeleted: false };
    },
    authorDiff(r) {
      const d = drafts.get(keyOf(r));
      if (!d) return null;
      const changes: FieldChange[] = [];
      for (const k of new Set([...Object.keys(d.base), ...Object.keys(d.data)])) {
        const before = d.base[k];
        const after = d.data[k];
        if (JSON.stringify(before) === JSON.stringify(after)) continue;
        changes.push({
          field_path: k,
          before,
          after,
          scope: k === "funnel" ? "common" : "locale",
          ...(after === undefined ? { removed: true } : {}),
        });
      }
      return { approximate: false, changes };
    },
    derivedKey: (r) => (drafts.has(keyOf(r)) ? `${hash(drafts.get(keyOf(r))!.data)}|${hash(drafts.get(keyOf(r))!.base)}` : null),
    checkBase: (r) => {
      const s = drafts.get(keyOf(r))?.baseStatus ?? "ok";
      return s === "stale"
        ? { status: "stale", changed: ["locale"], based_on: { locale: "x", common: null, at: "2026-01-01T00:00:00Z" } }
        : { status: s };
    },
    rebuild: () => ({ ok: false, reason: "conflict", conflicting_fields: [{ field_path: "title", author: "A", live: "B" }] }),
    checkSource: () => ({ status: "none" }),
    recordBase() {},
    recordSource() {},
    liveValue: (e, p) => (live[`${e.contentType}/${e.slug}/${e.locale}`] ?? {})[p],
    listLinkedDrafts: () =>
      Array.from(drafts.entries())
        .filter(([, d]) => d.link)
        .map(([k, d]) => {
          const [contentType, slug, locale, variant] = k.split("/") as [string, string, string, string];
          return { ref: { contentType, slug, locale, variant }, link: d.link! };
        }),
  };
  return { store, drafts, entries, removed };
}

function makeService(opts: {
  store: ProposalDraftStore;
  promote?: (entry: ProposalEntryRow, o: PromoteEntryOpts) => PromoteEntryResult;
  extraDeps?: Partial<Parameters<typeof createProposalService>[0]>;
}) {
  const applyUpdates = vi.fn(async () => ({ ok: true }));
  const promoteCalls: Array<{ entry: ProposalEntryRow; opts: PromoteEntryOpts }> = [];
  const svc = createProposalService({
    site: SITE,
    issueExists: () => true,
    captureBaseline: () => ({ values: {} }),
    applyUpdates,
    draftStore: opts.store,
    ...opts.extraDeps,
    promoteEntry: async (entry, _author, o) => {
      promoteCalls.push({ entry, opts: o });
      return (
        opts.promote?.(entry, o) ?? {
          ok: true,
          published_diff: [{ field_path: "title", before: "Old", after: "New", scope: "locale" }],
          pre_apply_snapshot: { live: "title: Old\n", common: null },
        }
      );
    },
  });
  return { svc, applyUpdates, promoteCalls };
}

function entry(overrides: Partial<ProposalEntryInput> = {}): ProposalEntryInput {
  return {
    contentType: "blog",
    slug: "hello",
    locale: "es",
    updates: [{ field_path: "title", value: "New" }],
    ...overrides,
  };
}

describe("proposals v1.0 (draft-first)", () => {
  beforeEach(() => {
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    rmSite();
    ensurePipelineDb(SITE, { skipBackup: true });
  });

  afterEach(() => {
    resetPipelineDbCache();
    clearSiteSqliteCacheForTests();
    rmSite();
  });

  it("create writes updates into a new draft, links it and never touches live", async () => {
    const fake = fakeDraftStore({ "blog/hello/es": { title: "Old", description: "Keep" } });
    const { svc, applyUpdates } = makeService({ store: fake.store });
    const res = await svc.create({ title: "Title fix", summary: SUMMARY, entries: [entry()] }, { username: "alice" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const p = res.proposal;
    expect(p.system_version).toBe("1.0");
    expect(p.review_mode).toBe("draft_backed");
    const e = p.entries[0]!;
    expect(e.variant).toBe("draft");
    expect(e.created_draft).toBe(true);
    expect(e.ops).toEqual([{ field_path: "title", value: "New" }]);
    expect(e.baseline_context.values).toEqual({ title: "Old" });
    expect(e.requested_ops).toEqual([{ field_path: "title", value: "New" }]);
    expect(e.ops_match_request).toBe(true);
    const d = fake.drafts.get("blog/hello/es/draft")!;
    expect(d.data).toEqual({ title: "New", description: "Keep" });
    expect(d.link).toMatchObject({ id: p.id, created_by_proposal: true });
    expect(applyUpdates).not.toHaveBeenCalled();
    expect(() => (e.ops as unknown as unknown[]).push({})).toThrow();
  });

  it("does not adopt a free staff draft: picks draft-p{id6} instead", async () => {
    const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" } });
    fake.store.create({ contentType: "blog", slug: "hello", locale: "es", variant: "draft" }, { author: "staff" });
    const { svc } = makeService({ store: fake.store });
    const res = await svc.create({ title: "Title fix", summary: SUMMARY, entries: [entry()] }, { username: "alice" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const e = res.proposal.entries[0]!;
    expect(e.variant).toMatch(/^draft-p[a-z0-9]{6}$/);
    expect(fake.drafts.get("blog/hello/es/draft")!.data).toEqual({ title: "Old" });
  });

  it("uses an explicit existing draft without marking it created", async () => {
    const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" } });
    fake.store.create({ contentType: "blog", slug: "hello", locale: "es", variant: "translation" }, { author: "t" });
    const { svc } = makeService({ store: fake.store });
    const res = await svc.create(
      { title: "Title fix", summary: SUMMARY, entries: [entry({ variant: "translation" })] },
      { username: "alice" },
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.proposal.entries[0]!.created_draft).toBeUndefined();
    expect(fake.drafts.get("blog/hello/es/translation")!.link?.created_by_proposal).toBeUndefined();
  });

  it("rejects variants with traffic (experiments)", async () => {
    const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" } });
    fake.store.create({ contentType: "blog", slug: "hello", locale: "es", variant: "exp" }, { author: "s" });
    fake.drafts.get("blog/hello/es/exp")!.alloc = 50;
    const { svc } = makeService({ store: fake.store });
    const res = await svc.create(
      { title: "Title fix", summary: SUMMARY, entries: [entry({ variant: "exp" })] },
      { username: "alice" },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("variant_has_traffic");
  });

  it("allows one open proposal with page-level fields per page (competing_shared_fields)", async () => {
    const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" }, "blog/hello/en": { title: "Old EN" } });
    const { svc } = makeService({ store: fake.store });
    const a = await svc.create(
      {
        title: "Funnel",
        summary: SUMMARY,
        entries: [entry({ updates: [{ field_path: "funnel.stage", value: "awareness" }] })],
      },
      { username: "alice" },
    );
    expect(a.ok).toBe(true);
    const b = await svc.create(
      {
        title: "Funnel EN",
        summary: SUMMARY,
        entries: [entry({ locale: "en", updates: [{ field_path: "funnel.stage", value: "consideration" }] })],
      },
      { username: "carol" },
    );
    expect(b.ok).toBe(false);
    if (!b.ok && a.ok) {
      expect(b.code).toBe("competing_shared_fields");
      expect(b.duplicate_of).toBe(a.proposal.id);
    }
    expect(fake.drafts.has("blog/hello/en/draft")).toBe(false);
    const c = await svc.create(
      { title: "Title EN", summary: SUMMARY, entries: [entry({ locale: "en" })] },
      { username: "carol" },
    );
    expect(c.ok).toBe(true);
  });

  it("rolls back drafts already written when a later entry fails", async () => {
    const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" }, "blog/other/es": { title: "O" } });
    const { svc } = makeService({ store: fake.store });
    const res = await svc.create(
      {
        title: "Two",
        summary: SUMMARY,
        entries: [entry(), entry({ slug: "other", updates: [{ field_path: "boom", value: 1 }] })],
      },
      { username: "alice" },
    );
    expect(res.ok).toBe(false);
    expect(fake.drafts.size).toBe(0);
  });

  describe("new section-built page from an accepted idea", () => {
    const kit = { contentType: "downloadable", slug: "ai-engineering-interview-kit", locale: "en" };
    const sections = [{ type: "hero", version: "1.0", title: "AI Engineering Interview Kit" }];
    const liveKeys = new Set<string>(["downloadable/kit-live/en"]);
    const pageDeps = (validateSections?: () => Array<{ property_path: string; message: string }>) => ({
      resolveExistence: (e: { contentType: string; slug: string; locale: string }) => ({
        live: liveKeys.has(`${e.contentType}/${e.slug}/${e.locale}`) ? ("exists" as const) : ("missing" as const),
        draftExists: false,
      }),
      inspectMissingTarget: () => ({ shape: "page_file" as const, requiredFields: [] }),
      ...(validateSections ? { validateSections } : {}),
    });

    async function acceptKitIdea(svc: ReturnType<typeof makeService>["svc"]) {
      const idea = await svc.create(
        {
          kind: "idea",
          title: "AI Engineering Interview Kit",
          summary: SUMMARY,
          related_entries: [kit],
          idea_funnel: { stage: "awareness", products: "all" },
        },
        { username: "alice" },
      );
      if (!idea.ok) throw new Error(idea.error);
      const accepted = await svc.update(idea.proposal.id, "accept", {
        username: "bob",
        next_step: "File the page with full sections.",
        accepted_entry: kit,
      });
      if (!accepted.ok) throw new Error(accepted.error);
      return idea.proposal.id;
    }

    it("creates the page folder and a draft holding the proposed sections", async () => {
      const fake = fakeDraftStore();
      const { svc } = makeService({ store: fake.store, extraDeps: pageDeps() });
      const ideaId = await acceptKitIdea(svc);
      const res = await svc.create(
        {
          title: "Kit page",
          summary: SUMMARY,
          implements_proposal_id: ideaId,
          review_situations: ["new_public_content"],
          entries: [entry({ ...kit, updates: [{ field_path: "sections", value: sections }] })],
        },
        { username: "alice" },
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(fake.entries.has("downloadable/ai-engineering-interview-kit")).toBe(true);
      const variant = res.proposal.entries[0]!.variant!;
      const d = fake.drafts.get(`downloadable/ai-engineering-interview-kit/en/${variant}`)!;
      expect(d.data.sections).toEqual(sections);
    });

    it("rejects registry-invalid sections before any draft or folder is created", async () => {
      const fake = fakeDraftStore();
      const { svc } = makeService({
        store: fake.store,
        extraDeps: pageDeps(() => [{ property_path: "sections[0].type", message: "Unknown component" }]),
      });
      const ideaId = await acceptKitIdea(svc);
      const res = await svc.create(
        {
          title: "Kit page",
          summary: SUMMARY,
          implements_proposal_id: ideaId,
          entries: [entry({ ...kit, updates: [{ field_path: "sections", value: sections }] })],
        },
        { username: "alice" },
      );
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe("invalid_sections");
      expect(fake.drafts.size).toBe(0);
      expect(fake.entries.has("downloadable/ai-engineering-interview-kit")).toBe(false);
    });

    it("a new language on an existing page needs no idea", async () => {
      const fake = fakeDraftStore();
      fake.entries.add("downloadable/kit-live");
      const { svc } = makeService({ store: fake.store, extraDeps: pageDeps() });
      const res = await svc.create(
        {
          title: "Spanish kit",
          summary: SUMMARY,
          review_situations: ["locale_translation"],
          entries: [
            entry({
              contentType: "downloadable",
              slug: "kit-live",
              locale: "es",
              updates: [{ field_path: "sections", value: sections }],
            }),
          ],
        },
        { username: "alice" },
      );
      expect(res.ok).toBe(true);
    });
  });

  describe("idea SEO target (keyword + cluster)", () => {
    const post = { contentType: "blog", slug: "ai-code-review", locale: "en" };
    const sections = [{ type: "hero", version: "1.0", title: "AI code review" }];
    const HUB = "/en/blog/ai-engineer/hub-ai-engineering";
    let hubs: Record<string, IdeaSeoHubFacts>;
    let liveKeywords: Record<string, string>;
    let members: Record<string, { live: boolean; monitored: boolean; pillar_path: string | null }>;
    let liveKeys: Set<string>;

    beforeEach(() => {
      hubs = { [HUB]: { path: HUB, live: true, locale: "en", is_hub: true } };
      liveKeywords = {};
      members = {
        "blog/member-one/en": { live: true, monitored: true, pillar_path: null },
        "blog/member-two/en": { live: true, monitored: true, pillar_path: "/en/blog/other-hub" },
      };
      liveKeys = new Set();
    });

    const facts = (): IdeaSeoTargetDeps => ({
      isMonitored: (ct) => ct === "blog",
      resolveHub: (p) => hubs[p] ?? { path: p, live: false, locale: null, is_hub: null },
      keywordOwner: (kw) => (liveKeywords[kw] ? { path: liveKeywords[kw]! } : null),
      selfPath: (ct, slug, loc) => `/${loc}/${ct}/${slug}`,
      memberInfo: (ct, slug, loc) =>
        members[`${ct}/${slug}/${loc}`] ?? { live: false, monitored: true, pillar_path: null },
    });
    let currentStore: ProposalDraftStore | null = null;
    const deps = () => ({
      resolveExistence: (e: { contentType: string; slug: string; locale: string; variant?: string | null }) => ({
        live: liveKeys.has(`${e.contentType}/${e.slug}/${e.locale}`) ? ("exists" as const) : ("missing" as const),
        draftExists: Boolean(e.variant && currentStore?.exists({ ...e, variant: e.variant })),
      }),
      inspectMissingTarget: () => ({ shape: "page_file" as const, requiredFields: [] }),
      seoTarget: facts(),
    });
    const join = { main_keyword: "ai code review", cluster: { mode: "join", pillar_path: HUB } };
    const REASON = "Breaking release news that decays within two weeks; no evergreen hub fits it.";

    async function fileIdea(
      svc: ReturnType<typeof makeService>["svc"],
      extra: Record<string, unknown> = {},
      slug = post.slug,
    ) {
      const idea = await svc.create(
        {
          kind: "idea",
          title: `New article: ${slug}`,
          summary: SUMMARY,
          related_entries: [{ ...post, slug }],
          idea_funnel: { stage: "awareness", products: "all" },
          ...extra,
        },
        { username: "alice" },
      );
      if (!idea.ok) throw new Error(`${idea.code}: ${idea.error}`);
      return idea.proposal.id;
    }
    const accept = (svc: ReturnType<typeof makeService>["svc"], id: string, slug = post.slug) =>
      svc.update(id, "accept", {
        username: "bob",
        next_step: "File the new post with implements_proposal_id next.",
        accepted_entry: { ...post, slug },
      });
    const implement = (
      svc: ReturnType<typeof makeService>["svc"],
      ideaId: string,
      updates: ProposalEntryInput["updates"] = [{ field_path: "sections", value: sections }],
      extra: Record<string, unknown> = {},
    ) =>
      svc.create(
        {
          title: "New post",
          summary: SUMMARY,
          implements_proposal_id: ideaId,
          review_situations: ["new_public_content"],
          entries: [entry({ ...post, updates })],
          ...extra,
        },
        { username: "alice" },
      );

    it("accept refuses a monitored new page without a target; set works; frozen after accept", async () => {
      const fake = fakeDraftStore();
      const { svc } = makeService({ store: fake.store, extraDeps: deps() });
      const id = await fileIdea(svc);
      const ctx = await svc.classifyLive(svc.get(id)!);
      expect(ctx?.agent_preview.warnings.some((w) => w.code === "idea_seo_target_missing")).toBe(true);
      const blocked = await accept(svc, id);
      expect(blocked.ok).toBe(false);
      if (!blocked.ok) expect(blocked.code).toBe("idea_seo_target_required");
      const set = await svc.update(id, "set_idea_seo_target", { username: "alice", idea_seo_target: join });
      expect(set.ok).toBe(true);
      expect((await accept(svc, id)).ok).toBe(true);
      const frozen = await svc.update(id, "set_idea_seo_target", { username: "alice", idea_seo_target: join });
      expect(frozen.ok).toBe(false);
      if (!frozen.ok) expect(frozen.code).toBe("idea_seo_target_frozen");
    });

    it("non-monitored types accept without a target", async () => {
      const fake = fakeDraftStore();
      const { svc } = makeService({
        store: fake.store,
        extraDeps: { ...deps(), seoTarget: { ...facts(), isMonitored: () => false } },
      });
      const id = await fileIdea(svc);
      expect((await accept(svc, id)).ok).toBe(true);
    });

    it("standalone only for news / broken-URL ideas", async () => {
      const fake = fakeDraftStore();
      const { svc } = makeService({ store: fake.store, extraDeps: deps() });
      const standalone = { main_keyword: "gpt-6 launch", cluster: { mode: "standalone", reason: REASON } };
      const refused = await svc.create(
        {
          kind: "idea",
          title: "New article: standalone",
          summary: SUMMARY,
          review_situations: ["existing_demand"],
          related_entries: [post],
          idea_seo_target: standalone,
        },
        { username: "alice" },
      );
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.code).toBe("idea_seo_target_standalone_not_allowed");
      const id = await fileIdea(svc, { review_situations: ["fast_decay_news"], idea_seo_target: standalone });
      expect((await accept(svc, id)).ok).toBe(true);
    });

    it("accept checks hub liveness, hub locale, and hub-ness", async () => {
      const fake = fakeDraftStore();
      const { svc } = makeService({ store: fake.store, extraDeps: deps() });
      const dead = await fileIdea(svc, {
        idea_seo_target: { main_keyword: "k1", cluster: { mode: "join", pillar_path: "/en/blog/gone" } },
      }, "p1");
      const r1 = await accept(svc, dead, "p1");
      expect(!r1.ok && r1.code).toBe("idea_seo_target_hub_not_live");
      hubs["/es/blog/hub-es"] = { path: "/es/blog/hub-es", live: true, locale: "es", is_hub: true };
      const wrongLocale = await fileIdea(svc, {
        idea_seo_target: { main_keyword: "k2", cluster: { mode: "join", pillar_path: "/es/blog/hub-es" } },
      }, "p2");
      const r2 = await accept(svc, wrongLocale, "p2");
      expect(!r2.ok && r2.code).toBe("idea_seo_target_hub_not_live");
      hubs["/en/blog/plain"] = { path: "/en/blog/plain", live: true, locale: "en", is_hub: false };
      const notHub = await fileIdea(svc, {
        idea_seo_target: { main_keyword: "k3", cluster: { mode: "join", pillar_path: "/en/blog/plain" } },
      }, "p3");
      const r3 = await accept(svc, notHub, "p3");
      expect(!r3.ok && r3.code).toBe("idea_seo_target_hub_not_live");
    });

    it("hub mode needs live monitored members", async () => {
      const fake = fakeDraftStore();
      const { svc } = makeService({ store: fake.store, extraDeps: deps() });
      const id = await fileIdea(svc, {
        idea_seo_target: {
          main_keyword: "ai engineering",
          cluster: { mode: "hub", members: [{ contentType: "blog", slug: "ghost" }] },
        },
      });
      const r = await accept(svc, id);
      expect(!r.ok && r.code).toBe("idea_seo_target_hub_members_required");
    });

    it("keyword taken by a live page or by another accepted unpublished idea", async () => {
      const fake = fakeDraftStore();
      const { svc } = makeService({ store: fake.store, extraDeps: deps() });
      liveKeywords["ai code review"] = "/en/blog/ai/existing";
      const a = await fileIdea(svc, { idea_seo_target: join }, "a1");
      const r1 = await accept(svc, a, "a1");
      expect(!r1.ok && r1.code).toBe("idea_seo_target_keyword_taken");
      delete liveKeywords["ai code review"];
      expect((await accept(svc, a, "a1")).ok).toBe(true);
      const b = await fileIdea(svc, { idea_seo_target: join }, "a2");
      const r2 = await accept(svc, b, "a2");
      expect(!r2.ok && r2.code).toBe("idea_seo_target_keyword_taken");
      if (!r2.ok) expect(r2.error).toContain(a);
    });

    it("implementing edits seed the locked target into the new draft", async () => {
      const fake = fakeDraftStore();
      const { svc } = makeService({ store: fake.store, extraDeps: deps() });
      const id = await fileIdea(svc, { idea_seo_target: join });
      expect((await accept(svc, id)).ok).toBe(true);
      const res = await implement(svc, id);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const d = fake.drafts.get(`blog/ai-code-review/en/${res.proposal.entries[0]!.variant}`)!;
      expect(d.data.seo).toEqual({ main_keyword: "ai code review", pillar_path: HUB, is_pillar: false });
      expect(d.data.sections).toEqual(sections);
    });

    it("follows a renamed hub and fails when the hub is gone", async () => {
      const fake = fakeDraftStore();
      const { svc } = makeService({ store: fake.store, extraDeps: deps() });
      const id = await fileIdea(svc, { idea_seo_target: join });
      expect((await accept(svc, id)).ok).toBe(true);
      hubs[HUB] = { path: "/en/blog/ai-engineer/hub-renamed", live: true, locale: "en", is_hub: true };
      const renamed = await implement(svc, id);
      expect(renamed.ok).toBe(true);
      if (!renamed.ok) return;
      expect(renamed.warnings?.some((w) => w.code === "idea_seo_target_hub_renamed")).toBe(true);
      const d = fake.drafts.get(`blog/ai-code-review/en/${renamed.proposal.entries[0]!.variant}`)!;
      expect((d.data.seo as Record<string, unknown>).pillar_path).toBe("/en/blog/ai-engineer/hub-renamed");
      await svc.update(renamed.proposal.id, "withdraw", {
        username: "alice",
        close_note: "Withdrawing to re-file after the hub was deleted entirely.",
      });
      hubs[HUB] = { path: HUB, live: false, locale: "en", is_hub: null };
      const gone = await implement(svc, id);
      expect(gone.ok).toBe(false);
      if (!gone.ok) expect(gone.code).toBe("idea_seo_target_hub_gone");
    });

    it("seo ops that differ from the lock need an override reason; standalone stays demand-gated", async () => {
      const fake = fakeDraftStore();
      const { svc } = makeService({ store: fake.store, extraDeps: deps() });
      const id = await fileIdea(svc, { idea_seo_target: join, review_situations: ["anticipated_demand"] });
      expect((await accept(svc, id)).ok).toBe(true);
      const ops = [
        { field_path: "sections", value: sections },
        { field_path: "seo.main_keyword", value: "ai code reviewer" },
      ];
      const conflict = await implement(svc, id, ops);
      expect(conflict.ok).toBe(false);
      if (!conflict.ok) expect(conflict.code).toBe("idea_seo_target_conflict");
      const standalone = await implement(
        svc,
        id,
        [{ field_path: "sections", value: sections }, { field_path: "seo.pillar_path", value: null }],
        { seo_target_override: { reason: REASON } },
      );
      expect(standalone.ok).toBe(false);
      if (!standalone.ok) expect(standalone.code).toBe("idea_seo_target_standalone_not_allowed");
      const ok = await implement(svc, id, ops, {
        seo_target_override: { reason: "SERP research shows the singular phrase converts better for this page." },
      });
      expect(ok.ok).toBe(true);
      if (!ok.ok) return;
      expect(ok.proposal.seo_target_override?.reason).toMatch(/SERP research/);
      const d = fake.drafts.get(`blog/ai-code-review/en/${ok.proposal.entries[0]!.variant}`)!;
      expect((d.data.seo as Record<string, unknown>).main_keyword).toBe("ai code reviewer");
    });

    it("hub mode: going live lists one cluster-fix proposal per member", async () => {
      const fake = fakeDraftStore();
      currentStore = fake.store;
      const { svc } = makeService({ store: fake.store, extraDeps: deps() });
      const id = await fileIdea(svc, {
        idea_seo_target: {
          main_keyword: "ai engineering",
          cluster: {
            mode: "hub",
            members: [
              { contentType: "blog", slug: "member-one" },
              { contentType: "blog", slug: "member-two" },
            ],
          },
        },
      });
      expect((await accept(svc, id)).ok).toBe(true);
      const res = await implement(svc, id);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const d = fake.drafts.get(`blog/ai-code-review/en/${res.proposal.entries[0]!.variant}`)!;
      expect((d.data.seo as Record<string, unknown>).is_pillar).toBe(true);
      const applied = await svc.update(res.proposal.id, "apply", { username: "bob" });
      expect(applied.ok ? "ok" : `${applied.code}: ${applied.error}`).toBe("ok");
      if (!applied.ok) return;
      const w = applied.warnings?.find((x) => x.code === "idea_seo_hub_members_follow_up") as
        | { details?: { next_actions?: Array<Record<string, unknown>>; members?: Array<Record<string, unknown>> } }
        | undefined;
      expect(w?.details?.next_actions).toHaveLength(2);
      expect(w?.details?.members?.find((m) => m.slug === "member-two")?.in_other_hub).toBe(true);
      expect(w?.details?.members?.find((m) => m.slug === "member-one")?.in_other_hub).toBe(false);
      const hints = (w?.details?.next_actions ?? []).map((a) => a.args_hint as Record<string, unknown>);
      expect(hints.every((h) => h.applies_after_proposal_id === res.proposal.id)).toBe(true);
      const moved = (w?.details?.next_actions ?? []).find((a) => String(a.reason).includes("member-two"));
      expect(String(moved?.reason)).toMatch(/in-body link/);
    });

    it("hub mode: accept refuses members another accepted, unpublished split already claims", async () => {
      const fake = fakeDraftStore();
      currentStore = fake.store;
      const { svc } = makeService({ store: fake.store, extraDeps: deps() });
      const hubTarget = (kw: string) => ({
        main_keyword: kw,
        cluster: { mode: "hub", members: [{ contentType: "blog", slug: "member-one" }] },
      });
      const first = await fileIdea(svc, { idea_seo_target: hubTarget("ai engineering") });
      expect((await accept(svc, first)).ok).toBe(true);
      const second = await fileIdea(svc, { idea_seo_target: hubTarget("ai engineering jobs") }, "second-hub");
      const res = await accept(svc, second, "second-hub");
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("idea_seo_target_members_claimed");
        expect(JSON.stringify((res as { details?: unknown }).details)).toContain(first);
      }
    });

    it("hub mode: retiring frees claimed members; unretire is refused once another split claims them", async () => {
      const fake = fakeDraftStore();
      currentStore = fake.store;
      const { svc } = makeService({ store: fake.store, extraDeps: deps() });
      const hubTarget = (kw: string) => ({
        main_keyword: kw,
        cluster: { mode: "hub", members: [{ contentType: "blog", slug: "member-one" }] },
      });
      const first = await fileIdea(svc, { idea_seo_target: hubTarget("ai engineering") });
      expect((await accept(svc, first)).ok).toBe(true);
      const retired = await svc.update(first, "retire", {
        username: "bob",
        retire_reason: "no_longer_relevant",
        close_note: "The AI engineering hub plan was dropped after the Q4 content review.",
      });
      expect(retired.ok ? "ok" : `${retired.code}: ${retired.error}`).toBe("ok");

      const second = await fileIdea(svc, { idea_seo_target: hubTarget("ai engineering jobs") }, "second-hub");
      expect((await accept(svc, second, "second-hub")).ok).toBe(true);

      const restore = await svc.update(first, "unretire", { username: "bob" });
      expect(restore.ok).toBe(false);
      if (!restore.ok) expect(restore.code).toBe("idea_seo_target_members_claimed");
      expect(svc.get(first)!.close_reason).toBe("no_longer_relevant");
    });

    it("join mode: the page's proposal reminds the author to link it from the hub (chained)", async () => {
      const fake = fakeDraftStore({ "blog/hub-ai-engineering/en": { title: "Hub" } });
      fake.entries.add("blog/hub-ai-engineering");
      currentStore = fake.store;
      hubs[HUB] = { ...hubs[HUB]!, entry: { contentType: "blog", slug: "hub-ai-engineering", locale: "en" } };
      const { svc } = makeService({ store: fake.store, extraDeps: deps() });
      const id = await fileIdea(svc, { idea_seo_target: join });
      expect((await accept(svc, id)).ok).toBe(true);
      const page = await implement(svc, id);
      expect(page.ok).toBe(true);
      if (!page.ok) return;
      const reminder = page.warnings?.find((w) => w.code === "hub_link_follow_up") as
        | { details?: { next_actions?: Array<{ args_hint?: Record<string, unknown> }> } }
        | undefined;
      const hint = reminder?.details?.next_actions?.[0]?.args_hint;
      expect(hint?.applies_after_proposal_id).toBe(page.proposal.id);
      expect(hint?.review_situations).toEqual(["internal_links"]);

      const link = await svc.create(
        {
          title: "Hub links: hub → ai-code-review",
          summary: SUMMARY,
          review_situations: ["internal_links"],
          applies_after_proposal_id: page.proposal.id,
          entries: [entry({ contentType: "blog", slug: "hub-ai-engineering", locale: "en", updates: [{ field_path: "content", value: "x" }] })],
        },
        { username: "alice" },
      );
      expect(link.ok).toBe(true);
      liveKeys.add("blog/ai-code-review/en");
      const applied = await svc.update(page.proposal.id, "apply", { username: "bob" });
      expect(applied.ok).toBe(true);
      if (!applied.ok) return;
      expect(applied.warnings?.some((w) => w.code === "hub_link_follow_up")).toBe(false);
      expect(applied.warnings?.some((w) => w.code === "dependents_ready")).toBe(true);
    });

    it("join mode: hub with open edits → hub_has_open_edits instead of a propose_change hint", async () => {
      const fake = fakeDraftStore({ "blog/hub-ai-engineering/en": { title: "Hub" } });
      fake.entries.add("blog/hub-ai-engineering");
      currentStore = fake.store;
      hubs[HUB] = { ...hubs[HUB]!, entry: { contentType: "blog", slug: "hub-ai-engineering", locale: "en" } };
      const { svc } = makeService({ store: fake.store, extraDeps: deps() });
      const busy = await svc.create(
        {
          title: "Hub copy fix",
          summary: SUMMARY,
          entries: [entry({ contentType: "blog", slug: "hub-ai-engineering", locale: "en" })],
        },
        { username: "carol" },
      );
      expect(busy.ok).toBe(true);
      if (!busy.ok) return;
      const id = await fileIdea(svc, { idea_seo_target: join });
      expect((await accept(svc, id)).ok).toBe(true);
      const page = await implement(svc, id);
      expect(page.ok).toBe(true);
      if (!page.ok) return;
      const w = page.warnings?.find((x) => x.code === "hub_has_open_edits") as
        | { details?: { blocking_proposals?: Array<{ id: string }> } }
        | undefined;
      expect(w?.details?.blocking_proposals?.map((b) => b.id)).toEqual([busy.proposal.id]);
      expect(page.warnings?.some((x) => x.code === "hub_link_follow_up")).toBe(false);
    });

    it("agents cannot opt an idea-born page out of clustering unless news/broken-URL + reason", async () => {
      const fake = fakeDraftStore();
      const { svc } = makeService({
        store: fake.store,
        extraDeps: { ...deps(), seoTarget: { ...facts(), isMonitored: () => false } },
      });
      const agent = { username: "agent-a", actor: { type: "mcp" as const, role: "seo_specialist", model: "m", client: "c" } };
      const optOut = [
        { field_path: "sections", value: sections },
        { field_path: "seo.pillar_path", value: null },
      ];
      const evergreen = await fileIdea(svc, { review_situations: ["existing_demand"] }, "evergreen");
      expect((await accept(svc, evergreen, "evergreen")).ok).toBe(true);
      const refused = await svc.create(
        {
          title: "Opt out",
          summary: SUMMARY,
          implements_proposal_id: evergreen,
          entries: [entry({ ...post, slug: "evergreen", updates: optOut })],
          seo_target_override: { reason: "This topic has no hub in our site and I do not want to build one." },
        },
        agent,
      );
      expect(refused.ok).toBe(false);
      if (!refused.ok) {
        expect(refused.code).toBe("seo_optout_idea_born");
        expect((refused as { details?: Record<string, unknown> }).details?.origin_idea_id).toBe(evergreen);
      }
      const staff = await svc.create(
        {
          title: "Staff opt out",
          summary: SUMMARY,
          implements_proposal_id: evergreen,
          entries: [entry({ ...post, slug: "evergreen", updates: optOut })],
        },
        { username: "staff-user" },
      );
      expect(staff.ok).toBe(true);

      const news = await fileIdea(svc, { review_situations: ["fast_decay_news"] }, "news");
      expect((await accept(svc, news, "news")).ok).toBe(true);
      const noReason = await svc.create(
        { title: "News opt out", summary: SUMMARY, implements_proposal_id: news, entries: [entry({ ...post, slug: "news", updates: optOut })] },
        agent,
      );
      expect(!noReason.ok && noReason.code).toBe("seo_optout_idea_born");
      const withReason = await svc.create(
        {
          title: "News opt out",
          summary: SUMMARY,
          implements_proposal_id: news,
          entries: [entry({ ...post, slug: "news", updates: optOut })],
          seo_target_override: { reason: "Release-week news; traffic is gone in ten days and no hub fits it." },
        },
        agent,
      );
      expect(withReason.ok).toBe(true);
    });

    it("ideas accepted without a target implement unchanged", async () => {
      const fake = fakeDraftStore();
      const { svc } = makeService({
        store: fake.store,
        extraDeps: { ...deps(), seoTarget: { ...facts(), isMonitored: () => false } },
      });
      const id = await fileIdea(svc);
      expect((await accept(svc, id)).ok).toBe(true);
      const res = await implement(svc, id, [
        { field_path: "sections", value: sections },
        { field_path: "seo.main_keyword", value: "anything" },
      ]);
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      const d = fake.drafts.get(`blog/ai-code-review/en/${res.proposal.entries[0]!.variant}`)!;
      expect((d.data.seo as Record<string, unknown>).main_keyword).toBe("anything");
    });
  });

  describe("per-language URL slug (accept lock, filing, seed)", () => {
    const live: Record<string, Record<string, unknown>> = {};
    let owners: Record<string, string>;

    beforeEach(() => {
      for (const k of Object.keys(live)) delete live[k];
      live["blog/hello/en"] = { title: "Hello" };
      owners = {};
    });

    const deps = () => ({
      resolveExistence: (e: { contentType: string; slug: string; locale: string; variant?: string | null }) => ({
        live: live[`${e.contentType}/${e.slug}/${e.locale}`] ? ("exists" as const) : ("missing" as const),
        draftExists: false,
      }),
      localeUrlSlug: {
        liveLocales: (ct: string, slug: string) =>
          Object.keys(live)
            .filter((k) => k.startsWith(`${ct}/${slug}/`))
            .map((k) => k.split("/")[2]!),
        urlPattern: () => ({ en: "/en/blog/:slug", es: "/es/blog/:slug" }),
        ownerOf: (_ct: string, urlSlug: string, locale: string) => owners[`${locale}:${urlSlug}`] ?? null,
      },
    });

    async function fileIdea(svc: ReturnType<typeof makeService>["svc"], slug = "hello") {
      const idea = await svc.create(
        {
          kind: "idea",
          title: `Spanish version of ${slug}`,
          summary: SUMMARY,
          related_entries: [{ contentType: "blog", slug, locale: "es" }],
          idea_funnel: { stage: "awareness", products: "all" },
        },
        { username: "alice" },
      );
      if (!idea.ok) throw new Error(`${idea.code}: ${idea.error}`);
      return idea.proposal.id;
    }
    const accept = (
      svc: ReturnType<typeof makeService>["svc"],
      id: string,
      extra: Record<string, unknown> = {},
      slug = "hello",
    ) =>
      svc.update(id, "accept", {
        username: "bob",
        next_step: "File the Spanish edits with implements_proposal_id next.",
        accepted_entry: { contentType: "blog", slug, locale: "es", ...extra },
      });
    const implement = (
      svc: ReturnType<typeof makeService>["svc"],
      ideaId: string,
      updates: ProposalEntryInput["updates"] = [{ field_path: "title", value: "Hola" }],
      extra: Record<string, unknown> = {},
    ) =>
      svc.create(
        {
          title: "Nueva ES",
          summary: SUMMARY,
          implements_proposal_id: ideaId,
          review_situations: ["new_public_content"],
          entries: [entry({ locale: "es", updates })],
          ...extra,
        },
        { username: "alice" },
      );

    it("accept needs url_slug for a new language of a live page, then seeds it into the draft", async () => {
      const fake = fakeDraftStore(live);
      const { svc } = makeService({ store: fake.store, extraDeps: deps() });
      const id = await fileIdea(svc);
      const refused = await accept(svc, id);
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.code).toBe("url_slug_required");
      const accepted = await accept(svc, id, { url_slug: "hola-mundo" });
      expect(accepted.ok).toBe(true);
      if (accepted.ok) expect(accepted.proposal.accepted_entry?.url_slug).toBe("hola-mundo");
      const res = await implement(svc, id);
      expect(res.ok ? "ok" : `${res.code}: ${res.error}`).toBe("ok");
      if (!res.ok) return;
      expect(res.warnings?.some((w) => w.code === "idea_url_slug_locked")).toBe(true);
      const d = fake.drafts.get(`blog/hello/es/${res.proposal.entries[0]!.variant}`)!;
      expect(d.data.slug).toBe("hola-mundo");
    });

    it("accept refuses an address another page serves in that language", async () => {
      const fake = fakeDraftStore(live);
      const { svc } = makeService({ store: fake.store, extraDeps: deps() });
      owners["es:hola-mundo"] = "other";
      const id = await fileIdea(svc);
      const r = await accept(svc, id, { url_slug: "hola-mundo" });
      expect(!r.ok && r.code).toBe("slug_already_owned_by_other_entry");
    });

    it("brand-new page: wrong-language folder name is refused unless acknowledged", async () => {
      const fake = fakeDraftStore(live);
      const { svc } = makeService({ store: fake.store, extraDeps: deps() });
      const id = await fileIdea(svc, "what-is-grok");
      const r = await accept(svc, id, {}, "what-is-grok");
      expect(!r.ok && r.code).toBe("slug_locale_mismatch");
      expect((await accept(svc, id, { slug_language_ack: true }, "what-is-grok")).ok).toBe(true);
    });

    it("a slug op that differs from the lock needs url_slug_override.reason", async () => {
      const fake = fakeDraftStore(live);
      const { svc } = makeService({ store: fake.store, extraDeps: deps() });
      const id = await fileIdea(svc);
      expect((await accept(svc, id, { url_slug: "hola-mundo" })).ok).toBe(true);
      const ops = [
        { field_path: "title", value: "Hola" },
        { field_path: "slug", value: "hola-a-todos" },
      ];
      const conflict = await implement(svc, id, ops);
      expect(!conflict.ok && conflict.code).toBe("idea_url_slug_conflict");
      const ok = await implement(svc, id, ops, {
        url_slug_override: { reason: "Search research shows 'hola a todos' is the phrase Spanish readers use." },
      });
      expect(ok.ok ? "ok" : `${ok.code}: ${ok.error}`).toBe("ok");
      if (!ok.ok) return;
      expect(ok.proposal.url_slug_override?.reason).toMatch(/Search research/);
      const d = fake.drafts.get(`blog/hello/es/${ok.proposal.entries[0]!.variant}`)!;
      expect(d.data.slug).toBe("hola-a-todos");
    });

    it("edits with no idea: a new language without a slug is refused at filing", async () => {
      const fake = fakeDraftStore(live);
      const { svc } = makeService({ store: fake.store, extraDeps: deps() });
      const refused = await svc.create(
        { title: "Nueva ES", summary: SUMMARY, entries: [entry({ locale: "es" })] },
        { username: "alice" },
      );
      expect(!refused.ok && refused.code).toBe("locale_url_slug_required");
      expect(fake.drafts.size).toBe(0);
      const ok = await svc.create(
        {
          title: "Nueva ES",
          summary: SUMMARY,
          entries: [
            entry({
              locale: "es",
              updates: [
                { field_path: "title", value: "Hola" },
                { field_path: "slug", value: "hola-mundo" },
              ],
            }),
          ],
        },
        { username: "alice" },
      );
      expect(ok.ok ? "ok" : `${ok.code}: ${ok.error}`).toBe("ok");
    });

    it("an idea accepted before url_slug existed follows the no-idea rule", async () => {
      const fake = fakeDraftStore(live);
      const { svc } = makeService({ store: fake.store });
      const id = await fileIdea(svc);
      expect((await accept(svc, id)).ok).toBe(true);
      const strict = makeService({ store: fake.store, extraDeps: deps() }).svc;
      const refused = await implement(strict, id);
      expect(!refused.ok && refused.code).toBe("locale_url_slug_required");
      const ok = await implement(strict, id, [
        { field_path: "title", value: "Hola" },
        { field_path: "slug", value: "hola-mundo" },
      ]);
      expect(ok.ok ? "ok" : `${ok.code}: ${ok.error}`).toBe("ok");
    });

    it("existing languages are not affected", async () => {
      live["blog/hello/es"] = { title: "Hola" };
      const fake = fakeDraftStore(live);
      const { svc } = makeService({ store: fake.store, extraDeps: deps() });
      const res = await svc.create(
        { title: "Title fix", summary: SUMMARY, entries: [entry({ locale: "es" })] },
        { username: "alice" },
      );
      expect(res.ok).toBe(true);
    });
  });

  describe("layout_owner: new languages, accept, templates, reattach", () => {
    const sections = [{ type: "hero", version: "1.0", title: "Hola" }];
    type Info = { layout_owner: "shared_template" | "entry"; detached?: true; is_shared_template?: true };
    let owners: Record<string, Info>;

    function layoutDeps(fake: ReturnType<typeof fakeDraftStore>, live: Record<string, unknown> = {}) {
      fake.store.draftValue = (r, p) => fake.drafts.get(keyOf(r))?.data[p];
      return {
        resolveExistence: (e: { contentType: string; slug: string; locale: string; variant?: string | null }) => ({
          live: live[`${e.contentType}/${e.slug}/${e.locale}`] ? ("exists" as const) : ("missing" as const),
          draftExists: Boolean(e.variant && fake.drafts.has(keyOf({ ...e, variant: e.variant }))),
        }),
        resolveLayoutOwner: ({ contentType, slug }: { contentType: string; slug: string }) =>
          owners[`${contentType}/${slug}`] ??
          (slug === "template"
            ? { layout_owner: "shared_template" as const, is_shared_template: true as const }
            : { layout_owner: "shared_template" as const }),
      };
    }

    beforeEach(() => {
      owners = {
        "landing/ai-bootcamp": { layout_owner: "entry" },
        "blog/custom": { layout_owner: "entry", detached: true },
        "course/custom": { layout_owner: "entry", detached: true },
      };
    });

    const newLocaleCases = [
      { name: "a type without a shared layout", contentType: "landing", slug: "ai-bootcamp", detached: undefined },
      { name: "a detached file-based entry", contentType: "blog", slug: "custom", detached: true },
      { name: "a detached database-backed entry", contentType: "course", slug: "custom", detached: true },
    ];

    for (const c of newLocaleCases) {
      it(`refuses a new language of ${c.name} without full sections (create)`, async () => {
        const fake = fakeDraftStore();
        fake.entries.add(`${c.contentType}/${c.slug}`);
        const { svc } = makeService({ store: fake.store, extraDeps: layoutDeps(fake) });
        const res = await svc.create(
          { title: "Spanish", summary: SUMMARY, entries: [entry({ contentType: c.contentType, slug: c.slug })] },
          { username: "alice" },
        );
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.code).toBe("sections_required");
        expect((res as { details?: Record<string, unknown> }).details).toMatchObject({
          layout_owner: "entry",
          new_locale: true,
          ...(c.detached ? { detached: true } : {}),
        });
        expect(fake.drafts.size).toBe(0);
      });
    }

    it("accepts a new language with one full sections update", async () => {
      const fake = fakeDraftStore();
      fake.entries.add("landing/ai-bootcamp");
      const { svc } = makeService({ store: fake.store, extraDeps: layoutDeps(fake) });
      const res = await svc.create(
        {
          title: "Spanish",
          summary: SUMMARY,
          entries: [entry({ contentType: "landing", slug: "ai-bootcamp", updates: [{ field_path: "sections", value: sections }] })],
        },
        { username: "alice" },
      );
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.proposal.entries[0]!.baseline_context.layout_owner).toBe("entry");
      expect(res.proposal.entries[0]!.layout_owner).toBe("entry");
    });

    it("accepts a named draft that already has sections", async () => {
      const fake = fakeDraftStore();
      fake.entries.add("landing/ai-bootcamp");
      fake.store.create({ contentType: "landing", slug: "ai-bootcamp", locale: "es", variant: "translation" }, { author: "t" });
      fake.drafts.get("landing/ai-bootcamp/es/translation")!.data.sections = sections;
      const { svc } = makeService({ store: fake.store, extraDeps: layoutDeps(fake) });
      const res = await svc.create(
        {
          title: "Spanish",
          summary: SUMMARY,
          entries: [entry({ contentType: "landing", slug: "ai-bootcamp", variant: "translation" })],
        },
        { username: "alice" },
      );
      expect(res.ok).toBe(true);
    });

    it("leaves attached (shared_template) new languages alone", async () => {
      const fake = fakeDraftStore();
      const { svc } = makeService({ store: fake.store, extraDeps: layoutDeps(fake) });
      const res = await svc.create({ title: "Spanish", summary: SUMMARY, entries: [entry()] }, { username: "alice" });
      expect(res.ok).toBe(true);
    });

    it("refuses revise_entries that drops full sections from a new language", async () => {
      const fake = fakeDraftStore();
      fake.entries.add("landing/ai-bootcamp");
      const { svc } = makeService({ store: fake.store, extraDeps: layoutDeps(fake) });
      const target = { contentType: "landing", slug: "ai-bootcamp" };
      const created = await svc.create(
        {
          title: "Spanish",
          summary: SUMMARY,
          entries: [entry({ ...target, updates: [{ field_path: "sections", value: sections }] })],
        },
        { username: "alice" },
      );
      if (!created.ok) throw new Error(created.error);
      const res = await svc.update(created.proposal.id, "revise_entries", {
        username: "alice",
        entries: [entry({ ...target })],
      });
      expect(res.ok).toBe(false);
      if (!res.ok) {
        expect(res.code).toBe("sections_required");
        expect((res as { details?: Record<string, unknown> }).details).toMatchObject({ new_locale: true });
      }
    });

    it("accept on a page idea warns accepted_entry_needs_layout", async () => {
      const fake = fakeDraftStore();
      const { svc } = makeService({
        store: fake.store,
        extraDeps: {
          ...layoutDeps(fake),
          inspectMissingTarget: () => ({ shape: "page_file" as const, requiredFields: [] }),
        },
      });
      const target = { contentType: "landing", slug: "new-landing", locale: "en" };
      owners["landing/new-landing"] = { layout_owner: "entry" };
      const idea = await svc.create(
        {
          kind: "idea",
          title: "New landing",
          summary: SUMMARY,
          related_entries: [target],
          idea_funnel: { stage: "awareness", products: "all" },
        },
        { username: "alice" },
      );
      if (!idea.ok) throw new Error(idea.error);
      const accepted = await svc.update(idea.proposal.id, "accept", {
        username: "bob",
        next_step: "File the page with full sections.",
        accepted_entry: target,
      });
      expect(accepted.ok).toBe(true);
      if (!accepted.ok) return;
      const warnings = (accepted as { warnings?: Array<{ code: string; details?: Record<string, unknown> }> }).warnings;
      expect(warnings?.map((w) => w.code)).toContain("accepted_entry_needs_layout");
      expect(warnings?.find((w) => w.code === "accepted_entry_needs_layout")?.details).toMatchObject({
        layout_owner: "entry",
      });
      expect(svc.get(idea.proposal.id)!.accepted_entry_layout_owner).toBe("entry");
    });

    describe("templates", () => {
      function templateService(opts: {
        live: Record<string, Record<string, unknown>>;
        templateLocales: string[];
        scan?: Parameters<typeof createProposalService>[0]["scanTemplatePlaceholders"];
      }) {
        const fake = fakeDraftStore(opts.live);
        fake.entries.add("blog/template");
        fake.store.listTemplateLocales = () => opts.templateLocales;
        fake.store.listAttachedEntries = (ct, locale) => (ct === "blog" ? [`a-${locale}`, `b-${locale}`, `c-${locale}`] : []);
        const deps = { ...layoutDeps(fake, opts.live), ...(opts.scan ? { scanTemplatePlaceholders: opts.scan } : {}) };
        return { fake, ...makeService({ store: fake.store, extraDeps: deps }) };
      }
      const tplEntry = (locale: string, value: unknown = sections) =>
        entry({ slug: "template", locale, updates: [{ field_path: "sections", value }] });

      it("a full-sections template proposal succeeds and warns when languages are missing", async () => {
        const { svc } = templateService({
          live: { "blog/template/en": { sections: [] }, "blog/template/es": { sections: [] } },
          templateLocales: ["en", "es"],
        });
        const partial = await svc.create(
          { title: "Template", summary: SUMMARY, entries: [tplEntry("en")] },
          { username: "alice" },
        );
        expect(partial.ok).toBe(true);
        if (!partial.ok) return;
        const w = (partial as { warnings?: Array<{ code: string; details?: Record<string, unknown> }> }).warnings ?? [];
        expect(w.find((x) => x.code === "template_locales_incomplete")?.details).toMatchObject({
          changed_locales: ["en"],
          missing_locales: ["es"],
        });
        expect(partial.proposal.entries[0]!.is_shared_template).toBe(true);

        const both = await svc.create(
          { title: "Template both", summary: SUMMARY, all_or_nothing: true, entries: [tplEntry("en"), tplEntry("es")] },
          { username: "carol" },
        );
        // en already belongs to the first proposal; only the warning shape matters here.
        const codes = ((both as { warnings?: Array<{ code: string }> }).warnings ?? []).map((x) => x.code);
        expect(codes).not.toContain("template_locales_incomplete");
      });

      it("refuses a new template language without full sections", async () => {
        const { svc } = templateService({ live: { "blog/template/en": { sections } }, templateLocales: ["en"] });
        const res = await svc.create(
          { title: "Template fr", summary: SUMMARY, entries: [entry({ slug: "template", locale: "fr" })] },
          { username: "alice" },
        );
        expect(res.ok).toBe(false);
        if (res.ok) return;
        expect(res.code).toBe("sections_required");
        expect((res as { details?: Record<string, unknown> }).details).toMatchObject({
          is_shared_template: true,
          new_locale: true,
        });
      });

      it("dry run and apply warn template_placeholders_unfilled; nothing new → no warning", async () => {
        const { newEntryPlaceholders, summarizeUnfilledPlaceholders } = await import("./template-placeholder-scan");
        const bags: Record<string, Record<string, unknown>> = { "a-es": { hero_image: "a.png" }, "b-es": {}, "c-es": {} };
        const scan = vi.fn(
          (o: { liveSections: unknown; draftSections: unknown; attachedSlugs: string[] }) =>
            summarizeUnfilledPlaceholders(
              newEntryPlaceholders(o.liveSections, o.draftSections),
              o.attachedSlugs.map((slug) => ({ slug, bag: bags[slug] ?? {} })),
            ),
        );
        const liveSections = [{ type: "hero", title: "{{ entry.title }}" }];
        const { svc } = templateService({
          live: { "blog/template/es": { sections: liveSections } },
          templateLocales: ["es"],
          scan,
        });
        const created = await svc.create(
          {
            title: "Template image",
            summary: SUMMARY,
            entries: [tplEntry("es", [{ type: "hero", title: "{{ entry.title }}", image: "{{ entry.hero_image }}" }])],
          },
          { username: "alice" },
        );
        if (!created.ok) throw new Error(created.error);
        const dry = await svc.update(created.proposal.id, "apply", { username: "bob", dry_run: true });
        expect(dry.ok).toBe(true);
        const dryGap = ((dry as { warnings?: Array<{ code: string; details?: Record<string, unknown> }> }).warnings ?? []).find(
          (w) => w.code === "template_placeholders_unfilled",
        );
        expect(dryGap?.details).toMatchObject({
          locale: "es",
          placeholders: [{ name: "hero_image", missing: 2, total: 3, sample: ["b-es", "c-es"] }],
        });
        const applied = await svc.update(created.proposal.id, "apply", { username: "bob", confirm_affected_entries: 3 });
        expect(applied.ok).toBe(true);
        const codes = ((applied as { warnings?: Array<{ code: string }> }).warnings ?? []).map((w) => w.code);
        expect(codes).toContain("template_placeholders_unfilled");

        const same = templateService({
          live: { "blog/template/es": { sections: liveSections } },
          templateLocales: ["es"],
          scan,
        });
        const plain = await same.svc.create(
          { title: "Template copy", summary: SUMMARY, entries: [tplEntry("es", [{ type: "hero", title: "{{ entry.title }}!" }])] },
          { username: "dave" },
        );
        if (!plain.ok) throw new Error(plain.error);
        const dryPlain = await same.svc.update(plain.proposal.id, "apply", { username: "bob", dry_run: true });
        const plainCodes = ((dryPlain as { warnings?: Array<{ code: string }> }).warnings ?? []).map((w) => w.code);
        expect(plainCodes).not.toContain("template_placeholders_unfilled");
      });
    });

    it("apply after a reattach returns context_stale (layout_owner_changed) and needs_author", async () => {
      const live = { "landing/ai-bootcamp/es": { title: "Old", sections: [{ type: "hero", version: "1.0", title: "Old" }] } };
      const fake = fakeDraftStore(live);
      fake.entries.add("landing/ai-bootcamp");
      const { svc, promoteCalls } = makeService({ store: fake.store, extraDeps: layoutDeps(fake, live) });
      const created = await svc.create(
        {
          title: "Layout",
          summary: SUMMARY,
          entries: [entry({ contentType: "landing", slug: "ai-bootcamp", updates: [{ field_path: "sections", value: sections }] })],
        },
        { username: "alice" },
      );
      if (!created.ok) throw new Error(created.error);
      owners["landing/ai-bootcamp"] = { layout_owner: "shared_template" };
      const res = await svc.update(created.proposal.id, "apply", { username: "bob" });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.pending?.[0]).toMatchObject({ code: "context_stale", details: { reason: "layout_owner_changed" } });
      expect(promoteCalls).toHaveLength(0);
      expect(res.proposal.stale_since).toBeTruthy();
      expect(toProposalSummary(res.proposal).attention).toBe("needs_author");
    });
  });

  it("apply only promotes the draft and stores what was published", async () => {
    const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" } });
    const { svc, applyUpdates, promoteCalls } = makeService({ store: fake.store });
    const created = await svc.create({ title: "Title fix", summary: SUMMARY, entries: [entry()] }, { username: "alice" });
    if (!created.ok) throw new Error(created.error);
    const res = await svc.update(created.proposal.id, "apply", { username: "bob" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.proposal.status).toBe("finished");
    expect(applyUpdates).not.toHaveBeenCalled();
    expect(promoteCalls.map((c) => c.opts.dry_run === true)).toEqual([true, false]);
    expect(promoteCalls[1]!.opts.confirm_base_unknown).toBeUndefined();
    expect(res.proposal.entries[0]!.published_diff?.[0]?.field_path).toBe("title");
  });

  it("apply dry_run returns the merge preview and writes nothing", async () => {
    const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" } });
    const { svc, promoteCalls } = makeService({
      store: fake.store,
      promote: (_e, o) =>
        o.dry_run
          ? { ok: true, dry_run: true, rebuilt: { kept_live_fields: ["description"], author_fields: ["title"] } }
          : { ok: true },
    });
    const created = await svc.create({ title: "Title fix", summary: SUMMARY, entries: [entry()] }, { username: "alice" });
    if (!created.ok) throw new Error(created.error);
    const res = await svc.update(created.proposal.id, "apply", { username: "bob", dry_run: true });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.dry_run).toBe(true);
    expect(res.merge_preview?.[0]).toMatchObject({ ok: true, rebuilt: { kept_live_fields: ["description"] } });
    expect(promoteCalls).toHaveLength(1);
    expect(res.proposal.status).toBe("open");
  });

  it("apply dry_run previews while blockers are open; real apply stays blocked and the blocked clock does not move", async () => {
    const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" } });
    const { svc, promoteCalls } = makeService({
      store: fake.store,
      promote: (_e, o) => (o.dry_run ? { ok: true, dry_run: true } : { ok: true }),
    });
    const created = await svc.create({ title: "Title fix", summary: SUMMARY, entries: [entry()] }, { username: "alice" });
    if (!created.ok) throw new Error(created.error);
    const blocked = await svc.update(created.proposal.id, "add_blocker", {
      username: "blake",
      body: "Publishing this draft drops the EN byline and publish date from a live, indexed post. Copy them to _common.yml first.",
    });
    if (!blocked.ok) throw new Error(blocked.error);
    const blockerId = blocked.proposal.blockers.find((b) => b.status === "open")!.id;
    const before = svc.get(created.proposal.id)!;

    const dry = await svc.update(created.proposal.id, "apply", { username: "bob", dry_run: true });
    expect(dry.ok).toBe(true);
    if (!dry.ok) return;
    expect(dry.dry_run).toBe(true);
    const warn = dry.warnings?.find((w) => w.code === "preview_while_blocked");
    expect(warn?.details).toEqual({ open_blocker_ids: [blockerId] });
    expect(promoteCalls.map((c) => c.opts.dry_run === true)).toEqual([true]);

    const after = svc.get(created.proposal.id)!;
    expect(after.status).toBe("open");
    expect(after.updated_at).toBe(before.updated_at);
    expect(after.reviewer_action_at).toBe(before.reviewer_action_at);

    const real = await svc.update(created.proposal.id, "apply", { username: "bob" });
    expect(real.ok).toBe(false);
    if (!real.ok) expect(real.code).toBe("proposal_blocked");
    expect(promoteCalls).toHaveLength(1);

    const self = await svc.update(created.proposal.id, "apply", { username: "alice", dry_run: true });
    expect(self.ok).toBe(false);
    if (!self.ok) expect(self.code).toBe("four_eyes");
  });

  it("live moved with conflicting fields → context_stale and needs_author (no overwrite)", async () => {
    const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" } });
    const { svc, promoteCalls } = makeService({
      store: fake.store,
      promote: () => ({
        ok: false,
        code: "draft_base_stale",
        error: "live changed",
        details: { reason: "conflict", conflicting_fields: [{ field_path: "title", author: "New", live: "Live" }] },
      }),
    });
    const created = await svc.create({ title: "Title fix", summary: SUMMARY, entries: [entry()] }, { username: "alice" });
    if (!created.ok) throw new Error(created.error);
    const res = await svc.update(created.proposal.id, "apply", { username: "bob" });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.pending?.[0]).toMatchObject({ code: "context_stale", details: { reason: "live_changed" } });
    expect(promoteCalls).toHaveLength(1);
    expect(res.proposal.stale_since).toBeTruthy();
    expect(toProposalSummary(res.proposal).attention).toBe("needs_author");
    expect(res.proposal.entries[0]!.last_error).toMatch(/^context_stale/);
  });

  it("unknown draft base asks for confirm_base_unknown before publishing", async () => {
    const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" } });
    const { svc, promoteCalls } = makeService({
      store: fake.store,
      promote: (_e, o) =>
        o.confirm_base_unknown ? { ok: true } : { ok: false, code: "draft_base_unknown", error: "no base" },
    });
    const created = await svc.create({ title: "Title fix", summary: SUMMARY, entries: [entry()] }, { username: "alice" });
    if (!created.ok) throw new Error(created.error);
    const first = await svc.update(created.proposal.id, "apply", { username: "bob" });
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.code).toBe("draft_base_unknown");
    expect(svc.get(created.proposal.id)!.entries[0]!.status).toBe("pending");
    const second = await svc.update(created.proposal.id, "apply", { username: "bob", confirm_base_unknown: true });
    expect(second.ok).toBe(true);
    if (second.ok) expect(second.proposal.status).toBe("finished");
    expect(promoteCalls.at(-1)!.opts.confirm_base_unknown).toBe(true);
  });

  it("template proposals report affected pages and need confirm_affected_entries = count", async () => {
    const fake = fakeDraftStore({ "blog/template/es": { title: "Tpl" } });
    fake.entries.add("blog/template");
    fake.store.listAttachedEntries = (ct, locale) => (ct === "blog" && locale === "es" ? ["a", "b", "c", "d"] : []);
    const { svc, promoteCalls } = makeService({ store: fake.store });
    const created = await svc.create(
      { title: "Template copy", summary: SUMMARY, entries: [entry({ slug: "template" })] },
      { username: "alice" },
    );
    if (!created.ok) throw new Error(created.error);
    expect(svc.get(created.proposal.id)!.affected_entries).toMatchObject({ count: 4 });
    expect(svc.get(created.proposal.id)!.affected_entries!.sample).toHaveLength(3);
    const first = await svc.update(created.proposal.id, "apply", { username: "bob" });
    expect(first.ok).toBe(false);
    if (!first.ok) expect(first.code).toBe("confirm_affected_entries");
    expect(promoteCalls.filter((c) => !c.opts.dry_run)).toHaveLength(0);
    const wrong = await svc.update(created.proposal.id, "apply", { username: "bob", confirm_affected_entries: 3 });
    expect(wrong.ok).toBe(false);
    const ok = await svc.update(created.proposal.id, "apply", { username: "bob", confirm_affected_entries: 4 });
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.proposal.status).toBe("finished");
  });

  it("snapshot export/replace keeps v1 columns and the original request", async () => {
    const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" } });
    const { svc } = makeService({ store: fake.store });
    const created = await svc.create(
      { title: "Title fix", summary: SUMMARY, entries: [entry()], all_or_nothing: true },
      { username: "alice" },
    );
    if (!created.ok) throw new Error(created.error);
    await svc.update(created.proposal.id, "apply", { username: "bob" });
    const snap = exportAllProposals(SITE);
    expect(replaceProposalsFromSnapshot(SITE, snap)).toBe(snap.length);
    const row = getSiteSqlite(SITE)
      .prepare(
        `SELECT p.system_version, p.all_or_nothing, e.created_draft, e.ops_json, e.pre_apply_snapshot_json
         FROM content_proposals p JOIN content_proposal_entries e ON e.proposal_id = p.id WHERE p.id = ?`,
      )
      .get(created.proposal.id) as Record<string, unknown>;
    expect(row).toMatchObject({ system_version: "1.0", all_or_nothing: 1, created_draft: 1 });
    expect(JSON.parse(String(row.ops_json))).toEqual([{ field_path: "title", value: "New" }]);
    expect(JSON.parse(String(row.pre_apply_snapshot_json))).toEqual({ live: "title: Old\n", common: null });
  });

  it("all_or_nothing publishes nothing when one entry fails", async () => {
    const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" }, "blog/other/es": { title: "O" } });
    const { svc, promoteCalls } = makeService({
      store: fake.store,
      promote: (e) => (e.slug === "other" ? { ok: false, code: "seo_gate", error: "missing seo" } : { ok: true }),
    });
    const created = await svc.create(
      { title: "Two", summary: SUMMARY, entries: [entry(), entry({ slug: "other" })], all_or_nothing: true },
      { username: "alice" },
    );
    if (!created.ok) throw new Error(created.error);
    expect(created.proposal.all_or_nothing).toBe(true);
    const res = await svc.update(created.proposal.id, "apply", { username: "bob" });
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.code).toBe("all_or_nothing_blocked");
    expect(promoteCalls.every((c) => c.opts.dry_run)).toBe(true);
  });

  it("reject deletes drafts the proposal created and unlinks pre-existing ones", async () => {
    const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" }, "blog/other/es": { title: "O" } });
    fake.store.create({ contentType: "blog", slug: "other", locale: "es", variant: "mine" }, { author: "s" });
    const { svc } = makeService({ store: fake.store });
    const created = await svc.create(
      { title: "Two", summary: SUMMARY, entries: [entry(), entry({ slug: "other", variant: "mine" })] },
      { username: "alice" },
    );
    if (!created.ok) throw new Error(created.error);
    const res = await svc.update(created.proposal.id, "reject", {
      username: "bob",
      confirm_reject: true,
      reject_kind: "harmful",
      close_note: "This change would mislead readers about pricing and must not ship on this page at all.",
    });
    expect(res.ok).toBe(true);
    expect(fake.drafts.has("blog/hello/es/draft")).toBe(false);
    expect(fake.drafts.get("blog/other/es/mine")?.link).toBeNull();
    if (res.ok) expect(res.warnings?.map((w) => w.code)).toEqual(["draft_deleted", "draft_kept"]);
  });

  it("revise_entries restarts a created draft from live and drops removed entries", async () => {
    const fake = fakeDraftStore({ "blog/hello/es": { title: "Old", description: "D" }, "blog/other/es": { title: "O" } });
    const { svc } = makeService({ store: fake.store });
    const created = await svc.create(
      {
        title: "Two",
        summary: SUMMARY,
        entries: [entry({ updates: [{ field_path: "description", value: "New D" }] }), entry({ slug: "other" })],
      },
      { username: "alice" },
    );
    if (!created.ok) throw new Error(created.error);
    const res = await svc.update(created.proposal.id, "revise_entries", {
      username: "alice",
      entries: [entry()],
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(fake.drafts.get("blog/hello/es/draft")!.data).toEqual({ title: "New", description: "D" });
    expect(fake.drafts.has("blog/other/es/draft")).toBe(false);
    expect(res.proposal.entries).toHaveLength(1);
  });

  it("direct draft edits by staff make them co-author and block their approval", async () => {
    const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" } });
    const { svc } = makeService({ store: fake.store });
    const created = await svc.create({ title: "Title fix", summary: SUMMARY, entries: [entry()] }, { username: "alice" });
    if (!created.ok) throw new Error(created.error);
    const tmp = path.join(os.tmpdir(), `v1-coauthor-${Date.now()}`, "hello");
    fs.mkdirSync(tmp, { recursive: true });
    const file = path.join(tmp, "draft.es.yml");
    fs.writeFileSync(file, "title: Staff title\n");
    const absorbed = absorbDraftEdit(SITE, created.proposal.id, file, "staffer");
    expect(absorbed).toEqual({ absorbed: true, co_author: true });
    const p = svc.get(created.proposal.id)!;
    expect(p.co_authors.map((c) => c.username)).toEqual(["staffer"]);
    const res = await svc.update(created.proposal.id, "apply", { username: "staffer" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.code).toBe("four_eyes_co_author");
  });

  it("system draft writes record the fingerprint without adding a co-author", async () => {
    const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" } });
    const { svc } = makeService({ store: fake.store });
    const created = await svc.create({ title: "Title fix", summary: SUMMARY, entries: [entry()] }, { username: "alice" });
    if (!created.ok) throw new Error(created.error);
    const tmp = path.join(os.tmpdir(), `v1-system-write-${Date.now()}`, "hello");
    fs.mkdirSync(tmp, { recursive: true });
    const file = path.join(tmp, "draft.es.yml");
    for (const [i, editor] of ["", "unknown", "migration:006", "system:proposal-stale-sweep"].entries()) {
      fs.writeFileSync(file, `title: Cleaned ${i}\n`);
      expect(absorbDraftEdit(SITE, created.proposal.id, file, editor), editor).toEqual({ absorbed: true, co_author: false });
    }
    const p = svc.get(created.proposal.id)!;
    expect(p.co_authors).toEqual([]);
    expect(p.entries[0]!.variant_fingerprint).toBe(hashVariantFileContents("title: Cleaned 3\n"));
  });

  it("revise_entries still restarts the draft from live when the only co-authors are system writes", async () => {
    const fake = fakeDraftStore({ "blog/hello/es": { title: "Old", description: "D" } });
    const { svc } = makeService({ store: fake.store });
    const created = await svc.create(
      { title: "One", summary: SUMMARY, entries: [entry({ updates: [{ field_path: "description", value: "New D" }] })] },
      { username: "alice" },
    );
    if (!created.ok) throw new Error(created.error);
    const setCoAuthors = (names: string[]) =>
      getSiteSqlite(SITE)
        .prepare(`UPDATE content_proposals SET co_authors_json = ? WHERE id = ?`)
        .run(JSON.stringify(names.map((username) => ({ username, at: Date.now() }))), created.proposal.id);

    setCoAuthors(["unknown"]);
    const reset = await svc.update(created.proposal.id, "revise_entries", { username: "alice", entries: [entry()] });
    expect(reset.ok).toBe(true);
    expect(fake.drafts.get("blog/hello/es/draft")!.data).toEqual({ title: "New", description: "D" });

    await svc.update(created.proposal.id, "revise_entries", {
      username: "alice",
      entries: [entry({ updates: [{ field_path: "description", value: "Staff D" }] })],
    });
    setCoAuthors(["unknown", "staffer"]);
    const kept = await svc.update(created.proposal.id, "revise_entries", { username: "alice", entries: [entry()] });
    expect(kept.ok).toBe(true);
    expect(fake.drafts.get("blog/hello/es/draft")!.data).toMatchObject({ description: "Staff D" });
  });

  it("flags draft fields the author did not send (updated_at is a system stamp)", async () => {
    const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" } });
    const { svc } = makeService({ store: fake.store });
    const created = await svc.create({ title: "Title fix", summary: SUMMARY, entries: [entry()] }, { username: "alice" });
    if (!created.ok) throw new Error(created.error);
    const draft = fake.drafts.get("blog/hello/es/draft")!;
    draft.data = { ...draft.data, updated_at: "2026-10-22T00:00:00Z" };
    expect(svc.get(created.proposal.id)!.entries[0]).toMatchObject({ ops_match_request: true });
    expect(svc.get(created.proposal.id)!.entries[0]!.unrequested_fields).toBeUndefined();

    draft.data = { ...draft.data, tags: ["career-support"], funnel: { stage: "awareness", products: "all" } };
    const e = svc.get(created.proposal.id)!.entries[0]!;
    expect(e.ops_match_request).toBe(false);
    expect([...(e.unrequested_fields ?? [])].sort()).toEqual(["funnel", "tags"]);
  });

  it("isSystemDraftEditor: processes are not people", () => {
    for (const e of ["", "  ", "unknown", "Unknown", "system", "github-pull", "migration:006", "system:applies-after"]) {
      expect(isSystemDraftEditor(e), e).toBe(true);
    }
    for (const e of ["alice", "aalejo@gmail.com", "agent", "systems-team"]) {
      expect(isSystemDraftEditor(e), e).toBe(false);
    }
  });

  it("pre-1.0 proposals are read-only (legacy_version) but can still be withdrawn", async () => {
    const legacy = createProposalService({
      site: SITE,
      issueExists: () => true,
      captureBaseline: () => ({ values: { "call_to_action.title": "Old" } }),
      applyUpdates: async () => ({ ok: true }),
    });
    const created = await legacy.create(
      { title: "Legacy", summary: SUMMARY, entries: [entry({ updates: [{ field_path: "call_to_action.title", value: "N" }] })] },
      { username: "alice" },
    );
    if (!created.ok) throw new Error(created.error);
    expect(created.proposal.system_version).toBeNull();
    const fake = fakeDraftStore();
    const { svc } = makeService({ store: fake.store });
    const claim = await svc.update(created.proposal.id, "claim", { username: "bob" });
    expect(claim.ok).toBe(false);
    if (!claim.ok) expect(claim.code).toBe("legacy_version");
    const preview = await svc.update(created.proposal.id, "apply", { username: "bob", dry_run: true });
    expect(preview.ok).toBe(false);
    if (!preview.ok) expect(preview.code).toBe("legacy_version");
    expect(svc.get(created.proposal.id)!.entries[0]!.status).toBe("pending");
    const withdraw = await svc.update(created.proposal.id, "withdraw", {
      username: "alice",
      close_note: "Superseded by the draft-first flow, refiling as v1.",
    });
    expect(withdraw.ok).toBe(true);
    const row = getSiteSqlite(SITE)
      .prepare(`SELECT system_version FROM content_proposals WHERE id = ?`)
      .get(created.proposal.id) as { system_version: string | null };
    expect(row.system_version).toBeNull();
  });

  describe("legacy cutover", () => {
    async function legacyProposal(entries: ProposalEntryInput[], baseline: Record<string, unknown>) {
      const legacy = createProposalService({
        site: SITE,
        issueExists: () => true,
        captureBaseline: () => ({ values: baseline }),
        applyUpdates: async () => ({ ok: true }),
      });
      const created = await legacy.create({ title: "Legacy", summary: SUMMARY, entries }, { username: "alice" });
      if (!created.ok) throw new Error(created.error);
      return created.proposal.id;
    }

    it("soft edits get their own draft-p{id6} with the ops; existing drafts stay untouched", async () => {
      const id = await legacyProposal([entry()], { title: "Old" });
      const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" } });
      fake.store.create({ contentType: "blog", slug: "hello", locale: "es", variant: "draft" }, { author: "staff" });
      const { svc } = makeService({ store: fake.store });
      const report = await svc.migrateLegacy({ author: "system" });
      expect(report.closed).toEqual([]);
      const variant = report.migrated[0]!.entries[0]!.variant;
      expect(variant).toMatch(/^draft-p[a-z0-9]{6}$/);
      expect(fake.drafts.get(`blog/hello/es/${variant}`)!.data).toEqual({ title: "New" });
      expect(fake.drafts.get(`blog/hello/es/${variant}`)!.link).toMatchObject({ id, created_by_proposal: true });
      expect(fake.drafts.get("blog/hello/es/draft")!.data).toEqual({ title: "Old" });
      const p = svc.get(id)!;
      expect(p.system_version).toBe("1.0");
      expect(p.review_mode).toBe("draft_backed");
      expect(p.entries[0]!.created_draft).toBe(true);
      expect(p.stale_since).toBeNull();
      const claim = await svc.update(id, "claim", { username: "bob" });
      expect(claim.ok).toBe(true);
    });

    it("starts context_stale when live no longer matches the stored baseline", async () => {
      const id = await legacyProposal([entry()], { title: "Older" });
      const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" } });
      const { svc } = makeService({ store: fake.store });
      const report = await svc.migrateLegacy({ author: "system" });
      expect(report.migrated[0]!.stale?.[0]?.fields).toEqual(["title"]);
      expect(toProposalSummary(svc.get(id)!).attention).toBe("needs_author");
    });

    it("closes proposals whose page is gone with legacy_version; ideas only change version", async () => {
      const gone = await legacyProposal([entry({ slug: "other" })], { title: "Old" });
      const legacy = createProposalService({
        site: SITE,
        issueExists: () => true,
        captureBaseline: () => ({ values: {} }),
        applyUpdates: async () => ({ ok: true }),
      });
      const idea = await legacy.create(
        { kind: "notes", title: "A note", summary: SUMMARY, entries: [] },
        { username: "alice" },
      );
      if (!idea.ok) throw new Error(idea.error);
      const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" } });
      const { svc } = makeService({ store: fake.store });
      const dry = await svc.migrateLegacy({ author: "system", dry_run: true });
      expect(dry.closed.map((c) => c.id)).toEqual([gone]);
      expect(svc.get(gone)!.status).toBe("open");
      const report = await svc.migrateLegacy({ author: "system" });
      expect(report.closed[0]).toMatchObject({ id: gone });
      const closed = svc.get(gone)!;
      expect(closed.status).toBe("withdrawn");
      expect(closed.close_reason).toBe("legacy_version");
      expect(svc.get(idea.proposal.id)!.system_version).toBe("1.0");
      expect(fake.drafts.size).toBe(0);
    });
  });

  describe("phase 3: stale sweep, link check, revert", () => {
    const DAY = 24 * 60 * 60 * 1000;

    it("marks drift, flags at 10 days and closes at 30 (created drafts deleted)", async () => {
      const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" } });
      const { svc } = makeService({ store: fake.store });
      const created = await svc.create({ title: "Title fix", summary: SUMMARY, entries: [entry()] }, { username: "alice" });
      if (!created.ok) throw new Error(created.error);
      const id = created.proposal.id;
      fake.drafts.get("blog/hello/es/draft")!.baseStatus = "stale";
      const t0 = Date.now();
      expect((await svc.staleSweep({ now: t0 })).marked).toEqual([id]);
      expect(toProposalSummary(svc.get(id)!).attention).toBe("needs_author");
      expect((await svc.staleSweep({ now: t0 + 9 * DAY })).flagged).toEqual([]);
      expect((await svc.staleSweep({ now: t0 + 11 * DAY })).flagged).toEqual([id]);
      expect(svc.get(id)!.stale_flagged_at).toBeTruthy();
      expect((await svc.staleSweep({ now: t0 + 31 * DAY })).closed).toEqual([id]);
      const closed = svc.get(id)!;
      expect(closed.status).toBe("withdrawn");
      expect(closed.close_reason).toBe("abandoned_stale");
      expect(fake.drafts.has("blog/hello/es/draft")).toBe(false);
    });

    it("clears stale_since when the draft is current again", async () => {
      const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" } });
      const { svc } = makeService({ store: fake.store });
      const created = await svc.create({ title: "Title fix", summary: SUMMARY, entries: [entry()] }, { username: "alice" });
      if (!created.ok) throw new Error(created.error);
      fake.drafts.get("blog/hello/es/draft")!.baseStatus = "stale";
      await svc.staleSweep();
      fake.drafts.get("blog/hello/es/draft")!.baseStatus = "ok";
      expect((await svc.staleSweep()).cleared).toEqual([created.proposal.id]);
      expect(svc.get(created.proposal.id)!.stale_since).toBeNull();
    });

    it("link check: a proposal missing from this database counts as closed, whatever the old env label", async () => {
      const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" }, "blog/other/es": { title: "O" } });
      const { svc } = makeService({ store: fake.store });
      const draftA = { contentType: "blog", slug: "hello", locale: "es", variant: "draft" };
      const draftB = { contentType: "blog", slug: "other", locale: "es", variant: "draft" };
      fake.store.create(draftA, { author: "x" });
      fake.store.create(draftB, { author: "x" });
      fake.store.link(draftA, { id: "gone-a", env: "unknown", created_by_proposal: true, created_fingerprint: fake.store.fingerprint(draftA)! }, "x");
      fake.store.link(draftB, { id: "gone-b", env: "laptop-alice" }, "x");
      const t0 = Date.now();
      const first = await svc.verifyDraftLinks({ now: t0 });
      expect(first.orphaned).toHaveLength(2);
      expect(first.unverified).toHaveLength(0);
      const later = await svc.verifyDraftLinks({ now: t0 + 8 * DAY });
      expect(later.cleaned).toEqual(
        expect.arrayContaining([
          { draft: "blog/hello draft.es", deleted: true },
          { draft: "blog/other draft.es", deleted: false },
        ]),
      );
      expect(fake.drafts.has("blog/hello/es/draft")).toBe(false);
      expect(fake.drafts.has("blog/other/es/draft")).toBe(true);
      expect(fake.drafts.get("blog/other/es/draft")!.link).toBeNull();
    });

    it("link check: a draft whose proposal is open here is left linked", async () => {
      const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" } });
      const { svc } = makeService({ store: fake.store });
      const created = await svc.create({ title: "Title fix", summary: SUMMARY, entries: [entry()] }, { username: "alice" });
      if (!created.ok) throw new Error(created.error);
      const report = await svc.verifyDraftLinks();
      expect(report.orphaned).toHaveLength(0);
      expect(fake.drafts.get("blog/hello/es/draft")!.link?.id).toBe(created.proposal.id);
    });

    it("revert opens a proposal that puts back the old values and reports conflicts", async () => {
      const live: Record<string, Record<string, unknown>> = { "blog/hello/es": { title: "Old", description: "D" } };
      const fake = fakeDraftStore(live);
      const { svc } = makeService({
        store: fake.store,
        promote: () => ({
          ok: true,
          published_diff: [
            { field_path: "title", before: "Old", after: "New", scope: "locale" },
            { field_path: "description", before: "D", after: "D2", scope: "locale" },
          ],
        }),
      });
      const created = await svc.create({ title: "Title fix", summary: SUMMARY, entries: [entry()] }, { username: "alice" });
      if (!created.ok) throw new Error(created.error);
      await svc.update(created.proposal.id, "apply", { username: "bob" });
      live["blog/hello/es"] = { title: "New", description: "Changed later" };
      fake.drafts.clear();
      const res = await svc.update(created.proposal.id, "revert", { username: "carol" });
      expect(res.ok).toBe(true);
      if (!res.ok) return;
      expect(res.reverted_from).toBe(created.proposal.id);
      expect(res.proposal.reverts_proposal_id).toBe(created.proposal.id);
      expect(res.conflicting_fields?.map((c) => c.field_path)).toEqual(["description"]);
      expect(fake.drafts.get("blog/hello/es/draft")!.data).toEqual({ title: "Old", description: "Changed later" });
    });

    it("reverting an accepted idea's applied edit leaves the page released and the idea not stalled", async () => {
      const live: Record<string, Record<string, unknown>> = { "blog/hello/es": { title: "Old" } };
      const fake = fakeDraftStore(live);
      const { svc } = makeService({ store: fake.store });
      const page = { contentType: "blog", slug: "hello", locale: "es" };
      const fileIdea = async (title: string) => {
        const res = await svc.create(
          { kind: "idea", title, summary: `${title}. ${SUMMARY}`, related_entries: [page], confirm_distinct: true },
          { username: "alice" },
        );
        if (!res.ok) throw new Error(res.error);
        return res.proposal.id;
      };
      const accept = (id: string) =>
        svc.update(id, "accept", {
          username: "bob",
          next_step: "Ship the title refresh in a follow-up edits proposal.",
          accepted_entry: page,
        });
      const idea = await fileIdea("Title refresh idea");
      expect((await accept(idea)).ok).toBe(true);
      const edits = await svc.create(
        { title: "Title refresh", summary: SUMMARY, implements_proposal_id: idea, entries: [entry()] },
        { username: "alice" },
      );
      if (!edits.ok) throw new Error(edits.error);
      expect((await svc.update(edits.proposal.id, "apply", { username: "bob" })).ok).toBe(true);
      live["blog/hello/es"] = { title: "New" };
      fake.drafts.clear();

      const revert = await svc.update(edits.proposal.id, "revert", { username: "carol" });
      expect(revert.ok ? "ok" : `${revert.code}: ${revert.error}`).toBe("ok");
      if (!revert.ok) return;
      expect((await svc.update(revert.proposal.id, "apply", { username: "bob" })).ok).toBe(true);
      expect(svc.stats().stalled_ideas).toBe(0);

      const next = await fileIdea("Second title idea");
      expect((await accept(next)).ok).toBe(true);
    });
  });

  describe("staff bulk delete", () => {
    beforeEach(() => setLiveServerForTests(true));
    afterEach(() => setLiveServerForTests(null));

    const staff = { username: "steward" };
    const countRows = (id: string) => {
      const db = getSiteSqlite(SITE);
      const one = (sql: string) => (db.prepare(sql).get(id) as { n: number }).n;
      return {
        proposals: one(`SELECT COUNT(*) AS n FROM content_proposals WHERE id = ?`),
        entries: one(`SELECT COUNT(*) AS n FROM content_proposal_entries WHERE proposal_id = ?`),
        blockers: one(`SELECT COUNT(*) AS n FROM content_proposal_blockers WHERE proposal_id = ?`),
      };
    };

    async function createOne(fake: ReturnType<typeof fakeDraftStore>, e = entry()) {
      const { svc } = makeService({ store: fake.store });
      const created = await svc.create({ title: "Title fix", summary: SUMMARY, entries: [e] }, { username: "alice" });
      if (!created.ok) throw new Error(created.error);
      return { svc, id: created.proposal.id };
    }

    it("deletes rows in all three tables and removes the draft the proposal created", async () => {
      const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" } });
      const { svc, id } = await createOne(fake);
      getSiteSqlite(SITE)
        .prepare(
          `INSERT INTO content_proposal_blockers (proposal_id, body, author, created_at) VALUES (?, 'stuck', 'bob', ?)`,
        )
        .run(id, Date.now());
      expect(countRows(id).blockers).toBe(1);
      const { results } = await svc.deleteProposals([id], staff);
      expect(results[0]).toMatchObject({ id, status: "deleted" });
      expect(results[0]!.drafts_removed).toHaveLength(1);
      expect(countRows(id)).toEqual({ proposals: 0, entries: 0, blockers: 0 });
      expect(fake.drafts.has("blog/hello/es/draft")).toBe(false);
      expect(fake.removed).toEqual(["blog/hello/es/draft"]);
    });

    it("keeps and unlinks a pre-existing linked draft", async () => {
      const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" } });
      fake.store.create({ contentType: "blog", slug: "hello", locale: "es", variant: "translation" }, { author: "t" });
      const { svc, id } = await createOne(fake, entry({ variant: "translation" }));
      expect(fake.drafts.get("blog/hello/es/translation")!.link?.id).toBe(id);
      const { results } = await svc.deleteProposals([id], staff);
      expect(results[0]!.status).toBe("deleted");
      expect(results[0]!.drafts_unlinked).toHaveLength(1);
      expect(fake.drafts.has("blog/hello/es/translation")).toBe(true);
      expect(fake.drafts.get("blog/hello/es/translation")!.link).toBeNull();
    });

    it("does not rewrite an older draft that has no link", async () => {
      const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" } });
      fake.store.create({ contentType: "blog", slug: "hello", locale: "es", variant: "translation" }, { author: "t" });
      const { svc, id } = await createOne(fake, entry({ variant: "translation" }));
      fake.drafts.get("blog/hello/es/translation")!.link = null;
      const linkSpy = vi.spyOn(fake.store, "link");
      const { results } = await svc.deleteProposals([id], staff);
      expect(results[0]!.status).toBe("deleted");
      expect(linkSpy).not.toHaveBeenCalled();
      expect(fake.drafts.has("blog/hello/es/translation")).toBe(true);
    });

    it("keeps (unlinks) a created draft when the proposal has co-authors", async () => {
      const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" } });
      const { svc, id } = await createOne(fake);
      getSiteSqlite(SITE)
        .prepare(`UPDATE content_proposals SET co_authors_json = ? WHERE id = ?`)
        .run(JSON.stringify([{ username: "staffer", at: Date.now() }]), id);
      const { results } = await svc.deleteProposals([id], staff);
      expect(results[0]!.status).toBe("deleted");
      expect(results[0]!.drafts_kept).toHaveLength(1);
      expect(fake.drafts.has("blog/hello/es/draft")).toBe(true);
      expect(fake.drafts.get("blog/hello/es/draft")!.link).toBeNull();
    });

    it("off the live server drafts are left untouched (test copy)", async () => {
      setLiveServerForTests(false);
      const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" } });
      const { svc, id } = await createOne(fake);
      const { results } = await svc.deleteProposals([id], staff);
      expect(results[0]!.status).toBe("deleted");
      expect(results[0]!.drafts_removed).toHaveLength(0);
      expect(fake.drafts.has("blog/hello/es/draft")).toBe(true);
      expect(fake.drafts.get("blog/hello/es/draft")!.link?.id).toBe(id);
    });

    it("on the live server a created draft is removed even with no link or an old env label", async () => {
      const a = fakeDraftStore({ "blog/hello/es": { title: "Old" } });
      const one = await createOne(a);
      a.drafts.get("blog/hello/es/draft")!.link = null;
      expect((await one.svc.deleteProposals([one.id], staff)).results[0]!.drafts_removed).toHaveLength(1);
      expect(a.drafts.has("blog/hello/es/draft")).toBe(false);

      const b = fakeDraftStore({ "blog/other/es": { title: "O" } });
      const two = await createOne(b, entry({ slug: "other" }));
      b.drafts.get("blog/other/es/draft")!.link!.env = "laptop-alice";
      expect((await two.svc.deleteProposals([two.id], staff)).results[0]!.drafts_removed).toHaveLength(1);
      expect(b.drafts.has("blog/other/es/draft")).toBe(false);
    });

    it("blocks an idea with an open implementing proposal unless both are selected", async () => {
      const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" }, "blog/other/es": { title: "O" } });
      const { svc, id: ideaId } = await createOne(fake);
      const { id: implId } = await createOne(fake, entry({ slug: "other" }));
      const db = getSiteSqlite(SITE);
      db.prepare(`UPDATE content_proposals SET kind = 'idea' WHERE id = ?`).run(ideaId);
      db.prepare(`UPDATE content_proposals SET implements_proposal_id = ? WHERE id = ?`).run(ideaId, implId);

      const blocked = await svc.deleteProposals([ideaId], staff);
      expect(blocked.results[0]).toMatchObject({ id: ideaId, status: "blocked_dependents" });
      expect(blocked.results[0]!.dependents).toEqual([{ id: implId, title: "Title fix" }]);
      expect(countRows(ideaId).proposals).toBe(1);

      const both = await svc.deleteProposals([ideaId, implId], staff);
      expect(both.results.map((r) => r.status)).toEqual(["deleted", "deleted"]);
      expect(countRows(ideaId).proposals + countRows(implId).proposals).toBe(0);
    });

    it("stores the full snapshot on the proposal_deleted event and reports proposal_deleted afterwards", async () => {
      const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" } });
      const { svc, id } = await createOne(fake);
      await svc.deleteProposals([id], staff);
      const row = getSiteSqlite(SITE)
        .prepare(`SELECT payload_json FROM events WHERE type = 'proposal_deleted' ORDER BY id DESC LIMIT 1`)
        .get() as { payload_json: string };
      const payload = JSON.parse(row.payload_json) as {
        proposal_id: string;
        snapshot: { id: string; title: string; entries: Array<{ ops: unknown }> };
      };
      expect(payload.proposal_id).toBe(id);
      expect(payload.snapshot.id).toBe(id);
      expect(payload.snapshot.title).toBe("Title fix");
      expect(payload.snapshot.entries[0]!.ops).toEqual([{ field_path: "title", value: "New" }]);

      expect(svc.deletion(id)).toMatchObject({ deleted_by: "steward" });
      const res = await svc.update(id, "withdraw", { username: "alice", close_note: "no longer needed" });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe("proposal_deleted");
    });

    it("records an error and keeps the row when a draft removal throws", async () => {
      const fake = fakeDraftStore({ "blog/hello/es": { title: "Old" } });
      const { svc, id } = await createOne(fake);
      fake.store.remove = async () => {
        throw new Error("disk full");
      };
      const { results } = await svc.deleteProposals([id], staff);
      expect(results[0]!.status).toBe("error");
      expect(results[0]!.reason).toContain("disk full");
      expect(countRows(id).proposals).toBe(1);
      expect(svc.deletion(id)).toBeNull();
    });

    it("returns not_found for an unknown id", async () => {
      const fake = fakeDraftStore();
      const { svc } = makeService({ store: fake.store });
      const { results } = await svc.deleteProposals(["nope"], staff);
      expect(results).toEqual([
        { id: "nope", status: "not_found", reason: "Proposal not found", drafts_removed: [], drafts_unlinked: [], drafts_kept: [] },
      ]);
    });
  });

  describe("applies_after_proposal_id (order-only chains)", () => {
    const live = () => ({
      "blog/hello/es": { title: "Old" },
      "blog/other/es": { title: "O" },
      "blog/third/es": { title: "T" },
    });
    const REJECT_NOTE = "This change would mislead readers about pricing and must not ship on this page at all.";

    async function chain(
      svc: ReturnType<typeof makeService>["svc"],
      opts: { predEntries?: ProposalEntryInput[] } = {},
    ) {
      const pred = await svc.create(
        { title: "New page", summary: SUMMARY, entries: opts.predEntries ?? [entry()] },
        { username: "alice" },
      );
      if (!pred.ok) throw new Error(pred.error);
      const dep = await svc.create(
        {
          title: "Hub link",
          summary: SUMMARY,
          entries: [entry({ slug: opts.predEntries ? "third" : "other" })],
          applies_after_proposal_id: pred.proposal.id,
        },
        { username: "alice" },
      );
      if (!dep.ok) throw new Error(dep.error);
      return { predId: pred.proposal.id, depId: dep.proposal.id };
    }

    it("refuses apply until the predecessor is finished, then flags dependents_ready", async () => {
      const fake = fakeDraftStore(live());
      const { svc } = makeService({ store: fake.store });
      const { predId, depId } = await chain(svc);
      expect(svc.get(predId)!.applied_before_proposal_ids).toEqual([depId]);
      expect(svc.get(depId)!.applies_after_proposal_id).toBe(predId);

      const early = await svc.update(depId, "apply", { username: "bob" });
      expect(early.ok).toBe(false);
      if (!early.ok) expect(early.code).toBe("predecessor_not_applied");

      const first = await svc.update(predId, "apply", { username: "bob" });
      expect(first.ok).toBe(true);
      if (!first.ok) return;
      const ready = first.warnings?.find((w) => w.code === "dependents_ready");
      expect(ready?.details?.dependents).toEqual([{ id: depId, title: "Hub link" }]);
      expect(svc.get(depId)!.status).toBe("open");
      expect(toProposalSummary(svc.get(depId)!).attention).toBe("predecessor_applied");
      const queue = svc.list({ sort: "attention", attention_perspective: "reviewer" }).proposals.map((p) => p.id);
      expect(queue[0]).toBe(depId);

      const second = await svc.update(depId, "apply", { username: "bob" });
      expect(second.ok).toBe(true);
      if (second.ok) expect(second.proposal.status).toBe("finished");
    });

    it("partly published predecessor still blocks the dependent", async () => {
      const fake = fakeDraftStore(live());
      fake.entries.add("blog/third");
      const { svc } = makeService({
        store: fake.store,
        promote: (e, o) => (!o.dry_run && e.slug === "other" ? { ok: false, code: "promote_failed", error: "nope" } : undefined) as never,
      });
      const { predId, depId } = await chain(svc, { predEntries: [entry(), entry({ slug: "other" })] });
      const first = await svc.update(predId, "apply", { username: "bob" });
      expect(first.ok).toBe(true);
      expect(svc.get(predId)!.status).toBe("partial");
      const res = await svc.update(depId, "apply", { username: "bob" });
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.code).toBe("predecessor_not_applied");
    });

    it("rejecting the predecessor blocks each open dependent; closed predecessors cannot be linked", async () => {
      const fake = fakeDraftStore(live());
      const { svc } = makeService({ store: fake.store });
      const { predId, depId } = await chain(svc);
      const rej = await svc.update(predId, "reject", {
        username: "bob",
        confirm_reject: true,
        reject_kind: "harmful",
        close_note: REJECT_NOTE,
      });
      expect(rej.ok).toBe(true);
      if (rej.ok) expect(rej.warnings?.map((w) => w.code)).toContain("predecessor_closed");
      const dep = svc.get(depId)!;
      expect(dep.open_blocker_count).toBe(1);
      expect(dep.blockers[0]!.body).toContain("predecessor_closed");
      const blockerEv = listEvents({ site: SITE, limit: 200 }).find(
        (e) =>
          e.type === "proposal_blocker_added" &&
          (e.payload as { proposal_id?: string }).proposal_id === depId,
      );
      expect(blockerEv?.payload).toMatchObject({
        blocker_id: dep.blockers[0]!.id,
        staff_summary: dep.blockers[0]!.staff_summary,
      });
      expect(blockerEv?.attribution[0]).toEqual({
        author: "system:applies-after",
        actor: { type: "system", source: "applies-after" },
      });

      const relink = await svc.update(depId, "set_applies_after", { username: "alice", applies_after_proposal_id: predId });
      expect(relink.ok).toBe(false);
      if (!relink.ok) expect(relink.code).toBe("applies_after_closed");
      const unlink = await svc.update(depId, "set_applies_after", { username: "alice", applies_after_proposal_id: "" });
      expect(unlink.ok).toBe(true);
      expect(svc.get(depId)!.applies_after_proposal_id).toBeNull();
    });

    it("set_applies_after refuses cycles and non-proposers", async () => {
      const fake = fakeDraftStore(live());
      const { svc } = makeService({ store: fake.store });
      const { predId, depId } = await chain(svc);
      const cycle = await svc.update(predId, "set_applies_after", { username: "alice", applies_after_proposal_id: depId });
      expect(cycle.ok).toBe(false);
      if (!cycle.ok) expect(cycle.code).toBe("applies_after_cycle");
      const self = await svc.update(depId, "set_applies_after", { username: "alice", applies_after_proposal_id: depId });
      expect(self.ok).toBe(false);
      if (!self.ok) expect(self.code).toBe("applies_after_cycle");
      const other = await svc.update(depId, "set_applies_after", { username: "mallory", applies_after_proposal_id: "" });
      expect(other.ok).toBe(false);
      if (!other.ok) expect(other.code).toBe("not_proposer");
    });

    it("daily sweep flags a dependent overdue after 48h (no escalation, no close) and clears on apply", async () => {
      const fake = fakeDraftStore(live());
      const { svc } = makeService({ store: fake.store });
      const { predId, depId } = await chain(svc);
      expect((await svc.update(predId, "apply", { username: "bob" })).ok).toBe(true);

      expect(svc.dependentOverdueSweep({ now: Date.now() + 47 * 3_600_000 }).flagged).toEqual([]);
      const report = svc.dependentOverdueSweep({ now: Date.now() + 49 * 3_600_000 });
      expect(report.flagged).toEqual([depId]);
      const flagged = svc.get(depId)!;
      expect(flagged.dependent_overdue_flagged_at).toBeTruthy();
      expect(flagged.escalated).toBe(false);
      expect(flagged.status).toBe("open");
      expect(svc.dependentOverdueSweep({ now: Date.now() + 72 * 3_600_000 }).flagged).toEqual([]);

      expect((await svc.update(depId, "apply", { username: "bob" })).ok).toBe(true);
      expect(svc.get(depId)!.dependent_overdue_flagged_at).toBeNull();
    });

    it("snapshot export/replace keeps the chain columns", async () => {
      const fake = fakeDraftStore(live());
      const { svc } = makeService({ store: fake.store });
      const { predId, depId } = await chain(svc);
      const snap = exportAllProposals(SITE);
      replaceProposalsFromSnapshot(SITE, snap);
      expect(svc.get(depId)!.applies_after_proposal_id).toBe(predId);
    });
  });
});
