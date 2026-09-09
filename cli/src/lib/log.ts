import pc from "picocolors";

function useColor(): boolean {
  if (process.env.NO_COLOR != null && process.env.NO_COLOR !== "") return false;
  if (process.env.FORCE_COLOR === "0") return false;
  return Boolean(process.stdout.isTTY);
}

function c() {
  return useColor()
    ? pc
    : {
        cyan: (s: string) => s,
        green: (s: string) => s,
        yellow: (s: string) => s,
        red: (s: string) => s,
        dim: (s: string) => s,
        bold: (s: string) => s,
        magenta: (s: string) => s,
      };
}

export function info(msg: string): void {
  console.log(msg);
}

export function warn(msg: string): void {
  console.warn(c().yellow(msg));
}

export function error(msg: string): void {
  console.error(c().red(msg));
}

export function banner(version: string): void {
  const col = c();
  console.log(`${col.cyan("✦")} ${col.bold("weblify")} ${col.dim(version)}`);
}

export function printSiteOnly(opts: { siteUrl: string }): void {
  const col = c();
  console.log("");
  console.log(`${col.green("✔")} Your site is running at ${col.bold(opts.siteUrl)}`);
  console.log("  Open that link in your browser to view and edit the site.");
  console.log("");
}

export function printCloudAgentInstructions(opts: {
  siteUrl: string;
  connectorUrl: string;
  token: string;
}): void {
  const col = c();
  console.log("");
  console.log(`${col.green("✔")} Your site is running at ${col.bold(opts.siteUrl)}`);
  console.log("");
  console.log(col.bold("Connect Claude.ai (or ChatGPT):"));
  console.log("  1. Open Claude.ai and go to Connectors");
  console.log("     (or your app’s MCP / custom connectors settings).");
  console.log("  2. Add a new connector / MCP server.");
  console.log("  3. Paste this URL:");
  console.log(`       ${col.cyan(opts.connectorUrl)}`);
  console.log("  4. When the connection wizard asks for a token");
  console.log('     (or “staff session token”), paste this:');
  console.log(`       ${col.magenta(opts.token)}`);
  console.log("  5. Finish authorization.");
  console.log("");
  console.log(col.dim("Keep this terminal open while you use the connector."));
  console.log(
    col.dim(
      "If you restart Weblify, the link above may change — paste the new URL into the connector.",
    ),
  );
  console.log(
    col.dim("Need a new token later? Stop Weblify, then run: npx weblify token"),
  );
  console.log("");
}

/** After Claude.ai / ChatGPT completes MCP initialize. */
export function printCloudAgentConnectedTip(): void {
  const col = c();
  console.log("");
  console.log(`${col.green("✔")} Agent connected.`);
  console.log("  Open a new Claude conversation and say:");
  console.log(`       ${col.cyan("Help me configure my site")}`);
  console.log("");
}

export function printLocalAgentInstructions(opts: {
  siteUrl: string;
  mcpUrl: string;
  token: string;
  tunnelFailed?: boolean;
}): void {
  const col = c();
  console.log("");
  if (opts.tunnelFailed) {
    console.log(
      col.yellow(
        "We couldn’t open a public link for Claude.ai. You can still connect a local agent (Cursor / Claude Code):",
      ),
    );
    console.log("");
  }
  console.log(`${col.green("✔")} Your site is running at ${col.bold(opts.siteUrl)}`);
  console.log("");
  console.log(col.bold("Connect Cursor or Claude Code:"));
  console.log("  1. Add an HTTP MCP server with this URL:");
  console.log(`       ${col.cyan(opts.mcpUrl)}`);
  console.log("  2. Use this secret as the auth token");
  console.log("     (Authorization: Bearer … or X-Api-Key):");
  console.log(`       ${col.magenta(opts.token)}`);
  console.log("  3. Save and chat with the agent against your site.");
  console.log("");
  console.log(
    col.dim("Need a new secret later? Stop Weblify, then run: npx weblify token"),
  );
  console.log("");
}

/** After Cursor / Claude Code completes MCP initialize. */
export function printLocalAgentConnectedTip(): void {
  const col = c();
  console.log("");
  console.log(`${col.green("✔")} Agent connected.`);
  console.log("  In Cursor or Claude Code, start a chat and say:");
  console.log(`       ${col.cyan("Help me configure my site")}`);
  console.log("");
}

/** Standalone `weblify token` — dual-use staff + MCP. */
export function printTokenInstructions(opts: { token: string }): void {
  const col = c();
  console.log("");
  console.log(`${col.green("✔")} New connection token:`);
  console.log(`       ${col.magenta(opts.token)}`);
  console.log("");
  console.log(col.bold("What this token is for:"));
  console.log("  • Staff sign-in — paste it into the Debug bubble token field on the site.");
  console.log("  • MCP — use it as the auth token for Cursor / Claude Code / Claude.ai");
  console.log("    (Authorization: Bearer …, X-Api-Key, or the connector wizard).");
  console.log("");
  console.log(col.dim("This replaces the previous token. Stop Weblify before minting if it is running."));
  console.log("");
}
