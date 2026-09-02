import { useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeft, ArrowRight, BarChart2, Blocks, Book, Bot, Brain, Check, ChevronDown, ChevronRight, Cookie, Database, Github, Globe, Home, Image, Languages, Map, Menu, MessageCircle, Moon, Palette, Pencil, Plus, RefreshCw, Route, Search, Settings, Stethoscope, Sun, Unlink, Link2, X } from "lucide-react";
import { IconServer, IconShoppingBag, IconTargetArrow, IconShield, IconAlertTriangle, IconLayersIntersect, IconInfoCircle, IconSwitchHorizontal } from "@tabler/icons-react";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import { useTranslation } from "react-i18next";
import { Badge, badgeVariants } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { normalizeLocale } from "@/lib/locale";
import { saveEditModeScrollPosition } from "@/lib/editModeScroll";
import { PreviewDeviceMenu } from "@/components/editing/PreviewDeviceMenu";
import type { PreviewDeviceId } from "@/lib/preview-devices";
import type { PreviewBreakpoint } from "@/contexts/EditModeContext";
import { isVisualEditPath } from "@/lib/visual-edit-path";
import { useEnterVisualEditMode } from "@/hooks/useEnterVisualEditMode";
import { GitHubSyncChip } from "./GitHubSyncChip";
import type { PageErrorsTab } from "./PageErrorsModal";
import {
  AnimatedEllipsis,
  PipelineCounts,
  getPipelineVisualState,
  pipelineActivityTotals,
  type PipelineCountsData,
} from "./PipelineCounts";
import { LocationOverrideBadge } from "./LocationOverrideBadge";
import { GcsBucketSyncChip } from "./GcsBucketSyncChip";
import { SystemAlertsPanel } from "@/components/StaffSystemAlertBanner";
import {
  startGitHubConnect,
  useGitHubUserConnection,
} from "@/hooks/useGitHubUserConnection";
import { ComponentsView } from "./ComponentsView";
import { VersioningView } from "./VersioningView";
import { MenusView } from "./MenusView";
import { CreateMenuModal } from "./CreateMenuModal";
import { DatabasesView } from "./DatabasesView";
import { ContentTypesView } from "./ContentTypesView";
import { SitemapView } from "./SitemapView";
import type { RobotsSettingsResponse } from "@/components/settings/RobotsTab";
import { apiFetch } from "@/lib/queryClient";
import type {
  MenuView,
  ContentInfo,
  GitHubSyncStatus,
  PendingChange,
  SitemapUrl,
  ComponentItem,
  MenuItemProps,
  ExpandableMenuItemProps,
} from "../types";

interface EditModeState {
  isEditMode: boolean;
  toggleEditMode: () => void;
  previewBreakpoint: PreviewBreakpoint;
  previewDeviceId: PreviewDeviceId;
  setPreviewBreakpoint: (bp: PreviewBreakpoint) => void;
  setPreviewDevice: (id: PreviewDeviceId) => void;
}

interface BreathecodeHost {
  host: string;
  isDefault: boolean;
}

export interface DebugPanelContentProps {
  noTokenDetected: boolean;
  tokenWithoutCapabilities: boolean;
  hasToken: boolean;
  tokenInput: string;
  setTokenInput: (v: string) => void;
  setPendingAutoEditMode: (v: boolean) => void;
  validateManualToken: (token: string) => void;
  isLoading: boolean;
  breathecodeHost: BreathecodeHost | null;
  retryValidation: () => void;
  clearToken: () => void;

  githubSyncStatus: GitHubSyncStatus | null;
  pendingChanges: PendingChange[];
  pendingChangesLoading: boolean;
  syncStatusLoading: boolean;
  refreshSyncStatus: () => void;
  fetchPendingChanges: () => void;
  setCommitModalOpen: (v: boolean) => void;

  contentInfo: ContentInfo;
  editMode: EditModeState | null;
  pathname: string;
  navigate: (path: string) => void;
  setSeoModalOpen: (v: boolean) => void;
  fetchSeoPreview: () => void;

  menuView: MenuView;
  setMenuView: (v: MenuView) => void;

  sitemapExpanded: boolean;
  setSitemapExpanded: (v: boolean) => void;
  componentsExpanded: boolean;
  setComponentsExpanded: (v: boolean) => void;
  aiAgentsExpanded: boolean;
  setAiAgentsExpanded: (v: boolean) => void;
  cacheClearStatus: string;
  clearSitemapCache: () => void;
  sitemapUrlCount: number | null;
  redirectsList: Array<{ from: string; to: string }>;

  componentSearch: string;
  setComponentSearch: (v: string) => void;
  showComponentSearch: boolean;
  setShowComponentSearch: (v: boolean) => void;
  filteredComponents: ComponentItem[];
  componentRegistryData: unknown;
  componentIconMap: Record<string, unknown>;
  siteInfo?: { domain: string; contentFolder: string; isMultiSite: boolean; isDevOverride: boolean; githubRepoUrl?: string } | null;
  onOpenSiteManager: () => void;

  versioningLoading: boolean;
  versioningData: unknown;
  onVersioningDataUpdate?: (data: unknown) => void;
  pageIsSharedLayout?: boolean;
  pageIsDetached?: boolean;
  detachBusy?: boolean;
  onDetachEntry?: () => void | Promise<void>;
  onReattachEntry?: () => void | Promise<void>;
  onEditVariantYaml: (locale: string, variantSlug: string) => void;
  onEditDefaultYaml?: (locale: string) => void;
  onRequestDeletePage?: (opts: { locale: string; liveLocales: string[] }) => void;
  onOpenTemplateYaml?: () => void;
  handleLinkClick: (href: string) => void;

  pageErrorCount?: number;
  pageWarningCount?: number;
  pageDiagnosticsLoading?: boolean;
  pageDiagnosticsUrl?: string | null;
  onOpenPageErrors?: (tab: PageErrorsTab) => void;

