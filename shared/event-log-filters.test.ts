import { describe, expect, it } from "vitest";
import {
  expandKindIdsToTypes,
  formatAgentLabel,
  parseActorIds,
  parseAgentFilter,
  parseKindIds,
  primaryActorBucket,
  AGENT_FILTER_OTHER,
  resolveAgentId,
  serializeAgentFilter,
} from "@shared/event-log-filters";

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

describe("primaryActorBucket", () => {
  it("maps ui / mcp / else", () => {
    expect(primaryActorBucket([{ actor: { type: "ui" } }])).toBe("people");
    expect(primaryActorBucket([{ actor: { type: "mcp", client: "Cursor" } }])).toBe("agents");
    expect(primaryActorBucket([{ actor: { type: "system", source: "x" } }])).toBe("system");
    expect(primaryActorBucket([])).toBe("system");
  });
});

describe("parse helpers", () => {
  it("drops unknown kind and actor tokens", () => {
    expect(parseKindIds("writes,nope,completes")).toEqual(["writes", "completes"]);
    expect(parseActorIds("people,aliens,agents")).toEqual(["people", "agents"]);
  });

  it("parses agent filter other sentinel", () => {
    expect(parseAgentFilter("other")).toBe(AGENT_FILTER_OTHER);
    expect(parseAgentFilter(AGENT_FILTER_OTHER)).toBe(AGENT_FILTER_OTHER);
    expect(parseAgentFilter("claude")).toBe("claude");
    expect(parseAgentFilter("not-an-agent")).toBeNull();
    expect(serializeAgentFilter(AGENT_FILTER_OTHER)).toBe("other");
  });

  it("expands kinds to types", () => {
    expect(expandKindIdsToTypes(["completes"])).toEqual(["validation_issue_completed"]);
    expect(expandKindIdsToTypes(["bogus"])).toEqual([]);
  });
});
