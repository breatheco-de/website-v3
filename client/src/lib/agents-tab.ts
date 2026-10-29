export type AgentsTab = "orgchart" | "proposals" | "outcomes" | "rules" | "webhooks" | "webhook-logs";

export const AGENTS_OUTCOMES_BASE = "/private/agents/outcomes";
export const AGENTS_WEBHOOKS_HREF = "/private/agents/webhooks";
export const AGENTS_WEBHOOK_LOGS_HREF = "/private/agents/webhook-logs";
const AGENTS_PROPOSALS_PATH = "/private/agents/proposals";

export type OutcomeFilter = "any" | "good" | "bad" | "none";
export const OUTCOME_FILTERS: readonly OutcomeFilter[] = ["any", "good", "bad", "none"];
export const OUTCOMES_PAGE_SIZE = 24;

export type OutcomesView = { outcome: OutcomeFilter; page: number };

function toParams(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
}

/** Proposal detail opened from Outcomes (`?from=outcomes`) keeps the Outcomes tab highlighted. */
export function resolveAgentsTab(pathname: string, search = ""): AgentsTab | null {
  if (pathname === "/private/agents/orgchart") return "orgchart";
  if (pathname === "/private/agents/rules") return "rules";
  if (pathname === AGENTS_OUTCOMES_BASE) return "outcomes";
  if (pathname === AGENTS_WEBHOOKS_HREF) return "webhooks";
  if (pathname === AGENTS_WEBHOOK_LOGS_HREF) return "webhook-logs";
  if (pathname.startsWith(`${AGENTS_PROPOSALS_PATH}/`) && toParams(search).get("from") === "outcomes") {
    return "outcomes";
  }
  if (pathname === AGENTS_PROPOSALS_PATH || pathname.startsWith(`${AGENTS_PROPOSALS_PATH}/`)) {
    return "proposals";
  }
  return null;
}

export function parseOutcomesSearch(search: string): OutcomesView {
  const params = toParams(search);
  const raw = params.get("outcome");
  const outcome = OUTCOME_FILTERS.includes(raw as OutcomeFilter) ? (raw as OutcomeFilter) : "any";
  const pageNum = Number(params.get("page"));
  const page = Number.isInteger(pageNum) && pageNum > 0 ? pageNum : 0;
  return { outcome, page };
}

function outcomesViewParams(view: OutcomesView): URLSearchParams {
  const params = new URLSearchParams();
  if (view.outcome !== "any") params.set("outcome", view.outcome);
  if (view.page > 0) params.set("page", String(view.page));
  return params;
}

export function outcomesHref(view: OutcomesView): string {
  const qs = outcomesViewParams(view).toString();
  return qs ? `${AGENTS_OUTCOMES_BASE}?${qs}` : AGENTS_OUTCOMES_BASE;
}

export function outcomeProposalHref(id: string, view: OutcomesView): string {
  const params = outcomesViewParams(view);
  params.set("from", "outcomes");
  return `${AGENTS_PROPOSALS_PATH}/${encodeURIComponent(id)}?${params}`;
}

/** Back target for a proposal opened from Outcomes; null when it was opened elsewhere. */
export function outcomesBackHref(search: string): string | null {
  if (toParams(search).get("from") !== "outcomes") return null;
  return outcomesHref(parseOutcomesSearch(search));
}

/**
 * Page to jump to when the requested page came back empty (e.g. the last item on the last page was
 * just reviewed, or a stale link). null = keep the current page.
 */
export function clampOutcomesPage(
  page: number,
  rowCount: number,
  total: number,
  pageSize = OUTCOMES_PAGE_SIZE,
): number | null {
  if (page <= 0 || rowCount > 0) return null;
  if (total <= 0) return 0;
  const last = Math.max(0, Math.ceil(total / pageSize) - 1);
  return last === page ? null : last;
}
