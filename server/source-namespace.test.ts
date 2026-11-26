import { describe, expect, it } from "vitest";
import {
  assertSourceNameAvailable,
  findSourceNameCollisions,
  resolveSourceName,
  type SourceNamespaceDb,
} from "./source-namespace";

function fakeDb(names: string[]): SourceNamespaceDb {
  const set = new Set(names);
  return {
    exists: (name) => set.has(name),
    list: () => names.map((name) => ({ name })),
  };
}

describe("assertSourceNameAvailable", () => {
  it("allows creating a database when no content type shares the name", () => {
    expect(() =>
      assertSourceNameAvailable("brand_new_db_slug_xyz", "database", undefined, fakeDb([])),
    ).not.toThrow();
  });

  it("rejects creating a content type when a database slug already exists", () => {
    expect(() =>
      assertSourceNameAvailable("press_mentions", "contentType", undefined, fakeDb(["press_mentions"])),
    ).toThrow(/database with the same slug already exists/);
  });
});

describe("resolveSourceName", () => {
  it("returns not_found for empty names", () => {
    expect(resolveSourceName("", undefined, fakeDb([]))).toEqual({
      kind: "not_found",
      name: "",
    });
  });

  it("returns database when only the DB side exists", () => {
    expect(resolveSourceName("only_db", undefined, fakeDb(["only_db"]))).toEqual({
      kind: "database",
      name: "only_db",
    });
  });
});

describe("findSourceNameCollisions", () => {
  it("returns an array (may be empty when fixtures have no overlap)", () => {
    expect(Array.isArray(findSourceNameCollisions(undefined, fakeDb([])))).toBe(true);
  });
});
