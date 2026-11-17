/**
 * Detect whether a section instance uses uploaded-file video vs YouTube
 * (for Micro-conversions tab warnings). Heuristic walk of common video fields.
 */

function isYoutubeUrl(url: string): boolean {
  const u = url.trim().toLowerCase();
  return (
    u.includes("youtube.com") ||
    u.includes("youtu.be") ||
    u.includes("youtube-nocookie.com")
  );
}

function isFileVideoUrl(url: string): boolean {
  const u = url.trim().toLowerCase();
  if (!u || isYoutubeUrl(u)) return false;
  if (u.startsWith("/")) return true;
  return /\.(mp4|webm|mov|ogg|m4v)(\?|#|$)/i.test(u);
}

function walkVideoUrls(value: unknown, out: string[]): void {
  if (typeof value === "string") {
    if (/youtube|youtu\.be|\.mp4|\.webm|\.mov|\.ogg|\.m4v|^\//i.test(value)) out.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) walkVideoUrls(item, out);
    return;
  }
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    for (const [k, v] of Object.entries(o)) {
      if (k === "url" || k === "src" || k === "video_url" || k === "video") {
        walkVideoUrls(v, out);
      } else if (typeof v === "object") {
        walkVideoUrls(v, out);
      }
    }
  }
}

export type SectionVideoKind = {
  hasYoutube: boolean;
  hasFileVideo: boolean;
};

/** Scan section YAML-ish object for video URLs. */
export function detectSectionVideoKind(section: unknown): SectionVideoKind {
  const urls: string[] = [];
  walkVideoUrls(section, urls);
  let hasYoutube = false;
  let hasFileVideo = false;
  for (const u of urls) {
    if (isYoutubeUrl(u)) hasYoutube = true;
    if (isFileVideoUrl(u)) hasFileVideo = true;
  }
  return { hasYoutube, hasFileVideo };
}
