import { afterEach, describe, expect, it, vi } from "vitest";
import {
  confirmGuardedEdit,
  findGuardedDraftForRequest,
  isProposalEditConfirmed,
  matchGuardedDraft,
  resetProposalEditGuardForTests,
  setProposalEditGuard,
  type GuardedDraft,
} from "./proposal-edit-guard";

const draft: GuardedDraft = {
  contentType: "landing",
  slug: "ai-flex",
  locale: "en",
  variant: "agent-fix",
  proposalId: "p1",
};

function editBody(overrides: Record<string, unknown> = {}) {
  return { contentType: "landing", slug: "ai-flex", locale: "en", variant: "agent-fix", operations: [], ...overrides };
}

afterEach(() => resetProposalEditGuardForTests());

describe("matchGuardedDraft", () => {
  it("matches section edits on the guarded draft only", () => {
    expect(matchGuardedDraft("/api/content/edit-sections", "POST", editBody(), [draft])).toBe(draft);
    expect(matchGuardedDraft("/api/content/edit-sections", "POST", editBody({ variant: undefined }), [draft])).toBeNull();
    expect(matchGuardedDraft("/api/content/edit-sections", "POST", editBody({ locale: "es" }), [draft])).toBeNull();
    expect(matchGuardedDraft("/api/content/edit-common", "POST", editBody(), [draft])).toBeNull();
  });

  it("matches raw YAML saves of the draft file", () => {
    const body = { filePath: "site_x/landings/ai-flex/agent-fix.en.yml", content: "x" };
    expect(matchGuardedDraft("/api/content/raw-file", "PUT", body, [draft])).toBe(draft);
    expect(
      matchGuardedDraft("/api/content/raw-file", "PUT", { ...body, filePath: "site_x/landings/ai-flex/en.yml" }, [draft]),
    ).toBeNull();
  });
});

describe("confirmGuardedEdit", () => {
  it("asks once for concurrent saves and lets all through on confirm", async () => {
    let resolveAsk: (ok: boolean) => void = () => {};
    const confirm = vi.fn(() => new Promise<boolean>((r) => (resolveAsk = r)));
    setProposalEditGuard({ drafts: [draft], confirm });

    const init = { method: "POST", body: JSON.stringify(editBody()) };
    const hit = findGuardedDraftForRequest("/api/content/edit-sections", init);
    expect(hit).toEqual(draft);

    const a = confirmGuardedEdit(draft);
    const b = confirmGuardedEdit(draft);
    expect(confirm).toHaveBeenCalledTimes(1);
    resolveAsk(true);
    await expect(Promise.all([a, b])).resolves.toEqual([true, true]);
    expect(isProposalEditConfirmed("p1")).toBe(true);
    expect(findGuardedDraftForRequest("/api/content/edit-sections", init)).toBeNull();
  });

  it("cancels every waiting save and reports the cancel once", async () => {
    let resolveAsk: (ok: boolean) => void = () => {};
    const onCancelled = vi.fn();
    setProposalEditGuard({
      drafts: [draft],
      confirm: () => new Promise<boolean>((r) => (resolveAsk = r)),
      onCancelled,
    });
    const a = confirmGuardedEdit(draft);
    const b = confirmGuardedEdit(draft);
    resolveAsk(false);
    await expect(Promise.all([a, b])).resolves.toEqual([false, false]);
    expect(onCancelled).toHaveBeenCalledTimes(1);
    expect(isProposalEditConfirmed("p1")).toBe(false);
  });

  it("ignores reads and requests when no guard is registered", () => {
    expect(findGuardedDraftForRequest("/api/content/edit-sections", { method: "POST", body: "{}" })).toBeNull();
    setProposalEditGuard({ drafts: [draft], confirm: async () => true });
    expect(findGuardedDraftForRequest("/api/content/edit-sections")).toBeNull();
  });
});
