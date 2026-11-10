import { describe, expect, it, vi, afterEach } from "vitest";

vi.mock("./content-types", () => ({
  getContentTypeConfig: vi.fn(() => ({
    editor: { authors: { type: "relation", source: "authors", multiple: true } },
  })),
  resolveContentTypeUrl: vi.fn((_ct: string, item: Record<string, unknown>) => `/en/author/${item.slug}`),
}));

vi.mock("./query-options", () => ({
  resolveSourceName: vi.fn((name: string) => ({ kind: "contentType", name })),
}));

vi.mock("./query-entries", () => ({
  queryEntries: vi.fn(async (q: { filters: Array<{ value: string }> }) => ({
    items: [{ slug: q.filters[0].value, name: "4Geeks Academy" }],
  })),
}));

vi.mock("./settings", () => ({
  getSupportedLocales: () => ["en", "es"],
  getDefaultLocale: () => "en",
}));

vi.mock("./database", () => ({ databaseManager: {} }));
vi.mock("./hreflang", () => ({ getBaseUrl: () => "https://example.com" }));

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("./logger", () => ({ child: () => ({ warn }) }));

import { queryEntries } from "./query-entries";
import { resolveRelationsOnEntry } from "./resolve-relations";

afterEach(() => {
  vi.clearAllMocks();
});

describe("resolveRelationsOnEntry", () => {
  it("hydrates slug pointers into author objects", async () => {
    const out = await resolveRelationsOnEntry("blog", { slug: "post", authors: ["4geeks-academy"] });
    expect(out.authors).toEqual([
      expect.objectContaining({
        slug: "4geeks-academy",
        url: "https://example.com/en/author/4geeks-academy",
      }),
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it("leaves an already-hydrated field alone on a second pass", async () => {
    const first = await resolveRelationsOnEntry("blog", { slug: "post", authors: ["4geeks-academy"] });
    vi.clearAllMocks();

    const second = await resolveRelationsOnEntry("blog", first);
    expect(second.authors).toEqual(first.authors);
    expect(second._relation_errors).toBeUndefined();
    expect(queryEntries).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("still reports invalid pointers", async () => {
    const out = await resolveRelationsOnEntry("blog", { slug: "post", authors: [""] });
    expect(out._relation_errors).toEqual([
      "authors: relation array items must be non-empty strings (index 0)",
    ]);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
