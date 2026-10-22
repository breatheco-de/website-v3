import { describe, expect, it } from "vitest";
import { diffDraftAgainst } from "./draft-base";

describe("diffDraftAgainst", () => {
  it("does not report a removal when live and draft both keep seo.pillar_path: null", () => {
    const live = { meta: { redirects: ["/a"] }, seo: { pillar_path: null } };
    const draft = { meta: { redirects: ["/a", "/b"] }, seo: { pillar_path: null } };
    const changes = diffDraftAgainst(draft, { live, common: null });
    expect(changes.map((c) => c.field_path)).toEqual(["meta.redirects"]);
  });

  it("still reports a removal when the draft drops a nested null live has", () => {
    const changes = diffDraftAgainst({ title: "x" }, { live: { title: "x", seo: { pillar_path: null } }, common: null });
    expect(changes).toEqual([
      { field_path: "seo.pillar_path", before: null, after: undefined, scope: "locale", removed: true },
    ]);
  });

  it("reports a removal when the draft clears a value live has", () => {
    const changes = diffDraftAgainst(
      { seo: { pillar_path: null } },
      { live: { seo: { pillar_path: "/en/blog/hub" } }, common: null },
    );
    expect(changes).toEqual([
      { field_path: "seo.pillar_path", before: "/en/blog/hub", after: undefined, scope: "locale", removed: true },
    ]);
  });

  it("keeps meta.* nulls as removals, since publish deletes them", () => {
    const changes = diffDraftAgainst({ meta: { robots: null } }, { live: { meta: { robots: null } }, common: null });
    expect(changes.map((c) => c.field_path)).toEqual(["meta.robots"]);
  });
});
