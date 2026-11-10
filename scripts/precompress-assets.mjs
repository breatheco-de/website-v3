/**
 * Writes `file.br` and `file.gz` next to compressible files in dist/public so the
 * server (server/static-precompressed.ts) or nginx (brotli_static / gzip_static)
 * can send them without compressing per request.
 *
 * Usage: node scripts/precompress-assets.mjs [dir]
 */
import fs from "fs/promises";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { promisify } from "util";
import zlib from "zlib";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = path.resolve(process.argv[2] || path.join(root, "dist", "public"));

/** Keep in sync with PRECOMPRESSED_EXTENSIONS in server/static-precompressed.ts. */
const EXTENSIONS = new Set([".js", ".mjs", ".css", ".svg", ".json", ".txt", ".xml", ".ttf"]);
const MIN_BYTES = 1024;
/** Rendered per request from this template, never sent as a static file. */
const SKIP_FILES = new Set(["index.html"]);

const brotli = promisify(zlib.brotliCompress);
const gzip = promisify(zlib.gzip);

async function walk(current, out) {
  for (const entry of await fs.readdir(current, { withFileTypes: true })) {
    const full = path.join(current, entry.name);
    if (entry.isDirectory()) await walk(full, out);
    else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name)) && !SKIP_FILES.has(entry.name)) out.push(full);
  }
  return out;
}

async function isFresh(target, sourceMtime) {
  try {
    return (await fs.stat(target)).mtimeMs >= sourceMtime;
  } catch {
    return false;
  }
}

async function precompress(file) {
  const stat = await fs.stat(file);
  if (stat.size < MIN_BYTES) return { file, skipped: true };
  const [brFresh, gzFresh] = await Promise.all([
    isFresh(`${file}.br`, stat.mtimeMs),
    isFresh(`${file}.gz`, stat.mtimeMs),
  ]);
  if (brFresh && gzFresh) return { file, skipped: true };
  const raw = await fs.readFile(file);
  const [br, gz] = await Promise.all([
    brFresh
      ? null
      : brotli(raw, {
          params: {
            [zlib.constants.BROTLI_PARAM_QUALITY]: 11,
            [zlib.constants.BROTLI_PARAM_SIZE_HINT]: raw.length,
          },
        }),
    gzFresh ? null : gzip(raw, { level: 9 }),
  ]);
  if (br) await fs.writeFile(`${file}.br`, br);
  if (gz) await fs.writeFile(`${file}.gz`, gz);
  return { file, skipped: false, raw: raw.length, br: br?.length ?? 0 };
}

async function main() {
  try {
    await fs.access(dir);
  } catch {
    console.error("precompress-assets: missing directory", dir);
    process.exit(1);
  }
  const started = Date.now();
  const files = await walk(dir, []);
  const queue = [...files];
  const concurrency = Math.max(2, Math.min(8, os.availableParallelism?.() ?? os.cpus().length));
  let written = 0;
  let rawBytes = 0;
  let brBytes = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const result = await precompress(queue.shift());
        if (result.skipped) continue;
        written += 1;
        rawBytes += result.raw;
        brBytes += result.br;
      }
    }),
  );
  const mb = (n) => (n / (1024 * 1024)).toFixed(1);
  console.log(
    `precompress-assets: ${written} of ${files.length} files in ${((Date.now() - started) / 1000).toFixed(1)}s` +
      (written ? ` (${mb(rawBytes)} MB -> ${mb(brBytes)} MB brotli)` : ""),
  );
}

main().catch((err) => {
  console.error("precompress-assets failed", err);
  process.exit(1);
});
