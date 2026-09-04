/**
 * Auto-Commit Queue
 * 
 * Automatically commits 4geeks-com file changes to GitHub using a
 * configurable throttled queue. Uses setTimeout-based debouncing — the timer
 * only runs when there are pending changes.
 * 
 * Content type files (dynamic via getAllFolders()) are tagged with the author.
 * All other files are committed as "System" changes.
 * Commit messages use the [Auto-sync] prefix.
 * 
 * Conflict-resilient: if a batch commit fails, it retries with only the
 * non-conflicting files.
 */

import * as fs from 'fs';
import * as path from 'path';
import {
  getSyncConfig,
  updateSyncStateAfterCommit,
  computeFileSha,
  loadSyncState,
  saveSyncState,
  shouldTrackFile,
} from './sync-state';
import { getAllFolders } from './content-types';
import { getSiteConfigs, type SiteConfig } from './site-config';
import { child } from "./logger";
import { formatAutoSyncCommitMessage } from "@shared/git-commit-attribution";
const log = child({ module: "auto-commit" });



interface PendingFileChange {
  filePath: string;
  author: string;
  timestamp: number;
  agentLabel?: string;
}

interface PendingFileInfo {
  filePath: string;
  author: string;
  timestamp: number;
}

interface AutoCommitStatus {
  enabled: boolean;
  pendingFiles: number;
  pendingFilesList: string[];
  pendingFilesDetails: PendingFileInfo[];
  lastCommitAt: string | null;
  lastCommitSha: string | null;
  lastError: string | null;
  conflictedFiles: string[];
  commitIntervalSeconds: number;
  nextSyncAt: number | null;
  isCommitting: boolean;
  githubConfigured: boolean;
  autoCommitEligibleFiles: string[];
}

interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

let pendingChanges: Map<string, PendingFileChange> = new Map();
let timer: ReturnType<typeof setTimeout> | null = null;
let isCommitting = false;
let lastCommitAt: string | null = null;
let lastCommitSha: string | null = null;
let lastError: string | null = null;
let conflictedFiles: Set<string> = new Set();
let nextSyncAt: number | null = null;
let retryBackoffMs = 0;
const BACKOFF_STEPS = [5000, 10000, 30000, 60000];

function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  const match = url.replace(/\.git$/, '').match(/github\.com\/([^\/]+)\/([^\/]+)/);
  return match ? { owner: match[1], repo: match[2] } : null;
}

function buildConfig(repoUrl: string, tokenOverride?: string): GitHubConfig | null {
  const token = (tokenOverride || process.env.GITHUB_TOKEN || "").trim();
  const branch = process.env.GITHUB_BRANCH || "main";
  const parsed = parseGitHubUrl(repoUrl);
  if (!token || !parsed) return null;
  return { token, owner: parsed.owner, repo: parsed.repo, branch };
}

/**
 * Resolve the GitHub config for a specific file path.
 * In multi-site mode, matches the file's content-folder prefix against
 * site configs and uses each site's own githubRepoUrl.
 * Falls back to the global GITHUB_REPO_URL env var for single-site mode
 * or any file that doesn't match a site with its own repo configured.
 */
function getGitHubConfigForFile(
  filePath: string,
  tokenOverride?: string,
): { config: GitHubConfig; repoUrl: string } | null {
  const sites = getSiteConfigs();
  for (const site of sites) {
    const prefix = site.contentFolder.replace(/\/$/, "");
    if (
      (filePath.startsWith(prefix + "/") || filePath === prefix) &&
      site.githubRepoUrl
    ) {
      const config = buildConfig(site.githubRepoUrl, tokenOverride);
      if (config) return { config, repoUrl: site.githubRepoUrl };
    }
  }

  const globalRepoUrl = process.env.GITHUB_REPO_URL || "";
  const config = buildConfig(globalRepoUrl, tokenOverride);
  return config ? { config, repoUrl: globalRepoUrl } : null;
}

