import { describe, expect, it } from "vitest";
import {
  funnelCopyRank,
  isRealValue,
  pickNewestValue,
  planEntry,
  runFieldScopeMigration,
  type EntryInput,
  type FieldScopeMigrationDeps,
  type FunnelBindingValid,
  type SetInfo,
  type ValueHistory,
} from "./field-scope-migration";
import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";

/** `${rel}|${field}` → when it was set; missing key = no usable history. */
function fakeHistory(sets: Record<string, SetInfo>): ValueHistory {
  return { lastSet: (rel, field) => sets[`${rel}|${field}`] ?? null };
}

const at = (iso: string, bulk = false): SetInfo => ({ at: Date.parse(iso), sha: `sha-${iso}`, bulk });

function input(partial: Partial<EntryInput>): EntryInput {
  return {
    slug: "post",
    commonRel: "site_x/blog/post/_common.yml",
    common: null,
    locales: [],
    drafts: [],
    defaultLocale: "en",
    ...partial,
  };
}

const EN = "site_x/blog/post/en.yml";
const ES = "site_x/blog/post/es.yml";
const COMMON = "site_x/blog/post/_common.yml";

describe("isRealValue", () => {
  it("treats empty placeholders as not set", () => {
    for (const v of [undefined, null, "", "  ", [], {}]) expect(isRealValue(v)).toBe(false);
    for (const v of ["x", 0, false, ["a"], { a: 1 }]) expect(isRealValue(v)).toBe(true);
  });
});

describe("pickNewestValue", () => {
  it("newest real value wins and carries the bulk flag", () => {
    const res = pickNewestValue(
      [
        { source: "_common", value: "a", set: () => at("2026-08-01") },
        { source: "en", value: "b", set: () => at("2026-09-01", true) },
      ],
      "en",
    );
    expect(res).toMatchObject({ value: "b", source: "en", flags: ["bulk_change"] });
  });

  it("an empty placeholder never wins, whatever its date", () => {
    const res = pickNewestValue(
      [
        { source: "_common", value: "", set: () => at("2026-10-01") },
        { source: "en", value: "2026-01-15", set: () => at("2026-01-01") },
      ],
      "en",
    );
    expect(res).toMatchObject({ value: "2026-01-15", source: "en", flags: [] });
  });

  it("falls back to what visitors see when history is missing or tied", () => {
    const missing = pickNewestValue(
      [
        { source: "_common", value: "a", set: () => null },
        { source: "en", value: "b", set: () => at("2026-01-01") },
      ],
      "en",
    );
    expect(missing).toMatchObject({ value: "b", source: "en", flags: ["no_history"] });
    const tie = pickNewestValue(
      [
        { source: "_common", value: "a", set: () => at("2026-01-01") },
        { source: "en", value: "b", set: () => at("2026-01-01") },
      ],
      "en",
    );
    expect(tie.flags).toEqual(["no_history"]);
  });
});

