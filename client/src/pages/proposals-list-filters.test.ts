import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROPOSAL_LIST_FILTERS,
  DEFAULT_PROPOSAL_LIST_VIEW,
  clearProposalListFilters,
  countActiveProposalFilters,
  parseProposalListSearch,
  proposalListApiSearchParams,
  serializeProposalListSearch,
  toProposalListApiQuery,
} from "./proposals-list-filters";

describe("parseProposalListSearch", () => {
  it("defaults missing status to open", () => {
    expect(parseProposalListSearch("")).toEqual(DEFAULT_PROPOSAL_LIST_VIEW);
    expect(parseProposalListSearch("?")).toEqual(DEFAULT_PROPOSAL_LIST_VIEW);
  });

  it("parses explicit status=all", () => {
    expect(parseProposalListSearch("status=all").filters.status).toBe("all");
  });

  it("parses kind, sort, sort_dir, and q", () => {
    const view = parseProposalListSearch(
      "status=finished&kind=notes&sort=created_at&sort_dir=asc&q=hero",
    );
    expect(view).toEqual({
      filters: {
        status: "finished",
        kind: "notes",
        sort: "created_at",
        sortDir: "asc",
      },
      q: "hero",
    });
  });

  it("coerces invalid values per field without wiping siblings", () => {
    const view = parseProposalListSearch("status=banana&kind=notes&sort=title&sort_dir=sideways&q=ok");
    expect(view.filters.status).toBe("open");
    expect(view.filters.kind).toBe("notes");
    expect(view.filters.sort).toBe("updated_at");
    expect(view.filters.sortDir).toBe("desc");
    expect(view.q).toBe("ok");
  });
});

describe("serializeProposalListSearch", () => {
  it("omits defaults for a clean open queue URL", () => {
    expect(serializeProposalListSearch(DEFAULT_PROPOSAL_LIST_VIEW)).toBe("");
  });

  it("writes status=all explicitly", () => {
    const qs = serializeProposalListSearch({
      filters: { ...DEFAULT_PROPOSAL_LIST_FILTERS, status: "all" },
      q: "",
    });
    expect(qs).toBe("status=all");
  });

  it("preserves unrelated query keys", () => {
    const qs = serializeProposalListSearch(DEFAULT_PROPOSAL_LIST_VIEW, "token=abc&status=finished");
    const params = new URLSearchParams(qs);
    expect(params.get("token")).toBe("abc");
    expect(params.get("status")).toBeNull();
  });

  it("round-trips non-default view", () => {
    const view = {
      filters: {
        status: "all" as const,
        kind: "edits" as const,
        sort: "created_at" as const,
        sortDir: "asc" as const,
      },
      q: "pricing",
    };
    expect(parseProposalListSearch(serializeProposalListSearch(view))).toEqual(view);
  });
});

describe("countActiveProposalFilters", () => {
  it("is zero for defaults", () => {
    expect(countActiveProposalFilters(DEFAULT_PROPOSAL_LIST_FILTERS)).toBe(0);
  });

  it("counts status=all as active", () => {
    expect(
      countActiveProposalFilters({ ...DEFAULT_PROPOSAL_LIST_FILTERS, status: "all" }),
    ).toBe(1);
  });

  it("does not count sort as an active filter", () => {
    expect(
      countActiveProposalFilters({
        ...DEFAULT_PROPOSAL_LIST_FILTERS,
        sort: "created_at",
        sortDir: "asc",
      }),
    ).toBe(0);
  });

  it("counts status and kind only", () => {
    expect(
      countActiveProposalFilters({
        status: "finished",
        kind: "notes",
        sort: "created_at",
        sortDir: "desc",
      }),
    ).toBe(2);
  });
});

describe("clearProposalListFilters", () => {
  it("resets status and kind but keeps sort", () => {
    expect(
      clearProposalListFilters({
        status: "finished",
        kind: "notes",
        sort: "created_at",
        sortDir: "asc",
      }),
    ).toEqual({
      status: "open",
      kind: "all",
      sort: "created_at",
      sortDir: "asc",
    });
  });
});

describe("toProposalListApiQuery", () => {
  it("omits status and kind when all", () => {
    expect(
      toProposalListApiQuery({ ...DEFAULT_PROPOSAL_LIST_FILTERS, status: "all" }, ""),
    ).toEqual({
      sort: "updated_at",
      sort_dir: "desc",
    });
  });

  it("includes open status and trimmed q", () => {
    expect(toProposalListApiQuery(DEFAULT_PROPOSAL_LIST_FILTERS, "  hero  ")).toEqual({
      status: "open",
      sort: "updated_at",
      sort_dir: "desc",
      q: "hero",
    });
  });

  it("builds search params string", () => {
    const qs = proposalListApiSearchParams(
      toProposalListApiQuery(
        { status: "partial", kind: "edits", sort: "created_at", sortDir: "asc" },
        "x",
      ),
    );
    expect(new URLSearchParams(qs).get("status")).toBe("partial");
    expect(new URLSearchParams(qs).get("kind")).toBe("edits");
    expect(new URLSearchParams(qs).get("sort")).toBe("created_at");
    expect(new URLSearchParams(qs).get("sort_dir")).toBe("asc");
    expect(new URLSearchParams(qs).get("q")).toBe("x");
  });
});
