/**
 * GitHub API utility for committing content changes directly to the repository.
 * Used in production to sync content edits back to the main branch.
 * 
 * IMPORTANT: This module does NOT use git CLI commands.
 * All operations use GitHub's REST API to work in production environments
 * where git CLI may not be available (e.g., Replit deployments).
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import * as os from 'os';
import { pipeline } from 'stream/promises';
import { Readable } from 'stream';
import * as tar from 'tar';
import { getAllDirectories } from './content-types';
import {
  detectPendingChanges,
  getAllContentFiles,
  getLastSyncedCommit,
  updateSyncStateAfterCommit,
  markFileAsModified,
  loadSyncState,
  saveSyncState,
  computeFileSha,
  type PendingChange,
} from './sync-state';
import { child } from "./logger";
import { getDefaultContentFolder, getDefaultContentRoot } from "./site-config";
import {
  contentFolderFromRegistryPath,
  isComponentRegistryContentPath,
  mirrorComponentRegistryToPersistent,
  mirrorComponentRegistryToPersistentForFile,
} from "./component-registry-persistent";
const log = child({ module: "github" });

const FORCE_PULL_TMP_PREFIX = 'website-v3-force-pull-';
const ARCHIVE_DOWNLOAD_STALL_MS = 120_000;

/** Soft pull switches to tarball when changed file count exceeds this (default 20). */
function getSoftPullArchiveThreshold(): number {
  const raw = process.env.GITHUB_SOFT_PULL_ARCHIVE_THRESHOLD;
  const n = raw ? parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : 20;
}


interface GitHubCommitOptions {
  filePath: string;
  content: string;
  message: string;
}

export interface GitHubConfig {
  token: string;
  owner: string;
  repo: string;
  branch: string;
}

interface GitHubFileResponse {
  sha?: string;
  content?: string;
}

export { PendingChange, markFileAsModified };

/**
 * Get the current file's SHA (required for updates)
 */
async function getFileSha(config: GitHubConfig, filePath: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${filePath}?ref=${config.branch}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    
    if (response.status === 404) {
      return null; // File doesn't exist yet
    }
    
    if (!response.ok) {
      log.error('GitHub API error getting file SHA:', response.status, await response.text());
      return null;
    }
    
    const data: GitHubFileResponse = await response.json();
    return data.sha || null;
  } catch (error) {
    log.error({ err: error }, 'Error getting file SHA from GitHub:');
    return null;
  }
}

/**
 * Parse GitHub repo URL to extract owner and repo name
 * Supports formats like:
 * - https://github.com/owner/repo
 * - https://github.com/owner/repo.git
 * - github.com/owner/repo
 */
function parseGitHubUrl(url: string): { owner: string; repo: string } | null {
  try {
    // Remove .git suffix if present
    const cleanUrl = url.replace(/\.git$/, '');
    
    // Try to extract owner/repo from the URL
    const match = cleanUrl.match(/github\.com\/([^\/]+)\/([^\/]+)/);
    if (match) {
      return { owner: match[1], repo: match[2] };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Commit a file to the GitHub repository
 */
export async function commitToGitHub(options: GitHubCommitOptions): Promise<{ success: boolean; error?: string; commitUrl?: string }> {
  // Get config from environment variables
  const token = process.env.GITHUB_TOKEN || '';
  const repoUrl = process.env.GITHUB_REPO_URL || '';
  const branch = process.env.GITHUB_BRANCH || 'main';
  
  // Parse owner/repo from URL
  const parsed = parseGitHubUrl(repoUrl);
  
  const config: GitHubConfig = {
    token,
    owner: parsed?.owner || '',
    repo: parsed?.repo || '',
    branch,
  };
  
  // Check if GitHub sync is enabled (defaults to false)
  const syncEnabled = process.env.GITHUB_SYNC_ENABLED === "true";
  
  // Validate config
  if (!config.token || !config.owner || !config.repo) {
    // If sync is enabled but not configured, return an error
    if (syncEnabled) {
      return { 
        success: false, 
        error: "GitHub integration not configured (missing GITHUB_TOKEN or GITHUB_REPO_URL)" 
      };
    }
    // If sync is disabled, silently skip
    return { success: true };
  }
  
  // If sync is disabled, skip even if configured
  if (!syncEnabled) {
    return { success: true };
  }
  
  try {
    // Get current file SHA (required for updating existing files)
    const sha = await getFileSha(config, options.filePath);
    
    // Prepare the request body
    const body: Record<string, string> = {
      message: options.message,
      content: Buffer.from(options.content).toString('base64'),
      branch: config.branch,
    };
    
    // Include SHA if file exists (for update)
    if (sha) {
      body.sha = sha;
    }
    
    // Make the commit via GitHub Contents API
    const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${options.filePath}`;
    
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(body),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      log.error('GitHub API error:', response.status, errorText);
      return { 
        success: false, 
        error: `GitHub API error: ${response.status}` 
      };
    }
    
    const data = await response.json();
    const commitUrl = data.commit?.html_url;
    
    log.info(`Content committed to GitHub: ${options.filePath}`);
    if (commitUrl) {
      log.info(`Commit URL: ${commitUrl}`);
    }
    
    return { success: true, commitUrl };
  } catch (error) {
    log.error({ err: error }, 'Error committing to GitHub:');
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    };
  }
}

/**
 * Check if GitHub integration is configured
 */
export function isGitHubConfigured(repoUrl?: string): boolean {
  const url = repoUrl || process.env.GITHUB_REPO_URL || '';
  const parsed = parseGitHubUrl(url);
  return !!(process.env.GITHUB_TOKEN && parsed?.owner && parsed?.repo);
}

/**
 * Fetch all content-folder files from a commit tree.
 * Used when there's no lastSyncedCommit to compare against.
 * @param contentFolder - relative content folder name (e.g. site_4geeks-com); defaults to default site from sites.yml
 */
async function fetchFilesFromTree(config: GitHubConfig, commitSha: string, contentFolder?: string): Promise<string[]> {
  const folder = contentFolder || getDefaultContentFolder();
  try {
    // Get the tree for the commit recursively
    const url = `https://api.github.com/repos/${config.owner}/${config.repo}/git/trees/${commitSha}?recursive=1`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    
    if (!response.ok) {
      log.error({ err: response.status }, 'GitHub API error fetching tree:');
      return [];
    }
    
    const data = await response.json();
    
    // Filter to files in this site's content folder only
    const files: string[] = (data.tree || [])
      .filter((item: any) => item.type === 'blob' && item.path.startsWith(`${folder}/`))
      .map((item: any) => item.path);
    
    return files;
  } catch (error) {
    log.error({ err: error }, 'Error fetching files from tree:');
    return [];
  }
}

/**
 * Get GitHub config from environment variables
 */
export function getGitHubConfig(repoUrl?: string): GitHubConfig | null {
  const token = process.env.GITHUB_TOKEN || '';
  const url = repoUrl || process.env.GITHUB_REPO_URL || '';
  const branch = process.env.GITHUB_BRANCH || 'main';
  
  const parsed = parseGitHubUrl(url);
  if (!token || !parsed) return null;
  
  return {
    token,
    owner: parsed.owner,
    repo: parsed.repo,
    branch,
  };
}

interface GitHubBranchRef {
  ref: string;
  object: {
    sha: string;
    type: string;
  };
}

export interface GitHubSyncStatus {
  configured: boolean;
  syncEnabled: boolean;
  autoCommitEnabled?: boolean;
  autoPullEnabled?: boolean;
  localCommit: string | null;
  remoteCommit: string | null;
  status: 'in-sync' | 'behind' | 'ahead' | 'diverged' | 'unknown' | 'not-configured' | 'invalid-credentials' | 'rate-limited';
  behindBy?: number;
  aheadBy?: number;
  repoUrl?: string;
  branch?: string;
  /** Human-readable detail when status is unknown / rate-limited / invalid-credentials. */
  error?: string;
}

/**
 * Get list of pending changes in the content directory
 * Uses file hash comparison instead of git status
 */
export async function getPendingChanges(contentRoot?: string): Promise<PendingChange[]> {
  return detectPendingChanges(contentRoot);
}

/**
 * Create a blob in the GitHub repository
 */
async function createBlob(config: GitHubConfig, content: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/git/blobs`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        content: Buffer.from(content).toString('base64'),
        encoding: 'base64',
      }),
    });
    
    if (!response.ok) {
      log.error({ err: response.status }, 'GitHub API error creating blob:');
      return null;
    }
    
    const data = await response.json();
    return data.sha;
  } catch (error) {
    log.error({ err: error }, 'Error creating blob:');
    return null;
  }
}

/**
 * Get the current tree SHA for a commit
 */
async function getTreeSha(config: GitHubConfig, commitSha: string): Promise<string | null> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/git/commits/${commitSha}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    
    if (!response.ok) {
      log.error({ err: response.status }, 'GitHub API error getting commit:');
      return null;
    }
    
    const data = await response.json();
    return data.tree?.sha || null;
  } catch (error) {
    log.error({ err: error }, 'Error getting tree SHA:');
    return null;
  }
}

/**
 * Create a new tree with updated files
 */
async function createTree(
  config: GitHubConfig,
  baseTreeSha: string,
  files: Array<{ path: string; blobSha: string | null; mode?: string }>
): Promise<string | null> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/git/trees`;
  
  const tree = files.map(file => ({
    path: file.path,
    mode: file.mode || '100644',
    type: 'blob' as const,
    sha: file.blobSha,
  }));
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        base_tree: baseTreeSha,
        tree,
      }),
    });
    
    if (!response.ok) {
      log.error('GitHub API error creating tree:', response.status, await response.text());
      return null;
    }
    
    const data = await response.json();
    return data.sha;
  } catch (error) {
    log.error({ err: error }, 'Error creating tree:');
    return null;
  }
}

/**
 * Create a new commit
 */
async function createCommitObject(
  config: GitHubConfig,
  message: string,
  treeSha: string,
  parentSha: string
): Promise<string | null> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/git/commits`;
  
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        message,
        tree: treeSha,
        parents: [parentSha],
      }),
    });
    
    if (!response.ok) {
      log.error('GitHub API error creating commit:', response.status, await response.text());
      return null;
    }
    
    const data = await response.json();
    return data.sha;
  } catch (error) {
    log.error({ err: error }, 'Error creating commit:');
    return null;
  }
}

/**
 * Update branch ref to point to new commit
 */
async function updateBranchRef(
  config: GitHubConfig,
  commitSha: string,
  force: boolean = false
): Promise<boolean> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/git/refs/heads/${config.branch}`;
  
  try {
    const response = await fetch(url, {
      method: 'PATCH',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify({
        sha: commitSha,
        force,
      }),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      log.error('GitHub API error updating ref:', response.status, errorText);
      return false;
    }
    
    return true;
  } catch (error) {
    log.error({ err: error }, 'Error updating branch ref:');
    return false;
  }
}

/**
 * Get the date of the most recent commit that touched a specific file.
 * Uses the GitHub Commits API filtered by path — returns the file-specific
 * last-change date, not the branch HEAD date.
 * Returns ISO string or null on failure.
 */
async function getFileCommitDate(config: GitHubConfig, filePath: string): Promise<string | null> {
  try {
    const url = `https://api.github.com/repos/${config.owner}/${config.repo}/commits?path=${encodeURIComponent(filePath)}&sha=${encodeURIComponent(config.branch)}&per_page=1`;
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!response.ok) return null;
    const data = await response.json();
    if (!Array.isArray(data) || data.length === 0) return null;
    const commit = data[0].commit;
    return commit?.committer?.date || commit?.author?.date || null;
  } catch {
    return null;
  }
}

/**
 * Get the current branch HEAD SHA, reporting whether a failure was caused by
 * GitHub API rate limiting (429, or 403 with the rate-limit header/message).
 */
