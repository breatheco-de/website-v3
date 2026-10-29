import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import yaml from "js-yaml";

vi.mock("../sync-state", () => ({ markFileAsModified: vi.fn() }));

import { resetRegistry } from "../content-types";
import {
  createMemoryDraftBaseStore,
  diffDraftAgainst,
  draftSeedFromLive,
  draftSeedFromLiveRaw,
  rebuildDraftFromBase,
  recordDraftBase,
  setDraftBaseStore,
  variantRedirectChanges,
  type DraftRef,
} from "./draft-base";

describe("draftSeedFromLive: legacy language funnel", () => {
  const personaFunnel = {
    stage: "consideration",
    products: [{ product: "ai-engineering", persona: "the-career-changer" }],
  };
  const live = yaml.dump({ title: "T", authors: ["a"], funnel: personaFunnel });

  it("keeps a language funnel that differs from _common.yml and reports it", () => {
    const res = draftSeedFromLive(live, {
      commonRaw: yaml.dump({ slug: "p", funnel: { stage: "awareness", products: ["ai-flex"] } }),
    });
    expect(res.carried).toEqual(["funnel"]);
    expect(yaml.load(res.content)).toEqual({ title: "T", funnel: personaFunnel });
  });

  it("carries what visitors see: a partial language copy merged over _common.yml", () => {
    const res = draftSeedFromLive(yaml.dump({ title: "T", funnel: { stage: "decision" } }), {
      commonRaw: yaml.dump({ funnel: { stage: "awareness", products: ["ai-flex"] } }),
    });
    expect(yaml.load(res.content)).toEqual({ title: "T", funnel: { stage: "decision", products: ["ai-flex"] } });
  });

  it("drops a language funnel equal to _common.yml (bare and object products compare equal)", () => {
    const res = draftSeedFromLive(yaml.dump({ title: "T", funnel: { stage: "awareness", products: [{ product: "ai-flex" }] } }), {
      commonRaw: yaml.dump({ funnel: { stage: "awareness", products: ["ai-flex"] } }),
    });
    expect(res.carried).toEqual([]);
    expect(yaml.load(res.content)).toEqual({ title: "T" });
  });

  it("keeps it when _common.yml has no funnel at all", () => {
    const res = draftSeedFromLive(live, { commonRaw: null });
    expect(res.carried).toEqual(["funnel"]);
  });

  it("without commonRaw behaves like draftSeedFromLiveRaw (drops page-level keys)", () => {
    expect(draftSeedFromLive(live).content).toBe(draftSeedFromLiveRaw(live));
    expect(yaml.load(draftSeedFromLiveRaw(live))).toEqual({ title: "T" });
  });
});

describe("diffDraftAgainst", () => {
  it("does not report a removal when live and draft both keep seo.pillar_path: null", () => {
    const live = { meta: { redirects: ["/a"] }, seo: { pillar_path: null } };
    const draft = { meta: { redirects: ["/a", "/b"] }, seo: { pillar_path: null } };
    const changes = diffDraftAgainst(draft, { live, common: null });
    expect(changes.map((c) => c.field_path)).toEqual(["meta.redirects"]);
  });

  it("still reports a removal when the draft drops a nested null live has", () => {
    const changes = diffDraftAgainst({ title: "x" }, { live: { title: "x", seo: { pillar_path: null } }, common: null });
    expect(changes).toEqual([
      { field_path: "seo.pillar_path", before: null, after: undefined, scope: "locale", removed: true },
    ]);
  });

  it("reports a removal when the draft clears a value live has", () => {
    const changes = diffDraftAgainst(
      { seo: { pillar_path: null } },
      { live: { seo: { pillar_path: "/en/blog/hub" } }, common: null },
    );
    expect(changes).toEqual([
      { field_path: "seo.pillar_path", before: "/en/blog/hub", after: undefined, scope: "locale", removed: true },
    ]);
  });

  it("keeps meta.* nulls as removals, since publish deletes them", () => {
    const changes = diffDraftAgainst({ meta: { robots: null } }, { live: { meta: { robots: null } }, common: null });
    expect(changes.map((c) => c.field_path)).toEqual(["meta.robots"]);
  });
});

