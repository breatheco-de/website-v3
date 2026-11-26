import {
  mintConnectionToken,
  readConnectionOwner,
  readConnectionToken,
} from "../lib/connection-token.js";
import { localOrigin } from "../lib/local-url.js";
import type { ResolvedConfig } from "../types.js";

export interface LocalAgentResult {
  token: string;
  mcpUrl: string;
  owner: string | null;
}

/**
 * Mint/read localhost MCP connection token (no printing — caller summaries).
 * Owner must already be persisted (token command or start-site resolve); fail closed if missing when minting.
 */
export function prepareAgenticLocal(config: ResolvedConfig, port: number, remint = false): LocalAgentResult {
  const owner = readConnectionOwner(config.projectRoot);
  if (!owner && (remint || !readConnectionToken(config.projectRoot))) {
    throw new Error(
      "Connection-token owner missing. Run `npx caxton-cms token --user <name>` first. See docs/local-connection-token.md",
    );
  }
  const token = remint
    ? mintConnectionToken(config.projectRoot)
    : readConnectionToken(config.projectRoot) ?? mintConnectionToken(config.projectRoot);
  return {
    token,
    mcpUrl: `${localOrigin(port)}/mcp`,
    owner,
  };
}

/** Convenience wrapper used by tests / callers that only need the token string. */
export function runAgenticLocal(config: ResolvedConfig, port: number, remint = false): string {
  return prepareAgenticLocal(config, port, remint).token;
}
