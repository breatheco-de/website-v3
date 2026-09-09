import { mintConnectionToken } from "../lib/connection-token.js";
import { printTokenInstructions } from "../lib/log.js";

/** Mint a new connection token and print dual-use (staff + MCP) instructions. */
export function runTokenCommand(projectRoot: string): void {
  const token = mintConnectionToken(projectRoot);
  printTokenInstructions({ token });
}