describe("planEntry: page-level fields", () => {
  it("moves the newer language copy into _common.yml (blog/ai-engineer case)", () => {
    const plan = planEntry(
      input({
        common: { slug: "post", published_at: "", funnel: { stage: "awareness", products: ["ai-engineering"] } },
        locales: [
          {
            locale: "en",
            rel: EN,
            data: {
              title: "T",
              published_at: "2026-01-15",
              funnel: { stage: "awareness", products: [{ product: "ai-engineering", persona: "the-career-changer" }] },
            },
          },
        ],
      }),
      fakeHistory({
        [`${COMMON}|funnel`]: at("2026-08-31"),
        [`${EN}|funnel`]: at("2026-09-16"),
      }),
    );
    expect(plan.writes.get(COMMON)).toEqual({
      slug: "post",
      published_at: "2026-01-15",
      funnel: { stage: "awareness", products: [{ product: "ai-engineering", persona: "the-career-changer" }] },
    });
    expect(plan.writes.get(EN)).toEqual({ title: "T" });
    const funnel = plan.decisions.find((d) => d.field_path === "funnel")!;
    expect(funnel).toMatchObject({ direction: "to_common", winner: "en", flags: [] });
    expect(funnel.display_changes).toEqual([]);
  });

  it("keeps a newer _common.yml value and reports the language whose display changes", () => {
    const plan = planEntry(
      input({
        common: { slug: "post", authors: ["new"] },
        locales: [
          { locale: "en", rel: EN, data: { title: "T", authors: ["old"] } },
          { locale: "es", rel: ES, data: { title: "T" } },
        ],
      }),
      fakeHistory({ [`${COMMON}|authors`]: at("2026-10-01"), [`${EN}|authors`]: at("2026-02-01") }),
    );
    expect(plan.writes.get(COMMON)).toBeUndefined();
    expect(plan.writes.get(EN)).toEqual({ title: "T" });
    expect(plan.decisions[0]!.display_changes).toEqual([{ locale: "en", before: ["old"], after: ["new"] }]);
  });

  it("several language copies: the newest wins for every language", () => {
    const plan = planEntry(
      input({
        common: { slug: "post" },
        locales: [
          { locale: "en", rel: EN, data: { authors: ["a"] } },
          { locale: "es", rel: ES, data: { authors: ["b"] } },
        ],
      }),
      fakeHistory({ [`${EN}|authors`]: at("2026-01-01"), [`${ES}|authors`]: at("2026-03-01") }),
    );
    expect(plan.writes.get(COMMON)).toEqual({ slug: "post", authors: ["b"] });
    expect(plan.decisions[0]!.display_changes).toEqual([{ locale: "en", before: ["a"], after: ["b"] }]);
  });

  it("without history keeps the default language's copy and flags it", () => {
    const plan = planEntry(
      input({
        common: { slug: "post", authors: ["x"] },
        locales: [{ locale: "en", rel: EN, data: { authors: ["y"] } }],
      }),
      fakeHistory({}),
    );
    expect(plan.writes.get(COMMON)).toEqual({ slug: "post", authors: ["y"] });
    expect(plan.decisions[0]).toMatchObject({ winner: "en", flags: ["no_history"] });
  });
});

describe("planEntry: per-language fields in _common.yml", () => {
  it("meta.robots fans out to languages without their own copy, then leaves _common.yml", () => {
    const plan = planEntry(
      input({
        common: { slug: "post", meta: { robots: "noindex" } },
        locales: [
          { locale: "en", rel: EN, data: { title: "T", meta: { robots: "index" } } },
          { locale: "es", rel: ES, data: { title: "T" } },
        ],
      }),
      fakeHistory({ [`${COMMON}|meta.robots`]: at("2026-01-01"), [`${EN}|meta.robots`]: at("2026-05-01") }),
    );
    expect(plan.writes.get(COMMON)).toEqual({ slug: "post" });
    expect(plan.writes.get(EN)).toBeUndefined();
    expect(plan.writes.get(ES)).toEqual({ title: "T", meta: { robots: "noindex" } });
    expect(plan.decisions[0]).toMatchObject({ field_path: "meta.robots", direction: "to_locales", display_changes: [] });
  });

  it("a language's own title is never replaced by the _common.yml fallback, however new", () => {
    const plan = planEntry(
      input({
        common: { slug: "post", title: "AI Fluency for HR" },
        locales: [
          { locale: "en", rel: EN, data: {} },
          { locale: "es", rel: ES, data: { title: "AI Fluency para RRHH" } },
        ],
      }),
      fakeHistory({ [`${COMMON}|title`]: at("2026-09-01"), [`${ES}|title`]: at("2026-01-01") }),
    );
    expect(plan.writes.get(COMMON)).toEqual({ slug: "post" });
    expect(plan.writes.get(EN)).toEqual({ title: "AI Fluency for HR" });
    expect(plan.writes.get(ES)).toBeUndefined();
    expect(plan.decisions[0]!.display_changes).toEqual([]);
  });

  it("a newer _common.yml value replaces an older language copy", () => {
    const plan = planEntry(
      input({
        common: { slug: "post", meta: { priority: 0.9 } },
        locales: [{ locale: "en", rel: EN, data: { meta: { priority: 0.5 } } }],
      }),
      fakeHistory({ [`${COMMON}|meta.priority`]: at("2026-06-01"), [`${EN}|meta.priority`]: at("2026-01-01") }),
    );
    expect(plan.writes.get(EN)).toEqual({ meta: { priority: 0.9 } });
    expect(plan.decisions[0]!.display_changes).toEqual([{ locale: "en", before: 0.5, after: 0.9 }]);
  });
});