function isAnyGitHubConfigured(): boolean {
  const token = process.env.GITHUB_TOKEN || '';
  if (!token) return false;
  const sites = getSiteConfigs();
  for (const site of sites) {
    if (site.githubRepoUrl && parseGitHubUrl(site.githubRepoUrl)) return true;
  }
  const globalRepoUrl = process.env.GITHUB_REPO_URL || '';
  return !!parseGitHubUrl(globalRepoUrl);
}

export function isAutoCommitEnabled(): boolean {
  return process.env.GITHUB_SYNC_ENABLED === 'true' && process.env.GITHUB_AUTO_COMMIT_ENABLED === 'true';
}

/**
 * Per-site auto-commit queue wrapper.
 * Enqueues changes using this site's content folder prefix so commits are
 * routed to the correct GitHub repository and never cross site boundaries.
 */
export class AutoCommitQueue {
  constructor(private readonly contentRootName: string) {}

  /** Queue a relative-to-content-root path for auto-commit. */
  queue(relPath: string, author?: string, allowedExceptions?: Set<string>): void {
    const fullPath = relPath.startsWith(this.contentRootName + '/')
      ? relPath
      : `${this.contentRootName}/${relPath}`;
    queueFileChange(fullPath, author, allowedExceptions);
  }

  get folderPrefix(): string {
    return this.contentRootName;
  }
}

function stripContentFolderPrefix(filePath: string): string {
  const sites = getSiteConfigs();
  for (const site of sites) {
    const prefix = site.contentFolder.replace(/\/$/, '') + '/';
    if (filePath.startsWith(prefix)) {
      return filePath.slice(prefix.length);
    }
  }
  return filePath;
}

function isContentTypeFile(filePath: string): boolean {
  const folders = getAllFolders();
  const withoutPrefix = stripContentFolderPrefix(filePath);
  const topFolder = withoutPrefix.split('/')[0];
  return folders.includes(topFolder);
}

/**
 * Queue a file change for auto-commit.
 * If auto-commit is disabled, does nothing.
 * Starts/resets the throttle timer.
 */
export function queueFileChange(
  filePath: string,
  author?: string,
  allowedExceptions?: Set<string>,
  agentLabel?: string,
): void {
  if (!isAutoCommitEnabled()) return;

  const cwd = process.cwd();
  const sites = getSiteConfigs();
  let relativePath: string;

  if (path.isAbsolute(filePath)) {
    relativePath = filePath.startsWith(cwd)
      ? filePath.slice(cwd.length + 1)
      : filePath;
  } else if (filePath.startsWith('client/')) {
    relativePath = filePath;
  } else {
    const knownPrefix = sites.some(s => filePath.startsWith(s.contentFolder.replace(/\/$/, '') + '/'));
    if (knownPrefix) {
      relativePath = filePath;
    } else {
      const defaultFolder = sites[0]?.contentFolder || 'default-site-content';
      relativePath = `${defaultFolder.replace(/\/$/, '')}/${filePath}`;
    }
  }

  const matchedSite = sites.find(s => relativePath.startsWith(s.contentFolder.replace(/\/$/, '') + '/'));
  if (!shouldTrackFile(relativePath, allowedExceptions, matchedSite?.contentFolder)) return;

  const resolvedAuthor = author || (isContentTypeFile(relativePath) ? 'Unknown' : 'System');

  pendingChanges.set(relativePath, {
    filePath: relativePath,
    author: resolvedAuthor,
    timestamp: Date.now(),
    ...(agentLabel?.trim() ? { agentLabel: agentLabel.trim() } : {}),
  });

  if (conflictedFiles.has(relativePath)) {
    conflictedFiles.delete(relativePath);
  }

  scheduleCommit();
}

