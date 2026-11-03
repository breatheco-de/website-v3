import { describe, it, expect } from "vitest";
import { checkBlockerOverrideRequest } from "./blocker-override-gate";

describe("checkBlockerOverrideRequest", () => {
  const reviewer = { actorType: "ui", mcpAuthorHeader: false, hasReviewCapability: true };

  it("allows staff UI reviewers", () => {
    expect(checkBlockerOverrideRequest(reviewer)).toEqual({ ok: true });
  });

  it("refuses MCP callers by actor type or header, even with review", () => {
    expect(checkBlockerOverrideRequest({ ...reviewer, actorType: "mcp" })).toMatchObject({
      ok: false,
      code: "override_staff_only",
    });
    expect(checkBlockerOverrideRequest({ ...reviewer, mcpAuthorHeader: true })).toMatchObject({
      ok: false,
      code: "override_staff_only",
    });
  });

  it("requires proposals_review", () => {
    expect(checkBlockerOverrideRequest({ ...reviewer, hasReviewCapability: false })).toMatchObject({
      ok: false,
      code: "review_required",
    });
  });
});