async function fetchBranchHead(
  config: GitHubConfig,
): Promise<{ sha: string | null; rateLimited: boolean; error?: string }> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/git/ref/heads/${config.branch}`;

  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });

    if (!response.ok) {
      let bodyMessage = '';
      try {
        bodyMessage = ((await response.json()) as { message?: string })?.message || '';
      } catch {}
      const rateLimited =
        response.status === 429 ||
        (response.status === 403 &&
          (response.headers.get('x-ratelimit-remaining') === '0' || /rate limit/i.test(bodyMessage)));
      const resetHeader = response.headers.get('x-ratelimit-reset');
      const resetHint = resetHeader
        ? ` Resets around ${new Date(Number(resetHeader) * 1000).toLocaleTimeString()}.`
        : '';
      const hint = rateLimited
        ? `GitHub API rate limit exceeded.${resetHint}`
        : response.status === 401
          ? 'Invalid or expired GITHUB_TOKEN'
          : response.status === 404
            ? `Repo or branch not found (or token lacks access): ${config.owner}/${config.repo}@${config.branch}`
            : bodyMessage
              ? `GitHub API ${response.status}: ${bodyMessage}`
              : `GitHub API error ${response.status}`;
      log.error(
        { status: response.status, owner: config.owner, repo: config.repo, branch: config.branch, hint },
        'GitHub API error getting branch head',
      );
      return { sha: null, rateLimited, error: hint };
    }

    const data = await response.json();
    const sha = data.object?.sha || null;
    if (!sha) {
      return { sha: null, rateLimited: false, error: 'Branch ref response did not include a commit SHA' };
    }
    return { sha, rateLimited: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ err: error }, 'Error getting branch head:');
    return { sha: null, rateLimited: false, error: `Network error: ${message}` };
  }
}

/**
 * Get the current branch HEAD SHA
 */
async function getBranchHeadSha(config: GitHubConfig): Promise<string | null> {
  return (await fetchBranchHead(config)).sha;
}

/**
 * Commit all pending changes with a custom message using GitHub API
 * This method uses the Git Data API: create blobs → create tree → create commit → update ref
 */
export async function commitAndPush(
  message: string,
  options?: { force?: boolean; files?: string[]; repoUrl?: string; contentRoot?: string }
): Promise<{ success: boolean; error?: string; commitHash?: string }> {
  const syncEnabled = process.env.GITHUB_SYNC_ENABLED === "true";
  
  if (!syncEnabled) {
    return { success: false, error: "GitHub sync is not enabled" };
  }
  
  const config = getGitHubConfig(options?.repoUrl);
  if (!config) {
    return { success: false, error: "GitHub not configured (missing GITHUB_TOKEN or GITHUB_REPO_URL)" };
  }
  
  try {
    const allPendingChanges = detectPendingChanges(options?.contentRoot);
    const pendingChanges = options?.files?.length
      ? allPendingChanges.filter(c => options.files!.includes(c.file))
      : allPendingChanges;

    if (pendingChanges.length === 0) {
      return { success: false, error: "No pending changes to commit" };
    }
    
    const currentHeadSha = await getBranchHeadSha(config);
    if (!currentHeadSha) {
      return { success: false, error: "Could not get current branch HEAD" };
    }
    
    const lastSyncedCommit = getLastSyncedCommit(options?.contentRoot);
    if (lastSyncedCommit && lastSyncedCommit !== currentHeadSha && !options?.force) {
      // Shared monorepo: HEAD may have moved due to another site's push.
      // Only block if this site's content folder has remote changes in that range.
      const conflictInfo = await getConflictInfo({
        repoUrl: options?.repoUrl,
        contentRoot: options?.contentRoot,
      });
      const { shouldTrackFile } = await import("./sync-state");
      const siteRemoteChanges = conflictInfo.changedFiles.filter((f) =>
        shouldTrackFile(f, undefined, options?.contentRoot),
      );
      if (siteRemoteChanges.length > 0) {
        const { isSeoIndexRelPath, healSeoIndexOnRemoteOverlap } = await import("./seo-index");
        const indexHits = siteRemoteChanges.filter((f) => isSeoIndexRelPath(f, options?.contentRoot));
        if (indexHits.length > 0) {
          healSeoIndexOnRemoteOverlap({
            contentRoot: options?.contentRoot,
            remoteChangedFiles: siteRemoteChanges,
          });
        }
        const remaining = siteRemoteChanges.filter((f) => !isSeoIndexRelPath(f, options?.contentRoot));
        if (remaining.length > 0) {
          return {
            success: false,
            error: "Remote has new commits. Please sync before committing, or use force commit.",
          };
        }
      }
      // No files for this site in the remote range — advance lastSynced and continue.
      updateSyncStateAfterCommit(currentHeadSha, [], options?.contentRoot);
    }
    
    const baseTreeSha = await getTreeSha(config, currentHeadSha);
    if (!baseTreeSha) {
      return { success: false, error: "Could not get base tree" };
    }
    
    const treeEntries: Array<{ path: string; blobSha: string | null }> = [];
    const committedFiles: string[] = [];
    
    for (const change of pendingChanges) {
      if (change.status === 'deleted') {
        treeEntries.push({ path: change.file, blobSha: null });
        committedFiles.push(change.file);
      } else {
        const fullPath = path.join(process.cwd(), change.file);
        if (fs.existsSync(fullPath)) {
          const content = fs.readFileSync(fullPath, 'utf-8');
          const blobSha = await createBlob(config, content);
          if (!blobSha) {
            return { success: false, error: `Failed to create blob for ${change.file}` };
          }
          treeEntries.push({ path: change.file, blobSha });
          committedFiles.push(change.file);
        }
      }
    }
    
    const newTreeSha = await createTree(config, baseTreeSha, treeEntries);
    if (!newTreeSha) {
      return { success: false, error: "Failed to create tree" };
    }
    
    const newCommitSha = await createCommitObject(config, message, newTreeSha, currentHeadSha);
    if (!newCommitSha) {
      return { success: false, error: "Failed to create commit" };
    }
    
    const updated = await updateBranchRef(config, newCommitSha, options?.force);
    if (!updated) {
      return { success: false, error: "Failed to update branch ref" };
    }
    
    updateSyncStateAfterCommit(newCommitSha, committedFiles, options?.contentRoot);

    // So the GitHub webhook skips auto-pull for this self-push (same as auto-commit).
    const { recordLastCommitSha } = await import("./auto-commit");
    recordLastCommitSha(newCommitSha);
    
    log.info(`Committed and pushed to GitHub via API: ${newCommitSha}`);
    return { success: true, commitHash: newCommitSha };
  } catch (error) {
    log.error({ err: error }, 'Error committing and pushing:');
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return { success: false, error: errorMessage };
  }
}

/**
 * Get the sync status between local and remote GitHub repository
 * Uses stored lastSyncedCommit from sync-state instead of git CLI
 */
export async function getGitHubSyncStatus(opts?: { repoUrl?: string; contentRoot?: string }): Promise<GitHubSyncStatus> {
  const syncEnabled = process.env.GITHUB_SYNC_ENABLED === "true";
  const autoCommitEnabled = syncEnabled && process.env.GITHUB_AUTO_COMMIT_ENABLED === 'true';
  const autoPullEnabled = syncEnabled && process.env.GITHUB_AUTO_PULL_ENABLED === 'true';
  const repoUrl = opts?.repoUrl || process.env.GITHUB_REPO_URL;
  const config = getGitHubConfig(repoUrl);
  
  if (!config) {
    return {
      configured: false,
      syncEnabled,
      autoCommitEnabled,
      autoPullEnabled,
      localCommit: null,
      remoteCommit: null,
      status: 'not-configured',
    };
  }
  
  try {
    const localCommit = getLastSyncedCommit(opts?.contentRoot);
    
    const { sha: remoteCommit, rateLimited, error: fetchError } = await fetchBranchHead(config);

    if (!remoteCommit) {
      return {
        configured: true,
        syncEnabled,
        autoCommitEnabled,
        autoPullEnabled,
        localCommit,
        remoteCommit: null,
        status: rateLimited ? 'rate-limited' : 'unknown',
        repoUrl,
        branch: config.branch,
        error: fetchError || (rateLimited
          ? 'GitHub API rate limit exceeded'
          : 'Could not compare local and remote commits'),
      };
    }
    
    if (!localCommit) {
      return {
        configured: true,
        syncEnabled,
        autoCommitEnabled,
        autoPullEnabled,
        localCommit: null,
        remoteCommit,
        status: 'behind',
        repoUrl,
        branch: config.branch,
      };
    }
    
    if (localCommit === remoteCommit) {
      const pendingChanges = detectPendingChanges(opts?.contentRoot);
      const hasPendingChanges = pendingChanges.length > 0;
      
      return {
        configured: true,
        syncEnabled,
        autoCommitEnabled,
        autoPullEnabled,
        localCommit,
        remoteCommit,
        status: hasPendingChanges ? 'ahead' : 'in-sync',
        aheadBy: hasPendingChanges ? pendingChanges.length : 0,
        repoUrl,
        branch: config.branch,
      };
    }

    // Shared monorepo: HEAD may have moved due to another site's push.
    // Only report "behind" if this site's folder has files in that range.
    const conflictInfo = await getConflictInfo({
      repoUrl,
      contentRoot: opts?.contentRoot,
    });
    // On compare API failure, hasConflict is true with empty changedFiles — stay behind.
    if (conflictInfo.changedFiles.length === 0 && !conflictInfo.hasConflict) {
      updateSyncStateAfterCommit(remoteCommit, [], opts?.contentRoot);
      const pendingChanges = detectPendingChanges(opts?.contentRoot);
      const hasPendingChanges = pendingChanges.length > 0;
      return {
        configured: true,
        syncEnabled,
        autoCommitEnabled,
        autoPullEnabled,
        localCommit: remoteCommit,
        remoteCommit,
        status: hasPendingChanges ? 'ahead' : 'in-sync',
        aheadBy: hasPendingChanges ? pendingChanges.length : 0,
        repoUrl,
        branch: config.branch,
      };
    }
    
    return {
      configured: true,
      syncEnabled,
      autoCommitEnabled,
      autoPullEnabled,
      localCommit,
      remoteCommit,
      status: 'behind',
      repoUrl,
      branch: config.branch,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log.error({ err: error }, 'Error checking GitHub sync status:');
    return {
      configured: true,
      syncEnabled,
      autoCommitEnabled,
      autoPullEnabled,
      localCommit: null,
      remoteCommit: null,
      status: 'unknown',
      repoUrl,
      branch: config?.branch,
      error: message,
    };
  }
}

export interface RemoteCommit {
  sha: string;
  message: string;
  author: string;
  date: string;
  files: string[];
}

export interface ConflictInfo {
  hasConflict: boolean;
  behindBy: number;
  commits: RemoteCommit[];
  changedFiles: string[];  // All files changed between lastSyncedCommit and remoteCommit
  fileBlobShas: Record<string, string>;  // Map of filename → Git blob SHA from remote
  lastSyncedCommit: string | null;
  remoteCommit: string | null;
}

/**
 * Get detailed conflict information including missed commits and changed files
 * Uses GitHub Compare API to fetch commits between lastSyncedCommit and current HEAD
 */
export async function getConflictInfo(opts?: { repoUrl?: string; contentRoot?: string }): Promise<ConflictInfo> {
  const config = getGitHubConfig(opts?.repoUrl);
  
  if (!config) {
    return {
      hasConflict: false,
      behindBy: 0,
      commits: [],
      changedFiles: [],
      fileBlobShas: {},
      lastSyncedCommit: null,
      remoteCommit: null,
    };
  }
  
  const lastSyncedCommit = getLastSyncedCommit(opts?.contentRoot);
  const remoteCommit = await getBranchHeadSha(config);
  
  if (!remoteCommit) {
    return {
      hasConflict: false,
      behindBy: 0,
      commits: [],
      changedFiles: [],
      fileBlobShas: {},
      lastSyncedCommit,
      remoteCommit: null,
    };
  }
  
  if (!lastSyncedCommit || lastSyncedCommit === remoteCommit) {
    if (!lastSyncedCommit && remoteCommit) {
      const contentFolder = opts?.contentRoot
        ? (path.isAbsolute(opts.contentRoot) ? path.relative(process.cwd(), opts.contentRoot) : opts.contentRoot)
        : undefined;
      const changedFiles = await fetchFilesFromTree(config, remoteCommit, contentFolder);
      return {
        hasConflict: true,
        behindBy: 1,
        commits: [],
        changedFiles,
        fileBlobShas: {},
        lastSyncedCommit,
        remoteCommit,
      };
    }
    return {
      hasConflict: false,
      behindBy: 0,
      commits: [],
      changedFiles: [],
      fileBlobShas: {},
      lastSyncedCommit,
      remoteCommit,
    };
  }
  
  try {
    const url = `https://api.github.com/repos/${config.owner}/${config.repo}/compare/${lastSyncedCommit}...${remoteCommit}`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    
    if (!response.ok) {
      log.error({ err: response.status }, 'GitHub API error comparing commits:');
      return {
        hasConflict: true,
        behindBy: 1,
        commits: [],
        changedFiles: [],
        fileBlobShas: {},
        lastSyncedCommit,
        remoteCommit,
      };
    }
    
    const data = await response.json();
    
    const commits: RemoteCommit[] = (data.commits || []).map((commit: any) => ({
      sha: commit.sha,
      message: commit.commit?.message || '',
      author: commit.commit?.author?.name || commit.author?.login || 'Unknown',
      date: commit.commit?.author?.date || '',
      files: [],
    }));
    
    const { shouldTrackFile } = await import("./sync-state");
    const allChangedFiles: string[] = (data.files || []).map((f: any) => f.filename);
    const changedFiles = opts?.contentRoot
      ? allChangedFiles.filter((f) => shouldTrackFile(f, undefined, opts.contentRoot))
      : allChangedFiles;
    
    const fileBlobShas: Record<string, string> = {};
    for (const f of (data.files || [])) {
      if (f.filename && f.sha && (!opts?.contentRoot || shouldTrackFile(f.filename, undefined, opts.contentRoot))) {
        fileBlobShas[f.filename] = f.sha;
      }
    }
    
    if (commits.length > 0 && changedFiles.length > 0) {
      commits[commits.length - 1].files = changedFiles;
    }
    
    return {
      hasConflict: changedFiles.length > 0,
      behindBy: data.behind_by || commits.length,
      commits,
      changedFiles,
      fileBlobShas,
      lastSyncedCommit,
      remoteCommit,
    };
  } catch (error) {
    log.error({ err: error }, 'Error getting conflict info:');
    return {
      hasConflict: true,
      behindBy: 1,
      commits: [],
      changedFiles: [],
      fileBlobShas: {},
      lastSyncedCommit,
      remoteCommit,
    };
  }
}

export interface PullConflictCheck {
  hasConflicts: boolean;
  conflictingFiles: string[];
  localPendingFiles: string[];
  remoteChangedFiles: string[];
}

/**
 * Check if pulling from remote would conflict with pending local changes.
 * contentRoot is required so multi-site setups never silently use the default site.
 */
export async function checkPullConflicts(opts: {
  contentRoot: string;
  repoUrl?: string;
}): Promise<PullConflictCheck> {
  if (!opts?.contentRoot?.trim()) {
    throw new Error("contentRoot is required to check pull conflicts for a site");
  }

  const contentRoot = opts.contentRoot.trim();
  const pendingChanges = await getPendingChanges(contentRoot);
  const conflictInfo = await getConflictInfo({
    repoUrl: opts.repoUrl,
    contentRoot,
  });
  
  // Get all local pending file paths
  const localPendingFiles = pendingChanges.map(c => c.file);
  
  // Use changedFiles directly from conflictInfo (filtered by shouldTrackFile for this site)
  const { shouldTrackFile } = await import("./sync-state");
  const remoteChangedFiles = conflictInfo.changedFiles.filter(f =>
    shouldTrackFile(f, undefined, contentRoot),
  );
  
  // Find overlapping files
  const localFileSet = new Set(localPendingFiles);
  const conflictingFiles = remoteChangedFiles.filter(f => localFileSet.has(f));
  
  return {
    hasConflicts: conflictingFiles.length > 0,
    conflictingFiles,
    localPendingFiles,
    remoteChangedFiles,
  };
}

/**
 * Get all sync changes - both local changes that need to be uploaded
 * and incoming remote changes that can be downloaded.
 * Returns unified list with source field indicating the type.
 * 
 * Conflict detection: A file is a conflict only if:
 * 1. It has local changes (localSha differs from remoteSha in sync state)
 * 2. AND it appears in remote changes (remote has commits affecting this file)
 * 3. AND the local change has a remoteSha stored (meaning we've synced before)
 */
