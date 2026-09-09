import { mintConnectionToken, readConnectionToken } from "../lib/connection-token.js";
import { localOrigin } from "../lib/local-url.js";
import type { ResolvedConfig } from "../types.js";

export interface LocalAgentResult {
  token: string;
  mcpUrl: string;
}

/** Mint/read localhost MCP connection token (no printing — caller summarizes). */
export function prepareAgenticLocal(config: ResolvedConfig, port: number, remint = false): LocalAgentResult {
  const token = remint
    ? mintConnectionToken(config.projectRoot)
    : readConnectionToken(config.projectRoot) ?? mintConnectionToken(config.projectRoot);
  return {
    token,
    mcpUrl: `${localOrigin(port)}/mcp`,
  };
}

/** Convenience wrapper used by tests / callers that only need the token string. */
export function runAgenticLocal(config: ResolvedConfig, port: number, remint = false): string {
  return prepareAgenticLocal(config, port, remint).token;
}
