/**
 * Auto-sync must not overwrite GitHub changes this server never pulled.
 *
 * Each tracked file's sync state keeps `remoteSha`: the content hash of the version this
 * server last pulled or pushed (its baseline). Before pushing, the file on GitHub is
 * compared against that baseline; if GitHub moved on, the push is a conflict for staff.
 */

import { computeFileSha, computeGitBlobSha } from "./sync-state";

export type RemoteFileState = { exists: false } | { exists: true; content: string };

export type OverlapDecision =
  | { action: "push" }
  | { action: "in_sync" }
  | { action: "conflict"; reason: string };

/**
 * `local` is the file on disk (null = deleted locally). `baseline` is the sync-state
 * `remoteSha` (content sha256; a git blob sha1 is accepted too).
 */
export function decideRemoteOverlap(input: {
  local: string | null;
  baseline?: string | null;
  remote: RemoteFileState;
}): OverlapDecision {
  const { local, baseline, remote } = input;

  if (!remote.exists) {
    if (local === null) return { action: "in_sync" };
    if (baseline) return { action: "conflict", reason: "deleted on GitHub since this server last synced it" };
    return { action: "push" };
  }

  if (local !== null && remote.content === local) return { action: "in_sync" };
  if (baseline && (computeFileSha(remote.content) === baseline || computeGitBlobSha(remote.content) === baseline)) {
    return { action: "push" };
  }
  return {
    action: "conflict",
    reason: baseline
      ? "changed on GitHub since this server last synced it"
      : "exists on GitHub but this server never synced it",
  };
}

export type GitHubRepoRef = { token: string; owner: string; repo: string };

export function githubHeaders(config: Pick<GitHubRepoRef, "token">, accept = "application/vnd.github.v3+json"): Record<string, string> {
  return {
    Authorization: `Bearer ${config.token}`,
    Accept: accept,
    "Content-Type": "application/json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

function contentsUrl(config: GitHubRepoRef, filePath: string): string {
  const encoded = filePath.split("/").map(encodeURIComponent).join("/");
  return `https://api.github.com/repos/${config.owner}/${config.repo}/contents/${encoded}`;
}

/** File on GitHub at `ref` (raw bytes, works past the 1 MB JSON content limit). */
export async function fetchRemoteFile(
  config: GitHubRepoRef,
  filePath: string,
  ref: string,
): Promise<RemoteFileState | { error: string }> {
  try {
    const res = await fetch(`${contentsUrl(config, filePath)}?ref=${encodeURIComponent(ref)}`, {
      headers: githubHeaders(config, "application/vnd.github.raw"),
    });
    if (res.status === 404) return { exists: false };
    if (!res.ok) return { error: `GitHub answered ${res.status} reading ${filePath}` };
    return { exists: true, content: await res.text() };
  } catch (err) {
    return { error: `Network error reading ${filePath}: ${err instanceof Error ? err.message : String(err)}` };
  }
}

/** Raw content of one git blob (the exact version a Contents API PUT would replace). */
export async function fetchRemoteBlob(
  config: GitHubRepoRef,
  blobSha: string,
): Promise<RemoteFileState | { error: string }> {
  try {
    const res = await fetch(`https://api.github.com/repos/${config.owner}/${config.repo}/git/blobs/${blobSha}`, {
      headers: githubHeaders(config, "application/vnd.github.raw"),
    });
    if (!res.ok) return { error: `GitHub answered ${res.status} reading blob ${blobSha.slice(0, 7)}` };
    return { exists: true, content: await res.text() };
  } catch (err) {
    return { error: `Network error reading blob: ${err instanceof Error ? err.message : String(err)}` };
  }
}

export type OverlapCheck = {
  push: Set<string>;
  inSync: string[];
  conflicts: Array<{ path: string; reason: string }>;
};

/**
 * Sort a batch into files safe to push, files already identical on GitHub, and conflicts.
 * `baselineOf` returns the sync-state `remoteSha` for a path.
 */
export async function checkRemoteOverlap(
  config: GitHubRepoRef,
  ref: string,
  files: Array<{ path: string; content: string | null }>,
  baselineOf: (path: string) => string | undefined,
): Promise<OverlapCheck | { error: string }> {
  const out: OverlapCheck = { push: new Set(), inSync: [], conflicts: [] };
  for (const file of files) {
    const remote = await fetchRemoteFile(config, file.path, ref);
    if ("error" in remote) return { error: remote.error };
    const decision = decideRemoteOverlap({ local: file.content, baseline: baselineOf(file.path), remote });
    if (decision.action === "push") out.push.add(file.path);
    else if (decision.action === "in_sync") out.inSync.push(file.path);
    else out.conflicts.push({ path: file.path, reason: decision.reason });
  }
  return out;
}
