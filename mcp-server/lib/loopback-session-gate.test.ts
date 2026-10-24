import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./auth.js", () => ({
  getActiveRoleId: () => "seo_specialist",
  getActiveMcpToken: () => "tok",
}));
vi.mock("./oauth.js", () => ({
  getTokenUsername: () => "alice",
  getTokenClientName: () => "Cursor",
}));
vi.mock("./content.js", () => ({
  resolveSiteContext: () => ({ ok: true, contentFolder: "site_test", domain: "test.example" }),
}));
vi.mock("./role-connector-guide.js", () => ({
  denyUnscopedProductionMutate: async () => ({ content: [{ type: "text", text: "{}" }] }),
}));

const { assertMutatingAgentIdentity } = await import("./loopback");
const { registerAgentSession, clearAgentSessionsForTests } = await import("./agent-session-store");

function parse(result: { content: Array<{ text: string }> } | null) {
  return result ? JSON.parse(result.content[0]!.text) : null;
}

const scope = {
  model: "cursor/auto",
  username: "alice",
  role: "seo_specialist",
  client: "Cursor",
  site: "site_test",
};

describe("assertMutatingAgentIdentity: server-issued session ids", () => {
  beforeEach(() => clearAgentSessionsForTests());

  it("rejects an agent-invented id even when it is in the registry", async () => {
    registerAgentSession({ agentSessionId: "new", ...scope });
    const out = parse(
      await assertMutatingAgentIdentity("propose_change", { agent_session_id: "new", site: "test.example" }),
    );
    expect(out?.code).toBe("session_unknown");
    expect(out?.next_actions?.[0]?.tool).toBe("agent_session");
  });

  it("rejects invented ids on note/summarize too", async () => {
    const out = parse(
      await assertMutatingAgentIdentity("agent_session", {
        action: "summarize",
        agent_session_id: "pending",
        site: "test.example",
      }),
    );
    expect(out?.code).toBe("session_unknown");
  });

  it("lets start through without an id", async () => {
    expect(await assertMutatingAgentIdentity("agent_session", { action: "start", site: "test.example" })).toBeNull();
  });

  it("accepts a registered server-issued UUID for the same scope", async () => {
    const sid = "d2b2f51c-9fc3-4f86-93bd-03951f678da2";
    registerAgentSession({ agentSessionId: sid, ...scope });
    expect(
      await assertMutatingAgentIdentity("propose_change", { agent_session_id: sid, site: "test.example" }),
    ).toBeNull();
  });
});