describe("planEntry: drafts", () => {
  const DRAFT = "site_x/blog/post/draft.en.yml";

  it("drops copied page-level values and keeps the author's edits", () => {
    const plan = planEntry(
      input({
        common: { slug: "post", funnel: { stage: "awareness" } },
        locales: [{ locale: "en", rel: EN, data: { title: "T", funnel: { stage: "awareness" } } }],
        drafts: [
          {
            locale: "en",
            variant: "draft",
            rel: DRAFT,
            data: { title: "New", funnel: { stage: "awareness" }, authors: ["ana"], published_at: null },
            base: { title: "T", funnel: { stage: "awareness" } },
          },
        ],
      }),
      fakeHistory({}),
    );
    expect(plan.writes.get(DRAFT)).toEqual({ title: "New", authors: ["ana"], published_at: null });
    expect(plan.drafts_changed).toEqual([{ rel: DRAFT, locale: "en", variant: "draft", removed: ["funnel"], added: [] }]);
  });

  it("without a base copy compares with today's live file", () => {
    const plan = planEntry(
      input({
        common: { slug: "post" },
        locales: [{ locale: "en", rel: EN, data: { title: "T" } }],
        drafts: [{ locale: "en", variant: "draft", rel: DRAFT, data: { title: "T", authors: ["ana"] }, base: null }],
      }),
      fakeHistory({}),
    );
    expect(plan.writes.has(DRAFT)).toBe(false);
  });

  it("a draft keeps the robots value its language used to get from _common.yml", () => {
    const plan = planEntry(
      input({
        common: { slug: "post", meta: { robots: "noindex" } },
        locales: [{ locale: "en", rel: EN, data: { title: "T" } }],
        drafts: [{ locale: "en", variant: "draft", rel: DRAFT, data: { title: "T2" }, base: { title: "T" } }],
      }),
      fakeHistory({}),
    );
    expect(plan.writes.get(DRAFT)).toEqual({ title: "T2", meta: { robots: "noindex" } });
    expect(plan.drafts_changed[0]!.added).toEqual(["meta.robots"]);
  });

  it("is idempotent: a clean entry plans no writes", () => {
    const plan = planEntry(
      input({
        common: { slug: "post", funnel: { stage: "awareness" } },
        locales: [{ locale: "en", rel: EN, data: { title: "T", meta: { robots: "index" } } }],
        drafts: [{ locale: "en", variant: "draft", rel: DRAFT, data: { title: "T2" }, base: { title: "T" } }],
      }),
      fakeHistory({}),
    );
    expect(plan.writes.size).toBe(0);
    expect(plan.decisions).toEqual([]);
  });
});

/** ai-engineering: the-career-changer, the-frustrated-graduate; ai-flex: the-explorer, the-recent-graduate. */
const catalog: FunnelBindingValid = (product, persona) => {
  const personas: Record<string, string[]> = {
    "ai-engineering": ["the-career-changer", "the-frustrated-graduate"],
    "ai-flex": ["the-explorer", "the-recent-graduate"],
  };
  const list = personas[product];
  if (!list) return false;
  return !persona || list.includes(persona);
};

const PERSONA_FUNNEL = {
  stage: "consideration",
  products: [
    { product: "ai-flex", persona: "the-explorer" },
    { product: "ai-engineering", persona: "the-career-changer" },
  ],
};
const BARE_FUNNEL = { stage: "awareness", products: ["ai-flex"] };