export async function getAllSyncChanges(
  contentFolder?: string,
  opts?: { repoUrl?: string },
): Promise<PendingChange[]> {
  const localChanges = await getPendingChanges(contentFolder);
  const conflictInfo = await getConflictInfo({
    repoUrl: opts?.repoUrl,
    contentRoot: contentFolder,
  });
  
  // Use changedFiles directly from conflictInfo (filtered by shouldTrackFile)
  const { shouldTrackFile } = await import("./sync-state");
  const remoteChangedFiles = conflictInfo.changedFiles.filter(f => shouldTrackFile(f, undefined, contentFolder));
  const remoteFileSet = new Set(remoteChangedFiles);
  
  // Build maps for file metadata from commits
  // Extract author from commit message [Author: Name] or fall back to commit author
  const fileAuthorMap = new Map<string, string>();
  const fileDateMap = new Map<string, string>();
  const fileCommitShaMap = new Map<string, string>();
  
  for (const commit of conflictInfo.commits) {
    // Try to extract author from commit message format: [Author: Full Name]
    const authorMatch = commit.message.match(/\[Author:\s*([^\]]+)\]/);
    const author = authorMatch ? authorMatch[1].trim() : commit.author;
    
    for (const file of commit.files || []) {
      // Only set if not already set (first commit wins - most recent)
      if (!fileAuthorMap.has(file)) {
        fileAuthorMap.set(file, author);
        fileDateMap.set(file, commit.date);
        fileCommitShaMap.set(file, commit.sha);
      }
    }
  }
  
  // Create a map of local changes for quick lookup
  const localFileMap = new Map(localChanges.map(c => [c.file, c]));
  
  // Build the unified list
  const changes: PendingChange[] = [];
  
  // Add local changes - check if they're also conflicts
  for (const change of localChanges) {
    // A true conflict requires:
    // 1. File appears in remote changes AND
    // 2. The local change has a remoteSha (we've synced this file before)
    // If no remoteSha, it's a new local file - mark as local, not conflict
    const isRemoteChanged = remoteFileSet.has(change.file);
    const hasSyncedBefore = !!change.remoteSha;
    const isConflict = isRemoteChanged && hasSyncedBefore;
    
    changes.push({
      ...change,
      source: isConflict ? 'conflict' : 'local',
      // For conflicts, include the remote author/date/commitSha
      // For local changes, use stored author from sync state (undefined for legacy entries without author tracking)
      author: isConflict ? fileAuthorMap.get(change.file) : change.author,
      date: isConflict ? fileDateMap.get(change.file) : (change.date || new Date().toISOString()),
      // Use specific commit SHA if mapped, otherwise fall back to remoteCommit (HEAD)
      commitSha: isConflict ? (fileCommitShaMap.get(change.file) || conflictInfo.remoteCommit || undefined) : undefined,
    });
  }
  
  // Add incoming changes (files changed on remote but not locally modified)
  // Filter out files that have already been individually pulled from the current remote commit
  const { wasFilePulledFromCommit } = await import("./sync-state");
  const currentRemoteCommit = conflictInfo.remoteCommit;
  
  for (const filePath of remoteChangedFiles) {
    if (!localFileMap.has(filePath)) {
      // Skip files that have already been pulled from the current remote commit
      if (currentRemoteCommit && wasFilePulledFromCommit(filePath, currentRemoteCommit, contentFolder)) {
        continue;
      }
      
      // Parse content type and slug from file path
      const allDirs = [...getAllDirectories(), "component-registry"];
      const _cf = contentFolder || getDefaultContentFolder();
      const _cfEsc = _cf.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const pathMatch = filePath.match(new RegExp(`${_cfEsc}\\/(${allDirs.join("|")})\\/([^\\/]+)`));
      changes.push({
        file: filePath,
        status: 'modified',
        source: 'incoming',
        contentType: pathMatch?.[1] || 'unknown',
        slug: pathMatch?.[2] || filePath.split('/').pop()?.replace(/\.(yml|yaml)$/, '') || 'unknown',
        localSha: '',
        author: fileAuthorMap.get(filePath),
        date: fileDateMap.get(filePath),
        // Use specific commit SHA if mapped, otherwise fall back to remoteCommit (HEAD)
        commitSha: fileCommitShaMap.get(filePath) || conflictInfo.remoteCommit || undefined,
      });
    }
  }
  
  return changes;
}

/**
 * Sync local state with remote by updating lastSyncedCommit
 * Call this after user chooses to "refresh" and accept remote changes
 * Rebuilds the file hash cache so pending changes shows 0 after sync
 */
export async function syncWithRemote(opts?: {
  repoUrl?: string;
  contentRoot?: string;
}): Promise<{ success: boolean; error?: string }> {
  const config = getGitHubConfig(opts?.repoUrl);
  
  if (!config) {
    return { success: false, error: "GitHub not configured" };
  }
  
  try {
    const remoteCommit = await getBranchHeadSha(config);
    if (!remoteCommit) {
      return { success: false, error: "Could not get remote HEAD" };
    }
    
    // Rebuild sync state from current local files
    // Since local = remote after sync, all hashes should match
    const { rebuildSyncStateFromLocal } = await import("./sync-state");
    rebuildSyncStateFromLocal(remoteCommit, opts?.contentRoot);
    
    return { success: true };
  } catch (error) {
    log.error({ err: error }, 'Error syncing with remote:');
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Reconcile sync state on startup by comparing local file hashes against remote blob SHAs
 * (same approach as website-v3old). If the commit baseline matches HEAD but the deploy
 * disk snapshot is stale, pull those files. Never advance lastSyncedCommit via
 * rebuildSyncStateFromLocal unless local content actually matches remote.
 */
export async function reconcileSyncStateOnStartup(opts?: { repoUrl?: string; contentRoot?: string }): Promise<void> {
  const { withSyncLogContextAsync } = await import("./sync-log");
  return withSyncLogContextAsync(opts?.contentRoot, async () => {
  const config = getGitHubConfig(opts?.repoUrl);
  if (!config) return;

  const { logSync, refreshGithubCommit } = await import("./sync-log");
  refreshGithubCommit();

  try {
    const {
      getLastSyncedCommit,
      rebuildSyncStateFromLocal,
      shouldTrackFile,
      computeGitBlobSha,
      computeFileSha,
      updateFileAfterPull,
      loadSyncState,
    } = await import("./sync-state");
    const lastSyncedCommit = getLastSyncedCommit(opts?.contentRoot);
    const remoteCommit = await getBranchHeadSha(config);

    if (!remoteCommit || !lastSyncedCommit) {
      return;
    }

    const contentFolder = opts?.contentRoot
      ? (path.isAbsolute(opts.contentRoot) ? path.relative(process.cwd(), opts.contentRoot) : opts.contentRoot)
      : getDefaultContentFolder();

    const refreshAfterPull = async (pulledCount: number) => {
      if (pulledCount <= 0) return;
      try {
        const { getSiteContextMap } = await import("./site-manager");
        const { clearRedirectCache } = await import("./redirects");
        const siteCtx = Array.from(getSiteContextMap().values()).find(
          (ctx) => ctx.contentRootName === contentFolder || ctx.contentRoot.endsWith(contentFolder),
        );
        if (siteCtx?.contentIndex) {
          siteCtx.contentIndex.refresh();
        }
        clearRedirectCache();
      } catch (e) {
        log.warn({ err: e }, "[SyncReconcile] Failed to refresh ContentIndex after stale pull");
      }
    };

    if (lastSyncedCommit === remoteCommit) {
      const state = loadSyncState(opts?.contentRoot);
      const staleFiles: string[] = [];

      for (const [filePath, fileInfo] of Object.entries(state.files)) {
        if (!shouldTrackFile(filePath, undefined, opts?.contentRoot) || !fileInfo.remoteSha) continue;

        const fullPath = path.join(process.cwd(), filePath);
        if (!fs.existsSync(fullPath)) {
          staleFiles.push(filePath);
          continue;
        }

        const localContent = fs.readFileSync(fullPath, "utf-8");
        const localSha = computeFileSha(localContent);
        if (localSha !== fileInfo.remoteSha) {
          staleFiles.push(filePath);
        }
      }

      if (staleFiles.length === 0) {
        logSync("RECONCILE", `Already in sync at ${lastSyncedCommit.slice(0, 7)}`);
        return;
      }

      logSync(
        "RECONCILE",
        `Commits match at ${remoteCommit.slice(0, 7)} but ${staleFiles.length} local file(s) are stale (deploy snapshot), pulling from GitHub...`,
      );
      let pulledCount = 0;
      const pullErrors: string[] = [];

      for (const filePath of staleFiles) {
        try {
          const result = await pullSingleFile(filePath, {
            repoUrl: opts?.repoUrl,
            contentRoot: opts?.contentRoot,
          });
          if (result.success) {
            pulledCount++;
          } else {
            pullErrors.push(`${filePath}: ${result.error}`);
          }
        } catch (e) {
          pullErrors.push(`${filePath}: ${e instanceof Error ? e.message : "Unknown error"}`);
        }
      }

      // Only advance baseline when every stale file was restored; otherwise keep
      // prior remoteShas so the next startup / Sync Modal can retry.
      if (pullErrors.length === 0) {
        rebuildSyncStateFromLocal(remoteCommit, opts?.contentRoot);
      }

      if (pulledCount > 0) {
        const short = staleFiles
          .slice(0, 5)
          .map((f) => f.replace(`${contentFolder}/`, ""))
          .join(", ");
        logSync(
          "RECONCILE",
          `Pulled ${pulledCount} stale file(s) from GitHub: ${short}${staleFiles.length > 5 ? ` (+${staleFiles.length - 5} more)` : ""}`,
        );
        await refreshAfterPull(pulledCount);
      }
      if (pullErrors.length > 0) {
        logSync("ERROR", `Failed to pull ${pullErrors.length} stale file(s): ${pullErrors.join("; ")}`);
      }
      return;
    }

    logSync(
      "RECONCILE",
      `Local ${lastSyncedCommit.slice(0, 7)} ≠ remote ${remoteCommit.slice(0, 7)}, checking file hashes...`,
    );

    const conflictInfo = await getConflictInfo({
      repoUrl: opts?.repoUrl,
      contentRoot: opts?.contentRoot,
    });

    const trackedFiles = conflictInfo.changedFiles.filter((f) =>
      shouldTrackFile(f, undefined, opts?.contentRoot),
    );
    if (trackedFiles.length === 0) {
      rebuildSyncStateFromLocal(remoteCommit, opts?.contentRoot);
      logSync("RECONCILE", `No tracked files changed, updated to ${remoteCommit.slice(0, 7)}`);
      return;
    }

    let allReconciled = true;
    let reconciledCount = 0;

    for (const filePath of trackedFiles) {
      const remoteBlobSha = conflictInfo.fileBlobShas[filePath];
      if (!remoteBlobSha) {
        allReconciled = false;
        continue;
      }

      const fullPath = path.join(process.cwd(), filePath);
      if (!fs.existsSync(fullPath)) {
        allReconciled = false;
        continue;
      }

      const localContent = fs.readFileSync(fullPath, "utf-8");
      const localBlobSha = computeGitBlobSha(localContent);

      if (localBlobSha === remoteBlobSha) {
        const fileCommitDate = await getFileCommitDate(config, filePath);
        updateFileAfterPull(filePath, remoteCommit, fileCommitDate || undefined, opts?.contentRoot);
        reconciledCount++;
      } else {
        allReconciled = false;
      }
    }

    if (allReconciled) {
      rebuildSyncStateFromLocal(remoteCommit, opts?.contentRoot);
      logSync("RECONCILE", `All ${reconciledCount} files match remote, updated to ${remoteCommit.slice(0, 7)}`);
    } else {
      logSync(
        "RECONCILE",
        `${reconciledCount}/${trackedFiles.length} files match remote, ${trackedFiles.length - reconciledCount} still differ — deferring pull to auto-pull`,
      );
    }
  } catch (error) {
    logSync("ERROR", `Reconciliation error: ${error instanceof Error ? error.message : String(error)}`);
    log.error({ err: error }, "[SyncReconcile] Error during reconciliation:");
  }
  });
}

/**
 * Auto-pull non-conflicting incoming files from remote.
 * For each changed file: if no local modifications exist, pull silently.
 * Files with local edits are left untouched for manual resolution.
 * @param changedFiles - optional list of file paths from webhook payload; if omitted, uses getAllSyncChanges
 * @param remoteCommitSha - optional commit SHA from webhook payload
 */
export async function autoPullNonConflicting(changedFiles?: string[], remoteCommitSha?: string, opts?: { repoUrl?: string; contentRoot?: string }): Promise<{
  pulled: string[];
  conflicted: string[];
  errors: string[];
}> {
  const config = getGitHubConfig(opts?.repoUrl);
  if (!config) return { pulled: [], conflicted: [], errors: ['GitHub not configured'] };

  const contentFolder = opts?.contentRoot
    ? (path.isAbsolute(opts.contentRoot) ? path.relative(process.cwd(), opts.contentRoot) : opts.contentRoot)
    : getDefaultContentFolder();

  const pulled: string[] = [];
  const conflicted: string[] = [];
  const errors: string[] = [];

  try {
    const { shouldTrackFile } = await import("./sync-state");

    if (changedFiles) {
      const tracked = changedFiles.filter(f => shouldTrackFile(f, undefined, opts?.contentRoot));
      if (tracked.length === 0) return { pulled, conflicted, errors };

      const localChanges = await getPendingChanges(opts?.contentRoot);
      const localFileSet = new Set(localChanges.map(c => c.file));

      for (const filePath of tracked) {
        if (localFileSet.has(filePath)) {
          conflicted.push(filePath);
          continue;
        }
        try {
          const result = await pullSingleFile(filePath, {
            repoUrl: opts?.repoUrl,
            contentRoot: opts?.contentRoot,
          });
          if (result.success) {
            pulled.push(filePath);
          } else {
            errors.push(`${filePath}: ${result.error}`);
          }
        } catch (e) {
          errors.push(`${filePath}: ${e instanceof Error ? e.message : 'Unknown error'}`);
        }
      }
    } else {
      const allChanges = await getAllSyncChanges(contentFolder, { repoUrl: opts?.repoUrl });
      const incomingOnly = allChanges.filter(c => c.source === 'incoming');
      if (incomingOnly.length === 0) return { pulled, conflicted, errors };

      for (const change of incomingOnly) {
        try {
          const result = await pullSingleFile(change.file, {
            repoUrl: opts?.repoUrl,
            contentRoot: opts?.contentRoot,
          });
          if (result.success) {
            pulled.push(change.file);
          } else {
            errors.push(`${change.file}: ${result.error}`);
          }
        } catch (e) {
          errors.push(`${change.file}: ${e instanceof Error ? e.message : 'Unknown error'}`);
        }
      }

      const conflictChanges = allChanges.filter(c => c.source === 'conflict');
      conflicted.push(...conflictChanges.map(c => c.file));
    }

    if (pulled.length > 0 && conflicted.length === 0 && errors.length === 0) {
      const { rebuildSyncStateFromLocal } = await import("./sync-state");
      const commitSha = remoteCommitSha || await getBranchHeadSha(config);
      if (commitSha) {
        rebuildSyncStateFromLocal(commitSha, opts?.contentRoot);
      }
    }

    // Keep in-memory redirects/content index in sync with files just written to disk.
    // Otherwise debug "add redirect" (reads YAML) and "test URL" (reads CI) disagree.
    if (pulled.length > 0) {
      try {
        const { getSiteContextMap } = await import("./site-manager");
        const { clearRedirectCache } = await import("./redirects");
        const folder = contentFolder;
        const siteCtx = Array.from(getSiteContextMap().values()).find(
          (ctx) => ctx.contentRootName === folder || ctx.contentRoot.endsWith(folder),
        );
        if (siteCtx?.contentIndex) {
          siteCtx.contentIndex.refresh();
          clearRedirectCache();
          log.info(
            `[GitHub] Refreshed ContentIndex + redirect cache for ${siteCtx.contentRootName} after pulling ${pulled.length} file(s)`,
          );
        } else {
          clearRedirectCache();
        }
      } catch (e) {
        log.warn(
          { err: e },
          "[GitHub] Failed to refresh ContentIndex after auto-pull — redirect tester may be stale until restart",
        );
      }
    }
  } catch (error) {
    errors.push(error instanceof Error ? error.message : 'Unknown error');
  }

  return { pulled, conflicted, errors };
}

/**
 * Verify GitHub webhook HMAC-SHA256 signature.
 */
export function verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
  const expected = 'sha256=' + crypto.createHmac('sha256', secret).update(payload).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  } catch {
    return false;
  }
}

