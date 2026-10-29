import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../sync-state", () => ({ markFileAsModified: vi.fn() }));

import { ContentIndex } from "../content-index";
import { resetRegistry } from "../content-types";
import { createMemoryDraftBaseStore, draftSeedFromLiveRaw, rebuildDraftFromBase, setDraftBaseStore } from "../versioning/draft-base";
import { draftStoreForSite, type ProposalDraftRef } from "./draft-store";

const ORIGINAL_CWD = process.cwd();
let tempDir: string;
let contentRoot: string;
let entryDir: string;

const LIVE_EN = `slug: post-a
title: Live title
published_at: "2026-01-15"
authors:
  - old-author
funnel:
  stage: consideration
  products:
    - product: ai-engineering
      persona: the-career-changer
meta:
  page_title: Live
  robots: index, follow
sections: []
`;

function storeFor() {
  const versioning = new Map<string, unknown>();
  return draftStoreForSite({
    contentRoot,
    contentRootName: undefined,
    versioningManager: {
      getVersioningForContent: (t: string, s: string) => versioning.get(`${t}/${s}`) ?? null,
      updateVersioning: (t: string, s: string, data: unknown) => void versioning.set(`${t}/${s}`, data),
    },
    contentIndex: new ContentIndex(contentRoot),
  } as never);
}

const ref: ProposalDraftRef = { contentType: "blog", slug: "post-a", locale: "en", variant: "draft" };
const draftData = () => yaml.load(fs.readFileSync(path.join(entryDir, "draft.en.yml"), "utf-8")) as Record<string, any>;
const pageLevel = (changes: Array<{ scope: string }> | undefined) => (changes ?? []).filter((c) => c.scope === "common");

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "draft-store-"));
  contentRoot = path.join(tempDir, "site_test");
  entryDir = path.join(contentRoot, "blog", "post-a");
  fs.mkdirSync(entryDir, { recursive: true });
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    "blog:\n  directory: blog\n  field_mapping:\n    title: title\n    _slug: slug\n    _locale: locale\n  url_pattern:\n    en: /en/blog/:slug\n",
    "utf-8",
  );
  fs.writeFileSync(
    path.join(entryDir, "_common.yml"),
    "slug: post-a\nauthors:\n  - new-author\nfunnel:\n  stage: awareness\n  products:\n    - ai-engineering\n",
    "utf-8",
  );
  fs.writeFileSync(path.join(entryDir, "en.yml"), LIVE_EN, "utf-8");
  process.chdir(tempDir);
  resetRegistry(contentRoot);
  setDraftBaseStore(createMemoryDraftBaseStore());
});

afterEach(() => {
  process.chdir(ORIGINAL_CWD);
  resetRegistry(contentRoot);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("draftSeedFromLiveRaw", () => {
  it("drops page-level keys and keeps per-language ones (robots included)", () => {
    const seeded = yaml.load(draftSeedFromLiveRaw(LIVE_EN)) as Record<string, unknown>;
    expect(seeded).toEqual({
      slug: "post-a",
      title: "Live title",
      meta: { page_title: "Live", robots: "index, follow" },
      sections: [],
    });
  });

  it("returns the raw text untouched when there is nothing to drop", () => {
    const raw = "title: T\n# a comment\nmeta:\n  page_title: P\n";
    expect(draftSeedFromLiveRaw(raw)).toBe(raw);
  });
});

const LIVE_FUNNEL = { stage: "consideration", products: [{ product: "ai-engineering", persona: "the-career-changer" }] };
const fieldPaths = (changes: Array<{ field_path: string }> | undefined) => (changes ?? []).map((c) => c.field_path);

describe("proposal drafts never copy page-level fields from live (#58)", () => {
  it("create: legacy authors/published_at stay out; a language funnel that differs from _common.yml is kept", () => {
    const store = storeFor();
    const created = store.create(ref, { author: "writer" });
    expect(created).toEqual({
      ok: true,
      warnings: [expect.objectContaining({ code: "funnel_carried_from_language_file" })],
    });
    const draft = draftData();
    expect(draft.funnel).toEqual(LIVE_FUNNEL);
    expect(draft.authors).toBeUndefined();
    expect(draft.published_at).toBeUndefined();
    expect(draft.meta.robots).toBe("index, follow");
    expect(store.carriesCommon(ref)).toBe(true);
    expect(fieldPaths(store.authorDiff(ref)?.changes)).toEqual(["funnel"]);
  });

  it("create: a language funnel equal to _common.yml is dropped without a warning", () => {
    fs.writeFileSync(
      path.join(entryDir, "en.yml"),
      LIVE_EN.replace(/funnel:[\s\S]*?meta:/, "funnel:\n  stage: awareness\n  products:\n    - product: ai-engineering\nmeta:"),
      "utf-8",
    );
    const store = storeFor();
    expect(store.create(ref, { author: "writer" })).toEqual({ ok: true, warnings: [] });
    expect(draftData().funnel).toBeUndefined();
    expect(store.carriesCommon(ref)).toBe(false);
    expect(store.authorDiff(ref)?.changes).toEqual([]);
  });

  it("revise (reset + locale ops only): only the carried funnel is page-level and _common.yml is untouched", async () => {
    const store = storeFor();
    const commonBefore = fs.readFileSync(path.join(entryDir, "_common.yml"), "utf-8");
    store.create(ref, { author: "writer" });
    expect((await store.write(ref, [{ field_path: "title", value: "First try" }], "writer")).ok).toBe(true);
    expect(store.reset(ref, "writer")).toEqual([expect.objectContaining({ code: "funnel_carried_from_language_file" })]);
    expect(fieldPaths(store.authorDiff(ref)?.changes)).toEqual(["funnel"]);
    const wrote = await store.write(ref, [{ field_path: "title", value: "Revised" }], "writer");
    expect(wrote.ok).toBe(true);
    const changes = store.authorDiff(ref)?.changes ?? [];
    expect(fieldPaths(pageLevel(changes) as Array<{ field_path: string }>)).toEqual(["funnel"]);
    expect(fieldPaths(changes)).toEqual(["funnel", "title", "updated_at"]);
    expect(fs.readFileSync(path.join(entryDir, "_common.yml"), "utf-8")).toBe(commonBefore);
  });

  it("rebuild on top of newer live keeps the carried funnel and no other page-level key", async () => {
    const store = storeFor();
    store.create(ref, { author: "writer" });
    expect((await store.write(ref, [{ field_path: "description", value: "Draft description" }], "writer")).ok).toBe(true);
    fs.writeFileSync(path.join(entryDir, "en.yml"), LIVE_EN.replace("Live title", "Live title v2"), "utf-8");
    const rebuilt = rebuildDraftFromBase({ ...ref, contentRoot }, { author: "writer" });
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    expect(rebuilt.result.funnel).toEqual(LIVE_FUNNEL);
    expect(rebuilt.result.published_at).toBeUndefined();
    expect(rebuilt.result.title).toBe("Live title v2");
    expect(fieldPaths(pageLevel(rebuilt.author_changes) as Array<{ field_path: string }>)).toEqual(["funnel"]);
  });

  it("a page-level op the author does send is still staged", async () => {
    const store = storeFor();
    store.create(ref, { author: "writer" });
    await store.write(ref, [{ field_path: "funnel.stage", value: "decision" }], "writer");
    expect(pageLevel(store.authorDiff(ref)?.changes).map((c) => (c as { field_path: string }).field_path)).toEqual(["funnel"]);
  });
});
