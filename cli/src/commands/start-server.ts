import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import { isWeblifyDebug } from "../../../shared/debug.js";
import { error as logError, info, warn } from "../lib/log.js";
import { WEBLIFY_DEFAULT_PORT, isAirplayConflictPort } from "../lib/local-url.js";
import type { ResolvedConfig } from "../types.js";

export interface ServerHandle {
  child: ChildProcess;
  port: number;
}

function readPort(projectRoot: string): number {
  const envPath = path.join(projectRoot, ".env");
  if (fs.existsSync(envPath)) {
    const m = fs.readFileSync(envPath, "utf-8").match(/^PORT=(\d+)/m);
    if (m) return Number(m[1]);
  }
  return Number(process.env.PORT) || WEBLIFY_DEFAULT_PORT;
}

/** Forward only warn/error-ish lines from a quiet child; drop INFO / Vite / deprecation noise. */
function attachQuietStdio(child: ChildProcess): void {
  const forward = (chunk: Buffer, toErr: boolean) => {
    const text = chunk.toString();
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trimEnd();
      if (!line) continue;
      if (shouldForwardChildLine(line)) {
        if (toErr) process.stderr.write(line + "\n");
        else process.stdout.write(line + "\n");
      }
    }
  };
  child.stdout?.on("data", (c: Buffer) => forward(c, false));
  child.stderr?.on("data", (c: Buffer) => forward(c, true));
}

function shouldForwardChildLine(line: string): boolean {
  if (/DeprecationWarning|punycode|ExperimentalWarning/i.test(line)) return false;
  if (/\[vite\]|\(client\)|Re-optimizing|bundling dependencies|optimizer/i.test(line)) return false;
  if (/Both esbuild and oxc/i.test(line)) return false;
  // pino-pretty INFO lines look like: [19:07:12] INFO:
  if (/\bINFO\b/.test(line) && !/\b(ERROR|WARN|WARNING|FATAL)\b/i.test(line)) return false;
  if (/\bDEBUG\b/.test(line) && !/\b(ERROR|WARN|WARNING|FATAL)\b/i.test(line)) return false;
  if (/\b(ERROR|WARN|WARNING|FATAL|Error:|failed|unavailable)\b/i.test(line)) return true;
  // Staff one-liners from server (console.warn without pino)
  if (/^(Background jobs unavailable|Media impression tracking unavailable)\.?$/i.test(line.trim())) {
    return true;
  }
  return false;
}

/**
 * Start the Weblify server.
 * Production: prefer scripts/start-production.sh (Stage A parity).
 * Dev: tsx server/index.ts from PACKAGE_ROOT with PROJECT_ROOT cwd.
 *
 * @param opts.clearPublicUrl — drop SITE_URL/PUBLIC_URL/MCP_PUBLIC_URL so a stale
 *   trycloudflare hostname from .env does not poison OAuth (Cloud agent path).
 * @param opts.publicOrigin — force SITE_URL/PUBLIC_URL/MCP_PUBLIC_URL for this process.
 */
export async function startServer(
  config: ResolvedConfig,
  opts: { clearPublicUrl?: boolean; publicOrigin?: string } = {},
): Promise<ServerHandle> {
  const { projectRoot, packageRoot, isProduction } = config;
  const port = readPort(projectRoot);
  const debug = isWeblifyDebug();

  maybeWarnVersionSkew(projectRoot, packageRoot);

  if (isAirplayConflictPort(port)) {
    warn(
      `Port ${port} often conflicts with macOS AirPlay. Open http://127.0.0.1:${port} (not localhost), or set PORT=5050 in .env.`,
    );
  }

  const env: NodeJS.ProcessEnv = {
    ...process.env,
    WEBLIFY_PROJECT_ROOT: projectRoot,
    WEBLIFY_PACKAGE_ROOT: packageRoot,
    PORT: String(port),
  };
  if (opts.clearPublicUrl) {
    delete env.SITE_URL;
    delete env.PUBLIC_URL;
    delete env.MCP_PUBLIC_URL;
  }
  if (opts.publicOrigin?.trim()) {
    const origin = opts.publicOrigin.replace(/\/$/, "");
    env.SITE_URL = origin;
    env.PUBLIC_URL = origin;
    env.MCP_PUBLIC_URL = origin;
  }
  if (process.env.WEBLIFY_CONNECTION_TOKEN?.trim()) {
    env.WEBLIFY_CONNECTION_TOKEN = process.env.WEBLIFY_CONNECTION_TOKEN.trim();
  }
  if (debug) {
    env.WEBLIFY_DEBUG = process.env.WEBLIFY_DEBUG?.trim() || "1";
  } else if (!env.LOG_LEVEL?.trim()) {
    env.LOG_LEVEL = "warn";
  }

  let child: ChildProcess;

  if (isProduction) {
    const startSh = path.join(packageRoot, "scripts", "start-production.sh");
    if (fs.existsSync(startSh)) {
      info("Starting production bootstrap (start-production.sh)…");
      child = spawn("bash", [startSh], {
        cwd: projectRoot,
        env: { ...env, NODE_ENV: "production" },
        stdio: "inherit",
      });
    } else {
      const entry = path.join(packageRoot, "dist", "index.js");
      if (!fs.existsSync(entry)) {
        throw new Error(`Production entry not found: ${entry} (run npm run build first)`);
      }
      child = spawn(process.execPath, [entry], {
        cwd: projectRoot,
        env: { ...env, NODE_ENV: "production" },
        stdio: "inherit",
      });
    }
  } else {
    const serverEntry = path.join(packageRoot, "server", "index.ts");
    const tsxBin = path.join(packageRoot, "node_modules", ".bin", "tsx");
    const runner = fs.existsSync(tsxBin) ? tsxBin : "npx";
    const args = fs.existsSync(tsxBin)
      ? [serverEntry]
      : ["tsx", serverEntry];
    child = spawn(runner, args, {
      cwd: projectRoot,
      env: {
        ...env,
        NODE_ENV: "development",
      },
      stdio: debug ? "inherit" : ["inherit", "pipe", "pipe"],
    });
    if (!debug) {
      attachQuietStdio(child);
      child.on("error", (err) => {
        logError(err.message);
      });
    }
  }

  return { child, port };
}

function maybeWarnVersionSkew(projectRoot: string, packageRoot: string): void {
  try {
    const createdPath = path.join(projectRoot, ".local", "created-with.json");
    const pkg = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf-8"));
    const current = String(pkg.version || "");
    if (!fs.existsSync(createdPath) || !current) return;
    const created = JSON.parse(fs.readFileSync(createdPath, "utf-8")) as { weblify?: string };
    if (created.weblify && created.weblify !== current) {
      const [aMaj] = created.weblify.split(".");
      const [bMaj] = current.split(".");
      if (aMaj !== bMaj) {
        warn(
          `Warning: this project was created with weblify ${created.weblify}; engine is now ${current}. Pin versions in production.`,
        );
      }
    }
  } catch {
    /* ignore */
  }
}

export async function waitForLocalServer(port: number, timeoutMs = 60_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`).catch(() => null);
      if (res && (res.ok || res.status === 404)) return;
      const root = await fetch(`http://127.0.0.1:${port}/`).catch(() => null);
      if (root) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  warn(`Server did not respond on :${port} within ${timeoutMs}ms; continuing anyway.`);
}
