/**
 * First-edit warning for drafts that belong to an open proposal.
 *
 * Saving such a draft makes the editor a co-author (they can no longer approve it), releases any
 * claim and sends the proposal back to review. The server absorbs the edit after the write, so the
 * question has to be asked before the request leaves the browser: the global fetch interceptor in
 * `main.tsx` calls `findGuardedDraftForRequest` and, on a match, awaits `confirmGuardedEdit`.
 */

export type GuardedDraft = {
  contentType: string;
  slug: string;
  locale: string;
  variant: string;
  proposalId: string;
  proposalTitle?: string;
};

type Confirmer = (draft: GuardedDraft) => Promise<boolean>;

let guardedDrafts: GuardedDraft[] = [];
let confirmer: Confirmer | null = null;
let onCancelled: ((draft: GuardedDraft) => void) | null = null;
let pending: { proposalId: string; answer: Promise<boolean> } | null = null;

const CONFIRMED_KEY_PREFIX = "proposal-edit-confirmed:";
const memoryConfirmed = new Set<string>();

export const PROPOSAL_EDIT_CANCELLED_CODE = "proposal_edit_cancelled";

/** Registered by `ProposalEditGuardHost`; pass an empty list to turn the guard off. */
export function setProposalEditGuard(opts: {
  drafts: GuardedDraft[];
  confirm: Confirmer | null;
  onCancelled?: (draft: GuardedDraft) => void;
}): void {
  guardedDrafts = opts.drafts;
  confirmer = opts.confirm;
  onCancelled = opts.onCancelled ?? null;
}

export function isProposalEditConfirmed(proposalId: string): boolean {
  if (memoryConfirmed.has(proposalId)) return true;
  try {
    return window.sessionStorage.getItem(CONFIRMED_KEY_PREFIX + proposalId) === "1";
  } catch {
    return false;
  }
}

function markConfirmed(proposalId: string): void {
  memoryConfirmed.add(proposalId);
  try {
    window.sessionStorage.setItem(CONFIRMED_KEY_PREFIX + proposalId, "1");
  } catch {
    /* private mode: the in-memory set still covers this tab */
  }
}

function requestPath(input: RequestInfo | URL): string | null {
  const raw = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
  try {
    return new URL(raw, "http://local").pathname;
  } catch {
    return null;
  }
}

function lc(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

/** Which guarded draft (if any) a content write request targets. Pure; exported for tests. */
export function matchGuardedDraft(
  path: string,
  method: string,
  body: unknown,
  drafts: GuardedDraft[],
): GuardedDraft | null {
  if (!drafts.length || !body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  const verb = method.toUpperCase();
  if (path === "/api/content/edit-sections" && verb === "POST") {
    return (
      drafts.find(
        (d) =>
          lc(b.variant) === lc(d.variant) &&
          lc(b.slug) === lc(d.slug) &&
          lc(b.locale) === lc(d.locale) &&
          lc(b.contentType) === lc(d.contentType),
      ) ?? null
    );
  }
  if (path === "/api/content/raw-file" && (verb === "PUT" || verb === "POST")) {
    const filePath = typeof b.filePath === "string" ? b.filePath : typeof b.path === "string" ? b.path : "";
    const parts = filePath.split(/[\\/]/).filter(Boolean);
    const base = parts[parts.length - 1] ?? "";
    const dir = parts[parts.length - 2] ?? "";
    return drafts.find((d) => base === `${d.variant}.${d.locale}.yml` && dir === d.slug) ?? null;
  }
  return null;
}

/** Sync check run on every fetch: only JSON writes to draft endpoints are parsed. */
export function findGuardedDraftForRequest(input: RequestInfo | URL, init?: RequestInit): GuardedDraft | null {
  if (!guardedDrafts.length || !confirmer) return null;
  const method = init?.method ?? (typeof input === "object" && "method" in input ? input.method : "GET");
  if (method.toUpperCase() === "GET") return null;
  const path = requestPath(input);
  if (path !== "/api/content/edit-sections" && path !== "/api/content/raw-file") return null;
  if (typeof init?.body !== "string") return null;
  let body: unknown;
  try {
    body = JSON.parse(init.body);
  } catch {
    return null;
  }
  const draft = matchGuardedDraft(path, method, body, guardedDrafts);
  if (!draft || isProposalEditConfirmed(draft.proposalId)) return null;
  return draft;
}

/**
 * One question per batch: saves that arrive while the modal is open share its answer. Cancel
 * fires `onCancelled` once so the host can reload the preview and drop optimistic edits.
 */
export function confirmGuardedEdit(draft: GuardedDraft): Promise<boolean> {
  if (isProposalEditConfirmed(draft.proposalId)) return Promise.resolve(true);
  if (pending && pending.proposalId === draft.proposalId) return pending.answer;
  const ask = confirmer;
  if (!ask) return Promise.resolve(true);
  const answer = ask(draft)
    .catch(() => false)
    .then((ok) => {
      pending = null;
      if (ok) markConfirmed(draft.proposalId);
      else onCancelled?.(draft);
      return ok;
    });
  pending = { proposalId: draft.proposalId, answer };
  return answer;
}

export function cancelledEditResponse(): Response {
  return new Response(
    JSON.stringify({
      success: false,
      code: PROPOSAL_EDIT_CANCELLED_CODE,
      error: "Edit cancelled. The proposed draft was not changed.",
    }),
    { status: 409, headers: { "Content-Type": "application/json" } },
  );
}

/** Test-only reset of module state. */
export function resetProposalEditGuardForTests(): void {
  guardedDrafts = [];
  confirmer = null;
  onCancelled = null;
  pending = null;
  memoryConfirmed.clear();
  try {
    for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
      const key = window.sessionStorage.key(i);
      if (key?.startsWith(CONFIRMED_KEY_PREFIX)) window.sessionStorage.removeItem(key);
    }
  } catch {
    /* no sessionStorage */
  }
}
