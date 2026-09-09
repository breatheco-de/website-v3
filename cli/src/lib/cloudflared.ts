import { spawn, type ChildProcess } from "child_process";
import fs from "fs";
import path from "path";
import https from "https";
import { localDir } from "./connection-token.js";

const URL_RE = /https:\/\/[a-zA-Z0-9.-]+\.trycloudflare\.com|https:\/\/[a-zA-Z0-9._~:/?#\[\]@!$&'()*+,;=%-]+/g;

export async function ensureCloudflared(projectRoot: string): Promise<string> {
  const fromPath = which("cloudflared");
  if (fromPath) return fromPath;

  const binDir = path.join(localDir(projectRoot), "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const dest = path.join(binDir, process.platform === "win32" ? "cloudflared.exe" : "cloudflared");
  if (fs.existsSync(dest)) return dest;

  const url = cloudflaredDownloadUrl();
  if (!url) {
    throw new Error(
      "cloudflared not found and no download URL for this platform. Install cloudflared and ensure it is on PATH.",
    );
  }
  console.log("Downloading cloudflared…");
  await downloadFile(url, dest);
  fs.chmodSync(dest, 0o755);
  return dest;
}

function which(cmd: string): string | null {
  const pathEnv = process.env.PATH || "";
  for (const dir of pathEnv.split(path.delimiter)) {
    const candidate = path.join(dir, cmd);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

function cloudflaredDownloadUrl(): string | null {
  const { platform, arch } = process;
  if (platform === "darwin" && arch === "arm64") {
    return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-arm64.tgz";
  }
  if (platform === "darwin" && arch === "x64") {
    return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-darwin-amd64.tgz";
  }
  if (platform === "linux" && arch === "x64") {
    return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64";
  }
  if (platform === "linux" && arch === "arm64") {
    return "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64";
  }
  return null;
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const tmp = `${dest}.download`;
    const file = fs.createWriteStream(tmp);
    https
      .get(url, { headers: { "User-Agent": "weblify-cli" } }, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlinkSync(tmp);
          downloadFile(res.headers.location, dest).then(resolve, reject);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on("finish", () => {
          file.close();
          // tgz on mac: extract
          if (url.endsWith(".tgz")) {
            import("child_process").then(({ execSync }) => {
              try {
                execSync(`tar -xzf "${tmp}" -C "${path.dirname(dest)}"`, { stdio: "ignore" });
                const extracted = path.join(path.dirname(dest), "cloudflared");
                if (extracted !== dest && fs.existsSync(extracted)) {
                  fs.renameSync(extracted, dest);
                }
                fs.unlinkSync(tmp);
                resolve();
              } catch (e) {
                reject(e);
              }
            });
          } else {
            fs.renameSync(tmp, dest);
            resolve();
          }
        });
      })
      .on("error", reject);
  });
}

export interface TunnelHandle {
  child: ChildProcess;
  publicOrigin: string;
}

export function startQuickTunnel(
  cloudflaredBin: string,
  localPort: number,
  timeoutMs = 45_000,
): Promise<TunnelHandle> {
  return new Promise((resolve, reject) => {
    const child = spawn(cloudflaredBin, ["tunnel", "--url", `http://127.0.0.1:${localPort}`], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let settled = false;
    const buf: string[] = [];

    const onData = (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      buf.push(text);
      const joined = buf.join("");
      const matches = joined.match(URL_RE);
      if (matches) {
        for (const m of matches) {
          if (m.includes("trycloudflare.com") || (!m.includes("cloudflare.com/") && m.startsWith("https://"))) {
            if (m.includes("api.trycloudflare") || m.includes("update.cloudflare")) continue;
            if (!settled && /https:\/\/[a-z0-9-]+\.(trycloudflare\.com)/i.test(m)) {
              settled = true;
              resolve({ child, publicOrigin: m.replace(/\/$/, "") });
              return;
            }
          }
        }
      }
    };

    child.stdout?.on("data", onData);
    child.stderr?.on("data", onData);
    child.on("error", (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });
    child.on("exit", (code) => {
      if (!settled) {
        settled = true;
        reject(new Error(`cloudflared exited early (code ${code}). Output:\n${buf.join("")}`));
      }
    });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        try {
          child.kill("SIGTERM");
        } catch {
          /* ignore */
        }
        reject(new Error(`Timed out waiting for Cloudflare tunnel URL.\n${buf.join("")}`));
      }
    }, timeoutMs);
  });
}

export function parsePublicOriginFromOutput(text: string): string | null {
  const matches = text.match(URL_RE);
  if (!matches) return null;
  for (const m of matches) {
    if (/https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.test(m)) return m.replace(/\/$/, "");
  }
  return null;
}
