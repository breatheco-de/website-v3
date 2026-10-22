/** Query keys for proposal list view state. */
export const PROPOSAL_LIST_SEARCH_KEYS = {
  status: "status",
  kind: "kind",
  sort: "sort",
  sortDir: "sort_dir",
  q: "q",
  proposerUsername: "proposer_username",
  proposerActorType: "proposer_actor_type",
  proposerActorRole: "proposer_actor_role",
  agentSessionId: "agent_session_id",
  reviewerUsername: "reviewer_username",
  escalatedOnly: "escalated",
  outcomeFocus: "outcome_review",
  attention: "attention",
  stalledOnly: "stalled",
  needsReviewOnly: "needs_review",
} as const;

export type ProposalListStatus =
  | "all"
  | "open"
  | "partial"
  | "finished"
  | "rejected"
  | "withdrawn";

export type ProposalListKind = "all" | "edits" | "notes" | "idea";

export type ProposalListSortField = "created_at" | "updated_at" | "attention";
export type ProposalListSortDir = "asc" | "desc";

/** `all` = no actor-type filter (omitted from API). */
export type ProposalListActorType = "all" | "ui" | "mcp" | "system";

export type ProposalListAttention =
  | "all"
  | "predecessor_applied"
  | "escalated"
  | "awaiting_rereview"
  | "no_feedback"
  | "blocked"
  | "needs_author";

/** `missing` = closed and not yet reviewed; `bad` = bad outcome with no lesson captured. */
export type ProposalListOutcomeFocus = "off" | "missing" | "bad";

const OUTCOME_FOCUS_TO_API: Record<Exclude<ProposalListOutcomeFocus, "off">, string> = {
  missing: "none",
  bad: "bad_open",
};

export type ProposalListFilters = {
  status: ProposalListStatus;
  kind: ProposalListKind;
  sort: ProposalListSortField;
  sortDir: ProposalListSortDir;
  /** Exact case-insensitive proposer username; empty = no filter. */
  proposerUsername: string;
  proposerActorType: ProposalListActorType;
  /** Exact swarm role id; empty = no filter. */
  proposerActorRole: string;
  /** Exact created_agent_session_id; empty = no filter. */
  agentSessionId: string;
  /** Latest non-author feedback or finished/rejected closer (exact, case-insensitive); empty = no filter. */
  reviewerUsername: string;
  /** When true, only proposals with the escalated flag. */
  escalatedOnly: boolean;
  /** Outcome review triage; closed proposals only when not `off`. */
  outcomeFocus: ProposalListOutcomeFocus;
  /** Attention triage bucket; `all` = no filter. */
  attention: ProposalListAttention;
  /** Accepted ideas with no successful implements follow-up. */
  stalledOnly: boolean;
  /** Open edits that still need a reviewer (re-check or no feedback). */
  needsReviewOnly: boolean;
};

export type ProposalListViewState = {
  filters: ProposalListFilters;
  q: string;
};

export const DEFAULT_PROPOSAL_LIST_FILTERS: ProposalListFilters = {
  status: "open",
  kind: "all",
  sort: "updated_at",
  sortDir: "desc",
  proposerUsername: "",
  proposerActorType: "all",
  proposerActorRole: "",
  agentSessionId: "",
  reviewerUsername: "",
  escalatedOnly: false,
  outcomeFocus: "off",
  attention: "all",
  stalledOnly: false,
  needsReviewOnly: false,
};

export const DEFAULT_PROPOSAL_LIST_VIEW: ProposalListViewState = {
  filters: { ...DEFAULT_PROPOSAL_LIST_FILTERS },
  q: "",
};

const STATUS_VALUES = new Set<ProposalListStatus>([
  "all",
  "open",
  "partial",
  "finished",
  "rejected",
  "withdrawn",
]);

const KIND_VALUES = new Set<ProposalListKind>(["all", "edits", "notes", "idea"]);

const ACTOR_TYPE_VALUES = new Set<ProposalListActorType>(["all", "ui", "mcp", "system"]);

const ATTENTION_VALUES = new Set<ProposalListAttention>([
  "all",
  "predecessor_applied",
  "escalated",
  "awaiting_rereview",
  "no_feedback",
  "blocked",
  "needs_author",
]);

