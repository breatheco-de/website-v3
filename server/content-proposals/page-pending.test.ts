import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenProposalForEntry } from "./service";

const rowsByEntry = new Map<string, OpenProposalForEntry[]>();
const layout = { shared: true, detached: false, attached: ["a", "b", "c"] };

vi.mock("./service", () => ({
  listOpenProposalsForEntry: (_site: string, contentType: string, slug: string) =>
    rowsByEntry.get(`${contentType}/${slug}`) ?? [],
}));

vi.mock("../shared-layout-entry", () => ({
  TEMPLATE_VERSIONING_SLUG: "template",
  LEGACY_TEMPLATE_VERSIONING_SLUG: "single",
  isTemplateVersioningSlug: (s: string) => s === "template" || s === "single",
  isSharedLayoutType: () => layout.shared,
  isEntryDetached: () => layout.detached,
  listAttachedEntries: () => layout.attached,
}));

const { groupOpenProposals, listPendingProposalsForPage } = await import("./page-pending");

function row(overrides: Partial<OpenProposalForEntry>): OpenProposalForEntry {
  return {
    id: "p1",
    title: "Fix hero",
    status: "open",
    locale: "en",
    variant: "agent-fix",
    proposer_username: "agent-bot",
    proposer_kind: "agent",
    created_at: 1,
    updated_at: 10,
    open_blocker_count: 0,
    ...overrides,
  };
}

describe("groupOpenProposals", () => {
  it("collapses rows of one proposal into a single item with its drafts", () => {
    const out = groupOpenProposals([
      row({ locale: "en" }),
      row({ locale: "es" }),
      row({ locale: "es" }),
      row({ id: "p2", proposer_kind: "staff", open_blocker_count: 2 }),
    ]);
    expect(out).toHaveLength(2);
    expect(out[0]!.entries).toEqual([
      { locale: "en", variant: "agent-fix" },
      { locale: "es", variant: "agent-fix" },
    ]);
    expect(out[0]!.shared_layout).toBe(false);
    expect(out[0]!.affected_count).toBeNull();
    expect(out[1]!.open_blocker_count).toBe(2);
  });

  it("counts reached pages per distinct locale for template proposals", () => {
    const counted: string[][] = [];
    const out = groupOpenProposals([row({ locale: "en" }), row({ locale: "es" })], {
      sharedLayout: true,
      affectedCount: (locales) => {
        counted.push(locales);
        return locales.length * 4;
      },
    });
    expect(counted).toEqual([["en", "es"]]);
    expect(out[0]!.affected_count).toBe(8);
    expect(out[0]!.shared_layout).toBe(true);
  });
});

describe("listPendingProposalsForPage", () => {
  beforeEach(() => {
    rowsByEntry.clear();
    layout.shared = true;
    layout.detached = false;
    rowsByEntry.set("blog/hello", [row({ id: "own", updated_at: 5 })]);
    rowsByEntry.set("blog/template", [row({ id: "tpl", variant: "tpl-draft", updated_at: 20 })]);
  });

  it("adds template proposals on an attached page, newest first", () => {
    const out = listPendingProposalsForPage("site_x", "blog", "hello");
    expect(out.map((p) => p.id)).toEqual(["tpl", "own"]);
    expect(out[0]!.shared_layout).toBe(true);
    expect(out[0]!.affected_count).toBe(3);
    expect(out[1]!.shared_layout).toBe(false);
  });

  it("skips template proposals on a detached page", () => {
    layout.detached = true;
    expect(listPendingProposalsForPage("site_x", "blog", "hello").map((p) => p.id)).toEqual(["own"]);
  });

  it("skips template proposals when the type has no shared layout", () => {
    layout.shared = false;
    expect(listPendingProposalsForPage("site_x", "blog", "hello").map((p) => p.id)).toEqual(["own"]);
  });
});
