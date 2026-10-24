import { describe, expect, it } from "vitest";
import { checkStaffSummary } from "./blocker-staff-summary";

const AGENT_STYLE =
  "STAFF FIX: publish drops EN authors + published_at (needs page-level _common.yml copy first). " +
  "The op lands in en.yml only, and the apply dry run warns display_values_change for authors and published_at. " +
  "Publishing this draft would strip the EN byline/Person schema and datePublished from a live post.";

const PLAIN =
  "Needs a staff fix before approving. The redirect itself is right: the old address is broken today and " +
  "should send visitors to the English post. But approving this draft would remove the author name and " +
  "publish date from the live English post, both on the page and in what Google reads. Someone first needs " +
  "to copy the author and date into the settings shared by both language versions of this post.";

describe("checkStaffSummary", () => {
  it("rejects the agent-style blocker and names each offending term", () => {
    const res = checkStaffSummary(AGENT_STYLE);
    expect(res.ok).toBe(false);
    const all = res.problems.join(" | ");
    expect(all).toContain('"_common.yml"');
    expect(all).toContain('"en.yml"');
    expect(all).toContain('"published_at"');
    expect(all).toContain('"display_values_change"');
    expect(all).toContain('"datePublished"');
    expect(all).toContain('"op"');
    expect(all).toContain('"schema"');
  });

  it("accepts the plain rewrite", () => {
    expect(checkStaffSummary(PLAIN)).toEqual({ ok: true, problems: [] });
  });

  it("allows page addresses, URLs and domains", () => {
    const res = checkStaffSummary(
      "The old address /blog/ai-tools/grok_bot_use-cases is broken; send visitors to https://4geeks.com/en/blog instead of 4geeks.com home.",
    );
    expect(res).toEqual({ ok: true, problems: [] });
  });

  it("rejects backticks, dotted field paths and length limits", () => {
    expect(checkStaffSummary("Change `meta.title` before approving this draft, please.").problems.join(" ")).toMatch(
      /backticks.*field paths: "meta.title"/,
    );
    expect(checkStaffSummary("Too short.").problems[0]).toMatch(/too short/);
    expect(checkStaffSummary("a ".repeat(400)).problems[0]).toMatch(/too long/);
  });

  it("does not flag e.g. or common brand casing", () => {
    expect(
      checkStaffSummary("The post promises iPhone tips, e.g. battery care, but the draft never covers them at all.").ok,
    ).toBe(true);
  });
});
