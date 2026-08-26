import { useEffect, useState } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, Check, CloudDownload, Github, GitMerge, RefreshCw } from "lucide-react";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { GitHubSyncStatus, PendingChange } from "../types";
import {
  startGitHubConnect,
  useGitHubUserConnection,
} from "@/hooks/useGitHubUserConnection";

export interface GitHubSyncChipProps {
  className?: string;
  githubSyncStatus: GitHubSyncStatus | null;
  pendingChanges: PendingChange[];
  pendingChangesLoading: boolean;
  syncStatusLoading: boolean;
  refreshSyncStatus: () => void;
  fetchPendingChanges: () => void;
  setCommitModalOpen: (v: boolean) => void;
}

function StatusErrorModal({
  label,
  title,
  error,
  testId,
}: {
  label: string;
  title: string;
  error?: string;
  testId: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        className="text-[10px] text-amber-600 dark:text-amber-400 truncate cursor-pointer underline-offset-2 hover:underline"
        data-testid={testId}
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
      >
        {label}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm" data-testid={`${testId}-dialog`}>
          <DialogHeader>
            <DialogTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 shrink-0" />
              {title}
            </DialogTitle>
            <DialogDescription className="text-sm whitespace-pre-wrap break-words pt-1">
              {error || "Could not compare local and remote commits."}
            </DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </>
  );
}

function GitHubStatusBadge({
  status,
  error,
}: {
  status: GitHubSyncStatus["status"];
  error?: string;
}) {
  if (status === "in-sync") {
    return (
      <span className="text-[10px] text-chart-3 flex items-center gap-0.5 truncate">
        <Check className="h-3 w-3 shrink-0" />
        In sync
      </span>
    );
  }
  if (status === "diverged") {
    return (
      <span className="text-[10px] text-destructive flex items-center gap-0.5 truncate">
        <AlertTriangle className="h-3 w-3 shrink-0" />
        Diverged
      </span>
    );
  }
  if (status === "invalid-credentials") {
    return (
      <StatusErrorModal
        label="Invalid"
        title="Invalid credentials"
        error={error || "Invalid or expired GITHUB_TOKEN"}
        testId="badge-github-invalid-credentials"
      />
    );
  }
  if (status === "not-configured") {
    return <span className="text-[10px] text-muted-foreground truncate">Not configured</span>;
  }
  if (status === "rate-limited") {
    return (
      <StatusErrorModal
        label="Rate limited"
        title="GitHub rate limit"
        error={error || "GitHub API rate limit exceeded — try again later."}
        testId="badge-github-rate-limited"
      />
    );
  }
  if (status === "unknown") {
    return (
      <StatusErrorModal
        label="Check failed"
        title="Sync check failed"
        error={error || "Could not compare local and remote commits."}
        testId="badge-github-check-failed"
      />
    );
  }
  return null;
}

function TypingDots() {
  const [count, setCount] = useState(1);

  useEffect(() => {
    const id = setInterval(() => {
      setCount((n) => (n % 3) + 1);
    }, 350);
    return () => clearInterval(id);
  }, []);

  return (
    <span
      className="inline-block w-[1.8em] text-[10px] leading-none text-muted-foreground"
      aria-hidden
      data-testid="badge-file-change-counts-loading"
    >
      {".".repeat(count)}
    </span>
  );
}

function FileChangeCounts({
  pendingChanges,
  loading,
}: {
  pendingChanges: PendingChange[];
  loading: boolean;
}) {
  const local = pendingChanges.filter((c) => c.source === "local").length;
  const incoming = pendingChanges.filter((c) => c.source === "incoming").length;
  const conflict = pendingChanges.filter((c) => c.source === "conflict").length;
  if (loading && local + incoming + conflict === 0) return <TypingDots />;
  if (local + incoming + conflict === 0) return null;

  return (
    <span
      className="inline-flex items-center text-[10px] tabular-nums leading-none"
      aria-label={`${local} local, ${incoming} remote, ${conflict} conflict`}
      data-testid="badge-file-change-counts"
    >
      {local > 0 && (
        <span className="inline-flex items-center text-amber-600 dark:text-amber-400">
          <ArrowUp className="size-2.5 shrink-0" strokeWidth={2.5} />
          {local}
        </span>
      )}
      {incoming > 0 && (
        <span className="inline-flex items-center text-primary">
          <ArrowDown className="size-2.5 shrink-0" strokeWidth={2.5} />
          {incoming}
        </span>
      )}
      {conflict > 0 && (
        <span className="inline-flex items-center text-destructive">
          <GitMerge className="size-2.5 shrink-0" strokeWidth={2.5} />
          {conflict}
        </span>
      )}
    </span>
  );
}

