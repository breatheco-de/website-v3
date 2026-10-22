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

describe("proposal drafts never copy page-level fields from live (#58)", () => {
  it("create: a draft from a locale file with legacy funnel/authors/published_at stages no page-level op", () => {
    const store = storeFor();
    expect(store.create(ref, { author: "writer" })).toEqual({ ok: true });
    const draft = draftData();
    expect(draft.funnel).toBeUndefined();
    expect(draft.authors).toBeUndefined();
    expect(draft.published_at).toBeUndefined();
    expect(draft.meta.robots).toBe("index, follow");
    expect(store.carriesCommon(ref)).toBe(false);
    expect(store.authorDiff(ref)?.changes).toEqual([]);
  });

  it("revise (reset + locale ops only): zero page-level ops and _common.yml untouched", async () => {
    const store = storeFor();
    const commonBefore = fs.readFileSync(path.join(entryDir, "_common.yml"), "utf-8");
    store.create(ref, { author: "writer" });
    expect((await store.write(ref, [{ field_path: "title", value: "First try" }], "writer")).ok).toBe(true);
    store.reset(ref, "writer");
    expect(store.authorDiff(ref)?.changes).toEqual([]);
    const wrote = await store.write(ref, [{ field_path: "title", value: "Revised" }], "writer");
    expect(wrote.ok).toBe(true);
    const changes = store.authorDiff(ref)?.changes ?? [];
    expect(pageLevel(changes)).toEqual([]);
    expect(changes.map((c) => c.field_path)).toEqual(["title", "updated_at"]);
    expect(fs.readFileSync(path.join(entryDir, "_common.yml"), "utf-8")).toBe(commonBefore);
  });

  it("rebuild on top of newer live keeps page-level keys out of the draft", async () => {
    const store = storeFor();
    store.create(ref, { author: "writer" });
    expect((await store.write(ref, [{ field_path: "description", value: "Draft description" }], "writer")).ok).toBe(true);
    fs.writeFileSync(path.join(entryDir, "en.yml"), LIVE_EN.replace("Live title", "Live title v2"), "utf-8");
    const rebuilt = rebuildDraftFromBase({ ...ref, contentRoot }, { author: "writer" });
    expect(rebuilt.ok).toBe(true);
    if (!rebuilt.ok) return;
    expect(rebuilt.result.funnel).toBeUndefined();
    expect(rebuilt.result.published_at).toBeUndefined();
    expect(rebuilt.result.title).toBe("Live title v2");
    expect(pageLevel(rebuilt.author_changes)).toEqual([]);
  });

  it("a page-level op the author does send is still staged", async () => {
    const store = storeFor();
    store.create(ref, { author: "writer" });
    await store.write(ref, [{ field_path: "funnel.stage", value: "decision" }], "writer");
    expect(pageLevel(store.authorDiff(ref)?.changes).map((c) => (c as { field_path: string }).field_path)).toEqual(["funnel"]);
  });
});