describe("old addresses (meta.redirects) on drafts", () => {
  const ORIGINAL_CWD = process.cwd();
  let tempDir: string;
  let contentRoot: string;
  let entryDir: string;
  let ref: DraftRef;

  const page = (redirects: unknown[], extra: Record<string, unknown> = {}) =>
    yaml.dump({ slug: "post-a", title: "T", ...extra, meta: { page_title: "P", redirects } });
  const writeLive = (redirects: unknown[], extra?: Record<string, unknown>) =>
    fs.writeFileSync(path.join(entryDir, "en.yml"), page(redirects, extra), "utf-8");
  const writeDraft = (redirects: unknown[], extra?: Record<string, unknown>) =>
    fs.writeFileSync(path.join(entryDir, "draft.en.yml"), page(redirects, extra), "utf-8");

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "draft-base-redirects-"));
    contentRoot = path.join(tempDir, "site_test");
    entryDir = path.join(contentRoot, "blog", "post-a");
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(
      path.join(contentRoot, "content-types.yml"),
      "blog:\n  directory: blog\n  url_pattern:\n    en: /en/blog/:slug\n",
      "utf-8",
    );
    process.chdir(tempDir);
    resetRegistry(contentRoot);
    setDraftBaseStore(createMemoryDraftBaseStore());
    ref = { contentType: "blog", slug: "post-a", locale: "en", variant: "draft", contentRoot };
    writeLive(["/old-a"]);
    writeDraft(["/old-a"]);
    recordDraftBase(ref, { skipMark: true });
  });

  afterEach(() => {
    process.chdir(ORIGINAL_CWD);
    resetRegistry(contentRoot);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("rebuild merges per address: draft adds/removes plus live adds/removes", () => {
    writeDraft(["/draft-add"]);
    writeLive(["/old-a", "/live-add"], { title: "T2" });
    const rebuilt = rebuildDraftFromBase(ref, { preview: true });
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    expect((rebuilt.result.meta as Record<string, unknown>).redirects).toEqual(["/live-add", "/draft-add"]);
    expect(rebuilt.result.title).toBe("T2");
    expect(rebuilt.redirects_kept_from_live).toEqual(["/live-add"]);
  });

  it("a live removal stays removed even though the draft keeps the old copy", () => {
    writeDraft(["/old-a", "/draft-add"]);
    writeLive([]);
    const rebuilt = rebuildDraftFromBase(ref, { preview: true });
    expect(rebuilt.ok).toBe(true);
    if (rebuilt.ok) expect((rebuilt.result.meta as Record<string, unknown>).redirects).toEqual(["/draft-add"]);
  });

  it("the same address changed differently on both sides conflicts on that address only", () => {
    writeDraft([{ path: "/old-a", status: 302 }]);
    writeLive([]);
    const rebuilt = rebuildDraftFromBase(ref, { preview: true });
    expect(rebuilt.ok).toBe(false);
    if (!rebuilt.ok) expect(rebuilt.conflicting_fields?.map((c) => c.field_path)).toEqual(["meta.redirects[/old-a]"]);
  });

  it("variantRedirectChanges compares with today's live: copied addresses are not changes", () => {
    expect(variantRedirectChanges(ref)).toEqual({ added: [], removed: [], changed: [] });
    writeDraft(["/old-a", "/draft-add"]);
    expect(variantRedirectChanges(ref).added.map((i) => i.path)).toEqual(["/draft-add"]);
  });

  it("variantRedirectChanges counts an address live gained after the draft was made as a change", () => {
    writeLive(["/old-a", "/live-add"]);
    expect(variantRedirectChanges(ref).removed.map((i) => i.path)).toEqual(["/live-add"]);
  });
});
