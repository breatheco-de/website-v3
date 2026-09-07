import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clampListLimit,
  clampListPage,
  collectTypeStats,
  filterSlugRows,
  normalizeToSlugRows,
  paginateRows,
  pickTitle,
  projectEntries,
  resolveEntryList,
  type FetchItemsFn,
} from "./list-entries-resolve";

describe("pickTitle", () => {
  const titles = { en: "Hello", es: "Hola", pt: "Olá" };

  it("prefers requested locale, then default, then en, then any", () => {
    expect(pickTitle(titles, ["en", "es"], "es", "en")).toBe("Hola");
    expect(pickTitle(titles, ["en", "es"], undefined, "es")).toBe("Hola");
    expect(pickTitle({ es: "Hola", en: "Hello" }, ["es", "en"], undefined, "de")).toBe(
      "Hello",
    );
    expect(pickTitle({ pt: "Olá" }, ["pt"], undefined, "de")).toBe("Olá");
  });
});

describe("normalizeToSlugRows", () => {
  it("merges locale rows into one slug row", () => {
    const rows = normalizeToSlugRows(
      "interactive-exercise",
      [
        {
          slug: "python-beginner",
          locale: "en",
          title: "Python EN",
          _resolved_url: "/en/interactive-exercise/python-beginner",
          tags: ["python"],
          content: "HEAVY",
        },
        {
          slug: "python-beginner",
          locale: "es",
          title: "Python ES",
          _resolved_url: "/es/interactive-exercise/python-beginner",
        },
        {
          slug: "other",
          locale: "en",
          title: "Other",
        },
      ],
      { requestedLocale: "es", defaultLocale: "en" },
    );
    expect(rows).toHaveLength(2);
    const py = rows.find((r) => r.slug === "python-beginner")!;
    expect(py.locales.sort()).toEqual(["en", "es"]);
    expect(py.title).toBe("Python ES");
    expect(py.urls?.en).toContain("/en/");
    expect(py.urls?.es).toContain("/es/");
  });
});

describe("filterSlugRows", () => {
  const base = [
    {
      slug: "a",
      contentType: "blog",
      locales: ["en"],
      title: "Alpha",
    },
    {
      slug: "b",
      contentType: "blog",
      locales: ["es"],
      title: "Beta",
    },
    {
      slug: "c",
      contentType: "blog",
      locales: ["en", "es"],
      title: "Both",
    },
  ];

  it("strictly filters by locale", () => {
    const filtered = filterSlugRows(base, {
      locale: "en",
      contentFolder: "site_test",
    });
    expect(filtered.map((r) => r.slug).sort()).toEqual(["a", "c"]);
  });

  it("filters search against slug and title", () => {
    const filtered = filterSlugRows(base, {
      search: "bet",
      contentFolder: "site_test",
    });
    expect(filtered.map((r) => r.slug)).toEqual(["b"]);
  });
});

describe("filterSlugRows funnel overlay", () => {
  let tmp: string;

  afterEach(() => {
    if (tmp && fs.existsSync(tmp)) {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("matches funnel from overlay _common.yml", () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "list-entries-funnel-"));
    const entryDir = path.join(tmp, "how-to", "sample-howto");
    fs.mkdirSync(entryDir, { recursive: true });
    fs.writeFileSync(
      path.join(entryDir, "_common.yml"),
      "funnel:\n  stage: decision\n  products:\n    - ai-fluency\n",
      "utf-8",
    );

    const rows = [
      {
        slug: "sample-howto",
        contentType: "how-to",
        locales: ["en"],
        title: "Sample",
      },
      {
        slug: "other",
        contentType: "how-to",
        locales: ["en"],
        title: "Other",
      },
    ];

    const matched = filterSlugRows(rows, {
      contentFolder: tmp,
      funnelFilters: { is_money_page: true },
      enrichFunnel: true,
    });
    expect(matched).toHaveLength(1);
    expect(matched[0]?.slug).toBe("sample-howto");
    expect(matched[0]?.is_money_page).toBe(true);
  });
});

describe("projectEntries + paginate", () => {
  it("omits content even when detail true; includes allowlisted scalars", () => {
    const rows = normalizeToSlugRows(
      "interactive-exercise",
      [
        {
          slug: "x",
          locale: "en",
          title: "X",
          tags: ["a"],
          difficulty: "easy",
          content: "BODY",
          readme: "R",
        },
      ],
      { defaultLocale: "en" },
    );
    const lean = projectEntries(rows, { detail: false });
    expect(lean[0]?.tags).toBeUndefined();
    expect(lean[0]?.content).toBeUndefined();

    const rich = projectEntries(rows, { detail: true });
    expect(rich[0]?.tags).toEqual(["a"]);
    expect(rich[0]?.difficulty).toBe("easy");
    expect(rich[0]?.content).toBeUndefined();
    expect(rich[0]?.readme).toBeUndefined();
  });

  it("paginates with has_more", () => {
    const items = Array.from({ length: 5 }, (_, i) => ({ id: i }));
    const p1 = paginateRows(items, 1, 2);
    expect(p1.count).toBe(2);
    expect(p1.total).toBe(5);
    expect(p1.has_more).toBe(true);
    const p3 = paginateRows(items, 3, 2);
    expect(p3.count).toBe(1);
    expect(p3.has_more).toBe(false);
  });

  it("clamps page and limit", () => {
    expect(clampListPage(0)).toBe(1);
    expect(clampListLimit(999)).toBe(200);
    expect(clampListLimit(undefined)).toBe(50);
  });
});

describe("collectTypeStats / resolveEntryList", () => {
  it("stats mode collects counts and continues after one failure", async () => {
    const fetchItems: FetchItemsFn = vi.fn(async ({ contentType, countOnly }) => {
      if (contentType === "bad") {
        return { ok: false, error: "boom" };
      }
      return { ok: true, results: countOnly ? [] : [], total: contentType === "blog" ? 10 : 3 };
    });
    const got = await collectTypeStats({
      contentTypes: ["blog", "bad", "program"],
      domain: null,
      fetchItems,
    });
    expect(got.types).toEqual([
      { contentType: "blog", count: 10 },
      { contentType: "program", count: 3 },
    ]);
    expect(got.failed_types).toEqual([{ contentType: "bad", error: "boom" }]);
    expect(got.total_entries).toBe(13);
  });

  it("typed resolve fails hard when catalog unreachable", async () => {
    const fetchItems: FetchItemsFn = async () => ({ ok: false, error: "down" });
    const got = await resolveEntryList({
      contentType: "interactive-exercise",
      domain: null,
      contentPath: process.cwd(),
      contentFolder: "site_4geeks-com",
      fetchItems,
    });
    expect(got.ok).toBe(false);
    if (!got.ok) expect(got.error).toBe("down");
  });

  it("typed resolve returns projected entries", async () => {
    const fetchItems: FetchItemsFn = async () => ({
      ok: true,
      total: 2,
      results: [
        { slug: "one", locale: "en", title: "One", tags: ["t"] },
        { slug: "two", locale: "en", title: "Two" },
      ],
    });
    const got = await resolveEntryList({
      contentType: "blog",
      domain: null,
      contentPath: process.cwd(),
      contentFolder: "site_4geeks-com",
      locale: "en",
      page: 1,
      limit: 10,
      detail: true,
      fetchItems,
    });
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.total).toBe(2);
    expect(got.entries).toHaveLength(2);
    expect(got.entries[0]?.content).toBeUndefined();
    expect(got.entries.find((e) => e.slug === "one")?.tags).toEqual(["t"]);
  });
});