/**
 * Get the base URL of this application for webhook registration.
 */
function getWebhookBaseUrl(): string | null {
  if (process.env.SITE_URL) {
    return process.env.SITE_URL.replace(/\/$/, '');
  }
  if (process.env.REPLIT_DEV_DOMAIN) {
    return `https://${process.env.REPLIT_DEV_DOMAIN}`;
  }
  return null;
}

/**
 * Returns a human-readable reason when webhook registration should be skipped,
 * or null when registration should proceed.
 */
export function getWebhookSetupSkipReason(baseUrl?: string | null): string | null {
  if (process.env.NODE_ENV !== 'production') {
    return 'webhook registration is skipped in development (NODE_ENV !== production)';
  }

  const resolvedBase = baseUrl ?? getWebhookBaseUrl();
  if (!resolvedBase) {
    return 'No SITE_URL or REPLIT_DEV_DOMAIN set';
  }

  const webhookUrl = `${resolvedBase}/api/github/webhook`;
  try {
    const host = new URL(webhookUrl).hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host.endsWith('.localhost') ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '[::1]'
    ) {
      return `webhook URL ${webhookUrl} is not reachable over the public Internet (localhost)`;
    }
  } catch {
    return `invalid webhook URL derived from base URL: ${resolvedBase}`;
  }

  return null;
}

/**
 * Ensure a GitHub webhook exists for push events.
 * Checks sync state for existing webhook, verifies it's active, creates one if needed.
 * Auto-generates a random secret and stores webhookId + secret in sync state.
 */
export async function ensureWebhook(opts?: { repoUrl?: string; contentRoot?: string }): Promise<void> {
  const { withSyncLogContextAsync } = await import("./sync-log");
  return withSyncLogContextAsync(opts?.contentRoot, async () => {
  const config = getGitHubConfig(opts?.repoUrl);
  if (!config) return;

  const { logSync } = await import("./sync-log");

  const baseUrl = getWebhookBaseUrl();
  const skipReason = getWebhookSetupSkipReason(baseUrl);
  if (skipReason) {
    logSync('WEBHOOK', `Skipped webhook setup: ${skipReason}`);
    return;
  }

  const webhookUrl = `${baseUrl!}/api/github/webhook`;

  try {
    const { getWebhookInfo, setWebhookInfo, clearWebhookInfo } = await import("./sync-state");
    const cr = opts?.contentRoot;
    const existing = getWebhookInfo(cr);

    if (existing) {
      if (existing.webhookUrl === webhookUrl) {
        const isActive = await verifyWebhookExists(config, existing.webhookId);
        if (isActive) {
          logSync('WEBHOOK', `Verified: webhook #${existing.webhookId} is active at ${webhookUrl}`);
          return;
        }
        logSync('WEBHOOK', `Webhook #${existing.webhookId} no longer exists on GitHub, recreating...`);
      } else {
        logSync('WEBHOOK', `URL changed from ${existing.webhookUrl} to ${webhookUrl}, recreating...`);
        await deleteWebhook(config, existing.webhookId);
      }
      clearWebhookInfo(cr);
    }

    const secret = crypto.randomBytes(32).toString('hex');

    const existingHook = await findExistingWebhookOnGitHub(config, webhookUrl);
    let webhookId: number | null = null;

    if (existingHook) {
      webhookId = await adoptWebhook(config, existingHook.id, webhookUrl, secret);
      if (webhookId) {
        setWebhookInfo({
          webhookId,
          webhookSecret: secret,
          webhookUrl,
          createdAt: new Date().toISOString(),
        }, cr);
        logSync('WEBHOOK', `Adopted existing webhook #${webhookId} at ${webhookUrl}`);
      } else {
        logSync('ERROR', `Failed to adopt existing webhook #${existingHook.id}, falling back to create`);
        webhookId = await createWebhook(config, webhookUrl, secret);
        if (webhookId) {
          setWebhookInfo({
            webhookId,
            webhookSecret: secret,
            webhookUrl,
            createdAt: new Date().toISOString(),
          }, cr);
          logSync('WEBHOOK', `Created webhook #${webhookId} at ${webhookUrl}`);
        } else {
          logSync('ERROR', `Failed to create webhook at ${webhookUrl} (check token permissions: needs admin:repo_hook scope)`);
        }
      }
    } else {
      webhookId = await createWebhook(config, webhookUrl, secret);
      if (webhookId) {
        setWebhookInfo({
          webhookId,
          webhookSecret: secret,
          webhookUrl,
          createdAt: new Date().toISOString(),
        }, cr);
        logSync('WEBHOOK', `Created webhook #${webhookId} at ${webhookUrl}`);
      } else {
        logSync('ERROR', `Failed to create webhook at ${webhookUrl} (check token permissions: needs admin:repo_hook scope)`);
      }
    }

    if (webhookId) {
      const deleted = await cleanupDuplicateWebhooks(config, webhookId, webhookUrl);
      if (deleted.length > 0) {
        logSync('WEBHOOK', `Cleaned up ${deleted.length} duplicate webhook(s): #${deleted.join(', #')}`);
      }
    }
  } catch (error) {
    logSync('ERROR', `Webhook setup error: ${error instanceof Error ? error.message : String(error)}`);
    log.error({ err: error }, '[Webhook] Error ensuring webhook:');
  }
  });
}

async function verifyWebhookExists(config: GitHubConfig, webhookId: number): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/hooks/${webhookId}`,
      {
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );
    return response.ok;
  } catch {
    return false;
  }
}

async function findExistingWebhookOnGitHub(config: GitHubConfig, url: string): Promise<{ id: number; config: { url: string } } | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/hooks?per_page=100`,
      {
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );
    if (!response.ok) return null;
    const hooks: Array<{ id: number; config: { url: string } }> = await response.json();
    return hooks.find(h => h.config.url === url) ?? null;
  } catch {
    return null;
  }
}

async function adoptWebhook(
  config: GitHubConfig,
  hookId: number,
  webhookUrl: string,
  newSecret: string,
): Promise<number | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/hooks/${hookId}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        // GitHub requires `url` whenever `config` is sent.
        body: JSON.stringify({
          active: true,
          events: ['push'],
          config: {
            url: webhookUrl,
            content_type: 'json',
            secret: newSecret,
            insecure_ssl: '0',
          },
        }),
      }
    );
    if (!response.ok) {
      const text = await response.text();
      log.error({ err: text }, `[Webhook] GitHub API error adopting webhook: ${response.status}`);
      return null;
    }
    const data = await response.json();
    return data.id;
  } catch (error) {
    log.error({ err: error }, '[Webhook] Error adopting webhook:');
    return null;
  }
}

async function createWebhook(config: GitHubConfig, url: string, secret: string): Promise<number | null> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/hooks`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        body: JSON.stringify({
          name: 'web',
          active: true,
          events: ['push'],
          config: {
            url,
            content_type: 'json',
            secret,
            insecure_ssl: '0',
          },
        }),
      }
    );

    if (!response.ok) {
      const text = await response.text();
      log.error({ err: text }, `[Webhook] GitHub API error creating webhook: ${response.status}`);
      return null;
    }

    const data = await response.json();
    return data.id;
  } catch (error) {
    log.error({ err: error }, '[Webhook] Error creating webhook:');
    return null;
  }
}

export async function cleanupDuplicateWebhooks(config: GitHubConfig, activeWebhookId: number, webhookUrl: string): Promise<number[]> {
  try {
    const response = await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/hooks?per_page=100`,
      {
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );
    if (!response.ok) return [];
    const hooks: Array<{ id: number; config: { url: string } }> = await response.json();
    const duplicates = hooks.filter(h => h.config.url === webhookUrl && h.id !== activeWebhookId);
    await Promise.all(duplicates.map(h => deleteWebhook(config, h.id)));
    return duplicates.map(h => h.id);
  } catch {
    return [];
  }
}

/**
 * Delete every GitHub webhook that targets this app URL, clear local webhook
 * state, then create a fresh hook with a new HMAC secret.
 * Use when signature verification is failing due to a secret mismatch.
 */
