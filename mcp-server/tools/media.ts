/**
 * MCP gallery resolve / ingest: get_or_set_media_to_gallery
 */

import fs from "fs";
import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { checkCap, denyResponse, denyUnlessContentView } from "../lib/auth.js";
import {
  ok,
  fail,
  actionRequired,
  type McpWarning,
  type NextAction,
  type McpSideEffect,
  type McpTextResult,
} from "../lib/respond.js";
import { resolveSiteContext } from "../lib/content.js";
import { getTokenUsername } from "../lib/oauth.js";
import { SITE_PARAM_DESC, siteFailResult } from "../lib/entry-helpers.js";
import type { CatalogGrant } from "../lib/tool-catalog.js";
import { AI_IMAGE_GC_GRACE_MS, normalizePromptAlt } from "../../shared/ai-image-gc.js";
import type { ImageEntry } from "../../shared/schema.js";
import {
  buildRegistrySrcToIdMap,
  resolveRegistryReference,
} from "../../scripts/validation/shared/imageRegistrySrc.js";
import {
  MEDIA_EXTENSIONS,
  extensionFromPath,
  inferDoctypeFromFilename,
  defaultAltForDoctype,
} from "../../shared/media-doctype.js";
import { isPrivateDestination } from "../../shared/ssrf.js";

const MAIN_SERVER_PORT = process.env.PORT || "5000";
const INTERNAL_SECRET = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";

/** Decoded base64 payload cap (MCP tool args). */
export const BYTES_MAX_BYTES = 15 * 1024 * 1024;
/** URL import download body cap. */
export const URL_FETCH_MAX_BYTES = 50 * 1024 * 1024;
const MAX_REDIRECTS = 10;

const MIME_TO_EXT: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "image/avif": ".avif",
  "image/gif": ".gif",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "video/quicktime": ".mov",
  "video/ogg": ".ogg",
  "video/x-m4v": ".m4v",
  "application/pdf": ".pdf",
};

const EXT_TO_MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".ogg": "video/ogg",
  ".m4v": "video/x-m4v",
  ".pdf": "application/pdf",
};

function internalHeaders(mcpToken?: string, omitJsonContentType = false): Record<string, string> {
  const headers: Record<string, string> = {};
  if (!omitJsonContentType) {
    headers["Content-Type"] = "application/json";
  }
  if (INTERNAL_SECRET) {
    headers.Authorization = `Bearer ${INTERNAL_SECRET}`;
    const username = mcpToken ? getTokenUsername(mcpToken) : undefined;
    headers["x-mcp-author"] = username || "mcp";
  } else if (mcpToken) {
    const username = getTokenUsername(mcpToken);
    if (username) headers["x-mcp-author"] = username;
  }
  return headers;
}

function siteQuery(domain: string | null): string {
  return domain ? `?__site=${encodeURIComponent(domain)}` : "";
}

export type GalleryMediaSource = "media_id" | "url" | "prompt" | "bytes_base64";

/** Count which of the mutually exclusive sources were provided. */
export function countGallerySources(args: {
  media_id?: string | null;
  url?: string | null;
  prompt?: string | null;
  bytes_base64?: string | null;
}): number {
  let n = 0;
  if (typeof args.media_id === "string" && args.media_id.trim()) n++;
  if (typeof args.url === "string" && args.url.trim()) n++;
  if (typeof args.prompt === "string" && args.prompt.trim()) n++;
  if (typeof args.bytes_base64 === "string" && args.bytes_base64.trim()) n++;
  return n;
}

export function pickGallerySource(args: {
  media_id?: string | null;
  url?: string | null;
  prompt?: string | null;
  bytes_base64?: string | null;
}): GalleryMediaSource | null {
  if (typeof args.media_id === "string" && args.media_id.trim()) return "media_id";
  if (typeof args.url === "string" && args.url.trim()) return "url";
  if (typeof args.prompt === "string" && args.prompt.trim()) return "prompt";
  if (typeof args.bytes_base64 === "string" && args.bytes_base64.trim()) return "bytes_base64";
  return null;
}

function registryRelativePath(contentFolder: string): string {
  return path.join(contentFolder, "image-registry.json").replace(/\\/g, "/");
}

