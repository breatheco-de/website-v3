/** Query keys for proposal list view state. */
export const PROPOSAL_LIST_SEARCH_KEYS = {
  status: "status",
  kind: "kind",
  sort: "sort",
  sortDir: "sort_dir",
  q: "q",
} as const;

export type ProposalListStatus =
  | "all"
  | "open"
  | "partial"
  | "finished"
  | "rejected"
  | "withdrawn";

export type ProposalListKind = "all" | "edits" | "notes";

export type ProposalListSortField = "created_at" | "updated_at";
export type ProposalListSortDir = "asc" | "desc";

export type ProposalListFilters = {
  status: ProposalListStatus;
  kind: ProposalListKind;
  sort: ProposalListSortField;
  sortDir: ProposalListSortDir;
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

const KIND_VALUES = new Set<ProposalListKind>(["all", "edits", "notes"]);

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
  if (raw === "created_at" || raw === "updated_at") return raw;
  return DEFAULT_PROPOSAL_LIST_FILTERS.sort;
}

function parseSortDir(raw: string | null): ProposalListSortDir {
  if (raw === "asc" || raw === "desc") return raw;
  return DEFAULT_PROPOSAL_LIST_FILTERS.sortDir;
}

export function parseProposalListSearch(search: string): ProposalListViewState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  return {
    filters: {
      status: parseStatus(params.get(PROPOSAL_LIST_SEARCH_KEYS.status)),
      kind: parseKind(params.get(PROPOSAL_LIST_SEARCH_KEYS.kind)),
      sort: parseSort(params.get(PROPOSAL_LIST_SEARCH_KEYS.sort)),
      sortDir: parseSortDir(params.get(PROPOSAL_LIST_SEARCH_KEYS.sortDir)),
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
  return n;
}

/** Reset status/kind to defaults; leave sort as-is. */
export function clearProposalListFilters(filters: ProposalListFilters): ProposalListFilters {
  return {
    ...filters,
    status: DEFAULT_PROPOSAL_LIST_FILTERS.status,
    kind: DEFAULT_PROPOSAL_LIST_FILTERS.kind,
  };
}

export type ProposalListApiQuery = {
  status?: string;
  kind?: string;
  sort: ProposalListSortField;
  sort_dir: ProposalListSortDir;
  q?: string;
};

/** Map UI filters to API query params. status/kind `all` → omit. */
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
  return out;
}

export function proposalListApiSearchParams(query: ProposalListApiQuery): string {
  const params = new URLSearchParams();
  if (query.status) params.set("status", query.status);
  if (query.kind) params.set("kind", query.kind);
  params.set("sort", query.sort);
  params.set("sort_dir", query.sort_dir);
  if (query.q) params.set("q", query.q);
  return params.toString();
}

export type ProposalListStats = {
  total: number;
  by_status: Record<string, number>;
  by_kind: Record<string, number>;
};

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
];

export type ProposalSortPreset = {
  value: string;
  label: string;
  sort: ProposalListSortField;
  sortDir: ProposalListSortDir;
};

export const PROPOSAL_SORT_PRESETS: ProposalSortPreset[] = [
  { value: "updated_desc", label: "Newest updated", sort: "updated_at", sortDir: "desc" },
  { value: "updated_asc", label: "Oldest updated", sort: "updated_at", sortDir: "asc" },
  { value: "created_desc", label: "Newest created", sort: "created_at", sortDir: "desc" },
  { value: "created_asc", label: "Oldest created", sort: "created_at", sortDir: "asc" },
];

export function proposalSortPresetValue(
  sort: ProposalListSortField,
  sortDir: ProposalListSortDir,
): string {
  const hit = PROPOSAL_SORT_PRESETS.find((p) => p.sort === sort && p.sortDir === sortDir);
  return hit?.value ?? "updated_desc";
}

export function proposalSortFromPreset(value: string): Pick<ProposalListFilters, "sort" | "sortDir"> {
  const hit = PROPOSAL_SORT_PRESETS.find((p) => p.value === value);
  if (!hit) {
    return {
      sort: DEFAULT_PROPOSAL_LIST_FILTERS.sort,
      sortDir: DEFAULT_PROPOSAL_LIST_FILTERS.sortDir,
    };
  }
  return { sort: hit.sort, sortDir: hit.sortDir };
}