export async function forceResetWebhook(opts?: {
  repoUrl?: string;
  contentRoot?: string;
}): Promise<{
  success: boolean;
  message: string;
  deletedIds: number[];
  webhookId?: number;
  webhookUrl?: string;
}> {
  const { withSyncLogContextAsync } = await import("./sync-log");
  return withSyncLogContextAsync(opts?.contentRoot, async () => {
    const config = getGitHubConfig(opts?.repoUrl);
    if (!config) {
      return { success: false, message: "GitHub not configured.", deletedIds: [] };
    }

    const baseUrl = getWebhookBaseUrl();
    const skipReason = getWebhookSetupSkipReason(baseUrl);
    if (skipReason) {
      return { success: false, message: `Skipped: ${skipReason}`, deletedIds: [] };
    }

    const webhookUrl = `${baseUrl!}/api/github/webhook`;
    const { logSync } = await import("./sync-log");
    const { clearWebhookInfo, getWebhookInfo } = await import("./sync-state");

    const deletedIds: number[] = [];
    try {
      const response = await fetch(
        `https://api.github.com/repos/${config.owner}/${config.repo}/hooks?per_page=100`,
        {
          headers: {
            Authorization: `Bearer ${config.token}`,
            Accept: "application/vnd.github.v3+json",
            "X-GitHub-Api-Version": "2022-11-28",
          },
        },
      );
      if (response.ok) {
        const hooks: Array<{ id: number; config: { url: string } }> = await response.json();
        const matching = hooks.filter((h) => h.config.url === webhookUrl);
        await Promise.all(matching.map((h) => deleteWebhook(config, h.id)));
        deletedIds.push(...matching.map((h) => h.id));
        if (matching.length > 0) {
          logSync(
            "WEBHOOK",
            `Force reset: deleted ${matching.length} webhook(s) at ${webhookUrl}: #${matching.map((h) => h.id).join(", #")}`,
          );
        } else {
          logSync("WEBHOOK", `Force reset: no existing webhooks at ${webhookUrl}`);
        }
      } else {
        const text = await response.text();
        logSync("ERROR", `Force reset: failed to list webhooks (${response.status}): ${text}`);
        return {
          success: false,
          message: `Failed to list GitHub webhooks (${response.status}). Check token permissions (admin:repo_hook).`,
          deletedIds,
        };
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      logSync("ERROR", `Force reset: list/delete failed: ${msg}`);
      return { success: false, message: `Failed to delete existing webhooks: ${msg}`, deletedIds };
    }

    clearWebhookInfo(opts?.contentRoot);
    await ensureWebhook({ repoUrl: opts?.repoUrl, contentRoot: opts?.contentRoot });

    const info = getWebhookInfo(opts?.contentRoot);
    if (!info) {
      return {
        success: false,
        message:
          "Deleted existing hooks but failed to register a new one. Check that your GitHub token has the admin:repo_hook scope.",
        deletedIds,
        webhookUrl,
      };
    }

    logSync(
      "WEBHOOK",
      `Force reset complete: webhook #${info.webhookId} active at ${info.webhookUrl}`,
    );
    return {
      success: true,
      message: `Re-setup complete. Deleted ${deletedIds.length} old webhook(s); new webhook #${info.webhookId} is active.`,
      deletedIds,
      webhookId: info.webhookId,
      webhookUrl: info.webhookUrl,
    };
  });
}

async function deleteWebhook(config: GitHubConfig, webhookId: number): Promise<void> {
  try {
    await fetch(
      `https://api.github.com/repos/${config.owner}/${config.repo}/hooks/${webhookId}`,
      {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${config.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );
  } catch {
    // best-effort deletion
  }
}

/**
 * Get file content from GitHub remote
 */
export async function getRemoteFileContent(
  filePath: string,
  opts?: { repoUrl?: string },
): Promise<{
  success: boolean;
  content?: string;
  sha?: string;
  error?: string;
}> {
  const config = getGitHubConfig(opts?.repoUrl);

  if (!config) {
    return { success: false, error: "GitHub not configured" };
  }
  
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${filePath}?ref=${config.branch}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    
    if (response.status === 404) {
      return { success: false, error: "File not found on remote" };
    }
    
    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `GitHub API error: ${response.status} - ${errorText}` };
    }
    
    const data = await response.json();
    
    if (!data.content) {
      if (data.download_url) {
        try {
          const dlResponse = await fetch(data.download_url, {
            headers: {
              'Authorization': `Bearer ${config.token}`,
            },
          });
          if (dlResponse.ok) {
            const content = await dlResponse.text();
            return { success: true, content, sha: data.sha };
          }
        } catch (dlError) {
          log.error({ err: dlError }, 'Error downloading file via download_url:');
        }
      }
      return { success: false, error: "No content in response" };
    }
    
    // GitHub returns content as base64
    const content = Buffer.from(data.content, 'base64').toString('utf-8');
    
    return { success: true, content, sha: data.sha };
  } catch (error) {
    log.error({ err: error }, 'Error fetching remote file:');
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Pull a single file from remote to local
 */
export async function pullSingleFile(
  filePath: string,
  opts?: {
    repoUrl?: string;
    contentRoot?: string;
    /** When set, skip getBranchHeadSha and use this for updateFileAfterPull */
    remoteCommitSha?: string;
    /** When true, skip getFileCommitDate (bulk bootstrap / force pull) */
    skipCommitDate?: boolean;
  },
): Promise<{
  success: boolean;
  error?: string;
}> {
  // Per-file ops: path owns the site (localhost may resolve to the wrong domain).
  const { getSiteConfigs } = await import("./site-config");
  const matchedSite = getSiteConfigs().find((site) => {
    const prefix = site.contentFolder.replace(/\/$/, '') + '/';
    return filePath.startsWith(prefix);
  });
  const contentRoot = matchedSite?.contentFolder || opts?.contentRoot;
  const config = getGitHubConfig(opts?.repoUrl || matchedSite?.githubRepoUrl);

  if (!config) {
    return { success: false, error: "GitHub not configured" };
  }

  // Reuse caller-provided SHA (e.g. bootstrap already fetched HEAD once)
  const remoteCommit = opts?.remoteCommitSha ?? await getBranchHeadSha(config);

  // Fetch file content from remote
  const remoteResult = await getRemoteFileContent(filePath, {
    repoUrl: opts?.repoUrl || matchedSite?.githubRepoUrl,
  });
  
  // If file doesn't exist on remote, delete it locally (reset to remote state)
  if (remoteResult.error === "File not found on remote") {
    try {
      const fullPath = path.join(process.cwd(), filePath);
      
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
        
        // Try to remove parent directory if empty
        const dir = path.dirname(fullPath);
        try {
          const filesInDir = fs.readdirSync(dir);
          if (filesInDir.length === 0) {
            fs.rmdirSync(dir);
          }
        } catch {
          // Ignore errors removing empty directory
        }
      }
      
      // Remove from sync state (scoped to the site that owns this file)
      const { removeFileFromState } = await import("./sync-state");
      removeFileFromState(filePath, contentRoot);

      // Hybrid deploy: registry is a release copy — mirror to persistent so deletes stick.
      mirrorComponentRegistryToPersistentForFile(filePath);

      return { success: true };
    } catch (error) {
      log.error({ err: error }, 'Error deleting local file:');
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }
  
  if (!remoteResult.success || !remoteResult.content) {
    return { success: false, error: remoteResult.error || "Failed to get remote content" };
  }
  
  const fullPath = path.join(process.cwd(), filePath);
  const tmpPath = `${fullPath}.pulltmp`;
  try {
    const dir = path.dirname(fullPath);
    
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    // Clear leftover temp from a prior crash, then write atomically (tmp → rename).
    if (fs.existsSync(tmpPath)) {
      try { fs.unlinkSync(tmpPath); } catch { /* ignore */ }
    }
    fs.writeFileSync(tmpPath, remoteResult.content, 'utf-8');
    fs.renameSync(tmpPath, fullPath);
    
    // Fetch file-specific commit date from GitHub API for accurate lastmod in sitemap.
    // We use the commits-by-path API so that unrelated newer commits on the branch
    // do not inflate the lastmod date for this file.
    // Bulk bootstrap skips this (~1 REST call per file); rebuildSyncStateFromLocal
    // advances sync state from the known headSha instead.
    let committedAt: string | undefined;
    if (!opts?.skipCommitDate) {
      const date = await getFileCommitDate(config, filePath);
      if (date) committedAt = date;
    }

    // Update sync state with the commit we pulled from (per-site when contentRoot is set)
    const { updateFileAfterPull } = await import("./sync-state");
    updateFileAfterPull(filePath, remoteCommit || undefined, committedAt, contentRoot);

    // Hybrid deploy: registry is a release copy — mirror to persistent after pull write.
    mirrorComponentRegistryToPersistentForFile(filePath);

    return { success: true };
  } catch (error) {
    // Leave the original destination untouched; remove a partial temp if present.
    try {
      if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
    } catch { /* ignore cleanup errors */ }
    log.error({ err: error }, 'Error writing file:');
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Commit a single file to remote
 */
export async function commitSingleFile(options: {
  filePath: string;
  message: string;
  author?: string;
  repoUrl?: string;
  contentRoot?: string;
}): Promise<{ 
  success: boolean; 
  commitSha?: string;
  error?: string;
}> {
  // Per-file ops: path owns the site (localhost may resolve to the wrong domain).
  const { getSiteConfigs } = await import("./site-config");
  const matchedSite = getSiteConfigs().find((site) => {
    const prefix = site.contentFolder.replace(/\/$/, '') + '/';
    return options.filePath.startsWith(prefix);
  });
  const contentRoot = matchedSite?.contentFolder || options.contentRoot;
  const config = getGitHubConfig(options.repoUrl || matchedSite?.githubRepoUrl);
  
  if (!config) {
    return { success: false, error: "GitHub not configured" };
  }
  
  const syncEnabled = process.env.GITHUB_SYNC_ENABLED === "true";
  if (!syncEnabled) {
    return { success: false, error: "GitHub sync is disabled" };
  }
  
  const fullPath = path.join(process.cwd(), options.filePath);
  
  // Check if file exists
  if (!fs.existsSync(fullPath)) {
    return { success: false, error: "File not found locally" };
  }
  
  try {
    const content = fs.readFileSync(fullPath, 'utf-8');
    
    // Format commit message with author prefix
    let message = options.message;
    if (options.author) {
      message = `[Author: ${options.author}] ${message}`;
    }
    
    // Get current file SHA (required for updating existing files)
    const sha = await getFileSha(config, options.filePath);
    
    // Prepare the request body
    const body: Record<string, string> = {
      message,
      content: Buffer.from(content).toString('base64'),
      branch: config.branch,
    };
    
    if (sha) {
      body.sha = sha;
    }
    
    // Make the commit via GitHub Contents API
    const url = `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${options.filePath}`;
    
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Accept': 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(body),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      log.error('GitHub API error:', response.status, errorText);
      return { success: false, error: `GitHub API error: ${response.status}` };
    }
    
    const data = await response.json();
    const commitSha = data.commit?.sha;
    
    const { updateFileAfterCommit } = await import("./sync-state");
    updateFileAfterCommit(options.filePath, commitSha || '', contentRoot);

    if (commitSha) {
      const { recordLastCommitSha } = await import("./auto-commit");
      recordLastCommitSha(commitSha);
    }

    const { logSync, refreshGithubCommit } = await import("./sync-log");
    const displayPath = options.filePath.split('/').slice(1).join('/') || options.filePath;
    logSync(
      'COMMIT',
      `${displayPath} → ${commitSha?.slice(0, 7) || '?'}${options.author ? ` by ${options.author}` : ''}`,
      options.author,
      undefined,
      contentRoot,
    );
    refreshGithubCommit();
    
    return { success: true, commitSha };
  } catch (error) {
    log.error({ err: error }, 'Error committing file:');
    return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
  }
}

/**
 * Get file status comparing local vs remote
 */
export async function getRemoteFileStatus(filePath: string): Promise<{
  exists: boolean;
  localSha: string | null;
  remoteSha: string | null;
  hasConflict: boolean;
  status: 'synced' | 'local-only' | 'remote-only' | 'modified' | 'conflict';
  localContent?: string;
  remoteContent?: string;
}> {
  const { getFileStatus, computeFileSha } = await import("./sync-state");
  const localStatus = getFileStatus(filePath);
  
  // Get remote file info
  const remoteResult = await getRemoteFileContent(filePath);
  
  const fullPath = path.join(process.cwd(), filePath);
  let localContent: string | undefined;
  let localSha: string | null = null;
  
  if (fs.existsSync(fullPath)) {
    localContent = fs.readFileSync(fullPath, 'utf-8');
    localSha = computeFileSha(localContent);
  }
  
  const remoteSha = remoteResult.sha || null;
  const remoteContent = remoteResult.content;
  
  // Compute remote content SHA for comparison
  let remoteContentSha: string | null = null;
  if (remoteContent) {
    remoteContentSha = computeFileSha(remoteContent);
  }
  
  // Determine status
  if (!localSha && !remoteContentSha) {
    return { exists: false, localSha: null, remoteSha: null, hasConflict: false, status: 'synced' };
  }
  
  if (localSha && !remoteContentSha) {
    return { exists: true, localSha, remoteSha: null, hasConflict: false, status: 'local-only', localContent };
  }
  
  if (!localSha && remoteContentSha) {
    return { exists: false, localSha: null, remoteSha: remoteContentSha, hasConflict: false, status: 'remote-only', remoteContent };
  }
  
  if (localSha === remoteContentSha) {
    return { exists: true, localSha, remoteSha: remoteContentSha, hasConflict: false, status: 'synced', localContent, remoteContent };
  }
  
  // Check if there's a conflict (both local and remote have been modified)
  // Conflict = stored remoteSha differs from current remote, AND local differs from stored remote
  const hasConflict = localStatus.remoteSha !== null && 
                      localStatus.remoteSha !== remoteContentSha && 
                      localSha !== localStatus.remoteSha;
  
  return { 
    exists: true, 
    localSha, 
    remoteSha: remoteContentSha, 
    hasConflict, 
    status: hasConflict ? 'conflict' : 'modified',
    localContent,
    remoteContent,
  };
}

/**
 * Live progress state for bootstrapContentFromRemote().
 * Keyed by content folder so multi-site pulls do not clobber each other.
 */
export type BootstrapPullMode = "files" | "archive";
export type BootstrapPullPhase =
  | "listing"
  | "downloading"
  | "extracting"
  | "replacing"
  | "finalizing"
  | "complete";

export interface BootstrapState {
  running: boolean;
  total: number;
  pulled: number;
  skipped: number;
  errors: string[];
  /** Paths successfully downloaded this run */
  pulledFiles: string[];
  /** Paths skipped because local hash matched remote */
  skippedFiles: string[];
  /** Local tracked paths removed because they were missing on GitHub (force pull only) */
  deleted: number;
  deletedFiles: string[];
  startedAt: number | null;
  doneAt: number | null;
  success: boolean | null;
  commitSha: string | null;
  cancelled: boolean;
  /** files = hash-diff / Contents API; archive = force tarball pull */
  mode: BootstrapPullMode;
  phase: BootstrapPullPhase;
  archiveBytesDownloaded: number;
  archiveBytesTotal: number | null;
  extracted: number;
  replaced: number;
  lastReplacedFile: string | null;
  /** When set, replacing-phase denominator (changed files only). Null = use total. */
  replaceTotal: number | null;
}

function emptyBootstrapState(): BootstrapState {
  return {
    running: false,
    total: 0,
    pulled: 0,
    skipped: 0,
    errors: [],
    pulledFiles: [],
    skippedFiles: [],
    deleted: 0,
    deletedFiles: [],
    startedAt: null,
    doneAt: null,
    success: null,
    commitSha: null,
    cancelled: false,
    mode: "files",
    phase: "listing",
    archiveBytesDownloaded: 0,
    archiveBytesTotal: null,
    extracted: 0,
    replaced: 0,
    lastReplacedFile: null,
    replaceTotal: null,
  };
}

/** Normalize contentRoot to a stable map key (relative content folder name). */
function bootstrapStateKey(contentRoot?: string): string {
  if (!contentRoot) return getDefaultContentFolder();
  return (path.isAbsolute(contentRoot) ? path.relative(process.cwd(), contentRoot) : contentRoot)
    .replace(/\\/g, '/')
    .replace(/^\/|\/$/g, '');
}

const _bootstrapStates = new Map<string, BootstrapState>();
const _bootstrapCancelRequested = new Map<string, boolean>();
const _bootstrapAbortControllers = new Map<string, AbortController>();

function getOrCreateBootstrapState(contentRoot?: string): BootstrapState {
  const key = bootstrapStateKey(contentRoot);
  let state = _bootstrapStates.get(key);
  if (!state) {
    state = emptyBootstrapState();
    _bootstrapStates.set(key, state);
  }
  return state;
}

export function getBootstrapState(contentRoot?: string): Readonly<BootstrapState> {
  const state = getOrCreateBootstrapState(contentRoot);
  return {
    ...state,
    errors: [...state.errors],
    pulledFiles: [...state.pulledFiles],
    skippedFiles: [...state.skippedFiles],
    deletedFiles: [...state.deletedFiles],
  };
}

/**
 * Request cooperative cancel of an in-progress bootstrap/pull for a site.
 * Aborts in-flight tarball download immediately; file loops stop between entries.
 */
export function requestBootstrapCancel(contentRoot?: string): { ok: boolean; running: boolean } {
  const key = bootstrapStateKey(contentRoot);
  const state = getOrCreateBootstrapState(contentRoot);
  if (!state.running) {
    return { ok: false, running: false };
  }
  _bootstrapCancelRequested.set(key, true);
  const ac = _bootstrapAbortControllers.get(key);
  if (ac) {
    try {
      ac.abort();
    } catch {
      // ignore
    }
  }
  return { ok: true, running: true };
}

function isBootstrapCancelRequested(contentRoot?: string): boolean {
  return _bootstrapCancelRequested.get(bootstrapStateKey(contentRoot)) === true;
}

function clearBootstrapCancelRequested(contentRoot?: string): void {
  const key = bootstrapStateKey(contentRoot);
  _bootstrapCancelRequested.delete(key);
  _bootstrapAbortControllers.delete(key);
}

function registerBootstrapAbortController(contentRoot: string | undefined, ac: AbortController): void {
  _bootstrapAbortControllers.set(bootstrapStateKey(contentRoot), ac);
}

/**
 * Path to the bootstrap-complete marker for the default site (when contentRoot omitted).
 */
export function getBootstrapCompleteFlagPath(): string {
  return bootstrapFlagPath();
}

function bootstrapFlagPath(contentRoot?: string): string {
  const folder = contentRoot
    ? (path.isAbsolute(contentRoot) ? path.relative(process.cwd(), contentRoot) : contentRoot)
    : getDefaultContentFolder();
  const abs = path.isAbsolute(folder) ? folder : path.join(process.cwd(), folder);
  return path.join(abs, '.bootstrap-complete');
}

/**
 * Returns true if a previous bootstrap run completed without errors.
 * Accepts an optional contentRoot to support per-site bootstrap tracking.
 */
export function isBootstrapComplete(contentRoot?: string): boolean {
  return fs.existsSync(bootstrapFlagPath(contentRoot));
}

/**
 * Pull a single file with up to `maxRetries` attempts using exponential back-off.
 * Retries on any failure; returns the last error if all attempts are exhausted.
 */
async function pullWithRetry(
  filePath: string,
  maxRetries: number = 3,
  baseDelayMs: number = 1000,
  opts?: {
    repoUrl?: string;
    contentRoot?: string;
    remoteCommitSha?: string;
    skipCommitDate?: boolean;
  },
): Promise<{ success: boolean; error?: string }> {
  let lastError: string | undefined;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await pullSingleFile(filePath, opts);
      if (result.success) return result;
      lastError = result.error;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
    if (attempt < maxRetries) {
      const delay = baseDelayMs * Math.pow(2, attempt - 1);
      log.warn(
        { filePath, attempt, maxRetries, delayMs: delay, error: lastError },
        'Bootstrap: pullSingleFile failed, retrying after back-off...',
      );
      await new Promise<void>(r => setTimeout(r, delay));
    }
  }
  return { success: false, error: lastError };
}

function failBootstrapState(state: BootstrapState, errors: string[]): void {
  state.running = false;
  state.errors = errors;
  state.startedAt = state.startedAt ?? Date.now();
  state.doneAt = Date.now();
  state.success = false;
  state.cancelled = false;
  state.phase = "complete";
}

function resetBootstrapProgressFields(state: BootstrapState, mode: BootstrapPullMode): void {
  state.mode = mode;
  state.phase = "listing";
  state.archiveBytesDownloaded = 0;
  state.archiveBytesTotal = null;
  state.extracted = 0;
  state.replaced = 0;
  state.lastReplacedFile = null;
  state.replaceTotal = null;
  state.deleted = 0;
  state.deletedFiles = [];
}

function sweepForcePullTempArtifacts(siteKey: string): void {
  const tmp = os.tmpdir();
  let entries: string[] = [];
  try {
    entries = fs.readdirSync(tmp);
  } catch {
    return;
  }
  const sitePrefix = `${FORCE_PULL_TMP_PREFIX}${siteKey}-`;
  for (const name of entries) {
    if (!name.startsWith(FORCE_PULL_TMP_PREFIX)) continue;
    // Prefer deleting this site's leftovers; also sweep any orphaned force-pull temps.
    if (!name.startsWith(sitePrefix) && !name.startsWith(FORCE_PULL_TMP_PREFIX)) continue;
    const full = path.join(tmp, name);
    try {
      fs.rmSync(full, { recursive: true, force: true });
    } catch (err) {
      log.warn({ err, full }, "Force-pull: failed to sweep leftover temp artifact");
    }
  }
}

function rmForcePullPath(target: string | null | undefined): void {
  if (!target) return;
  try {
    fs.rmSync(target, { recursive: true, force: true });
  } catch (err) {
    log.warn({ err, target }, "Force-pull: failed to remove temp path");
  }
}

function walkFilesRecursive(dir: string, baseDir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      walkFilesRecursive(full, baseDir, out);
    } else if (entry.isFile()) {
      out.push(path.relative(baseDir, full).split(path.sep).join("/"));
    }
  }
}

