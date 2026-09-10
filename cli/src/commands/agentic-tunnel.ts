import fs from "fs";
import path from "path";
import { ensureCloudflared, startQuickTunnel } from "../lib/cloudflared.js";
import { askText, canPrompt } from "../prompts.js";
import { appendEnvVar, readEnvFile } from "../lib/env-file.js";
import { warn } from "../lib/log.js";
import { prepareAgenticLocal, type LocalAgentResult } from "./agentic-local.js";
import type { ResolvedConfig } from "../types.js";
import type { ChildProcess } from "child_process";

export interface TunnelResult {
  publicOrigin: string | null;
  cloudConnector: string | null;
  child: ChildProcess | null;
  fellBackToLocal: boolean;
  /** Present when falling back to local agents (or tunnel disabled). */
  local: LocalAgentResult | null;
}

export async function runAgenticTunnel(
  config: ResolvedConfig,
  port: number,
): Promise<TunnelResult> {
  if (config.noMcpTunnel) {
    warn("Public link disabled (--no-mcp-tunnel). Using Cursor / Claude Code setup instead.");
    return {
      publicOrigin: null,
      cloudConnector: null,
      child: null,
      fellBackToLocal: true,
      local: prepareAgenticLocal(config, port),
    };
  }

  try {
    const env = readEnvFile(config.projectRoot);
    let tunnelToken = env.CLOUDFLARE_TUNNEL_TOKEN || process.env.CLOUDFLARE_TUNNEL_TOKEN;
    if (process.env.WEBLIFY_REQUIRE_TUNNEL_TOKEN === "1" && !tunnelToken) {
      if (canPrompt()) {
        tunnelToken = await askText(
          "Cloudflare tunnel token (from Zero Trust dashboard; leave empty for quick tunnel)",
          "",
        );
        if (tunnelToken) appendEnvVar(config.projectRoot, "CLOUDFLARE_TUNNEL_TOKEN", tunnelToken);
      }
    }

    const bin = await ensureCloudflared(config.projectRoot);
    const handle = await startQuickTunnel(bin, port);
    const origin = handle.publicOrigin.replace(/\/$/, "");
    // Session-only — do not write rotating trycloudflare hosts into .env
    process.env.SITE_URL = origin;
    process.env.PUBLIC_URL = origin;
    process.env.MCP_PUBLIC_URL = origin;

    const cloudConnector = `${origin}/mcp`;
    fs.mkdirSync(path.join(config.projectRoot, ".local"), { recursive: true });
    fs.writeFileSync(
      path.join(config.projectRoot, ".local", "last-mcp-tunnel-url"),
      `${cloudConnector}\n`,
    );

    return {
      publicOrigin: origin,
      cloudConnector,
      child: handle.child,
      fellBackToLocal: false,
      local: null,
    };
  } catch (err) {
    warn(`Could not open a public link: ${(err as Error).message}`);
    return {
      publicOrigin: null,
      cloudConnector: null,
      child: null,
      fellBackToLocal: true,
      local: prepareAgenticLocal(config, port),
    };
  }
}
