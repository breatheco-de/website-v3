/**
 * Shared helpers for AI-generated image garbage collection.
 */
import type { ImageEntry } from "@shared/schema";

export const AI_IMAGE_GC_GRACE_MS = 48 * 60 * 60 * 1000;

export function isAiOrigin(entry: ImageEntry | undefined | null): boolean {
  return entry?.origin === "ai" || entry?.ai?.generated === true;
}

/** Grace clock: last public impression, else ai.generated_at. */
export function aiImageGraceAnchorIso(entry: ImageEntry): string | undefined {
  if (entry.last_impression_at) return entry.last_impression_at;
  return entry.ai?.generated_at;
}

export function isAiImagePastGrace(
  entry: ImageEntry,
  nowMs: number = Date.now(),
  graceMs: number = AI_IMAGE_GC_GRACE_MS,
): boolean {
  const anchor = aiImageGraceAnchorIso(entry);
  if (!anchor) return false;
  const t = Date.parse(anchor);
  if (Number.isNaN(t)) return false;
  return nowMs - t >= graceMs;
}

export function normalizePromptAlt(prompt: string, maxLen = 160): string {
  const cleaned = prompt.replace(/\s+/g, " ").trim();
  if (!cleaned) return "AI-generated image";
  if (cleaned.length <= maxLen) return cleaned;
  return `${cleaned.slice(0, maxLen - 1).trimEnd()}…`;
}