function parseStatus(raw: string | null): ProposalListStatus {
  if (raw == null || raw === "") return DEFAULT_PROPOSAL_LIST_FILTERS.status;
  return STATUS_VALUES.has(raw as ProposalListStatus)
    ? (raw as ProposalListStatus)
    : DEFAULT_PROPOSAL_LIST_FILTERS.status;
}

function parseKind(raw: string | null): ProposalListKind {
  if (raw == null || raw === "") return DEFAULT_PROPOSAL_LIST_FILTERS.kind;
  return KIND_VALUES.has(raw as ProposalListKind)
    ? (raw as ProposalListKind)
    : DEFAULT_PROPOSAL_LIST_FILTERS.kind;
}

function parseSort(raw: string | null): ProposalListSortField {
  if (raw === "created_at" || raw === "updated_at" || raw === "attention") return raw;
  return DEFAULT_PROPOSAL_LIST_FILTERS.sort;
}

function parseSortDir(raw: string | null): ProposalListSortDir {
  if (raw === "asc" || raw === "desc") return raw;
  return DEFAULT_PROPOSAL_LIST_FILTERS.sortDir;
}

function parseActorType(raw: string | null): ProposalListActorType {
  if (raw == null || raw === "") return DEFAULT_PROPOSAL_LIST_FILTERS.proposerActorType;
  return ACTOR_TYPE_VALUES.has(raw as ProposalListActorType)
    ? (raw as ProposalListActorType)
    : DEFAULT_PROPOSAL_LIST_FILTERS.proposerActorType;
}

function parseEscalatedOnly(raw: string | null): boolean {
  if (raw == null || raw === "") return DEFAULT_PROPOSAL_LIST_FILTERS.escalatedOnly;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true";
}

function parseOutcomeFocus(raw: string | null): ProposalListOutcomeFocus {
  const v = raw?.trim().toLowerCase();
  if (v === "bad_open") return "bad";
  if (v === "none") return "missing";
  return DEFAULT_PROPOSAL_LIST_FILTERS.outcomeFocus;
}

function parseStalledOnly(raw: string | null): boolean {
  if (raw == null || raw === "") return DEFAULT_PROPOSAL_LIST_FILTERS.stalledOnly;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true";
}

function parseNeedsReviewOnly(raw: string | null): boolean {
  if (raw == null || raw === "") return DEFAULT_PROPOSAL_LIST_FILTERS.needsReviewOnly;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true";
}

function parseAttention(raw: string | null): ProposalListAttention {
  if (raw == null || raw === "") return DEFAULT_PROPOSAL_LIST_FILTERS.attention;
  return ATTENTION_VALUES.has(raw as ProposalListAttention)
    ? (raw as ProposalListAttention)
    : DEFAULT_PROPOSAL_LIST_FILTERS.attention;
}

/** List layout (not a filter): cards (default) or a selectable table for bulk actions. */
export type ProposalListPerspective = "cards" | "table";

export const PROPOSAL_LIST_PERSPECTIVE_KEY = "perspective";

export function parseProposalListPerspective(search: string): ProposalListPerspective {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return params.get(PROPOSAL_LIST_PERSPECTIVE_KEY) === "table" ? "table" : "cards";
}

/** Sets or clears `perspective` on `existingSearch`; other params are kept. */
export function withProposalListPerspective(
  existingSearch: string,
  perspective: ProposalListPerspective,
): string {
  const params = new URLSearchParams(
    existingSearch.startsWith("?") ? existingSearch.slice(1) : existingSearch,
  );
  if (perspective === "cards") params.delete(PROPOSAL_LIST_PERSPECTIVE_KEY);
  else params.set(PROPOSAL_LIST_PERSPECTIVE_KEY, perspective);
  return params.toString();
}

