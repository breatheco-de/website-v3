/**
 * Serves the `.br` / `.gz` copies written by scripts/precompress-assets.mjs so static
 * files are not compressed per request. Only files found under `root` at startup are
 * served; anything else (or `identity`) falls through to express.static + compression().
 */

import fs from "fs";
import path from "path";
import type { RequestHandler } from "express";
import { pickCachedEncoding } from "./html-page-cache";

/** Keep in sync with EXTENSIONS in scripts/precompress-assets.mjs. */
export const PRECOMPRESSED_EXTENSIONS = new Set([".js", ".mjs", ".css", ".svg", ".json", ".txt", ".xml", ".ttf"]);

type Copies = { br: boolean; gzip: boolean };

/** URL path (`/assets/a.js`) → which compressed copies exist on disk. */
export function scanPrecompressed(root: string): Map<string, Copies> {
  const found = new Map<string, Copies>();
  const walk = (dir: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    const names = new Set(entries.map((e) => e.name));
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile() || !PRECOMPRESSED_EXTENSIONS.has(path.extname(entry.name))) continue;
      const br = names.has(`${entry.name}.br`);
      const gzip = names.has(`${entry.name}.gz`);
      if (!br && !gzip) continue;
      const urlPath = "/" + path.relative(root, full).split(path.sep).join("/");
      found.set(urlPath, { br, gzip });
    }
  };
  walk(root);
  return found;
}

export function precompressedStatic(root: string): RequestHandler {
  const absRoot = path.resolve(root);
  const copies = scanPrecompressed(absRoot);
  return (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    let urlPath: string;
    try {
      urlPath = decodeURIComponent(req.path);
    } catch {
      return next();
    }
    const available = copies.get(urlPath);
    if (!available) return next();
    const encoding = pickCachedEncoding(req.headers["accept-encoding"]);
    res.vary("Accept-Encoding");
    if (encoding === "identity" || !available[encoding]) return next();

    const file = path.join(absRoot, `${urlPath}.${encoding === "br" ? "br" : "gz"}`);
    res.type(path.extname(urlPath));
    res.setHeader("Content-Encoding", encoding);
    res.sendFile(file, { acceptRanges: false, dotfiles: "deny" }, (err) => {
      if (!err) return;
      if (res.headersSent) return next(err);
      res.removeHeader("Content-Encoding");
      res.removeHeader("Content-Type");
      next();
    });
  };
}
