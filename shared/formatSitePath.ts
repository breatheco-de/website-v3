export interface FormatSitePathOptions {
  /** Active site content folder, e.g. "site_4geeks-florida". From /api/site/info. */
  contentFolder?: string | null;
  /** Extra known site folder names (multi-site list from /api/sites). */
  knownSiteFolders?: string[];
}

/** Former content roots — strip these like site_* so locale files stay distinguishable. */
const LEGACY_SITE_FOLDERS = new Set(["4geeks-com", "content", "marketing-content"]);
const SITE_FOLDER_RE = /^site_[^/]+$/;
const REPO_NON_SITE_ROOTS = new Set([
  "client",
  "server",
  "scripts",
  "shared",
]);

function normalizeSlashes(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/\/+$/, "");
}

function pathAfterFolder(segments: string[], folderIndex: number): string {
  return segments.slice(folderIndex + 1).join("/");
}

function isSiteFolderSegment(segment: string, knownSiteFolders: string[]): boolean {
  if (!segment) return false;
  if (knownSiteFolders.includes(segment)) return true;
  if (SITE_FOLDER_RE.test(segment)) return true;
  return LEGACY_SITE_FOLDERS.has(segment);
}

function findSiteFolderIndex(segments: string[], knownSiteFolders: string[]): number {
  for (let i = 0; i < segments.length; i++) {
    if (isSiteFolderSegment(segments[i], knownSiteFolders)) {
      return i;
    }
  }
  return -1;
}

function basename(filePath: string): string {
  const segments = filePath.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? filePath;
}

/**
 * Display-safe file path for UI.
 * 1. If under a site content folder → path inside that folder (e.g. pages/about/en.yml)
 * 2. Otherwise → basename only (e.g. report-2026-07-02.json)
 */
export function formatSitePath(filePath: string, options?: FormatSitePathOptions): string {
  if (!filePath) return filePath;

  const normalized = normalizeSlashes(filePath);
  const knownSiteFolders = options?.knownSiteFolders ?? [];
  const segments = normalized.split("/").filter(Boolean);

  if (options?.contentFolder) {
    const folder = options.contentFolder.replace(/\/+$/, "");
    const folderIndex = segments.indexOf(folder);
    if (folderIndex >= 0) {
      const relative = pathAfterFolder(segments, folderIndex);
      return relative || basename(normalized);
    }
    if (normalized === folder) {
      return basename(normalized);
    }
    const prefix = `${folder}/`;
    if (normalized.startsWith(prefix)) {
      return normalized.slice(prefix.length) || basename(normalized);
    }
  }

  const detectedIndex = findSiteFolderIndex(segments, knownSiteFolders);
  if (detectedIndex >= 0) {
    const relative = pathAfterFolder(segments, detectedIndex);
    return relative || basename(normalized);
  }

  const firstSegment = segments[0];
  if (firstSegment && REPO_NON_SITE_ROOTS.has(firstSegment)) {
    return basename(normalized);
  }

  // Already site-relative (no absolute prefix, no site-folder segment to strip).
  if (!normalized.startsWith("/") && !/^[A-Za-z]:/.test(normalized)) {
    return normalized;
  }

  return basename(normalized);
}

/**
 * Normalize a file path to cwd-relative form including the site folder prefix.
 * Suitable for API calls that resolve via path.resolve(process.cwd(), sourceFile).
 */
export function toContentFileRef(filePath: string, options?: FormatSitePathOptions): string {
  if (!filePath) return filePath;

  const normalized = normalizeSlashes(filePath);
  const knownSiteFolders = options?.knownSiteFolders ?? [];
  const segments = normalized.split("/").filter(Boolean);

  const detectedIndex = findSiteFolderIndex(segments, knownSiteFolders);
  if (detectedIndex >= 0) {
    return segments.slice(detectedIndex).join("/");
  }

  if (options?.contentFolder) {
    const folder = options.contentFolder.replace(/\/+$/, "");
    const relative = formatSitePath(filePath, options);
    if (relative && relative !== basename(normalized)) {
      return `${folder}/${relative}`;
    }
  }

  return normalized;
}

/** Same as formatSitePath but with spaced segments for compact UI labels. */
export function formatSitePathSpaced(filePath: string, options?: FormatSitePathOptions): string {
  return formatSitePath(filePath, options).split("/").join(" / ");
}

const LIVE_LABEL_SUFFIX_RE = /\s*\(live\)\s*$/i;

/** True when a quoted or standalone string looks like a content YAML/site path (not a URL). */
export function isContentFilePath(p: string): boolean {
  const pathPart = p.replace(LIVE_LABEL_SUFFIX_RE, "").trim();
  return (
    /\.ya?ml$/i.test(pathPart) ||
    /(?:^|\/)(?:site_[^/]+|4geeks-com|content|marketing-content)\//.test(pathPart)
  );
}

/**
 * Rewrite content-file paths inside a validation message to site-relative form
 * (path after the site_* folder). Quoted URLs such as "/landing/foo" are left unchanged.
 * Preserves an optional " (live)" suffix from redirect validator labels.
 */
export function formatSitePathsInText(
  text: string,
  formatPath?: (filePath: string) => string,
  options?: FormatSitePathOptions,
): string {
  if (!text) return text;
  const fmt = formatPath ?? ((p: string) => formatSitePath(p, options));

  const formatOne = (raw: string): string => {
    const live = LIVE_LABEL_SUFFIX_RE.test(raw);
    const pathPart = raw.replace(LIVE_LABEL_SUFFIX_RE, "").trim();
    if (!isContentFilePath(pathPart)) return raw;
    const formatted = fmt(pathPart);
    return live ? `${formatted} (live)` : formatted;
  };

  if (!text.includes('"') && isContentFilePath(text)) {
    return formatOne(text);
  }
  return text.replace(/"([^"]+)"/g, (full, inner: string) =>
    isContentFilePath(inner) ? `"${formatOne(inner)}"` : full,
  );
}
