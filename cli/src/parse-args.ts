import type { CliFlags } from "./types.js";
import { applyDebugFromArgv, isWeblifyDebug } from "../../shared/debug.js";

export function parseArgs(argv: string[]): CliFlags {
  applyDebugFromArgv(argv);

  const flags: CliFlags = {
    production: false,
    agenticInstallation: false,
    noMcpTunnel: false,
    command: null,
    yes: false,
    help: false,
    debug: isWeblifyDebug(argv),
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--help" || a === "-h") flags.help = true;
    else if (a === "--production") flags.production = true;
    else if (a === "--agentic-installation") flags.agenticInstallation = true;
    else if (a === "--no-mcp-tunnel") flags.noMcpTunnel = true;
    else if (a === "--debug") flags.debug = true;
    else if (a === "--yes" || a === "-y") flags.yes = true;
    else if (a === "--name" && argv[i + 1]) flags.name = argv[++i];
    else if (a.startsWith("--name=")) flags.name = a.slice("--name=".length);
    else if (a === "--slug" && argv[i + 1]) flags.slug = argv[++i];
    else if (a.startsWith("--slug=")) flags.slug = a.slice("--slug=".length);
    else if (a === "--agent" && argv[i + 1]) {
      const v = argv[++i].toLowerCase();
      if (v === "local" || v === "cloud") flags.agent = v;
    } else if (a.startsWith("--agent=")) {
      const v = a.slice("--agent=".length).toLowerCase();
      if (v === "local" || v === "cloud") flags.agent = v;
    } else if (!a.startsWith("-") && flags.command === null && a === "token") {
      flags.command = "token";
    }
  }

  if (process.env.WEBLIFY_MCP_TUNNEL === "0") flags.noMcpTunnel = true;
  if (flags.debug) {
    process.env.WEBLIFY_DEBUG = "1";
  }
  return flags;
}

export function printHelp(): void {
  console.log(`
weblify — agentic CMS runtime

Usage:
  npx weblify [options]
  npx weblify token

Quiet by default. Use --debug or DEBUG=true for full engine logs.

Commands:
  token                     Mint a new connection token and print how to use it (staff + MCP)

Options (all optional):
  --production              Production mode (no agentic / no tunnel; require SITE_URL)
  --agentic-installation    Skip "want an agent?" (still asks Local vs Cloud unless --agent)
  --agent local|cloud       Choose agent path without prompting
  --no-mcp-tunnel           Never start Cloudflare tunnel
  --debug                   Full engine / Vite logs (same as DEBUG=true)
  --name <name>             Display name when creating a site
  --slug <slug>             Content folder slug (site_<slug>) when creating
  --yes, -y                 Accept safe defaults when non-interactive allows
  --help, -h                Show this help

Environment:
  WEBLIFY_PROJECT_ROOT      Site project directory (default: cwd)
  WEBLIFY_PACKAGE_ROOT      Engine install directory
  WEBLIFY_MODE=production   Same as --production
  WEBLIFY_MCP_TUNNEL=0      Same as --no-mcp-tunnel
  DEBUG=true|1             Full engine logs (not DEBUG=namespace:*)
  WEBLIFY_DEBUG=true|1     Same as DEBUG=true
`);
}
