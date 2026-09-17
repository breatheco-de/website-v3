import { describe, expect, it } from "vitest";
import {
  EXPLAIN_TOPIC_ALIASES,
  PROPOSALS_SUBTOPICS,
  getProposalsSubtopic,
  listProposalsSubtopicsPublic,
  resolveExplainTopicAlias,
} from "./explain-proposals";

describe("explain-proposals hub", () => {
  it("lists public subtopics including translations", () => {
    const ids = listProposalsSubtopicsPublic().map((s) => s.id);
    expect(ids).toContain("translations");
    expect(ids).toContain("situations");
    expect(ids).toContain("overview");
  });

  it("resolves translations subtopic to proposals-translations stem", () => {
    expect(getProposalsSubtopic("translations")?.fileStem).toBe("proposals-translations");
  });

  it("aliases legacy flat *-proposals topics", () => {
    expect(resolveExplainTopicAlias("internal-links-proposals")).toEqual({
      topic: "proposals",
      subtopic: "internal-links",
      deprecated_from: "internal-links-proposals",
    });
    expect(resolveExplainTopicAlias("review-situations")).toEqual({
      topic: "proposals",
      subtopic: "situations",
      deprecated_from: "review-situations",
    });
    expect(EXPLAIN_TOPIC_ALIASES["idea-opportunity-harm-proposals"]?.subtopic).toBe(
      "idea-opportunity-harm",
    );
  });

  it("leaves advertised hub topic unchanged", () => {
    expect(resolveExplainTopicAlias("proposals")).toEqual({ topic: "proposals" });
  });

  it("every catalog subtopic has a unique id", () => {
    const ids = PROPOSALS_SUBTOPICS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
