import { describe, expect, it } from "vitest";
import {
  DEFAULT_PROPOSAL_LIST_FILTERS,
  DEFAULT_PROPOSAL_LIST_VIEW,
  clearProposalListFilters,
  countActiveProposalFilters,
  isProposalIdLikeQuery,
  parseProposalListPerspective,
  parseProposalListSearch,
  proposalKpiCardsForKindFilter,
  proposalListApiSearchParams,
  serializeProposalListSearch,
  toProposalListApiQuery,
  withProposalListPerspective,
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
        proposerUsername: "",
        proposerActorType: "all",
        proposerActorRole: "",
        agentSessionId: "",
        reviewerUsername: "",
        escalatedOnly: false,
        outcomeFocus: "off" as const,
        attention: "all",
        stalledOnly: false,
        needsReviewOnly: false,
      },
      q: "hero",
    });
  });

  it("parses attention and needs_attention sort", () => {
    expect(parseProposalListSearch("attention=blocked").filters.attention).toBe("blocked");
    expect(parseProposalListSearch("sort=attention").filters.sort).toBe("attention");
  });

  it("parses proposer filters", () => {
    const view = parseProposalListSearch(
      "proposer_username=alice%40x.com&proposer_actor_type=mcp&proposer_actor_role=copy_editor&agent_session_id=sess-1",
    );
    expect(view.filters.proposerUsername).toBe("alice@x.com");
    expect(view.filters.proposerActorType).toBe("mcp");
    expect(view.filters.proposerActorRole).toBe("copy_editor");
    expect(view.filters.agentSessionId).toBe("sess-1");
  });

  it("parses reviewer_username and maps it to the API", () => {
    const view = parseProposalListSearch("reviewer_username=blake%40x.com");
    expect(view.filters.reviewerUsername).toBe("blake@x.com");
    expect(serializeProposalListSearch(view)).toBe("reviewer_username=blake%40x.com");
    expect(toProposalListApiQuery(view.filters, "").reviewer_username).toBe("blake@x.com");
    expect(
      new URLSearchParams(proposalListApiSearchParams(toProposalListApiQuery(view.filters, ""))).get(
        "reviewer_username",
      ),
    ).toBe("blake@x.com");
    expect(countActiveProposalFilters(view.filters)).toBe(1);
    expect(clearProposalListFilters(view.filters).reviewerUsername).toBe("");
  });

  it("parses escalated=1 as escalatedOnly", () => {
    expect(parseProposalListSearch("escalated=1").filters.escalatedOnly).toBe(true);
    expect(parseProposalListSearch("escalated=true").filters.escalatedOnly).toBe(true);
    expect(parseProposalListSearch("").filters.escalatedOnly).toBe(false);
  });

  it("parses outcome_review=bad_open as outcomeFocus bad and maps it to the API", () => {
    const view = parseProposalListSearch("status=all&outcome_review=bad_open");
    expect(view.filters.outcomeFocus).toBe("bad");
    expect(parseProposalListSearch("outcome_review=bad").filters.outcomeFocus).toBe("off");
    expect(serializeProposalListSearch(view)).toContain("outcome_review=bad_open");
    expect(toProposalListApiQuery(view.filters, "").outcome_review).toBe("bad_open");
    expect(countActiveProposalFilters(view.filters)).toBe(2);
  });

  it("parses outcome_review=none as outcomeFocus missing and maps it to the API", () => {
    const view = parseProposalListSearch("status=all&outcome_review=none");
    expect(view.filters.outcomeFocus).toBe("missing");
    expect(serializeProposalListSearch(view)).toContain("outcome_review=none");
    expect(toProposalListApiQuery(view.filters, "").outcome_review).toBe("none");
    expect(clearProposalListFilters(view.filters).outcomeFocus).toBe("off");
  });

  it("omits outcome_review when outcomeFocus is off", () => {
    expect(parseProposalListSearch("").filters.outcomeFocus).toBe("off");
    expect(toProposalListApiQuery(DEFAULT_PROPOSAL_LIST_FILTERS, "").outcome_review).toBeUndefined();
  });

  it("parses stalled=1 as stalledOnly", () => {
    expect(parseProposalListSearch("stalled=1").filters.stalledOnly).toBe(true);
    expect(parseProposalListSearch("stalled=true").filters.stalledOnly).toBe(true);
    expect(parseProposalListSearch("").filters.stalledOnly).toBe(false);
  });

  it("parses needs_review=1 as needsReviewOnly", () => {
    expect(parseProposalListSearch("needs_review=1").filters.needsReviewOnly).toBe(true);
    expect(parseProposalListSearch("").filters.needsReviewOnly).toBe(false);
  });

  it("coerces invalid values per field without wiping siblings", () => {
    const view = parseProposalListSearch(
      "status=banana&kind=notes&sort=title&sort_dir=sideways&proposer_actor_type=staff&q=ok",
    );
    expect(view.filters.status).toBe("open");
    expect(view.filters.kind).toBe("notes");
    expect(view.filters.sort).toBe("updated_at");
    expect(view.filters.sortDir).toBe("desc");
    expect(view.filters.proposerActorType).toBe("all");
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

  it("round-trips non-default view including proposer filters", () => {
    const view = {
      filters: {
        status: "all" as const,
        kind: "edits" as const,
        sort: "created_at" as const,
        sortDir: "asc" as const,
        proposerUsername: "bob@x.com",
        proposerActorType: "ui" as const,
        proposerActorRole: "copy_editor",
        agentSessionId: "sess-9",
        reviewerUsername: "dana@x.com",
        escalatedOnly: true,
        outcomeFocus: "off" as const,
        attention: "blocked" as const,
        stalledOnly: false,
        needsReviewOnly: false,
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

  it("counts status, kind, and proposer dims", () => {
    expect(
      countActiveProposalFilters({
        ...DEFAULT_PROPOSAL_LIST_FILTERS,
        status: "finished",
        kind: "notes",
        sort: "created_at",
        sortDir: "desc",
        proposerUsername: "a@x.com",
        proposerActorType: "mcp",
        proposerActorRole: "seo_specialist",
        agentSessionId: "s1",
        escalatedOnly: true,
        attention: "no_feedback",
      }),
    ).toBe(8);
  });
});

describe("clearProposalListFilters", () => {
  it("resets status, kind, and proposer dims but keeps sort", () => {
    expect(
      clearProposalListFilters({
        ...DEFAULT_PROPOSAL_LIST_FILTERS,
        status: "finished",
        kind: "notes",
        sort: "created_at",
        sortDir: "asc",
        proposerUsername: "a@x.com",
        proposerActorType: "ui",
        proposerActorRole: "copy_editor",
        agentSessionId: "sess",
        escalatedOnly: true,
        attention: "blocked",
      }),
    ).toEqual({
      status: "open",
      kind: "all",
      sort: "created_at",
      sortDir: "asc",
      proposerUsername: "",
      proposerActorType: "all",
      proposerActorRole: "",
      agentSessionId: "",
      reviewerUsername: "",
      escalatedOnly: false,
      outcomeFocus: "off" as const,
      attention: "all",
      stalledOnly: false,
      needsReviewOnly: false,
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

  it("maps proposer filters to API keys", () => {
    expect(
      toProposalListApiQuery(
        {
          ...DEFAULT_PROPOSAL_LIST_FILTERS,
          proposerUsername: "  alice@x.com ",
          proposerActorType: "mcp",
          proposerActorRole: "copy_editor",
          agentSessionId: "sess-1",
        },
        "",
      ),
    ).toEqual({
      status: "open",
      sort: "updated_at",
      sort_dir: "desc",
      proposer_username: "alice@x.com",
      proposer_actor_type: "mcp",
      proposer_actor_role: "copy_editor",
      agent_session_id: "sess-1",
    });
  });

  it("maps escalatedOnly to escalated=1", () => {
    expect(
      toProposalListApiQuery({ ...DEFAULT_PROPOSAL_LIST_FILTERS, escalatedOnly: true }, ""),
    ).toEqual({
      status: "open",
      sort: "updated_at",
      sort_dir: "desc",
      escalated: "1",
    });
  });

  it("maps attention sort with reviewer perspective", () => {
    expect(
      toProposalListApiQuery(
        {
          ...DEFAULT_PROPOSAL_LIST_FILTERS,
          sort: "attention",
          attention: "awaiting_rereview",
        },
        "",
      ),
    ).toEqual({
      status: "open",
      sort: "attention",
      sort_dir: "desc",
      attention: "awaiting_rereview",
      attention_perspective: "reviewer",
    });
  });

  it("builds search params string", () => {
    const qs = proposalListApiSearchParams(
      toProposalListApiQuery(
        {
          ...DEFAULT_PROPOSAL_LIST_FILTERS,
          status: "partial",
          kind: "edits",
          sort: "created_at",
          sortDir: "asc",
          proposerUsername: "u",
          proposerActorType: "ui",
          proposerActorRole: "",
          agentSessionId: "",
          escalatedOnly: true,
        },
        "x",
      ),
    );
    const params = new URLSearchParams(qs);
    expect(params.get("status")).toBe("partial");
    expect(params.get("kind")).toBe("edits");
    expect(params.get("sort")).toBe("created_at");
    expect(params.get("sort_dir")).toBe("asc");
    expect(params.get("q")).toBe("x");
    expect(params.get("proposer_username")).toBe("u");
    expect(params.get("proposer_actor_type")).toBe("ui");
    expect(params.get("proposer_actor_role")).toBeNull();
    expect(params.get("escalated")).toBe("1");
  });
});

describe("proposalKpiCardsForKindFilter", () => {
  it("returns three kind cards when kind is all", () => {
    const cards = proposalKpiCardsForKindFilter("all");
    expect(cards).toHaveLength(3);
    expect(cards.map((c) => c.kind)).toEqual(["idea", "edits", "notes"]);
  });

  it("returns one card when kind is focused", () => {
    const cards = proposalKpiCardsForKindFilter("idea");
    expect(cards).toHaveLength(1);
    expect(cards[0]).toEqual({ kind: "idea", label: "Ideas" });
  });
});

describe("proposal list perspective", () => {
  it("defaults to cards and ignores unknown values", () => {
    expect(parseProposalListPerspective("")).toBe("cards");
    expect(parseProposalListPerspective("perspective=grid")).toBe("cards");
    expect(parseProposalListPerspective("?perspective=table&status=all")).toBe("table");
  });

  it("omits the default and keeps other params", () => {
    expect(withProposalListPerspective("status=all&perspective=table", "cards")).toBe("status=all");
    const next = withProposalListPerspective("?status=all", "table");
    expect(parseProposalListPerspective(next)).toBe("table");
    expect(new URLSearchParams(next).get("status")).toBe("all");
  });

  it("survives filter serialization", () => {
    const search = withProposalListPerspective("", "table");
    const view = parseProposalListSearch(search);
    const next = serializeProposalListSearch(
      { ...view, filters: { ...view.filters, status: "all" } },
      search,
    );
    expect(parseProposalListPerspective(next)).toBe("table");
  });
});

describe("isProposalIdLikeQuery", () => {
  it("accepts UUID prefixes and hex hashes of length >= 6", () => {
    expect(isProposalIdLikeQuery("9508725f")).toBe(true);
    expect(isProposalIdLikeQuery("58c90fc3-9d0c-41cf")).toBe(true);
    expect(isProposalIdLikeQuery("3ee75b7e-ff46-4fdf-acf2-aabf7d9a5255")).toBe(true);
  });

  it("rejects short, spaced, or non-hex queries", () => {
    expect(isProposalIdLikeQuery("abc")).toBe(false);
    expect(isProposalIdLikeQuery("hero title")).toBe(false);
    expect(isProposalIdLikeQuery("redirect")).toBe(false);
    expect(isProposalIdLikeQuery("")).toBe(false);
  });
});
