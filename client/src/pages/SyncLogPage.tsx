import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Braces, Check, ChevronDown, Download, Filter, Github, Loader2, RefreshCw, Search, Server, Trash2, User, Webhook, X } from "lucide-react";
import {
  IconCloudUpload,
  IconCloudDownload,
  IconCheck,
  IconAlertTriangle,
  IconMinus,
  IconGitCommit,
} from "@tabler/icons-react";
import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { SitemapSearch } from "@/components/menus/SitemapSearch";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiRequest } from "@/lib/queryClient";
import { downloadSiteArchive } from "@/lib/download-site-archive";
import { openSyncModal } from "@/components/SyncConflictBanner";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  disconnectGitHub,
  startGitHubConnect,
  useGitHubUserConnection,
} from "@/hooks/useGitHubUserConnection";
import {
  GitHubConnectErrorDialog,
  type GitHubConnectErrorState,
} from "@/components/GitHubConnectErrorDialog";

const CATEGORIES = [
  "RESTART",
  "RECONCILE",
  "WEBHOOK",
  "AUTO-PULL",
  "COMMIT",
  "CONFLICT",
  "ERROR",
  "EDIT",
] as const;

type Category = (typeof CATEGORIES)[number];

interface SyncInfo {
  instanceId: string;
  replitCheckpoint: string;
  githubCommit: string | null;
  repoUrl: string | null;
  env: string;
  pid: number;
  webhook: {
    active: boolean;
    id?: number;
    url?: string;
    createdAt?: string;
  };
  recentLog: string[];
}

interface SyncLogEntry {
  ts: string;
  category: string;
  message: string;
  person?: string;
  meta?: Record<string, unknown>;
}

interface ParsedEntry {
  ts: string;
  timeOnly: string;
  dateOnly: string;
  category: string;
  message: string;
  person?: string;
  meta?: Record<string, unknown>;
}

function formatLogTime(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
  }
  const diffMin = Math.floor(diffMs / 60_000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin} min ago`;
  return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function formatLogDate(date: Date): string {
  const today = startOfDay(new Date());
  const entryDay = startOfDay(date);
  const dayDiff = Math.round((today - entryDay) / 86_400_000);
  if (dayDiff === 0) return "today";
  if (dayDiff === 1) return "yesterday";
  return date.toLocaleDateString(undefined, { year: "numeric", month: "2-digit", day: "2-digit" });
}

function toParseEntry(entry: SyncLogEntry): ParsedEntry {
  const date = new Date(entry.ts);
  const isValidDate = !isNaN(date.getTime());
  const timeOnly = isValidDate ? formatLogTime(date) : entry.ts;
  const dateOnly = isValidDate ? formatLogDate(date) : "";
  return { ts: entry.ts, timeOnly, dateOnly, category: entry.category, message: entry.message, person: entry.person, meta: entry.meta };
}

function renderMessageWithLinks(message: string, repoUrl: string | null | undefined) {
  if (!repoUrl) return message;
  const cleanRepoUrl = repoUrl.replace(/\.git$/, '');
  const parts = message.split(/\b([0-9a-f]{7})\b/);
  if (parts.length === 1) return message;
  return parts.map((part, i) => {
    if (i % 2 === 1 && /^[0-9a-f]{7}$/.test(part)) {
      return (
        <a
          key={i}
          href={`${cleanRepoUrl}/commit/${part}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary hover:underline font-semibold"
          data-testid={`link-commit-sha-${part}`}
        >
          {part}
        </a>
      );
    }
    return part;
  });
}

function getCategoryColor(cat: string): string {
  switch (cat) {
    case "RESTART":
      return "text-blue-600 dark:text-blue-400";
    case "RECONCILE":
      return "text-purple-600 dark:text-purple-400";
    case "WEBHOOK":
      return "text-cyan-600 dark:text-cyan-400";
    case "AUTO-PULL":
      return "text-green-600 dark:text-green-400";
    case "COMMIT":
      return "text-emerald-600 dark:text-emerald-400";
    case "CONFLICT":
      return "text-amber-600 dark:text-amber-400";
    case "ERROR":
      return "text-red-600 dark:text-red-400";
    case "EDIT":
      return "text-indigo-600 dark:text-indigo-400";
    default:
      return "text-muted-foreground";
  }
}

function getCategoryBadgeVariant(cat: string): "default" | "secondary" | "destructive" | "outline" {
  switch (cat) {
    case "ERROR":
    case "CONFLICT":
      return "destructive";
    default:
      return "secondary";
  }
}

/** Strip the site content-folder prefix for shorter paths in the pull result list. */
function shortenPullPath(filePath: string, contentFolder?: string | null): string {
  if (contentFolder && filePath.startsWith(`${contentFolder}/`)) {
    return filePath.slice(contentFolder.length + 1);
  }
  return filePath;
}

function formatByteSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatElapsedSince(startedAt: number | null | undefined): string {
  if (!startedAt) return "";
  const sec = Math.max(0, Math.floor((Date.now() - startedAt) / 1000));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

interface SitemapEntry {
  loc: string;
  label: string;
}

function extractPath(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.pathname;
  } catch {
    return url;
  }
}