  sitemapUrls: SitemapUrl[];
  sitemapLoading: boolean;
  sitemapSearch: string;
  setSitemapSearch: (v: string) => void;
  showSitemapSearch: boolean;
  setShowSitemapSearch: (v: boolean) => void;
  sitemapPresenceFilter: "all" | "in-sitemap" | "not-in-sitemap";
  setSitemapPresenceFilter: (v: "all" | "in-sitemap" | "not-in-sitemap") => void;
  filteredSitemapUrls: SitemapUrl[];
  folders: Record<string, SitemapUrl[]>;
  rootUrls: SitemapUrl[];
  expandedFolders: Set<string>;
  toggleFolder: (folder: string) => void;
  setCreateContentModalOpen: (v: boolean) => void;
  handleDuplicatePage: (url: SitemapUrl) => void;
  handleDeletePage: (url: SitemapUrl) => void;
  handleDownloadYml: (url: SitemapUrl) => void;
  handleEditPageMeta: (url: SitemapUrl) => void;
  onEditContentTypesYml: () => void;
  handleRefreshCache: (url: SitemapUrl) => void;
  validationSummary: Record<string, { errorCount: number; warningCount: number }>;
  onOpenDiagnosticsForUrl: (urlPath: string) => void;
  contentLocale: string | null;

  currentLang: string;
  toggleLanguage: () => void;
  theme: "light" | "dark";
  toggleTheme: () => void;

  isCheckingSession: boolean;
  handleCheckSession: () => void;
  setSessionModalOpen: (v: boolean) => void;
  publicPageUrl: string | null;
}

function MenuItem({ icon: Icon, label, onClick, href, testId, rightContent, indicator = "none", disabled, className, infoTooltip }: MenuItemProps) {
  const [infoOpen, setInfoOpen] = useState(false);
  const hasRightSide = rightContent || indicator !== "none";
  const baseClass = disabled
    ? "flex items-center justify-between w-full px-3 py-2 rounded-md text-sm text-muted-foreground cursor-default"
    : "flex items-center justify-between w-full px-3 py-2 rounded-md text-sm hover-elevate";
  const combinedClass = className ? `${baseClass} ${className}` : baseClass;

  const content = (
    <>
      <div className="flex items-center gap-3">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <span>{label}</span>
        {infoTooltip && (
          <>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setInfoOpen(true);
              }}
              className="flex items-center text-muted-foreground hover:text-foreground transition-colors"
              data-testid={`${testId}-info`}
            >
              <IconInfoCircle className="h-3.5 w-3.5" />
            </button>
            <Dialog open={infoOpen} onOpenChange={setInfoOpen}>
              <DialogContent className="max-w-sm" onClick={(e) => e.stopPropagation()}>
                <DialogHeader>
                  <DialogTitle className="text-sm">{label}</DialogTitle>
                  <DialogDescription>{infoTooltip}</DialogDescription>
                </DialogHeader>
              </DialogContent>
            </Dialog>
          </>
        )}
      </div>
      {hasRightSide && (
        <div className="flex items-center gap-1.5">
          {rightContent}
          {indicator === "chevron" && <ChevronRight className="h-4 w-4 text-muted-foreground" />}
          {indicator === "arrow" && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      )}
    </>
  );

  if (disabled) {
    return <div className={combinedClass} data-testid={testId}>{content}</div>;
  }
  if (href) {
    return <a href={href} className={combinedClass} data-testid={testId}>{content}</a>;
  }
  if (onClick) {
    return <button onClick={onClick} className={combinedClass} data-testid={testId}>{content}</button>;
  }
  return <div className={combinedClass} data-testid={testId}>{content}</div>;
}

