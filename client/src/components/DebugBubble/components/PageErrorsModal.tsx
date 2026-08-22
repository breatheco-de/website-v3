import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { PageDiagnostics } from "../types";
import { useFormatSitePath } from "@/hooks/useFormatSitePath";
import { isContentFilePath } from "@shared/formatSitePath";
import { getDebugToken, useDebugAuth } from "@/hooks/useDebugAuth";
import { useToast } from "@/hooks/use-toast";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import { cn } from "@/lib/utils";
import {
  gscHeadline,
  gscCrawlerErrorCount,
  type GscInspectionGetResponse,
} from "@/lib/gscInspection";
import {
  IconAlertTriangle,
  IconArrowRight,
  IconBrandGoogle,
  IconCheck,
  IconChevronDown,
  IconClock,
  IconCopy,
  IconExternalLink,
  IconLoader2,
  IconLock,
  IconLockOpen,
  IconRefresh,
  IconSparkles,
  IconUser,
} from "@tabler/icons-react";
import * as Flags from "country-flag-icons/react/3x2";
import {
  SOLVE_WITH_AI_MENU,
  buildSolveWithAiPrompt,
  type SolveWithAiAgentId,
} from "../solveWithAiPrompt";
import { SolveWithAiAgentIcon } from "../SolveWithAiAgentIcon";
import type { McpSetupTabId } from "@/components/mcp/mcpUrlHelpers";

/** Validators that make sense for a single page (entry-local only). */
export const PER_PAGE_VALIDATORS = [
  "meta",
  "required-fields",
  "editor-field-types",
  "unknown-keys",
  "seo-depth",
  "seo-intent",
  "seo-cluster",
  "schema-completeness",
  "content-quality",
  "section-variants",
];

interface PageErrorsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pageDiagnostics: PageDiagnostics | null;
  pageUrl?: string;
  loading?: boolean;
  error?: string | null;
  onRefreshDiagnostics?: () => Promise<void>;
  /** Called after Solve with AI copies the prompt. Parent should close this modal and open MCP confirmation (do not open the LLM yet). */
  onSolveWithAi?: (payload: {
    agentId: SolveWithAiAgentId;
    setupTab: McpSetupTabId;
    prompt: string;
    label: string;
    prefillUrlPrefix?: string;
  }) => void;
}

type PageIssue = NonNullable<PageDiagnostics["issues"]>[number];

