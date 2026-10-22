import { describe, expect, it } from "vitest";
import {
  isRealValue,
  pickNewestValue,
  planEntry,
  type EntryInput,
  type SetInfo,
  type ValueHistory,
} from "./field-scope-migration";

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
