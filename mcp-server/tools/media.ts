/**
 * MCP gallery resolve / AI ingest: get_or_set_image_to_gallery
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

const MAIN_SERVER_PORT = process.env.PORT || "5000";
const INTERNAL_SECRET = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";

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

export type GalleryImageSource = "image_id" | "url" | "prompt";

/** Count which of the three mutually exclusive sources were provided. */
export function countGallerySources(args: {
  image_id?: string | null;
  url?: string | null;
  prompt?: string | null;
}): number {
  let n = 0;
  if (typeof args.image_id === "string" && args.image_id.trim()) n++;
  if (typeof args.url === "string" && args.url.trim()) n++;
  if (typeof args.prompt === "string" && args.prompt.trim()) n++;
  return n;
}

export function pickGallerySource(args: {
  image_id?: string | null;
  url?: string | null;
  prompt?: string | null;
}): GalleryImageSource | null {
  if (typeof args.image_id === "string" && args.image_id.trim()) return "image_id";
  if (typeof args.url === "string" && args.url.trim()) return "url";
  if (typeof args.prompt === "string" && args.prompt.trim()) return "prompt";
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
    "This tool does not set image_id on entries or sections. Call update_fields (or equivalent) yourself to attach the returned image_id.",
};

const AI_GC_WARNING: McpWarning = {
  code: "ai_gc_grace",
  message: `AI-generated gallery images that stay unused may be removed after about ${Math.round(AI_IMAGE_GC_GRACE_MS / (60 * 60 * 1000))} hours (grace from last public impression, else generation time). Attach the image_id to live content soon if you need to keep it.`,
};

export type GetOrSetImageArgs = {
  image_id?: string;
  url?: string;
  prompt?: string;
  alt?: string;
  tags?: string[];
  site?: string;
  aspect_ratio?: string;
};

/**
 * Core handler — exported for unit tests (pass fetchImpl to mock loopback).
 */
