import { describe, expect, it } from "vitest";
import { canApproveInDrawer, proposalDraftPreviewHref } from "./proposal-drawer";

const preview = { contentType: "landing", slug: "ai-flex", locale: "en", variant: "agent-fix" };
const entry = { ...preview };

describe("canApproveInDrawer", () => {
  it("allows a single draft that matches the preview", () => {
    expect(canApproveInDrawer({ entries: [entry] }, preview)).toBe(true);
  });

  it("refuses multi-draft proposals, other drafts, templates and missing preview", () => {
    expect(canApproveInDrawer({ entries: [entry, { ...entry, locale: "es" }] }, preview)).toBe(false);
    expect(canApproveInDrawer({ entries: [{ ...entry, variant: "other" }] }, preview)).toBe(false);
    expect(canApproveInDrawer({ entries: [entry], affected_entries: { count: 12 } }, preview)).toBe(false);
    expect(canApproveInDrawer({ entries: [entry] }, undefined)).toBe(false);
  });
});

describe("proposalDraftPreviewHref", () => {
  it("opens the draft preview with the drawer pointed at the proposal", () => {
    expect(proposalDraftPreviewHref(entry, "abc")).toBe(
      "/private/preview/landing/ai-flex?variant=agent-fix&locale=en&proposal=abc",
    );
  });
});
