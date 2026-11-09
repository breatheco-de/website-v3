import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import yaml from "js-yaml";

vi.mock("../sync-state", () => ({ markFileAsModified: vi.fn() }));

import { resetRegistry } from "../content-types";
import { createMemoryDraftBaseStore, recordDraftBase, setDraftBaseStore } from "./draft-base";
import { writeDraftMeta, writeVariantData } from "./draft-meta";
import type { TestRun } from "./test-runs";
import { getVariantInfo, getVariantInfoMap, type VariantInfoContext } from "./variant-info";

const NOW = Date.parse("2026-11-09T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

describe("getVariantInfo", () => {
  const ORIGINAL_CWD = process.cwd();
  let tempDir: string;
  let contentRoot: string;
  let entryDir: string;
  let runs: Array<TestRun & { experiment_id: string }>;
  let hasHistory: boolean;

  const write = (file: string, data: Record<string, unknown>) =>
    fs.writeFileSync(path.join(entryDir, file), yaml.dump(data), "utf-8");
  const writeDraft = (data: Record<string, unknown>) =>
    writeVariantData(path.join(entryDir, "draft.en.yml"), data, { skipMark: true });

  function ctx(over: Partial<VariantInfoContext> = {}): VariantInfoContext {
    return {
      contentType: "landing",
      slug: "promo",
      contentRoot,
      versioning: { en: { variants: [{ slug: "draft", allocation: 0 }] } },
      vm: {
        getVersioningContentDir: () => entryDir,
        getRuns: (_t, _s, locale) => runs.filter((r) => r.locale === locale),
        hasRunHistory: () => hasHistory,
      },
      openProposals: [],
      proposalEnv: "production",
      locales: ["en", "es"],
      onLiveServer: true,
      now: NOW,
      ...over,
    };
  }

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "variant-info-"));
    contentRoot = path.join(tempDir, "site_test");
    entryDir = path.join(contentRoot, "landings", "promo");
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(
      path.join(contentRoot, "content-types.yml"),
      "landing:\n  directory: landings\n  url_pattern:\n    en: /en/landing/:slug\n    es: /es/landing/:slug\n",
      "utf-8",
    );
    process.chdir(tempDir);
    resetRegistry(contentRoot);
    setDraftBaseStore(createMemoryDraftBaseStore());
    runs = [];
    hasHistory = true;
    write("_common.yml", { slug: "promo" });
    write("en.yml", { title: "Live", _updated_at: daysAgo(200) });
    write("draft.en.yml", { title: "Live", _updated_at: daysAgo(200) });
    recordDraftBase(
      { contentType: "landing", slug: "promo", locale: "en", variant: "draft", contentRoot },
      { skipMark: true, at: new Date(daysAgo(90)) },
    );
  });

  afterEach(() => {
    process.chdir(ORIGINAL_CWD);
    resetRegistry(contentRoot);
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("stale copy of live with nothing pending is probably safe", () => {
    const info = getVariantInfo(ctx(), "en", "draft", { full: true })!;
    expect(info.facts.created_at).toBe(daysAgo(90));
    expect(info.facts.changes_vs_live).toBe(0);
    expect(info.health.verdict).toBe("probably_safe");
    expect(info.file).toBe("draft.en.yml");
    expect(info.details?.changed_fields).toEqual([]);
  });

  it("a differing date field alone is not a change", () => {
    writeDraft({ title: "Live", _updated_at: daysAgo(60) });
    const info = getVariantInfo(ctx(), "en", "draft")!;
    expect(info.facts.changes_vs_live).toBe(0);
  });

  it("content changes count, and show up as field names in full mode", () => {
    writeDraft({ title: "New headline", _updated_at: daysAgo(60) });
    const info = getVariantInfo(ctx(), "en", "draft", { full: true })!;
    expect(info.facts.changes_vs_live).toBe(1);
    expect(info.details?.changed_fields).toEqual(["title"]);
    expect(info.health.reasons.map((r) => r.code)).toEqual(["changes_not_on_live"]);
  });

  it("an open proposal on this page from the proposals DB is linked", () => {
    const info = getVariantInfo(
      ctx({
        openProposals: [
          { id: "p1", title: "Spring CTA", status: "open", locale: "en", variant: "draft", proposer_username: "ana", proposer_kind: "staff" },
        ],
      }),
      "en",
      "draft",
    )!;
    expect(info.facts.proposal.state).toBe("open");
    expect(info.proposal?.title).toBe("Spring CTA");
    expect(info.health.verdict).toBe("check_first");
  });

  it("a proposal link not found locally is closed on the live server, unverified elsewhere", () => {
    writeDraftMeta(path.join(entryDir, "draft.en.yml"), { proposal: { id: "p9", env: "production" } }, { skipMark: true });
    expect(getVariantInfo(ctx({ onLiveServer: true }), "en", "draft")!.facts.proposal.state).toBe("closed");
    expect(getVariantInfo(ctx({ onLiveServer: false }), "en", "draft")!.facts.proposal.state).toBe("unverified");
    expect(getVariantInfo(ctx({ openProposals: null }), "en", "draft")!.facts.proposal.state).toBe("unverified");
  });

  it("an orphaned link doesn't block", () => {
    writeDraftMeta(
      path.join(entryDir, "draft.en.yml"),
      { proposal: { id: "p9", env: "production", orphan_since: daysAgo(40) } },
      { skipMark: true },
    );
    const info = getVariantInfo(ctx(), "en", "draft")!;
    expect(info.facts.proposal.state).toBe("orphan");
    expect(info.health.verdict).toBe("probably_safe");
  });

  it("test runs: running, recently ended, and unknown history", () => {
    const run = (over: Partial<TestRun>): TestRun & { experiment_id: string } => ({
      experiment_id: "landing:promo:en@2026-10-01",
      content_type: "landing",
      slug: "promo",
      locale: "en",
      versions: ["draft"],
      started_at: "2026-10-01",
      ended_at: null,
      split_changes: [],
      ...over,
    });
    runs = [run({})];
    expect(getVariantInfo(ctx(), "en", "draft")!.facts.test.state).toBe("running");
    runs = [run({ ended_at: daysAgo(5) })];
    expect(getVariantInfo(ctx(), "en", "draft")!.facts.test.state).toBe("ended_recently");
    runs = [run({ ended_at: daysAgo(90) })];
    expect(getVariantInfo(ctx(), "en", "draft")!.facts.test.state).toBe("ended_long_ago");
    runs = [];
    hasHistory = false;
    expect(getVariantInfo(ctx(), "en", "draft")!.facts.test.state).toBe("unknown");
    hasHistory = true;
    const started = ctx({ versioning: { en: { variants: [{ slug: "draft", allocation: 0 }], started_at: "2026-01-01" } } });
    expect(getVariantInfo(started, "en", "draft")!.facts.test.state).toBe("unknown");
    expect(getVariantInfo(ctx(), "en", "draft")!.facts.test.state).toBe("never");
  });

  it("lists the same variant in other languages", () => {
    write("draft.es.yml", { title: "Borrador", _updated_at: daysAgo(2) });
    const info = getVariantInfo(ctx(), "en", "draft")!;
    expect(info.siblings).toEqual([{ locale: "es", updated_at: daysAgo(2), verdict: "check_first" }]);
  });

  it("flags the last draft of an unpublished page and skips the live comparison", () => {
    fs.rmSync(path.join(entryDir, "en.yml"));
    const info = getVariantInfo(ctx(), "en", "draft")!;
    expect(info.facts.has_live).toBe(false);
    expect(info.facts.changes_vs_live).toBeNull();
    expect(info.facts.is_last_draft_of_unpublished).toBe(true);
    expect(info.health.reasons.map((r) => r.code)).toEqual(["last_draft_of_unpublished_page"]);
  });

  it("getVariantInfoMap covers every listed variant", () => {
    const map = getVariantInfoMap(ctx());
    expect(Object.keys(map)).toEqual(["en"]);
    expect(map.en.draft.health.verdict).toBe("probably_safe");
  });

  it("returns null for a missing file", () => {
    expect(getVariantInfo(ctx(), "en", "nope")).toBeNull();
  });
});
