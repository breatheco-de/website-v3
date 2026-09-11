import { describe, expect, it } from "vitest";
import {
  agentIdentityKey,
  isExactAgentModel,
  sameAgentIdentity,
  isStaffUiActor,
  MCP_MUTATING_TOOLS,
} from "./agent-identity";

describe("isExactAgentModel", () => {
  it("accepts provider/model with version", () => {
    expect(isExactAgentModel("claude/sonnet-4.5")).toBe(true);
    expect(isExactAgentModel("openai/gpt-5")).toBe(true);
  });

  it("rejects family labels and empty", () => {
    expect(isExactAgentModel("claude")).toBe(false);
    expect(isExactAgentModel("")).toBe(false);
    expect(isExactAgentModel("claude/")).toBe(false);
    expect(isExactAgentModel("/sonnet")).toBe(false);
  });
});

describe("agentIdentityKey", () => {
  it("uses ui for staff and mcp:user:role for role agents", () => {
    expect(agentIdentityKey("Alice", { type: "ui" })).toBe("ui:alice");
    expect(
      agentIdentityKey("Alice", { type: "mcp", role: "copy_editor", model: "claude/sonnet-4.5" }),
    ).toBe("mcp:alice:copy_editor");
  });

  it("treats missing role as unknown", () => {
    expect(agentIdentityKey("bob", { type: "mcp", model: "claude/sonnet-4.5" })).toBe(
      "mcp:bob:unknown",
    );
  });

  it("ignores model for equality", () => {
    expect(
      sameAgentIdentity(
        "alice",
        { type: "mcp", role: "copy_editor", model: "claude/sonnet-4.5" },
        "alice",
        { type: "mcp", role: "copy_editor", model: "claude/fable-1.5" },
      ),
    ).toBe(true);
    expect(
      sameAgentIdentity(
        "alice",
        { type: "mcp", role: "copy_editor" },
        "alice",
        { type: "mcp", role: "seo_specialist" },
      ),
    ).toBe(false);
  });
});

describe("isStaffUiActor", () => {
  it("is true for ui and missing actor", () => {
    expect(isStaffUiActor({ type: "ui" })).toBe(true);
    expect(isStaffUiActor(null)).toBe(true);
    expect(isStaffUiActor({ type: "mcp", role: "copy_editor" })).toBe(false);
  });
});

describe("MCP_MUTATING_TOOLS", () => {
  it("includes propose and update but not list reads", () => {
    expect(MCP_MUTATING_TOOLS.has("propose_change")).toBe(true);
    expect(MCP_MUTATING_TOOLS.has("update_fields")).toBe(true);
    expect(MCP_MUTATING_TOOLS.has("list_entries")).toBe(false);
    expect(MCP_MUTATING_TOOLS.has("explain_site")).toBe(false);
  });
});
