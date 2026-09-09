import { spawn, execFileSync, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { isWeblifyDebug } from "../../../shared/debug.js";
import { readEnvFile } from "../lib/env-file.js";
import { error as logError, info, warn } from "../lib/log.js";

export interface McpHandle {
  child: ChildProcess;
  publicOrigin: string;
  port: string;
}

function resolveMcpPort(projectEnv: Record<string, string>): string {
  return process.env.MCP_PORT?.trim() || projectEnv.MCP_PORT?.trim() || "3001";
}

type Listener = { pid: number; cmd: string };

/** macOS/Linux: who is listening on TCP port. */
function listTcpListeners(port: string): Listener[] {
  try {
    const out = execFileSync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp", "-Fc"],
      { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const listeners: Listener[] = [];
    let pid = 0;
    let cmd = "";
    for (const line of out.split("\n")) {
      if (line.startsWith("p")) {
        if (pid) listeners.push({ pid, cmd });
        pid = Number(line.slice(1)) || 0;
        cmd = "";
      } else if (line.startsWith("c")) {
        cmd = line.slice(1);
      }
    }
    if (pid) listeners.push({ pid, cmd });
    return listeners;
  } catch {
    return [];
  }
}

function looksLikeMcpServer(cmd: string): boolean {
  return /mcp-server/i.test(cmd);
}

function killPid(pid: number): void {
  try {
    process.kill(pid, "SIGTERM");
  } catch {
    /* already gone */
  }
}

/**
 * Agent sessions need OUR MCP with the correct SITE_URL.
 * If an old `npm run mcp` (or leftover weblify MCP) owns the port, stop it.
 * If something else owns it, fail with a clear message.
 */
export async function ensureMcpPortFree(port: string): Promise<void> {
  const existing = listTcpListeners(port);
  if (!existing.length) return;

  const mcpOnes = existing.filter((l) => looksLikeMcpServer(l.cmd));
  const others = existing.filter((l) => !looksLikeMcpServer(l.cmd));

  if (others.length) {
    const detail = others.map((l) => `pid ${l.pid} (${l.cmd || "unknown"})`).join(", ");
    throw new Error(
      `Port ${port} is already in use by ${detail}. Stop that process (or set MCP_PORT to a free port) and re-run weblify.`,
    );
  }

  info(`Port ${port} was in use by another MCP — stopping it so this session can own OAuth URLs.`);
  for (const l of mcpOnes) {
    killPid(l.pid);
    // Parent tsx wrapper often outlives the worker briefly; try parent too.
    try {
      const ppid = Number(
        execFileSync("ps", ["-p", String(l.pid), "-o", "ppid="], {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim(),
      );
      if (ppid > 1) {
        const pcmd = execFileSync("ps", ["-p", String(ppid), "-o", "command="], {
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        }).trim();
        if (/mcp-server|tsx.*mcp/i.test(pcmd)) killPid(ppid);
      }
    } catch {
      /* ignore */
    }
  }

  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    if (!listTcpListeners(port).length) return;
    await new Promise((r) => setTimeout(r, 150));
  }

  const still = listTcpListeners(port);
  if (still.length) {
    throw new Error(
      `Could not free port ${port} (still held by pid ${still.map((s) => s.pid).join(", ")}). Stop \`npm run mcp\` in other terminals and retry.`,
    );
  }
}

/**
 * Start the MCP server so /mcp on the site process can proxy to it.
 * publicOrigin must be the URL Claude/Cursor will use (localhost or current tunnel).
 */
export async function startMcpServer(opts: {
  packageRoot: string;
  projectRoot: string;
  publicOrigin: string;
  /** Localhost / wizard connection token (WEBLIFY_CONNECTION_TOKEN). */
  connectionToken?: string;
  /** Fired once when MCP emits WEBLIFY_MCP_CONNECTED (first successful initialize). */
  onConnected?: () => void;
}): Promise<McpHandle> {
  const { packageRoot, projectRoot, publicOrigin, connectionToken, onConnected } = opts;
  const debug = isWeblifyDebug();
  const projectEnv = readEnvFile(projectRoot);
  const origin = publicOrigin.replace(/\/$/, "");
  const port = resolveMcpPort(projectEnv);

  await ensureMcpPortFree(port);

  const mcpEntry = path.join(packageRoot, "mcp-server", "index.ts");
  const tsxBin = path.join(packageRoot, "node_modules", ".bin", "tsx");
  const runner = fs.existsSync(tsxBin) ? tsxBin : "npx";
  const args = fs.existsSync(tsxBin) ? [mcpEntry] : ["tsx", mcpEntry];

  const secret =
    process.env.MCP_SERVER_SECRET?.trim() ||
    projectEnv.MCP_SERVER_SECRET?.trim() ||
    process.env.MCP_API_KEY?.trim() ||
    projectEnv.MCP_API_KEY?.trim();

  if (!secret) {
    throw new Error(
      "MCP_SERVER_SECRET is missing. Re-run weblify so .env is created, or set MCP_SERVER_SECRET.",
    );
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    ...projectEnv,
    WEBLIFY_PROJECT_ROOT: projectRoot,
    WEBLIFY_PACKAGE_ROOT: packageRoot,
    MCP_SERVER_SECRET: secret,
    MCP_PORT: port,
    // OAuth metadata must match the URL the client actually uses (rotating tunnel).
    SITE_URL: origin,
    PUBLIC_URL: origin,
    MCP_PUBLIC_URL: origin,
  };
  const token = connectionToken?.trim();
  if (token) {
    env.WEBLIFY_CONNECTION_TOKEN = token;
  }

  if (debug) {
    env.WEBLIFY_DEBUG = process.env.WEBLIFY_DEBUG?.trim() || "1";
  } else if (!env.LOG_LEVEL?.trim()) {
    env.LOG_LEVEL = "warn";
  }

  // Always pipe stdout so we can detect WEBLIFY_MCP_CONNECTED (even in debug).
  const child = spawn(runner, args, {
    // oauth client/token files live under packageRoot/mcp-server/data
    cwd: packageRoot,
    env,
    stdio: ["ignore", "pipe", debug ? "inherit" : "pipe"],
  });

  let connectedFired = false;
  const onStdout = (chunk: Buffer) => {
    const text = chunk.toString();
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      if (line === "WEBLIFY_MCP_CONNECTED") {
        if (!connectedFired && onConnected) {
          connectedFired = true;
          onConnected();
        }
        continue;
      }
      if (debug) {
        process.stdout.write(raw.endsWith("\n") ? raw : `${raw}\n`);
      }
    }
  };
  child.stdout?.on("data", onStdout);

  if (!debug) {
    const forwardErr = (chunk: Buffer) => {
      const text = chunk.toString();
      // Port conflicts are handled above; don't dump full Node stacks for noise.
      if (/EADDRINUSE/.test(text)) {
        logError(`MCP could not bind :${port} (still in use).`);
        return;
      }
      if (/FATAL|Error:|failed/i.test(text) && !/DeprecationWarning/i.test(text)) {
        process.stderr.write(text);
      }
    };
    child.stderr?.on("data", forwardErr);
  }
  child.on("error", (err) => logError(err.message));

  return { child, publicOrigin: origin, port };
}

export async function waitForMcpHealth(
  handle: McpHandle,
  timeoutMs = 20_000,
): Promise<void> {
  const { port, child } = handle;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (child.exitCode != null || child.killed) {
      throw new Error(
        `MCP exited before becoming healthy (code ${child.exitCode}). Is port ${port} free?`,
      );
    }
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`).catch(() => null);
      if (res?.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  warn(`MCP did not become healthy on :${port} within ${timeoutMs}ms; continuing anyway.`);
}

export function stopMcpServer(handle: McpHandle | null | undefined): void {
  if (!handle?.child) return;
  try {
    handle.child.kill("SIGTERM");
  } catch {
    /* ignore */
  }
}
