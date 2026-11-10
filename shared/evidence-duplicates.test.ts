import { describe, expect, it } from "vitest";
import { REJECTED_KEY } from "./evidence-kinds";
import {
  SIMILAR_TITLE_MIN,
  findEvidenceDuplicates,
  ignoreWordSet,
  isRedirectLink,
  newlySimilar,
  normalizeEvidenceUrl,
  rejectionGroup,
  similarAcknowledged,
  titleSimilarity,
} from "./evidence-duplicates";
import { waybackOriginalUrl } from "./evidence-archive";

const ARTICLE = "https://www.entnerd.com/startup-chilena-bahamas/";
const WAYBACK = `https://web.archive.org/web/20261008134545/${ARTICLE}`;

describe("normalizeEvidenceUrl", () => {
  it("unwraps Wayback copies to the page they copy", () => {
    expect(waybackOriginalUrl(WAYBACK)).toBe(ARTICLE);
    expect(normalizeEvidenceUrl(WAYBACK)).toBe(normalizeEvidenceUrl(ARTICLE));
  });

  it("ignores scheme, www, trailing slash, fragment and tracking params", () => {
    const a = normalizeEvidenceUrl("http://entnerd.com/startup-chilena-bahamas?utm_source=x&fbclid=1#top");
    expect(a).toBe("entnerd.com/startup-chilena-bahamas");
    expect(normalizeEvidenceUrl(ARTICLE)).toBe(a);
  });

  it("treats AMP and mobile versions as the normal page", () => {
    const base = normalizeEvidenceUrl("https://www.example.com/news/story");
    expect(normalizeEvidenceUrl("https://m.example.com/news/story")).toBe(base);
    expect(normalizeEvidenceUrl("https://amp.example.com/news/story")).toBe(base);
    expect(normalizeEvidenceUrl("https://example.com/news/story/amp/")).toBe(base);
    expect(normalizeEvidenceUrl("https://example.com/news/story?outputType=amp")).toBe(base);
  });

  it("keeps meaningful query params, sorted", () => {
    expect(normalizeEvidenceUrl("https://example.com/a?b=2&a=1")).toBe("example.com/a?a=1&b=2");
    expect(normalizeEvidenceUrl("https://example.com/a?id=1")).not.toBe(normalizeEvidenceUrl("https://example.com/a?id=2"));
  });

  it("archive.today short ids compare as themselves", () => {
    expect(normalizeEvidenceUrl("https://archive.ph/AbCd1")).toBe("archive.ph/AbCd1");
  });

  it("empty input is null", () => {
    expect(normalizeEvidenceUrl("")).toBeNull();
    expect(normalizeEvidenceUrl(undefined)).toBeNull();
  });
});

describe("isRedirectLink", () => {
  it("flags aggregators and shorteners, also inside a Wayback copy", () => {
    expect(isRedirectLink("https://news.google.com/rss/articles/CBMi123")).toBe(true);
    expect(isRedirectLink("https://t.co/abc")).toBe(true);
    expect(isRedirectLink("https://www.bit.ly/x")).toBe(true);
    expect(isRedirectLink("https://web.archive.org/web/2026/https://lnkd.in/abc")).toBe(true);
  });

  it("publisher links pass", () => {
    expect(isRedirectLink(ARTICLE)).toBe(false);
    expect(isRedirectLink("https://www.google.com/search?q=x")).toBe(false);
  });
});

describe("titleSimilarity", () => {
  const brand = ignoreWordSet(["4Geeks Academy", "4geeks"]);

  it("paraphrased titles of the same story score at or above the threshold", () => {
    const a = "4Geeks, Harvard, Oxford, and Columbia chosen to deliver AI education by the Government of the Bahamas.";
    const b = "Selected by the Bahamas Government for National AI Education, Alongside Harvard, Oxford and Columbia";
    expect(titleSimilarity(a, b, brand)).toBeGreaterThanOrEqual(SIMILAR_TITLE_MIN);
  });

  it("different stories score low", () => {
    const a = "Exclusive Tech Training Partner for IDB Workforce Programs Across 3 Countries";
    const b = "8 Years as the Tech Curriculum Partner for One of the Largest Colleges in the U.S.";
    expect(titleSimilarity(a, b, brand)).toBeLessThan(SIMILAR_TITLE_MIN);
  });

  it("brand words do not count as shared", () => {
    expect(titleSimilarity("4Geeks Academy wins", "4Geeks Academy hires", brand)).toBe(0);
  });
});

const row = (over: Record<string, unknown>) => ({ locale: "en", kind: "press", ...over });

