import { describe, expect, it } from "vitest";
import yaml from "js-yaml";
import { diffDraftAgainst, draftSeedFromLive, draftSeedFromLiveRaw } from "./draft-base";

describe("draftSeedFromLive: legacy language funnel", () => {
  const personaFunnel = {
    stage: "consideration",
    products: [{ product: "ai-engineering", persona: "the-career-changer" }],
  };
  const live = yaml.dump({ title: "T", authors: ["a"], funnel: personaFunnel });

  it("keeps a language funnel that differs from _common.yml and reports it", () => {
    const res = draftSeedFromLive(live, {
      commonRaw: yaml.dump({ slug: "p", funnel: { stage: "awareness", products: ["ai-flex"] } }),
    });
    expect(res.carried).toEqual(["funnel"]);
    expect(yaml.load(res.content)).toEqual({ title: "T", funnel: personaFunnel });
  });

  it("carries what visitors see: a partial language copy merged over _common.yml", () => {
    const res = draftSeedFromLive(yaml.dump({ title: "T", funnel: { stage: "decision" } }), {
      commonRaw: yaml.dump({ funnel: { stage: "awareness", products: ["ai-flex"] } }),
    });
    expect(yaml.load(res.content)).toEqual({ title: "T", funnel: { stage: "decision", products: ["ai-flex"] } });
  });

  it("drops a language funnel equal to _common.yml (bare and object products compare equal)", () => {
    const res = draftSeedFromLive(yaml.dump({ title: "T", funnel: { stage: "awareness", products: [{ product: "ai-flex" }] } }), {
      commonRaw: yaml.dump({ funnel: { stage: "awareness", products: ["ai-flex"] } }),
    });
    expect(res.carried).toEqual([]);
    expect(yaml.load(res.content)).toEqual({ title: "T" });
  });

  it("keeps it when _common.yml has no funnel at all", () => {
    const res = draftSeedFromLive(live, { commonRaw: null });
    expect(res.carried).toEqual(["funnel"]);
  });

  it("without commonRaw behaves like draftSeedFromLiveRaw (drops page-level keys)", () => {
    expect(draftSeedFromLive(live).content).toBe(draftSeedFromLiveRaw(live));
    expect(yaml.load(draftSeedFromLiveRaw(live))).toEqual({ title: "T" });
  });
});

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
