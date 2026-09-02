/**
 * MCP / queue:true GitHub commits — one files[] request, never parallel Contents PUTs.
 * Auto-commit on → mark pending and 202. Auto-commit off → mark then one tree commit.
 */

import { markFileAsModified, detectPendingChanges } from "./sync-state";
import { isAutoCommitEnabled } from "./auto-commit";
import { commitAndPush } from "./github";
import {
  resolveCommitGitHubToken,
  GitHubConnectError,
} from "./github-user-tokens";
import { formatAgentAuthorLabel } from "@shared/git-commit-attribution";
import type { EventActor } from "./events/types";

export type QueueOrCommitResult =
  | { status: 202; queued: true; files: string[]; author: string }
  | { status: 200; success: true; commitHash?: string }
  | { status: 400; success: false; error: string }
  | { status: 403; success: false; error: string; errorCode?: string };

export async function queueOrCommitFiles(opts: {
  files?: string[];
  message: string;
  author?: string;
  force?: boolean;
  contentRoot?: string;
  repoUrl?: string;
  token?: string;
  commitAuthor?: { name: string; email: string };
  logEdit?: (shortPath: string, author: string) => void;
  actor?: EventActor;
  agentLabel?: string;
}): Promise<QueueOrCommitResult> {
  let filesToQueue: string[];
  if (Array.isArray(opts.files) && opts.files.length > 0) {
    filesToQueue = opts.files;
  } else {
    filesToQueue = detectPendingChanges(opts.contentRoot).map((c) => c.file);
  }

  if (filesToQueue.length === 0) {
    return { status: 400, success: false, error: "No pending changes found to queue" };
  }

  const effectiveAuthor = (opts.author && opts.author.trim()) || "MCP";
  const agentLabel =
    opts.agentLabel?.trim() ||
    (opts.actor ? formatAgentAuthorLabel(opts.actor) : undefined);
  for (const filePath of filesToQueue) {
    markFileAsModified(
      filePath,
      effectiveAuthor,
      undefined,
      opts.contentRoot,
      opts.actor,
      { agentLabel },
    );
  }

  if (isAutoCommitEnabled()) {
    for (const filePath of filesToQueue) {
      const shortPath = filePath.split("/").slice(1).join("/") || filePath;
      opts.logEdit?.(shortPath, effectiveAuthor);
    }
    return { status: 202, queued: true, files: filesToQueue, author: effectiveAuthor };
  }

  let token = opts.token;
  let commitAuthor = opts.commitAuthor;
  if (!token) {
    try {
      const resolved = await resolveCommitGitHubToken({
        username: effectiveAuthor,
        purpose: "user_commit",
      });
      token = resolved.token;
      if (resolved.githubLogin || resolved.githubName) {
        commitAuthor = {
          name: resolved.githubName || resolved.githubLogin!,
          email:
            resolved.githubEmail ||
            `${resolved.githubLogin}@users.noreply.github.com`,
        };
      }
    } catch (err) {
      if (err instanceof GitHubConnectError) {
        return {
          status: 403,
          success: false,
          error: err.message,
          errorCode: err.code,
        };
      }
      throw err;
    }
  }

  const authorTag = agentLabel || effectiveAuthor;
  const finalMsg = `[Author: ${authorTag}] ${opts.message.trim()}`;
  const result = await commitAndPush(finalMsg, {
    force: !!opts.force,
    files: filesToQueue,
    repoUrl: opts.repoUrl,
    contentRoot: opts.contentRoot,
    token,
    commitAuthor,
  });

  if (result.success) {
    return { status: 200, success: true, commitHash: result.commitHash };
  }
  return { status: 400, success: false, error: result.error || "Failed to commit changes" };
}
