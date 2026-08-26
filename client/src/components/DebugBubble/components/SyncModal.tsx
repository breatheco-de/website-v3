import { useState, useEffect, useMemo } from "react";
import { AlertTriangle, ArrowDown, ArrowUp, ChevronDown, ChevronRight, Download, ExternalLink, FileDiff, Github, Pencil, RefreshCw, Save, Search, Trash2, Undo2, Webhook, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { AutoCommitStatus, PendingChange, GitHubSyncStatus } from "../types";
import { useFormatSitePath } from "@/hooks/useFormatSitePath";
import {
  startGitHubConnect,
  useGitHubUserConnection,
} from "@/hooks/useGitHubUserConnection";

export interface SyncModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  autoCommitStatus: AutoCommitStatus | null;
  autoCommitCountdown: number | null;
  isFlushing: boolean;
  handleFlush: () => Promise<void>;
  handleClearConflict: (filePath: string) => Promise<void>;
  pendingChanges: PendingChange[];
  pendingChangesLoading: boolean;
  selectedFileForCommit: string | null;
  setSelectedFileForCommit: (v: string | null) => void;
  fileCommitMessage: string;
  setFileCommitMessage: (v: string) => void;
  fileCommitting: string | null;
  handleFileCommit: (filePath: string) => Promise<void>;
  filePulling: string | null;
  handleFilePull: (filePath: string) => Promise<void>;
  setConfirmPullFile: (v: string | null) => void;
  githubSyncStatus: GitHubSyncStatus | null;
  commitMessage: string;
  setCommitMessage: (v: string) => void;
  isCommitting: boolean;
  handleCommit: () => Promise<void>;
  /** When true, commit controls are blocked (production without GitHub Connect). */
  githubConnectRequired?: boolean;
  handleSyncFromRemote: () => Promise<void>;
  isSyncing: boolean;
  handleIgnoreAllChanges: () => Promise<void>;
  isIgnoringAllChanges: boolean;
  fetchPendingChanges: () => void;
  handlePushAllLocal: (commitMessage: string, files: string[]) => void;
  isPushingAllLocal: boolean;
  pushAllLocalError: string | null;
  setPushAllLocalError: (v: string | null) => void;
  manualActionsOpen: boolean;
  setManualActionsOpen: (v: boolean) => void;
  advancedOptionsOpen: boolean;
  setAdvancedOptionsOpen: (v: boolean) => void;
  getDebugToken: () => string | null;
  onViewDiff: (filePath: string) => void;
  toast: any;
}