describe("findEvidenceDuplicates", () => {
  const rows = [
    row({ title: "Bahamas picks 4Geeks for national AI education", link_url: WAYBACK, translation_key: "bahamas" }),
    row({ title: "Another story", link_url: "https://example.com/other" }),
  ];

  it("refuses the same link in the same locale", () => {
    const out = findEvidenceDuplicates({ rows, candidate: row({ title: "x", link_url: ARTICLE }), proofField: "link_url" });
    expect(out.blocked).toMatchObject({ code: "duplicate_link", index: 0 });
  });

  it("allows the same link in another locale with the same translation_key", () => {
    const out = findEvidenceDuplicates({
      rows,
      candidate: row({ locale: "es", title: "Bahamas elige a 4Geeks", link_url: ARTICLE, translation_key: "bahamas" }),
      proofField: "link_url",
    });
    expect(out.blocked).toBeNull();
    expect(out.similar).toEqual([]);
  });

  it("the same link in another locale without a matching translation_key is similar, not refused", () => {
    const out = findEvidenceDuplicates({
      rows,
      candidate: row({ locale: "es", title: "Bahamas elige a 4Geeks", link_url: ARTICLE }),
      proofField: "link_url",
    });
    expect(out.blocked).toBeNull();
    expect(out.similar).toEqual([expect.objectContaining({ index: 0, signals: ["same_link_other_locale"] })]);
  });

  it("a rejected row blocks its link in any locale", () => {
    const withRejected = [{ ...rows[0]!, [REJECTED_KEY]: { by: "staff", at: "2026-11-10", group: "g1" } }, rows[1]!];
    const out = findEvidenceDuplicates({
      rows: withRejected,
      candidate: row({ locale: "es", title: "x", link_url: ARTICLE, translation_key: "bahamas" }),
      proofField: "link_url",
    });
    expect(out.blocked).toMatchObject({ code: "rejected_link", index: 0 });
  });

  it("refuses redirect links before anything else", () => {
    const out = findEvidenceDuplicates({
      rows,
      candidate: row({ title: "x", link_url: "https://news.google.com/rss/articles/abc" }),
      proofField: "link_url",
    });
    expect(out.blocked?.code).toBe("redirect_link");
  });

  it("checkLink:false lets an existing duplicate keep saving", () => {
    const out = findEvidenceDuplicates({
      rows,
      candidate: row({ title: "Typo fixed", link_url: ARTICLE }),
      proofField: "link_url",
      checkLink: false,
    });
    expect(out.blocked).toBeNull();
    expect(out.similar).toEqual([]);
  });

  it("flags similar titles only within the same locale and kind", () => {
    const base = [row({ title: "Bahamas government selects coding school for national AI education" })];
    const cand = { title: "Coding school selected by Bahamas government for AI education" };
    expect(findEvidenceDuplicates({ rows: base, candidate: row(cand), proofField: "link_url" }).similar).toHaveLength(1);
    expect(
      findEvidenceDuplicates({ rows: base, candidate: row({ ...cand, kind: "partnership" }), proofField: "link_url" }).similar,
    ).toHaveLength(0);
    expect(
      findEvidenceDuplicates({ rows: base, candidate: row({ ...cand, locale: "es" }), proofField: "link_url" }).similar,
    ).toHaveLength(0);
  });

  it("rows without links compare on organization and year", () => {
    const base = [row({ kind: "partnership", title: "Partner of the year", organization: "United Way Miami", year: "2025" })];
    const out = findEvidenceDuplicates({
      rows: base,
      candidate: row({ kind: "partnership", title: "Scholarship program", organization: "united way  miami", year: "2025" }),
      proofField: "link_url",
    });
    expect(out.similar).toEqual([expect.objectContaining({ index: 0, signals: ["organization_year"] })]);
  });

  it("marks similar rows that are rejected", () => {
    const base = [row({ title: "Bahamas government selects coding school", [REJECTED_KEY]: { by: null, at: "", group: "g" } })];
    const out = findEvidenceDuplicates({
      rows: base,
      candidate: row({ title: "Coding school selected by Bahamas government" }),
      proofField: "link_url",
    });
    expect(out.similar[0]?.rejected).toBe(true);
  });

  it("excludeIndex skips the row being edited", () => {
    const out = findEvidenceDuplicates({ rows, candidate: rows[0]!, proofField: "link_url", excludeIndex: 0 });
    expect(out.blocked).toBeNull();
  });
});

describe("newlySimilar / similarAcknowledged", () => {
  const s = (index: number) => ({ index, title: null, link: null, signals: ["title" as const], rejected: false });

  it("reports only rows that became similar", () => {
    expect(newlySimilar([s(1)], [s(1), s(2)]).map((x) => x.index)).toEqual([2]);
  });

  it("requires every similar index", () => {
    expect(similarAcknowledged([], undefined)).toBe(true);
    expect(similarAcknowledged([s(1), s(2)], [1])).toBe(false);
    expect(similarAcknowledged([s(1), s(2)], [2, 1])).toBe(true);
  });
});

describe("rejectionGroup", () => {
  const rows = [
    row({ link_url: ARTICLE, translation_key: "k" }),
    row({ locale: "es", link_url: ARTICLE, translation_key: "k" }),
    row({ link_url: WAYBACK }),
    row({ link_url: "https://example.com/other" }),
  ];

  it("covers translations, and twins when asked", () => {
    expect(rejectionGroup({ rows, index: 0, proofField: "link_url", includeSameLink: true })).toEqual({
      translations: [1],
      sameLink: [2],
      all: [0, 1, 2],
    });
    expect(rejectionGroup({ rows, index: 0, proofField: "link_url", includeSameLink: false }).all).toEqual([0, 1]);
  });
});
