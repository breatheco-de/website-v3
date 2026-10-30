import { describe, expect, it, vi } from "vitest";

const rows = [
  { slug: "full-stack", lang: "en" },
  { slug: "desarrollo-full-stack", lang: "es" },
];
const group = { en: "full-stack", es: "desarrollo-full-stack" };

vi.mock("./entry-layer", () => ({
  loadItemsForType: () => ({ dbName: "programs", items: rows, fetchedAt: "", stale: false, ageMs: 0 }),
  applyEntryFilters: (items: unknown[]) => items,
  findEntryPresence: (_ci: unknown, contentType: string, slug: string) =>
    Object.values(group).includes(slug) ? { contentType, localeSlugs: group } : null,
}));
vi.mock("./content-types", () => ({ getLookupKey: () => "slug" }));

import { resolveEntryRef } from "./entry-ref";

const ci = {
  contentRoot: "/tmp/none",
  getDatabase: () => ({}) as never,
  normalizeType: (t: string) => t,
  getFolderName: (t: string) => t,
  findBySlug: () => [],
  resolveBaseSlug: (s: string) => s,
  findSlugAliases: () => [],
  isDatabaseBacked: () => true,
  isRefreshPending: () => false,
};

describe("resolveEntryRef on database-backed types", () => {
  it("resolves a Spanish row slug to its language group and serves Spanish", () => {
    const r = resolveEntryRef(ci as never, { contentType: "program", ref: "desarrollo-full-stack" });
    expect(r).toMatchObject({ ok: true, entryId: "desarrollo-full-stack", locale: "es", matchedBy: "database", exact: true });
  });

  it("serves the explicitly requested language's row of the same page", () => {
    const r = resolveEntryRef(ci as never, {
      contentType: "program",
      ref: "desarrollo-full-stack",
      locale: "en",
      localeExplicit: true,
    });
    expect(r).toMatchObject({ ok: true, entryId: "full-stack", locale: "en" });
    if (r.ok) expect(r.warnings.map((w) => w.code)).toContain("slug_locale_mismatch");
  });

  it("matches another spelling of a row slug", () => {
    const r = resolveEntryRef(ci as never, { contentType: "program", ref: "Desarrollo_Full_Stack" });
    expect(r).toMatchObject({ ok: true, entryId: "desarrollo-full-stack", exact: false });
  });
});
