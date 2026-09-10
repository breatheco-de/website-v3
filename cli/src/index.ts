import fs from "fs";
import path from "path";
import * as p from "@clack/prompts";
import { parseArgs, printHelp } from "./parse-args.js";
import { resolveConfig } from "./resolve-config.js";
import { createProject } from "./commands/create-project.js";
import { startServer, waitForLocalServer } from "./commands/start-server.js";
import {
  startMcpServer,
  stopMcpServer,
  waitForMcpHealth,
  type McpHandle,
} from "./commands/start-mcp.js";
import { prepareAgenticLocal } from "./commands/agentic-local.js";
import { runAgenticTunnel } from "./commands/agentic-tunnel.js";
import { runTokenCommand } from "./commands/token.js";
import { ensureEnvFile } from "./lib/env-file.js";
import { localOrigin } from "./lib/local-url.js";
import {
  banner,
  error,
  printCloudAgentConnectedTip,
  printCloudAgentInstructions,
  printLocalAgentConnectedTip,
  printLocalAgentInstructions,
  printSiteOnly,
} from "./lib/log.js";
import { loadDotenv } from "./lib/load-dotenv.js";
import { PromptCancelled } from "./prompts.js";

async function main(): Promise<void> {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    printHelp();
    process.exit(0);
  }

  let config;
  try {
    const cwd = process.env.WEBLIFY_PROJECT_ROOT || process.cwd();
    loadDotenv(path.join(cwd, ".env"));
    config = await resolveConfig(flags);
  } catch (e) {
    if (e instanceof PromptCancelled) process.exit(0);
    error((e as Error).message);
    process.exit(1);
  }

  const version = readVersion(config.packageRoot);
  banner(version);

  if (config.isProduction) {
    const siteUrl = process.env.SITE_URL?.trim();
    if (!siteUrl) {
      error("Production requires SITE_URL in the environment or project .env");
      process.exit(1);
    }
  }

  if (config.command === "token") {
    if (config.detect.kind !== "project") {
      error("token requires an existing Weblify project (sites.yml).");
      process.exit(1);
    }
    runTokenCommand(config.projectRoot);
    process.exit(0);
  }

  try {
    if (config.detect.kind === "empty") {
      await createProject(config);
      p.log.success("Created site folder and sites.yml");
    } else {
      ensureEnvFile(config.projectRoot);
    }
  } catch (e) {
    if (e instanceof PromptCancelled) process.exit(0);
    error((e as Error).message);
    process.exit(1);
  }

  const needsLocalToken =
    !config.isProduction && config.wantAgent && config.agentChoice === "local";
  if (needsLocalToken) {
    const { mintConnectionToken } = await import("./lib/connection-token.js");
    mintConnectionToken(config.projectRoot);
  }

  const isCloudAgent =
    !config.isProduction && config.wantAgent && config.agentChoice === "cloud";

  let server;
  try {
    if (config.isProduction) {
      server = await startServer(config);
    } else {
      const spin = p.spinner();
      spin.start("Starting your site…");
      try {
        // Cloud: ignore stale trycloudflare SITE_URL from .env until tunnel is up
        server = await startServer(config, { clearPublicUrl: isCloudAgent });
        spin.stop(`Site available at ${localOrigin(server.port)}`);
      } catch (e) {
        spin.stop("Failed to start");
        throw e;
      }
    }
  } catch (e) {
    error((e as Error).message);
    process.exit(2);
  }

  // Re-start site with correct localhost origin for local agent (optional; MCP gets the URL below)
  let mcp: McpHandle | null = null;
  let agentConnectedTipped = false;
  const onAgentConnected = (kind: "cloud" | "local") => {
    if (agentConnectedTipped) return;
    agentConnectedTipped = true;
    if (kind === "cloud") printCloudAgentConnectedTip();
    else printLocalAgentConnectedTip();
  };

  const stopAll = () => {
    stopMcpServer(mcp);
  };
  process.on("SIGINT", stopAll);
  process.on("SIGTERM", stopAll);
  server.child.on("exit", () => {
    stopMcpServer(mcp);
  });

  if (!config.isProduction) {
    await waitForLocalServer(server.port);
    const localSiteUrl = localOrigin(server.port);

    if (config.wantAgent) {
      if (config.agentChoice === "cloud") {
        const tunnelSpin = p.spinner();
        tunnelSpin.start("Opening a public link for Claude.ai…");
        const tunnel = await runAgenticTunnel(config, server.port);
        if (tunnel.fellBackToLocal || !tunnel.cloudConnector || !tunnel.publicOrigin) {
          tunnelSpin.stop("Public link unavailable");
          const local = tunnel.local ?? prepareAgenticLocal(config, server.port);
          try {
            mcp = await startMcpServer({
              packageRoot: config.packageRoot,
              projectRoot: config.projectRoot,
              publicOrigin: localSiteUrl,
              connectionToken: local.token,
              onConnected: () => onAgentConnected("local"),
            });
            await waitForMcpHealth(mcp);
          } catch (e) {
            error((e as Error).message);
          }
          printLocalAgentInstructions({
            siteUrl: localSiteUrl,
            mcpUrl: local.mcpUrl,
            token: local.token,
            tunnelFailed: true,
          });
        } else {
          tunnelSpin.stop("Public link ready");
          if (tunnel.child) {
            const stopTunnel = () => {
              try {
                tunnel.child?.kill("SIGTERM");
              } catch {
                /* ignore */
              }
            };
            process.on("SIGINT", stopTunnel);
            process.on("SIGTERM", stopTunnel);
            server.child.on("exit", stopTunnel);
          }

          const local = prepareAgenticLocal(config, server.port);
          const mcpSpin = p.spinner();
          mcpSpin.start("Configuring MCP for this public link…");
          try {
            stopMcpServer(mcp);
            mcp = await startMcpServer({
              packageRoot: config.packageRoot,
              projectRoot: config.projectRoot,
              publicOrigin: tunnel.publicOrigin,
              connectionToken: local.token,
              onConnected: () => onAgentConnected("cloud"),
            });
            await waitForMcpHealth(mcp);
            mcpSpin.stop("MCP ready for Claude.ai");
          } catch (e) {
            mcpSpin.stop("MCP failed to start");
            error((e as Error).message);
          }

          printCloudAgentInstructions({
            siteUrl: localSiteUrl,
            connectorUrl: tunnel.cloudConnector,
            token: local.token,
          });
        }
      } else {
        const local = prepareAgenticLocal(config, server.port);
        try {
          mcp = await startMcpServer({
            packageRoot: config.packageRoot,
            projectRoot: config.projectRoot,
            publicOrigin: localSiteUrl,
            connectionToken: local.token,
            onConnected: () => onAgentConnected("local"),
          });
          await waitForMcpHealth(mcp);
        } catch (e) {
          error((e as Error).message);
        }
        printLocalAgentInstructions({
          siteUrl: localSiteUrl,
          mcpUrl: local.mcpUrl,
          token: local.token,
        });
      }
    } else {
      printSiteOnly({ siteUrl: localSiteUrl });
    }
  }

  server.child.on("exit", (code) => {
    stopMcpServer(mcp);
    process.exit(code ?? 0);
  });
}

function readVersion(packageRoot: string): string {
  try {
    return JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf-8")).version;
  } catch {
    return "0.0.0";
  }
}

main().catch((e) => {
  if (e instanceof PromptCancelled) process.exit(0);
  error(e?.stack || String(e));
  process.exit(2);
});
