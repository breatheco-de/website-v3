import { describe, expect, it } from "vitest";
import { formatAgentLabel, AGENT_FILTER_OTHER, resolveAgentId } from "./agentIcons";

describe("resolveAgentId", () => {
  it("returns null for system and ui actors", () => {
    expect(
      resolveAgentId([{ author: "github-pull", actor: { type: "system", source: "github-pull" } }]),
    ).toBeNull();
    expect(resolveAgentId([{ author: "jane", actor: { type: "ui" } }])).toBeNull();
  });

  it("matches MCP model then client", () => {
    expect(
      resolveAgentId([
        { author: "jane", actor: { type: "mcp", client: "Cursor", model: "claude-4-sonnet" } },
      ]),
    ).toBe("claude");
    expect(
      resolveAgentId([{ author: "jane", actor: { type: "mcp", client: "ChatGPT", model: "" } }]),
    ).toBe("chatgpt");
  });

  it("uses primary attribution only", () => {
    expect(
      resolveAgentId([
        { author: "github-pull", actor: { type: "system", source: "github-pull" } },
        { author: "jane", actor: { type: "mcp", client: "Cursor", model: "gemini-2" } },
      ]),
    ).toBeNull();
  });
});

describe("formatAgentLabel", () => {
  it("humanizes agent ids and the other sentinel", () => {
    expect(formatAgentLabel("chatgpt")).toBe("ChatGPT");
    expect(formatAgentLabel("apple-intelligent")).toBe("Apple Intelligent");
    expect(formatAgentLabel(AGENT_FILTER_OTHER)).toBe("Staff & system");
  });
});
