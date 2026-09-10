import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./oauth.js", () => ({
  getTokenUsername: (token: string) => (token === "tok-alice" ? "alice" : undefined),
  getTokenClientName: () => undefined,
}));

import {
  assertAgenticContentWriteAllowed,
  classifyAgenticWriteIntent,
  isAgenticRoleSession,
} from "./agentic-write-gate.js";
import { runInMcpSession } from "./auth.js";

describe("agentic-write-gate", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("classifyAgenticWriteIntent prefers explicit intent then variant", () => {
    expect(classifyAgenticWriteIntent({ intent: "publish" })).toBe("publish");
    expect(classifyAgenticWriteIntent({ variant: "draft" })).toBe("draft");
    expect(classifyAgenticWriteIntent({})).toBe("live");
  });

  it("isAgenticRoleSession is false without role ALS", () => {
    expect(isAgenticRoleSession()).toBe(false);
  });

  it("non-agentic session always allows", async () => {
    const result = await assertAgenticContentWriteAllowed({
      contentType: "page",
      slug: "home",
      locale: "en",
    });
    expect(result.allowed).toBe(true);
    if (result.allowed) expect(result.shouldRefreshClaim).toBe(false);
  });

  it("agentic publish/create_entry denied with propose next_actions", async () => {
    await runInMcpSession({ roleId: "copy_editor" }, async () => {
      const pub = await assertAgenticContentWriteAllowed({
        contentType: "page",
        slug: "home",
        locale: "en",
        intent: "publish",
      });
      expect(pub.allowed).toBe(false);
      if (pub.allowed) return;
      const text = pub.response.content[0]!.text;
      expect(text).toContain("agentic_propose_required");
      expect(text).toContain("propose_change");

      const create = await assertAgenticContentWriteAllowed({
        contentType: "blog",
        slug: "new-post",
        locale: "en",
        intent: "create_entry",
      });
      expect(create.allowed).toBe(false);
      if (create.allowed) return;
      expect(create.response.content[0]!.text).toContain("agentic_propose_required");
    });
  });

  it("agentic draft allowed without claim fetch", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await runInMcpSession({ roleId: "copy_editor" }, async () => {
      const result = await assertAgenticContentWriteAllowed({
        contentType: "page",
        slug: "home",
        locale: "es",
        variant: "draft",
      });
      expect(result.allowed).toBe(true);
      if (result.allowed) expect(result.shouldRefreshClaim).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });
  });

  it("agentic live without claim denied; with claim allowed", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ has_active_claim: false, claim_issue_ids: [] }),
      })),
    );
    await runInMcpSession({ roleId: "seo_specialist" }, async () => {
      const denied = await assertAgenticContentWriteAllowed({
        mcpToken: "tok-alice",
        contentType: "page",
        slug: "home",
        locale: "en",
      });
      expect(denied.allowed).toBe(false);
      if (denied.allowed) return;
      expect(denied.response.content[0]!.text).toContain("agentic_claim_required");
      expect(denied.response.content[0]!.text).toContain("update_issue");
    });

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ has_active_claim: true, claim_issue_ids: ["iss-1"] }),
      })),
    );
    await runInMcpSession({ roleId: "copy_editor" }, async () => {
      const allowed = await assertAgenticContentWriteAllowed({
        mcpToken: "tok-alice",
        contentType: "page",
        slug: "home",
        locale: "en",
      });
      expect(allowed.allowed).toBe(true);
      if (allowed.allowed) expect(allowed.shouldRefreshClaim).toBe(true);
    });
  });
});