export function parseProposalListSearch(search: string): ProposalListViewState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return {
    filters: {
      status: parseStatus(params.get(PROPOSAL_LIST_SEARCH_KEYS.status)),
      kind: parseKind(params.get(PROPOSAL_LIST_SEARCH_KEYS.kind)),
      sort: parseSort(params.get(PROPOSAL_LIST_SEARCH_KEYS.sort)),
      sortDir: parseSortDir(params.get(PROPOSAL_LIST_SEARCH_KEYS.sortDir)),
      proposerUsername: params.get(PROPOSAL_LIST_SEARCH_KEYS.proposerUsername) ?? "",
      proposerActorType: parseActorType(params.get(PROPOSAL_LIST_SEARCH_KEYS.proposerActorType)),
      proposerActorRole: params.get(PROPOSAL_LIST_SEARCH_KEYS.proposerActorRole) ?? "",
      agentSessionId: params.get(PROPOSAL_LIST_SEARCH_KEYS.agentSessionId) ?? "",
      reviewerUsername: params.get(PROPOSAL_LIST_SEARCH_KEYS.reviewerUsername) ?? "",
      escalatedOnly: parseEscalatedOnly(params.get(PROPOSAL_LIST_SEARCH_KEYS.escalatedOnly)),
      outcomeFocus: parseOutcomeFocus(params.get(PROPOSAL_LIST_SEARCH_KEYS.outcomeFocus)),
      attention: parseAttention(params.get(PROPOSAL_LIST_SEARCH_KEYS.attention)),
      stalledOnly: parseStalledOnly(params.get(PROPOSAL_LIST_SEARCH_KEYS.stalledOnly)),
      needsReviewOnly: parseNeedsReviewOnly(params.get(PROPOSAL_LIST_SEARCH_KEYS.needsReviewOnly)),
    },
    q: params.get(PROPOSAL_LIST_SEARCH_KEYS.q) ?? "",
  };
}

/** Writes known keys onto `existingSearch`, omitting defaults. Unknown params are kept. */
export function serializeProposalListSearch(
  view: ProposalListViewState,
  existingSearch = "",
): string {
  const params = new URLSearchParams(
    existingSearch.startsWith("?") ? existingSearch.slice(1) : existingSearch,
  );
  const d = DEFAULT_PROPOSAL_LIST_FILTERS;
  const { filters, q } = view;

  // Missing status means open; All must be explicit.
  if (filters.status === d.status) {
    params.delete(PROPOSAL_LIST_SEARCH_KEYS.status);
  } else {
    params.set(PROPOSAL_LIST_SEARCH_KEYS.status, filters.status);
  }

  if (filters.kind === d.kind) {
    params.delete(PROPOSAL_LIST_SEARCH_KEYS.kind);
  } else {
    params.set(PROPOSAL_LIST_SEARCH_KEYS.kind, filters.kind);
  }

  if (filters.sort === d.sort) {
    params.delete(PROPOSAL_LIST_SEARCH_KEYS.sort);
  } else {
    params.set(PROPOSAL_LIST_SEARCH_KEYS.sort, filters.sort);
  }

  if (filters.sortDir === d.sortDir) {
    params.delete(PROPOSAL_LIST_SEARCH_KEYS.sortDir);
  } else {
    params.set(PROPOSAL_LIST_SEARCH_KEYS.sortDir, filters.sortDir);
  }

  const trimmedUser = filters.proposerUsername.trim();
  if (!trimmedUser) {
    params.delete(PROPOSAL_LIST_SEARCH_KEYS.proposerUsername);
  } else {
    params.set(PROPOSAL_LIST_SEARCH_KEYS.proposerUsername, trimmedUser);
  }

  if (filters.proposerActorType === d.proposerActorType) {
    params.delete(PROPOSAL_LIST_SEARCH_KEYS.proposerActorType);
  } else {
    params.set(PROPOSAL_LIST_SEARCH_KEYS.proposerActorType, filters.proposerActorType);
  }

  const trimmedRole = filters.proposerActorRole.trim();
  if (!trimmedRole) {
    params.delete(PROPOSAL_LIST_SEARCH_KEYS.proposerActorRole);
  } else {
    params.set(PROPOSAL_LIST_SEARCH_KEYS.proposerActorRole, trimmedRole);
  }

  const trimmedSession = filters.agentSessionId.trim();
  if (!trimmedSession) {
    params.delete(PROPOSAL_LIST_SEARCH_KEYS.agentSessionId);
  } else {
    params.set(PROPOSAL_LIST_SEARCH_KEYS.agentSessionId, trimmedSession);
  }

  const trimmedReviewer = filters.reviewerUsername.trim();
  if (!trimmedReviewer) {
    params.delete(PROPOSAL_LIST_SEARCH_KEYS.reviewerUsername);
  } else {
    params.set(PROPOSAL_LIST_SEARCH_KEYS.reviewerUsername, trimmedReviewer);
  }

  if (!filters.escalatedOnly) {
    params.delete(PROPOSAL_LIST_SEARCH_KEYS.escalatedOnly);
  } else {
    params.set(PROPOSAL_LIST_SEARCH_KEYS.escalatedOnly, "1");
  }

  if (filters.outcomeFocus === "off") {
    params.delete(PROPOSAL_LIST_SEARCH_KEYS.outcomeFocus);
  } else {
    params.set(PROPOSAL_LIST_SEARCH_KEYS.outcomeFocus, OUTCOME_FOCUS_TO_API[filters.outcomeFocus]);
  }

  if (filters.attention === d.attention) {
    params.delete(PROPOSAL_LIST_SEARCH_KEYS.attention);
  } else {
    params.set(PROPOSAL_LIST_SEARCH_KEYS.attention, filters.attention);
  }

  if (!filters.stalledOnly) {
    params.delete(PROPOSAL_LIST_SEARCH_KEYS.stalledOnly);
  } else {
    params.set(PROPOSAL_LIST_SEARCH_KEYS.stalledOnly, "1");
  }

  if (!filters.needsReviewOnly) {
    params.delete(PROPOSAL_LIST_SEARCH_KEYS.needsReviewOnly);
  } else {
    params.set(PROPOSAL_LIST_SEARCH_KEYS.needsReviewOnly, "1");
  }

  const trimmedQ = q.trim();
  if (!trimmedQ) {
    params.delete(PROPOSAL_LIST_SEARCH_KEYS.q);
  } else {
    params.set(PROPOSAL_LIST_SEARCH_KEYS.q, trimmedQ);
  }

  return params.toString();
}

