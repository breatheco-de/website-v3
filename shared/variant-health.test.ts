import { describe, expect, it } from "vitest";
import {
  DRAFT_CLEANUP_DELETE_DAYS,
  DRAFT_CLEANUP_MIN_WARNING_DAYS,
  VARIANT_STALE_DAYS,
  contentChangePaths,
  draftCleanupDecision,
  overridableVariantReasons,
  variantVerdict,
  type VariantFacts,
} from "./variant-health";

const NOW = Date.parse("2026-11-09T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW - n * 86_400_000).toISOString();

/** A stale, untouched, untested variant identical to live: probably safe. */
function facts(over: Partial<VariantFacts> = {}): VariantFacts {
  return {
    allocation: 0,
    created_at: daysAgo(90),
    based_on_at: daysAgo(90),
    updated_at: daysAgo(80),
    proposal: { state: "none" },
    test: { state: "never" },
    on_live_server: true,
    has_live: true,
    changes_vs_live: 0,
    behind_live: false,
    is_last_draft_of_unpublished: false,
    ...over,
  };
}

const codes = (f: VariantFacts) => variantVerdict(f, NOW).reasons.map((r) => r.code);

describe("variantVerdict", () => {
  it("probably safe when stale, 0%, no proposal, never tested, same as live", () => {
    const h = variantVerdict(facts(), NOW);
    expect(h.verdict).toBe("probably_safe");
    expect(h.age_state).toBe("stale");
    expect(h.reasons).toEqual([]);
    expect(h.notes.map((n) => n.code)).toEqual(["identical_to_live"]);
    expect(h.summary).toContain("Probably safe to delete");
  });

  it("cannot delete with traffic, whatever else is true", () => {
    const h = variantVerdict(facts({ allocation: 10 }), NOW);
    expect(h.verdict).toBe("cannot_delete");
    expect(h.reasons[0].code).toBe("has_traffic");
  });

  describe("age (30-day window)", () => {
    it("new inside the window, stale just past it", () => {
      expect(variantVerdict(facts({ created_at: daysAgo(VARIANT_STALE_DAYS - 1), updated_at: null }), NOW).age_state).toBe("new");
      expect(variantVerdict(facts({ created_at: daysAgo(VARIANT_STALE_DAYS + 1), updated_at: null }), NOW).age_state).toBe("stale");
    });

    it("old but edited recently is active and check first", () => {
      const h = variantVerdict(facts({ updated_at: daysAgo(3) }), NOW);
      expect(h.age_state).toBe("active");
      expect(h.verdict).toBe("check_first");
      expect(codes(facts({ updated_at: daysAgo(3) }))).toEqual(["recently_edited"]);
    });

    it("falls back to based_on when created_at is missing", () => {
      const h = variantVerdict(facts({ created_at: null, based_on_at: daysAgo(5) }), NOW);
      expect(h.created_source).toBe("based_on");
      expect(h.age_state).toBe("new");
    });

    it("age unknown never counts as stale", () => {
      const h = variantVerdict(facts({ created_at: null, based_on_at: null, updated_at: daysAgo(200) }), NOW);
      expect(h.age_state).toBe("unknown");
      expect(h.verdict).toBe("check_first");
      expect(h.reasons.map((r) => r.code)).toEqual(["age_unknown"]);
    });

    it("last activity is the newer date: a new variant that inherited live's old updated_at is not stale", () => {
      const h = variantVerdict(facts({ created_at: daysAgo(2), updated_at: daysAgo(400) }), NOW);
      expect(h.age_state).toBe("new");
      expect(h.last_activity_at).toBe(daysAgo(2));
    });
  });

  describe("proposals", () => {
    it("open proposal is check first and not overridable", () => {
      const h = variantVerdict(facts({ proposal: { state: "open", title: "Spring CTA" } }), NOW);
      expect(h.verdict).toBe("check_first");
      expect(h.reasons.map((r) => r.code)).toEqual(["proposal_open"]);
      expect(overridableVariantReasons(h)).toEqual([]);
      expect(h.purpose).toEqual({ kind: "proposal", text: 'Created for proposal "Spring CTA" (open).' });
    });

    it("unverified proposal counts as open (check first) but is overridable", () => {
      const h = variantVerdict(facts({ proposal: { state: "unverified" } }), NOW);
      expect(h.verdict).toBe("check_first");
      expect(overridableVariantReasons(h).map((r) => r.code)).toEqual(["proposal_unverified"]);
    });

    it("orphaned proposal doesn't block, only adds a note", () => {
      const h = variantVerdict(facts({ proposal: { state: "orphan", orphan_since: daysAgo(40) } }), NOW);
      expect(h.verdict).toBe("probably_safe");
      expect(h.notes.map((n) => n.code)).toContain("proposal_orphan");
    });
  });

  describe("tests", () => {
    it("running and recently ended tests are check first; long ago is not", () => {
      expect(codes(facts({ test: { state: "running" } }))).toEqual(["test_running"]);
      expect(codes(facts({ test: { state: "ended_recently", ended_at: daysAgo(10) } }))).toEqual(["test_ended_recently"]);
      expect(variantVerdict(facts({ test: { state: "ended_long_ago", ended_at: daysAgo(60) } }), NOW).verdict).toBe("probably_safe");
    });

    it("unknown history is check first on the live server", () => {
      const h = variantVerdict(facts({ test: { state: "unknown" }, on_live_server: true }), NOW);
      expect(h.verdict).toBe("check_first");
      expect(h.reasons.map((r) => r.code)).toEqual(["test_history_unavailable"]);
    });

    it("unknown history is ignored with a note off production", () => {
      const h = variantVerdict(facts({ test: { state: "unknown" }, on_live_server: false }), NOW);
      expect(h.verdict).toBe("probably_safe");
      expect(h.notes.map((n) => n.code)).toContain("test_history_ignored_off_production");
    });
  });

  describe("changes vs live", () => {
    it("changes not on live are check first", () => {
      const h = variantVerdict(facts({ changes_vs_live: 3 }), NOW);
      expect(h.reasons.map((r) => r.code)).toEqual(["changes_not_on_live"]);
      expect(h.reasons[0].message).toContain("3 changes");
    });

    it("no live version: the changes check is skipped", () => {
      const h = variantVerdict(facts({ has_live: false, changes_vs_live: null }), NOW);
      expect(h.verdict).toBe("probably_safe");
      expect(h.notes.map((n) => n.code)).not.toContain("identical_to_live");
    });

    it("the last draft of an unpublished page is check first", () => {
      const h = variantVerdict(facts({ has_live: false, changes_vs_live: null, is_last_draft_of_unpublished: true }), NOW);
      expect(h.reasons.map((r) => r.code)).toEqual(["last_draft_of_unpublished_page"]);
    });

    it("date-only differences don't count as changes", () => {
      expect(contentChangePaths(["updated_at", "_updated_at", "published_at"])).toEqual([]);
      expect(contentChangePaths(["updated_at", "title", "meta.page_title"])).toEqual(["title", "meta.page_title"]);
    });
  });

  it("behind live is a note whatever the verdict", () => {
    const safe = variantVerdict(facts({ behind_live: true, behind_since: daysAgo(50) }), NOW);
    expect(safe.verdict).toBe("probably_safe");
    expect(safe.notes.map((n) => n.code)).toContain("behind_live");
    const traffic = variantVerdict(facts({ allocation: 50, behind_live: true }), NOW);
    expect(traffic.notes.map((n) => n.code)).toContain("behind_live");
  });

  it("purpose falls back to translation, then 'No reason recorded'", () => {
    expect(variantVerdict(facts({ translated_from: "en" }), NOW).purpose.text).toBe("Translated from the EN page.");
    expect(variantVerdict(facts(), NOW).purpose).toEqual({ kind: "none", text: "No reason recorded." });
  });

  it("first seen stands in for a missing creation date", () => {
    const h = variantVerdict(facts({ created_at: null, based_on_at: null, updated_at: null, first_seen_at: daysAgo(3) }), NOW);
    expect(h.created_source).toBe("first_seen");
    expect(h.age_state).toBe("new");
    expect(h.reasons[0].message).toContain("First seen");
  });

  it("a content change seen on the server or a recent Keep counts as activity", () => {
    expect(codes(facts({ content_changed_at: daysAgo(2) }))).toEqual(["recently_edited"]);
    expect(codes(facts({ kept_at: daysAgo(2) }))).toEqual(["recently_kept"]);
    expect(variantVerdict(facts({ kept_at: daysAgo(2) }), NOW).last_activity_at).toBe(daysAgo(2));
  });

  it("reports the cleanup flag with its tier", () => {
    const cleanup = { flagged_at: daysAgo(5), deletes_at: daysAgo(-25) };
    expect(variantVerdict(facts({ changes_vs_live: 2, cleanup }), NOW).cleanup).toEqual({ tier: "has_work", ...cleanup });
    expect(variantVerdict(facts(), NOW).cleanup).toBeNull();
  });
});

describe("draftCleanupDecision", () => {
  const decide = (over: Partial<VariantFacts>) => draftCleanupDecision(facts(over), NOW);
  const idle = (n: number, over: Partial<VariantFacts> = {}) =>
    decide({ created_at: daysAgo(n), based_on_at: null, updated_at: null, ...over });

  describe("nothing to lose (identical to live)", () => {
    it("deleted after 30 idle days, kept before, never flagged", () => {
      expect(idle(31)).toMatchObject({ action: "delete", tier: "nothing_to_lose" });
      expect(idle(29)).toMatchObject({ action: "keep", reason: "active" });
    });
  });

  describe("has unpublished work", () => {
    const work = { changes_vs_live: 4 };

    it("kept until 60 idle days, then flagged for day 90", () => {
      expect(idle(59, work)).toMatchObject({ action: "keep", tier: "has_work" });
      const d = idle(60, work);
      expect(d.action).toBe("flag");
      expect(d.deletes_at).toBe(daysAgo(60 - DRAFT_CLEANUP_DELETE_DAYS));
    });

    it("a translation with no live page counts as work", () => {
      expect(idle(61, { has_live: false, changes_vs_live: null })).toMatchObject({ action: "flag", tier: "has_work" });
    });

    it("an old draft still gets the full 30-day warning", () => {
      const d = idle(200, work);
      expect(d.action).toBe("flag");
      expect(d.deletes_at).toBe(daysAgo(-DRAFT_CLEANUP_MIN_WARNING_DAYS));
    });

    it("a flagged draft waits for its date, then is deleted", () => {
      const waiting = { ...work, cleanup: { flagged_at: daysAgo(10), deletes_at: daysAgo(-20) } };
      expect(idle(70, waiting)).toMatchObject({ action: "keep", reason: "flag_waiting" });
      const due = { ...work, cleanup: { flagged_at: daysAgo(31), deletes_at: daysAgo(1) } };
      expect(idle(95, due)).toMatchObject({ action: "delete" });
    });

    it("an edit or Keep after the flag clears it", () => {
      const cleanup = { flagged_at: daysAgo(10), deletes_at: daysAgo(-20) };
      expect(idle(70, { ...work, cleanup, content_changed_at: daysAgo(2) })).toMatchObject({
        action: "clear_flag",
        reason: "activity_since_flag",
      });
      expect(idle(70, { ...work, cleanup, kept_at: daysAgo(1) })).toMatchObject({ action: "clear_flag" });
    });
  });

  describe("never deleted", () => {
    it.each([
      ["proposal", { proposal: { state: "orphan" as const } }],
      ["has_traffic", { allocation: 5 }],
      ["test_running", { test: { state: "running" as const } }],
      ["test_ended_recently", { test: { state: "ended_recently" as const } }],
      ["test_history_unavailable", { test: { state: "unknown" as const } }],
      ["last_draft_of_unpublished_page", { has_live: false, changes_vs_live: null, is_last_draft_of_unpublished: true }],
    ])("%s", (reason, over) => {
      expect(idle(300, over)).toMatchObject({ action: "keep", reason });
    });

    it("unknown age is kept", () => {
      expect(decide({ created_at: null, based_on_at: null, updated_at: null })).toMatchObject({
        action: "keep",
        reason: "age_unknown",
      });
    });

    it("a block clears an existing flag", () => {
      const cleanup = { flagged_at: daysAgo(10), deletes_at: daysAgo(-20) };
      expect(idle(70, { changes_vs_live: 1, cleanup, allocation: 10 })).toMatchObject({ action: "clear_flag" });
    });
  });

  it("old A/B variants whose test ended long ago are included", () => {
    expect(idle(40, { test: { state: "ended_long_ago", ended_at: daysAgo(40) } })).toMatchObject({ action: "delete" });
  });

  it("undated drafts start their clock when first seen", () => {
    const undated = { created_at: null, based_on_at: null, updated_at: null };
    expect(decide({ ...undated, first_seen_at: daysAgo(10) })).toMatchObject({ action: "keep" });
    expect(decide({ ...undated, first_seen_at: daysAgo(31) })).toMatchObject({ action: "delete" });
  });
});
