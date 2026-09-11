import { describe, expect, it } from "vitest";
import { formatIssueActorLine, formatIssueActorSuffix, formatAttributionSummary, formatCausalityLabel } from "@/lib/formatIssueActor";

describe("formatIssueActor", () => {
  it("omits suffix for ui actor", () => {
    expect(formatIssueActorSuffix({ type: "ui" })).toBe("");
    expect(formatIssueActorLine("jane.doe", { type: "ui" })).toBe("jane.doe");
  });

  it("shows unknown role when client missing", () => {
    expect(formatIssueActorLine("jane.doe", { type: "mcp" })).toBe("jane.doe · unknown · via MCP");
  });

  it("shows role, exact model, and client for mcp actor", () => {
    expect(
      formatIssueActorLine("jane.doe", {
        type: "mcp",
        client: "Cursor",
        role: "copy_editor",
        model: "claude/sonnet-4.5",
      }),
    ).toBe("jane.doe · copy_editor · claude/sonnet-4.5 · via Cursor");
  });

  it("legacy mcp without role shows unknown", () => {
    expect(
      formatIssueActorLine("jane.doe", { type: "mcp", client: "Cursor", model: "claude-4" }),
    ).toBe("jane.doe · unknown · claude-4 · via Cursor");
  });

  it("shows system source suffix", () => {
    expect(formatIssueActorLine("github-pull", { type: "system", source: "github-pull" })).toBe(
      "github-pull · via github-pull",
    );
  });

  it("summarizes attribution with extra count", () => {
    expect(
      formatAttributionSummary([
        { author: "a", actor: { type: "ui" } },
        { author: "b", actor: { type: "ui" } },
      ]),
    ).toEqual({ primary: "a", extraCount: 1 });
  });

  it("labels dangling parent ids", () => {
    expect(
      formatCausalityLabel({ triggeredByEventId: 472 }, new Set([470, 471])),
    ).toBe("Caused by #472 (no longer in log)");
    expect(formatCausalityLabel({ triggeredByEventId: 472 }, new Set([472]))).toBe(
      "Caused by #472",
    );
  });
});