describe("funnelCopyRank", () => {
  it("orders invalid < invalid complete < valid < valid with personas or all", () => {
    expect(funnelCopyRank({ products: [{ product: "nope" }] }, catalog).rank).toBe(0);
    expect(funnelCopyRank({ products: [{ product: "ai-flex", persona: "ghost" }] }, catalog)).toEqual({
      rank: 1,
      invalid: ["ai-flex/ghost"],
    });
    expect(funnelCopyRank(BARE_FUNNEL, catalog).rank).toBe(2);
    expect(funnelCopyRank({ stage: "awareness" }, catalog).rank).toBe(2);
    expect(funnelCopyRank(PERSONA_FUNNEL, catalog).rank).toBe(3);
    expect(funnelCopyRank({ stage: "awareness", products: "all" }, catalog).rank).toBe(3);
  });
});

describe("planEntry: funnel ranking", () => {
  const funnelOnly = { onlyPaths: ["funnel"], funnelBindingValid: catalog } as const;

  it("an older persona copy beats a newer bare copy (how-to-become-a-full-stack-developer case)", () => {
    const plan = planEntry(
      input({
        common: { slug: "post", funnel: BARE_FUNNEL },
        locales: [{ locale: "en", rel: EN, data: { title: "T", funnel: PERSONA_FUNNEL } }],
      }),
      fakeHistory({ [`${COMMON}|funnel`]: at("2026-10-01"), [`${EN}|funnel`]: at("2026-09-16") }),
      funnelOnly,
    );
    expect(plan.writes.get(COMMON)).toEqual({ slug: "post", funnel: PERSONA_FUNNEL });
    expect(plan.writes.get(EN)).toEqual({ title: "T" });
    expect(plan.decisions[0]).toMatchObject({ winner: "en", flags: ["persona_preferred"] });
  });

  it("between two persona copies the newest wins, stage included", () => {
    const older = { stage: "awareness", products: [{ product: "ai-flex", persona: "the-recent-graduate" }] };
    const plan = planEntry(
      input({
        common: { slug: "post", funnel: older },
        locales: [{ locale: "en", rel: EN, data: { title: "T", funnel: PERSONA_FUNNEL } }],
      }),
      fakeHistory({ [`${COMMON}|funnel`]: at("2026-08-01"), [`${EN}|funnel`]: at("2026-09-16") }),
      funnelOnly,
    );
    expect(plan.writes.get(COMMON)).toEqual({ slug: "post", funnel: PERSONA_FUNNEL });
    expect(plan.decisions[0]).toMatchObject({ winner: "en", flags: [] });
  });

  it('"all products" competes with a persona copy by date', () => {
    const all = { stage: "awareness", products: "all" };
    const plan = planEntry(
      input({
        common: { slug: "post", funnel: all },
        locales: [{ locale: "es", rel: ES, data: { title: "T", funnel: PERSONA_FUNNEL } }],
        defaultLocale: "en",
      }),
      fakeHistory({ [`${COMMON}|funnel`]: at("2026-10-01"), [`${ES}|funnel`]: at("2026-09-16") }),
      funnelOnly,
    );
    expect(plan.writes.get(COMMON)).toBeUndefined();
    expect(plan.writes.get(ES)).toEqual({ title: "T" });
    expect(plan.decisions[0]).toMatchObject({ winner: "_common", flags: [] });
  });

  it("English and Spanish disagree: the newest valid persona copy wins for both", () => {
    const esFunnel = { stage: "consideration", products: [{ product: "ai-engineering", persona: "the-career-changer" }] };
    const plan = planEntry(
      input({
        common: { slug: "post", funnel: BARE_FUNNEL },
        locales: [
          { locale: "en", rel: EN, data: { title: "T", funnel: PERSONA_FUNNEL } },
          { locale: "es", rel: ES, data: { title: "T", funnel: esFunnel } },
        ],
      }),
      fakeHistory({
        [`${COMMON}|funnel`]: at("2026-10-20"),
        [`${EN}|funnel`]: at("2026-09-16"),
        [`${ES}|funnel`]: at("2026-10-01"),
      }),
      funnelOnly,
    );
    expect(plan.writes.get(COMMON)).toEqual({ slug: "post", funnel: esFunnel });
    expect(plan.writes.get(EN)).toEqual({ title: "T" });
    expect(plan.writes.get(ES)).toEqual({ title: "T" });
    expect(plan.decisions[0]!.display_changes.map((c) => c.locale)).toEqual(["en"]);
  });

  it("a newer copy with an unknown persona loses to an older valid one (sindrome-del-impostor case)", () => {
    const valid = { stage: "awareness", products: [{ product: "ai-flex", persona: "the-explorer" }] };
    const invalid = { stage: "awareness", products: [{ product: "ai-engineering", persona: "the-recent-graduate" }] };
    const plan = planEntry(
      input({
        common: { slug: "post", funnel: valid },
        locales: [{ locale: "es", rel: ES, data: { title: "T", funnel: invalid } }],
      }),
      fakeHistory({ [`${COMMON}|funnel`]: at("2026-08-01"), [`${ES}|funnel`]: at("2026-10-01") }),
      funnelOnly,
    );
    expect(plan.writes.get(COMMON)).toBeUndefined();
    expect(plan.writes.get(ES)).toEqual({ title: "T" });
    expect(plan.decisions[0]).toMatchObject({ winner: "_common", flags: ["invalid_dropped"] });
  });

  it("no valid copy: the most complete one still moves, flagged with its invalid pairs", () => {
    const invalid = { stage: "awareness", products: [{ product: "ai-engineering", persona: "the-recent-graduate" }] };
    const plan = planEntry(
      input({ common: { slug: "post" }, locales: [{ locale: "es", rel: ES, data: { title: "T", funnel: invalid } }] }),
      fakeHistory({}),
      funnelOnly,
    );
    expect(plan.writes.get(COMMON)).toEqual({ slug: "post", funnel: invalid });
    expect(plan.decisions[0]).toMatchObject({
      flags: ["no_valid_copy"],
      invalid_pairs: ["ai-engineering/the-recent-graduate"],
    });
  });

  it("onlyPaths leaves every other misplaced field alone", () => {
    const plan = planEntry(
      input({
        common: { slug: "post", meta: { robots: "noindex" } },
        locales: [{ locale: "en", rel: EN, data: { title: "T", authors: ["ana"], funnel: PERSONA_FUNNEL } }],
      }),
      fakeHistory({}),
      funnelOnly,
    );
    expect(plan.writes.get(COMMON)).toEqual({ slug: "post", meta: { robots: "noindex" }, funnel: PERSONA_FUNNEL });
    expect(plan.writes.get(EN)).toEqual({ title: "T", authors: ["ana"] });
    expect(plan.decisions.map((d) => d.field_path)).toEqual(["funnel"]);
  });

  it("without options a funnel copy is still picked by date only (006 unchanged)", () => {
    const plan = planEntry(
      input({
        common: { slug: "post", funnel: BARE_FUNNEL },
        locales: [{ locale: "en", rel: EN, data: { title: "T", funnel: PERSONA_FUNNEL } }],
      }),
      fakeHistory({ [`${COMMON}|funnel`]: at("2026-10-01"), [`${EN}|funnel`]: at("2026-09-16") }),
    );
    expect(plan.writes.get(COMMON)).toBeUndefined();
    expect(plan.decisions[0]).toMatchObject({ winner: "_common", flags: [] });
    expect(plan.drafts_with_funnel).toEqual([]);
  });
});