function scheduleCommit(useBackoff = false): void {
  if (timer !== null) return;
  if (isCommitting) return;

  const config = getSyncConfig();
  const baseIntervalMs = (config.commitIntervalSeconds || 5) * 1000;
  const delayMs = useBackoff && retryBackoffMs > 0 ? retryBackoffMs : baseIntervalMs;

  nextSyncAt = Date.now() + delayMs;

  timer = setTimeout(() => {
    timer = null;
    nextSyncAt = null;
    processQueue().catch(err => {
      log.error({ err: err }, '[AutoCommit] Error processing queue:');
      const msg = err instanceof Error ? err.message : 'Unknown error';
      lastError = `Queue processing error: ${msg}`;
      scheduleRetry();
    });
  }, delayMs);
}

function scheduleRetry(): void {
  if (pendingChanges.size === 0) return;
  const currentIndex = BACKOFF_STEPS.indexOf(retryBackoffMs);
  retryBackoffMs = BACKOFF_STEPS[Math.min((currentIndex < 0 ? 0 : currentIndex + 1), BACKOFF_STEPS.length - 1)];
  log.info(`[AutoCommit] Scheduling retry with backoff: ${retryBackoffMs / 1000}s`);
  scheduleCommit(true);
}

function resetBackoff(): void {
  retryBackoffMs = 0;
}