async function downloadGithubTarball(
  config: GitHubConfig,
  headSha: string,
  destPath: string,
  opts: {
    signal: AbortSignal;
    abort: () => void;
    onBytes?: (downloaded: number, total: number | null) => void;
  },
): Promise<void> {
  const url = `https://api.github.com/repos/${config.owner}/${config.repo}/tarball/${headSha}`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "website-v3-force-pull",
    },
    signal: opts.signal,
    redirect: "follow",
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`GitHub tarball download failed: ${response.status} ${body.slice(0, 300)}`);
  }
  if (!response.body) {
    throw new Error("GitHub tarball download returned an empty body");
  }

  const contentLengthHeader = response.headers.get("content-length");
  const totalBytes =
    contentLengthHeader && /^\d+$/.test(contentLengthHeader)
      ? Number(contentLengthHeader)
      : null;

  const fileHandle = fs.createWriteStream(destPath);
  let downloaded = 0;
  let lastByteAt = Date.now();
  opts.onBytes?.(0, totalBytes);

  const stallTimer = setInterval(() => {
    if (Date.now() - lastByteAt > ARCHIVE_DOWNLOAD_STALL_MS) {
      opts.abort();
      fileHandle.destroy(new Error("Archive download stalled (no bytes received for 120s)"));
    }
  }, 5_000);

  try {
    const nodeStream = Readable.fromWeb(response.body as import("stream/web").ReadableStream);
    nodeStream.on("data", (chunk: Buffer | string) => {
      const size = typeof chunk === "string" ? Buffer.byteLength(chunk) : chunk.length;
      downloaded += size;
      lastByteAt = Date.now();
      opts.onBytes?.(downloaded, totalBytes);
    });
    await pipeline(nodeStream, fileHandle);
  } finally {
    clearInterval(stallTimer);
  }
}

/**
 * Force-pull site content by downloading the repo tarball once, extracting the
 * content folder into staging, then atomically replacing live files.
 */
async function forcePullContentFromTarball(
  config: GitHubConfig,
  headSha: string,
  contentFolder: string,
  opts: {
    contentRoot?: string;
    state: BootstrapState;
    expectedFileCount: number;
    /** When set, only replace these normalized paths (soft-pull archive fast path). */
    onlyPaths?: Set<string>;
  },
): Promise<{
  success: boolean;
  cancelled?: boolean;
  pulled: number;
  pulledFiles: string[];
  error?: string;
}> {
  const siteKey = bootstrapStateKey(opts.contentRoot).replace(/[^a-zA-Z0-9._-]/g, "_");
  sweepForcePullTempArtifacts(siteKey);

  const runId = `${siteKey}-${process.pid}-${Date.now()}`;
  const archivePath = path.join(os.tmpdir(), `${FORCE_PULL_TMP_PREFIX}${runId}.tar.gz`);
  const stagingDir = path.join(os.tmpdir(), `${FORCE_PULL_TMP_PREFIX}${runId}`);
  const folder = contentFolder.replace(/^\/+|\/+$/g, "");
  const ac = new AbortController();
  registerBootstrapAbortController(opts.contentRoot, ac);

  const pulledFiles: string[] = [];
  let cancelled = false;
  let downloadStalled = false;

  try {
    if (isBootstrapCancelRequested(opts.contentRoot)) {
      return { success: false, cancelled: true, pulled: 0, pulledFiles };
    }

    fs.mkdirSync(stagingDir, { recursive: true });

    opts.state.phase = "downloading";
    opts.state.archiveBytesDownloaded = 0;
    opts.state.archiveBytesTotal = null;

    try {
      await downloadGithubTarball(config, headSha, archivePath, {
        signal: ac.signal,
        abort: () => {
          downloadStalled = true;
          ac.abort();
        },
        onBytes: (downloaded, total) => {
          opts.state.archiveBytesDownloaded = downloaded;
          opts.state.archiveBytesTotal = total;
        },
      });
    } catch (err) {
      if (downloadStalled) {
        return {
          success: false,
          pulled: 0,
          pulledFiles,
          error: "Archive download stalled (no bytes received for 120s)",
        };
      }
      if (ac.signal.aborted || isBootstrapCancelRequested(opts.contentRoot)) {
        return { success: false, cancelled: true, pulled: 0, pulledFiles };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, pulled: 0, pulledFiles, error: msg };
    }

    if (isBootstrapCancelRequested(opts.contentRoot) || ac.signal.aborted) {
      return { success: false, cancelled: true, pulled: 0, pulledFiles };
    }

    opts.state.phase = "extracting";
    opts.state.extracted = 0;

    try {
      await tar.x({
        file: archivePath,
        cwd: stagingDir,
        strip: 1,
        preservePaths: false,
        // Only materialize regular files/dirs under the site content folder.
        filter: (entryPath, entry) => {
          const normalized = entryPath.replace(/\\/g, "/").replace(/^\.?\//, "");
          if (normalized.includes("..") || path.isAbsolute(entryPath)) {
            return false;
          }
          const type = String((entry as { type?: string }).type ?? "");
          if (
            type === "SymbolicLink" ||
            type === "Link" ||
            type === "BlockDevice" ||
            type === "CharacterDevice" ||
            type === "FIFO"
          ) {
            return false;
          }
          // Archive paths are either `{contentFolder}/...` (after strip) or
          // `{repoRoot}/{contentFolder}/...` (before strip, depending on tar version).
          const parts = normalized.split("/").filter(Boolean);
          const withoutRoot = parts.length > 1 ? parts.slice(1).join("/") : normalized;
          return (
            normalized === folder ||
            normalized.startsWith(`${folder}/`) ||
            withoutRoot === folder ||
            withoutRoot.startsWith(`${folder}/`)
          );
        },
        onentry: (entry) => {
          const type = String((entry as { type?: string }).type ?? "");
          const isFile = type === "File" || type === "0" || type === "";
          if (!isFile) return;
          opts.state.extracted += 1;
        },
      });
    } catch (err) {
      if (isBootstrapCancelRequested(opts.contentRoot) || ac.signal.aborted) {
        return { success: false, cancelled: true, pulled: 0, pulledFiles };
      }
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, pulled: 0, pulledFiles, error: `Archive extraction failed: ${msg}` };
    }

    if (isBootstrapCancelRequested(opts.contentRoot)) {
      return { success: false, cancelled: true, pulled: 0, pulledFiles };
    }

    const contentStagingRoot = path.join(stagingDir, folder);
    if (!fs.existsSync(contentStagingRoot)) {
      return {
        success: false,
        pulled: 0,
        pulledFiles,
        error: `Archive did not contain content folder "${folder}"`,
      };
    }

    const relativeFiles: string[] = [];
    walkFilesRecursive(contentStagingRoot, stagingDir, relativeFiles);
    // Reconcile extracted count with walked files (authoritative).
    opts.state.extracted = relativeFiles.length;

    opts.state.phase = "replacing";
    opts.state.replaced = 0;
    opts.state.pulled = 0;
    opts.state.pulledFiles = [];
    opts.state.lastReplacedFile = null;

    for (const relativePath of relativeFiles) {
      if (isBootstrapCancelRequested(opts.contentRoot)) {
        cancelled = true;
        break;
      }

      const normalized = relativePath.replace(/\\/g, "/");
      if (!normalized.startsWith(`${folder}/`) && normalized !== folder) {
        continue;
      }
      if (normalized.includes("..")) {
        continue;
      }
      if (opts.onlyPaths && !opts.onlyPaths.has(normalized)) {
        continue;
      }

      const stagedFile = path.join(stagingDir, normalized);
      const destFile = path.join(process.cwd(), normalized);
      const destDir = path.dirname(destFile);
      const tmpPath = `${destFile}.pulltmp`;

      try {
        if (!fs.existsSync(destDir)) {
          fs.mkdirSync(destDir, { recursive: true });
        }
        if (fs.existsSync(tmpPath)) {
          try {
            fs.unlinkSync(tmpPath);
          } catch {
            /* ignore */
          }
        }
        // Binary-safe copy into same-directory temp, then atomic rename (avoids EXDEV).
        fs.copyFileSync(stagedFile, tmpPath);
        fs.renameSync(tmpPath, destFile);

        pulledFiles.push(normalized);
        opts.state.replaced = pulledFiles.length;
        opts.state.pulled = pulledFiles.length;
        opts.state.pulledFiles = [...pulledFiles];
        opts.state.lastReplacedFile = normalized;
      } catch (err) {
        try {
          if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);
        } catch {
          /* ignore */
        }
        const msg = err instanceof Error ? err.message : String(err);
        return {
          success: false,
          pulled: pulledFiles.length,
          pulledFiles,
          error: `${normalized}: ${msg}`,
        };
      }
    }

    if (cancelled) {
      return { success: false, cancelled: true, pulled: pulledFiles.length, pulledFiles };
    }

    const expected =
      opts.onlyPaths && opts.onlyPaths.size > 0
        ? opts.onlyPaths.size
        : opts.expectedFileCount;
    if (expected > 0 && pulledFiles.length !== expected) {
      log.warn(
        {
          expected,
          replaced: pulledFiles.length,
          contentFolder: folder,
          filtered: !!opts.onlyPaths,
        },
        "Force-pull: replaced file count differs from expected",
      );
    }

    return { success: true, pulled: pulledFiles.length, pulledFiles };
  } finally {
    rmForcePullPath(archivePath);
    rmForcePullPath(stagingDir);
  }
}

/**
 * Delete tracked local content files that are not present on the remote path set.
 * Used by force pull so local disk matches GitHub (soft pull does not prune).
 */
function pruneLocalFilesMissingFromRemote(
  remotePaths: Iterable<string>,
  contentRoot?: string,
): { deleted: number; deletedFiles: string[] } {
  const remoteSet = new Set(
    Array.from(remotePaths).map((p) => p.replace(/\\/g, "/")),
  );
  const contentFolder = (
    contentRoot
      ? path.isAbsolute(contentRoot)
        ? path.relative(process.cwd(), contentRoot)
        : contentRoot
      : getDefaultContentFolder()
  )
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  const contentRootAbs = path.join(process.cwd(), contentFolder);
  const deletedFiles: string[] = [];

  for (const filePath of getAllContentFiles(contentRoot)) {
    const normalized = filePath.replace(/\\/g, "/");
    if (remoteSet.has(normalized)) continue;

    const fullPath = path.join(process.cwd(), normalized);
    try {
      if (!fs.existsSync(fullPath)) continue;
      fs.unlinkSync(fullPath);
      deletedFiles.push(normalized);

      let dir = path.dirname(fullPath);
      while (dir.startsWith(contentRootAbs + path.sep)) {
        try {
          const remaining = fs.readdirSync(dir);
          if (remaining.length > 0) break;
          fs.rmdirSync(dir);
          dir = path.dirname(dir);
        } catch {
          break;
        }
      }
    } catch (err) {
      log.warn({ err, filePath: normalized }, "Force-pull: failed to prune local-only file");
    }
  }

  // After pruning release copies, sync component-registry trees back to persistent/
  // so the next atomic deploy does not resurrect deleted registry files.
  if (deletedFiles.length > 0) {
    const sites = new Set<string>();
    for (const f of deletedFiles) {
      if (!isComponentRegistryContentPath(f)) continue;
      const site = contentFolderFromRegistryPath(f);
      if (site) sites.add(site);
    }
    for (const site of sites) {
      mirrorComponentRegistryToPersistent(site);
    }
  }

  return { deleted: deletedFiles.length, deletedFiles };
}

async function refreshContentAfterBootstrapPull(
  contentFolder: string,
  pulledCount: number,
): Promise<void> {
  if (pulledCount <= 0) return;
  try {
    const { getSiteContextMap } = await import("./site-manager");
    const { clearRedirectCache } = await import("./redirects");
    const siteCtx = Array.from(getSiteContextMap().values()).find(
      (ctx) => ctx.contentRootName === contentFolder || ctx.contentRoot.endsWith(contentFolder),
    );
    if (siteCtx?.contentIndex) {
      siteCtx.contentIndex.refresh();
      clearRedirectCache();
      log.info(
        `[GitHub] Refreshed ContentIndex + redirect cache for ${siteCtx.contentRootName} after bootstrap pull of ${pulledCount} file(s)`,
      );
    } else {
      clearRedirectCache();
    }
  } catch (e) {
    log.warn(
      { err: e },
      "[GitHub] Failed to refresh ContentIndex after bootstrap pull — may be stale until restart",
    );
  }
}

