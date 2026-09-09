/**
 * GitHub GraphQL helpers for section-filtered file history (Time Machine).
 * Blob batching avoids N REST Contents calls when filtering commits by section.
 */

import yaml from "js-yaml";
import { diffLines } from "diff";
import {
  getGitHubConfig,
  listFileCommits,
  type FileCommitEntry,
  type GitHubConfig,
} from "./github";
import { sectionMatchesId } from "./utils/sectionIdentity";
import {
  escapeObjectVars,
  escapeTemplateVars,
  unescapeObjectVars,
  unescapeYamlDump,
} from "@shared/templateVars";

const FILE_BATCH_SIZE = 25;
const DEFAULT_MAX_BATCHES = 5;
const DEFAULT_LIMIT = 10;

export type SectionHistoryCursor = {
  page: number;
  index: number;
};

/** File commit that changed this section versus its git parent. */
export type SectionHistoryEntry = FileCommitEntry & {
  additions: number;
  deletions: number;
};

export function parseSectionHistoryCursor(cursor?: string | null): SectionHistoryCursor {
  if (!cursor || typeof cursor !== "string") return { page: 1, index: 0 };
  const m = /^p(\d+)-i(\d+)$/.exec(cursor.trim());
  if (!m) return { page: 1, index: 0 };
  return {
    page: Math.max(1, parseInt(m[1]!, 10) || 1),
    index: Math.max(0, parseInt(m[2]!, 10) || 0),
  };
}

export function formatSectionHistoryCursor(page: number, index: number): string {
  return `p${Math.max(1, page)}-i${Math.max(0, index)}`;
}

export async function githubGraphqlRequest(
  query: string,
  config: GitHubConfig,
  variables?: Record<string, unknown>,
): Promise<{ data?: any; errors?: Array<{ message?: string }>; error?: string }> {
  try {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: JSON.stringify({ query, variables }),
    });
    if (!response.ok) {
      const errorText = await response.text();
      return { error: `GitHub GraphQL HTTP ${response.status}: ${errorText}` };
    }
    const body = await response.json();
    if (body.errors?.length && !body.data) {
      return {
        error: body.errors.map((e: { message?: string }) => e.message || "error").join("; "),
        errors: body.errors,
      };
    }
    return { data: body.data, errors: body.errors };
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Unknown GraphQL error" };
  }
}

/**
 * Fetch file text at many commit SHAs in one GraphQL request.
 * Missing / failed blobs are omitted (counted in skipped).
 */
export async function fetchBlobsAtCommits(opts: {
  repoUrl?: string;
  filePath: string;
  shas: string[];
}): Promise<{
  success: boolean;
  blobs: Record<string, string>;
  skipped: number;
  error?: string;
  repoUrl?: string;
}> {
  const uniqueShas = [...new Set(opts.shas.filter((s) => /^[a-f0-9]{7,40}$/i.test(s)))];
  if (uniqueShas.length === 0) {
    return { success: true, blobs: {}, skipped: 0 };
  }

  const { getSiteConfigs } = await import("./site-config");
  const matchedSite = getSiteConfigs().find((site) => {
    const prefix = site.contentFolder.replace(/\/$/, "") + "/";
    return opts.filePath === site.contentFolder || opts.filePath.startsWith(prefix);
  });
  const repoUrl = opts.repoUrl || matchedSite?.githubRepoUrl;
  const config = getGitHubConfig(repoUrl);
  if (!config) {
    return { success: false, blobs: {}, skipped: 0, error: "GitHub not configured", repoUrl };
  }

  const aliasFields = uniqueShas
    .map((sha, i) => {
      const expr = `${sha}:${opts.filePath}`.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      return `c${i}: object(expression: "${expr}") { ... on Blob { text } }`;
    })
    .join("\n      ");

  const query = `
    query {
      repository(owner: ${JSON.stringify(config.owner)}, name: ${JSON.stringify(config.repo)}) {
        ${aliasFields}
      }
    }
  `;

  const result = await githubGraphqlRequest(query, config);
  if (result.error && !result.data) {
    return {
      success: false,
      blobs: {},
      skipped: uniqueShas.length,
      error: result.error,
      repoUrl: `https://github.com/${config.owner}/${config.repo}`,
    };
  }

  const repo = result.data?.repository;
  const blobs: Record<string, string> = {};
  let skipped = 0;
  for (let i = 0; i < uniqueShas.length; i++) {
    const sha = uniqueShas[i]!;
    const node = repo?.[`c${i}`];
    const text = typeof node?.text === "string" ? node.text : null;
    if (text == null) {
      skipped += 1;
      continue;
    }
    blobs[sha] = text;
  }

  return {
    success: true,
    blobs,
    skipped,
    repoUrl: `https://github.com/${config.owner}/${config.repo}`,
  };
}