/** Badge count: how many filter dims differ from defaults (not including search or sort). */
export function countActiveProposalFilters(filters: ProposalListFilters): number {
  const d = DEFAULT_PROPOSAL_LIST_FILTERS;
  let n = 0;
  if (filters.status !== d.status) n += 1;
  if (filters.kind !== d.kind) n += 1;
  if (filters.proposerUsername.trim()) n += 1;
  if (filters.proposerActorType !== d.proposerActorType) n += 1;
  if (filters.proposerActorRole.trim()) n += 1;
  if (filters.agentSessionId.trim()) n += 1;
  if (filters.reviewerUsername.trim()) n += 1;
  if (filters.escalatedOnly) n += 1;
  if (filters.outcomeFocus !== "off") n += 1;
  if (filters.attention !== d.attention) n += 1;
  if (filters.stalledOnly) n += 1;
  if (filters.needsReviewOnly) n += 1;
  return n;
}

/** Reset status/kind/proposer dims to defaults; leave sort as-is. */
export function clearProposalListFilters(filters: ProposalListFilters): ProposalListFilters {
  return {
    ...filters,
    status: DEFAULT_PROPOSAL_LIST_FILTERS.status,
    kind: DEFAULT_PROPOSAL_LIST_FILTERS.kind,
    proposerUsername: DEFAULT_PROPOSAL_LIST_FILTERS.proposerUsername,
    proposerActorType: DEFAULT_PROPOSAL_LIST_FILTERS.proposerActorType,
    proposerActorRole: DEFAULT_PROPOSAL_LIST_FILTERS.proposerActorRole,
    agentSessionId: DEFAULT_PROPOSAL_LIST_FILTERS.agentSessionId,
    reviewerUsername: DEFAULT_PROPOSAL_LIST_FILTERS.reviewerUsername,
    escalatedOnly: DEFAULT_PROPOSAL_LIST_FILTERS.escalatedOnly,
    outcomeFocus: DEFAULT_PROPOSAL_LIST_FILTERS.outcomeFocus,
    attention: DEFAULT_PROPOSAL_LIST_FILTERS.attention,
    stalledOnly: DEFAULT_PROPOSAL_LIST_FILTERS.stalledOnly,
    needsReviewOnly: DEFAULT_PROPOSAL_LIST_FILTERS.needsReviewOnly,
  };
}

