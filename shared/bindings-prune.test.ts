import { describe, expect, it } from "vitest";
import { previewPruneGroupsForSharedLayoutEnable } from "./bindings-prune";

const g = (
  id: string,
  members: Array<{ contentType: string; slug: string }>,
) => ({
  id,
  component: "faq",
  locale: "en",
  members: members.map((m) => ({ ...m, sectionId: "s1" })),
});

describe("previewPruneGroupsForSharedLayoutEnable", () => {
  it("keeps groups that only have detach exceptions for the type", () => {
    const groups = [
      g("a", [
        { contentType: "location", slug: "miami-usa" },
        { contentType: "location", slug: "madrid-spain" },
      ]),
    ];
    const preview = previewPruneGroupsForSharedLayoutEnable(groups, "location", [
      "miami-usa",
      "madrid-spain",
    ]);
    expect(preview.kept).toHaveLength(1);
    expect(preview.removed).toHaveLength(0);
    expect(preview.updated).toHaveLength(0);
  });

  it("updates groups by dropping attached members and keeps cross-type siblings", () => {
    const groups = [
      g("b", [
        { contentType: "location", slug: "miami-usa" },
        { contentType: "location", slug: "austin-usa" },
        { contentType: "landing", slug: "bootcamp" },
      ]),
    ];
    const preview = previewPruneGroupsForSharedLayoutEnable(groups, "location", ["miami-usa"]);
    expect(preview.updated).toHaveLength(1);
    expect(preview.updated[0].after.members.map((m) => m.slug).sort()).toEqual([
      "bootcamp",
      "miami-usa",
    ]);
    expect(preview.removed).toHaveLength(0);
  });

  it("removes groups left with fewer than two members", () => {
    const groups = [
      g("c", [
        { contentType: "location", slug: "miami-usa" },
        { contentType: "location", slug: "austin-usa" },
      ]),
    ];
    const preview = previewPruneGroupsForSharedLayoutEnable(groups, "location", ["miami-usa"]);
    expect(preview.removed).toHaveLength(1);
    expect(preview.updated).toHaveLength(0);
  });

  it("leaves unrelated groups alone", () => {
    const groups = [g("d", [{ contentType: "landing", slug: "a" }, { contentType: "landing", slug: "b" }])];
    const preview = previewPruneGroupsForSharedLayoutEnable(groups, "location", []);
    expect(preview.kept).toHaveLength(1);
  });
});