export default function SyncLogPage() {
  const { toast } = useToast();
  const { connection, isLoading: githubConnectionLoading, invalidate: invalidateGitHubConnection } =
    useGitHubUserConnection();
  const initialSearch = useRef(
    new URLSearchParams(window.location.search).get("search") || ""
  );
  const [search, setSearch] = useState(initialSearch.current);
  const [sitemapPage, setSitemapPage] = useState("");
  const [activeCategories, setActiveCategories] = useState<Set<Category>>(
    new Set([])
  );
  const [activePersons, setActivePersons] = useState<Set<string>>(new Set([]));
  const [githubConnectSuccessOpen, setGithubConnectSuccessOpen] = useState(false);
  const [githubConnectError, setGithubConnectError] =
    useState<GitHubConnectErrorState | null>(null);
  const qc = useQueryClient();

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const github = params.get("github");
    if (!github) return;

    if (github === "connected") {
      setGithubConnectSuccessOpen(true);
      void invalidateGitHubConnection();
    } else if (github === "error") {
      setGithubConnectError({
        message: params.get("message") || "GitHub Connect failed",
        code: params.get("code"),
      });
    }

    params.delete("github");
    params.delete("message");
    params.delete("code");
    params.delete("repos");
    const next = params.toString();
    const path = window.location.pathname + (next ? `?${next}` : "");
    window.history.replaceState({}, "", path);
  }, [invalidateGitHubConnection]);

  const { data: sitemapUrls = [] } = useQuery<SitemapEntry[]>({
    queryKey: ["/api/sitemap-urls"],
    queryFn: async () => {
      const res = await fetch("/api/sitemap-urls");
      if (!res.ok) throw new Error("Failed to load sitemap URLs");
      return res.json();
    },
  });

  const { data: siteInfo } = useQuery<{ domain: string; contentFolder: string }>({
    queryKey: ["/api/site/info"],
  });
  const siteLabel = siteInfo?.domain || siteInfo?.contentFolder || null;

  const initialFillDone = useRef(false);

  useEffect(() => {
    if (initialFillDone.current || !initialSearch.current || sitemapUrls.length === 0) return;
    initialFillDone.current = true;

    const slug = initialSearch.current;
    const LOCALE_PREFIXES = new Set(["en", "es", "us"]);

    const match = sitemapUrls.find((entry) => {
      const pathname = extractPath(entry.loc);
      const parts = pathname.split("/").filter(Boolean);
      const contentParts =
        parts.length > 0 && LOCALE_PREFIXES.has(parts[0]) ? parts.slice(1) : parts;
      return contentParts[contentParts.length - 1] === slug;
    });

    if (match) {
      setSitemapPage(extractPath(match.loc));
    }
  }, [sitemapUrls]);

  const clearMutation = useMutation({
    mutationFn: (mode: "all" | "2days") => apiRequest("DELETE", `/api/github/sync-log?mode=${mode}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/github/sync-log"] });
      qc.invalidateQueries({ queryKey: ["/api/github/sync-info"] });
    },
  });

  const [webhookRetryOpen, setWebhookRetryOpen] = useState(false);
  const [webhookRetryResult, setWebhookRetryResult] = useState<{ success: boolean; message: string } | null>(null);
  const [cleanupResult, setCleanupResult] = useState<{ deleted: number; ids: number[] } | null>(null);
  const [webhookResetConfirmOpen, setWebhookResetConfirmOpen] = useState(false);
  const [webhookResetResult, setWebhookResetResult] = useState<{ success: boolean; message: string } | null>(null);
  const [webhookPayloadMeta, setWebhookPayloadMeta] = useState<Record<string, unknown> | null>(null);
  const syncLogCardRef = useRef<HTMLDivElement | null>(null);

  const webhookSetupMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/github/webhook/setup").then(r => r.json()),
    onSuccess: (data) => {
      setWebhookRetryResult(data);
      qc.invalidateQueries({ queryKey: ["/api/github/sync-info"] });
    },
    onError: (err: any) => {
      setWebhookRetryResult({ success: false, message: err.message || "Request failed" });
    },
  });

  const cleanupMutation = useMutation({
    mutationFn: () => apiRequest("DELETE", "/api/github/webhook/duplicates").then(r => r.json()),
    onSuccess: (data) => {
      setCleanupResult({ deleted: data.deleted, ids: data.ids });
    },
    onError: (err: any) => {
      setCleanupResult({ deleted: -1, ids: [] });
    },
  });

  const webhookResetMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/github/webhook/reset").then(r => r.json()),
    onSuccess: (data) => {
      setWebhookResetResult({ success: !!data.success, message: data.message || "Done" });
      setWebhookResetConfirmOpen(false);
      qc.invalidateQueries({ queryKey: ["/api/github/sync-info"] });
      qc.invalidateQueries({ queryKey: ["/api/github/sync-log"] });
    },
    onError: (err: any) => {
      setWebhookResetResult({ success: false, message: err.message || "Request failed" });
      setWebhookResetConfirmOpen(false);
    },
  });

  const [forcePullOpen, setForcePullOpen] = useState(false);
  const [forcePullConfirmOpen, setForcePullConfirmOpen] = useState(false);
  const [isDownloadingSite, setIsDownloadingSite] = useState(false);
  const forcePullConfirmOpenRef = useRef(false);
  forcePullConfirmOpenRef.current = forcePullConfirmOpen;
  const [pullStarted, setPullStarted] = useState(false);
  const [pullResultTab, setPullResultTab] = useState<"downloaded" | "skipped" | "removed" | "errors">("downloaded");
  const [pullResultSearch, setPullResultSearch] = useState("");
  const pullToastShown = useRef(false);
  const pullStartAt = useRef<number | null>(null);
  const pullStartedRef = useRef(false);
  pullStartedRef.current = pullStarted;

  const startPullMutation = useMutation({
    mutationFn: (force: boolean) =>
      apiRequest("POST", "/api/github/content/pull-all", { force }).then((r) => r.json()),
    onSuccess: () => {
      pullToastShown.current = false;
      pullStartAt.current = Date.now();
      setPullStarted(true);
      setPullResultTab("downloaded");
      setPullResultSearch("");
      qc.invalidateQueries({ queryKey: ["/api/github/pull-all-status"] });
    },
    onError: (err: Error) => {
      // apiRequest throws `${status}: ${body}` — prefer JSON.error when present
      let description = err.message || "Request failed";
      const colon = description.indexOf(": ");
      if (colon >= 0) {
        const body = description.slice(colon + 2);
        try {
          const parsed = JSON.parse(body) as { error?: string };
          if (parsed?.error) description = parsed.error;
        } catch {
          // keep raw message
        }
      }
      toast({
        title: "Pull failed to start",
        description,
        variant: "destructive",
      });
    },
  });

  const cancelPullMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/github/content/pull-all/cancel").then((r) => r.json()),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/github/pull-all-status"] });
    },
    onError: (err: Error) => {
      toast({
        title: "Could not cancel pull",
        description: err.message || "Request failed",
        variant: "destructive",
      });
    },
  });

  const handleDownloadSite = async () => {
    if (isDownloadingSite) return;
    setIsDownloadingSite(true);
    try {
      const { filename } = await downloadSiteArchive();
      toast({
        title: "Site backup downloaded",
        description: `${filename} — local snapshot only. Does not push to GitHub.`,
      });
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      toast({
        title: "Download failed",
        description: err instanceof Error ? err.message : "Could not download the site zip",
        variant: "destructive",
      });
    } finally {
      setIsDownloadingSite(false);
    }
  };

  const { data: pullStatus } = useQuery<{
    running: boolean;
    total: number;
    pulled: number;
    skipped: number;
    errors: string[];
    pulledFiles?: string[];
    skippedFiles?: string[];
    deleted?: number;
    deletedFiles?: string[];
    startedAt: number | null;
    doneAt: number | null;
    success: boolean | null;
    commitSha: string | null;
    cancelled: boolean;
    mode?: "files" | "archive";
    phase?: "listing" | "downloading" | "extracting" | "replacing" | "finalizing" | "complete";
    archiveBytesDownloaded?: number;
    archiveBytesTotal?: number | null;
    extracted?: number;
    replaced?: number;
    lastReplacedFile?: string | null;
    replaceTotal?: number | null;
  } | null>({
    queryKey: ["/api/github/pull-all-status"],
    enabled: forcePullOpen || pullStarted,
    queryFn: async () => {
      const res = await fetch("/api/github/pull-all-status");
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Status check failed");
      return res.json();
    },
    refetchInterval: (query) => {
      const d = query.state.data;
      if (d?.running) return 800;
      if (d && d.doneAt != null) return false;
      // After Start Pull, wait briefly for status; stop if it never appears
      if (!d && pullStartedRef.current) {
        const elapsed = pullStartAt.current ? Date.now() - pullStartAt.current : 0;
        if (elapsed > 15000) return false;
        return 800;
      }
      // Dialog open before start: light poll in case a pull is already running
      if (!d) return 2000;
      return false;
    },
    staleTime: 0,
  });

  useEffect(() => {
    if (!pullStarted || !pullStatus || pullStatus.running || pullStatus.doneAt == null) return;
    if (pullToastShown.current) return;
    pullToastShown.current = true;

    const errorCount = pullStatus.errors?.length ?? 0;
    if (pullStatus.cancelled) {
      toast({
        title: "Pull cancelled",
        description: "Already downloaded files are kept. Use Pull only changed to resume.",
      });
    } else if (pullStatus.success === false || errorCount > 0) {
      toast({
        title: "Pull failed",
        description: pullStatus.errors?.[0] || "Pull completed with errors — see the dialog for details.",
        variant: "destructive",
      });
    } else {
      const skipped = pullStatus.skipped ?? 0;
      const deleted = pullStatus.deleted ?? 0;
      const parts: string[] = [
        `Downloaded ${pullStatus.pulled} file${pullStatus.pulled === 1 ? "" : "s"} from GitHub`,
      ];
      if (skipped > 0) parts.push(`skipped ${skipped} unchanged`);
      if (deleted > 0) parts.push(`removed ${deleted} local-only`);
      toast({
        title: "Pull complete",
        description: `${parts.join("; ")}.`,
      });
    }
    qc.invalidateQueries({ queryKey: ["/api/github/sync-log"] });
    qc.invalidateQueries({ queryKey: ["/api/github/sync-info"] });
  }, [pullStatus, pullStarted, toast, qc]);

  useEffect(() => {
    if (!pullStarted || pullStatus != null) return;
    const timer = window.setTimeout(() => {
      if (pullToastShown.current) return;
      pullToastShown.current = true;
      toast({
        title: "Force pull status unavailable",
        description: "No pull progress was reported. Check the server terminal for errors.",
        variant: "destructive",
      });
    }, 15000);
    return () => window.clearTimeout(timer);
  }, [pullStarted, pullStatus, toast]);

  const {
    data: logData,
    isLoading: logLoading,
    refetch: refetchLog,
  } = useQuery<{ entries: SyncLogEntry[] }>({
    queryKey: ["/api/github/sync-log"],
    queryFn: async () => {
      const res = await fetch("/api/github/sync-log");
      return res.json();
    },
    refetchInterval: 15000,
  });

  const { data: syncInfo } = useQuery<SyncInfo>({
    queryKey: ["/api/github/sync-info"],
    refetchInterval: 30000,
  });

  const entries = (() => {
    if (!logData?.entries) return [];
    return logData.entries.map(toParseEntry);
  })();

  const uniquePersons = (() => {
    const persons = new Set<string>();
    for (const e of entries) {
      if (e.person) persons.add(e.person);
    }
    return Array.from(persons).sort();
  })();

  const filtered = entries.filter((e) => {
    if (activeCategories.size > 0 && !activeCategories.has(e.category as Category)) return false;
    if (activePersons.size > 0 && e.person && !activePersons.has(e.person)) return false;
    if (search) {
      const q = search.toLowerCase();
      return (
        e.message.toLowerCase().includes(q) ||
        e.category.toLowerCase().includes(q) ||
        (e.person || "").toLowerCase().includes(q) ||
        e.ts.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const categoryCounts = (() => {
    const counts: Record<string, number> = {};
    for (const e of entries) {
      counts[e.category] = (counts[e.category] || 0) + 1;
    }
    return counts;
  })();

  const toggleCategory = (cat: Category) => {
    setActiveCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) {
        next.delete(cat);
      } else {
        next.add(cat);
      }
      return next;
    });
  };

  const selectOnly = (cat: Category) => {
    setActiveCategories(new Set([cat]));
  };

  const selectAll = () => {
    setActiveCategories(new Set(CATEGORIES));
  };

  return (
    <>
    <div className="min-h-screen bg-background">
      <div className="max-w-6xl mx-auto px-4 py-6 space-y-4">
        <div className="space-y-1">
          <div className="flex items-center gap-3 flex-wrap">
            <Link href="/private/diagnostics">
              <Button variant="ghost" size="icon" data-testid="button-back-from-sync-log">
                <ArrowLeft className="h-4 w-4" />
              </Button>
            </Link>
            <div className="flex items-center gap-2">
              <Github className="h-5 w-5" />
              <h1 className="text-xl font-semibold" data-testid="text-sync-log-title">
                Repository Sync
              </h1>
            </div>
            <div className="ml-auto flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => refetchLog()}
                disabled={logLoading}
                data-testid="button-refresh-sync-log"
              >
                <RefreshCw className={`h-3.5 w-3.5 mr-1.5 ${logLoading ? "animate-spin" : ""}`} />
                Refresh
              </Button>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" data-testid="button-sync-github">
                    <IconCloudUpload className="h-3.5 w-3.5 mr-1.5" />
                    Push / Pull
                    <ChevronDown className="h-3 w-3 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onClick={() => openSyncModal({ expandQueue: true })}
                    data-testid="button-force-push"
                  >
                    <IconCloudUpload className="h-4 w-4 mr-2" />
                    Force Push
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setForcePullOpen(true)} data-testid="button-force-pull">
                    <IconCloudDownload className="h-4 w-4 mr-2" />
                    Force Pull
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={isDownloadingSite}
                    title="Download this site's content folder as a zip. Does not push to GitHub. Excludes sync-state (secrets) and caches."
                    onClick={() => {
                      void handleDownloadSite();
                    }}
                    data-testid="button-download-site-zip"
                  >
                    {isDownloadingSite ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    {isDownloadingSite ? "Downloading…" : "Download site"}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={clearMutation.isPending} data-testid="button-clear-sync-log">
                    <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                    Clear
                    <ChevronDown className="h-3 w-3 ml-1" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => clearMutation.mutate("2days")} data-testid="button-clear-2days">
                    Clear older than 2 days
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => clearMutation.mutate("all")} className="text-destructive" data-testid="button-clear-all">
                    Clear all
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          {syncInfo && (
            <div className="flex items-center gap-3 text-sm text-muted-foreground pl-1">
              <span className="flex items-center gap-1.5">
                <Server className="h-3.5 w-3.5" />
                <code className="text-xs bg-muted px-1.5 py-0.5 rounded" data-testid="text-instance-id">
                  {syncInfo.instanceId} · checkpoint {syncInfo.replitCheckpoint}
                  {syncInfo.githubCommit && (
                    <>
                      {" · "}
                      {syncInfo.repoUrl ? (
                        <a
                          href={`${syncInfo.repoUrl}/commit/${syncInfo.githubCommit}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline hover:text-foreground"
                          data-testid="link-github-commit"
                        >
                          gh:{syncInfo.githubCommit}
                        </a>
                      ) : (
                        <>gh:{syncInfo.githubCommit}</>
                      )}
                    </>
                  )}
                </code>
              </span>
              <button
                type="button"
                className="inline-flex"
                onClick={() => { setWebhookRetryResult(null); setWebhookRetryOpen(true); }}
                title={syncInfo.webhook.active ? "Webhook settings" : "Set up webhook"}
              >
                {syncInfo.webhook.active ? (
                  <Badge
                    variant="secondary"
                    className="gap-1 border-transparent bg-chart-3/15 text-chart-3 font-normal cursor-pointer"
                    data-testid="button-webhook-active"
                  >
                    <Webhook className="h-3 w-3" />
                    Webhook Active
                  </Badge>
                ) : (
                  <Badge
                    variant="secondary"
                    className="gap-1 border-transparent bg-amber-500/15 text-amber-700 dark:text-amber-400 font-normal cursor-pointer"
                    data-testid="button-webhook-inactive"
                  >
                    <Webhook className="h-3 w-3" />
                    Webhook Inactive
                  </Badge>
                )}
              </button>
              {!githubConnectionLoading && connection && (
                <Popover>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex"
                      data-testid={
                        connection.connected && connection.githubLogin
                          ? "badge-github-connection-ok"
                          : "badge-github-connection-missing"
                      }
                    >
                      {connection.connected && connection.githubLogin ? (
                        <Badge
                          variant="secondary"
                          className="gap-1 border-transparent bg-chart-3/15 text-chart-3 font-normal cursor-pointer"
                        >
                          <Github className="h-3 w-3" />
                          @{connection.githubLogin}
                        </Badge>
                      ) : (
                        <Badge
                          variant="destructive"
                          className="gap-1 font-normal cursor-pointer"
                        >
                          <Github className="h-3 w-3" />
                          Github account not connected
                        </Badge>
                      )}
                    </button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="start"
                    className="w-80 space-y-3 text-sm"
                    data-testid="popover-github-connection"
                  >
                    {connection.connected && connection.githubLogin ? (
                      <>
                        <div className="space-y-1">
                          <p className="font-medium text-foreground flex items-center gap-1.5">
                            <Github className="h-3.5 w-3.5" />
                            Connected as @{connection.githubLogin}
                          </p>
                          <p className="text-muted-foreground text-xs leading-relaxed">
                            When you save or push content, GitHub records the commit under your
                            account. Other people will see you as the author on the content repo.
                          </p>
                          <p className="text-muted-foreground text-xs leading-relaxed">
                            Pulls and automatic system jobs still use the shared service token —
                            that does not change your commit identity.
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="w-full"
                          onClick={() => {
                            void (async () => {
                              const result = await disconnectGitHub();
                              if (!result.ok) {
                                toast({
                                  title: "Disconnect failed",
                                  description: result.error,
                                  variant: "destructive",
                                });
                                return;
                              }
                              await invalidateGitHubConnection();
                              toast({
                                title: "GitHub disconnected",
                                description:
                                  "You can Connect again anytime to resume commits as yourself.",
                              });
                            })();
                          }}
                          data-testid="button-github-disconnect-popover"
                        >
                          Disconnect GitHub
                        </Button>
                      </>
                    ) : (
                      <>
                        <div className="space-y-1">
                          <p className="font-medium text-foreground flex items-center gap-1.5">
                            <Github className="h-3.5 w-3.5" />
                            GitHub not connected
                          </p>
                          <p className="text-muted-foreground text-xs leading-relaxed">
                            {connection.required
                              ? "This environment requires your personal GitHub account before you can push content. Until you connect, commits are blocked so changes are not published under the shared bot account."
                              : "You have not linked a GitHub account yet. Commits currently use the shared service token. Connecting is optional here, but it lets commits show up as you on GitHub."}
                          </p>
                          <p className="text-muted-foreground text-xs leading-relaxed">
                            Fix: click Connect below, approve access for the content repository, then
                            return here. You only need to do this once per user on this site.
                          </p>
                        </div>
                        <Button
                          type="button"
                          size="sm"
                          className="w-full"
                          onClick={() => void startGitHubConnect()}
                          data-testid="button-github-connect-popover"
                        >
                          Connect GitHub
                        </Button>
                      </>
                    )}
                  </PopoverContent>
                </Popover>
              )}
            </div>
          )}
        </div>

        <Card>
          <CardContent className="p-4 space-y-3">
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Filter className="h-3.5 w-3.5" />
                <span>Filter:</span>
              </div>
              {CATEGORIES.map((cat) => (
                <Badge
                  key={cat}
                  variant={activeCategories.has(cat) ? getCategoryBadgeVariant(cat) : "outline"}
                  className={`cursor-pointer select-none ${!activeCategories.has(cat) ? "opacity-50" : ""}`}
                  onClick={() => toggleCategory(cat)}
                  onDoubleClick={() => selectOnly(cat)}
                  data-testid={`badge-filter-${cat.toLowerCase()}`}
                >
                  {cat}
                  {categoryCounts[cat] ? (
                    <span className="ml-1 opacity-70">({categoryCounts[cat]})</span>
                  ) : null}
                </Badge>
              ))}
              {activeCategories.size > 0 && (
                <button
                  onClick={() => setActiveCategories(new Set([]))}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors underline"
                  data-testid="button-clear-filters"
                >
                  Clear filters
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <User className="h-3.5 w-3.5" />
                <span>Person:</span>
              </div>
              {uniquePersons.length === 0 ? (
                <span className="text-xs text-muted-foreground italic">No authors recorded yet</span>
              ) : (
                <>
                  {uniquePersons.map((person) => {
                    const slug = person.toLowerCase().replace(/\s+/g, "-");
                    const isActive = activePersons.has(person);
                    return (
                      <Badge
                        key={person}
                        variant={isActive ? "secondary" : "outline"}
                        className={`cursor-pointer select-none ${!isActive ? "opacity-50" : ""}`}
                        onClick={() => {
                          setActivePersons((prev) => {
                            const next = new Set(prev);
                            if (next.has(person)) next.delete(person);
                            else next.add(person);
                            return next;
                          });
                        }}
                        onDoubleClick={() => setActivePersons(new Set([person]))}
                        data-testid={`badge-person-${slug}`}
                      >
                        {person}
                      </Badge>
                    );
                  })}
                  {activePersons.size > 0 && (
                    <button
                      onClick={() => setActivePersons(new Set([]))}
                      className="text-xs text-muted-foreground hover:text-foreground transition-colors underline"
                      data-testid="button-clear-person-filters"
                    >
                      Clear
                    </button>
                  )}
                </>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Search className="h-3.5 w-3.5" />
                <span>Page:</span>
              </div>
              <SitemapSearch
                value={sitemapPage}
                onChange={(url) => {
                  setSitemapPage(url);
                  if (url) {
                    const LOCALE_PREFIXES = new Set(["en", "es", "us"]);
                    const parts = url.split("/").filter(Boolean);
                    const contentParts = parts.length > 0 && LOCALE_PREFIXES.has(parts[0]) ? parts.slice(1) : parts;
                    setSearch(contentParts[contentParts.length - 1] || "");
                  } else {
                    setSearch("");
                  }
                }}
                placeholder="Pick a page..."
                testId="sitemap-search-sync-log"
              />
              {sitemapPage && (
                <button
                  onClick={() => { setSitemapPage(""); setSearch(""); }}
                  className="text-xs text-muted-foreground hover:text-foreground transition-colors underline"
                  data-testid="button-clear-page-filter"
                >
                  Clear
                </button>
              )}
            </div>

            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by page slug, message, date..."
                value={search}
                onChange={(e) => { setSearch(e.target.value); setSitemapPage(""); }}
                className="pl-9"
                data-testid="input-search-sync-log"
              />
            </div>
          </CardContent>
        </Card>

        <Card ref={syncLogCardRef}>
          <CardContent className="p-0">
            <div className="flex items-center justify-between px-4 py-2 border-b">
              <span className="text-sm text-muted-foreground" data-testid="text-entry-count">
                {filtered.length} of {entries.length} entries
              </span>
              <span className="text-xs text-muted-foreground">
                Auto-refreshes every 15s
              </span>
            </div>

            {logLoading && entries.length === 0 ? (
              <div className="flex items-center justify-center py-12">
                <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : filtered.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-muted-foreground" data-testid="text-no-entries">
                <span className="text-sm">
                  {entries.length === 0
                    ? "No sync log entries yet"
                    : activeCategories.size === 1 && activeCategories.has("WEBHOOK")
                      ? "No WEBHOOK entries on this process yet. Deliveries may have hit another replica — check GitHub → Webhooks → Recent Deliveries."
                      : "No entries match current filters"}
                </span>
              </div>
            ) : (
              <ScrollArea className="h-[calc(100vh-320px)]">
                <div className="font-mono text-xs">
                  {filtered
                    .slice()
                    .reverse()
                    .map((entry, i) => (
                      <div
                        key={i}
                        className={`flex gap-3 px-4 py-1.5 border-b border-border/50 items-start ${
                          entry.category === "ERROR"
                            ? "bg-red-50/50 dark:bg-red-950/20"
                            : entry.category === "CONFLICT"
                              ? "bg-amber-50/50 dark:bg-amber-950/20"
                              : entry.category === "EDIT"
                                ? "bg-indigo-50/30 dark:bg-indigo-950/10"
                                : ""
                        }`}
                        data-testid={`log-entry-${i}`}
                      >
                        <span className="text-muted-foreground shrink-0 tabular-nums w-[80px]">
                          {entry.timeOnly}
                        </span>
                        <span className="text-muted-foreground shrink-0 tabular-nums w-[80px]">
                          {entry.dateOnly}
                        </span>
                        <span
                          className={`shrink-0 w-[90px] font-semibold ${getCategoryColor(entry.category)}`}
                        >
                          [{entry.category}]
                        </span>
                        {entry.person && (
                          <span className="text-muted-foreground shrink-0 flex items-center gap-1">
                            <User className="h-3 w-3" />
                            {entry.person}
                          </span>
                        )}
                        <span className="text-foreground break-all min-w-0 flex-1">
                          {renderMessageWithLinks(entry.message, syncInfo?.repoUrl)}
                        </span>
                        {entry.category === "WEBHOOK" && entry.meta && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-6 shrink-0 px-1.5 text-[11px] text-muted-foreground hover:text-foreground"
                            onClick={() => setWebhookPayloadMeta(entry.meta!)}
                            data-testid={`button-view-webhook-payload-${i}`}
                          >
                            <Braces className="h-3 w-3 mr-1" />
                            View payload
                          </Button>
                        )}
                      </div>
                    ))}
                </div>
              </ScrollArea>
            )}
          </CardContent>
        </Card>
      </div>
    </div>

    {/* Force Pull Modal */}
    <Dialog open={forcePullOpen} onOpenChange={(open) => {
      if (!open && !pullStatus?.running) {
        setForcePullOpen(false);
        // Do not clear forcePullConfirmOpen here — we close this dialog
        // intentionally before showing the replace confirmation.
        if (!forcePullConfirmOpenRef.current) {
          setPullResultSearch("");
        }
      }
    }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {pullStatus?.doneAt != null ? (
              pullStatus.cancelled ? (
                <IconMinus className="h-5 w-5 text-muted-foreground" />
              ) : (pullStatus.errors?.length ?? 0) > 0 ? (
                <IconAlertTriangle className="h-5 w-5 text-destructive" />
              ) : (
                <IconCheck className="h-5 w-5 text-primary" />
              )
            ) : pullStatus?.running ? (
              <IconCloudDownload className="h-5 w-5 animate-pulse" />
            ) : (
              <IconCloudDownload className="h-5 w-5" />
            )}
            {(() => {
              const base =
                pullStatus?.doneAt != null
                  ? pullStatus.cancelled
                    ? "Pull cancelled"
                    : (pullStatus.errors?.length ?? 0) > 0
                      ? "Pull completed with errors"
                      : "Pull complete"
                  : pullStatus?.running
                    ? cancelPullMutation.isPending
                      ? "Cancelling pull…"
                      : "Pulling from GitHub…"
                    : "Pull from GitHub";
              return siteLabel ? `${base} · ${siteLabel}` : base;
            })()}
          </DialogTitle>

          {/* Pre-start description — only shown before a pull is running */}
          {!pullStatus?.running && pullStatus?.doneAt == null && (
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>Overwrite local content with what is on GitHub. Choose how much to download:</p>
                <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                  <li><span className="font-medium text-foreground">Pull only changed</span> — only missing files and files whose hash differs from remote. Does not delete local leftovers.</li>
                  <li><span className="font-medium text-foreground">Pull all and replace</span> — download one repository archive, overwrite this site’s content folder files, and delete tracked local files that no longer exist on GitHub (fewer API calls; use for recovery).</li>
                  <li><span className="font-medium text-foreground">GitHub always wins</span> — local edits not yet committed will be lost for downloaded files; force replace also removes local-only tracked files under this site folder.</li>
                </ul>
                <details className="text-xs text-muted-foreground pt-1">
                  <summary className="cursor-pointer font-medium text-foreground/80 hover:text-foreground">Read more (advanced)</summary>
                  <p className="mt-1.5 leading-relaxed">
                    Prune runs only on the force path in <code className="text-[10px]">server/github.ts</code> (<code className="text-[10px]">bootstrapContentFromRemote</code> with <code className="text-[10px]">force: true</code>) after the tarball replace, scoped by <code className="text-[10px]">shouldTrackFile</code> / the site content folder. Sync state is rebuilt afterward so leftovers do not appear as added in the Commit Queue. Soft pull and server restart do not prune.
                  </p>
                </details>
              </div>
            </DialogDescription>
          )}
        </DialogHeader>

        {/* Live progress — shown while running */}
        {pullStatus?.running && (() => {
          const isArchive = pullStatus.mode === "archive";
          const phase = pullStatus.phase ?? "listing";
          const processed = (pullStatus.pulled ?? 0) + (pullStatus.skipped ?? 0);
          const elapsed = formatElapsedSince(pullStatus.startedAt);
          const downloadedBytes = pullStatus.archiveBytesDownloaded ?? 0;
          const totalBytes = pullStatus.archiveBytesTotal ?? null;
          const bytePct =
            totalBytes && totalBytes > 0
              ? Math.min(100, Math.round((downloadedBytes / totalBytes) * 100))
              : null;
          const extracted = pullStatus.extracted ?? 0;
          const replaced = pullStatus.replaced ?? pullStatus.pulled ?? 0;
          const lastFile = pullStatus.lastReplacedFile
            ? shortenPullPath(pullStatus.lastReplacedFile, siteInfo?.contentFolder)
            : null;

          let statusLine: string;
          let barWidth: string;
          let detailLine: string | null = null;

          if (!isArchive) {
            statusLine =
              pullStatus.total > 0
                ? `Checking/downloading… ${processed} of ${pullStatus.total}`
                : "Fetching file list from GitHub…";
            barWidth =
              pullStatus.total > 0
                ? `${Math.round((processed / pullStatus.total) * 100)}%`
                : "10%";
            detailLine =
              pullStatus.total > 0
                ? `${pullStatus.pulled} downloaded, ${pullStatus.skipped ?? 0} skipped / ${pullStatus.total} files`
                : null;
          } else if (phase === "downloading") {
            statusLine = "Downloading repository archive…";
            barWidth = bytePct != null ? `${bytePct}%` : "15%";
            detailLine =
              totalBytes != null
                ? `${formatByteSize(downloadedBytes)} / ${formatByteSize(totalBytes)}${elapsed ? ` · ${elapsed}` : ""}`
                : `${formatByteSize(downloadedBytes)} downloaded${elapsed ? ` · ${elapsed}` : ""}`;
          } else if (phase === "extracting") {
            statusLine = "Archive downloaded. Extracting content…";
            barWidth =
              pullStatus.total > 0
                ? `${Math.min(100, Math.round((extracted / pullStatus.total) * 100))}%`
                : "40%";
            detailLine =
              pullStatus.total > 0
                ? `${extracted} / ${pullStatus.total} files extracted`
                : `${extracted} files extracted`;
          } else if (phase === "replacing") {
            const replaceDenom = pullStatus.replaceTotal ?? pullStatus.total;
            statusLine = "Replacing local files…";
            barWidth =
              replaceDenom > 0
                ? `${Math.min(100, Math.round((replaced / replaceDenom) * 100))}%`
                : "70%";
            detailLine =
              replaceDenom > 0
                ? `${replaced} / ${replaceDenom} files${lastFile ? ` · ${lastFile}` : ""}`
                : `${replaced} files${lastFile ? ` · ${lastFile}` : ""}`;
          } else if (phase === "finalizing") {
            statusLine = "Files replaced. Updating sync state…";
            barWidth = "95%";
            detailLine = `${replaced} files replaced`;
          } else {
            statusLine = "Preparing archive download…";
            barWidth = "10%";
            detailLine = elapsed ? `Elapsed ${elapsed}` : null;
          }

          return (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{statusLine}</p>
            <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: barWidth }}
              />
            </div>
            {detailLine && (
              <p className="text-xs text-muted-foreground text-right truncate" title={detailLine}>
                {detailLine}
              </p>
            )}
          </div>
          );
        })()}

        {/* Result KPIs + file list (completion or cancelled) */}
        {pullStatus?.doneAt != null && (() => {
          const downloaded = pullStatus.pulledFiles ?? [];
          const skipped = pullStatus.skippedFiles ?? [];
          const removed = pullStatus.deletedFiles ?? [];
          const errors = pullStatus.errors ?? [];
          const folder = siteInfo?.contentFolder;
          const downloadedList = downloaded.map((p) => shortenPullPath(p, folder));
          const skippedList = skipped.map((p) => shortenPullPath(p, folder));
          const removedList = removed.map((p) => shortenPullPath(p, folder));
          const errorsList = errors.map((e) => {
            const colon = e.indexOf(": ");
            if (colon > 0) {
              const pathPart = e.slice(0, colon);
              const msg = e.slice(colon + 2);
              return `${shortenPullPath(pathPart, folder)}: ${msg}`;
            }
            return e;
          });
          const searchQ = pullResultSearch.trim().toLowerCase();
          const matchesSearch = (line: string) =>
            !searchQ || line.toLowerCase().includes(searchQ);
          const downloadedFiltered = downloadedList.filter(matchesSearch);
          const skippedFiltered = skippedList.filter(matchesSearch);
          const removedFiltered = removedList.filter(matchesSearch);
          const errorsFiltered = errorsList.filter(matchesSearch);
          const tabs = [
            {
              id: "downloaded" as const,
              label: "Downloaded",
              count: searchQ ? downloadedFiltered.length : (pullStatus.pulled ?? downloadedList.length),
              total: pullStatus.pulled ?? downloadedList.length,
              icon: IconCloudDownload,
              activeClass: "border-primary bg-primary/10 text-primary",
              countClass: "",
            },
            {
              id: "skipped" as const,
              label: "Skipped",
              count: searchQ ? skippedFiltered.length : (pullStatus.skipped ?? skippedList.length),
              total: pullStatus.skipped ?? skippedList.length,
              icon: IconMinus,
              activeClass: "border-muted-foreground/40 bg-muted text-foreground",
              countClass: "",
            },
            {
              id: "removed" as const,
              label: "Removed",
              count: searchQ ? removedFiltered.length : (pullStatus.deleted ?? removedList.length),
              total: pullStatus.deleted ?? removedList.length,
              icon: Trash2,
              activeClass: "border-destructive/40 bg-destructive/10 text-destructive",
              countClass: (pullStatus.deleted ?? 0) > 0 ? "text-destructive" : "",
            },
            {
              id: "errors" as const,
              label: "Errors",
              count: searchQ ? errorsFiltered.length : errorsList.length,
              total: errorsList.length,
              icon: IconAlertTriangle,
              activeClass: "border-destructive bg-destructive/10 text-destructive",
              countClass: errorsList.length > 0 ? "text-destructive" : "",
            },
          ];
          const filteredList =
            pullResultTab === "downloaded"
              ? downloadedFiltered
              : pullResultTab === "skipped"
                ? skippedFiltered
                : pullResultTab === "removed"
                  ? removedFiltered
                  : errorsFiltered;
          const activeTotal =
            pullResultTab === "downloaded"
              ? downloadedList.length
              : pullResultTab === "skipped"
                ? skippedList.length
                : pullResultTab === "removed"
                  ? removedList.length
                  : errorsList.length;
          const emptyLabel =
            pullResultTab === "downloaded"
              ? "No files downloaded"
              : pullResultTab === "skipped"
                ? "No files skipped"
                : pullResultTab === "removed"
                  ? "No local-only files removed"
                  : "No errors";
          const hasAnyResults =
            downloadedList.length > 0 ||
            skippedList.length > 0 ||
            removedList.length > 0 ||
            errorsList.length > 0;

          return (
            <div className="space-y-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="tablist" aria-label="Pull result categories">
                {tabs.map((tab) => {
                  const Icon = tab.icon;
                  const selected = pullResultTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      role="tab"
                      aria-selected={selected}
                      onClick={() => setPullResultTab(tab.id)}
                      className={cn(
                        "flex flex-col items-center justify-center gap-0.5 rounded-md border p-2.5 text-center transition-colors hover-elevate",
                        selected
                          ? tab.activeClass
                          : "border-transparent bg-muted/50 text-muted-foreground",
                      )}
                      data-testid={`pull-result-tab-${tab.id}`}
                    >
                      <Icon size={16} className="shrink-0" />
                      <span className={cn("text-base font-medium tabular-nums leading-none", selected ? tab.countClass : "")}>
                        {tab.count}
                        {searchQ && tab.total !== tab.count ? (
                          <span className="text-[10px] font-normal text-muted-foreground">/{tab.total}</span>
                        ) : null}
                      </span>
                      <span className="text-[10px] leading-tight">{tab.label}</span>
                    </button>
                  );
                })}
              </div>

              {hasAnyResults && (
                <div className="relative">
                  <Search className="absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <Input
                    value={pullResultSearch}
                    onChange={(e) => setPullResultSearch(e.target.value)}
                    placeholder="Search downloaded, skipped, removed, or errors…"
                    className="h-7 pl-7 text-xs"
                    data-testid="input-pull-result-search"
                  />
                </div>
              )}

              <ScrollArea className="h-40 rounded-md border bg-muted/30">
                <div className="p-2.5 space-y-1" role="tabpanel" data-testid={`pull-result-list-${pullResultTab}`}>
                  {activeTotal === 0 ? (
                    <p className="text-xs text-muted-foreground py-6 text-center">{emptyLabel}</p>
                  ) : filteredList.length === 0 ? (
                    <p className="text-xs text-muted-foreground py-6 text-center">No matches in {pullResultTab}</p>
                  ) : (
                    filteredList.map((line, i) => (
                      <p
                        key={`${pullResultTab}-${i}`}
                        className={cn(
                          "text-xs font-mono break-all leading-snug",
                          pullResultTab === "errors" || pullResultTab === "removed"
                            ? "text-destructive"
                            : "text-foreground",
                        )}
                      >
                        {line}
                      </p>
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>
          );
        })()}

        <DialogFooter className="gap-2 sm:gap-0 flex-col-reverse sm:flex-row sm:flex-wrap sm:justify-end">
          {pullStatus?.running ? (
            <Button
              variant="outline"
              onClick={() => cancelPullMutation.mutate()}
              disabled={cancelPullMutation.isPending}
              data-testid="button-cancel-force-pull"
            >
              {cancelPullMutation.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Cancelling…</>
                : "Cancel pull"}
            </Button>
          ) : (
            <Button
              variant="outline"
              onClick={() => setForcePullOpen(false)}
              data-testid="button-close-force-pull"
            >
              {pullStatus?.doneAt != null ? "Close" : "Cancel"}
            </Button>
          )}
          {(!pullStatus || pullStatus.doneAt != null) && !pullStatus?.running && (
            <>
              <Button
                onClick={() => startPullMutation.mutate(false)}
                disabled={startPullMutation.isPending || pullStatus?.running}
                data-testid="button-start-partial-pull"
              >
                {startPullMutation.isPending
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Starting…</>
                  : <><IconCloudDownload className="h-4 w-4 mr-2" />Pull only changed</>}
              </Button>
              <Button
                variant="destructive"
                onClick={() => {
                  forcePullConfirmOpenRef.current = true;
                  setForcePullOpen(false);
                  setForcePullConfirmOpen(true);
                }}
                disabled={startPullMutation.isPending || pullStatus?.running}
                data-testid="button-start-force-pull"
              >
                {startPullMutation.isPending
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Starting…</>
                  : <><IconCloudDownload className="h-4 w-4 mr-2" />Pull all and replace</>}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog
      open={forcePullConfirmOpen}
      onOpenChange={(open) => {
        setForcePullConfirmOpen(open);
        if (!open) {
          // Cancel or confirm — return to the pull dialog (progress / options).
          setForcePullOpen(true);
        }
      }}
    >
      <AlertDialogContent data-testid="dialog-confirm-force-pull">
        <AlertDialogHeader>
          <AlertDialogTitle>Pull all and replace?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                This will overwrite local content for{siteLabel ? ` ${siteLabel}` : " this site"} with GitHub and permanently delete tracked local files that no longer exist on the remote.
              </p>
              <p>Uncommitted local edits will be lost. This cannot be undone from the app.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-confirm-force-pull">Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={cn(buttonVariants({ variant: "destructive" }))}
            data-testid="button-confirm-force-pull"
            onClick={() => {
              startPullMutation.mutate(true);
            }}
          >
            Pull all and replace
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <Dialog open={webhookRetryOpen} onOpenChange={(open) => { if (!open) { setWebhookRetryOpen(false); setWebhookRetryResult(null); setCleanupResult(null); setWebhookResetResult(null); } }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{syncInfo?.webhook.active ? "Webhook Active" : "Webhook Inactive"}</DialogTitle>
          <DialogDescription asChild>
            <div>
              {syncInfo?.webhook.active
                ? "The GitHub webhook is registered and receiving events. Changes pushed to GitHub are automatically synced to this app."
                : <>
                    The GitHub webhook is not currently registered. Without it, changes pushed to GitHub won't be automatically pulled into this app.{" "}
                    {syncInfo?.repoUrl && (
                      <a
                        href={`${syncInfo.repoUrl}/settings/hooks`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="underline text-foreground hover:text-foreground/80"
                        data-testid="link-github-webhooks"
                      >
                        View webhooks on GitHub
                      </a>
                    )}{" "}
                    Click retry to attempt registration now.
                  </>
              }
            </div>
          </DialogDescription>
        </DialogHeader>

        <details className="rounded-md border bg-muted/30 px-3 py-2 text-sm" data-testid="details-view-webhook-log">
          <summary className="cursor-pointer font-medium text-foreground select-none" data-testid="summary-view-webhook-log">
            View log
          </summary>
          <div className="mt-2 space-y-2 text-muted-foreground text-xs leading-relaxed">
            <p>
              Webhook deliveries are written to the <span className="font-medium text-foreground">main sync log</span> on this page under category{" "}
              <span className="font-mono text-foreground">WEBHOOK</span>. Use the category filter chips above the log, or click the button below to show only those entries.
            </p>
            <p>
              This log is per process — if another replica handled the delivery, it may not appear here. Cross-check GitHub → Webhooks → Recent Deliveries when empty.
            </p>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              className="w-full sm:w-auto"
              data-testid="button-filter-webhook-log"
              onClick={() => {
                setActiveCategories(new Set(["WEBHOOK"]));
                setWebhookRetryOpen(false);
                setWebhookRetryResult(null);
                setCleanupResult(null);
                setWebhookResetResult(null);
                requestAnimationFrame(() => {
                  syncLogCardRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
                });
              }}
            >
              Show WEBHOOK entries only
            </Button>
          </div>
        </details>

        {syncInfo?.webhook.active && (
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 p-3 rounded-md bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-900">
              <Check className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0" />
              <span className="text-green-700 dark:text-green-300 font-medium">Webhook #{syncInfo.webhook.id} is active</span>
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-muted-foreground px-1">
              <span className="font-medium text-foreground">URL</span>
              <code className="text-xs bg-muted px-1.5 py-0.5 rounded break-all">{syncInfo.webhook.url}</code>
              {syncInfo.webhook.createdAt && (
                <>
                  <span className="font-medium text-foreground">Registered</span>
                  <span className="text-xs">{new Date(syncInfo.webhook.createdAt).toLocaleString()}</span>
                </>
              )}
            </div>
            {cleanupResult !== null && (
              <div className="flex items-center gap-2 p-2.5 rounded-md bg-muted border text-xs text-muted-foreground">
                <Check className="h-3.5 w-3.5 flex-shrink-0 text-green-600 dark:text-green-400" />
                {cleanupResult.deleted === 0
                  ? "No duplicate webhooks found — already clean."
                  : cleanupResult.deleted < 0
                    ? "Failed to clean up duplicate webhooks."
                    : `Deleted ${cleanupResult.deleted} duplicate webhook${cleanupResult.deleted !== 1 ? "s" : ""} (#${cleanupResult.ids.join(", #")}).`
                }
              </div>
            )}
            {webhookResetResult && (
              <div className={`flex items-start gap-2 p-2.5 rounded-md border text-xs ${webhookResetResult.success ? "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900 text-green-700 dark:text-green-300" : "bg-destructive/10 border-destructive/20 text-destructive"}`}>
                {webhookResetResult.success
                  ? <Check className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                  : <X className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                }
                <p>{webhookResetResult.message}</p>
              </div>
            )}
          </div>
        )}

        {!syncInfo?.webhook.active && webhookRetryResult ? (
          <div className={`flex items-start gap-2 p-3 rounded-md border text-sm ${webhookRetryResult.success ? "bg-green-50 dark:bg-green-950/30 border-green-200 dark:border-green-900" : "bg-destructive/10 border-destructive/20"}`}>
            {webhookRetryResult.success
              ? <Check className="h-4 w-4 text-green-600 dark:text-green-400 flex-shrink-0 mt-0.5" />
              : <X className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
            }
            <p className={webhookRetryResult.success ? "text-green-700 dark:text-green-300" : "text-destructive"}>
              {webhookRetryResult.message}
            </p>
          </div>
        ) : null}

        <DialogFooter className="flex-row flex-nowrap justify-end gap-2 sm:space-x-0">
          {syncInfo?.webhook.active && (
            <>
              {cleanupResult === null && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => cleanupMutation.mutate()}
                  disabled={cleanupMutation.isPending || webhookResetMutation.isPending}
                  data-testid="button-cleanup-webhooks"
                  className="text-destructive border-destructive/40 hover:border-destructive shrink-0"
                >
                  {cleanupMutation.isPending
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Deleting...</>
                    : <><Trash2 className="h-4 w-4 mr-2" />Delete inactive webhooks</>
                  }
                </Button>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => { setWebhookResetResult(null); setWebhookResetConfirmOpen(true); }}
                disabled={cleanupMutation.isPending || webhookResetMutation.isPending}
                data-testid="button-reset-webhook"
                className="shrink-0"
              >
                {webhookResetMutation.isPending
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Re-setting up...</>
                  : <><RefreshCw className="h-4 w-4 mr-2" />Re-setup webhook</>
                }
              </Button>
            </>
          )}
          {!syncInfo?.webhook.active && !webhookRetryResult?.success && (
            <Button
              onClick={() => webhookSetupMutation.mutate()}
              disabled={webhookSetupMutation.isPending}
              data-testid="button-retry-webhook"
            >
              {webhookSetupMutation.isPending
                ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Retrying...</>
                : <><Webhook className="h-4 w-4 mr-2" />Retry</>
              }
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <Dialog open={webhookPayloadMeta !== null} onOpenChange={(open) => { if (!open) setWebhookPayloadMeta(null); }}>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-webhook-payload">
        <DialogHeader>
          <DialogTitle>Webhook delivery summary</DialogTitle>
          <DialogDescription>
            Safe debug fields stored with this WEBHOOK log entry (no secret or raw GitHub body).
          </DialogDescription>
        </DialogHeader>
        <ScrollArea className="max-h-[min(60vh,420px)] rounded-md border bg-muted/40">
          <pre className="p-3 text-xs font-mono whitespace-pre-wrap break-all text-foreground" data-testid="text-webhook-payload-json">
            {webhookPayloadMeta ? JSON.stringify(webhookPayloadMeta, null, 2) : ""}
          </pre>
        </ScrollArea>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setWebhookPayloadMeta(null)} data-testid="button-close-webhook-payload">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <AlertDialog open={webhookResetConfirmOpen} onOpenChange={setWebhookResetConfirmOpen}>
      <AlertDialogContent data-testid="dialog-confirm-webhook-reset">
        <AlertDialogHeader>
          <AlertDialogTitle>Re-setup GitHub webhook?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>
                This deletes every GitHub webhook pointing at this app&apos;s URL, clears the local secret, and registers a fresh hook with a new HMAC secret.
              </p>
              <p>
                Use this when deliveries show <code className="text-xs bg-muted px-1 py-0.5 rounded">invalid HMAC signature</code> or the secret is out of sync.
              </p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid="button-cancel-webhook-reset">Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={cn(buttonVariants({ variant: "destructive" }))}
            data-testid="button-confirm-webhook-reset"
            onClick={(e) => {
              e.preventDefault();
              webhookResetMutation.mutate();
            }}
            disabled={webhookResetMutation.isPending}
          >
            {webhookResetMutation.isPending
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Re-setting up...</>
              : "Delete & re-setup"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>

    <Dialog
      open={githubConnectSuccessOpen}
      onOpenChange={setGithubConnectSuccessOpen}
    >
      <DialogContent className="sm:max-w-md" data-testid="dialog-github-connect-success">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Check className="h-5 w-5 text-chart-3" />
            GitHub connected
          </DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2 text-sm text-muted-foreground pt-1">
              <p>
                Your GitHub account is linked. Content commits in this environment will use your
                identity
                {connection?.githubLogin ? (
                  <>
                    {" "}
                    (<span className="font-medium text-foreground">@{connection.githubLogin}</span>)
                  </>
                ) : null}
                .
              </p>
              <p>
                The service <code className="text-xs bg-muted px-1 rounded">GITHUB_TOKEN</code> is
                still used only for pulls and system operations.
              </p>
            </div>
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            onClick={() => setGithubConnectSuccessOpen(false)}
            data-testid="button-github-connect-success-ok"
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <GitHubConnectErrorDialog
      open={githubConnectError !== null}
      onOpenChange={(open) => {
        if (!open) setGithubConnectError(null);
      }}
      error={githubConnectError}
      setup={connection?.setup}
      onRetry={() => {
        setGithubConnectError(null);
        void startGitHubConnect();
      }}
    />
    </>
  );
}