async function processQueue(): Promise<void> {
  if (pendingChanges.size === 0) return;
  if (isCommitting) return;

  isCommitting = true;
  lastError = null;
  let hadFailure = false;

  const snapshotChanges = new Map(pendingChanges);
  pendingChanges.clear();

  try {
    // Group changes by per-site repo URL so that multi-site files are committed
    // to their own repository rather than always going to the global GITHUB_REPO_URL.
    type RepoGroup = { config: GitHubConfig; changes: Map<string, PendingFileChange> };
    const byRepo = new Map<string, RepoGroup>();

    for (const [filePath, change] of Array.from(snapshotChanges.entries())) {
      const resolved = getGitHubConfigForFile(filePath);
      if (!resolved) {
        lastError = 'GitHub not configured';
        hadFailure = true;
        if (!pendingChanges.has(filePath)) pendingChanges.set(filePath, change);
        continue;
      }
      const key = resolved.repoUrl;
      if (!byRepo.has(key)) {
        byRepo.set(key, { config: resolved.config, changes: new Map() });
      }
      byRepo.get(key)!.changes.set(filePath, change);
    }

    const errorBefore = lastError;
    for (const { config: _baseConfig, changes } of Array.from(byRepo.values())) {
      const authorGroups = groupByAuthor(changes);
      for (const [author, files] of Array.from(authorGroups.entries())) {
        const {
          resolveCommitGitHubToken,
          GitHubConnectError,
        } = await import("./github-user-tokens");
        const isSystemAuthor =
          !author ||
          author === "System" ||
          author === "Unknown" ||
          author === "github-pull" ||
          author === "agent";
        try {
          const resolved = await resolveCommitGitHubToken({
            username: isSystemAuthor ? null : author,
            purpose: isSystemAuthor ? "system" : "user_commit",
          });
          const firstFile = files[0];
          const withToken = getGitHubConfigForFile(firstFile, resolved.token);
          if (!withToken) {
            lastError = "GitHub not configured";
            hadFailure = true;
            for (const filePath of files) {
              const change = changes.get(filePath);
              if (change && !pendingChanges.has(filePath)) {
                pendingChanges.set(filePath, change);
              }
            }
            continue;
          }
          const commitAuthor =
            resolved.githubName || resolved.githubLogin
              ? {
                  name: resolved.githubName || resolved.githubLogin!,
                  email:
                    resolved.githubEmail ||
                    `${resolved.githubLogin}@users.noreply.github.com`,
                }
              : undefined;
          await commitBatch(
            withToken.config,
            author,
            files,
            commitAuthor,
            changes.get(files[0])?.agentLabel,
          );
        } catch (err) {
          if (err instanceof GitHubConnectError) {
            lastError = err.message;
            hadFailure = true;
            for (const filePath of files) {
              const change = changes.get(filePath);
              if (change && !pendingChanges.has(filePath)) {
                pendingChanges.set(filePath, change);
              }
            }
            continue;
          }
          throw err;
        }
      }
    }

    if (lastError && lastError !== errorBefore) {
      hadFailure = true;
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    lastError = `Queue processing error: ${msg}`;
    log.error({ err: error }, '[AutoCommit] Queue processing error:');
    hadFailure = true;
    for (const [key, val] of Array.from(snapshotChanges.entries())) {
      if (!pendingChanges.has(key)) pendingChanges.set(key, val);
    }
  } finally {
    isCommitting = false;

    if (!hadFailure) {
      resetBackoff();
    }

    if (pendingChanges.size > 0) {
      timer = null;
      if (hadFailure) {
        scheduleRetry();
      } else {
        scheduleCommit();
      }
    }
  }
}

function groupByAuthor(changes: Map<string, PendingFileChange>): Map<string, string[]> {
  const groups = new Map<string, string[]>();

  for (const [filePath, change] of Array.from(changes.entries())) {
    const author = change.author;
    if (!groups.has(author)) {
      groups.set(author, []);
    }
    groups.get(author)!.push(filePath);
  }

  return groups;
}

async function commitBatch(
  config: GitHubConfig,
  author: string,
  files: string[],
  commitAuthor?: { name: string; email: string },
  agentLabel?: string,
): Promise<void> {
  const { getSiteConfigs } = await import('./site-config');
  const contentRootForLog = (() => {
    if (files.length === 0) return undefined;
    const filePath = files[0];
    return getSiteConfigs().find((site) => {
      const prefix = site.contentFolder.replace(/\/$/, '') + '/';
      return filePath.startsWith(prefix);
    })?.contentFolder;
  })();
  const existingFiles: Array<{ path: string; content: string }> = [];
  const deletedFiles: string[] = [];

  for (const filePath of files) {
    const fullPath = path.join(process.cwd(), filePath);
    if (fs.existsSync(fullPath)) {
      const content = fs.readFileSync(fullPath, 'utf-8');
      existingFiles.push({ path: filePath, content });
    } else {
      deletedFiles.push(filePath);
    }
  }

  if (existingFiles.length === 0 && deletedFiles.length === 0) return;

  const fileNames = files.map(f => stripContentFolderPrefix(f)).join(', ');
  const message = formatAutoSyncCommitMessage(author, fileNames, agentLabel);

  const result = await commitFilesViaTreeAPI(
    config,
    message,
    existingFiles,
    deletedFiles,
    commitAuthor,
  );

  if (result.success && result.commitSha) {
    recordLastCommitSha(result.commitSha);
    updateSyncStateAfterCommit(result.commitSha, files, contentRootForLog);
    try {
      const { attachCommitShaForCommittedFiles } = await import("./events/event-store");
      attachCommitShaForCommittedFiles(result.commitSha, files, contentRootForLog);
    } catch (err) {
      log.warn({ err }, "[AutoCommit] Failed to attach commitSha to events after batch commit");
    }
    log.info(`[AutoCommit] Committed ${files.length} file(s) by ${author}: ${result.commitSha.substring(0, 7)}`);
    const { logSync, refreshGithubCommit } = await import("./sync-log");
    logSync('COMMIT', `Auto-commit ${result.commitSha.substring(0, 7)} by ${author}: ${fileNames}`, author, undefined, contentRootForLog);
    refreshGithubCommit();
  } else if (result.error?.includes('422') || result.error?.includes('conflict') || result.error?.includes('Update is not a fast forward')) {
    log.warn(`[AutoCommit] Conflict detected for batch by ${author}, retrying individual files...`);
    const { logSync } = await import("./sync-log");
    logSync('CONFLICT', `Auto-commit conflict by ${author}, retrying individually: ${fileNames}`, author, undefined, contentRootForLog);
    await retryIndividualFiles(config, author, existingFiles, deletedFiles, contentRootForLog, agentLabel);
  } else {
    lastError = result.error || 'Unknown commit error';
    log.error(`[AutoCommit] Batch commit failed: ${lastError}`);
    const { logSync } = await import("./sync-log");
    logSync('ERROR', `Auto-commit failed by ${author}: ${lastError}`, author, undefined, contentRootForLog);
    for (const filePath of files) {
      pendingChanges.set(filePath, {
        filePath,
        author,
        timestamp: Date.now(),
        ...(agentLabel ? { agentLabel } : {}),
      });
    }
  }
}

async function retryIndividualFiles(
  config: GitHubConfig,
  author: string,
  existingFiles: Array<{ path: string; content: string }>,
  deletedFiles: string[],
  contentRootForLog?: string,
  agentLabel?: string,
): Promise<void> {
  for (const file of existingFiles) {
    const fileName = stripContentFolderPrefix(file.path);
    const message = formatAutoSyncCommitMessage(author, fileName, agentLabel);

    const result = await commitSingleFileViaContentsAPI(config, file.path, file.content, message);

    if (result.success && result.commitSha) {
      recordLastCommitSha(result.commitSha);
      // Prefer the site of this file; fall back to the batch contentRoot.
      const { getSiteConfigs } = await import('./site-config');
      const fileContentRoot =
        getSiteConfigs().find((site) => {
          const prefix = site.contentFolder.replace(/\/$/, '') + '/';
          return file.path.startsWith(prefix);
        })?.contentFolder ?? contentRootForLog;
      updateSyncStateAfterCommit(result.commitSha, [file.path], fileContentRoot);
      try {
        const { attachCommitShaForCommittedFiles } = await import("./events/event-store");
        attachCommitShaForCommittedFiles(result.commitSha, [file.path], fileContentRoot);
      } catch (err) {
        log.warn({ err }, "[AutoCommit] Failed to attach commitSha to events after individual commit");
      }
      log.info(`[AutoCommit] Individual commit succeeded: ${fileName}`);
    } else {
      const { getSiteConfigs } = await import('./site-config');
      const fileContentRoot =
        getSiteConfigs().find((site) => {
          const prefix = site.contentFolder.replace(/\/$/, '') + '/';
          return file.path.startsWith(prefix);
        })?.contentFolder ?? contentRootForLog;
      const { isSeoIndexRelPath, healSeoIndexOnRemoteOverlap, seoIndexPath } = await import("./seo-index");
      if (isSeoIndexRelPath(file.path, fileContentRoot)) {
        healSeoIndexOnRemoteOverlap({
          contentRoot: fileContentRoot,
          remoteChangedFiles: [file.path],
        });
        const rebuiltPath = seoIndexPath(fileContentRoot);
        const rebuilt = fs.existsSync(rebuiltPath) ? fs.readFileSync(rebuiltPath, "utf-8") : file.content;
        const retry = await commitSingleFileViaContentsAPI(config, file.path, rebuilt, message);
        if (retry.success && retry.commitSha) {
          recordLastCommitSha(retry.commitSha);
          updateSyncStateAfterCommit(retry.commitSha, [file.path], fileContentRoot);
          try {
            const { attachCommitShaForCommittedFiles } = await import("./events/event-store");
            attachCommitShaForCommittedFiles(retry.commitSha, [file.path], fileContentRoot);
          } catch (err) {
            log.warn({ err }, "[AutoCommit] Failed to attach commitSha to events after seo-index retry");
          }
          log.info(`[AutoCommit] seo-index.json rebuilt and committed after overlap`);
          continue;
        }
      }
      conflictedFiles.add(file.path);
      lastError = `Conflict on ${fileName}: ${result.error}`;
      log.warn(`[AutoCommit] Conflict on ${fileName}, marked as conflicted`);
      const { logSync } = await import("./sync-log");
      logSync('CONFLICT', `Conflict on ${fileName} by ${author}: ${result.error ?? 'push rejected'}`, author, undefined, contentRootForLog);
    }
  }

  for (const filePath of deletedFiles) {
    conflictedFiles.add(filePath);
    log.warn(`[AutoCommit] Skipping delete for conflicted file: ${filePath}`);
    const { logSync } = await import("./sync-log");
    logSync('CONFLICT', `Conflict on deleted file ${stripContentFolderPrefix(filePath)} by ${author}: push rejected`, author, undefined, contentRootForLog);
  }
}

async function commitFilesViaTreeAPI(
  config: GitHubConfig,
  message: string,
  files: Array<{ path: string; content: string }>,
  deletedFiles: string[],
  commitAuthor?: { name: string; email: string },
): Promise<{ success: boolean; commitSha?: string; error?: string }> {
  function formatGhError(status: number, body: string): string {
    try {
      const parsed = JSON.parse(body);
      if (parsed.message) return `${status} — ${parsed.message}`;
    } catch {}
    const trimmed = body.trim().slice(0, 200);
    return trimmed ? `${status} — ${trimmed}` : `${status}`;
  }

  const headers = {
    'Authorization': `Bearer ${config.token}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  try {
    const refRes = await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/git/ref/heads/${config.branch}`,
      { headers }
    );
    if (!refRes.ok) {
      const errText = await refRes.text().catch(() => '');
      return { success: false, error: `Failed to get branch ref: ${formatGhError(refRes.status, errText)}` };
    }
    const refData = await refRes.json();
    const headSha = refData.object?.sha;
    if (!headSha) return { success: false, error: 'No HEAD SHA found' };

    const commitRes = await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/git/commits/${headSha}`,
      { headers }
    );
    if (!commitRes.ok) {
      const errText = await commitRes.text().catch(() => '');
      return { success: false, error: `Failed to get commit: ${formatGhError(commitRes.status, errText)}` };
    }
    const commitData = await commitRes.json();
    const baseTreeSha = commitData.tree?.sha;
    if (!baseTreeSha) return { success: false, error: 'No base tree SHA found' };

    const treeEntries: Array<{ path: string; mode: string; type: string; sha: string | null }> = [];

    for (const file of files) {
      const blobRes = await fetch(
        `https://api.github.com/repos/${config.owner}/${config.repo}/git/blobs`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            content: Buffer.from(file.content).toString('base64'),
            encoding: 'base64',
          }),
        }
      );
      if (!blobRes.ok) {
        const errText = await blobRes.text().catch(() => '');
        return { success: false, error: `Failed to create blob for ${file.path}: ${formatGhError(blobRes.status, errText)}` };
      }
      const blobData = await blobRes.json();
      treeEntries.push({ path: file.path, mode: '100644', type: 'blob', sha: blobData.sha });
    }

    for (const filePath of deletedFiles) {
      treeEntries.push({ path: filePath, mode: '100644', type: 'blob', sha: null as any });
    }

    const treeRes = await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/git/trees`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify({ base_tree: baseTreeSha, tree: treeEntries }),
      }
    );
    if (!treeRes.ok) {
      const errText = await treeRes.text().catch(() => '');
      return { success: false, error: `Failed to create tree: ${formatGhError(treeRes.status, errText)}` };
    }
    const treeData = await treeRes.json();

    const commitBody: Record<string, unknown> = {
      message,
      tree: treeData.sha,
      parents: [headSha],
    };
    if (commitAuthor?.name && commitAuthor?.email) {
      commitBody.author = commitAuthor;
      commitBody.committer = commitAuthor;
    }

    const newCommitRes = await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/git/commits`,
      {
        method: 'POST',
        headers,
        body: JSON.stringify(commitBody),
      }
    );
    if (!newCommitRes.ok) {
      const errText = await newCommitRes.text().catch(() => '');
      return { success: false, error: `Failed to create commit: ${formatGhError(newCommitRes.status, errText)}` };
    }
    const newCommitData = await newCommitRes.json();

    const updateRes = await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/git/refs/heads/${config.branch}`,
      {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ sha: newCommitData.sha, force: false }),
      }
    );
    if (!updateRes.ok) {
      const errText = await updateRes.text().catch(() => '');
      return { success: false, error: `Failed to update ref: ${formatGhError(updateRes.status, errText)}` };
    }

    return { success: true, commitSha: newCommitData.sha };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: `Tree API network error: ${msg}` };
  }
}

async function commitSingleFileViaContentsAPI(
  config: GitHubConfig,
  filePath: string,
  content: string,
  message: string
): Promise<{ success: boolean; commitSha?: string; error?: string }> {
  function formatGhError(status: number, body: string): string {
    try {
      const parsed = JSON.parse(body);
      if (parsed.message) return `${status} — ${parsed.message}`;
    } catch {}
    const trimmed = body.trim().slice(0, 200);
    return trimmed ? `${status} — ${trimmed}` : `${status}`;
  }

  const headers = {
    'Authorization': `Bearer ${config.token}`,
    'Accept': 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  try {
    let sha: string | undefined;
    const getRes = await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${filePath}?ref=${config.branch}`,
      { headers }
    );
    if (getRes.ok) {
      const getData = await getRes.json();
      sha = getData.sha;
    }

    const body: Record<string, string> = {
      message,
      content: Buffer.from(content).toString('base64'),
      branch: config.branch,
    };
    if (sha) body.sha = sha;

    const putRes = await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${filePath}`,
      { method: 'PUT', headers, body: JSON.stringify(body) }
    );

    if (!putRes.ok) {
      const errText = await putRes.text().catch(() => '');
      return { success: false, error: formatGhError(putRes.status, errText) };
    }

    const putData = await putRes.json();
    return { success: true, commitSha: putData.commit?.sha };
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: `Contents API network error: ${msg}` };
  }
}

export function getAutoCommitStatus(): AutoCommitStatus {
  const config = getSyncConfig();

  // Files that are locally modified AND eligible for auto-commit (pass shouldTrackFile).
  // This is computed from sync-state so it's accurate even when auto-commit is disabled
  // (queueFileChange returns early when disabled, so pendingFilesList is empty in that case).
  const state = loadSyncState();
  const autoCommitEligibleFiles = Object.entries(state.files)
    .filter(([filePath, info]) => {
      const fileSite = getSiteConfigs().find(s => filePath.startsWith(s.contentFolder.replace(/\/$/, '') + '/'));
      if (!shouldTrackFile(filePath, undefined, fileSite?.contentFolder)) return false;
      // Locally modified = local SHA differs from remote SHA, or file has no remote SHA at all
      return info.sha && info.sha !== info.remoteSha;
    })
    .map(([filePath]) => filePath);

  return {
    enabled: isAutoCommitEnabled(),
    pendingFiles: pendingChanges.size,
    pendingFilesList: Array.from(pendingChanges.keys()),
    pendingFilesDetails: Array.from(pendingChanges.values()).map(c => ({
      filePath: c.filePath,
      author: c.author,
      timestamp: c.timestamp,
    })),
    lastCommitAt,
    lastCommitSha,
    lastError,
    conflictedFiles: Array.from(conflictedFiles),
    commitIntervalSeconds: config.commitIntervalSeconds,
    nextSyncAt,
    isCommitting,
    githubConfigured: isAnyGitHubConfigured(),
    autoCommitEligibleFiles,
  };
}

export function getConflictedFiles(): string[] {
  return Array.from(conflictedFiles);
}

export function clearConflict(filePath: string): boolean {
  return conflictedFiles.delete(filePath);
}

export function clearAllConflicts(): void {
  conflictedFiles.clear();
}

/**
 * Record a commit SHA pushed by this instance so the GitHub webhook can skip
 * auto-pull for self-pushes. Auto-commit already sets this; manual commit/push
 * paths must call it too.
 */
export function recordLastCommitSha(commitSha: string): void {
  if (!commitSha) return;
  lastCommitSha = commitSha;
  lastCommitAt = new Date().toISOString();
}

/**
 * Force flush all pending changes immediately (bypasses timer).
 * Useful before shutting down or when the user explicitly requests it.
 */
export async function flushPendingChanges(): Promise<{ success: boolean; error?: string }> {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
    nextSyncAt = null;
  }

  if (pendingChanges.size === 0) {
    return { success: true };
  }

  try {
    await processQueue();
    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}