/** Extract the target section object from page YAML text. */
export function extractSectionFromYamlText(
  yamlText: string | undefined | null,
  opts: { sectionId?: string | null; sectionIndex: number },
): unknown | undefined {
  if (yamlText == null || yamlText === "") return undefined;
  let parsed: unknown;
  try {
    // Same as VersioningManager / content editors: escape {{ }} before js-yaml
    // so defaults like `| 84%` do not break the parser.
    const { escaped, map } = escapeTemplateVars(yamlText);
    const raw = yaml.load(escaped);
    parsed = raw ? unescapeObjectVars(raw, map) : raw;
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const sections = (parsed as Record<string, unknown>).sections;
  if (!Array.isArray(sections)) return undefined;

  let section: unknown;
  if (opts.sectionId) {
    // With a stable id: never fall back to index (wrong slot = wrong component).
    section = sections.find(
      (s) => s && typeof s === "object" && sectionMatchesId(s as Record<string, unknown>, opts.sectionId),
    );
  } else if (opts.sectionIndex >= 0 && opts.sectionIndex < sections.length) {
    section = sections[opts.sectionIndex];
  }
  return section;
}

/** Extract a stable fingerprint for the target section from YAML text. */
export function sectionFingerprintFromYaml(
  yamlText: string | undefined | null,
  opts: { sectionId?: string | null; sectionIndex: number },
): string | undefined {
  const section = extractSectionFromYamlText(yamlText, opts);
  if (section === undefined) return undefined;
  try {
    return JSON.stringify(section);
  } catch {
    return undefined;
  }
}

/** Dump one section as YAML (for line-oriented diff stats / UI). */
export function sectionYamlDumpFromPageYaml(
  yamlText: string | undefined | null,
  opts: { sectionId?: string | null; sectionIndex: number },
): string {
  const section = extractSectionFromYamlText(yamlText, opts);
  if (section === undefined) return "";
  const { escaped, map } = escapeObjectVars(section);
  const dumped = yaml.dump(escaped, {
    lineWidth: -1,
    noRefs: true,
    quotingType: '"',
    forceQuotes: false,
  });
  return unescapeYamlDump(dumped, map);
}

export function countSectionDiffStats(
  beforeYaml: string,
  afterYaml: string,
): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const part of diffLines(beforeYaml, afterYaml)) {
    const lines = part.value.replace(/\n$/, "").split("\n");
    const n = lines.length;
    if (part.added) additions += n;
    else if (part.removed) deletions += n;
  }
  return { additions, deletions };
}

export type SectionHistoryResult = {
  success: boolean;
  entries: SectionHistoryEntry[];
  hasMore: boolean;
  nextCursor: string | null;
  skipped: number;
  repoUrl?: string;
  error?: string;
};

/**
 * List commits where a specific section changed versus the commit's git parent.
 * Uses REST commit pages (path filter) + GraphQL blob batch for head + parent SHAs.
 */
