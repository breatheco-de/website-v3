import { describe, expect, it } from "vitest";
import { diffRefreshedDatabaseRows } from "./database-refresh-diff";

const opts = { lookupKey: "slug", paramNames: ["category"] };

describe("diffRefreshedDatabaseRows", () => {
  it("returns null when nothing changed", () => {
    const rows = [{ slug: "ada", title: "Ada", category: "staff" }];
    expect(diffRefreshedDatabaseRows({ ...opts, previous: rows, next: [{ ...rows[0] }] })).toBeNull();
  });

  it("names the slug whose body changed and keeps its url params", () => {
    expect(
      diffRefreshedDatabaseRows({
        ...opts,
        previous: [{ slug: "ada", title: "Ada", category: "staff" }],
        next: [{ slug: "ada", title: "Ada Lovelace", category: "staff" }],
      }),
    ).toEqual([{ slug: "ada", params: { category: "staff" } }]);
  });

  it("includes a slug that appeared or disappeared", () => {
    const diff = diffRefreshedDatabaseRows({
      ...opts,
      previous: [{ slug: "ada", title: "Ada" }],
      next: [{ slug: "grace", title: "Grace", category: "staff" }],
    });
    expect(diff?.map((row) => row.slug).sort()).toEqual(["ada", "grace"]);
  });

  it("keeps two locales of the same slug apart", () => {
    const diff = diffRefreshedDatabaseRows({
      ...opts,
      previous: [],
      next: [
        { slug: "ada", locale: "en", title: "Ada" },
        { slug: "ada", locale: "es", title: "Ada" },
      ],
    });
    expect(diff).toEqual([
      { slug: "ada", locale: "en", params: {} },
      { slug: "ada", locale: "es", params: {} },
    ]);
  });

  it("returns an empty list when only a row without a slug changed", () => {
    expect(
      diffRefreshedDatabaseRows({
        ...opts,
        previous: [{ title: "Old" }],
        next: [{ title: "New" }],
      }),
    ).toEqual([]);
  });
});