export type ProposalListApiQuery = {
  status?: string;
  kind?: string;
  sort: ProposalListSortField;
  sort_dir: ProposalListSortDir;
  q?: string;
  proposer_username?: string;
  proposer_actor_type?: string;
  proposer_actor_role?: string;
  agent_session_id?: string;
  reviewer_username?: string;
  escalated?: string;
  outcome_review?: string;
  attention?: string;
  attention_perspective?: string;
  stalled?: string;
  needs_review?: string;
};

/** Map UI filters to API query params. status/kind/actor type `all` → omit. */
export function toProposalListApiQuery(
  filters: ProposalListFilters,
  q: string,
): ProposalListApiQuery {
  const out: ProposalListApiQuery = {
    sort: filters.sort,
    sort_dir: filters.sortDir,
  };
  if (filters.status !== "all") out.status = filters.status;
  if (filters.kind !== "all") out.kind = filters.kind;
  const trimmed = q.trim();
  if (trimmed) out.q = trimmed;
  const user = filters.proposerUsername.trim();
  if (user) out.proposer_username = user;
  if (filters.proposerActorType !== "all") out.proposer_actor_type = filters.proposerActorType;
  const role = filters.proposerActorRole.trim();
  if (role) out.proposer_actor_role = role;
  const session = filters.agentSessionId.trim();
  if (session) out.agent_session_id = session;
  const reviewer = filters.reviewerUsername.trim();
  if (reviewer) out.reviewer_username = reviewer;
  if (filters.escalatedOnly) out.escalated = "1";
  if (filters.outcomeFocus !== "off") out.outcome_review = OUTCOME_FOCUS_TO_API[filters.outcomeFocus];
  if (filters.attention !== "all") out.attention = filters.attention;
  if (filters.stalledOnly) out.stalled = "1";
  if (filters.needsReviewOnly) out.needs_review = "1";
  if (filters.sort === "attention") out.attention_perspective = "reviewer";
  return out;
}

export function proposalListApiSearchParams(query: ProposalListApiQuery): string {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.kind) params.set("kind", query.kind);
  params.set("sort", query.sort);
  params.set("sort_dir", query.sort_dir);
  if (query.q) params.set("q", query.q);
  if (query.proposer_username) params.set("proposer_username", query.proposer_username);
  if (query.proposer_actor_type) params.set("proposer_actor_type", query.proposer_actor_type);
  if (query.proposer_actor_role) params.set("proposer_actor_role", query.proposer_actor_role);
  if (query.agent_session_id) params.set("agent_session_id", query.agent_session_id);
  if (query.reviewer_username) params.set("reviewer_username", query.reviewer_username);
  if (query.escalated) params.set("escalated", query.escalated);
  if (query.outcome_review) params.set("outcome_review", query.outcome_review);
  if (query.attention) params.set("attention", query.attention);
  if (query.attention_perspective) params.set("attention_perspective", query.attention_perspective);
  if (query.stalled) params.set("stalled", query.stalled);
  if (query.needs_review) params.set("needs_review", query.needs_review);
  return params.toString();
}

export type ProposalListStats = {
  total: number;
  by_status: Record<string, number>;
  by_kind: Record<string, number>;
  escalated_count?: number;
  by_attention?: Record<string, number>;
  by_kind_status?: Record<
    string,
    { open?: number; finished?: number; rejected?: number }
  >;
  stalled_ideas?: number;
  needs_review_edits?: number;
  /** `none` = closed, unreviewed, not a system closure; `bad_open` = bad with no lesson captured. */
  by_outcome?: { good: number; bad: number; bad_open: number; none: number };
};

export const PROPOSAL_KPI_CARD_STATUSES = ["open", "finished", "rejected"] as const;
export type ProposalKpiCardStatus = (typeof PROPOSAL_KPI_CARD_STATUSES)[number];

export const PROPOSAL_KPI_CARD_KINDS = ["idea", "edits", "notes"] as const;
export type ProposalKpiCardKind = (typeof PROPOSAL_KPI_CARD_KINDS)[number];

export type ProposalKpiCardSpec = {
  kind: ProposalKpiCardKind;
  label: string;
};

const KIND_LABEL: Record<ProposalKpiCardKind, string> = {
  idea: "Ideas",
  edits: "Edits",
  notes: "Notes",
};