export async function listSectionHistory(opts: {
  filePath: string;
  sectionId?: string | null;
  sectionIndex: number;
  repoUrl?: string;
  limit?: number;
  cursor?: string | null;
  maxBatches?: number;
  /** Injectables for tests */
  listCommitsFn?: typeof listFileCommits;
  fetchBlobsFn?: typeof fetchBlobsAtCommits;
}): Promise<SectionHistoryResult> {
  const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), 20);
  const maxBatches = Math.min(Math.max(opts.maxBatches ?? DEFAULT_MAX_BATCHES, 1), 8);
  const listCommits = opts.listCommitsFn ?? listFileCommits;
  const fetchBlobs = opts.fetchBlobsFn ?? fetchBlobsAtCommits;

  const start = parseSectionHistoryCursor(opts.cursor);
  let page = start.page;
  let startIndex = start.index;

  const filtered: SectionHistoryEntry[] = [];
  let skipped = 0;
  let repoUrl = opts.repoUrl;
  let batches = 0;
  let hasMore = false;
  let nextCursor: string | null = null;

  while (filtered.length < limit && batches < maxBatches) {
    batches += 1;
    const listed = await listCommits(opts.filePath, {
      repoUrl: opts.repoUrl,
      limit: FILE_BATCH_SIZE,
      page,
    });
    if (!listed.success) {
      return {
        success: false,
        entries: [],
        hasMore: false,
        nextCursor: null,
        skipped,
        repoUrl: listed.repoUrl ?? repoUrl,
        error: listed.error,
      };
    }
    repoUrl = listed.repoUrl ?? repoUrl;
    const pageEntries = listed.entries;
    if (pageEntries.length === 0) {
      hasMore = false;
      nextCursor = null;
      break;
    }

    const pageFull = pageEntries.length >= FILE_BATCH_SIZE;
    const sliceStart = batches === 1 ? startIndex : 0;
    if (sliceStart >= pageEntries.length) {
      if (!pageFull) {
        hasMore = false;
        nextCursor = null;
        break;
      }
      page += 1;
      startIndex = 0;
      continue;
    }

    const candidateEntries = pageEntries.slice(sliceStart);

    const shas = [
      ...candidateEntries.map((e) => e.sha),
      ...candidateEntries.map((e) => e.parentSha).filter((s): s is string => !!s),
    ];
    const blobResult = await fetchBlobs({
      repoUrl: opts.repoUrl,
      filePath: opts.filePath,
      shas,
    });
    if (!blobResult.success && Object.keys(blobResult.blobs).length === 0) {
      return {
        success: false,
        entries: filtered,
        hasMore: false,
        nextCursor: null,
        skipped: skipped + blobResult.skipped,
        repoUrl: blobResult.repoUrl ?? repoUrl,
        error: blobResult.error,
      };
    }
    skipped += blobResult.skipped;
    repoUrl = blobResult.repoUrl ?? repoUrl;

    const fpOpts = { sectionId: opts.sectionId, sectionIndex: opts.sectionIndex };
    let stoppedMidPage = false;
    for (let i = 0; i < candidateEntries.length; i++) {
      const entry = candidateEntries[i]!;
      if (!(entry.sha in blobResult.blobs)) {
        // Blob missing for this SHA — already counted in skipped; do not invent a change.
        continue;
      }

      const parentSha = entry.parentSha || null;
      // Parent blob missing (file add / path absent at parent) → treat as empty parent
      // so a section that appears in this commit is listed as an introduction.
      const parentBlob =
        parentSha && parentSha in blobResult.blobs ? blobResult.blobs[parentSha] : undefined;

      const currFp = sectionFingerprintFromYaml(blobResult.blobs[entry.sha], fpOpts);
      const parentFp = parentBlob !== undefined
        ? sectionFingerprintFromYaml(parentBlob, fpOpts)
        : undefined;

      if (currFp === parentFp) {
        continue;
      }

      const beforeYaml =
        parentBlob !== undefined ? sectionYamlDumpFromPageYaml(parentBlob, fpOpts) : "";
      const afterYaml = sectionYamlDumpFromPageYaml(blobResult.blobs[entry.sha], fpOpts);
      const { additions, deletions } = countSectionDiffStats(beforeYaml, afterYaml);

      filtered.push({
        ...entry,
        additions,
        deletions,
      });

      if (filtered.length >= limit) {
        const nextIndexInPage = sliceStart + i + 1;
        if (nextIndexInPage < pageEntries.length) {
          nextCursor = formatSectionHistoryCursor(page, nextIndexInPage);
          hasMore = true;
        } else if (pageFull) {
          nextCursor = formatSectionHistoryCursor(page + 1, 0);
          hasMore = true;
        } else {
          nextCursor = null;
          hasMore = false;
        }
        stoppedMidPage = true;
        break;
      }
    }

    if (stoppedMidPage) break;

    if (!pageFull) {
      hasMore = false;
      nextCursor = null;
      break;
    }

    // More file commits exist; continue to next page within maxBatches or hand off via cursor
    page += 1;
    startIndex = 0;
    if (batches >= maxBatches && filtered.length < limit) {
      nextCursor = formatSectionHistoryCursor(page, 0);
      hasMore = true;
      break;
    }
    if (filtered.length >= limit) {
      nextCursor = formatSectionHistoryCursor(page, 0);
      hasMore = true;
      break;
    }
  }

  return {
    success: true,
    entries: filtered.slice(0, limit),
    hasMore,
    nextCursor: hasMore ? nextCursor : null,
    skipped,
    repoUrl,
  };
}