export async function handleGetOrSetImageToGallery(
  args: GetOrSetImageArgs,
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
    return fail(
      "Provide exactly one of image_id, url, or prompt.",
      { code: "pick_one_source" },
    );
  }
  if (sourceCount > 1) {
    return fail(
      "Provide exactly one of image_id, url, or prompt — not more than one.",
      { code: "pick_one_source" },
    );
  }

  const source = pickGallerySource(args)!;
  const siteResult = resolveSiteContext(args.site);
  if (!siteResult.ok) {
    return siteFailResult(siteResult.error, "get_or_set_image_to_gallery", {
      ...(args.image_id ? { image_id: args.image_id } : {}),
      ...(args.url ? { url: args.url } : {}),
      ...(args.prompt ? { prompt: args.prompt } : {}),
    });
  }
  const { contentPath, contentFolder, domain } = siteResult;
  const q = siteQuery(domain);

  if (source === "image_id") {
    const viewDenied = await denyUnlessContentView(mcpToken, undefined, grants);
    if (viewDenied) return viewDenied;

    const id = args.image_id!.trim();
    const images = loadRegistryImages(contentPath);
    if (!images) {
      return fail(`image-registry.json not found or unreadable under ${contentFolder}`, {
        code: "registry_missing",
        path: registryRelativePath(contentFolder),
      });
    }
    const entry = images[id];
    if (!entry) {
      return fail(`Image "${id}" not found in the gallery registry.`, {
        code: "image_not_found",
        image_id: id,
        path: registryRelativePath(contentFolder),
      });
    }
    return ok(
      {
        mode: "image_id",
        image_id: id,
        image: { id, ...entry },
        message: `Found gallery image "${id}".`,
      },
      {
        warnings: [],
        next_actions: [],
      },
    );
  }

  if (source === "url") {
    const viewDenied = await denyUnlessContentView(mcpToken, undefined, grants);
    if (viewDenied) return viewDenied;

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
          image_id: matchedId,
          image: { id: matchedId, ...entry },
          message: `Found gallery image "${matchedId}" matching URL.`,
        },
        {
          warnings: [],
          next_actions: [],
        },
      );
    }

    const next_actions: NextAction[] = [
      {
        tool: "get_or_set_image_to_gallery",
        reason: "Generate an image instead",
        args_hint: {
          prompt: "describe the image you need",
          ...(args.site ? { site: args.site } : {}),
        },
        priority: "recommended",
      },
      {
        tool: "get_or_set_image_to_gallery",
        reason: "Resolve an existing gallery image by id",
        args_hint: {
          image_id: "existing-registry-id",
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
          "No gallery entry matches this URL. URL import is under development (Cloudflare Images bridge) — use prompt to generate, or image_id to look up an existing asset.",
        url,
      },
      next_actions,
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
  const form = new FormData();
  form.append(
    "file",
    new Blob([new Uint8Array(bytes)], { type: mediaType }),
    filename,
  );
  form.append("alt", alt);
  form.append("origin", "ai");
  form.append(
    "ai",
    JSON.stringify({
      generated: true,
      model: parsed.model,
      prompt,
      generated_at: generatedAt,
    }),
  );
  if (args.tags && args.tags.length > 0) {
    form.append("tags", JSON.stringify(args.tags));
  }

  const uploadUrl = `http://localhost:${MAIN_SERVER_PORT}/api/image-registry/upload${q}`;
  let uploadRes: Response;
  try {
    uploadRes = await fetchFn(uploadUrl, {
      method: "POST",
      headers: internalHeaders(mcpToken, true),
      body: form,
    });
  } catch (e) {
    return fail(`Failed to upload generated image to gallery: ${(e as Error).message}`, {
      code: "upload_unreachable",
    });
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
    return fail(uploadData.error || `Gallery upload failed (${uploadRes.status})`, {
      code: "upload_failed",
    });
  }

  const imageId = uploadData.id;
  const regPath = registryRelativePath(contentFolder);
  const side_effects: McpSideEffect[] = [
    {
      kind: "gallery_register",
      summary: uploadData.duplicate
        ? `Reused existing gallery image ${imageId} (hash duplicate)`
        : `Registered AI image ${imageId} in gallery`,
      paths: [regPath],
    },
  ];
  if (!uploadData.duplicate) {
    side_effects.push({
      kind: "enqueue_ai_image_gc",
      summary: "Scheduled AI unused-image GC after grace window",
    });
  }

  const warnings: McpWarning[] = [NO_YAML_ATTACH, AI_GC_WARNING];
  if (uploadData.duplicate) {
    warnings.push({
      code: "hash_duplicate",
      message: `Bytes already registered as "${uploadData.existingId ?? imageId}"; no new file written.`,
    });
  }

  const next_actions: NextAction[] = [
    {
      tool: "update_fields",
      reason: "Attach this image_id to an entry or section field if needed",
      args_hint: {
        // Agent fills content_type / slug / locale / updates
        note: `Set the appropriate image field to "${imageId}"`,
      },
      priority: "recommended",
    },
  ];

  return ok(
    {
      mode: "prompt",
      image_id: imageId,
      src: uploadData.src,
      alt: uploadData.alt ?? alt,
      duplicate: !!uploadData.duplicate,
      model: parsed.model ?? null,
      message: uploadData.duplicate
        ? `Generated image matched existing gallery asset "${imageId}".`
        : `Generated and registered gallery image "${imageId}".`,
    },
    { warnings, side_effects, next_actions },
  );
}

export function registerMediaTools(
  mcp: McpServer,
  mcpToken?: string,
  grants?: CatalogGrant[],
): void {
  mcp.tool(
    "get_or_set_image_to_gallery",
    "Resolve or create a media-gallery image. Pass exactly one of: image_id (return registry entry), " +
      "url (read-only lookup by src or source_url; import on miss is under development), " +
      "or prompt (OpenRouter image gen n=1, immediately registers as origin=ai — no confirm). " +
      "Does not write entry YAML image_id fields. Requires content_view for image_id/url lookup; media_upload for prompt. " +
      "AI unused images may be GC'd after grace if never attached to live content.",
    {
      image_id: z
        .string()
        .optional()
        .describe("Existing gallery registry id to look up (read-only)"),
      url: z
        .string()
        .optional()
        .describe(
          "Public or registry URL to look up (matches entry src or source_url). Import on miss is not available yet.",
        ),
      prompt: z
        .string()
        .optional()
        .describe("Text prompt to generate one image and register it in the gallery"),
      alt: z.string().optional().describe("Alt text (prompt mode; defaults from prompt)"),
      tags: z.array(z.string()).optional().describe("Gallery tags to apply on register (prompt mode)"),
      aspect_ratio: z
        .string()
        .optional()
        .describe("Optional aspect ratio for generation (e.g. '16:9')"),
      site: z.string().optional().describe(SITE_PARAM_DESC),
    },
    async (raw) =>
      handleGetOrSetImageToGallery(
        {
          image_id: raw.image_id,
          url: raw.url,
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