/** Which kind KPI cards to show given the list kind filter (one card per kind). */
export function proposalKpiCardsForKindFilter(kind: ProposalListKind): ProposalKpiCardSpec[] {
  const kinds: ProposalKpiCardKind[] =
    kind === "idea" || kind === "edits" || kind === "notes"
      ? [kind]
      : [...PROPOSAL_KPI_CARD_KINDS];
  return kinds.map((k) => ({ kind: k, label: KIND_LABEL[k] }));
}

export function proposalKpiLiveCount(
  stats: ProposalListStats | null | undefined,
  kind: ProposalKpiCardKind,
  status: ProposalKpiCardStatus,
): number {
  return Number(stats?.by_kind_status?.[kind]?.[status] ?? 0) || 0;
}


export const PROPOSAL_STATUS_OPTIONS: Array<{ value: ProposalListStatus; label: string }> = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "partial", label: "Partial" },
  { value: "finished", label: "Finished" },
  { value: "rejected", label: "Rejected" },
  { value: "withdrawn", label: "Withdrawn" },
];

export const PROPOSAL_KIND_OPTIONS: Array<{ value: ProposalListKind; label: string }> = [
  { value: "all", label: "All" },
  { value: "edits", label: "Edits" },
  { value: "notes", label: "Notes" },
  { value: "idea", label: "Idea" },
];

export const PROPOSAL_ATTENTION_OPTIONS: Array<{
  value: ProposalListAttention;
  label: string;
}> = [
  { value: "all", label: "Any attention" },
  { value: "predecessor_applied", label: "Ready: its page is live" },
  { value: "escalated", label: "Escalated hold" },
  { value: "awaiting_rereview", label: "Ready for re-check" },
  { value: "no_feedback", label: "No feedback yet" },
  { value: "blocked", label: "Waiting on author" },
  { value: "needs_author", label: "Out of date (author)" },
];

export const PROPOSAL_ACTOR_TYPE_OPTIONS: Array<{
  value: ProposalListActorType;
  label: string;
}> = [
  { value: "all", label: "Anyone" },
  { value: "ui", label: "Staff" },
  { value: "mcp", label: "Agent" },
  { value: "system", label: "System" },
];

export type ProposalSortPreset = {
  value: string;
  label: string;
  sort: ProposalListSortField;
  sortDir: ProposalListSortDir;
  /** When set, selecting this preset also updates status (Needs attention → open). */
  status?: ProposalListStatus;
};

export const PROPOSAL_SORT_PRESETS: ProposalSortPreset[] = [
  {
    value: "needs_attention",
    label: "Needs attention",
    sort: "attention",
    sortDir: "desc",
    status: "open",
  },
  { value: "updated_desc", label: "Newest updated", sort: "updated_at", sortDir: "desc" },
  { value: "updated_asc", label: "Oldest updated", sort: "updated_at", sortDir: "asc" },
  { value: "created_desc", label: "Newest created", sort: "created_at", sortDir: "desc" },
  { value: "created_asc", label: "Oldest created", sort: "created_at", sortDir: "asc" },
];

export function proposalSortPresetValue(
  sort: ProposalListSortField,
  sortDir: ProposalListSortDir,
): string {
  if (sort === "attention") return "needs_attention";
  const hit = PROPOSAL_SORT_PRESETS.find((p) => p.sort === sort && p.sortDir === sortDir);
  return hit?.value ?? "updated_desc";
}

export function proposalSortFromPreset(
  value: string,
): Pick<ProposalListFilters, "sort" | "sortDir"> & { status?: ProposalListStatus } {
  const hit = PROPOSAL_SORT_PRESETS.find((p) => p.value === value);
  if (!hit) {
    return {
      sort: DEFAULT_PROPOSAL_LIST_FILTERS.sort,
      sortDir: DEFAULT_PROPOSAL_LIST_FILTERS.sortDir,
    };
  }
  return {
    sort: hit.sort,
    sortDir: hit.sortDir,
    ...(hit.status ? { status: hit.status } : {}),
  };
}

export function attentionBadgeLabel(attention: string | null | undefined): string | null {
  if (!attention) return null;
  const hit = PROPOSAL_ATTENTION_OPTIONS.find((o) => o.value === attention);
  return hit && hit.value !== "all" ? hit.label : null;
}
