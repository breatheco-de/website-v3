/**
 * In-memory MCP agent session registry: sessionId → model + scope.
 * Source of truth for open/expiry remains the main app event store; this Map
 * speeds the mutate gate and supplies x-mcp-model after start/resume.
 */

export type AgentSessionRecord = {
  agentSessionId: string;
  model: string;
  username: string;
  role: string;
  client: string;
  /** contentRoot / site folder name (events site key). */
  site: string;
};

const sessions = new Map<string, AgentSessionRecord>();

export function registerAgentSession(record: AgentSessionRecord): void {
  sessions.set(record.agentSessionId, { ...record });
}

export function getAgentSession(agentSessionId: string): AgentSessionRecord | undefined {
  const id = agentSessionId.trim();
  if (!id) return undefined;
  return sessions.get(id);
}

export function dropAgentSession(agentSessionId: string): void {
  const id = agentSessionId.trim();
  if (id) sessions.delete(id);
}

export function clearAgentSessionsForTests(): void {
  sessions.clear();
}

export function sessionScopeMatches(
  record: AgentSessionRecord,
  scope: { username: string; role: string; client: string; site: string },
): boolean {
  return (
    record.username.trim().toLowerCase() === scope.username.trim().toLowerCase() &&
    record.role === scope.role &&
    record.client === scope.client &&
    record.site === scope.site
  );
}