export async function bootstrapContentFromRemote(opts?: {
  repoUrl?: string;
  contentRoot?: string;
  /** When true, re-download every remote file. When false (default), skip files whose local git blob SHA matches remote. */
  force?: boolean;
}): Promise<{
  success: boolean;
  pulled: number;
  skipped: number;
  errors: string[];
  commitSha: string | null;
  cancelled?: boolean;
}> {
  const { withSyncLogContextAsync } = await import('./sync-log');
  return withSyncLogContextAsync(opts?.contentRoot, async () => {
  const { logSync } = await import('./sync-log');
  const force = opts?.force === true;
  const state = getOrCreateBootstrapState(opts?.contentRoot);

  // Mark as started immediately so /pull-all-status can surface progress or failures
  // (including early exits for missing config / bad credentials).
  clearBootstrapCancelRequested(opts?.contentRoot);
  state.running = true;
  state.total = 0;
  state.pulled = 0;
  state.skipped = 0;
  state.errors = [];
  state.pulledFiles = [];
  state.skippedFiles = [];
  state.startedAt = Date.now();
  state.doneAt = null;
  state.success = null;
  state.commitSha = null;
  state.cancelled = false;
  resetBootstrapProgressFields(state, force ? "archive" : "files");

  try {
  const config = getGitHubConfig(opts?.repoUrl);
  if (!config) {
    const msg =
      'GitHub not configured (missing GITHUB_TOKEN or repo URL). ' +
      'Set GITHUB_REPO_URL or pass the site github_repo_url from sites.yml.';
    log.error(
      { repoUrl: opts?.repoUrl || process.env.GITHUB_REPO_URL || null, hasToken: !!process.env.GITHUB_TOKEN },
      `Bootstrap aborted: ${msg}`,
    );
    logSync('ERROR', `Bootstrap aborted: ${msg}`);
    failBootstrapState(state, [msg]);
    return { success: false, pulled: 0, skipped: 0, errors: [msg], commitSha: null };
  }

  logSync(
    'AUTO-PULL',
    `Bootstrap: starting ${force ? 'full (tarball)' : 'partial (hash-diff)'} content pull from ${config.owner}/${config.repo}@${config.branch}...`,
  );

  const headSha = await getBranchHeadSha(config);
  if (!headSha) {
    const msg =
      `Could not get remote branch HEAD for ${config.owner}/${config.repo}@${config.branch}. ` +
      'Check GITHUB_TOKEN (401 = invalid/expired or insufficient permissions) and that the branch exists.';
    log.error({ owner: config.owner, repo: config.repo, branch: config.branch }, `Bootstrap failed: ${msg}`);
    logSync('ERROR', `Bootstrap failed: ${msg}`);
    failBootstrapState(state, [msg]);
    return { success: false, pulled: 0, skipped: 0, errors: [msg], commitSha: null };
  }

  state.commitSha = headSha;

  const contentFolder = opts?.contentRoot
    ? (path.isAbsolute(opts.contentRoot) ? path.relative(process.cwd(), opts.contentRoot) : opts.contentRoot)
    : getDefaultContentFolder();

  // One recursive tree call → path + blob SHA. Fall back to path-only list if the tree call fails.
  let remoteEntries: Array<{ path: string; sha: string | null }> = [];
  const remoteShas = await fetchRemoteTreeShas(config, headSha, contentFolder);
  if (remoteShas.size > 0) {
    remoteEntries = Array.from(remoteShas.entries()).map(([filePath, sha]) => ({ path: filePath, sha }));
  } else {
    const files = await fetchFilesFromTree(config, headSha, contentFolder);
    remoteEntries = files.map((filePath) => ({ path: filePath, sha: null }));
  }

  if (remoteEntries.length === 0) {
    logSync('AUTO-PULL', `Bootstrap: no ${contentFolder} files found on remote`);
    // Mark as complete even when there's nothing to pull — directory is in sync.
    writeBootstrapCompleteFlag(opts?.contentRoot);
    state.running = false;
    state.phase = "complete";
    state.doneAt = Date.now();
    state.success = true;
    return { success: true, pulled: 0, skipped: 0, errors: [], commitSha: headSha };
  }

  state.total = remoteEntries.length;
  logSync(
    'AUTO-PULL',
    `Bootstrap: found ${remoteEntries.length} files on remote, ${force ? 'downloading archive...' : 'diffing local hashes...'}`,
  );

  let pulled = 0;
  let skipped = 0;
  const errors: string[] = [];
  const pulledFiles: string[] = [];
  const skippedFiles: string[] = [];
  let wasCancelled = false;

  if (force) {
    const archiveResult = await forcePullContentFromTarball(config, headSha, contentFolder, {
      contentRoot: opts?.contentRoot,
      state,
      expectedFileCount: remoteEntries.length,
    });

    clearBootstrapCancelRequested(opts?.contentRoot);

    if (archiveResult.cancelled) {
      logSync('AUTO-PULL', `Bootstrap cancelled (tarball): pulled=${archiveResult.pulled}`);
      log.info(`Bootstrap cancelled (tarball): pulled=${archiveResult.pulled}, sha=${headSha}`);
      state.running = false;
      state.pulled = archiveResult.pulled;
      state.pulledFiles = [...archiveResult.pulledFiles];
      state.skipped = 0;
      state.doneAt = Date.now();
      state.success = false;
      state.cancelled = true;
      state.phase = "complete";
      return {
        success: false,
        pulled: archiveResult.pulled,
        skipped: 0,
        errors: [],
        commitSha: headSha,
        cancelled: true,
      };
    }

    if (!archiveResult.success) {
      const errMsg = archiveResult.error || "Force pull via tarball failed";
      errors.push(errMsg);
      state.errors = [...errors];
      state.pulled = archiveResult.pulled;
      state.pulledFiles = [...archiveResult.pulledFiles];
      state.running = false;
      state.doneAt = Date.now();
      state.success = false;
      state.cancelled = false;
      state.phase = "complete";
      logSync('ERROR', `Bootstrap tarball pull failed: ${errMsg}`);
      return {
        success: false,
        pulled: archiveResult.pulled,
        skipped: 0,
        errors,
        commitSha: headSha,
      };
    }

    pulled = archiveResult.pulled;
    pulledFiles.push(...archiveResult.pulledFiles);
    if (
      remoteEntries.length > 0 &&
      pulled !== remoteEntries.length
    ) {
      const notice = `Replaced ${pulled} files from archive but remote tree listed ${remoteEntries.length} (non-fatal)`;
      logSync('AUTO-PULL', `Bootstrap: ${notice}`);
    }

    state.phase = "finalizing";
    const syncedRemotePaths =
      pulledFiles.length > 0 ? pulledFiles : remoteEntries.map((e) => e.path);
    const pruneResult = pruneLocalFilesMissingFromRemote(syncedRemotePaths, opts?.contentRoot);
    state.deleted = pruneResult.deleted;
    state.deletedFiles = [...pruneResult.deletedFiles];
    if (pruneResult.deleted > 0) {
      logSync(
        "AUTO-PULL",
        `Bootstrap: pruned ${pruneResult.deleted} local-only file(s) missing on GitHub`,
      );
    }

    const { rebuildSyncStateFromLocal } = await import('./sync-state');
    rebuildSyncStateFromLocal(headSha, opts?.contentRoot, {
      syncedRemotePaths,
    });
    writeBootstrapCompleteFlag(opts?.contentRoot);
    await refreshContentAfterBootstrapPull(contentFolder, pulled + pruneResult.deleted);
    logSync(
      'AUTO-PULL',
      `Bootstrap: tarball pulled=${pulled} deleted=${pruneResult.deleted} — sync state updated to ${headSha.slice(0, 7)}`,
    );
    log.info(
      `Bootstrap complete (tarball): pulled=${pulled}, deleted=${pruneResult.deleted}, sha=${headSha}`,
    );

    state.running = false;
    state.pulled = pulled;
    state.skipped = 0;
    state.pulledFiles = [...pulledFiles];
    state.doneAt = Date.now();
    state.success = true;
    state.cancelled = false;
    state.phase = "complete";

    return { success: true, pulled, skipped: 0, errors: [], commitSha: headSha };
  }

  // Soft pull: hash-diff pre-pass, then per-file or archive fast path.
  const changedEntries: Array<{ path: string; sha: string | null }> = [];
  for (const entry of remoteEntries) {
    if (isBootstrapCancelRequested(opts?.contentRoot)) {
      wasCancelled = true;
      break;
    }
    const { path: filePath, sha: remoteSha } = entry;
    if (remoteSha) {
      const fullPath = path.join(process.cwd(), filePath);
      if (fs.existsSync(fullPath)) {
        try {
          const content = fs.readFileSync(fullPath);
          if (computeGitBlobSha(content) === remoteSha) {
            skipped++;
            skippedFiles.push(filePath);
            state.skipped = skipped;
            state.skippedFiles = [...skippedFiles];
            continue;
          }
        } catch {
          // Fall through — treat as changed if local read fails
        }
      }
    }
    changedEntries.push(entry);
  }

  if (wasCancelled) {
    clearBootstrapCancelRequested(opts?.contentRoot);
    logSync('AUTO-PULL', `Bootstrap cancelled during diff: skipped=${skipped}`);
    log.info(`Bootstrap cancelled during soft-pull diff: skipped=${skipped}, sha=${headSha}`);
    state.running = false;
    state.pulled = 0;
    state.skipped = skipped;
    state.skippedFiles = [...skippedFiles];
    state.doneAt = Date.now();
    state.success = false;
    state.cancelled = true;
    state.phase = "complete";
    return {
      success: false,
      pulled: 0,
      skipped,
      errors: [],
      commitSha: headSha,
      cancelled: true,
    };
  }

  const threshold = getSoftPullArchiveThreshold();
  const useArchive = changedEntries.length > threshold;

  if (changedEntries.length === 0) {
    logSync(
      'AUTO-PULL',
      `Bootstrap: diff changed=0 skipped=${skipped} → no-op`,
    );
  } else if (useArchive) {
    logSync(
      'AUTO-PULL',
      `Bootstrap: diff changed=${changedEntries.length} skipped=${skipped} → archive (threshold=${threshold})`,
    );
    state.mode = "archive";
    state.replaceTotal = changedEntries.length;

    const onlyPaths = new Set(changedEntries.map((e) => e.path.replace(/\\/g, "/")));
    const archiveResult = await forcePullContentFromTarball(config, headSha, contentFolder, {
      contentRoot: opts?.contentRoot,
      state,
      expectedFileCount: changedEntries.length,
      onlyPaths,
    });

    clearBootstrapCancelRequested(opts?.contentRoot);

    if (archiveResult.cancelled) {
      logSync(
        'AUTO-PULL',
        `Bootstrap cancelled (soft archive): pulled=${archiveResult.pulled} skipped=${skipped}`,
      );
      state.running = false;
      state.pulled = archiveResult.pulled;
      state.pulledFiles = [...archiveResult.pulledFiles];
      state.skipped = skipped;
      state.skippedFiles = [...skippedFiles];
      state.doneAt = Date.now();
      state.success = false;
      state.cancelled = true;
      state.phase = "complete";
      return {
        success: false,
        pulled: archiveResult.pulled,
        skipped,
        errors: [],
        commitSha: headSha,
        cancelled: true,
      };
    }

    if (!archiveResult.success) {
      const errMsg = archiveResult.error || "Soft pull via tarball failed";
      errors.push(errMsg);
      state.errors = [...errors];
      state.pulled = archiveResult.pulled;
      state.pulledFiles = [...archiveResult.pulledFiles];
      state.skipped = skipped;
      state.skippedFiles = [...skippedFiles];
      state.running = false;
      state.doneAt = Date.now();
      state.success = false;
      state.cancelled = false;
      state.phase = "complete";
      logSync('ERROR', `Bootstrap soft-archive pull failed: ${errMsg}`);
      return {
        success: false,
        pulled: archiveResult.pulled,
        skipped,
        errors,
        commitSha: headSha,
      };
    }

    pulled = archiveResult.pulled;
    pulledFiles.push(...archiveResult.pulledFiles);
  } else {
    logSync(
      'AUTO-PULL',
      `Bootstrap: diff changed=${changedEntries.length} skipped=${skipped} → per-file (threshold=${threshold})`,
    );

    const pullOpts = {
      repoUrl: opts?.repoUrl,
      contentRoot: opts?.contentRoot,
      remoteCommitSha: headSha,
      skipCommitDate: true,
    };
    for (const { path: filePath } of changedEntries) {
      if (isBootstrapCancelRequested(opts?.contentRoot)) {
        wasCancelled = true;
        break;
      }

      const result = await pullWithRetry(filePath, 3, 1000, pullOpts);
      if (result.success) {
        pulled++;
        pulledFiles.push(filePath);
        state.pulled = pulled;
        state.pulledFiles = [...pulledFiles];
      } else {
        const errMsg = `${filePath}: ${result.error || 'unknown error'}`;
        errors.push(errMsg);
        state.errors = [...errors];
      }
    }

    clearBootstrapCancelRequested(opts?.contentRoot);

    if (wasCancelled) {
      logSync('AUTO-PULL', `Bootstrap cancelled: pulled=${pulled} skipped=${skipped}`);
      log.info(`Bootstrap cancelled: pulled=${pulled}, skipped=${skipped}, sha=${headSha}`);
      state.running = false;
      state.pulled = pulled;
      state.skipped = skipped;
      state.doneAt = Date.now();
      state.success = false;
      state.cancelled = true;
      state.phase = "complete";
      return {
        success: false,
        pulled,
        skipped,
        errors: [],
        commitSha: headSha,
        cancelled: true,
      };
    }
  }

  // Soft-pull finalize (shared by no-op / per-file / archive).
  if (errors.length === 0) {
    state.phase = "finalizing";
    const { rebuildSyncStateFromLocal } = await import('./sync-state');
    rebuildSyncStateFromLocal(headSha, opts?.contentRoot, {
      syncedRemotePaths: remoteEntries.map((e) => e.path),
    });
    writeBootstrapCompleteFlag(opts?.contentRoot);
    await refreshContentAfterBootstrapPull(contentFolder, pulled);
    logSync(
      'AUTO-PULL',
      `Bootstrap: pulled=${pulled} skipped=${skipped} — sync state updated to ${headSha.slice(0, 7)}`,
    );
  } else {
    logSync(
      'ERROR',
      `Bootstrap: pulled=${pulled} skipped=${skipped} of ${remoteEntries.length}; ${errors.length} failed after retries — ${errors.join(' | ')}`,
    );
    log.error(
      { failedFiles: errors },
      'Bootstrap: the following files could not be pulled after all retries; bootstrap is marked INCOMPLETE and will be re-attempted on next startup',
    );
    logSync('AUTO-PULL', `Bootstrap: sync state NOT updated — next startup will re-attempt the bootstrap`);
  }

  log.info(`Bootstrap complete: pulled=${pulled}, skipped=${skipped}, errors=${errors.length}, sha=${headSha}`);

  state.running = false;
  state.pulled = pulled;
  state.skipped = skipped;
  state.skippedFiles = [...skippedFiles];
  state.pulledFiles = [...pulledFiles];
  state.doneAt = Date.now();
  state.success = errors.length === 0;
  state.cancelled = false;
  state.phase = "complete";

  return { success: errors.length === 0, pulled, skipped, errors, commitSha: headSha };
  } catch (error) {
  clearBootstrapCancelRequested(opts?.contentRoot);
  const msg = error instanceof Error ? error.message : String(error);
  log.error({ err: error }, 'Bootstrap: unexpected failure');
  logSync('ERROR', `Bootstrap failed unexpectedly: ${msg}`);
  failBootstrapState(state, [`Bootstrap failed unexpectedly: ${msg}`]);
  return {
    success: false,
    pulled: state.pulled,
    skipped: state.skipped,
    errors: state.errors,
    commitSha: null,
  };
  }
  });
}

/**
 * Write (or overwrite) the bootstrap-complete marker file so future startups
 * know the content directory is fully populated.
 * Also exported so the startup routine can stamp existing deployments that
 * predate the flag (migration path).
 */
