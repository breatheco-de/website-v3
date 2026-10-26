import { describe, expect, it } from "vitest";
import {
  DATABASE_ITEMS_SORT_DEFAULT,
  nextDatabaseItemsSort,
  parseDatabaseItemsSort,
  parseDatabaseItemsSortSearch,
  serializeDatabaseItemsSort,
  sortDatabaseItemEntries,
} from "./database-items-sort";

const entries = (items: Record<string, unknown>[]) => items.map((item, index) => ({ item, index }));
const order = (sorted: { index: number }[]) => sorted.map((e) => e.index);

describe("parseDatabaseItemsSort", () => {
  it("falls back to stored order for a missing or blank key", () => {
    expect(parseDatabaseItemsSort(undefined, "desc")).toEqual(DATABASE_ITEMS_SORT_DEFAULT);
    expect(parseDatabaseItemsSort("  ", "desc")).toEqual(DATABASE_ITEMS_SORT_DEFAULT);
  });

  it("defaults direction to asc", () => {
    expect(parseDatabaseItemsSort("starting_at", "bogus")).toEqual({ key: "starting_at", dir: "asc" });
    expect(parseDatabaseItemsSort("starting_at", "desc")).toEqual({ key: "starting_at", dir: "desc" });
  });
});

describe("URL round-trip", () => {
  it("omits defaults and keeps unrelated params", () => {
    expect(serializeDatabaseItemsSort({ key: "starting_at", dir: "asc" }, "?foo=1")).toBe("foo=1&sort=starting_at");
    expect(serializeDatabaseItemsSort({ key: "starting_at", dir: "desc" })).toBe("sort=starting_at&dir=desc");
    expect(serializeDatabaseItemsSort(DATABASE_ITEMS_SORT_DEFAULT, "?sort=x&dir=desc&foo=1")).toBe("foo=1");
  });

  it("parses what it serializes", () => {
    const sort = { key: "starting_at", dir: "desc" } as const;
    expect(parseDatabaseItemsSortSearch(`?${serializeDatabaseItemsSort(sort)}`)).toEqual(sort);
  });
});

describe("nextDatabaseItemsSort", () => {
  it("starts a new column ascending and flips the same column", () => {
    expect(nextDatabaseItemsSort(DATABASE_ITEMS_SORT_DEFAULT, "a")).toEqual({ key: "a", dir: "asc" });
    expect(nextDatabaseItemsSort({ key: "a", dir: "asc" }, "a")).toEqual({ key: "a", dir: "desc" });
    expect(nextDatabaseItemsSort({ key: "a", dir: "desc" }, "a")).toEqual({ key: "a", dir: "asc" });
    expect(nextDatabaseItemsSort({ key: "a", dir: "desc" }, "b")).toEqual({ key: "b", dir: "asc" });
  });
});

describe("sortDatabaseItemEntries", () => {
  it("returns stored order without a key", () => {
    const list = entries([{ a: 2 }, { a: 1 }]);
    expect(sortDatabaseItemEntries(list, DATABASE_ITEMS_SORT_DEFAULT)).toBe(list);
  });

  it("sorts ISO dates and numeric-aware strings", () => {
    const list = entries([
      { starting_at: "2026-11-02T10:00:00Z" },
      { starting_at: "2025-01-15T10:00:00Z" },
      { starting_at: "2026-03-01T10:00:00Z" },
    ]);
    expect(order(sortDatabaseItemEntries(list, { key: "starting_at", dir: "asc" }))).toEqual([1, 2, 0]);
    expect(order(sortDatabaseItemEntries(list, { key: "starting_at", dir: "desc" }))).toEqual([0, 2, 1]);
    const names = entries([{ n: "item10" }, { n: "item2" }]);
    expect(order(sortDatabaseItemEntries(names, { key: "n", dir: "asc" }))).toEqual([1, 0]);
  });

  it("compares numbers numerically", () => {
    const list = entries([{ n: 10 }, { n: 9 }, { n: 100 }]);
    expect(order(sortDatabaseItemEntries(list, { key: "n", dir: "asc" }))).toEqual([1, 0, 2]);
  });

  it("keeps empty values last in both directions and ties in stored order", () => {
    const list = entries([{ d: null }, { d: "b" }, {}, { d: "a" }, { d: "" }, { d: "b" }]);
    expect(order(sortDatabaseItemEntries(list, { key: "d", dir: "asc" }))).toEqual([3, 1, 5, 0, 2, 4]);
    expect(order(sortDatabaseItemEntries(list, { key: "d", dir: "desc" }))).toEqual([1, 5, 3, 0, 2, 4]);
  });
});