function formatStaleness(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? "" : "s"} ago`;
  const days = Math.floor(hrs / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function LocaleFlag({ locale }: { locale: string }) {
  const FlagComponent = locale === "es" ? Flags.ES : Flags.US;
  return <FlagComponent className="h-3.5 w-auto rounded-sm" title={locale === "es" ? "Spanish" : "English"} />;
}

/** Site-relative URL path in quotes (e.g. "/en/career-programs"), not a YAML file path. */
function isInternalUrlPath(path: string): boolean {
  return path.startsWith("/") && !path.startsWith("//") && !isContentFilePath(path);
}

/**
 * In-dialog relative menu (not Radix DropdownMenu).
 * Portaled DropdownMenu content sits outside Dialog's focus scope; the Dialog
 * focus trap steals focus back and the menu closes immediately.
 */
function InternalPathActions({ path }: { path: string }) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <span ref={menuRef} className="relative inline-block">
      <button
        type="button"
        className="inline font-mono text-primary underline underline-offset-2 hover:text-primary/80"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((prev) => !prev);
        }}
        data-testid="button-issue-path-menu"
      >
        {path}
      </button>
      {open && (
        <div
          role="menu"
          className="absolute left-0 top-full z-[10001] mt-1 w-44 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          <button
            type="button"
            role="menuitem"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] hover-elevate"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
              void navigator.clipboard.writeText(path).then(
                () => toast({ title: "Copied", description: path }),
                () => toast({ title: "Copy failed", variant: "destructive" }),
              );
            }}
            data-testid="menu-issue-path-copy"
          >
            <IconCopy className="h-3.5 w-3.5" />
            Copy
          </button>
          <a
            role="menuitem"
            href={path}
            target="_blank"
            rel="noopener noreferrer"
            className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] hover-elevate"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
            data-testid="menu-issue-path-open"
          >
            <IconExternalLink className="h-3.5 w-3.5" />
            Open in new tab
          </a>
        </div>
      )}
    </span>
  );
}

/** Renders validation text; quoted internal URL paths get copy / open actions. */
function IssueMessageWithLinks({
  text,
  formatSitePath,
}: {
  text: string;
  formatSitePath: (path: string) => string;
}) {
  if (!text) return null;
  if (!text.includes('"')) {
    return <>{isContentFilePath(text) ? formatSitePath(text) : text}</>;
  }

  const parts: ReactNode[] = [];
  let lastIndex = 0;
  const re = /"([^"]+)"/g;
  let match: RegExpExecArray | null;
  let key = 0;
  while ((match = re.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    const inner = match[1];
    if (isInternalUrlPath(inner)) {
      parts.push('"');
      parts.push(<InternalPathActions key={`path-${key++}`} path={inner} />);
      parts.push('"');
    } else if (isContentFilePath(inner)) {
      parts.push(`"${formatSitePath(inner)}"`);
    } else {
      parts.push(match[0]);
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  return <>{parts}</>;
}

function IssueCard({
  issue,
  index,
  variant,
  formatSitePath,
  onUpdateIssue,
  togglePending,
}: {
  issue: PageIssue;
  index: number;
  variant: "error" | "warning";
  formatSitePath: (path: string) => string;
  onUpdateIssue?: (
    issue: PageIssue,
    action: "claim" | "release" | "complete" | "uncomplete",
  ) => void;
  togglePending?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const isError = variant === "error";
  const cacheBuiltAt = issue.validationCacheBuiltAt;
  const isCompleted = Boolean(issue.completed);
  const isClaimed = Boolean(issue.claimed);
  const canAct = Boolean(issue.id && onUpdateIssue);
  const hasDetails = Boolean(
    issue.details?.expected ||
      issue.suggestion ||
      issue.file ||
      cacheBuiltAt ||
      issue.completed ||
      issue.claimed,
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div
        className={
          isCompleted
            ? "rounded-md bg-muted/40 border border-border text-sm opacity-80"
            : isError
              ? "rounded-md bg-destructive/10 border border-destructive/30 text-sm"
              : "rounded-md bg-amber-500/10 border border-amber-500/30 text-sm"
        }
        data-testid={`modal-${variant}-${index}${isCompleted ? "-completed" : ""}`}
      >
        <div className="flex w-full items-start gap-2 p-3">
          <div className="min-w-0 flex-1">
            <CollapsibleTrigger asChild disabled={!hasDetails}>
              <button
                type="button"
                className={cn(
                  "w-full text-left",
                  hasDetails ? "cursor-pointer" : "cursor-default",
                )}
                data-testid={`modal-${variant}-${index}-toggle`}
                aria-expanded={open}
              >
                <div
                  className={
                    isCompleted
                      ? "font-mono font-medium text-muted-foreground text-xs"
                      : isError
                        ? "font-mono font-medium text-destructive text-xs"
                        : "font-mono font-medium text-amber-700 dark:text-amber-300 text-xs"
                  }
                >
                  {issue.code}
                </div>
              </button>
            </CollapsibleTrigger>
            <div className={cn("mt-1", isCompleted ? "text-muted-foreground" : "text-foreground")}>
              <IssueMessageWithLinks text={issue.message} formatSitePath={formatSitePath} />
            </div>
            {issue.claimed && !isCompleted && (
              <p
                className="mt-1 text-[11px] text-muted-foreground flex items-center gap-1"
                data-testid={`modal-${variant}-${index}-claimed-by`}
              >
                <IconUser className="h-3 w-3 shrink-0" />
                Claimed by {issue.claimed.by}
                {issue.claimed.expiresAt && (
                  <span className="opacity-80">
                    · until {new Date(issue.claimed.expiresAt).toLocaleTimeString()}
                  </span>
                )}
              </p>
            )}
            {issue.completed && (
              <p
                className="mt-1 text-[11px] text-muted-foreground"
                data-testid={`modal-${variant}-${index}-completed-by`}
              >
                Completed by {issue.completed.by}
              </p>
            )}
          </div>
          {canAct && !isCompleted && (
            <button
              type="button"
              className={cn(
                "shrink-0 mt-0.5 rounded-md p-1 transition-colors",
                isClaimed
                  ? "text-status-away hover:bg-muted"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted",
              )}
              aria-label={isClaimed ? "Release claim" : "Claim issue"}
              title={
                isClaimed
                  ? `Release claim (${issue.claimed?.by})`
                  : "Claim — mark as in progress (30m)"
              }
              disabled={togglePending}
              onClick={(e) => {
                e.stopPropagation();
                onUpdateIssue?.(issue, isClaimed ? "release" : "claim");
              }}
              data-testid={`modal-${variant}-${index}-claim`}
            >
              {togglePending ? (
                <IconLoader2 className="h-4 w-4 animate-spin" />
              ) : isClaimed ? (
                <IconLockOpen className="h-4 w-4" />
              ) : (
                <IconLock className="h-4 w-4" />
              )}
            </button>
          )}
          {canAct && (
            <button
              type="button"
              className={cn(
                "shrink-0 mt-0.5 rounded-md p-1 transition-colors",
                isCompleted
                  ? "text-status-online hover:bg-muted"
                  : "text-muted-foreground hover:text-status-online hover:bg-muted",
              )}
              aria-label={isCompleted ? "Mark as open" : "Mark as fixed"}
              title={
                isCompleted
                  ? "Mark as open"
                  : "Mark as fixed — hides until the next cache write"
              }
              disabled={togglePending}
              onClick={(e) => {
                e.stopPropagation();
                onUpdateIssue?.(issue, isCompleted ? "uncomplete" : "complete");
              }}
              data-testid={`modal-${variant}-${index}-complete`}
            >
              {togglePending ? (
                <IconLoader2 className="h-4 w-4 animate-spin" />
              ) : (
                <IconCheck className="h-4 w-4" stroke={isCompleted ? 2.5 : 1.5} />
              )}
            </button>
          )}
          {hasDetails && (
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="shrink-0 mt-0.5 text-muted-foreground"
                aria-label={open ? "Hide details" : "Show details"}
                data-testid={`modal-${variant}-${index}-chevron`}
              >
                <IconChevronDown
                  className={cn(
                    "h-4 w-4 transition-transform",
                    open && "rotate-180",
                  )}
                />
              </button>
            </CollapsibleTrigger>
          )}
        </div>
        {hasDetails && (
          <CollapsibleContent>
            <div className="px-3 pb-3 space-y-1">
              {issue.details?.expected && (
                <div className="text-xs text-muted-foreground">
                  Expected: <span className="font-mono">{issue.details.expected}</span>
                  {issue.details.received && (
                    <>
                      {" "}
                      | Received: <span className="font-mono">{issue.details.received}</span>
                    </>
                  )}
                </div>
              )}
              {issue.suggestion && (
                <div className="text-xs text-muted-foreground">
                  <IssueMessageWithLinks text={issue.suggestion} formatSitePath={formatSitePath} />
                </div>
              )}
              {issue.file && (
                <div className="text-xs text-muted-foreground font-mono" title={issue.file}>
                  {formatSitePath(issue.file)}
                </div>
              )}
              {cacheBuiltAt && (
                <div className="text-xs text-muted-foreground flex items-center gap-1">
                  <IconClock className="h-3 w-3" />
                  Cache built at {new Date(cacheBuiltAt).toLocaleString()}
                </div>
              )}
            </div>
          </CollapsibleContent>
        )}
      </div>
    </Collapsible>
  );
}

export function PageErrorsModal(props: PageErrorsModalProps) {
  const {
    open,
    onOpenChange,
    pageDiagnostics,
    pageUrl,
    loading = false,
    error = null,
    onRefreshDiagnostics,
    onSolveWithAi,
  } = props;

  const [isRunningValidation, setIsRunningValidation] = useState(false);
  const [activeTab, setActiveTab] = useState<"errors" | "warnings" | "crawlers">("errors");
  const [openPageMenuOpen, setOpenPageMenuOpen] = useState(false);
  const [solveMenuOpen, setSolveMenuOpen] = useState(false);
  const [completedErrorsOpen, setCompletedErrorsOpen] = useState(false);
  const [completedWarningsOpen, setCompletedWarningsOpen] = useState(false);
  const [togglingIssueId, setTogglingIssueId] = useState<string | null>(null);
  const openPageMenuRef = useRef<HTMLDivElement>(null);
  const solveMenuRef = useRef<HTMLDivElement>(null);
  const formatSitePath = useFormatSitePath();
  const queryClient = useQueryClient();
  const { hasCapability } = useDebugAuth();
  const canInspect = hasCapability("seo_edit");
  const { toast } = useToast();

  const allErrors = pageDiagnostics?.issues?.filter((i) => i.type === "error") ?? [];
  const allWarnings = pageDiagnostics?.issues?.filter((i) => i.type === "warning") ?? [];
  const errors = allErrors.filter((i) => !i.completed);
  const warnings = allWarnings.filter((i) => !i.completed);
  const completedErrors = allErrors.filter((i) => i.completed);
  const completedWarnings = allWarnings.filter((i) => i.completed);
  const canSolveWithAi = Boolean(pageDiagnostics && (errors.length > 0 || warnings.length > 0));
  const openPageUrl = pageUrl ?? pageDiagnostics?.url;
  const inspectLookupUrl = openPageUrl || "";

  const handleUpdateIssue = async (
    issue: PageIssue,
    action: "claim" | "release" | "complete" | "uncomplete",
  ) => {
    if (!issue.id) {
      toast({
        title: "Cannot update issue",
        description: "This issue has no id — refresh diagnostics and try again.",
        variant: "destructive",
      });
      return;
    }
    setTogglingIssueId(issue.id);
    try {
      const token = getDebugToken();
      const res = await fetch("/api/validation/cache-issues/update", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getSessionHeaders(),
          ...(token ? { Authorization: `Token ${token}` } : {}),
        },
        body: JSON.stringify({ issueId: issue.id, action }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Update failed");
      }
      await onRefreshDiagnostics?.();
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-summary"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/validation/cache-issues"] });
    } catch (err) {
      const titles: Record<typeof action, string> = {
        claim: "Could not claim issue",
        release: "Could not release claim",
        complete: "Could not mark fixed",
        uncomplete: "Could not reopen issue",
      };
      toast({
        title: titles[action],
        description: err instanceof Error ? err.message : "Request failed",
        variant: "destructive",
      });
    } finally {
      setTogglingIssueId(null);
    }
  };

  const gscQuery = useQuery<GscInspectionGetResponse>({
    queryKey: ["/api/debug/gsc-inspection", inspectLookupUrl],
    enabled: open && Boolean(inspectLookupUrl),
    queryFn: async () => {
      const token = getDebugToken();
      const res = await fetch(
        `/api/debug/gsc-inspection?url=${encodeURIComponent(inspectLookupUrl)}`,
        {
          headers: {
            ...getSessionHeaders(),
            ...(token ? { Authorization: `Token ${token}` } : {}),
          },
        },
      );
      if (!res.ok) throw new Error("Failed to load Search Console cache");
      return res.json() as Promise<GscInspectionGetResponse>;
    },
  });

  const crawlerErrors = gscCrawlerErrorCount({
    configured: gscQuery.data?.configured,
    record: gscQuery.data?.record,
    resolved: gscQuery.data?.resolved,
    loadError: gscQuery.isError,
  });

  const inspectMutation = useMutation({
    mutationFn: async () => {
      const token = getDebugToken();
      const res = await fetch("/api/debug/gsc-inspection", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getSessionHeaders(),
          ...(token ? { Authorization: `Token ${token}` } : {}),
        },
        body: JSON.stringify({ urls: [inspectLookupUrl], force: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(typeof body.error === "string" ? body.error : "Inspect failed");
      }
      return body;
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/debug/gsc-inspection"] });
    },
  });

  useEffect(() => {
    if (!open) {
      setOpenPageMenuOpen(false);
      setSolveMenuOpen(false);
    }
  }, [open]);

  useEffect(() => {
    if (!openPageMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (openPageMenuRef.current && !openPageMenuRef.current.contains(e.target as Node)) {
        setOpenPageMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [openPageMenuOpen]);

  useEffect(() => {
    if (!solveMenuOpen) return;
    function onDown(e: MouseEvent) {
      if (solveMenuRef.current && !solveMenuRef.current.contains(e.target as Node)) {
        setSolveMenuOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setSolveMenuOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [solveMenuOpen]);

  useEffect(() => {
    if (!open || !pageDiagnostics) return;
    setActiveTab(errors.length > 0 ? "errors" : "warnings");
  }, [open, pageDiagnostics?.url, pageDiagnostics?.entryKey, errors.length, warnings.length]);

  async function handleRunValidation() {
    if (isRunningValidation) return;
    if (pageDiagnostics?.validationSkippedReason === "unpublished_variant") return;
    setIsRunningValidation(true);
    try {
      const url = pageUrl ?? pageDiagnostics?.url;
      if (url) {
        const token = getDebugToken();
        const variant = pageDiagnostics?.variant;
        await fetch("/api/validation/run-page", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...getSessionHeaders(),
            ...(token ? { Authorization: `Token ${token}` } : {}),
          },
          body: JSON.stringify({
            url,
            validators: PER_PAGE_VALIDATORS,
            ...(variant ? { variant } : {}),
          }),
        });
      }
      if (onRefreshDiagnostics) {
        await onRefreshDiagnostics();
      }
    } catch {}
    setIsRunningValidation(false);
  }

  async function handleSolveMenuSelect(agentId: SolveWithAiAgentId) {
    if (!pageDiagnostics) return;
    const item = SOLVE_WITH_AI_MENU.find((m) => m.id === agentId);
    if (!item) return;
    setSolveMenuOpen(false);
    const prompt = buildSolveWithAiPrompt(pageDiagnostics);
    try {
      await navigator.clipboard.writeText(prompt);
      toast({
        title: "Prompt copied",
        description: "Connect MCP in the next dialog, then confirm to open your AI agent.",
      });
    } catch {
      toast({
        title: "Could not copy prompt",
        description: "Allow clipboard access, or copy again from the confirmation dialog.",
        variant: "destructive",
      });
    }
    onSolveWithAi?.({
      agentId: item.id,
      setupTab: item.setupTab,
      prompt,
      label: item.label,
      prefillUrlPrefix: item.prefillUrlPrefix,
    });
  }

  const unpublishedVariant =
    pageDiagnostics?.validationSkippedReason === "unpublished_variant";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            <IconAlertTriangle className="h-5 w-5 text-destructive" />
            {pageDiagnostics
              ? `${pageDiagnostics.contentType} · ${pageDiagnostics.slug}`
              : "Page Diagnostics"}
            {pageDiagnostics?.variant && (
              <span
                className="text-xs font-normal px-2 py-0.5 rounded-full bg-muted text-muted-foreground"
                data-testid="badge-diagnostics-variant-layer"
              >
                {pageDiagnostics.locale}
                {" · "}
                {pageDiagnostics.variant}
                {typeof pageDiagnostics.allocation === "number"
                  ? ` · ${pageDiagnostics.allocation}%`
                  : ""}
              </span>
            )}
          </DialogTitle>
          <DialogDescription data-testid="text-modal-description" className="flex items-center gap-1.5">
            {pageDiagnostics ? (
              <>
                <span>{pageDiagnostics.url}</span>
                <LocaleFlag locale={pageDiagnostics.locale} />
                {openPageUrl && (
                  <div ref={openPageMenuRef} className="relative">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-muted-foreground"
                      aria-label="Open page"
                      aria-haspopup="menu"
                      aria-expanded={openPageMenuOpen}
                      onClick={() => setOpenPageMenuOpen((prev) => !prev)}
                      data-testid="button-open-page"
                    >
                      <IconExternalLink className="h-3.5 w-3.5" />
                    </Button>
                    {openPageMenuOpen && (
                      <div
                        role="menu"
                        className="absolute left-0 z-50 mt-1 w-44 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
                      >
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] hover-elevate"
                          onClick={() => {
                            setOpenPageMenuOpen(false);
                            window.location.href = openPageUrl;
                          }}
                          data-testid="menu-open-page-same-tab"
                        >
                          <IconArrowRight className="h-3.5 w-3.5" />
                          Same tab
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] hover-elevate"
                          onClick={() => {
                            setOpenPageMenuOpen(false);
                            window.open(openPageUrl, "_blank", "noopener,noreferrer");
                          }}
                          data-testid="menu-open-page-new-tab"
                        >
                          <IconExternalLink className="h-3.5 w-3.5" />
                          New tab
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </>
            ) : loading ? (
              "Loading diagnostics…"
            ) : error ? (
              "Could not load diagnostics"
            ) : (
              "No diagnostics available"
            )}
          </DialogDescription>
        </DialogHeader>
        {!pageDiagnostics && error && (
          <div
            className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            data-testid="text-diagnostics-error"
          >
            {error}
          </div>
        )}
        {pageDiagnostics && (
          <div className="space-y-4">
            <Tabs
              value={activeTab}
              onValueChange={(v) => setActiveTab(v as "errors" | "warnings" | "crawlers")}
              className="w-full"
            >
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <TabsList className="h-9" data-testid="tabs-page-errors">
                  <TabsTrigger value="errors" data-testid="tab-errors" className="gap-1.5">
                    Errors
                    <span
                      className="rounded-sm bg-destructive/15 text-destructive px-1.5 py-0 text-[10px] font-semibold tabular-nums"
                      data-testid="text-modal-error-count"
                    >
                      {errors.length}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="warnings" data-testid="tab-warnings" className="gap-1.5">
                    Warnings
                    <span
                      className="rounded-sm bg-amber-500/15 text-amber-700 dark:text-amber-300 px-1.5 py-0 text-[10px] font-semibold tabular-nums"
                      data-testid="text-modal-warning-count"
                    >
                      {warnings.length}
                    </span>
                  </TabsTrigger>
                  <TabsTrigger value="crawlers" data-testid="tab-crawlers" className="gap-1.5">
                    Crawlers
                    <span
                      className="rounded-sm bg-destructive/15 text-destructive px-1.5 py-0 text-[10px] font-semibold tabular-nums"
                      data-testid="text-modal-crawler-error-count"
                    >
                      {crawlerErrors}
                    </span>
                  </TabsTrigger>
                </TabsList>
                <div className="flex items-center gap-2">
                  {activeTab === "crawlers" ? (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => inspectMutation.mutate()}
                      disabled={
                        inspectMutation.isPending ||
                        !canInspect ||
                        !gscQuery.data?.configured ||
                        !!gscQuery.data?.resolved?.isDraft
                      }
                      title={
                        !gscQuery.data?.configured
                          ? "Search Console is not configured"
                          : gscQuery.data?.resolved?.isDraft
                            ? "Draft pages are not sent to Google"
                            : "Check Google"
                      }
                      data-testid="button-check-google"
                    >
                      {inspectMutation.isPending ? (
                        <>
                          <IconLoader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                          <span className="hidden sm:inline">Checking…</span>
                        </>
                      ) : (
                        <>
                          <IconBrandGoogle className="h-3.5 w-3.5 shrink-0" />
                          <span className="hidden sm:inline">Check Google</span>
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleRunValidation}
                      disabled={isRunningValidation || unpublishedVariant}
                      title={
                        unpublishedVariant
                          ? "Unpublished variants are not validated"
                          : isRunningValidation
                            ? "Running…"
                            : "Run validation"
                      }
                      aria-label={isRunningValidation ? "Running…" : "Run validation"}
                      data-testid="button-run-validation"
                    >
                      {isRunningValidation ? (
                        <>
                          <IconLoader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                          <span className="hidden sm:inline">Running…</span>
                        </>
                      ) : (
                        <>
                          <IconRefresh className="h-3.5 w-3.5 shrink-0" />
                          <span className="hidden sm:inline">Run validation</span>
                        </>
                      )}
                    </Button>
                  )}
                </div>
              </div>

              {unpublishedVariant ? (
                <p
                  className="text-sm text-muted-foreground mt-3 p-3 rounded-md bg-muted/50 border border-border"
                  data-testid="text-unpublished-variant-education"
                >
                  {pageDiagnostics.education?.summary ||
                    "This variant isn’t published (0% traffic). Diagnostics run after you assign traffic. Redirects stay on the live locale file only."}
                </p>
              ) : (
                activeTab !== "crawlers" && (pageDiagnostics.cached ? (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5 mt-2" data-testid="text-cached-staleness">
                  <IconClock className="h-3.5 w-3.5" />
                  Validated {formatStaleness(pageDiagnostics.cached.lastRunAt)}
                </p>
              ) : (
                <p className="text-xs text-muted-foreground mt-2" data-testid="cached-not-yet-validated">
                  Not yet validated — click &quot;Run validation&quot; to refresh this list.
                </p>
              ))
              )}

              {!unpublishedVariant && (
              <TabsContent value="errors" className="mt-3 space-y-2">
                {errors.length === 0 ? (
                  <div
                    className="p-3 rounded-md bg-muted/50 border border-border text-sm text-muted-foreground"
                    data-testid="modal-errors-empty"
                  >
                    {completedErrors.length > 0
                      ? "No open errors for this entry."
                      : "No errors for this entry."}
                  </div>
                ) : (
                  errors.map((issue, i) => (
                    <IssueCard
                      key={issue.id ?? `${issue.code}-${i}`}
                      issue={issue}
                      index={i}
                      variant="error"
                      formatSitePath={formatSitePath}
                      onUpdateIssue={handleUpdateIssue}
                      togglePending={togglingIssueId === issue.id}
                    />
                  ))
                )}
                {completedErrors.length > 0 && (
                  <Collapsible
                    open={completedErrorsOpen}
                    onOpenChange={setCompletedErrorsOpen}
                  >
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="flex w-full items-center gap-1.5 pt-2 text-xs text-muted-foreground hover:text-foreground"
                        data-testid="toggle-completed-errors"
                      >
                        <IconChevronDown
                          className={cn(
                            "h-3.5 w-3.5 transition-transform",
                            completedErrorsOpen && "rotate-180",
                          )}
                        />
                        Completed ({completedErrors.length})
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-2 pt-2">
                      {completedErrors.map((issue, i) => (
                        <IssueCard
                          key={issue.id ?? `completed-error-${issue.code}-${i}`}
                          issue={issue}
                          index={errors.length + i}
                          variant="error"
                          formatSitePath={formatSitePath}
                          onUpdateIssue={handleUpdateIssue}
                          togglePending={togglingIssueId === issue.id}
                        />
                      ))}
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </TabsContent>
              )}

              {!unpublishedVariant && (
              <TabsContent value="warnings" className="mt-3 space-y-2">
                {warnings.length === 0 ? (
                  <div
                    className="p-3 rounded-md bg-muted/50 border border-border text-sm text-muted-foreground"
                    data-testid="modal-warnings-empty"
                  >
                    {completedWarnings.length > 0
                      ? "No open warnings for this entry."
                      : "No warnings for this entry."}
                  </div>
                ) : (
                  warnings.map((issue, i) => (
                    <IssueCard
                      key={issue.id ?? `${issue.code}-${i}`}
                      issue={issue}
                      index={i}
                      variant="warning"
                      formatSitePath={formatSitePath}
                      onUpdateIssue={handleUpdateIssue}
                      togglePending={togglingIssueId === issue.id}
                    />
                  ))
                )}
                {completedWarnings.length > 0 && (
                  <Collapsible
                    open={completedWarningsOpen}
                    onOpenChange={setCompletedWarningsOpen}
                  >
                    <CollapsibleTrigger asChild>
                      <button
                        type="button"
                        className="flex w-full items-center gap-1.5 pt-2 text-xs text-muted-foreground hover:text-foreground"
                        data-testid="toggle-completed-warnings"
                      >
                        <IconChevronDown
                          className={cn(
                            "h-3.5 w-3.5 transition-transform",
                            completedWarningsOpen && "rotate-180",
                          )}
                        />
                        Completed ({completedWarnings.length})
                      </button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-2 pt-2">
                      {completedWarnings.map((issue, i) => (
                        <IssueCard
                          key={issue.id ?? `completed-warning-${issue.code}-${i}`}
                          issue={issue}
                          index={warnings.length + i}
                          variant="warning"
                          formatSitePath={formatSitePath}
                          onUpdateIssue={handleUpdateIssue}
                          togglePending={togglingIssueId === issue.id}
                        />
                      ))}
                    </CollapsibleContent>
                  </Collapsible>
                )}
              </TabsContent>
              )}

              <TabsContent value="crawlers" className="mt-3 space-y-3">
                <p className="text-xs text-muted-foreground" data-testid="text-crawlers-education">
                  Cached Search Console inspection for this URL — not live Google, not a re-index,
                  and not local validation. Check Google spends daily quota.
                </p>
                <Card data-testid="card-google-indexing-kpi">
                  <CardContent className="pt-4 pb-3 space-y-1">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <IconBrandGoogle className="h-3.5 w-3.5" />
                      <span>Google</span>
                    </div>
                    {gscQuery.isLoading ? (
                      <p className="text-sm text-muted-foreground">Loading cache…</p>
                    ) : !gscQuery.data?.configured ? (
                      <div className="space-y-1">
                        <p className="text-sm font-medium text-foreground">Not configured</p>
                        <Link
                          href="/private/settings/seo/search-console"
                          className="text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground"
                          data-testid="link-gsc-settings-from-modal"
                          onClick={() => onOpenChange(false)}
                        >
                          Set up Search Console
                        </Link>
                      </div>
                    ) : (
                      <>
                        <p className="text-sm font-medium text-foreground" data-testid="text-google-index-status">
                          {gscHeadline(gscQuery.data.record, gscQuery.data.resolved)}
                        </p>
                        {gscQuery.data.resolved?.loc && (
                          <p className="text-[11px] font-mono text-muted-foreground truncate" title={gscQuery.data.resolved.loc}>
                            {gscQuery.data.resolved.loc}
                          </p>
                        )}
                        {gscQuery.data.resolved && !gscQuery.data.resolved.inSitemap && !gscQuery.data.resolved.isDraft && (
                          <p className="text-xs text-chart-2">This URL is excluded from /sitemap.xml.</p>
                        )}
                        {gscQuery.data.record?.lastCrawlTime && (
                          <p className="text-xs text-muted-foreground">
                            Last crawl {formatStaleness(gscQuery.data.record.lastCrawlTime)}
                          </p>
                        )}
                        {gscQuery.data.record?.inspectedAt && (
                          <p className="text-xs text-muted-foreground flex items-center gap-1">
                            <IconClock className="h-3 w-3" />
                            Checked {formatStaleness(gscQuery.data.record.inspectedAt)}
                          </p>
                        )}
                        {gscQuery.data.record?.error && (
                          <p className="text-xs text-destructive">{gscQuery.data.record.error}</p>
                        )}
                        {inspectMutation.isError && (
                          <p className="text-xs text-destructive">
                            {inspectMutation.error instanceof Error
                              ? inspectMutation.error.message
                              : "Inspect failed"}
                          </p>
                        )}
                      </>
                    )}
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

            <div className="p-3 rounded-md bg-muted/50 border border-border text-sm">
              <p className="text-muted-foreground text-xs">
                {activeTab === "crawlers"
                  ? "Crawlers read a disk cache of Search Console URL Inspection results. Restarts do not call Google. Configure the service account under SEO/GEO → Search Console."
                  : pageDiagnostics.education?.summary ||
                    "Check mark = mark fixed for tracking; hides from open counts. Saving or Run validation can bring an issue back if still detected."}
              </p>
            </div>
          </div>
        )}
        <DialogFooter className="sm:justify-end gap-2 flex-wrap">
          {!pageDiagnostics && error && onRefreshDiagnostics && (
            <Button
              variant="default"
              onClick={() => void onRefreshDiagnostics()}
              disabled={loading}
              data-testid="button-retry-diagnostics"
            >
              {loading ? (
                <>
                  <IconLoader2 className="h-4 w-4 animate-spin" />
                  Retrying…
                </>
              ) : (
                "Retry"
              )}
            </Button>
          )}
          <div ref={solveMenuRef} className="relative">
            <Button
              type="button"
              variant="default"
              disabled={!canSolveWithAi}
              aria-haspopup="menu"
              aria-expanded={solveMenuOpen}
              onClick={() => setSolveMenuOpen((prev) => !prev)}
              data-testid="button-solve-with-ai-agent"
            >
              <IconSparkles className="h-4 w-4" />
              Solve with AI Agent
              <IconChevronDown className="h-4 w-4 opacity-70" />
            </Button>
            {solveMenuOpen && (
              <div
                role="menu"
                className="absolute bottom-full right-0 z-50 mb-1 w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
              >
                {SOLVE_WITH_AI_MENU.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    role="menuitem"
                    className="flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-[13px] hover-elevate"
                    onClick={() => void handleSolveMenuSelect(item.id)}
                    data-testid={`menu-solve-ai-${item.id}`}
                  >
                    <SolveWithAiAgentIcon agentId={item.id} />
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <Button variant="outline" onClick={() => onOpenChange(false)} data-testid="button-close-page-errors">
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