export function GitHubSyncChip({
  className,
  githubSyncStatus,
  pendingChanges,
  pendingChangesLoading,
  syncStatusLoading,
  refreshSyncStatus,
  fetchPendingChanges,
  setCommitModalOpen,
}: GitHubSyncChipProps) {
  const [, navigate] = useLocation();
  const status = githubSyncStatus?.status;
  const hasErrorDetail =
    status === "unknown" || status === "rate-limited" || status === "invalid-credentials";
  const { needsConnect, connection } = useGitHubUserConnection();

  if (needsConnect) {
    return (
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void startGitHubConnect();
        }}
        className={cn(
          "flex items-center gap-1.5 min-w-0 flex-1 px-2 py-2 text-sm",
          "bg-destructive/10 border border-destructive/20 hover-elevate",
          "text-left",
          className,
        )}
        title="Connect GitHub to commit content"
        data-testid="chip-github-sync"
      >
        <Github className="h-3.5 w-3.5 text-destructive shrink-0" />
        <span
          className="text-[10px] leading-none font-medium text-destructive truncate"
          data-testid="button-github-connect"
        >
          Connect to Github
        </span>
      </button>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-1 min-w-0 px-2 py-2 text-sm hover-elevate",
        className,
      )}
      data-testid="chip-github-sync"
    >
      <button
        type="button"
        onClick={() => navigate("/private/repository-sync")}
        className="flex items-center gap-1 min-w-0 flex-1 text-left"
        title="Open repository sync log"
        data-testid="link-repository-sync"
      >
        <Github className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <FileChangeCounts pendingChanges={pendingChanges} loading={pendingChangesLoading} />
        {githubSyncStatus && !githubSyncStatus.syncEnabled && (
          <span className="text-[10px] px-1 py-0 rounded bg-muted text-muted-foreground font-medium shrink-0">
            Off
          </span>
        )}
        {connection?.connected && connection.githubLogin && (
          <span
            className="text-[10px] text-muted-foreground truncate max-w-[4.5rem] pointer-events-none"
            title={`Connected as @${connection.githubLogin}`}
            data-testid="badge-github-connected"
          >
            @{connection.githubLogin}
          </span>
        )}
      </button>
      <div className="flex items-center gap-0.5 shrink-0">
        {hasErrorDetail ? (
          <div className="flex items-center gap-1" data-testid="button-sync-status-popover">
            {syncStatusLoading ? (
              <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
            ) : githubSyncStatus ? (
              <GitHubStatusBadge
                status={githubSyncStatus.status}
                error={githubSyncStatus.error}
              />
            ) : (
              <span className="text-[10px] text-muted-foreground">--</span>
            )}
          </div>
        ) : (
          <button
            type="button"
            onClick={() => navigate("/private/repository-sync")}
            className="flex items-center gap-1 cursor-pointer"
            title="Open repository sync"
            data-testid="button-sync-status-popover"
          >
            {syncStatusLoading ? (
              <RefreshCw className="h-3 w-3 animate-spin text-muted-foreground" />
            ) : githubSyncStatus ? (
              <GitHubStatusBadge
                status={githubSyncStatus.status}
                error={githubSyncStatus.error}
              />
            ) : (
              <span className="text-[10px] text-muted-foreground">--</span>
            )}
          </button>
        )}
        {status !== "in-sync" && (
          <button
            onClick={refreshSyncStatus}
            disabled={syncStatusLoading}
            className="p-0.5 rounded hover-elevate disabled:opacity-50"
            data-testid="button-refresh-sync-status"
            title="Refresh sync status"
          >
            <RefreshCw className={cn("h-3 w-3", syncStatusLoading && "animate-spin")} />
          </button>
        )}
        {githubSyncStatus?.syncEnabled && (
          <button
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              fetchPendingChanges();
              setCommitModalOpen(true);
            }}
            className="p-0.5 rounded hover-elevate"
            data-testid="button-open-sync-modal"
            title="Manage file sync"
          >
            <CloudDownload className="h-3 w-3" />
          </button>
        )}
      </div>
    </div>
  );
}