function ExpandableMenuItem({ icon: Icon, label, expanded, onToggle, testId, actions, children }: ExpandableMenuItemProps) {
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between w-full px-3 py-2 rounded-md text-sm">
        <button
          onClick={onToggle}
          className="flex items-center gap-3 flex-1 hover-elevate rounded-md -ml-1 pl-1 py-0.5"
          data-testid={testId}
        >
          <Icon className="h-4 w-4 text-muted-foreground" />
          <span>{label}</span>
          <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground transition-transform ${expanded ? "rotate-90" : ""}`} />
        </button>
        {actions}
      </div>
      {expanded && (
        <div className="ml-2 pl-1 space-y-0.5 rounded-md py-1" style={{ backgroundColor: "hsl(var(--muted-foreground) / 0.1)" }}>
          {children}
        </div>
      )}
    </div>
  );
}

function GitHubConnectCriticalBanner() {
  const { showCritical, connection } = useGitHubUserConnection();
  const [showAdvanced, setShowAdvanced] = useState(false);

  if (!showCritical) return null;

  return (
    <div
      className="p-3 bg-destructive/10 border-b border-destructive/20"
      data-testid="banner-github-connect-required"
    >
      <div className="flex items-start gap-2">
        <AlertTriangle className="h-4 w-4 text-destructive flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0 space-y-1.5">
          <p className="text-xs font-medium text-foreground">
            Connect GitHub to commit
          </p>
          <p className="text-xs text-muted-foreground">
            {connection?.education?.summary ||
              "In production, content commits use your connected GitHub identity on the content repo. The service GITHUB_TOKEN is only for pulls and system operations."}
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              className="h-7 text-xs"
              onClick={() => void startGitHubConnect()}
              data-testid="button-github-connect-banner"
            >
              Connect GitHub
            </Button>
            {connection?.education?.advanced?.length ? (
              <button
                type="button"
                className="text-[10px] text-muted-foreground underline-offset-2 hover:underline"
                onClick={() => setShowAdvanced((v) => !v)}
              >
                {showAdvanced ? "Hide advanced" : "Read more (advanced)"}
              </button>
            ) : null}
          </div>
          {showAdvanced && connection?.education?.advanced?.length ? (
            <ul className="text-[10px] font-mono text-muted-foreground list-disc pl-4 space-y-0.5">
              {connection.education.advanced.map((path) => (
                <li key={path}>{path}</li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

export function DebugPanelContent(props: DebugPanelContentProps) {
  const { i18n } = useTranslation();
  const enterVisualEdit = useEnterVisualEditMode();
  const [reattachConfirmOpen, setReattachConfirmOpen] = useState(false);
  const [reattachPreviewLoading, setReattachPreviewLoading] = useState(false);
  const [sectionsThatWillBeLost, setSectionsThatWillBeLost] = useState<
    Array<{ sectionId: string | null; type: string; label: string }>
  >([]);
  const [variantsThatWillBeLost, setVariantsThatWillBeLost] = useState<
    Array<{ slug: string; locale: string; allocation: number }>
  >([]);
  const [hasLayoutOverride, setHasLayoutOverride] = useState(false);
  const [detachConfirmOpen, setDetachConfirmOpen] = useState(false);
  const [showDetachAdvanced, setShowDetachAdvanced] = useState(false);

  useEffect(() => {
    if (!detachConfirmOpen) setShowDetachAdvanced(false);
  }, [detachConfirmOpen]);
  const { hasCapability } = useDebugAuth();
  const canManageUsers = hasCapability("users_manage");
  const canViewMetrics = hasCapability("metrics_view");
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const [settingsExpanded, setSettingsExpanded] = useState(false);
  const [storeExpanded, setStoreExpanded] = useState(false);
  const [diagnosticsExpanded, setDiagnosticsExpanded] = useState(false);

  const pipelineSite = props.siteInfo?.contentFolder;
  const { data: pipelineStatus, isLoading: pipelineLoading } = useQuery<PipelineCountsData>({
    queryKey: ["/api/admin/pipeline/status", pipelineSite],
    queryFn: async () => {
      const res = await apiFetch(
        `/api/admin/pipeline/status?site=${encodeURIComponent(pipelineSite!)}`,
      );
      if (!res.ok) throw new Error("Failed to fetch pipeline status");
      return res.json();
    },
    enabled: !!pipelineSite,
    refetchInterval: () => (document.hidden ? false : 5000),
  });
  const pipelineVisualState = getPipelineVisualState(pipelineStatus, pipelineLoading);
  const { queued: pipelineQueued, running: pipelineRunning } = pipelineActivityTotals(pipelineStatus);
  const pipelineIsWorking = pipelineQueued > 0 || pipelineRunning > 0;

  const openReattachConfirm = useCallback(() => {
    setReattachConfirmOpen(true);
    setSectionsThatWillBeLost([]);
    setVariantsThatWillBeLost([]);
    setHasLayoutOverride(false);
    const type = props.contentInfo.type;
    const slug = props.contentInfo.slug;
    if (!type || !slug) return;
    const locale = normalizeLocale(
      new URLSearchParams(typeof window !== "undefined" ? window.location.search : "").get("locale") ||
        props.contentLocale ||
        i18n.language ||
        "en",
    );
    setReattachPreviewLoading(true);
    fetch(
      `/api/content/${encodeURIComponent(type)}/${encodeURIComponent(slug)}/attach-status?locale=${encodeURIComponent(locale)}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data) return;
        setSectionsThatWillBeLost(
          Array.isArray(data.sectionsThatWillBeLost) ? data.sectionsThatWillBeLost : [],
        );
        setVariantsThatWillBeLost(
          Array.isArray(data.variantsThatWillBeLost) ? data.variantsThatWillBeLost : [],
        );
        setHasLayoutOverride(!!data.hasLayoutOverride);
      })
      .catch(() => {})
      .finally(() => setReattachPreviewLoading(false));
  }, [props.contentInfo.type, props.contentInfo.slug, props.contentLocale, i18n.language]);

  const openDetachConfirm = useCallback(() => {
    setDetachConfirmOpen(true);
  }, []);

  const { data: versionData } = useQuery<{ version: string; deployedAt?: string | null }>({
    queryKey: ["/api/version"],
    staleTime: Infinity,
  });

  const versionDeployedLabel = (() => {
    if (!versionData?.deployedAt) return null;
    const deployedDate = new Date(versionData.deployedAt);
    if (Number.isNaN(deployedDate.getTime())) return null;
    const diffSec = Math.max(0, Math.floor((Date.now() - deployedDate.getTime()) / 1000));
    if (diffSec < 60) return "just now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 30) return `${diffDay}d ago`;
    const diffMo = Math.floor(diffDay / 30);
    if (diffMo < 12) return `${diffMo}mo ago`;
    return `${Math.floor(diffDay / 365)}y ago`;
  })();

  const { data: errorLogData } = useQuery<{ totalErrors: number; totalWarnings: number }>({
    queryKey: ["/api/admin/error-log", "badge"],
    queryFn: async () => {
      const res = await apiFetch("/api/admin/error-log");
      if (!res.ok) throw new Error("Failed to fetch error log");
      return res.json();
    },
    refetchInterval: 60000,
    staleTime: 30000,
    enabled: canViewMetrics,
  });

  const { data: robotsSettings } = useQuery<RobotsSettingsResponse>({
    queryKey: ["/api/settings/robots"],
  });
  const siteDisallowed = !!robotsSettings?.block_indexing;

  const errorLogCount = errorLogData?.totalErrors ?? 0;
  const showEditChrome = !!props.editMode && isVisualEditPath(props.pathname);

  const enterPrivatePreview = useCallback(() => {
    enterVisualEdit({
      contentType: props.contentInfo.type ?? undefined,
      slug: props.contentInfo.slug ?? undefined,
    });
  }, [enterVisualEdit, props.contentInfo.type, props.contentInfo.slug]);

  if (props.noTokenDetected) {
    return (
      <div className="p-4 pl-[8px] pr-[8px]">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-full bg-amber-100 dark:bg-amber-900 flex-shrink-0">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-sm mb-1">No token detected</h3>
            <p className="text-xs text-muted-foreground mb-1">
              Enter your token below or add <code className="bg-muted px-1 rounded">?token=xxx</code> to URL, or{" "}
              <a
                href={`https://breathecode.herokuapp.com/v1/auth/view/login?url=${encodeURIComponent(window.location.href)}`}
                className="text-primary underline hover:no-underline"
                data-testid="link-login"
              >
                click here to login
              </a>
            </p>
            <p className="text-xs text-muted-foreground mb-3">
              Only users with <code className="bg-muted px-1 rounded">webmaster</code> capability will be able to edit the website.
            </p>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Enter token..."
                value={props.tokenInput}
                onChange={(e) => props.setTokenInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && props.tokenInput.trim()) {
                    props.setPendingAutoEditMode(true);
                    props.validateManualToken(props.tokenInput.trim());
                  }
                }}
                className="flex-1 px-3 py-1.5 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                data-testid="input-token"
              />
              <Button
                size="sm"
                onClick={() => {
                  props.setPendingAutoEditMode(true);
                  props.validateManualToken(props.tokenInput.trim());
                }}
                disabled={!props.tokenInput.trim() || props.isLoading}
                data-testid="button-validate-token"
              >
                {props.isLoading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  "Validate"
                )}
              </Button>
            </div>
            {props.breathecodeHost && !props.breathecodeHost.isDefault && (
              <div className="flex items-start gap-1.5 mt-2 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 flex-shrink-0 mt-0.5" />
                <div className="text-xs">
                  <div>The host is pointing to</div>
                  <div className="font-mono break-all">{props.breathecodeHost.host}</div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  if (props.tokenWithoutCapabilities) {
    return (
      <div className="p-4">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-full bg-amber-100 dark:bg-amber-900">
            <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-sm mb-1">Limited access</h3>
            <p className="text-xs text-muted-foreground mb-3">
              Token detected but no staff capabilities have been detected
            </p>
            <div className="flex gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={props.retryValidation}
                disabled={props.isLoading}
                className="flex-1"
                data-testid="button-retry-validation"
              >
                {props.isLoading ? (
                  <RefreshCw className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <RefreshCw className="h-4 w-4 mr-1" />
                    Retry
                  </>
                )}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={props.clearToken}
                disabled={props.isLoading}
                data-testid="button-clear-token"
              >
                <X className="h-4 w-4 mr-1" />
                Clear
              </Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      {props.githubSyncStatus?.syncEnabled && props.githubSyncStatus.status === 'invalid-credentials' && (
        <div className="p-3 bg-red-100 dark:bg-red-900/50 border-b border-red-200 dark:border-red-800">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-medium text-red-800 dark:text-red-200">
                Invalid GitHub Credentials for Sync
              </p>
              <p className="text-xs text-red-700 dark:text-red-300 mt-0.5">
                Check GITHUB_TOKEN and GITHUB_REPO_URL settings
              </p>
            </div>
          </div>
        </div>
      )}

      {props.githubSyncStatus && !props.githubSyncStatus.syncEnabled && props.githubSyncStatus.configured && (
        <div className="p-3 bg-muted/50 border-b border-border">
          <div className="flex items-start gap-2">
            <Github className="h-4 w-4 text-muted-foreground flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-medium text-foreground">
                GitHub Sync is Disabled
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">
                Set GITHUB_SYNC_ENABLED=true to enable
              </p>
            </div>
          </div>
        </div>
      )}

      {props.githubSyncStatus && (props.githubSyncStatus.status === 'behind' || props.githubSyncStatus.status === 'diverged') && (
        <div className="p-3 bg-amber-100 dark:bg-amber-900/50 border-b border-amber-200 dark:border-amber-800">
          <div className="flex items-start gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                {props.githubSyncStatus.status === 'behind'
                  ? 'Pull latest changes before publishing'
                  : 'Local and remote have diverged'}
              </p>
              <p className="text-xs text-amber-700 dark:text-amber-300 mt-0.5">
                Production content edits may be overwritten
              </p>
            </div>
          </div>
        </div>
      )}

      <GitHubConnectCriticalBanner />

      <SystemAlertsPanel compact />

      <div className="p-3 border-b pl-[8px] pr-[8px] pt-[3px] pb-[3px]">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <button
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                props.navigate("/");
              }}
              className="p-1 rounded-md hover-elevate"
              data-testid="button-home"
              title="Go to public home"
            >
              <Home className="h-3.5 w-3.5 text-muted-foreground" />
            </button>
            <h3 className="font-semibold text-sm">Dev Tools</h3>
          </div>
          <div className="flex items-center gap-2">
            {props.contentInfo.type && props.contentInfo.slug && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                  props.setSeoModalOpen(true);
                  props.fetchSeoPreview();
                }}
                className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-muted text-muted-foreground transition-colors hover-elevate"
                data-testid="button-edit-seo"
                title="Edit page SEO & meta tags"
              >
                <Pencil className="h-3 w-3" />
                Page Meta
              </button>
            )}
            {showEditChrome && (
              <div
                className="flex items-center bg-input rounded-full p-0.5"
                data-testid="toggle-edit-mode"
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (!props.editMode!.isEditMode) {
                      enterVisualEdit({
                        contentType: props.contentInfo.type ?? undefined,
                        slug: props.contentInfo.slug ?? undefined,
                      });
                    }
                  }}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    props.editMode.isEditMode
                      ? "bg-primary text-primary-foreground"
                      : "text-foreground"
                  }`}
                  data-testid="button-edit-mode"
                >
                  Edit
                </button>
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    e.preventDefault();
                    if (!props.editMode!.isEditMode) return;
                    props.editMode!.toggleEditMode();
                    let targetUrl = props.publicPageUrl;
                    if (!targetUrl && props.pathname.startsWith("/private/preview/")) {
                      try {
                        const searchParams = new URLSearchParams(window.location.search);
                        const locale = normalizeLocale(searchParams.get("locale") || "en");
                        const res = await fetch(`/api/locale-urls?url=${encodeURIComponent(props.pathname)}`);
                        if (res.ok) {
                          const data = await res.json() as { urls?: Record<string, string> };
                          targetUrl =
                            data.urls?.[locale] ||
                            data.urls?.en ||
                            Object.values(data.urls || {})[0] ||
                            null;
                        }
                      } catch {
                        // stay on preview if resolution fails
                      }
                    }
                    if (targetUrl) {
                      const _rp = new URLSearchParams(window.location.search);
                      const _rv = _rp.get("variant") || _rp.get("force_variant");
                      if (_rv) targetUrl = targetUrl + (targetUrl.includes("?") ? "&" : "?") + `force_variant=${encodeURIComponent(_rv)}`;
                      saveEditModeScrollPosition();
                      props.navigate(targetUrl);
                    }
                  }}
                  className={`px-2.5 py-1 rounded-full text-xs font-medium transition-colors ${
                    !props.editMode.isEditMode
                      ? "bg-foreground text-background shadow-sm"
                      : "text-foreground"
                  }`}
                  data-testid="button-read-mode"
                >
                  Read
                </button>
              </div>
            )}
            {showEditChrome && (
              <PreviewDeviceMenu onNeedEditMode={enterPrivatePreview} />
            )}
          </div>
        </div>
      </div>

      {props.menuView === "main" ? (
        <>
          <div className="p-2 space-y-1">
            <ExpandableMenuItem
              icon={Map}
              label="Content & Sitemap"
              expanded={props.sitemapExpanded}
              onToggle={() => {
                const opening = !props.sitemapExpanded;
                props.setSitemapExpanded(opening);
                if (opening) {
                  props.setComponentsExpanded(false);
                  props.setAiAgentsExpanded(false);
                  setSettingsExpanded(false);
                  setStoreExpanded(false);
                  setDiagnosticsExpanded(false);
                }
              }}
              testId="button-sitemap-toggle"
              actions={
                <button
                  onClick={props.clearSitemapCache}
                  disabled={props.cacheClearStatus === "loading"}
                  className="p-1 rounded hover-elevate disabled:opacity-50"
                  data-testid="button-clear-sitemap-cache"
                  title="Clear sitemap cache"
                >
                  {props.cacheClearStatus === "loading" ? (
                    <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                  ) : props.cacheClearStatus === "success" ? (
                    <Check className="h-3.5 w-3.5 text-chart-3" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                </button>
              }
            >

              <MenuItem
                icon={Map}
                label="Content URLs"
                onClick={() => props.setMenuView("sitemap")}
                indicator="chevron"
                testId="button-sitemap-all-urls"
                rightContent={
                  <div className="flex items-center gap-1.5">
                    {siteDisallowed && (
                      <Popover>
                        <PopoverTrigger asChild>
                          <button
                            type="button"
                            className="inline-flex"
                            data-testid="badge-indexed-urls-disallowed"
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                            }}
                          >
                            <Badge variant="destructive" className="cursor-pointer">
                              disallowed
                            </Badge>
                          </button>
                        </PopoverTrigger>
                        <PopoverContent
                          className="w-72 space-y-2"
                          onClick={(e) => e.stopPropagation()}
                          align="end"
                        >
                          <p className="text-sm font-medium text-destructive">Site indexing blocked</p>
                          <p className="text-xs text-muted-foreground">
                            The whole website is globally disallowed for search indexing. Per-page
                            robots settings are ignored until this is turned off.
                          </p>
                          <a
                            href="/private/settings?tab=robots"
                            className="text-xs text-primary underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            Open Robots settings
                          </a>
                        </PopoverContent>
                      </Popover>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {props.sitemapUrlCount !== null ? props.sitemapUrlCount : "..."}
                    </span>
                  </div>
                }
              />
              <MenuItem
                icon={Route}
                label="Redirects"
                href="/private/redirects"
                indicator="arrow"
                testId="link-redirects-page"
                rightContent={<span className="text-xs text-muted-foreground">{props.redirectsList.length || '...'}</span>}
              />
              <MenuItem
                icon={Book}
                label="Content Types"
                onClick={() => props.setMenuView("content-types")}
                indicator="chevron"
                testId="button-content-types-menu"
              />
              <MenuItem
                icon={Image}
                label="Media Gallery"
                href="/private/media-gallery"
                indicator="arrow"
                testId="link-media-gallery"
              />
              <MenuItem
                icon={Database}
                label="Content Databases"
                onClick={() => props.setMenuView("databases")}
                indicator="chevron"
                testId="button-databases-menu"
              />
            </ExpandableMenuItem>

            <ExpandableMenuItem
              icon={Blocks}
              label="Components"
              expanded={props.componentsExpanded}
              onToggle={() => {
                const opening = !props.componentsExpanded;
                props.setComponentsExpanded(opening);
                if (opening) {
                  props.setSitemapExpanded(false);
                  props.setAiAgentsExpanded(false);
                  setSettingsExpanded(false);
                  setStoreExpanded(false);
                  setDiagnosticsExpanded(false);
                }
              }}
              testId="button-components-toggle"
            >
              <MenuItem
                icon={Blocks}
                label="Component Gallery"
                onClick={() => props.setMenuView("components")}
                indicator="chevron"
                testId="button-gallery-registry"
              />
              <MenuItem
                icon={Menu}
                label="Menus"
                onClick={() => props.setMenuView("menus")}
                indicator="chevron"
                testId="button-menus-menu"
              />
              {canViewMetrics && (
                <MenuItem
                  icon={BarChart2}
                  label="Component Insights"
                  href="/private/component-insights"
                  indicator="arrow"
                  testId="link-component-insights"
                />
              )}
              <MenuItem
                icon={IconLayersIntersect}
                label="Modals & CTA"
                href="/private/overlays"
                indicator="arrow"
                testId="link-overlays"
              />
            </ExpandableMenuItem>

            <ExpandableMenuItem
              icon={Brain}
              label="AI & Agents"
              expanded={props.aiAgentsExpanded}
              onToggle={() => {
                const opening = !props.aiAgentsExpanded;
                props.setAiAgentsExpanded(opening);
                if (opening) {
                  props.setSitemapExpanded(false);
                  props.setComponentsExpanded(false);
                  setSettingsExpanded(false);
                  setStoreExpanded(false);
                  setDiagnosticsExpanded(false);
                }
              }}
              testId="button-ai-agents-toggle"
            >
              <MenuItem
                icon={Settings}
                label="AI Settings"
                href="/private/settings/ai/llms"
                indicator="arrow"
                testId="link-ai-settings"
              />
              <MenuItem
                icon={IconServer}
                label="MCP Server"
                href="/private/mcp-server"
                indicator="arrow"
                testId="link-mcp-server"
              />
              <MenuItem
                icon={Pencil}
                label="Knowledge Editor"
                href="/private/ai-knowledge"
                indicator="arrow"
                testId="link-ai-knowledge"
              />
              <MenuItem
                icon={MessageCircle}
                label="Conversation Review"
                href="/private/ai-conversations"
                indicator="arrow"
                testId="link-ai-conversations"
              />
            </ExpandableMenuItem>

            {canViewMetrics && (
            <ExpandableMenuItem
              icon={Stethoscope}
              label="Reports & Diagnostics"
              expanded={diagnosticsExpanded}
              onToggle={() => {
                const opening = !diagnosticsExpanded;
                setDiagnosticsExpanded(opening);
                if (opening) {
                  props.setSitemapExpanded(false);
                  props.setComponentsExpanded(false);
                  props.setAiAgentsExpanded(false);
                  setSettingsExpanded(false);
                  setStoreExpanded(false);
                }
              }}
              testId="button-diagnostics-toggle"
            >
              <MenuItem
                icon={Stethoscope}
                label="Diagnostics"
                href="/private/diagnostics"
                indicator="arrow"
                testId="link-diagnostics"
              />
              <MenuItem
                icon={IconAlertTriangle}
                label="Runtime Issues"
                href="/private/diagnostics/runtime-issues"
                indicator="arrow"
                testId="link-runtime-issues"
                infoTooltip="Visitor-facing signals for the active site (public 404s). Durable via GCS. Separate from the process Error Log."
              />
              <MenuItem
                icon={IconAlertTriangle}
                label="Server Error Log"
                href="/private/error-log"
                indicator="arrow"
                testId="link-error-log"
                infoTooltip="Process-level errors and warnings across all sites. Badge shows error count only (warnings are rate-limited and listed on the page)."
                rightContent={
                  errorLogCount > 0 ? (
                    <span
                      className={cn(
                        badgeVariants({ variant: "destructive" }),
                        "text-xs px-1.5 py-0 min-w-[1.25rem] text-center tabular-nums"
                      )}
                      data-testid="badge-error-log-count"
                    >
                      {errorLogCount}
                    </span>
                  ) : undefined
                }
              />
              <MenuItem
                icon={Search}
                label="SEO overview"
                href="/private/diagnostics/seo"
                indicator="arrow"
                testId="link-diagnostics-seo"
              />
            </ExpandableMenuItem>
            )}

            <ExpandableMenuItem
              icon={IconShoppingBag}
              label="Store & Monetization"
              expanded={storeExpanded}
              onToggle={() => {
                const opening = !storeExpanded;
                setStoreExpanded(opening);
                if (opening) {
                  props.setSitemapExpanded(false);
                  props.setComponentsExpanded(false);
                  props.setAiAgentsExpanded(false);
                  setSettingsExpanded(false);
                  setDiagnosticsExpanded(false);
                }
              }}
              testId="button-store-toggle"
            >
              <MenuItem
                icon={IconShoppingBag}
                label="Ecommerce"
                href="/private/store/ecommerce"
                indicator="arrow"
                testId="link-store-ecommerce"
              />
              <MenuItem
                icon={IconShoppingBag}
                label="Products"
                href="/private/store/products"
                indicator="arrow"
                testId="link-store-products"
              />
              {canViewMetrics && (
                <MenuItem
                  icon={IconTargetArrow}
                  label="Conversion Events"
                  href="/private/store/conversions"
                  indicator="arrow"
                  testId="link-store-conversions"
                />
              )}
            </ExpandableMenuItem>

            <ExpandableMenuItem
              icon={Settings}
              label="Settings"
              expanded={settingsExpanded}
              onToggle={() => {
                const opening = !settingsExpanded;
                setSettingsExpanded(opening);
                if (opening) {
                  props.setSitemapExpanded(false);
                  props.setComponentsExpanded(false);
                  props.setAiAgentsExpanded(false);
                  setStoreExpanded(false);
                  setDiagnosticsExpanded(false);
                }
              }}
              testId="button-settings-toggle"
            >
              <MenuItem
                icon={Settings}
                label="General"
                href="/private/settings"
                indicator="arrow"
                testId="link-settings-general"
              />
              <MenuItem
                icon={Search}
                label="SEO/GEO"
                href="/private/settings/seo/og"
                indicator="arrow"
                testId="link-settings-seo"
              />
              <MenuItem
                icon={Palette}
                label="Theme Editor"
                href="/private/theme-editor"
                indicator="arrow"
                testId="link-theme-editor"
              />
              {canViewMetrics && (
                <MenuItem
                  icon={BarChart2}
                  label="Tracking"
                  href="/private/tracking"
                  indicator="arrow"
                  testId="link-tracking"
                />
              )}
              {canManageUsers && (
                <MenuItem
                  icon={IconShield}
                  label="Security and Users"
                  href="/private/security/captcha"
                  indicator="arrow"
                  testId="link-security"
                />
              )}
            </ExpandableMenuItem>
          </div>

          <div className="border-t" data-testid="section-sync">
            <div className="flex divide-x divide-border">
              <GitHubSyncChip
                className="flex-1 min-w-0"
                githubSyncStatus={props.githubSyncStatus}
                pendingChanges={props.pendingChanges}
                pendingChangesLoading={props.pendingChangesLoading}
                syncStatusLoading={props.syncStatusLoading}
                refreshSyncStatus={props.refreshSyncStatus}
                fetchPendingChanges={props.fetchPendingChanges}
                setCommitModalOpen={props.setCommitModalOpen}
              />
              <GcsBucketSyncChip
                className="flex-1 min-w-0"
                onNavigate={() => props.navigate("/private/cloud-sync")}
              />
            </div>
          </div>

          <div className="border-t p-2 space-y-1">
              <div className="flex items-center justify-between px-3 py-1.5">
                <div className="flex flex-col">
                  <div
                    className="flex items-center gap-2 cursor-pointer hover-elevate rounded px-1 -mx-1"
                    onClick={() => props.setSessionModalOpen(true)}
                    data-testid="button-session-header"
                    title="View session data"
                  >
                    <Cookie className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Session</span>
                    {!props.hasToken && (
                      <span className="text-xs text-amber-600 dark:text-amber-400">(no auth)</span>
                    )}
                  </div>
                  {versionData?.version && (
                    <span
                      className="text-[10px] text-muted-foreground px-1 -mx-1"
                      data-testid="text-app-version"
                      title={versionData.deployedAt || undefined}
                    >
                      v{versionData.version}
                      {versionDeployedLabel ? ` · ${versionDeployedLabel}` : ""}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <LocationOverrideBadge />
                  <button
                    className={cn(badgeVariants({ variant: "outline" }), "cursor-pointer text-xs gap-1 no-default-active-elevate")}
                    onClick={props.toggleLanguage}
                    data-testid="button-toggle-language"
                    title="Click to toggle language"
                  >
                    <Languages className="h-3 w-3" />
                    <span>{props.currentLang.toUpperCase()}</span>
                  </button>
                  <button
                    className={cn(badgeVariants({ variant: "outline" }), "cursor-pointer text-xs gap-1 no-default-active-elevate")}
                    onClick={props.toggleTheme}
                    data-testid="button-toggle-theme"
                    title="Click to toggle theme"
                  >
                    {props.theme === "light"
                      ? <Sun className="h-3 w-3" />
                      : <Moon className="h-3 w-3" />}
                    <span className="capitalize">{props.theme}</span>
                  </button>
                </div>
              </div>
          </div>

          <div className="border-t" data-testid="section-site-workers">
            <div className="flex divide-x divide-border">
              <div className="flex flex-[2] min-w-0 items-center justify-between gap-2 px-3 py-2">
                <div className="flex min-w-0 items-center gap-2">
                  <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs font-mono text-foreground truncate">{props.siteInfo?.domain ?? "—"}</span>
                  {props.siteInfo?.isDevOverride && (
                    <Badge
                      className="border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300 text-[10px] px-1.5 py-0 font-semibold shrink-0"
                      title="Dev site override active"
                    >
                      forced
                    </Badge>
                  )}
                </div>
                <button
                  className="p-1 rounded hover-elevate shrink-0"
                  onClick={props.onOpenSiteManager}
                  data-testid="button-site-manager"
                  title="Open Site Manager"
                >
                  <IconSwitchHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                </button>
              </div>
              <button
                type="button"
                className="flex flex-1 min-w-0 items-center justify-center gap-1.5 px-3 py-2 hover-elevate"
                onClick={() => props.navigate("/private/background-pipeline")}
                data-testid="button-background-pipeline"
                title="Agent pipeline"
              >
                <Bot
                  className={cn(
                    "h-3.5 w-3.5 shrink-0",
                    pipelineVisualState === "idle" && "text-chart-3",
                    pipelineVisualState === "degraded" && "text-amber-600 dark:text-amber-400",
                    pipelineVisualState === "stalled" && "text-destructive",
                    pipelineVisualState === "active" && "text-muted-foreground animate-pulse",
                    pipelineVisualState === "loading" && "text-muted-foreground",
                  )}
                />
                <PipelineCounts data={pipelineStatus} loading={pipelineLoading} />
                <span
                  className={cn(
                    "text-xs font-semibold text-muted-foreground tracking-wide shrink-0",
                    !pipelineIsWorking && "uppercase",
                  )}
                >
                  {pipelineIsWorking ? (
                    <>
                      Working
                      <AnimatedEllipsis className="inline-block w-[1.5em] text-left" />
                    </>
                  ) : (
                    "Agents"
                  )}
                </span>
              </button>
            </div>
          </div>
        </>
      ) : props.menuView === "components" ? (
        <ComponentsView
          componentSearch={props.componentSearch}
          setComponentSearch={props.setComponentSearch}
          showComponentSearch={props.showComponentSearch}
          setShowComponentSearch={props.setShowComponentSearch}
          setMenuView={props.setMenuView}
          filteredComponents={props.filteredComponents}
          componentRegistryData={props.componentRegistryData}
          componentIconMap={props.componentIconMap}
        />
      ) : props.menuView === "versioning" ? (
        <VersioningView
          setMenuView={props.setMenuView}
          contentInfo={props.contentInfo}
          versioningLoading={props.versioningLoading}
          versioningData={props.versioningData as any}
          navigate={props.navigate}
          pathname={props.pathname}
          onVersioningDataUpdate={props.onVersioningDataUpdate as any}
          onEditVariantYaml={props.onEditVariantYaml}
          onEditDefaultYaml={props.onEditDefaultYaml}
          onRequestDeletePage={props.onRequestDeletePage}
          onOpenTemplateYaml={props.onOpenTemplateYaml}
          detachBusy={props.detachBusy}
          onRequestDetach={openDetachConfirm}
          onRequestReattach={openReattachConfirm}
          pageErrorCount={props.pageErrorCount}
          pageWarningCount={props.pageWarningCount}
          pageDiagnosticsLoading={props.pageDiagnosticsLoading}
          pageDiagnosticsUrl={props.pageDiagnosticsUrl}
          onOpenPageErrors={props.onOpenPageErrors}
        />
      ) : props.menuView === "menus" ? (
        <>
          <div className="px-3 py-2 border-b">
            <div className="flex items-center gap-3 justify-between">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => props.setMenuView("main")}
                  className="p-1 rounded-md hover-elevate"
                  data-testid="button-back-to-main-menus"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <div>
                  <h3 className="font-semibold text-sm">Menus</h3>
                  <p className="text-xs text-muted-foreground">Navigation menu configurations</p>
                </div>
              </div>
              <button
                onClick={() => setCreateMenuOpen(true)}
                className="p-1 rounded-md hover-elevate"
                title="Create new menu"
                data-testid="button-create-menu"
              >
                <Plus className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          </div>

          <ScrollArea className="h-[280px]">
            <div className="p-2 space-y-1">
              <MenusView />
            </div>
          </ScrollArea>

          <CreateMenuModal open={createMenuOpen} onOpenChange={setCreateMenuOpen} />
        </>
      ) : props.menuView === "databases" ? (
        <DatabasesView setMenuView={props.setMenuView} />
      ) : props.menuView === "content-types" ? (
        <ContentTypesView
          setMenuView={props.setMenuView}
          onEditContentTypesYml={props.onEditContentTypesYml}
        />
      ) : (
        <SitemapView
          setMenuView={props.setMenuView}
          sitemapUrls={props.sitemapUrls}
          sitemapLoading={props.sitemapLoading}
          sitemapSearch={props.sitemapSearch}
          setSitemapSearch={props.setSitemapSearch}
          showSitemapSearch={props.showSitemapSearch}
          setShowSitemapSearch={props.setShowSitemapSearch}
          sitemapPresenceFilter={props.sitemapPresenceFilter}
          setSitemapPresenceFilter={props.setSitemapPresenceFilter}
          filteredSitemapUrls={props.filteredSitemapUrls}
          folders={props.folders}
          rootUrls={props.rootUrls}
          expandedFolders={props.expandedFolders}
          toggleFolder={props.toggleFolder}
          setCreateContentModalOpen={props.setCreateContentModalOpen}
          handleDuplicatePage={props.handleDuplicatePage}
          handleDeletePage={props.handleDeletePage}
          handleDownloadYml={props.handleDownloadYml}
          handleEditPageMeta={props.handleEditPageMeta}
          handleRefreshCache={props.handleRefreshCache}
          validationSummary={props.validationSummary}
          onOpenDiagnosticsForUrl={props.onOpenDiagnosticsForUrl}
        />
      )}

      <Dialog open={detachConfirmOpen} onOpenChange={setDetachConfirmOpen}>
        <DialogContent className="sm:max-w-[560px] max-h-[85vh] flex flex-col overflow-hidden" data-testid="dialog-detach-confirm">
          <DialogHeader>
            <DialogTitle>Detach from shared template?</DialogTitle>
            <DialogDescription>
              This page will stop following the shared {props.contentInfo.label || props.contentInfo.type || "entry"} template and keep its own layout and Page Versions.
            </DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto space-y-4 text-sm text-muted-foreground pr-1">
            <div>
              <p className="font-medium text-foreground mb-1">Benefits</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Customize sections and layout for this page only</li>
                <li>Run Page Versions (A/B tests) on this URL without affecting every other entry</li>
                <li>Template traffic splits no longer control this page</li>
              </ul>
            </div>
            <div>
              <p className="font-medium text-foreground mb-1">Tradeoffs</p>
              <ul className="list-disc pl-5 space-y-1">
                <li>Future template updates will not apply here automatically</li>
                <li>You own this page&apos;s structure going forward</li>
                <li>Re-attaching later is destructive — custom sections, layout overrides, and entry versions are removed</li>
              </ul>
            </div>
            <p>
              Detach when one page needs its own experiments or layout, or before adding a new translation locale.
              Stay attached when you want every entry to keep matching the shared template.
            </p>
            <p className="text-xs">
              Detach only updates locales that already have a live{" "}
              <code className="text-[11px]">{"{locale}.yml"}</code> on this entry — it does not invent missing languages.
              If this entry has no locale files yet, detach fails until you create one.
            </p>

            <button
              type="button"
              className="inline-flex items-center gap-1 text-xs text-violet-600 dark:text-violet-400 hover:underline"
              onClick={() => setShowDetachAdvanced((v) => !v)}
              data-testid="button-toggle-detach-advanced"
            >
              {showDetachAdvanced ? "Hide advanced details" : "Read more (advanced)"}
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${showDetachAdvanced ? "rotate-180" : ""}`}
              />
            </button>

            {showDetachAdvanced && (
              <div className="rounded-md border border-border bg-muted/40 p-3 space-y-3 text-xs">
                <div>
                  <p className="font-medium text-foreground mb-1">How it works under the hood</p>
                  <p>
                    Detach copies the live shared template structure into this entry&apos;s <strong>existing</strong> locale YAML files and sets{" "}
                    <code className="text-[11px]">detached: true</code> in{" "}
                    <code className="text-[11px]">_common.yml</code>. Template variables like{" "}
                    <code className="text-[11px]">{"{{ entry.* }}"}</code> are preserved, not resolved.
                    Paths: <code className="text-[11px]">server/shared-layout-detach.ts</code>, emptiness rules in{" "}
                    <code className="text-[11px]">shared/isEmptyLocaleContent.ts</code>.
                  </p>
                </div>
                <div>
                  <p className="font-medium text-foreground mb-1">Translations</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>
                      Field translations do <strong className="font-medium">not</strong> need detach — use MCP{" "}
                      <code className="text-[11px]">translate_entry</code> while attached (draft → promote)
                    </li>
                    <li>After detach, shell-owned locales use <code className="text-[11px]">translate_entry</code> sections mode or MCP <code className="text-[11px]">set_entry_attachment</code></li>
                    <li>New locales start as <code className="text-[11px]">draft.{"{locale}"}.yml</code> (not public) until promote/publish</li>
                    <li>Empty live stubs are converted to draft — they 404 publicly with an unavailable message</li>
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-foreground mb-1">Versioning</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>
                      Attached pages version the shared template slug{" "}
                      <code className="text-[11px]">single</code>
                    </li>
                    <li>After detach, Page Versions live under this entry&apos;s own slug</li>
                    <li>Other attached entries of this type keep sharing the template</li>
                  </ul>
                </div>
                <div>
                  <p className="font-medium text-foreground mb-1">Files written</p>
                  <ul className="list-disc pl-5 space-y-1">
                    <li>
                      Existing locale files (e.g. <code className="text-[11px]">en.yml</code>) receive baked{" "}
                      <code className="text-[11px]">sections</code> and <code className="text-[11px]">layout</code> from the live template
                    </li>
                    <li>Sibling locales without a file are not created</li>
                    <li>Existing data fields on the entry are kept; structural keys are owned by the entry afterward</li>
                  </ul>
                </div>
              </div>
            )}
          </div>
          <DialogFooter className="border-t pt-4 gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setDetachConfirmOpen(false)}
              disabled={props.detachBusy}
              data-testid="button-detach-cancel"
            >
              <Link2 className="h-4 w-4 mr-2" />
              Keep in sync
            </Button>
            <Button
              disabled={props.detachBusy}
              data-testid="button-detach-confirm"
              onClick={async () => {
                await props.onDetachEntry?.();
                setDetachConfirmOpen(false);
              }}
            >
              {props.detachBusy ? (
                <RefreshCw className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Unlink className="h-4 w-4 mr-2" />
              )}
              Detach
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={reattachConfirmOpen} onOpenChange={setReattachConfirmOpen}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-reattach-confirm">
          <DialogHeader>
            <DialogTitle>Re-attach to shared template?</DialogTitle>
            <DialogDescription>
              This entry will use the shared template again. Custom sections, layout/menu overrides, and entry variants will be removed. Other data fields are kept. To undo, restore this entry’s folder from git history (DebugBubble Versions → Restore, or GitHub).
            </DialogDescription>
          </DialogHeader>
          <div className="text-sm space-y-3" data-testid="text-reattach-sections-preview">
            {reattachPreviewLoading ? (
              <p className="text-muted-foreground flex items-center gap-2">
                <RefreshCw className="h-3.5 w-3.5 animate-spin" />
                Checking sections and variants…
              </p>
            ) : (
              <>
                {sectionsThatWillBeLost.length === 0 ? (
                  <p className="text-muted-foreground">
                    No sections will be lost — this entry’s sections already match the shared template (or has none of its own).
                    {hasLayoutOverride ? " A layout/menu override will still be removed." : ""}
                  </p>
                ) : (
                  <div className="space-y-1.5">
                    <p className="text-muted-foreground">
                      These sections are only on this detached page and will be lost:
                    </p>
                    <ul className="list-disc pl-5 space-y-0.5 max-h-32 overflow-y-auto text-foreground">
                      {sectionsThatWillBeLost.map((s, i) => (
                        <li key={`${s.sectionId || s.type}-${i}`} className="text-xs">
                          <span className="font-medium">{s.label}</span>
                          {s.type ? (
                            <span className="text-muted-foreground"> ({s.type})</span>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                    {hasLayoutOverride ? (
                      <p className="text-xs text-muted-foreground">A layout/menu override will also be removed.</p>
                    ) : null}
                  </div>
                )}

                {variantsThatWillBeLost.length === 0 ? (
                  <p className="text-muted-foreground" data-testid="text-reattach-no-variants">
                    No entry variants will be lost.
                  </p>
                ) : (
                  <div className="space-y-1.5" data-testid="text-reattach-variants-preview">
                    <p className="text-muted-foreground">
                      These page versions will be deleted:
                    </p>
                    <ul className="list-disc pl-5 space-y-0.5 max-h-32 overflow-y-auto text-foreground">
                      {variantsThatWillBeLost.map((v, i) => (
                        <li key={`${v.slug}-${v.locale}-${i}`} className="text-xs">
                          <span className="font-medium">{v.slug}</span>
                          <span className="text-muted-foreground">
                            {" "}
                            ({v.locale.toUpperCase()}
                            {v.allocation > 0 ? ` · ${v.allocation}% traffic` : ""})
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => setReattachConfirmOpen(false)}
              disabled={props.detachBusy}
              data-testid="button-reattach-cancel"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={props.detachBusy}
              data-testid="button-reattach-confirm"
              onClick={async () => {
                await props.onReattachEntry?.();
                setReattachConfirmOpen(false);
              }}
            >
              {props.detachBusy ? <RefreshCw className="h-4 w-4 animate-spin mr-2" /> : null}
              Re-attach
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