export function SyncModal({
  open,
  onOpenChange,
  autoCommitStatus,
  autoCommitCountdown,
  isFlushing,
  handleFlush,
  handleClearConflict,
  pendingChanges,
  pendingChangesLoading,
  selectedFileForCommit,
  setSelectedFileForCommit,
  fileCommitMessage,
  setFileCommitMessage,
  fileCommitting,
  handleFileCommit,
  filePulling,
  handleFilePull,
  setConfirmPullFile,
  githubSyncStatus,
  githubConnectRequired = false,
  handleIgnoreAllChanges,
  isIgnoringAllChanges,
  fetchPendingChanges,
  handlePushAllLocal,
  isPushingAllLocal,
  pushAllLocalError,
  setPushAllLocalError,
  manualActionsOpen,
  setManualActionsOpen,
  advancedOptionsOpen,
  setAdvancedOptionsOpen,
  getDebugToken,
  onViewDiff,
  toast,
}: SyncModalProps) {
  const [bulkPullPromptFile, setBulkPullPromptFile] = useState<string | null>(null);
  const [isBulkPulling, setIsBulkPulling] = useState(false);
  const [skipBulkPrompt, setSkipBulkPrompt] = useState(false);
  const [pushAllConfirmOpen, setPushAllConfirmOpen] = useState(false);
  const [pushAllCommitMessage, setPushAllCommitMessage] = useState('');
  const [dropSelectedConfirmOpen, setDropSelectedConfirmOpen] = useState(false);
  const [isDroppingSelected, setIsDroppingSelected] = useState(false);
  const [isDownloadingZip, setIsDownloadingZip] = useState(false);
  const [autoPushExpanded, setAutoPushExpanded] = useState(false);
  const [autoPullExpanded, setAutoPullExpanded] = useState(false);
  const [githubIdentityExpanded, setGithubIdentityExpanded] = useState(false);
  const [queueFilter, setQueueFilter] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const formatSitePath = useFormatSitePath();
  const { connection, needsConnect, isLoading: githubConnectionLoading } =
    useGitHubUserConnection();

  const { data: syncInfo } = useQuery<{
    repoUrl: string | null;
    webhook: { active: boolean; id?: number; url?: string; createdAt?: string };
    recentLog: string[];
  }>({
    queryKey: ["/api/github/sync-info"],
    enabled: open,
    refetchInterval: open ? 10000 : false,
  });

  const localOnlyFiles = pendingChanges.filter(c => c.source === 'local');
  const nonConflictIncoming = pendingChanges.filter(c => c.source === 'incoming');

  const isSelectableChange = (c: PendingChange) =>
    c.source === "local" || c.source === "conflict";

  const filteredChanges = useMemo(() => {
    const q = queueFilter.trim().toLowerCase();
    if (!q) return pendingChanges;
    return pendingChanges.filter((c) => {
      const formatted = formatSitePath(c.file).toLowerCase();
      return c.file.toLowerCase().includes(q) || formatted.includes(q);
    });
  }, [pendingChanges, queueFilter, formatSitePath]);

  const selectableFiltered = useMemo(
    () => filteredChanges.filter(isSelectableChange),
    [filteredChanges],
  );

  /** Filtered local changes that are not conflicts — safe bulk push/drop targets. */
  const localOnlyFiltered = useMemo(
    () => filteredChanges.filter((c) => c.source === "local"),
    [filteredChanges],
  );

  const hasSelection = selectedFiles.size > 0;
  const filesToPush = useMemo(() => {
    if (!hasSelection) return localOnlyFiles.map((c) => c.file);
    return pendingChanges
      .filter((c) => selectedFiles.has(c.file) && c.source === "local")
      .map((c) => c.file);
  }, [hasSelection, localOnlyFiles, pendingChanges, selectedFiles]);

  /** Local-only selected files — matches single-row "Drop changes" behavior. */
  const filesToDrop = useMemo(
    () =>
      pendingChanges
        .filter((c) => selectedFiles.has(c.file) && c.source === "local")
        .map((c) => c.file),
    [pendingChanges, selectedFiles],
  );

  /** Selected files with local edits (including conflicts) — zip backup targets. */
  const filesToBackup = useMemo(
    () =>
      pendingChanges
        .filter((c) => selectedFiles.has(c.file) && (c.source === "local" || c.source === "conflict"))
        .map((c) => c.file),
    [pendingChanges, selectedFiles],
  );

  const allFilteredSelected =
    selectableFiltered.length > 0 &&
    selectableFiltered.every((c) => selectedFiles.has(c.file));

  const allLocalOnlyFilteredSelected =
    localOnlyFiltered.length > 0 &&
    localOnlyFiltered.every((c) => selectedFiles.has(c.file));

  useEffect(() => {
    setSelectedFiles((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      for (const c of pendingChanges) {
        if (prev.has(c.file) && isSelectableChange(c)) next.add(c.file);
      }
      if (next.size === prev.size && [...next].every((f) => prev.has(f))) return prev;
      return next;
    });
  }, [pendingChanges]);

  useEffect(() => {
    if (!open) {
      setQueueFilter("");
      setSelectedFiles(new Set());
    }
  }, [open]);

  useEffect(() => {
    if (pushAllConfirmOpen) {
      const n = filesToPush.length;
      setPushAllCommitMessage(
        hasSelection
          ? `[Manual sync] ${n} selected file(s)`
          : `[Manual sync] ${n} local file(s)`,
      );
    }
  }, [pushAllConfirmOpen, filesToPush.length, hasSelection]);

  const toggleFileSelection = (file: string, checked: boolean) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      if (checked) next.add(file);
      else next.delete(file);
      return next;
    });
  };

  const toggleSelectAllFiltered = (checked: boolean) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      for (const c of selectableFiltered) {
        if (checked) next.add(c.file);
        else next.delete(c.file);
      }
      return next;
    });
  };

  const toggleSelectLocalOnlyFiltered = (checked: boolean) => {
    setSelectedFiles((prev) => {
      const next = new Set(prev);
      for (const c of localOnlyFiltered) {
        if (checked) next.add(c.file);
        else next.delete(c.file);
      }
      return next;
    });
  };

  const handleDropSelected = async () => {
    if (filesToDrop.length === 0) return;
    setIsDroppingSelected(true);
    try {
      const token = getDebugToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Token ${token}`;

      for (const filePath of filesToDrop) {
        const res = await fetch("/api/github/pull-file", {
          method: "POST",
          headers,
          body: JSON.stringify({ filePath }),
        });
        const data = await res.json();
        if (!res.ok || !data.success) {
          throw new Error(data.error || `Failed to drop ${filePath}`);
        }
      }

      setDropSelectedConfirmOpen(false);
      setSelectedFiles(new Set());
      fetchPendingChanges();
    } catch (e) {
      toast({
        title: "Failed to drop some changes",
        description: e instanceof Error ? e.message : "Could not revert selected files",
        variant: "destructive",
      });
      fetchPendingChanges();
    } finally {
      setIsDroppingSelected(false);
    }
  };

  const handleDownloadSelectedZip = async () => {
    if (filesToBackup.length === 0) return;
    setIsDownloadingZip(true);
    try {
      const token = getDebugToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Token ${token}`;

      const res = await fetch("/api/github/pending-changes/zip", {
        method: "POST",
        headers,
        body: JSON.stringify({ files: filesToBackup }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to download zip");
      }

      const blob = await res.blob();
      const cd = res.headers.get("Content-Disposition");
      const match = cd?.match(/filename="([^"]+)"/);
      const filename = match?.[1] || "queue-backup.zip";
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast({
        title: "Queue backup downloaded",
        description: `${filesToBackup.length} file${filesToBackup.length !== 1 ? "s" : ""} saved as ${filename}. This does not push to GitHub.`,
      });
    } catch (e) {
      toast({
        title: "Download failed",
        description: e instanceof Error ? e.message : "Could not download the queue zip",
        variant: "destructive",
      });
    } finally {
      setIsDownloadingZip(false);
    }
  };

  const handleDownloadClick = (file: string, source: string) => {
    if (source === 'conflict') {
      setConfirmPullFile(file);
      return;
    }
    if (!skipBulkPrompt && nonConflictIncoming.length > 1) {
      setBulkPullPromptFile(file);
    } else {
      handleFilePull(file);
    }
  };

  const handleBulkPull = async () => {
    setIsBulkPulling(true);
    setBulkPullPromptFile(null);
    for (const change of nonConflictIncoming) {
      try {
        await handleFilePull(change.file);
      } catch (e) {
        // continue pulling remaining files
      }
    }
    try {
      await fetch("/api/github/sync-with-remote", { method: "POST" });
    } catch {
      // best-effort sync
    }
    fetchPendingChanges();
    setIsBulkPulling(false);
  };

  return (
    <>
    <Dialog open={open} onOpenChange={(v) => { if (!v) setSkipBulkPrompt(false); onOpenChange(v); }}>
      <DialogContent className="!inset-0 !top-0 !left-0 !translate-y-0 !w-screen !max-w-full rounded-none overflow-y-auto sm:!inset-auto sm:!left-4 sm:!right-4 sm:!top-[50%] sm:!translate-y-[-50%] sm:!w-auto sm:max-w-lg sm:!h-auto sm:max-h-[90vh] sm:rounded-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            GitHub Sync
          </DialogTitle>
          <DialogDescription>
            Auto-push keeps your local content changes pushed to GitHub. MCP create, translate, detach, and reattach writes appear as pending here, then auto-commit (or one batched push when auto-push is off).
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-2">
          {githubConnectRequired && (
            <div
              className="flex items-start gap-2 p-3 rounded-md bg-destructive/10 border border-destructive/20"
              data-testid="sync-modal-github-connect-required"
            >
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div className="text-sm space-y-1">
                <p className="font-medium text-foreground">Connect GitHub to commit</p>
                <p className="text-xs text-muted-foreground">
                  Production commits require your GitHub identity. Use Connect on the sync chip, then retry.
                </p>
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-xs"
                  onClick={() => void startGitHubConnect()}
                >
                  Connect GitHub
                </Button>
              </div>
            </div>
          )}
          {autoCommitStatus && (!autoCommitStatus.githubConfigured || autoCommitStatus.lastError) && (
            <div className="flex items-start gap-2 p-3 rounded-md bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800">
              <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
              <div className="text-sm">
                {!autoCommitStatus.githubConfigured ? (
                  <p className="text-red-700 dark:text-red-300">
                    GitHub is not configured. Set <code className="text-xs bg-red-100 dark:bg-red-900/50 px-1 rounded">GITHUB_TOKEN</code>, <code className="text-xs bg-red-100 dark:bg-red-900/50 px-1 rounded">GITHUB_REPO_URL</code>, and enable <code className="text-xs bg-red-100 dark:bg-red-900/50 px-1 rounded">GITHUB_SYNC_ENABLED=true</code> in environment variables.
                  </p>
                ) : (
                  <div className="space-y-1">
                    <p className="text-red-700 dark:text-red-300">{autoCommitStatus.lastError}</p>
                    <div className="flex flex-wrap items-center gap-2 text-[11px] text-red-600 dark:text-red-400">
                      {autoCommitStatus.pendingFiles > 0 && (
                        <span>{autoCommitStatus.pendingFiles} file{autoCommitStatus.pendingFiles !== 1 ? 's' : ''} pending</span>
                      )}
                      {autoCommitStatus.nextSyncAt && (() => {
                        const secsLeft = Math.max(0, Math.round((autoCommitStatus.nextSyncAt - Date.now()) / 1000));
                        return <span>Retrying in {secsLeft}s</span>;
                      })()}
                    </div>
                    <p className="text-[11px] text-red-600 dark:text-red-400">
                      Select files in Commit Queue and use Download zip for a local backup. That does not push or change the queue.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {/* GitHub identity card */}
            <Card
              className={`p-3 space-y-2 ${
                needsConnect
                  ? "border-destructive/30 bg-destructive/5"
                  : connection?.connected
                    ? "border-chart-3/30 bg-chart-3/5"
                    : ""
              }`}
              data-testid="card-github-identity"
            >
              <button
                type="button"
                className="flex items-center gap-1.5 w-full"
                onClick={() => setGithubIdentityExpanded((v) => !v)}
                data-testid="button-toggle-github-identity"
              >
                {githubIdentityExpanded ? (
                  <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                )}
                <div
                  className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                    githubConnectionLoading
                      ? "bg-muted-foreground/30"
                      : connection?.connected
                        ? "bg-green-500"
                        : needsConnect
                          ? "bg-destructive"
                          : "bg-muted-foreground/30"
                  }`}
                />
                <Github
                  className={`h-3 w-3 shrink-0 ${
                    connection?.connected
                      ? "text-chart-3"
                      : needsConnect
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }`}
                />
                <span className="text-xs font-medium truncate text-left">
                  {githubConnectionLoading
                    ? "GitHub…"
                    : connection?.connected && connection.githubLogin
                      ? `Commits as @${connection.githubLogin}`
                      : needsConnect
                        ? "Not connected"
                        : "Service token"}
                </span>
              </button>
              {githubIdentityExpanded && (
                <div className="space-y-2">
                  {connection?.connected && connection.githubLogin ? (
                    <p className="text-[11px] text-muted-foreground">
                      Content commits use your GitHub identity{" "}
                      <span className="font-medium text-foreground">
                        @{connection.githubLogin}
                      </span>
                      . Pulls and system operations still use the service{" "}
                      <span className="font-mono">GITHUB_TOKEN</span>.
                    </p>
                  ) : needsConnect ? (
                    <>
                      <p className="text-[11px] text-muted-foreground">
                        Connect GitHub to commit. Until then, content commits are
                        blocked.
                      </p>
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 text-xs w-full"
                        onClick={() => void startGitHubConnect()}
                        data-testid="button-github-connect-identity-card"
                      >
                        Connect GitHub
                      </Button>
                    </>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">
                      Connect is not required here. Commits use the shared service{" "}
                      <span className="font-mono">GITHUB_TOKEN</span>. Set{" "}
                      <span className="font-mono">GITHUB_CONNECT_REQUIRED=true</span>{" "}
                      (or run production) to require personal GitHub identity.
                    </p>
                  )}
                </div>
              )}
              {!githubIdentityExpanded && needsConnect && (
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-xs w-full"
                  onClick={() => void startGitHubConnect()}
                  data-testid="button-github-connect-identity-card-compact"
                >
                  Connect GitHub
                </Button>
              )}
            </Card>

            {/* Auto-push card */}
            <Card className="p-3 space-y-2">
              <button
                type="button"
                className="flex items-center gap-1.5 w-full"
                onClick={() => setAutoPushExpanded(v => !v)}
                data-testid="button-toggle-auto-push"
              >
                {autoPushExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                  autoCommitStatus?.enabled && autoCommitStatus.githubConfigured
                    ? autoCommitStatus.isCommitting ? 'bg-amber-500 animate-pulse' : 'bg-green-500'
                    : 'bg-muted-foreground/30'
                }`} />
                <span className="text-xs font-medium">
                  {autoCommitStatus?.isCommitting ? 'Pushing...' : autoCommitStatus?.enabled ? 'Auto-push' : 'Auto-push off'}
                </span>
                {autoCommitStatus?.pendingFiles ? (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-auto">{autoCommitStatus.pendingFiles} queued</Badge>
                ) : null}
              </button>
              {autoPushExpanded && !autoCommitStatus?.enabled && (
                <p className="text-[11px] text-muted-foreground">
                  Set <span className="font-mono">GITHUB_AUTO_COMMIT_ENABLED=true</span> to enable automatic pushes on a timed interval.
                  MCP writes still batch into one GitHub commit via <span className="font-mono">queue: true</span> on{" "}
                  <span className="font-mono">server/routes/github.ts</span>.
                </p>
              )}
              {autoPushExpanded && autoCommitStatus?.enabled && (() => {
                const isCommitting = autoCommitStatus.isCommitting;
                const hasCountdown = autoCommitCountdown !== null && autoCommitCountdown > 0;
                const hasPending = autoCommitStatus.pendingFiles > 0;

                let statusText: string;
                if (isCommitting) {
                  statusText = 'Pushing changes to GitHub...';
                } else if (hasCountdown) {
                  statusText = `Pushing in ${autoCommitCountdown}s`;
                } else if (hasPending) {
                  statusText = 'Changes detected, push starting soon.';
                } else {
                  statusText = 'Waiting for changes. Edit a file in 4geeks-com/ to trigger a push.';
                }

                return (
                  <div className="space-y-2">
                    <p className="text-[11px] text-muted-foreground">{statusText}</p>
                    <p className="text-[11px] text-muted-foreground">
                      MCP create/translate/detach/reattach join this queue (same as CMS saves). Read more:{" "}
                      <span className="font-mono">server/routes/github.ts</span> (<span className="font-mono">queue: true</span>),{" "}
                      <span className="font-mono">server/auto-commit.ts</span>.
                    </p>
                    <div className="flex items-center justify-between gap-1">
                      <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                        {autoCommitStatus.commitIntervalSeconds && (
                          <Popover>
                            <PopoverTrigger asChild>
                              <button
                                type="button"
                                className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
                                data-testid="button-edit-sync-interval"
                              >
                                <span>every {autoCommitStatus.commitIntervalSeconds}s</span>
                                <Pencil className="h-3 w-3" />
                              </button>
                            </PopoverTrigger>
                            <PopoverContent side="bottom" align="start" className="w-72 text-xs space-y-2 z-[10001]">
                              <p className="font-medium text-foreground">Change push interval</p>
                              <p className="text-muted-foreground">
                                Edit <span className="font-mono">.sync-state.json</span> and change the <span className="font-mono">commitIntervalSeconds</span> value (default: 5s).
                              </p>
                              <code className="block p-2 bg-muted rounded text-[11px] font-mono break-all whitespace-pre-wrap">
{`{ "commitIntervalSeconds": 10 }`}
                              </code>
                            </PopoverContent>
                          </Popover>
                        )}
                        {autoCommitStatus.lastCommitSha && githubSyncStatus?.repoUrl && (
                          <a
                            href={`${githubSyncStatus.repoUrl.replace(/\.git$/, '')}/commit/${autoCommitStatus.lastCommitSha}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="font-mono text-primary hover:underline"
                            data-testid="link-last-auto-commit"
                          >
                            {autoCommitStatus.lastCommitSha.substring(0, 7)}
                          </a>
                        )}
                      </div>
                      {hasPending && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[11px] px-2 shrink-0"
                          onClick={handleFlush}
                          disabled={isFlushing || isCommitting}
                          data-testid="button-flush-auto-commit"
                        >
                          {isFlushing ? <RefreshCw className="h-3 w-3 animate-spin" /> : 'Push now'}
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })()}
            </Card>

            {/* Auto-pull card */}
            <Card className="p-3 space-y-2">
              <button
                type="button"
                className="flex items-center gap-1.5 w-full"
                onClick={() => setAutoPullExpanded(v => !v)}
                data-testid="button-toggle-auto-pull"
              >
                {autoPullExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" /> : <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                <div className={`h-1.5 w-1.5 rounded-full shrink-0 ${
                  githubSyncStatus?.autoPullEnabled ? 'bg-green-500' : 'bg-muted-foreground/30'
                }`} />
                <span className="text-xs font-medium">
                  {githubSyncStatus?.autoPullEnabled ? 'Auto-pull' : 'Auto-pull off'}
                </span>
              </button>
              {autoPullExpanded && !githubSyncStatus?.autoPullEnabled && (
                <p className="text-[11px] text-muted-foreground">
                  Set <span className="font-mono">GITHUB_AUTO_PULL_ENABLED=true</span> to enable webhook and startup pulls.
                </p>
              )}
              {autoPullExpanded && githubSyncStatus?.autoPullEnabled && (() => {
                const webhookId = syncInfo?.webhook?.id;
                const repoUrl = syncInfo?.repoUrl || githubSyncStatus?.repoUrl?.replace(/\.git$/, '');
                const webhookSettingsUrl = repoUrl && webhookId ? `${repoUrl}/settings/hooks/${webhookId}` : null;
                const recentPullLogs = (syncInfo?.recentLog ?? [])
                  .filter(l => l.includes('AUTO-PULL') || l.includes('WEBHOOK'))
                  .slice(-3)
                  .reverse();

                return (
                  <div className="space-y-2">
                    <p className="text-[11px] text-muted-foreground">Pulls remote changes automatically on webhook and startup.</p>
                    {webhookSettingsUrl && webhookId && (
                      <a
                        href={webhookSettingsUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline"
                        data-testid="link-webhook-settings"
                      >
                        <Webhook className="h-3 w-3 shrink-0" />
                        <span>Webhook #{webhookId}</span>
                        <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                      </a>
                    )}
                    {recentPullLogs.length > 0 && (
                      <div className="space-y-0.5">
                        {recentPullLogs.map((entry, i) => (
                          <p key={i} className="text-[10px] font-mono text-muted-foreground truncate" title={entry}>{entry}</p>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </Card>
          </div>

          {autoCommitStatus && (autoCommitStatus.pendingFilesDetails.length > 0 || autoCommitStatus.conflictedFiles.length > 0) && (
            <div className="space-y-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                {autoCommitStatus.conflictedFiles.length > 0 ? 'Queued & Conflicted Files' : 'Queued Files'}
              </span>
              <ScrollArea className="max-h-[180px]">
                <div className="space-y-1">
                  {autoCommitStatus.conflictedFiles.map((filePath, idx) => (
                    <Card key={`conflict-${idx}`} className="p-2 space-y-1">
                      <div className="font-mono text-xs text-foreground truncate" title={filePath}>
                        {formatSitePath(filePath)}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="shrink-0 text-xs font-medium px-1.5 py-0.5 rounded bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300">
                          Conflict
                        </span>
                        <div className="flex-1" />
                        <div className="flex items-center gap-1">
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="outline"
                                className="h-6 w-6"
                                onClick={() => {
                                  setSelectedFileForCommit(filePath);
                                  setFileCommitMessage("");
                                }}
                                data-testid={`button-resolve-upload-${idx}`}
                              >
                                <ArrowUp className="h-3 w-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top"><p>Upload my version</p></TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="outline"
                                className="h-6 w-6"
                                onClick={() => {
                                  setConfirmPullFile(filePath);
                                }}
                                data-testid={`button-resolve-download-${idx}`}
                              >
                                <ArrowDown className="h-3 w-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top"><p>Download remote version</p></TooltipContent>
                          </Tooltip>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                onClick={() => handleClearConflict(filePath)}
                                data-testid={`button-clear-conflict-${idx}`}
                              >
                                <X className="h-3 w-3" />
                              </Button>
                            </TooltipTrigger>
                            <TooltipContent side="top"><p>Dismiss conflict</p></TooltipContent>
                          </Tooltip>
                        </div>
                      </div>
                    </Card>
                  ))}
                  {autoCommitStatus.pendingFilesDetails.map((file, idx) => (
                    <Card key={`pending-${idx}`} className="p-2 space-y-1">
                      <div className="font-mono text-xs text-foreground truncate" title={file.filePath}>
                        {formatSitePath(file.filePath)}
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="shrink-0 text-xs font-medium px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300">
                          Queued
                        </span>
                        <span className="text-xs text-muted-foreground">{file.author}</span>
                        <span className="text-xs text-muted-foreground">
                          {new Date(file.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    </Card>
                  ))}
                </div>
              </ScrollArea>
            </div>
          )}

          <div className="pt-1">
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setManualActionsOpen(!manualActionsOpen);
                  if (!manualActionsOpen) fetchPendingChanges();
                }}
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
                data-testid="button-toggle-manual-actions"
              >
                {manualActionsOpen ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                Commit Queue
                {pendingChanges.length > 0 && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 ml-1">{pendingChanges.length}</Badge>
                )}
              </button>
              <div className="flex items-center gap-1.5 flex-wrap justify-end">
                {hasSelection && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 text-xs px-2"
                    disabled={isPushingAllLocal || isDroppingSelected || isDownloadingZip}
                    onClick={(e) => {
                      e.stopPropagation();
                      setSelectedFiles(new Set());
                    }}
                    data-testid="button-clear-queue-selection"
                  >
                    Clear selection
                  </Button>
                )}
                {hasSelection && filesToDrop.length > 0 && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs px-2 text-destructive hover:text-destructive"
                    disabled={isPushingAllLocal || isDroppingSelected || isDownloadingZip}
                    onClick={(e) => {
                      e.stopPropagation();
                      setDropSelectedConfirmOpen(true);
                    }}
                    data-testid="button-drop-selected"
                  >
                    {isDroppingSelected ? (
                      <><RefreshCw className="h-3 w-3 animate-spin mr-1" />Dropping...</>
                    ) : (
                      <><Undo2 className="h-3 w-3 mr-1" />Drop selected ({filesToDrop.length})</>
                    )}
                  </Button>
                )}
                {hasSelection && filesToBackup.length > 0 && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-6 text-xs px-2"
                        disabled={isPushingAllLocal || isDroppingSelected || isDownloadingZip}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDownloadSelectedZip();
                        }}
                        data-testid="button-download-queue-zip"
                      >
                        {isDownloadingZip ? (
                          <><RefreshCw className="h-3 w-3 animate-spin mr-1" />Downloading...</>
                        ) : (
                          <><Download className="h-3 w-3 mr-1" />Download zip ({filesToBackup.length})</>
                        )}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                      <p>
                        Download the selected queue files as a zip backup if GitHub is down.
                        Does not push and does not change the queue.
                      </p>
                    </TooltipContent>
                  </Tooltip>
                )}
                {(hasSelection ? filesToPush.length > 0 : localOnlyFiles.length > 0) && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 text-xs px-2"
                    disabled={isPushingAllLocal || isDroppingSelected || isDownloadingZip || filesToPush.length === 0}
                    onClick={(e) => {
                      e.stopPropagation();
                      setPushAllLocalError(null);
                      setPushAllConfirmOpen(true);
                    }}
                    data-testid={hasSelection ? "button-push-selected" : "button-push-all-local"}
                  >
                    {isPushingAllLocal ? (
                      <><RefreshCw className="h-3 w-3 animate-spin mr-1" />Pushing...</>
                    ) : hasSelection ? (
                      <><ArrowUp className="h-3 w-3 mr-1" />Push selected ({filesToPush.length})</>
                    ) : (
                      <><ArrowUp className="h-3 w-3 mr-1" />Push all</>
                    )}
                  </Button>
                )}
              </div>
            </div>

            {pushAllLocalError && (
              <p className="text-xs text-destructive mt-2">{pushAllLocalError}</p>
            )}
            
            {manualActionsOpen && (
              <div className="mt-3 space-y-3">
                <div className="space-y-2">
                  {pendingChangesLoading ? (
                    <div className="flex items-center justify-center py-4">
                      <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : pendingChanges.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-2">
                      No remote or local differences detected outside the auto-commit queue.
                    </p>
                  ) : (
                    <>
                      <div className="flex items-center gap-3 flex-wrap">
                        {selectableFiltered.length > 0 && (
                          <label
                            className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none shrink-0"
                            data-testid="label-select-all-filtered"
                          >
                            <Checkbox
                              checked={
                                allFilteredSelected
                                  ? true
                                  : selectableFiltered.some((c) => selectedFiles.has(c.file))
                                    ? "indeterminate"
                                    : false
                              }
                              onCheckedChange={(checked) => toggleSelectAllFiltered(checked === true)}
                              data-testid="checkbox-select-all"
                            />
                            Check all
                            {queueFilter.trim() && (
                              <span>({selectableFiltered.length})</span>
                            )}
                          </label>
                        )}
                        {localOnlyFiltered.length > 0 && (
                          <label
                            className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer select-none shrink-0"
                            data-testid="label-select-local-only-filtered"
                          >
                            <Checkbox
                              checked={
                                allLocalOnlyFilteredSelected
                                  ? true
                                  : localOnlyFiltered.some((c) => selectedFiles.has(c.file))
                                    ? "indeterminate"
                                    : false
                              }
                              onCheckedChange={(checked) =>
                                toggleSelectLocalOnlyFiltered(checked === true)
                              }
                              data-testid="checkbox-select-local-only"
                            />
                            Local only
                            <span className="text-muted-foreground/80">
                              ({localOnlyFiltered.length})
                            </span>
                          </label>
                        )}
                        {hasSelection && (
                          <span className="text-xs text-foreground shrink-0">
                            {selectedFiles.size} selected
                          </span>
                        )}
                        <div className="relative flex-1 min-w-[12rem] max-w-sm ml-auto">
                          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                          <Input
                            value={queueFilter}
                            onChange={(e) => setQueueFilter(e.target.value)}
                            placeholder="Filter by file path…"
                            className="h-7 text-xs pl-7 pr-7"
                            data-testid="input-commit-queue-filter"
                          />
                          {queueFilter && (
                            <button
                              type="button"
                              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              onClick={() => setQueueFilter("")}
                              aria-label="Clear filter"
                              data-testid="button-clear-commit-queue-filter"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                      </div>
                      {filteredChanges.length === 0 ? (
                        <p className="text-xs text-muted-foreground py-2" data-testid="text-commit-queue-filter-empty">
                          No files match “{queueFilter.trim()}”.
                        </p>
                      ) : (
                    <div className="max-h-[280px] overflow-y-auto">
                      <div className="space-y-1">
                        {filteredChanges.map((change, index) => {
                          const selectable = isSelectableChange(change);
                          return (
                          <Card
                            key={`${change.file}-${index}`}
                            className="p-2 space-y-1"
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              {selectable ? (
                                <Checkbox
                                  checked={selectedFiles.has(change.file)}
                                  onCheckedChange={(checked) =>
                                    toggleFileSelection(change.file, checked === true)
                                  }
                                  className="shrink-0"
                                  data-testid={`checkbox-queue-file-${index}`}
                                />
                              ) : (
                                <span className="w-4 shrink-0" aria-hidden />
                              )}
                              <div
                                className="font-mono text-xs text-foreground truncate min-w-0"
                                title={change.file}
                              >
                                {formatSitePath(change.file)}
                              </div>
                              {autoCommitStatus && !autoCommitStatus.enabled && autoCommitStatus.autoCommitEligibleFiles?.includes(change.file) && (
                                <Badge className="shrink-0 text-[10px] px-1 py-0 h-4" style={{ backgroundColor: 'hsl(var(--color-green))' }}>
                                  Auto-push compatible
                                </Badge>
                              )}
                            </div>
                            
                            {selectedFileForCommit === change.file ? (
                              <div className="space-y-2">
                                <input
                                  type="text"
                                  value={fileCommitMessage}
                                  onChange={(e) => setFileCommitMessage(e.target.value)}
                                  placeholder="Commit message..."
                                  className="w-full px-2 py-1.5 text-xs rounded border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                                  data-testid={`input-file-commit-message-${index}`}
                                  autoFocus
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter' && fileCommitMessage.trim()) {
                                      handleFileCommit(change.file);
                                    } else if (e.key === 'Escape') {
                                      setSelectedFileForCommit(null);
                                      setFileCommitMessage("");
                                    }
                                  }}
                                />
                                <div className="flex items-center gap-1">
                                  <Button
                                    size="sm"
                                    className="h-7 text-xs flex-1"
                                    onClick={() => handleFileCommit(change.file)}
                                    disabled={
                                      !fileCommitMessage.trim() ||
                                      fileCommitting === change.file ||
                                      githubConnectRequired
                                    }
                                    data-testid={`button-confirm-file-commit-${index}`}
                                  >
                                    {fileCommitting === change.file ? (
                                      <RefreshCw className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <><ArrowUp className="h-3 w-3 mr-1" />Commit</>
                                    )}
                                  </Button>
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    className="h-7 text-xs"
                                    onClick={() => {
                                      setSelectedFileForCommit(null);
                                      setFileCommitMessage("");
                                    }}
                                    data-testid={`button-cancel-file-commit-${index}`}
                                  >
                                    Cancel
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <div className="flex flex-wrap items-center gap-2">
                                <span className={`shrink-0 text-xs font-medium px-1.5 py-0.5 rounded ${
                                  change.source === 'conflict'
                                    ? 'bg-red-100 text-red-700 dark:bg-red-900/50 dark:text-red-300'
                                    : change.source === 'incoming'
                                    ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                                    : 'bg-amber-100 text-amber-700 dark:bg-amber-900/50 dark:text-amber-300'
                                }`}>
                                  {change.source === 'conflict' ? 'Conflict' : change.source === 'incoming' ? 'Incoming' : 'Local change'}
                                </span>
                                <span className="text-xs text-muted-foreground italic">
                                  {change.author || 'Unknown author'}
                                </span>
                                {change.date && (
                                  <span className="text-xs text-muted-foreground">
                                    {new Date(change.date).toLocaleDateString()}
                                  </span>
                                )}
                                {change.commitSha && githubSyncStatus?.repoUrl && (
                                  <a
                                    href={`${githubSyncStatus.repoUrl.replace(/\.git$/, '')}/commit/${change.commitSha}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-xs font-mono text-primary hover:underline"
                                    data-testid={`link-commit-${index}`}
                                  >
                                    {change.commitSha.substring(0, 7)}
                                  </a>
                                )}
                                <div className="flex-1" />
                                <div className="flex items-center gap-1">
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-6 w-6"
                                        onClick={() => onViewDiff(change.file)}
                                        data-testid={`button-view-diff-${index}`}
                                      >
                                        <FileDiff className="h-3 w-3" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top"><p>View diff</p></TooltipContent>
                                  </Tooltip>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <Button
                                        size="icon"
                                        variant="ghost"
                                        className="h-6 w-6"
                                        onClick={async () => {
                                          try {
                                            const token = getDebugToken();
                                            const headers: Record<string, string> = {};
                                            if (token) headers["Authorization"] = `Token ${token}`;
                                            const response = await fetch(`/api/content/file?path=${encodeURIComponent(change.file)}`, { headers });
                                            if (!response.ok) throw new Error('Failed to fetch file');
                                            const content = await response.text();
                                            const blob = new Blob([content], { type: 'application/x-yaml' });
                                            const url = URL.createObjectURL(blob);
                                            const a = document.createElement('a');
                                            a.href = url;
                                            const pathParts = formatSitePath(change.file).split('/');
                                            const fileName = pathParts.length >= 2
                                              ? `${pathParts[pathParts.length - 2]}.${pathParts[pathParts.length - 1]}`
                                              : pathParts.pop() || 'backup.yml';
                                            a.download = fileName;
                                            document.body.appendChild(a);
                                            a.click();
                                            document.body.removeChild(a);
                                            URL.revokeObjectURL(url);
                                            toast({
                                              title: "Backup downloaded",
                                              description: `Downloaded ${change.file.split('/').pop()}`,
                                            });
                                          } catch (error) {
                                            console.error('Failed to download backup:', error);
                                            toast({
                                              title: "Download failed",
                                              description: "Could not download the backup file",
                                              variant: "destructive",
                                            });
                                          }
                                        }}
                                        data-testid={`button-backup-file-${index}`}
                                      >
                                        <Save className="h-3 w-3" />
                                      </Button>
                                    </TooltipTrigger>
                                    <TooltipContent side="top"><p>Download backup</p></TooltipContent>
                                  </Tooltip>
                                  {(change.source === 'local' || change.source === 'conflict') && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          size="icon"
                                          variant="outline"
                                          className="h-6 w-6"
                                          onClick={() => {
                                            setSelectedFileForCommit(change.file);
                                            setFileCommitMessage("");
                                          }}
                                          data-testid={`button-commit-file-${index}`}
                                        >
                                          <ArrowUp className="h-3 w-3" />
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent side="top"><p>Upload to remote</p></TooltipContent>
                                    </Tooltip>
                                  )}
                                  {(change.source === 'local') && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          size="icon"
                                          variant="ghost"
                                          className="h-6 w-6"
                                          onClick={() => setConfirmPullFile(change.file)}
                                          disabled={filePulling === change.file}
                                          data-testid={`button-drop-file-${index}`}
                                        >
                                          {filePulling === change.file ? (
                                            <RefreshCw className="h-3 w-3 animate-spin" />
                                          ) : (
                                            <Undo2 className="h-3 w-3" />
                                          )}
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent side="top"><p>Drop changes (revert to remote)</p></TooltipContent>
                                    </Tooltip>
                                  )}
                                  {(change.source === 'incoming' || change.source === 'conflict') && (
                                    <Tooltip>
                                      <TooltipTrigger asChild>
                                        <Button
                                          size="icon"
                                          variant="outline"
                                          className="h-6 w-6"
                                          onClick={() => handleDownloadClick(change.file, change.source)}
                                          disabled={filePulling === change.file || isBulkPulling}
                                          data-testid={`button-pull-file-${index}`}
                                        >
                                          {filePulling === change.file ? (
                                            <RefreshCw className="h-3 w-3 animate-spin" />
                                          ) : (
                                            <ArrowDown className="h-3 w-3" />
                                          )}
                                        </Button>
                                      </TooltipTrigger>
                                      <TooltipContent side="top"><p>Download remote</p></TooltipContent>
                                    </Tooltip>
                                  )}
                                </div>
                              </div>
                            )}
                          </Card>
                          );
                        })}
                      </div>
                    </div>
                      )}
                    </>
                  )}
                </div>

              </div>
            )}
          </div>

          <div className="border-t pt-3">
            <button
              type="button"
              onClick={() => setAdvancedOptionsOpen(!advancedOptionsOpen)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-toggle-advanced-actions"
            >
              {advancedOptionsOpen ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
              Advanced Actions
            </button>

            {advancedOptionsOpen && (
              <div className="mt-3">
                <div className="p-3 bg-muted/50 rounded-md space-y-2">
                  <p className="text-xs text-muted-foreground">
                    Discard all local changes and reset to the remote version.
                  </p>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleIgnoreAllChanges}
                    disabled={isIgnoringAllChanges || !pendingChanges.some(c => c.source === 'local' || c.source === 'conflict')}
                    data-testid="button-ignore-all-changes"
                  >
                    {isIgnoringAllChanges ? (
                      <><RefreshCw className="h-3.5 w-3.5 mr-1.5 animate-spin" />Resetting...</>
                    ) : (
                      <><Trash2 className="h-3.5 w-3.5 mr-1.5" />Ignore all local changes</>
                    )}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              onOpenChange(false);
              setSelectedFileForCommit(null);
              setFileCommitMessage("");
              setManualActionsOpen(false);
            }}
            data-testid="button-close-commit-modal"
          >
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={!!bulkPullPromptFile} onOpenChange={(open) => { if (!open) setBulkPullPromptFile(null); }}>
      <DialogContent className="w-full max-w-full rounded-none sm:rounded-lg sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowDown className="h-5 w-5" />
            Download Remote Files
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <p className="text-sm text-muted-foreground" data-testid="text-bulk-pull-description">
            There {nonConflictIncoming.length === 1 ? "is" : "are"} {nonConflictIncoming.length} incoming file{nonConflictIncoming.length !== 1 ? "s" : ""} without conflicts. Would you like to download all of them?
          </p>
          <label className="flex items-center gap-2 cursor-pointer" data-testid="label-skip-bulk-prompt">
            <Checkbox
              checked={skipBulkPrompt}
              onCheckedChange={(checked) => setSkipBulkPrompt(!!checked)}
              data-testid="checkbox-skip-bulk-prompt"
            />
            <span className="text-xs text-muted-foreground">Don't ask me again in this session</span>
          </label>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => {
              const file = bulkPullPromptFile;
              setBulkPullPromptFile(null);
              if (file) handleFilePull(file);
            }}
            disabled={isBulkPulling}
            data-testid="button-pull-single"
          >
            Only this file
          </Button>
          <Button
            onClick={handleBulkPull}
            disabled={isBulkPulling}
            data-testid="button-pull-all"
          >
            {isBulkPulling ? (
              <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Downloading...</>
            ) : (
              <><ArrowDown className="h-4 w-4 mr-2" />Download all ({nonConflictIncoming.length})</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={pushAllConfirmOpen} onOpenChange={(open) => { if (!open) setPushAllConfirmOpen(false); }}>
      <DialogContent className="w-full max-w-full rounded-none sm:rounded-lg sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowUp className="h-5 w-5" />
            {hasSelection ? "Push selected files to GitHub" : "Push local files to GitHub"}
          </DialogTitle>
          <DialogDescription>
            {hasSelection ? (
              <>
                The following {filesToPush.length} selected local file{filesToPush.length !== 1 ? "s" : ""} will be committed and pushed to the remote repository. Conflicted files in the selection are excluded and must be resolved individually.
              </>
            ) : (
              <>
                The following {filesToPush.length} local file{filesToPush.length !== 1 ? "s" : ""} will be committed and pushed to the remote repository. Files with conflicts are excluded and must be resolved individually.
              </>
            )}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <ScrollArea className="max-h-40 rounded-md border">
            <div className="p-2 space-y-1">
              {filesToPush.map((file) => (
                <div
                  key={file}
                  className="font-mono text-xs text-muted-foreground truncate px-1 py-0.5"
                  title={file}
                  data-testid={`text-push-confirm-file-${file}`}
                >
                  {formatSitePath(file)}
                </div>
              ))}
            </div>
          </ScrollArea>
          <div className="space-y-1.5">
            <Label htmlFor="push-all-commit-message" className="text-sm">Commit message</Label>
            <Input
              id="push-all-commit-message"
              value={pushAllCommitMessage}
              onChange={(e) => setPushAllCommitMessage(e.target.value)}
              placeholder="Describe what changed..."
              data-testid="input-push-all-commit-message"
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => setPushAllConfirmOpen(false)}
            disabled={isPushingAllLocal}
            data-testid="button-push-all-cancel"
          >
            Cancel
          </Button>
          <Button
            onClick={() => {
              if (!pushAllCommitMessage.trim() || filesToPush.length === 0) return;
              const files = [...filesToPush];
              setPushAllConfirmOpen(false);
              handlePushAllLocal(pushAllCommitMessage.trim(), files);
              setSelectedFiles(new Set());
            }}
            disabled={isPushingAllLocal || !pushAllCommitMessage.trim() || filesToPush.length === 0}
            data-testid="button-push-all-confirm"
          >
            {isPushingAllLocal ? (
              <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Pushing...</>
            ) : (
              <><ArrowUp className="h-4 w-4 mr-2" />Push {filesToPush.length} file{filesToPush.length !== 1 ? "s" : ""}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog
      open={dropSelectedConfirmOpen}
      onOpenChange={(open) => {
        if (!open && !isDroppingSelected) setDropSelectedConfirmOpen(false);
      }}
    >
      <DialogContent className="w-full max-w-full rounded-none sm:rounded-lg sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Undo2 className="h-5 w-5" />
            Drop selected local changes?
          </DialogTitle>
          <DialogDescription>
            This will replace your local version of {filesToDrop.length} file{filesToDrop.length !== 1 ? "s" : ""} with the remote version. This cannot be undone.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <ScrollArea className="max-h-40 rounded-md border">
            <div className="p-2 space-y-1">
              {filesToDrop.map((file) => (
                <div
                  key={file}
                  className="font-mono text-xs text-muted-foreground truncate px-1 py-0.5"
                  title={file}
                  data-testid={`text-drop-confirm-file-${file}`}
                >
                  {formatSitePath(file)}
                </div>
              ))}
            </div>
          </ScrollArea>
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => setDropSelectedConfirmOpen(false)}
            disabled={isDroppingSelected}
            data-testid="button-drop-selected-cancel"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleDropSelected}
            disabled={isDroppingSelected || filesToDrop.length === 0}
            data-testid="button-drop-selected-confirm"
          >
            {isDroppingSelected ? (
              <><RefreshCw className="h-4 w-4 mr-2 animate-spin" />Dropping...</>
            ) : (
              <><Undo2 className="h-4 w-4 mr-2" />Drop {filesToDrop.length} file{filesToDrop.length !== 1 ? "s" : ""}</>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
    </>
  );
}