function loadRegistryImages(
  contentPath: string,
): Record<string, ImageEntry> | null {
  const registryPath = path.join(contentPath, "image-registry.json");
  if (!fs.existsSync(registryPath)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(registryPath, "utf8")) as {
      images?: Record<string, ImageEntry>;
    };
    return raw.images && typeof raw.images === "object" ? raw.images : {};
  } catch {
    return null;
  }
}

/** Registry id for a gallery URL: matches entry.src (incl. full URLs) or source_url. */
export function findGalleryImageByUrl(
  url: string,
  images: Record<string, ImageEntry>,
): string | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  const srcToId = buildRegistrySrcToIdMap(images);
  const bySrc = resolveRegistryReference(trimmed, images, srcToId);
  if (bySrc) return bySrc;

  for (const [id, entry] of Object.entries(images)) {
    if (typeof entry.source_url === "string" && entry.source_url.trim() === trimmed) {
      return id;
    }
  }
  return null;
}

function extFromMediaType(mediaType: string): string {
  if (mediaType.includes("png")) return "png";
  if (mediaType.includes("jpeg") || mediaType.includes("jpg")) return "jpg";
  if (mediaType.includes("gif")) return "gif";
  return "webp";
}

function parseContentDispositionFilename(header: string | null): string | null {
  if (!header) return null;
  const utf8 = /filename\*=UTF-8''([^;]+)/i.exec(header);
  if (utf8?.[1]) {
    try {
      return decodeURIComponent(utf8[1].trim().replace(/^["']|["']$/g, ""));
    } catch {
      /* fall through */
    }
  }
  const plain = /filename=(?:"([^"]+)"|([^;]+))/i.exec(header);
  const raw = (plain?.[1] || plain?.[2] || "").trim();
  return raw || null;
}

function normalizeExt(ext: string): string {
  const e = ext.toLowerCase().startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`;
  return e === ".jpeg" ? ".jpg" : e;
}

/** Map Content-Type to a gallery extension, or null if not a known media type. */
export function extFromContentType(contentType: string | null): string | null {
  if (!contentType) return null;
  const base = contentType.split(";")[0]?.trim().toLowerCase() || "";
  if (!base || base === "application/octet-stream") return null;
  if (base === "text/html" || base.startsWith("text/")) return null;
  return MIME_TO_EXT[base] ?? null;
}

/**
 * Resolve filename + MIME for bytes about to be registered.
 * Rejects HTML / unknown types (strict).
 */
export function resolveMediaFileMeta(opts: {
  url?: string;
  filenameHint?: string | null;
  contentType?: string | null;
  bytes: Buffer;
}):
  | { ok: true; filename: string; mime: string; ext: string }
  | { ok: false; code: string; message: string } {
  const bytes = opts.bytes;
  const head = bytes.subarray(0, Math.min(64, bytes.length)).toString("utf8").trimStart();
  if (
    head.startsWith("<!DOCTYPE") ||
    head.startsWith("<!doctype") ||
    head.startsWith("<html") ||
    head.startsWith("<HTML")
  ) {
    return {
      ok: false,
      code: "unsupported_media",
      message: "Downloaded content looks like HTML, not a gallery media file.",
    };
  }

  let ext =
    (opts.filenameHint ? extensionFromPath(opts.filenameHint) : "") ||
    (opts.url ? extensionFromPath(opts.url) : "") ||
    extFromContentType(opts.contentType || null) ||
    "";

  if (ext) ext = normalizeExt(ext);

  if (!ext || !MEDIA_EXTENSIONS.has(ext)) {
    return {
      ok: false,
      code: "unsupported_media",
      message:
        "Could not resolve a supported media type (image, video, or PDF). Check the URL, filename, and Content-Type.",
    };
  }

  if (ext === ".pdf") {
    const magic = bytes.subarray(0, 5).toString("utf8");
    if (!magic.startsWith("%PDF")) {
      return {
        ok: false,
        code: "unsupported_media",
        message: "File is not a valid PDF (missing %PDF header).",
      };
    }
  }

  const baseName =
    (opts.filenameHint && path.basename(opts.filenameHint).replace(/[^\w.\-]+/g, "-")) ||
    (() => {
      if (!opts.url) return "";
      try {
        return path.basename(new URL(opts.url).pathname);
      } catch {
        return "";
      }
    })() ||
    `media${ext}`;
  const filename = extensionFromPath(baseName) ? baseName : `${baseName}${ext}`;
  const mime = EXT_TO_MIME[ext] || opts.contentType?.split(";")[0]?.trim() || "application/octet-stream";
  return { ok: true, filename, mime, ext };
}

export type FetchMediaResult =
  | { ok: true; bytes: Buffer; contentType: string | null; filenameHint: string | null; finalUrl: string }
  | { ok: false; code: string; message: string };

/**
 * Fetch a public media URL with per-hop SSRF checks and size cap.
 * Uses redirect:manual so each Location is validated.
 */
export async function fetchPublicMedia(
  startUrl: string,
  fetchFn: typeof fetch,
  maxBytes: number = URL_FETCH_MAX_BYTES,
): Promise<FetchMediaResult> {
  let current = startUrl.trim();
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (isPrivateDestination(current)) {
      return {
        ok: false,
        code: "ssrf_blocked",
        message: "URL points to a private or internal destination and cannot be fetched.",
      };
    }

    let res: Response;
    try {
      res = await fetchFn(current, {
        method: "GET",
        redirect: "manual",
        headers: { Accept: "*/*" },
      });
    } catch (e) {
      return {
        ok: false,
        code: "fetch_failed",
        message: `Failed to fetch URL (must be publicly downloadable): ${(e as Error).message}`,
      };
    }

    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get("location");
      if (!loc) {
        return { ok: false, code: "fetch_failed", message: "Redirect without Location header." };
      }
      try {
        current = new URL(loc, current).href;
      } catch {
        return { ok: false, code: "fetch_failed", message: `Invalid redirect Location: ${loc}` };
      }
      continue;
    }

    if (!res.ok) {
      return {
        ok: false,
        code: "fetch_failed",
        message: `URL returned HTTP ${res.status}. The file must be publicly downloadable (no login wall).`,
      };
    }

    const contentType = res.headers.get("content-type");
    const contentLength = res.headers.get("content-length");
    if (contentLength && Number(contentLength) > maxBytes) {
      return {
        ok: false,
        code: "too_large",
        message: `Remote file exceeds ${Math.round(maxBytes / (1024 * 1024))} MB URL import limit. Use staff gallery upload for larger files.`,
      };
    }

    const ab = await res.arrayBuffer();
    if (ab.byteLength === 0) {
      return { ok: false, code: "fetch_failed", message: "Remote file was empty." };
    }
    if (ab.byteLength > maxBytes) {
      return {
        ok: false,
        code: "too_large",
        message: `Remote file exceeds ${Math.round(maxBytes / (1024 * 1024))} MB URL import limit. Use staff gallery upload for larger files.`,
      };
    }

    const filenameHint = parseContentDispositionFilename(res.headers.get("content-disposition"));
    return {
      ok: true,
      bytes: Buffer.from(ab),
      contentType,
      filenameHint,
      finalUrl: current,
    };
  }

  return { ok: false, code: "fetch_failed", message: `Too many redirects (max ${MAX_REDIRECTS}).` };
}

async function parseGenerateImagesResponse(
  genRes: Response,
): Promise<
  | { ok: true; model?: string; candidates: Array<{ b64: string; mediaType: string }> }
  | { ok: false; status: number; code?: string; error?: string; hint?: string; retry_after_sec?: number }
> {
  if (genRes.status === 429) {
    const data = (await genRes.json().catch(() => ({}))) as {
      code?: string;
      error?: string;
      retry_after_sec?: number;
    };
    return {
      ok: false,
      status: 429,
      code: data.code || "rate_limited",
      error: data.error || "Image generation rate limit exceeded",
      retry_after_sec: data.retry_after_sec,
    };
  }

  const contentType = genRes.headers.get("content-type") || "";
  if (!genRes.ok && contentType.includes("application/json")) {
    const data = (await genRes.json().catch(() => ({}))) as {
      error?: string;
      hint?: string;
      code?: string;
      model?: string;
    };
    return {
      ok: false,
      status: genRes.status,
      code: data.code,
      error: data.error || data.hint,
      hint: data.hint,
    };
  }
  if (!genRes.ok) {
    return {
      ok: false,
      status: genRes.status,
      error: `Image generation failed (${genRes.status})`,
    };
  }

  if (contentType.includes("ndjson")) {
    const text = await genRes.text();
    const candidates: Array<{ b64: string; mediaType: string }> = [];
    let model: string | undefined;
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const event = JSON.parse(trimmed) as {
          type?: string;
          b64?: string;
          mediaType?: string;
          model?: string;
          error?: string;
        };
        if (event.type === "candidate" && event.b64) {
          candidates.push({
            b64: event.b64,
            mediaType: event.mediaType || "image/webp",
          });
          if (event.model) model = event.model;
        } else if (event.type === "done") {
          if (event.model) model = event.model;
        } else if (event.type === "error") {
          return {
            ok: false,
            status: 502,
            code: "image_generation_failed",
            error: event.error || "Image generation failed",
          };
        }
      } catch {
        /* skip bad lines */
      }
    }
    return { ok: true, model, candidates };
  }

  const data = (await genRes.json().catch(() => ({}))) as {
    model?: string;
    candidates?: Array<{ b64: string; mediaType: string }>;
  };
  return { ok: true, model: data.model, candidates: data.candidates ?? [] };
}

const NO_YAML_ATTACH: McpWarning = {
  code: "no_yaml_attach",
  message:
    "This tool does not write entry/section YAML. Call update_fields yourself. Returns media_id (not image_id). " +
    "Image section fields may still use the schema key image_id — pass the same id string. " +
    "PDF/downloadable fields usually need the public src URL.",
};

const AI_GC_WARNING: McpWarning = {
  code: "ai_gc_grace",
  message: `AI-generated gallery images that stay unused may be removed after about ${Math.round(AI_IMAGE_GC_GRACE_MS / (60 * 60 * 1000))} hours (grace from last public impression, else generation time). Attach the media_id to live content soon if you need to keep the asset.`,
};

const PUBLIC_URL_ONLY: McpWarning = {
  code: "public_url_only",
  message:
    "URL import fetches without cookies or auth headers. Gated Drive/Dropbox links fail — use bytes_base64 (≤15 MB) or staff gallery upload.",
};

export type GetOrSetMediaArgs = {
  media_id?: string;
  url?: string;
  prompt?: string;
  bytes_base64?: string;
  filename?: string;
  /** When true with url: fetch and register on miss (requires media_upload). */
  import?: boolean;
  alt?: string;
  tags?: string[];
  site?: string;
  aspect_ratio?: string;
};

type UploadOrigin = "upload" | "import" | "ai";

async function uploadBytesToGallery(opts: {
  fetchFn: typeof fetch;
  mcpToken?: string;
  q: string;
  bytes: Buffer;
  filename: string;
  mime: string;
  alt: string;
  origin: UploadOrigin;
  tags?: string[];
  sourceUrl?: string;
  ai?: { generated: true; model?: string; prompt?: string; generated_at?: string };
}): Promise<
  | { ok: true; id: string; src?: string; alt?: string; duplicate?: boolean; existingId?: string }
  | { ok: false; message: string; code: string }
> {
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(opts.bytes)], { type: opts.mime }),
    opts.filename,
  );
  form.append("alt", opts.alt);
  form.append("origin", opts.origin);
  if (opts.sourceUrl) form.append("source_url", opts.sourceUrl);
  if (opts.ai) form.append("ai", JSON.stringify(opts.ai));
  if (opts.tags && opts.tags.length > 0) {
    form.append("tags", JSON.stringify(opts.tags));
  }

  const uploadUrl = `http://localhost:${MAIN_SERVER_PORT}/api/image-registry/upload${opts.q}`;
  let uploadRes: Response;
  try {
    uploadRes = await opts.fetchFn(uploadUrl, {
      method: "POST",
      headers: internalHeaders(opts.mcpToken, true),
      body: form,
    });
  } catch (e) {
    return {
      ok: false,
      code: "upload_unreachable",
      message: `Failed to upload to gallery: ${(e as Error).message}`,
    };
  }

  const uploadData = (await uploadRes.json().catch(() => ({}))) as {
    error?: string;
    id?: string;
    src?: string;
    alt?: string;
    duplicate?: boolean;
    existingId?: string;
  };

  if (!uploadRes.ok || !uploadData.id) {
    return {
      ok: false,
      code: "upload_failed",
      message: uploadData.error || `Gallery upload failed (${uploadRes.status})`,
    };
  }

  return {
    ok: true,
    id: uploadData.id,
    src: uploadData.src,
    alt: uploadData.alt,
    duplicate: uploadData.duplicate,
    existingId: uploadData.existingId,
  };
}

function attachNextActions(mediaId: string, src?: string): NextAction[] {
  return [
    {
      tool: "update_fields",
      reason: "Attach this media to an entry or section field if needed",
      args_hint: {
        note: src
          ? `Use media_id "${mediaId}" for image_id schema fields, or src "${src}" for PDF/downloadable URL fields`
          : `Set the appropriate field to media_id "${mediaId}" (schema key may still be image_id)`,
      },
      priority: "recommended",
    },
  ];
}

/**
 * Core handler — exported for unit tests (pass fetchImpl to mock loopback).
 */
export async function handleGetOrSetMediaToGallery(
  args: GetOrSetMediaArgs,
  opts: {
    mcpToken?: string;
    grants?: CatalogGrant[];
    fetchImpl?: typeof fetch;
  } = {},
): Promise<McpTextResult> {
  const fetchFn = opts.fetchImpl ?? fetch;
  const mcpToken = opts.mcpToken;
  const grants = opts.grants;

  const sourceCount = countGallerySources(args);
  if (sourceCount === 0) {
    return fail("Provide exactly one of media_id, url, prompt, or bytes_base64.", {
      code: "pick_one_source",
    });
  }
  if (sourceCount > 1) {
    return fail("Provide exactly one of media_id, url, prompt, or bytes_base64 — not more than one.", {
      code: "pick_one_source",
    });
  }

  const source = pickGallerySource(args)!;
  const siteResult = resolveSiteContext(args.site);
  if (!siteResult.ok) {
    return siteFailResult(siteResult.error, "get_or_set_media_to_gallery", {
      ...(args.media_id ? { media_id: args.media_id } : {}),
      ...(args.url ? { url: args.url } : {}),
      ...(args.prompt ? { prompt: args.prompt } : {}),
      ...(args.bytes_base64 ? { bytes_base64: "(omitted)" } : {}),
    });
  }
  const { contentPath, contentFolder, domain } = siteResult;
  const q = siteQuery(domain);

  if (source === "media_id") {
    const viewDenied = await denyUnlessContentView(mcpToken, undefined, grants);
    if (viewDenied) return viewDenied;

    const id = args.media_id!.trim();
    const images = loadRegistryImages(contentPath);
    if (!images) {
      return fail(`image-registry.json not found or unreadable under ${contentFolder}`, {
        code: "registry_missing",
        path: registryRelativePath(contentFolder),
      });
    }
    const entry = images[id];
    if (!entry) {
      return fail(`Media "${id}" not found in the gallery registry.`, {
        code: "media_not_found",
        media_id: id,
        path: registryRelativePath(contentFolder),
      });
    }
    return ok(
      {
        mode: "media_id",
        media_id: id,
        src: entry.src,
        media: { id, ...entry },
        message: `Found gallery media "${id}".`,
      },
      {
        warnings: [],
        next_actions: [],
      },
    );
  }

  if (source === "url") {
    const wantImport = args.import === true;
    if (wantImport) {
      if (mcpToken && !(await checkCap(mcpToken, "media_upload"))) {
        return denyResponse("media_upload");
      }
    } else {
      const viewDenied = await denyUnlessContentView(mcpToken, undefined, grants);
      if (viewDenied) return viewDenied;
    }

    const url = args.url!.trim();
    const images = loadRegistryImages(contentPath);
    if (!images) {
      return fail(`image-registry.json not found or unreadable under ${contentFolder}`, {
        code: "registry_missing",
        path: registryRelativePath(contentFolder),
      });
    }

    const matchedId = findGalleryImageByUrl(url, images);
    if (matchedId) {
      const entry = images[matchedId];
      return ok(
        {
          mode: "url",
          media_id: matchedId,
          src: entry.src,
          media: { id: matchedId, ...entry },
          message: `Found gallery media "${matchedId}" matching URL.`,
          ...(wantImport ? { reused: true } : {}),
        },
        {
          warnings: [],
          next_actions: [],
        },
      );
    }

    if (!wantImport) {
      const next_actions: NextAction[] = [
        {
          tool: "get_or_set_media_to_gallery",
          reason: "Import this public URL into the gallery",
          args_hint: {
            url,
            import: true,
            ...(args.site ? { site: args.site } : {}),
          },
          priority: "recommended",
        },
        {
          tool: "get_or_set_media_to_gallery",
          reason: "Generate an image instead",
          args_hint: {
            prompt: "describe the image you need",
            ...(args.site ? { site: args.site } : {}),
          },
          priority: "optional",
        },
        {
          tool: "get_or_set_media_to_gallery",
          reason: "Resolve an existing gallery asset by media_id",
          args_hint: {
            media_id: "existing-registry-id",
            ...(args.site ? { site: args.site } : {}),
          },
          priority: "optional",
        },
      ];
      return actionRequired(
        {
          success: false,
          action_required: "url_not_in_gallery",
          code: "url_not_in_gallery",
          message:
            "No gallery entry matches this URL. Retry with import: true to fetch and register (public URLs only), or pass media_id / prompt / bytes_base64.",
          url,
        },
        next_actions,
      );
    }

    // import: true — fetch and register
    const fetched = await fetchPublicMedia(url, fetchFn);
    if (!fetched.ok) {
      if (fetched.code === "ssrf_blocked" || fetched.code === "fetch_failed") {
        return actionRequired(
          {
            success: false,
            action_required: fetched.code,
            code: fetched.code,
            message: fetched.message,
            url,
          },
          [
            {
              tool: "get_or_set_media_to_gallery",
              reason: "Upload small files as bytes, or ask staff to upload in the Media Gallery",
              args_hint: {
                bytes_base64: "<base64>",
                filename: "document.pdf",
                ...(args.site ? { site: args.site } : {}),
              },
              priority: "recommended",
            },
          ],
        );
      }
      return fail(fetched.message, { code: fetched.code });
    }

    const meta = resolveMediaFileMeta({
      url: fetched.finalUrl,
      filenameHint: fetched.filenameHint,
      contentType: fetched.contentType,
      bytes: fetched.bytes,
    });
    if (!meta.ok) {
      return fail(meta.message, { code: meta.code });
    }

    const doctype = inferDoctypeFromFilename(meta.filename);
    const alt =
      (args.alt && args.alt.trim()) ||
      defaultAltForDoctype(doctype, path.parse(meta.filename).name);

    const uploaded = await uploadBytesToGallery({
      fetchFn,
      mcpToken,
      q,
      bytes: fetched.bytes,
      filename: meta.filename,
      mime: meta.mime,
      alt,
      origin: "import",
      tags: args.tags,
      sourceUrl: url,
    });
    if (!uploaded.ok) {
      return fail(uploaded.message, { code: uploaded.code });
    }

    const mediaId = uploaded.id;
    const regPath = registryRelativePath(contentFolder);
    const warnings: McpWarning[] = [NO_YAML_ATTACH, PUBLIC_URL_ONLY];
    const side_effects: McpSideEffect[] = [];
    if (!uploaded.duplicate) {
      side_effects.push({
        kind: "gallery_register",
        summary: `Registered imported media ${mediaId} in gallery`,
        paths: [regPath],
      });
    } else {
      warnings.push({
        code: "hash_duplicate",
        message: `Bytes already registered as "${uploaded.existingId ?? mediaId}"; no new file written.`,
      });
    }

    return ok(
      {
        mode: "url",
        imported: !uploaded.duplicate,
        media_id: mediaId,
        src: uploaded.src,
        alt: uploaded.alt ?? alt,
        duplicate: !!uploaded.duplicate,
        message: uploaded.duplicate
          ? `Imported URL matched existing gallery asset "${mediaId}".`
          : `Imported and registered gallery media "${mediaId}".`,
      },
      {
        warnings,
        side_effects,
        next_actions: attachNextActions(mediaId, uploaded.src),
      },
    );
  }

  if (source === "bytes_base64") {
    if (mcpToken && !(await checkCap(mcpToken, "media_upload"))) {
      return denyResponse("media_upload");
    }

    const filename = typeof args.filename === "string" ? args.filename.trim() : "";
    if (!filename) {
      return fail("filename is required with bytes_base64 (extension drives media type).", {
        code: "filename_required",
      });
    }
    const ext = normalizeExt(extensionFromPath(filename));
    if (!ext || !MEDIA_EXTENSIONS.has(ext)) {
      return fail(
        `Unsupported filename extension "${ext || "(none)"}". Use a gallery media type (image, video, or PDF).`,
        { code: "unsupported_media" },
      );
    }

    let bytes: Buffer;
    try {
      bytes = Buffer.from(args.bytes_base64!.trim(), "base64");
    } catch {
      return fail("Invalid base64 payload.", { code: "invalid_base64" });
    }
    // Buffer.from does not throw on bad base64; detect empty / obvious garbage
    if (!bytes.length) {
      return fail("Invalid or empty base64 payload.", { code: "invalid_base64" });
    }
    if (bytes.length > BYTES_MAX_BYTES) {
      return fail(
        `Decoded bytes exceed ${Math.round(BYTES_MAX_BYTES / (1024 * 1024))} MB. Prefer url + import: true (≤50 MB) or staff gallery upload.`,
        { code: "too_large" },
      );
    }

    const meta = resolveMediaFileMeta({
      filenameHint: filename,
      contentType: EXT_TO_MIME[ext] || null,
      bytes,
    });
    if (!meta.ok) {
      return fail(meta.message, { code: meta.code });
    }

    const doctype = inferDoctypeFromFilename(meta.filename);
    const alt =
      (args.alt && args.alt.trim()) ||
      defaultAltForDoctype(doctype, path.parse(meta.filename).name);

    const uploaded = await uploadBytesToGallery({
      fetchFn,
      mcpToken,
      q,
      bytes,
      filename: meta.filename,
      mime: meta.mime,
      alt,
      origin: "upload",
      tags: args.tags,
    });
    if (!uploaded.ok) {
      return fail(uploaded.message, { code: uploaded.code });
    }

    const mediaId = uploaded.id;
    const regPath = registryRelativePath(contentFolder);
    const warnings: McpWarning[] = [NO_YAML_ATTACH];
    const side_effects: McpSideEffect[] = [];
    if (!uploaded.duplicate) {
      side_effects.push({
        kind: "gallery_register",
        summary: `Registered uploaded media ${mediaId} in gallery`,
        paths: [regPath],
      });
    } else {
      warnings.push({
        code: "hash_duplicate",
        message: `Bytes already registered as "${uploaded.existingId ?? mediaId}"; no new file written.`,
      });
    }

    return ok(
      {
        mode: "bytes_base64",
        media_id: mediaId,
        src: uploaded.src,
        alt: uploaded.alt ?? alt,
        duplicate: !!uploaded.duplicate,
        message: uploaded.duplicate
          ? `Upload matched existing gallery asset "${mediaId}".`
          : `Uploaded and registered gallery media "${mediaId}".`,
      },
      {
        warnings,
        side_effects,
        next_actions: attachNextActions(mediaId, uploaded.src),
      },
    );
  }

  // prompt
  if (mcpToken && !(await checkCap(mcpToken, "media_upload"))) {
    return denyResponse("media_upload");
  }

  const prompt = args.prompt!.trim();
  const genUrl = `http://localhost:${MAIN_SERVER_PORT}/api/media/generate-images${q}`;
  let genRes: Response;
  try {
    genRes = await fetchFn(genUrl, {
      method: "POST",
      headers: internalHeaders(mcpToken),
      body: JSON.stringify({
        prompt,
        n: 1,
        ...(args.aspect_ratio ? { aspect_ratio: args.aspect_ratio } : {}),
      }),
    });
  } catch (e) {
    return fail(`Failed to reach image generation API: ${(e as Error).message}`, {
      code: "generate_unreachable",
    });
  }

  const parsed = await parseGenerateImagesResponse(genRes);
  if (!parsed.ok) {
    if (parsed.status === 429) {
      return fail(parsed.error || "Image generation rate limit exceeded", {
        code: parsed.code || "rate_limited",
        retry_after_sec: parsed.retry_after_sec,
      });
    }
    return fail(parsed.error || parsed.hint || `Image generation failed (${parsed.status})`, {
      code: parsed.code || "image_generation_failed",
      hint: parsed.hint,
    });
  }

  const candidate = parsed.candidates[0];
  if (!candidate?.b64) {
    return fail("Image generation returned no candidates.", {
      code: "no_candidates",
      model: parsed.model,
    });
  }

  const mediaType = candidate.mediaType || "image/webp";
  const ext = extFromMediaType(mediaType);
  const filename = `ai-${Date.now()}.${ext}`;
  const alt = (args.alt && args.alt.trim()) || normalizePromptAlt(prompt);
  const generatedAt = new Date().toISOString();
  const bytes = Buffer.from(candidate.b64, "base64");

  const uploaded = await uploadBytesToGallery({
    fetchFn,
    mcpToken,
    q,
    bytes,
    filename,
    mime: mediaType,
    alt,
    origin: "ai",
    tags: args.tags,
    ai: {
      generated: true,
      model: parsed.model,
      prompt,
      generated_at: generatedAt,
    },
  });
  if (!uploaded.ok) {
    return fail(uploaded.message, { code: uploaded.code });
  }

  const mediaId = uploaded.id;
  const regPath = registryRelativePath(contentFolder);
  const side_effects: McpSideEffect[] = [
    {
      kind: "gallery_register",
      summary: uploaded.duplicate
        ? `Reused existing gallery media ${mediaId} (hash duplicate)`
        : `Registered AI image ${mediaId} in gallery`,
      paths: [regPath],
    },
  ];
  if (!uploaded.duplicate) {
    side_effects.push({
      kind: "enqueue_ai_image_gc",
      summary: "Scheduled AI unused-image GC after grace window",
    });
  }

  const warnings: McpWarning[] = [NO_YAML_ATTACH, AI_GC_WARNING];
  if (uploaded.duplicate) {
    warnings.push({
      code: "hash_duplicate",
      message: `Bytes already registered as "${uploaded.existingId ?? mediaId}"; no new file written.`,
    });
  }

  return ok(
    {
      mode: "prompt",
      media_id: mediaId,
      src: uploaded.src,
      alt: uploaded.alt ?? alt,
      duplicate: !!uploaded.duplicate,
      model: parsed.model ?? null,
      message: uploaded.duplicate
        ? `Generated image matched existing gallery asset "${mediaId}".`
        : `Generated and registered gallery image "${mediaId}".`,
    },
    {
      warnings,
      side_effects,
      next_actions: attachNextActions(mediaId, uploaded.src),
    },
  );
}

export function registerMediaTools(
  mcp: McpServer,
  mcpToken?: string,
  grants?: CatalogGrant[],
): void {
  mcp.tool(
    "get_or_set_media_to_gallery",
    "Resolve or create a media-gallery asset (image, video, or PDF). Pass exactly one of: media_id (lookup), " +
      "url (lookup by src/source_url; with import:true fetch+register on miss — public URLs only), " +
      "bytes_base64 + filename (upload ≤15 MB), or prompt (AI image gen n=1, origin=ai). " +
      "Does not write YAML — returns media_id + src; use update_fields (schema image fields may still be named image_id; PDFs usually need src). " +
      "Requires content_view for media_id/url lookup; media_upload for import, bytes, or prompt. " +
      "AI unused images may be GC'd after grace if never attached to live content.",
    {
      media_id: z
        .string()
        .optional()
        .describe("Existing gallery registry id to look up (read-only)"),
      url: z
        .string()
        .optional()
        .describe(
          "Public or registry URL to look up (src or source_url). On miss without import:true → url_not_in_gallery.",
        ),
      import: z
        .boolean()
        .optional()
        .describe(
          "With url only: if true and URL is not in gallery, fetch and register (media_upload; public URLs ≤50 MB).",
        ),
      bytes_base64: z
        .string()
        .optional()
        .describe("Base64 file bytes to upload (≤15 MB decoded). Requires filename."),
      filename: z
        .string()
        .optional()
        .describe("Filename with extension for bytes_base64 (e.g. guide.pdf). Required with bytes."),
      prompt: z
        .string()
        .optional()
        .describe("Text prompt to generate one image and register it in the gallery"),
      alt: z.string().optional().describe("Alt / label text (write modes)"),
      tags: z.array(z.string()).optional().describe("Gallery tags on register"),
      aspect_ratio: z
        .string()
        .optional()
        .describe("Optional aspect ratio for generation (e.g. '16:9')"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async (raw) =>
      handleGetOrSetMediaToGallery(
        {
          media_id: raw.media_id,
          url: raw.url,
          import: raw.import,
          bytes_base64: raw.bytes_base64,
          filename: raw.filename,
          prompt: raw.prompt,
          alt: raw.alt,
          tags: raw.tags,
          site: raw.site,
          aspect_ratio: raw.aspect_ratio,
        },
        { mcpToken, grants },
      ),
  );
}
