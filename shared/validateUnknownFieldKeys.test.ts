import { describe, expect, it } from "vitest";
import { collectUnknownFieldKeys } from "./validateUnknownFieldKeys";

describe("collectUnknownFieldKeys", () => {
  it("allows structural, alias, and mapping keys", () => {
    expect(
      collectUnknownFieldKeys(
        {
          meta: {},
          sections: [],
          slug: "a",
          title: "Hi",
          detached: true,
          section_defaults: { maxWidth: { desktop: "xl" } },
          maxWidth: { desktop: "xl" },
        },
        { title: "title" },
      ),
    ).toEqual([]);
  });

  it("allows first segment of dotted mapping keys", () => {
    expect(
      collectUnknownFieldKeys({ author: { name: "Ada" } }, { "author.name": "author.name" }),
    ).toEqual([]);
  });

  it("flags extra root keys", () => {
    const hits = collectUnknownFieldKeys({ leftover: 1, title: "x" }, { title: "title" });
    expect(hits).toEqual([{ key: "leftover", inOverrides: false }]);
  });

  it("flags extra field_overrides keys", () => {
    const hits = collectUnknownFieldKeys(
      { field_overrides: { title: "ok", mystery: 1 } },
      { title: "title" },
    );
    expect(hits).toEqual([{ key: "mystery", inOverrides: true }]);
  });
});
