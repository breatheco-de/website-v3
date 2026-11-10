import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import yaml from "js-yaml";

vi.mock("../sync-state", () => ({ markFileAsModified: vi.fn() }));

import { resetRegistry } from "../content-types";
import { createMemoryDraftBaseStore, recordDraftBase, setDraftBaseStore } from "./draft-base";
import { createMemoryDraftActivityStore, setDraftActivityStore } from "./draft-activity";
import { readDraftMeta, writeDraftMeta, writeVariantData } from "./draft-meta";
import { runDraftCleanup, type DraftCleanupDeps } from "./draft-cleanup";
import type { VariantInfoContext } from "./variant-info";

const DAY = 86_400_000;
const T0 = Date.parse("2026-11-09T12:00:00.000Z");
const daysAgo = (n: number) => new Date(T0 - n * DAY).toISOString();

describe("runDraftCleanup", () => {
  const ORIGINAL_CWD = process.cwd();
  let tempDir: string;
  let contentRoot: string;
  let entryDir: string;
  let draftFile: string;
  let events: Array<{ type: string; payload: Record<string, unknown> }>;
  let removed: string[];
  let linked: boolean;

  const ref = { contentType: "landing", slug: "promo", locale: "en", variant: "draft" };

  function deps(): DraftCleanupDeps {
    return {
      contentRoot,
      listDrafts: () =>
        fs.existsSync(draftFile) ? [{ ref, link: linked ? { id: "p1", env: "production" } : null }] : [],
      infoContext: async (): Promise<VariantInfoContext> => ({
        contentType: "landing",
        slug: "promo",
        contentRoot,
        versioning: { en: { variants: [{ slug: "draft", allocation: 0 }] } },
        vm: { getVersioningContentDir: () => entryDir, getRuns: () => [], hasRunHistory: () => true },
        openProposals: [],
        proposalEnv: "production",
        locales: ["en"],
        onLiveServer: true,
      }),
      remove: async (r) => {
        fs.unlinkSync(draftFile);
        removed.push(`${r.variant}.${r.locale}`);
        return { entryDeleted: false };
      },
      emit: (type, _r, payload) => void events.push({ type, payload }),
    };
  }

  const editDraft = (title: string) => writeVariantData(draftFile, { title, _updated_at: daysAgo(200) }, { skipMark: true });

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "draft-cleanup-"));
    contentRoot = path.join(tempDir, "site_test");
    entryDir = path.join(contentRoot, "landings", "promo");
    draftFile = path.join(entryDir, "draft.en.yml");
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(
      path.join(contentRoot, "content-types.yml"),
      "landing:\n  directory: landings\n  url_pattern:\n    en: /en/landing/:slug\n",
      "utf-8",
    );
    process.chdir(tempDir);
    resetRegistry(contentRoot);
    setDraftBaseStore(createMemoryDraftBaseStore());
    setDraftActivityStore(createMemoryDraftActivityStore());
    events = [];
    removed = [];
    linked = false;
    fs.writeFileSync(path.join(entryDir, "_common.yml"), yaml.dump({ slug: "promo" }), "utf-8");
    fs.writeFileSync(path.join(entryDir, "en.yml"), yaml.dump({ title: "Live", _updated_at: daysAgo(200) }), "utf-8");
    fs.writeFileSync(draftFile, yaml.dump({ title: "Live", _updated_at: daysAgo(200) }), "utf-8");
    recordDraftBase({ ...ref, contentRoot }, { skipMark: true, at: new Date(daysAgo(90)) });
  });

  afterEach(() => {
    process.chdir(ORIGINAL_CWD);
    resetRegistry(contentRoot);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("does nothing the first time it sees a draft", async () => {
    const report = await runDraftCleanup(deps(), { now: T0 });
    expect(report).toMatchObject({ checked: 1, first_seen: 1, deleted: [], flagged: [] });
    expect(fs.existsSync(draftFile)).toBe(true);
  });

  it("deletes an idle draft identical to live on the next run", async () => {
    await runDraftCleanup(deps(), { now: T0 });
    const report = await runDraftCleanup(deps(), { now: T0 + DAY });
    expect(report.deleted).toEqual(["landing/promo draft.en"]);
    expect(removed).toEqual(["draft.en"]);
    expect(events.map((e) => e.type)).toEqual(["draft_cleanup_deleted"]);
    expect(events[0].payload).toMatchObject({ tier: "nothing_to_lose", file: "site_test/landings/promo/draft.en.yml" });
  });

  it("flags an idle draft with unpublished work, then an edit clears the flag", async () => {
    editDraft("Changed");
    await runDraftCleanup(deps(), { now: T0 });
    const flagged = await runDraftCleanup(deps(), { now: T0 + DAY });
    expect(flagged.flagged).toHaveLength(1);
    const meta = readDraftMeta(draftFile)!;
    expect(meta.cleanup?.flagged_at).toBe(new Date(T0 + DAY).toISOString());
    expect(meta.cleanup?.deletes_at).toBe(new Date(T0 + 31 * DAY).toISOString());

    const waiting = await runDraftCleanup(deps(), { now: T0 + 2 * DAY });
    expect(waiting.kept_by_reason).toEqual({ flag_waiting: 1 });

    editDraft("Changed again");
    const cleared = await runDraftCleanup(deps(), { now: T0 + 3 * DAY });
    expect(cleared.cleared).toHaveLength(1);
    expect(readDraftMeta(draftFile)?.cleanup).toBeUndefined();
    expect(events.map((e) => e.type)).toEqual(["draft_cleanup_flagged", "draft_cleanup_flag_cleared"]);
    expect(events[1].payload.cause).toBe("edited");
  });

  it("deletes a flagged draft once its date passes", async () => {
    editDraft("Changed");
    await runDraftCleanup(deps(), { now: T0 });
    await runDraftCleanup(deps(), { now: T0 + DAY });
    const report = await runDraftCleanup(deps(), { now: T0 + 32 * DAY });
    expect(report.deleted).toHaveLength(1);
    expect(fs.existsSync(draftFile)).toBe(false);
  });

  it("Keep clears the flag", async () => {
    editDraft("Changed");
    await runDraftCleanup(deps(), { now: T0 });
    await runDraftCleanup(deps(), { now: T0 + DAY });
    writeDraftMeta(draftFile, { kept_at: new Date(T0 + 2 * DAY).toISOString() }, { skipMark: true });
    const report = await runDraftCleanup(deps(), { now: T0 + 3 * DAY });
    expect(report.cleared).toHaveLength(1);
    expect(events.at(-1)?.payload.cause).toBe("kept");
  });

  it("skips drafts linked to a proposal", async () => {
    linked = true;
    await runDraftCleanup(deps(), { now: T0 });
    const report = await runDraftCleanup(deps(), { now: T0 + DAY });
    expect(report.checked).toBe(0);
    expect(fs.existsSync(draftFile)).toBe(true);
  });

  it("dry run writes nothing", async () => {
    await runDraftCleanup(deps(), { now: T0 });
    const report = await runDraftCleanup(deps(), { now: T0 + DAY, dryRun: true });
    expect(report.deleted).toHaveLength(1);
    expect(fs.existsSync(draftFile)).toBe(true);
    expect(events).toEqual([]);
  });
});