describe("planEntry: draft funnels with ranking", () => {
  const DRAFT = "site_x/blog/post/draft.en.yml";
  const funnelOnly = { onlyPaths: ["funnel"], funnelBindingValid: catalog } as const;
  const draftInput = (draftFunnel: unknown, baseFunnel: unknown) =>
    input({
      common: { slug: "post", funnel: BARE_FUNNEL },
      locales: [{ locale: "en", rel: EN, data: { title: "T", funnel: baseFunnel } }],
      drafts: [
        {
          locale: "en",
          variant: "draft",
          rel: DRAFT,
          data: { title: "New", funnel: draftFunnel },
          base: { title: "T", funnel: baseFunnel },
        },
      ],
    });

  it("a valid persona funnel copied from live stays staged and is reported", () => {
    const plan = planEntry(draftInput(PERSONA_FUNNEL, PERSONA_FUNNEL), fakeHistory({}), funnelOnly);
    expect(plan.writes.has(DRAFT)).toBe(false);
    expect(plan.drafts_with_funnel).toEqual([
      { rel: DRAFT, locale: "en", variant: "draft", needs_fix: false, invalid_pairs: [] },
    ]);
  });

  it("a copied funnel without personas or with invalid pairs is removed from the draft", () => {
    const bare = { stage: "awareness", products: ["ai-engineering"] };
    const invalid = { stage: "awareness", products: [{ product: "ai-flex", persona: "ghost" }] };
    for (const f of [bare, invalid]) {
      const plan = planEntry(draftInput(f, f), fakeHistory({}), funnelOnly);
      expect(plan.writes.get(DRAFT)).toEqual({ title: "New" });
      expect(plan.drafts_changed[0]!.removed).toEqual(["funnel"]);
      expect(plan.drafts_with_funnel).toEqual([]);
    }
  });

  it("an invalid funnel the author changed stays staged and is listed to fix", () => {
    const authored = { stage: "decision", products: [{ product: "ai-flex", persona: "ghost" }] };
    const plan = planEntry(draftInput(authored, PERSONA_FUNNEL), fakeHistory({}), funnelOnly);
    expect(plan.writes.has(DRAFT)).toBe(false);
    expect(plan.drafts_with_funnel).toEqual([
      { rel: DRAFT, locale: "en", variant: "draft", needs_fix: true, invalid_pairs: ["ai-flex/ghost"] },
    ]);
  });
});