export function writeBootstrapCompleteFlag(contentRoot?: string): void {
  try {
    const flagPath = bootstrapFlagPath(contentRoot);
    const dir = path.dirname(flagPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(flagPath, new Date().toISOString(), 'utf-8');
  } catch (e) {
    log.warn({ err: e }, 'Bootstrap: could not write bootstrap-complete flag');
  }
}

/**
 * Walk the local 4geeks-com/ directory and commit every file to the
 * configured remote GitHub repo using commitToGitHub (one file at a time).
 *
 * Intended as a one-time seed operation when creating a fresh content repo
 * from an existing folder.
 *
 * Returns a summary of committed files and any errors encountered.
 */
/**
 * Compute the git blob SHA for a buffer — identical to what GitHub stores.
 * Formula: sha1("blob " + byteLength + "\0" + content)
 */
function computeGitBlobSha(content: Buffer): string {
  const header = Buffer.from(`blob ${content.length}\0`);
  const hash = crypto.createHash('sha1');
  hash.update(header);
  hash.update(content);
  return hash.digest('hex');
}

/**
 * Fetch a map of { path → blobSha } for every file in the remote tree under
 * the given commit.  Returns an empty map on failure so callers fall back to
 * uploading/pulling everything.
 * @param contentFolder - when set, only include blobs under `{folder}/`
 */
async function fetchRemoteTreeShas(
  config: GitHubConfig,
  commitSha: string,
  contentFolder?: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const prefix = contentFolder ? `${contentFolder.replace(/\/$/, '')}/` : null;
  try {
    const url = `https://api.github.com/repos/${config.owner}/${config.repo}/git/trees/${commitSha}?recursive=1`;
    const res = await fetch(url, {
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/vnd.github.v3+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (!res.ok) return map;
    const data = await res.json() as { tree?: Array<{ type: string; path: string; sha: string }> };
    for (const item of data.tree ?? []) {
      if (item.type !== 'blob') continue;
      if (prefix && !item.path.startsWith(prefix)) continue;
      map.set(item.path, item.sha);
    }
  } catch {
    // silently return empty map — caller will upload/pull everything
  }
  return map;
}

export type PushProgressEvent =
  | { type: "diff"; toUpload: number; skipped: number; created: number; updated: number }
  | { type: "uploading"; done: number; total: number; file: string }
  | { type: "done"; created: string[]; updated: string[]; skipped: string[]; errors: string[]; commitSha?: string };

export async function pushAllContentToRemote(opts?: {
  contentRoot?: string;
  repoUrl?: string;
  commitMessage?: string;
  onProgress?: (event: PushProgressEvent) => void;
}): Promise<{
  committed: string[];
  skipped: string[];
  errors: string[];
  commitSha: string | null;
}> {
  const { withSyncLogContextAsync } = await import('./sync-log');
  return withSyncLogContextAsync(opts?.contentRoot, async () => {
  const syncEnabled = process.env.GITHUB_SYNC_ENABLED === 'true';
  if (!syncEnabled) {
    return { committed: [], skipped: [], errors: ['GitHub sync is not enabled (GITHUB_SYNC_ENABLED != true)'], commitSha: null };
  }

  const config = getGitHubConfig(opts?.repoUrl);
  if (!config) {
    return { committed: [], skipped: [], errors: ['GitHub not configured (missing GITHUB_TOKEN or GITHUB_REPO_URL)'], commitSha: null };
  }

  const { logSync } = await import('./sync-log');

  const contentDir = opts?.contentRoot
    ? (path.isAbsolute(opts.contentRoot) ? opts.contentRoot : path.join(process.cwd(), opts.contentRoot))
    : getDefaultContentRoot();
  const contentFolderName = path.relative(process.cwd(), contentDir);
  if (!fs.existsSync(contentDir)) {
    return { committed: [], skipped: [], errors: [`${contentFolderName}/ directory does not exist`], commitSha: null };
  }

  // Explicit denylist: internal runtime state files that must never be pushed
  // to a public/shared content repo because they may contain webhook secrets
  // or other deployment-specific credentials.
  const DENIED_FILENAMES = new Set(['.sync-state.json', '.sync-state.txt', '.gitkeep']);
  const DENIED_SUFFIX_RE = /\.(sync-state|sync-log|webhook-state)\.(json|txt)$/i;

  function isSafeToCommit(entryName: string): boolean {
    if (entryName.startsWith('.')) return false;
    if (DENIED_FILENAMES.has(entryName)) return false;
    if (DENIED_SUFFIX_RE.test(entryName)) return false;
    return true;
  }

  function walkDir(dir: string, base: string): string[] {
    const results: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!isSafeToCommit(entry.name)) continue;
      const full = path.join(dir, entry.name);
      const rel = path.join(base, entry.name).replace(/\\/g, '/');
      if (entry.isDirectory()) results.push(...walkDir(full, rel));
      else results.push(rel);
    }
    return results;
  }

  const allFiles = walkDir(contentDir, contentFolderName);

  // ── Step 1: get current HEAD + fetch remote tree SHAs for diffing ──
  const headSha = await getBranchHeadSha(config);
  const remoteShas = headSha ? await fetchRemoteTreeShas(config, headSha) : new Map<string, string>();

  logSync(
    'AUTO-PULL',
    `Push-all: ${allFiles.length} local files, ${remoteShas.size} remote files — diffing...`
  );

  // ── Step 2: diff — only upload blobs for new/changed files ──
  const errors: string[] = [];
  const skipped: string[] = [];
  // GitHub secondary rate limit kicks in with too many concurrent writes.
  // 3 parallel blob uploads + a short pause between batches stays well under it.
  const CONCURRENCY = 3;
  const BATCH_PAUSE_MS = 300;
  const blobEntries: Array<{ path: string; blobSha: string }> = [];

  // Separate files that need uploading from those already in sync
  const filesToUpload: Array<{ relPath: string; content: Buffer; isNew: boolean }> = [];
  for (const relPath of allFiles) {
    try {
      const fullPath = path.join(process.cwd(), relPath);
      const content = fs.readFileSync(fullPath);
      const localSha = computeGitBlobSha(content);
      const remoteSha = remoteShas.get(relPath);
      if (remoteSha && remoteSha === localSha) {
        skipped.push(relPath);
        // Still include in blobEntries using the known remote SHA (tree needs it)
        blobEntries.push({ path: relPath, blobSha: remoteSha });
      } else {
        filesToUpload.push({ relPath, content, isNew: !remoteShas.has(relPath) });
      }
    } catch (e) {
      errors.push(`${relPath}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  log.info(
    `Push-all: ${filesToUpload.length} changed/new, ${skipped.length} unchanged (skipping upload), ${errors.length} read errors`
  );

  const diffCreated = filesToUpload.filter(f => f.isNew).length;
  const diffUpdated = filesToUpload.filter(f => !f.isNew).length;
  opts?.onProgress?.({ type: "diff", toUpload: filesToUpload.length, skipped: skipped.length, created: diffCreated, updated: diffUpdated });

  if (filesToUpload.length === 0 && errors.length === 0) {
    logSync('AUTO-PULL', `Push-all: nothing to do — all ${skipped.length} files already up to date`);
    opts?.onProgress?.({ type: "done", created: [], updated: [], skipped, errors: [], commitSha: headSha ?? undefined });
    return { committed: [], skipped, errors: [], commitSha: headSha };
  }

  // ── Step 3: upload blobs only for changed/new files ──
  const createdFiles: string[] = [];
  const updatedFiles: string[] = [];

  for (let i = 0; i < filesToUpload.length; i += CONCURRENCY) {
    const batch = filesToUpload.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map(async ({ relPath, content, isNew }) => {
        try {
          const response = await fetch(
            `https://api.github.com/repos/${config.owner}/${config.repo}/git/blobs`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${config.token}`,
                Accept: 'application/vnd.github.v3+json',
                'Content-Type': 'application/json',
                'X-GitHub-Api-Version': '2022-11-28',
              },
              body: JSON.stringify({ content: content.toString('base64'), encoding: 'base64' }),
            }
          );
          if (!response.ok) {
            const msg = await response.text();
            errors.push(`${relPath}: blob upload failed (${response.status}): ${msg}`);
            return null;
          }
          const data = await response.json() as { sha: string };
          return { path: relPath, blobSha: data.sha, isNew };
        } catch (e) {
          errors.push(`${relPath}: ${e instanceof Error ? e.message : String(e)}`);
          return null;
        }
      })
    );
    for (const r of results) {
      if (r) {
        blobEntries.push({ path: r.path, blobSha: r.blobSha });
        if (r.isNew) createdFiles.push(r.path);
        else updatedFiles.push(r.path);
      }
    }
    const doneSoFar = Math.min(i + CONCURRENCY, filesToUpload.length);
    log.info(`Push-all: blobs uploaded ${doneSoFar}/${filesToUpload.length}`);
    opts?.onProgress?.({ type: "uploading", done: doneSoFar, total: filesToUpload.length, file: batch[batch.length - 1].relPath });
    // Pause between batches to avoid GitHub secondary rate limits
    if (i + CONCURRENCY < filesToUpload.length) {
      await new Promise(resolve => setTimeout(resolve, BATCH_PAUSE_MS));
    }
  }

  const changedEntries = blobEntries.filter(e => !skipped.includes(e.path));
  if (changedEntries.length === 0) {
    opts?.onProgress?.({ type: "done", created: createdFiles, updated: updatedFiles, skipped, errors });
    return { committed: [], skipped, errors, commitSha: null };
  }

  // ── Step 4: create a single tree with ALL files (changed + unchanged) ──
  let treeSha: string | null = headSha ? await getTreeSha(config, headSha) : null;
  const parentShas = headSha ? [headSha] : [];

  const treePayload = blobEntries.map(e => ({
    path: e.path,
    mode: '100644' as const,
    type: 'blob' as const,
    sha: e.blobSha,
  }));

  const treeBody: Record<string, unknown> = { tree: treePayload };
  if (treeSha) treeBody.base_tree = treeSha;

  const treeRes = await fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/git/trees`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(treeBody),
    }
  );
  if (!treeRes.ok) {
    const msg = await treeRes.text();
    const treeErrors = [`Tree creation failed (${treeRes.status}): ${msg}`, ...errors];
    opts?.onProgress?.({ type: "done", created: createdFiles, updated: updatedFiles, skipped, errors: treeErrors });
    return { committed: [], skipped, errors: treeErrors, commitSha: null };
  }
  const newTreeSha = ((await treeRes.json()) as { sha: string }).sha;

  // ── Step 5: create commit ──
  const commitBody: Record<string, unknown> = {
    message: opts?.commitMessage ?? `[push-all] sync ${changedEntries.length} changed file(s) from ${contentFolderName}/`,
    tree: newTreeSha,
  };
  if (parentShas.length) commitBody.parents = parentShas;

  const commitRes = await fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/git/commits`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(commitBody),
    }
  );
  if (!commitRes.ok) {
    const msg = await commitRes.text();
    const commitErrors = [`Commit creation failed (${commitRes.status}): ${msg}`, ...errors];
    opts?.onProgress?.({ type: "done", created: createdFiles, updated: updatedFiles, skipped, errors: commitErrors });
    return { committed: [], skipped, errors: commitErrors, commitSha: null };
  }
  const newCommitSha = ((await commitRes.json()) as { sha: string }).sha;

  // ── Step 6: update (or create) branch ref ──
  const updateRes = await fetch(
    `https://api.github.com/repos/${config.owner}/${config.repo}/git/refs/heads/${config.branch}`,
    {
      method: headSha ? 'PATCH' : 'POST',
      headers: {
        Authorization: `Bearer ${config.token}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(
        headSha
          ? { sha: newCommitSha, force: true }
          : { ref: `refs/heads/${config.branch}`, sha: newCommitSha }
      ),
    }
  );
  if (!updateRes.ok) {
    const msg = await updateRes.text();
    const refErrors = [`Ref update failed (${updateRes.status}): ${msg}`, ...errors];
    opts?.onProgress?.({ type: "done", created: createdFiles, updated: updatedFiles, skipped, errors: refErrors });
    return { committed: [], skipped, errors: refErrors, commitSha: null };
  }

  const committed = changedEntries.map(e => e.path);
  const { recordLastCommitSha } = await import("./auto-commit");
  recordLastCommitSha(newCommitSha);
  logSync(
    'AUTO-PULL',
    `Push-all: commit ${newCommitSha.slice(0, 7)} — ${committed.length} synced, ${skipped.length} skipped, ${errors.length} errors`
  );
  log.info(`Push-all complete: commit=${newCommitSha}, synced=${committed.length}, skipped=${skipped.length}, errors=${errors.length}`);

  opts?.onProgress?.({ type: "done", created: createdFiles, updated: updatedFiles, skipped, errors, commitSha: newCommitSha });
  return { committed, skipped, errors, commitSha: newCommitSha };
  });
}

export interface GitHubSeedResult {
  attempted: boolean;
  success: boolean;
  committed: string[];
  skipped: string[];
  errors: string[];
  commitSha: string | null;
  reason?: string;
}

/**
 * Push a newly scaffolded site's content folder to its dedicated GitHub repo,
 * then initialize per-site sync state so a restart cannot clobber local files.
 * Only affects the given contentRoot — no other sites are touched.
 */
export async function seedNewSiteToGitHub(opts: {
  contentRoot: string;
  repoUrl: string;
}): Promise<GitHubSeedResult> {
  const empty: GitHubSeedResult = {
    attempted: false,
    success: false,
    committed: [],
    skipped: [],
    errors: [],
    commitSha: null,
  };

  if (process.env.GITHUB_SYNC_ENABLED !== 'true') {
    return { ...empty, reason: 'GitHub sync is not enabled (GITHUB_SYNC_ENABLED != true)' };
  }

  if (!isGitHubConfigured(opts.repoUrl)) {
    return { ...empty, reason: 'GitHub not configured (missing GITHUB_TOKEN or invalid repo URL)' };
  }

  const pushResult = await pushAllContentToRemote({
    contentRoot: opts.contentRoot,
    repoUrl: opts.repoUrl,
    commitMessage: `[site-create] Initial scaffold for ${opts.contentRoot}`,
  });

  const result: GitHubSeedResult = {
    attempted: true,
    success: false,
    committed: pushResult.committed,
    skipped: pushResult.skipped,
    errors: pushResult.errors,
    commitSha: pushResult.commitSha,
  };

  if (!pushResult.commitSha) {
    if (pushResult.errors.length === 0) {
      result.errors = ['Push completed but no commit SHA was returned'];
    }
    return result;
  }

  const { rebuildSyncStateFromLocal } = await import('./sync-state');
  rebuildSyncStateFromLocal(pushResult.commitSha, opts.contentRoot, {
    syncedRemotePaths: pushResult.committed,
  });
  writeBootstrapCompleteFlag(opts.contentRoot);
  await ensureWebhook({ repoUrl: opts.repoUrl, contentRoot: opts.contentRoot });

  result.success = pushResult.errors.length === 0;
  return result;
}
