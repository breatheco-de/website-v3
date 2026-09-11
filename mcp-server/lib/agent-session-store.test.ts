import { describe, expect, it, beforeEach } from "vitest";
import {
  registerAgentSession,
  getAgentSession,
  dropAgentSession,
  clearAgentSessionsForTests,
  sessionScopeMatches,
} from "./agent-session-store";

describe("agent-session-store", () => {
  beforeEach(() => {
    clearAgentSessionsForTests();
  });

  it("registers and drops sessions", () => {
    registerAgentSession({
      agentSessionId: "s1",
      model: "xai/grok-4",
      username: "alice",
      role: "copy_editor",
      client: "Grok",
      site: "site_4geeks-com",
    });
    expect(getAgentSession("s1")?.model).toBe("xai/grok-4");
    dropAgentSession("s1");
    expect(getAgentSession("s1")).toBeUndefined();
  });

  it("matches scope", () => {
    const rec = {
      agentSessionId: "s1",
      model: "claude/sonnet-4.5",
      username: "Alice",
      role: "copy_editor",
      client: "Cursor",
      site: "site_x",
    };
    expect(
      sessionScopeMatches(rec, {
        username: "alice",
        role: "copy_editor",
        client: "Cursor",
        site: "site_x",
      }),
    ).toBe(true);
    expect(
      sessionScopeMatches(rec, {
        username: "alice",
        role: "copy_editor",
        client: "Grok",
        site: "site_x",
      }),
    ).toBe(false);
  });
});
