import { mintConnectionToken } from "../lib/connection-token.js";
import { resolveAndPersistConnectionOwner } from "../lib/resolve-connection-owner.js";
import { printTokenInstructions } from "../lib/log.js";

/** Mint a new connection token and print dual-use (staff + MCP) instructions. */
export async function runTokenCommand(
  projectRoot: string,
  opts: { isProduction: boolean; userFlag?: string; yes?: boolean } = {
    isProduction: false,
  },
): Promise<void> {
  if (opts.isProduction) {
    throw new Error(
      "caxton-cms token is for local development only. Never mint or use a connection token in production — it is a shared secret. See docs/local-connection-token.md",
    );
  }
  const owner = await resolveAndPersistConnectionOwner({
    projectRoot,
    userFlag: opts.userFlag,
    yes: opts.yes,
  });
  const token = mintConnectionToken(projectRoot);
  printTokenInstructions({ token, owner });
}