describe("runFieldScopeMigration: funnel only", () => {
  it("dry run reports moves and drafts keeping a funnel without writing", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "funnel-010-"));
    try {
      fs.writeFileSync(path.join(root, "content-types.yml"), yaml.dump({ blog: { directory: "blog" } }));
      const dir = path.join(root, "blog", "post");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, "_common.yml"), yaml.dump({ slug: "post", funnel: BARE_FUNNEL }));
      const enBefore = yaml.dump({ title: "T", funnel: PERSONA_FUNNEL });
      fs.writeFileSync(path.join(dir, "en.yml"), enBefore);

      const lines: unknown[][] = [];
      const deps: FieldScopeMigrationDeps = {
        sites: () => [{ name: "site_x", contentRoot: root }],
        defaultLocale: () => "en",
        pendingFromMigration: () => [],
        markModified: () => {},
        push: async () => ({ success: true, commitHash: "abc" }),
        openHistory: () => ({ history: fakeHistory({}), cleanup: () => {} }),
        recordDraftRewrite: () => {},
        proposalSummary: () => null,
        funnelBindingValid: async () => catalog,
      };
      const { failed } = await runFieldScopeMigration({
        dryRun: true,
        deps,
        onlyPaths: ["funnel"],
        rankFunnel: true,
        author: "migration:010",
        log: (...args) => lines.push(args),
        error: (...args) => lines.push(["ERR", ...args]),
      });
      expect(failed).toBe(false);
      const move = lines.find((l) => l[0] === "would_move")!;
      expect(move.slice(1, 3)).toEqual(["blog/post", "funnel"]);
      expect(move[4]).toMatchObject({ winner: "en", flags: ["persona_preferred"] });
      expect(fs.readFileSync(path.join(dir, "en.yml"), "utf-8")).toBe(enBefore);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
