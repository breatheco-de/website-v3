import { describe, it, expect } from "vitest";
import { collectQueryFieldFilters } from "./list-pagination";

describe("collectQueryFieldFilters", () => {
  it("ignores __site alone (dev site override)", () => {
    expect(
      collectQueryFieldFilters({
        page: "1",
        pageSize: "50",
        __site: "4geeks.com",
      }),
    ).toEqual([]);
  });

  it("ignores _-prefixed infra keys", () => {
    expect(
      collectQueryFieldFilters({
        _anything: "x",
        __future: "y",
        page: "1",
      }),
    ).toEqual([]);
  });

  it("still collects real content filters", () => {
    expect(
      collectQueryFieldFilters({
        page: "1",
        pageSize: "50",
        __site: "4geeks.com",
        tags: "python",
        language: "es",
      }),
    ).toEqual([
      { field: "tags", value: "python" },
      { field: "language", value: "es" },
    ]);
  });

  it("ignores reserved list keys", () => {
    expect(
      collectQueryFieldFilters({
        locale: "en",
        sort: "updated_at",
        limit: "10",
        include_content: "1",
        page: "2",
        pageSize: "50",
        q: "search",
        sortDir: "desc",
        errorsOnly: "1",
        __site: "4geeks.com",
      }),
    ).toEqual([]);
  });

  it("supports repeated filter values", () => {
    expect(
      collectQueryFieldFilters({
        tags: ["python", "ai"],
        __site: "4geeks.com",
      }),
    ).toEqual([
      { field: "tags", value: "python" },
      { field: "tags", value: "ai" },
    ]);
  });
});
