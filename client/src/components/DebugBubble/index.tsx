import { useState, useEffect, lazy, Suspense, useRef, useCallback } from "react";
import { AlertTriangle, ArrowRight, ArrowUp, Award, BarChart2, Blocks, Book, Brain, Bug, Building2, Columns2, CreditCard, File, Folder, FolderCode, GitBranch, HelpCircle, Image, Link2, MessageSquare, PanelBottom, Pencil, Rocket, Sparkles, Table, Unlink, Users, X } from "lucide-react";
import { subscribeToContentUpdates, subscribeToVariantCreated, subscribeToVariantDeleted, subscribeToVariantPromoted } from "@/lib/contentEvents";

import { useTranslation } from "react-i18next";
import { useLocation, useSearch } from "wouter";
import { useInternalNav } from "@/hooks/useInternalNav";
import { useSession } from "@/contexts/SessionContext";
import { normalizeLocale, buildContentUrlFromPattern } from "@/lib/locale";
import { useContentTypes, getFolderFromType, useContentTypesRaw } from "@/hooks/useContentTypes";
import { consensusSitemapContentType, contentTypeForSitemapFolder } from "@/lib/content-type-routes";
import { isSharedLayoutType } from "@/lib/sharedLayoutEntry";
import { computeDirtyMetaKeys, liveSnippetClearBlocked } from "@/lib/buildMetaSaveOperations";
import { useSeoModalSaves } from "@/hooks/useSeoModalSaves";
import type { SeoMeta } from "@/components/DebugBubble/types";
import { ManagedSeoModal, type ManagedSeoModalTarget } from "@/components/editing/ManagedSeoModal";
import { useEditModeOptional } from "@/contexts/EditModeContext";
import {
  restoreEditModeScrollPosition,
} from "@/lib/editModeScroll";
import { useEnterVisualEditMode } from "@/hooks/useEnterVisualEditMode";
import { useIsMobile } from "@/hooks/use-mobile";
import { useSyncOptional } from "@/contexts/SyncContext";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Sheet,
  SheetContent,
  SheetTitle,
} from "@/components/ui/sheet";
import { useToast } from "@/hooks/use-toast";
import { useDebugAuth, getDebugToken, getDebugUserName, resolveAuthorName } from "@/hooks/useDebugAuth";
import { useSystemAlerts } from "@/hooks/useSystemAlerts";
import { useGitHubUserConnection } from "@/hooks/useGitHubUserConnection";
import { queryClient } from "@/lib/queryClient";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import { LocaleFlag } from "./components/LocaleFlag";
import { DebugPanelContent } from "./components/DebugPanelContent";
import { useQuery } from "@tanstack/react-query";
import {
  STORAGE_KEY,
  OPEN_STORAGE_KEY,
  OPEN_DEBUG_BUBBLE_EVENT,
  type MenuView,
  type SitemapUrl,
  type RedirectItem,
  type VersioningResponse,
  type GitHubSyncStatus,
  type PendingChange,
  type ContentInfo,
  type MenuFileItem,
  type MenuData,
  type PageDiagnostics,
} from "./types";
import { deslugify, detectContentInfo, getPersistedMenuView } from "./utils/debugHelpers";
const RawFileEditorPanel = lazy(() => import("@/components/editing/RawFileEditorPanel"));
const ContentTypesYmlEditorPanel = lazy(() => import("@/components/editing/ContentTypesYmlEditorPanel"));
import { SessionModal } from "./components/SessionModal";
import { SyncModal } from "./components/SyncModal";
import { PullConflictModal } from "./components/PullConflictModal";
import { ConfirmPullFileModal } from "./components/ConfirmPullFileModal";
import { FileDiffModal } from "./components/FileDiffModal";
import { DeletePageModal } from "./components/DeletePageModal";
import { CreateContentModal } from "./components/CreateContentModal";
import { PageErrorsModal, PER_PAGE_VALIDATORS } from "./components/PageErrorsModal";
import { fetchPageDiagnostics } from "@/lib/fetchPageDiagnostics";
import { SeoModal } from "./components/SeoModal";
import { SiteManagerModal } from "./components/SiteManagerModal";
import { SwitchSiteModal } from "./components/SwitchSiteModal";
import { McpRequiredForAiModal } from "@/components/mcp/McpRequiredForAiModal";
import type { McpSetupTabId } from "@/components/mcp/mcpUrlHelpers";
import type { SolveWithAiAgentId } from "@/components/DebugBubble/solveWithAiPrompt";

const componentIconMap: Record<string, typeof Blocks> = {
  hero: Rocket,
  two_column: Columns2,
  two_column_accordion_card: Columns2,
  comparison_table: Table,
  features_grid: Columns2,
  features_quad: Columns2,
  numbered_steps: ArrowRight,
  ai_learning: Brain,
  mentorship: Users,
  community_support: Users,
  pricing: CreditCard,
  projects: FolderCode,
  project_showcase: BarChart2,
  syllabus: Book,
  why_learn_ai: Sparkles,
  certificate: Award,
  whos_hiring: Building2,
  testimonials: MessageSquare,
  testimonials_slide: MessageSquare,
  testimonials_grid: MessageSquare,
  faq: HelpCircle,
  cta_banner: ArrowRight,
  footer: PanelBottom,
  award_badges: Award,
  awards_marquee: Award,
  horizontal_bars: BarChart2,
  vertical_bars_cards: BarChart2,
  graduates_stats: Users,
  image_row: Image,
  lead_form: File,
  apply_form: File,
  banner: Rocket,
  article: Book,
  list_press_mentions: MessageSquare,
  split_cards: Columns2,
  course_selector: Book,
  sticky_cta: ArrowRight,
  bento_cards: Columns2,
  value_proof_panel: BarChart2,
  partnership_carousel: Building2,
  human_and_ai_duo: Brain,
  bullet_tabs_showcase: Sparkles,
  geeks_vs_others_comparison: Table,
};

export function DebugBubble() {
  const handleLinkClick = useInternalNav();
  // Check if we should hide the debug bubble (via URL param or in preview-frame route)
  const shouldHide = typeof window !== "undefined" && (
    new URLSearchParams(window.location.search).get("hide_debug") === "true" ||
    new URLSearchParams(window.location.search).get("device_embed") === "1" ||
    window.location.pathname === "/preview-frame" ||
    window.location.pathname.startsWith("/private/entry-preview-frame/")
  );
  
  const { isValidated, hasToken, isLoading, isDebugMode, retryValidation, validateManualToken, clearToken, checkSession } = useDebugAuth();
  const { criticalAlerts } = useSystemAlerts();
  const { showCritical: githubConnectCritical, needsConnect: githubConnectRequired } =
    useGitHubUserConnection();
  const contentTypesMap = useContentTypes();
  const { data: contentTypesRaw } = useContentTypesRaw();
  const { session } = useSession();
  const editMode = useEditModeOptional();
  const enterVisualEdit = useEnterVisualEditMode();
  const syncContext = useSyncOptional();
  const { i18n } = useTranslation();
  const { toast } = useToast();
  const [pathname, navigate] = useLocation();
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(() => {
    if (typeof window !== "undefined") {
      const persisted = sessionStorage.getItem(OPEN_STORAGE_KEY);
      if (persisted === "true") {
        sessionStorage.removeItem(OPEN_STORAGE_KEY);
        return true;
      }
    }
    return false;
  });
  const [theme, setTheme] = useState<"light" | "dark">(() => {
    if (typeof window !== "undefined") {
      return document.documentElement.classList.contains("dark") ? "dark" : "light";
    }
    return "light";
  });
  const [cacheClearStatus, setCacheClearStatus] = useState<"idle" | "loading" | "success">("idle");
  const [sitemapUrlCount, setSitemapUrlCount] = useState<number | null>(null);
  const [sitemapUrls, setSitemapUrls] = useState<SitemapUrl[]>([]);
  const [sitemapSearch, setSitemapSearch] = useState("");
  const [sitemapLoading, setSitemapLoading] = useState(false);
  const [showSitemapSearch, setShowSitemapSearch] = useState(false);
  const [sitemapPresenceFilter, setSitemapPresenceFilter] = useState<"all" | "in-sitemap" | "not-in-sitemap">("all");
  const [showYamlEditor, setShowYamlEditor] = useState(false);
  const [yamlEditorInfo, setYamlEditorInfo] = useState<{ contentType: string; slug: string; locale: string; variantSlug?: string; readOnly?: boolean } | null>(null);
  const [showContentTypesYmlEditor, setShowContentTypesYmlEditor] = useState(false);
  const [componentSearch, setComponentSearch] = useState("");
  const [showComponentSearch, setShowComponentSearch] = useState(false);

  const { data: homePageSettings } = useQuery<{ type: string; slug: string }>({
    queryKey: ["/api/settings/home-page"],
    staleTime: 60000,
  });

  const { data: componentRegistryData } = useQuery<{ components: Array<{ type: string; name: string; description: string; latestVersion: string; versions: string[] }> }>({
    queryKey: ["/api/component-registry"],
    staleTime: 60000,
  });

  const { data: siteInfo } = useQuery<{ domain: string; contentFolder: string; isMultiSite: boolean; isDevOverride: boolean; githubRepoUrl?: string }>({
    queryKey: ["/api/site/info"],
    staleTime: 30000,
  });

  const filteredComponents = (() => {
    const components = componentRegistryData?.components?.filter(c => c.type !== "_common") || [];
    if (!componentSearch) return components;
    const q = componentSearch.toLowerCase();
    return components.filter(c =>
      c.type.toLowerCase().includes(q) ||
      c.name.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q)
    );
  })();
  const [tokenInput, setTokenInput] = useState("");
  const [pendingAutoEditMode, setPendingAutoEditMode] = useState(() => {
    if (typeof window === 'undefined') return false;
    return new URLSearchParams(window.location.search).has('token');
  });
  const prevIsValidatedRef = useRef<boolean | null>(null);
  const [redirectsList, setRedirectsList] = useState<RedirectItem[]>([]);
  const [sessionModalOpen, setSessionModalOpen] = useState(false);
  const [siteManagerModalOpen, setSiteManagerModalOpen] = useState(false);
  const [switchSiteModalOpen, setSwitchSiteModalOpen] = useState(false);
  const [tokenCopied, setTokenCopied] = useState(false);
  
  // Versioning state
  const [versioningData, setVersioningData] = useState<VersioningResponse | null>(null);
  const [versioningLoading, setVersioningLoading] = useState(false);
  const [detachBusy, setDetachBusy] = useState(false);
  
  // GitHub sync status state
  const [githubSyncStatus, setGithubSyncStatus] = useState<GitHubSyncStatus | null>(null);
  const [syncStatusLoading, setSyncStatusLoading] = useState(false);
  
  // Pending changes state
  const [pendingChanges, setPendingChanges] = useState<PendingChange[]>([]);
  const [pendingChangesLoading, setPendingChangesLoading] = useState(false);
  const [commitModalOpen, setCommitModalOpen] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [isCommitting, setIsCommitting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  
  // Pull conflict state
  const [pullConflictModalOpen, setPullConflictModalOpen] = useState(false);
  const [pullConflictFiles, setPullConflictFiles] = useState<string[]>([]);
  
  // Per-file sync state
  const [selectedFileForCommit, setSelectedFileForCommit] = useState<string | null>(null);
  const [fileCommitMessage, setFileCommitMessage] = useState("");
  const [fileCommitting, setFileCommitting] = useState<string | null>(null);
  const [filePulling, setFilePulling] = useState<string | null>(null);
  const [confirmPullFile, setConfirmPullFile] = useState<string | null>(null);
  const [diffFile, setDiffFile] = useState<string | null>(null);
  
  // Advanced options state
  const [advancedOptionsOpen, setAdvancedOptionsOpen] = useState(false);
  const [isIgnoringAllChanges, setIsIgnoringAllChanges] = useState(false);

  const [autoCommitStatus, setAutoCommitStatus] = useState<{
    enabled: boolean;
    pendingFiles: number;
    pendingFilesList: string[];
    pendingFilesDetails: Array<{ filePath: string; author: string; timestamp: number }>;
    lastCommitAt: string | null;
    lastCommitSha: string | null;
    lastError: string | null;
    conflictedFiles: string[];
    commitIntervalSeconds: number;
    nextSyncAt: number | null;
    isCommitting: boolean;
    githubConfigured: boolean;
  } | null>(null);
  const [autoCommitCountdown, setAutoCommitCountdown] = useState<number | null>(null);
  const [isFlushing, setIsFlushing] = useState(false);
  const [manualActionsOpen, setManualActionsOpen] = useState(false);
  const [isPushingAllLocal, setIsPushingAllLocal] = useState(false);
  const [pushAllLocalError, setPushAllLocalError] = useState<string | null>(null);
  
  // Create content modal state
  const [createContentModalOpen, setCreateContentModalOpen] = useState(false);
  const [createContentType, setCreateContentType] = useState<string>('page');
  const [createContentTitle, setCreateContentTitle] = useState("");
  const [createContentSlugEn, setCreateContentSlugEn] = useState("");
  const [createContentSlugEs, setCreateContentSlugEs] = useState("");
  const [createContentSlugEnStatus, setCreateContentSlugEnStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [createContentSlugEsStatus, setCreateContentSlugEsStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  const [slugEnConflictReason, setSlugEnConflictReason] = useState<string | null>(null);
  const [slugEsConflictReason, setSlugEsConflictReason] = useState<string | null>(null);
  const [editingSlugEn, setEditingSlugEn] = useState(false);
  const [editingSlugEs, setEditingSlugEs] = useState(false);
  const [isCreatingContent, setIsCreatingContent] = useState(false);
  
  // Duplicate page state
  const [duplicatingPage, setDuplicatingPage] = useState<{
    loc: string;
    label: string;
    contentType: string;
    locale?: string;
    sourceSlug?: string;
    isDraft?: boolean;
  } | null>(null);
  
  // Delete page state
  const [deletePageModalOpen, setDeletePageModalOpen] = useState(false);
  const [deletingPage, setDeletingPage] = useState<{
    slug: string;
    contentType: string;
    locale: string;
    availableLocales?: string[];
  } | null>(null);
  const [deleteConfirmInput, setDeleteConfirmInput] = useState("");
  const [isDeletingPage, setIsDeletingPage] = useState(false);
  
  // Session check state
  const [isCheckingSession, setIsCheckingSession] = useState(false);
  
  // SEO modal state
  const [seoModalOpen, setSeoModalOpen] = useState(false);
  const [managedSeoModalOpen, setManagedSeoModalOpen] = useState(false);
  const [managedSeoModalTarget, setManagedSeoModalTarget] = useState<ManagedSeoModalTarget | null>(null);
  const [seoLoading, setSeoLoading] = useState(false);
  const [seoData, setSeoData] = useState<{
    meta: Record<string, unknown>;
    liveMeta?: Record<string, unknown>;
    metaOverrides?: string[];
    context?: "live" | "variant";
    variant?: string;
    faqSchema: Record<string, unknown> | null;
    schemaOrg: Record<string, unknown>[];
    title: string;
    slug?: string;
  } | null>(null);
  const [seoMeta, setSeoMeta] = useState<SeoMeta>({
    page_title: "",
    description: "",
    og_image: "",
    canonical_url: "",
    robots: "",
    priority: "",
    change_frequency: "",
    redirects: [],
  });
  const [seoDirtyKeys, setSeoDirtyKeys] = useState<Set<string>>(new Set());
  const seoBaselineMetaRef = useRef<SeoMeta>({
    page_title: "",
    description: "",
    og_image: "",
    canonical_url: "",
    robots: "",
    priority: "",
    change_frequency: "",
    redirects: [],
  });
  const applySeoMetaFromForm = useCallback((next: SeoMeta) => {
    setSeoMeta(next);
    setSeoDirtyKeys(computeDirtyMetaKeys(next, seoBaselineMetaRef.current));
  }, []);
  const seoBaselineLocationsRef = useRef<string[]>([]);
  const [locationsBaseline, setLocationsBaseline] = useState<string[]>([]);
  const [seoLocations, setSeoLocations] = useState<string[]>([]);
  const [seoAvailableLocations, setSeoAvailableLocations] = useState<Array<{ slug: string; name: string; city: string; country: string }>>([]);
  const [seoLocationSearch, setSeoLocationSearch] = useState("");
  
  // Slug rename state
  const [newSlugValue, setNewSlugValue] = useState("");
  const [slugCheckStatus, setSlugCheckStatus] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const [slugCheckReason, setSlugCheckReason] = useState<string | null>(null);
  const [slugRenaming, setSlugRenaming] = useState(false);
  const [slugRedirectPrompt, setSlugRedirectPrompt] = useState(false);
  const [slugOldUrl, setSlugOldUrl] = useState("");
  const [slugNewUrl, setSlugNewUrl] = useState("");
  
  // Breathecode host state
  const [breathecodeHost, setBreathecodeHost] = useState<{ host: string; isDefault: boolean } | null>(null);
  
  // Page diagnostics state
  const [pageErrorsModalOpen, setPageErrorsModalOpen] = useState(false);
  const [pageDiagnostics, setPageDiagnostics] = useState<PageDiagnostics | null>(null);
  const [pageDiagnosticsLoading, setPageDiagnosticsLoading] = useState(false);
  const [pageDiagnosticsError, setPageDiagnosticsError] = useState<string | null>(null);
  const lastDiagnosticsUrlRef = useRef<string | null>(null);
  const [mcpRequiredForAiOpen, setMcpRequiredForAiOpen] = useState(false);
  const [mcpRequiredSetupTab, setMcpRequiredSetupTab] = useState<McpSetupTabId>("cursor");
  const [mcpRequiredAgentId, setMcpRequiredAgentId] = useState<SolveWithAiAgentId>("copy-prompt");
  const [mcpRequiredAgentLabel, setMcpRequiredAgentLabel] = useState("AI Agent");
  const [mcpRequiredPrompt, setMcpRequiredPrompt] = useState("");
  const [mcpRequiredPrefillPrefix, setMcpRequiredPrefillPrefix] = useState<string | undefined>();

  const getUrlVariant = (): string | undefined => {
    if (typeof window === "undefined") return undefined;
    const q = new URLSearchParams(window.location.search);
    return q.get("variant") || q.get("force_variant") || undefined;
  };

  const refreshPageDiagnostics = async () => {
    const url = pageDiagnostics?.url ?? lastDiagnosticsUrlRef.current;
    if (!url) return;
    lastDiagnosticsUrlRef.current = url;
    const variant = getUrlVariant() ?? null;
    setPageDiagnosticsLoading(true);
    try {
      const data = await fetchPageDiagnostics(url, variant);
      setPageDiagnostics(data);
      setPageDiagnosticsError(null);
    } catch (err) {
      setPageDiagnosticsError(err instanceof Error ? err.message : "Failed to load diagnostics");
    }
    setPageDiagnosticsLoading(false);
  };

  // Validation cache summary for sitemap badges
  const [validationSummary, setValidationSummary] = useState<Record<string, { errorCount: number; warningCount: number }>>({});

  // URLs already auto-validated this session — ensures the lazy per-page
  // validation run fires at most once per URL even if the effect re-runs.
  const autoValidatedUrlsRef = useRef<Set<string>>(new Set());

  // Detect current content info from URL
  const contentInfo = detectContentInfo(pathname, contentTypesMap, homePageSettings ?? null);
  const contentTypeInfo = contentInfo.type
    ? contentTypesRaw?.find((t) => t.name === contentInfo.type)
    : undefined;
  const pageIsSharedLayout = isSharedLayoutType(contentTypeInfo);
  const pageIsDetached = !!versioningData?.detached;

  const isPreviewPath = pathname.startsWith("/private/preview/");
  const { data: previewLocaleUrls } = useQuery<{ urls: Record<string, string>; contentType: string; slug: string } | null>({
    queryKey: ["/api/locale-urls", pathname],
    queryFn: async () => {
      const res = await fetch(`/api/locale-urls?url=${encodeURIComponent(pathname)}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: isPreviewPath && !!contentInfo.type && !!contentInfo.slug,
    staleTime: 60_000,
  });

  const resolvedPublicPageUrl = (() => {
    if (!isPreviewPath || !contentInfo.type || !contentInfo.slug) return null;
    const searchParams = new URLSearchParams(
      typeof window !== "undefined" ? window.location.search : "",
    );
    const locale = normalizeLocale(searchParams.get("locale") || "en");
    // Prefer server-resolved URLs (fills :category and other pattern params)
    const fromApi =
      previewLocaleUrls?.urls?.[locale] ||
      previewLocaleUrls?.urls?.en ||
      Object.values(previewLocaleUrls?.urls || {})[0];
    if (fromApi) return fromApi;
    // Fallback only when the pattern has no extra params beyond :slug/:locale
    const ct = contentTypesMap?.[contentInfo.type];
    if (!ct?.url_pattern) return null;
    const pattern = ct.url_pattern[locale] || ct.url_pattern["default"] || ct.url_pattern["en"];
    if (!pattern) return null;
    if (/:(?!slug\b|locale\b)[a-zA-Z_]/.test(pattern)) return null;
    return pattern.replace(/:slug/g, contentInfo.slug).replace(/:locale/g, locale);
  })();

  useEffect(() => {
    setNewSlugValue("");
    setSlugCheckStatus("idle");
    setSlugCheckReason(null);
    setSlugRenaming(false);
    setSlugRedirectPrompt(false);
    setSlugOldUrl("");
    setSlugNewUrl("");
  }, [contentInfo.slug]);

  useEffect(() => {
    if (seoModalOpen) {
      setNewSlugValue(contentInfo.slug || "");
      setSlugCheckStatus("idle");
      setSlugCheckReason(null);
      setSlugRedirectPrompt(false);
    }
  }, [seoModalOpen, contentInfo.slug]);

  // State for expanded folders in sitemap view
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Initialize menu view from sessionStorage (persisted across refreshes)
  const [menuView, setMenuViewState] = useState<MenuView>(getPersistedMenuView);
  const [sitemapExpanded, setSitemapExpanded] = useState(false);
  const [componentsExpanded, setComponentsExpanded] = useState(false);
  const [aiAgentsExpanded, setAiAgentsExpanded] = useState(false);

  // Wrapper to persist menu view changes to sessionStorage
  const setMenuView = (view: MenuView) => {
    setMenuViewState(view);
    if (typeof window !== "undefined") {
      sessionStorage.setItem(STORAGE_KEY, view);
    }
  };


  // Auto-fetch page diagnostics when debug mode is active (on every page, including preview routes)
  useEffect(() => {
    if (!isDebugMode) {
      setPageDiagnostics(null);
      setPageDiagnosticsError(null);
      setPageErrorsModalOpen(false);
      return;
    }

    // Production requires a staff token; wait until debug auth has applied it.
    if (!import.meta.env.DEV && isValidated !== true) {
      return;
    }

    let diagnosticsUrl: string | null = null;

    if (isPreviewPath && contentInfo.type && contentInfo.slug) {
      const search = typeof window !== "undefined" ? window.location.search : "";
      diagnosticsUrl = `${pathname}${search}`;
    } else if (!pathname.startsWith('/private/')) {
      diagnosticsUrl = pathname;
    }

    if (!diagnosticsUrl) {
      setPageDiagnostics(null);
      setPageDiagnosticsError(null);
      setPageErrorsModalOpen(false);
      return;
    }

    const url = diagnosticsUrl;
    lastDiagnosticsUrlRef.current = url;
    const variant = getUrlVariant() ?? null;
    const token = getDebugToken();
    const authHeaders: Record<string, string> = {
      ...getSessionHeaders(),
      ...(token ? { Authorization: `Token ${token}` } : {}),
    };

    // Lazy validation: if this page has never been validated (no cache entry
    // at all — a clean run still writes an entry with empty arrays), run the
    // per-page validators once so issues like missing meta surface on first
    // visit without a manual "Run validation" click.
    const autoValidateIfNeverRun = async (data: PageDiagnostics): Promise<PageDiagnostics> => {
      if (data.validationSkippedReason === "unpublished_variant") return data;
      if (data.cached || autoValidatedUrlsRef.current.has(url + (variant ? `@${variant}` : ""))) {
        return data;
      }
      autoValidatedUrlsRef.current.add(url + (variant ? `@${variant}` : ""));
      try {
        await fetch("/api/validation/run-page", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
          body: JSON.stringify({
            url,
            validators: PER_PAGE_VALIDATORS,
            ...(variant ? { variant } : {}),
          }),
        });
        return await fetchPageDiagnostics(url, variant);
      } catch {}
      return data;
    };

    setPageDiagnosticsLoading(true);
    setPageDiagnostics(null);
    setPageDiagnosticsError(null);
    setPageErrorsModalOpen(false);
    fetchPageDiagnostics(url, variant)
      .then(async (data) => {
        const finalData = await autoValidateIfNeverRun(data);
        setPageDiagnostics(finalData);
        // Auto-open from store issues (canonical truth) — not a parallel live list
        const storeErrors = finalData.issues?.filter((i) => i.type === "error").length ?? 0;
        const storeWarnings = finalData.issues?.filter((i) => i.type === "warning").length ?? 0;
        const cachedErrors = finalData.cached?.errors?.length ?? 0;
        const cachedWarnings = finalData.cached?.warnings?.length ?? 0;
        if (storeErrors > 0 || storeWarnings > 0 || cachedErrors > 0 || cachedWarnings > 0) {
          setPageErrorsModalOpen(true);
        }
      })
      .catch((err) => {
        setPageDiagnosticsError(err instanceof Error ? err.message : "Failed to load diagnostics");
      })
      .finally(() => setPageDiagnosticsLoading(false));
  }, [pathname, isDebugMode, isValidated, contentInfo.type, contentInfo.slug, isPreviewPath]);

  const pageErrorCount = !pageDiagnostics
    ? 0
    : (pageDiagnostics.issues?.filter((i) => i.type === "error" && !i.completed).length || 0);

  const pageWarningCount = !pageDiagnostics
    ? 0
    : (pageDiagnostics.issues?.filter((i) => i.type === "warning" && !i.completed).length || 0);

  // Auto-enable edit mode after successful token validation
  useEffect(() => {
    // Detect when isValidated changes from false/null to true
    const wasValidated = prevIsValidatedRef.current;
    prevIsValidatedRef.current = isValidated;
    
    if (pendingAutoEditMode && isValidated === true && wasValidated !== true && !isLoading) {
      setPendingAutoEditMode(false);
      setTokenInput("");
      
      // Enable edit mode and navigate to preview when type+slug are known
      if (editMode && !editMode.isEditMode) {
        enterVisualEdit({
          contentType: contentInfo.type ?? undefined,
          slug: contentInfo.slug ?? undefined,
        });
      }
    }
  }, [isValidated, isLoading, pendingAutoEditMode, editMode, contentInfo, enterVisualEdit]);

  // Restore scroll after Edit ↔ Read navigations (public ↔ /private/preview)
  useEffect(() => {
    restoreEditModeScrollPosition();
  }, [pathname]);

  // Fetch sitemap URL count on mount
  useEffect(() => {
    fetch("/api/debug/sitemap-cache-status")
      .then((res) => res.json())
      .then((data) => {
        if (data.entryCount !== null && data.entryCount !== undefined) {
          setSitemapUrlCount(data.entryCount);
        }
      })
      .catch(() => {});
  }, []);

  // Fetch sitemap URLs when entering sitemap view
  useEffect(() => {
    if (menuView === "sitemap" && sitemapUrls.length === 0) {
      setSitemapLoading(true);
      fetch("/api/debug/sitemap-urls")
        .then((res) => res.json())
        .then((data) => {
          setSitemapUrls(data);
          setSitemapUrlCount(
            Array.isArray(data)
              ? data.filter((u: SitemapUrl) => u.inSitemap !== false).length
              : 0,
          );
          setSitemapLoading(false);
        })
        .catch(() => setSitemapLoading(false));
    }
    if (menuView !== "databases" && menuView !== "content-types") {
      fetch("/api/validation/cache-summary")
        .then((res) => res.json())
        .then((data) => setValidationSummary(data))
        .catch(() => {});
    }
  }, [menuView]);

  // Fetch redirects count on mount
  useEffect(() => {
    if (redirectsList.length === 0) {
      fetch("/api/debug/redirects")
        .then((res) => res.json())
        .then((data) => {
          setRedirectsList(data.redirects || []);
        })
        .catch(() => {});
    }
  }, []);

  // Fetch Breathecode host on mount
  useEffect(() => {
    fetch("/api/debug/breathecode-host")
      .then((res) => res.json())
      .then((data) => {
        setBreathecodeHost(data);
      })
      .catch(() => {});
  }, []);

  // ─── Site-switch cache invalidation ────────────────────────────────────────
  // When the active site changes, reset all site-scoped local state and
  // immediately re-fetch fresh data for the new site.
  //
  // WHY this is needed: several panels use direct fetch() + local state instead
  // of TanStack Query. queryClient.clear() (called in setDevSiteOverride /
  // clearDevSiteOverride) only flushes the TanStack Query cache. Guards like
  // `sitemapUrls.length === 0` and `!githubSyncStatus` prevent re-fetching
  // unless the state is explicitly reset here.
  //
  // DOMAIN TRACKING STRATEGY — track the last *defined* domain, not every
  // transition. queryClient.clear() causes siteInfo?.domain to pass through
  // `undefined` before the new domain resolves (oldDomain → undefined → newDomain).
  // Tracking every value (including undefined) would set the ref to undefined on
  // the middle step, then skip the reset when newDomain arrives because
  // prevDomain === undefined. Tracking only defined domains avoids this trap.
  const lastDefinedDomainRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    const newDomain = siteInfo?.domain;

    // Ignore transitional undefined states — they are caused by queryClient.clear()
    // and will be followed by the real new domain momentarily.
    if (newDomain === undefined) return;

    const prevDefinedDomain = lastDefinedDomainRef.current;
    lastDefinedDomainRef.current = newDomain;

    // Skip initial load (no previous defined domain) — mount effects already
    // fetched the correct data. Only act on real site switches.
    if (prevDefinedDomain === undefined || newDomain === prevDefinedDomain) return;

    // Reset all site-scoped local state.
    setSitemapUrlCount(null);
    setSitemapUrls([]);
    setSitemapSearch("");
    setRedirectsList([]);
    setBreathecodeHost(null);
    setGithubSyncStatus(null);
    setValidationSummary({});

    // Use a single AbortController so any in-flight responses from the previous
    // site are cancelled when the effect re-runs or when the component unmounts.
    // This prevents stale cross-site responses from overwriting fresh state.
    const ac = new AbortController();
    const { signal } = ac;

    // Re-fetch data that is always shown regardless of active view.
    fetch("/api/debug/sitemap-cache-status", { signal })
      .then((r) => r.json())
      .then((d) => { if (d.entryCount != null) setSitemapUrlCount(d.entryCount); })
      .catch(() => {});

    fetch("/api/debug/redirects", { signal })
      .then((r) => r.json())
      .then((d) => setRedirectsList(d.redirects || []))
      .catch(() => {});

    fetch("/api/debug/breathecode-host", { signal })
      .then((r) => r.json())
      .then((d) => setBreathecodeHost(d))
      .catch(() => {});

    // Re-fetch validation cache summary when it is visible.
    if (menuView !== "databases" && menuView !== "content-types") {
      fetch("/api/validation/cache-summary", { signal })
        .then((r) => r.json())
        .then((d) => setValidationSummary(d))
        .catch(() => {});
    }

    // Re-fetch sitemap URLs if the sitemap view is currently active.
    if (menuView === "sitemap") {
      setSitemapLoading(true);
      fetch("/api/debug/sitemap-urls", { signal })
        .then((r) => r.json())
        .then((d) => {
          setSitemapUrls(d);
          setSitemapUrlCount(
            Array.isArray(d)
              ? d.filter((u: SitemapUrl) => u.inSitemap !== false).length
              : 0,
          );
          setSitemapLoading(false);
        })
        .catch(() => setSitemapLoading(false));
    }

    // Re-fetch GitHub sync status if the main panel is currently open.
    if (open && menuView === "main") {
      setSyncStatusLoading(true);
      fetch("/api/github/sync-status", { signal })
        .then((r) => r.json())
        .then((d: GitHubSyncStatus) => {
          setGithubSyncStatus(d);
          setSyncStatusLoading(false);
        })
        .catch(() => setSyncStatusLoading(false));
    }

    return () => ac.abort();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteInfo?.domain]);

  // Listen for open-sync-modal event from SyncConflictBanner / Sync Log Force Push
  useEffect(() => {
    const handleOpenSyncModal = (event: Event) => {
      const detail = (event as CustomEvent<{ expandQueue?: boolean }>).detail;
      setCommitModalOpen(true);
      if (detail?.expandQueue) {
        setManualActionsOpen(true);
      }
      // Fetch pending changes when modal opens from banner / force-push
      setPendingChangesLoading(true);
      fetch(`/api/github/pending-changes?_t=${Date.now()}`)
        .then((res) => res.json())
        .then((data: { changes: PendingChange[]; count: number }) => {
          setPendingChanges(data.changes || []);
          setPendingChangesLoading(false);
        })
        .catch(() => {
          setPendingChanges([]);
          setPendingChangesLoading(false);
        });
    };
    window.addEventListener("open-sync-modal", handleOpenSyncModal);
    return () => {
      window.removeEventListener("open-sync-modal", handleOpenSyncModal);
    };
  }, []);

  useEffect(() => {
    const handleOpenDebugBubble = (event: Event) => {
      const view = (event as CustomEvent<{ view?: MenuView }>).detail?.view;
      setOpen(true);
      if (view) setMenuView(view);
    };
    window.addEventListener(OPEN_DEBUG_BUBBLE_EVENT, handleOpenDebugBubble);
    return () => {
      window.removeEventListener(OPEN_DEBUG_BUBBLE_EVENT, handleOpenDebugBubble);
    };
  }, []);

  // Fetch versioning data lazily after the browser is idle so it never
  // blocks critical rendering or affects Core Web Vitals.
  useEffect(() => {
    if (!contentInfo.type || !contentInfo.slug) return;

    const doFetch = () => {
      setVersioningLoading(true);
      fetch(`/api/versioning/${contentInfo.type}/${contentInfo.slug}`)
        .then((res) => res.json())
        .then((data: VersioningResponse) => {
          setVersioningData(data);
          setVersioningLoading(false);
        })
        .catch(() => {
          setVersioningLoading(false);
          setVersioningData(null);
        });
    };

    if (typeof requestIdleCallback !== "undefined") {
      const id = requestIdleCallback(doFetch, { timeout: 3000 });
      return () => cancelIdleCallback(id);
    } else {
      // Safari fallback
      const id = setTimeout(doFetch, 1000);
      return () => clearTimeout(id);
    }
  }, [contentInfo.type, contentInfo.slug]);

  // Re-fetch versioning data whenever a variant is created for the current page
  useEffect(() => {
    if (!contentInfo.type || !contentInfo.slug) return;
    return subscribeToVariantCreated((payload) => {
      if (payload.contentType !== contentInfo.type || payload.slug !== contentInfo.slug) return;
      setVersioningLoading(true);
      // Always GET with entry slug so detached is detected correctly
      fetch(`/api/versioning/${contentInfo.type}/${contentInfo.slug}`)
        .then((res) => res.json())
        .then((data: VersioningResponse) => {
          setVersioningData(data);
          setVersioningLoading(false);
        })
        .catch(() => {
          setVersioningLoading(false);
        });
    });
  }, [contentInfo.type, contentInfo.slug]);

  // Re-fetch versioning data whenever a variant is deleted for the current page
  useEffect(() => {
    if (!contentInfo.type || !contentInfo.slug) return;
    return subscribeToVariantDeleted((payload) => {
      if (payload.contentType !== contentInfo.type || payload.slug !== contentInfo.slug) return;
      setVersioningLoading(true);
      fetch(`/api/versioning/${contentInfo.type}/${contentInfo.slug}`)
        .then((res) => res.json())
        .then((data: VersioningResponse) => {
          setVersioningData(data);
          setVersioningLoading(false);
        })
        .catch(() => {
          setVersioningLoading(false);
        });
    });
  }, [contentInfo.type, contentInfo.slug]);

  // Re-fetch versioning data whenever a variant is promoted for the current page
  useEffect(() => {
    if (!contentInfo.type || !contentInfo.slug) return;
    return subscribeToVariantPromoted((payload) => {
      if (payload.contentType !== contentInfo.type || payload.slug !== contentInfo.slug) return;
      setVersioningLoading(true);
      fetch(`/api/versioning/${contentInfo.type}/${contentInfo.slug}`)
        .then((res) => res.json())
        .then((data: VersioningResponse) => {
          setVersioningData(data);
          setVersioningLoading(false);
        })
        .catch(() => {
          setVersioningLoading(false);
        });
    });
  }, [contentInfo.type, contentInfo.slug]);

  // Reset versioning data and menu view when leaving a content page
  useEffect(() => {
    if (!contentInfo.type) {
      setVersioningData(null);
      // Reset menu view to main if currently on versioning view
      if (menuView === "versioning") {
        setMenuView("main");
      }
    }
  }, [contentInfo.type, menuView]);

  // Fetch GitHub sync status on mount and when popover opens
  useEffect(() => {
    if (open && menuView === "main" && !githubSyncStatus && !syncStatusLoading) {
      setSyncStatusLoading(true);
      fetch("/api/github/sync-status")
        .then((res) => res.json())
        .then((data: GitHubSyncStatus) => {
          setGithubSyncStatus(data);
          setSyncStatusLoading(false);
        })
        .catch(() => {
          setSyncStatusLoading(false);
        });
    }
  }, [open, menuView]);

  useEffect(() => {
    if (!commitModalOpen) {
      setAutoCommitStatus(null);
      setAutoCommitCountdown(null);
      return;
    }
    
    const fetchStatus = () => {
      fetch('/api/github/auto-commit/status')
        .then(r => r.json())
        .then(data => setAutoCommitStatus(data))
        .catch(() => {});
    };
    
    fetchStatus();
    const interval = setInterval(fetchStatus, 2000);
    return () => clearInterval(interval);
  }, [commitModalOpen]);

  useEffect(() => {
    if (!commitModalOpen || !autoCommitStatus?.nextSyncAt) {
      setAutoCommitCountdown(null);
      return;
    }
    
    const tick = () => {
      const remaining = Math.max(0, Math.ceil((autoCommitStatus.nextSyncAt! - Date.now()) / 1000));
      setAutoCommitCountdown(remaining);
      if (remaining <= 0) {
        fetch('/api/github/auto-commit/status')
          .then(r => r.json())
          .then(data => setAutoCommitStatus(data))
          .catch(() => {});
        if (manualActionsOpen) {
          setPendingChangesLoading(true);
          fetch(`/api/github/pending-changes?_t=${Date.now()}`)
            .then((res) => res.json())
            .then((data: { changes: PendingChange[]; count: number }) => {
              setPendingChanges(data.changes || []);
              setPendingChangesLoading(false);
            })
            .catch(() => {
              setPendingChanges([]);
              setPendingChangesLoading(false);
            });
        }
      }
    };
    
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [commitModalOpen, autoCommitStatus?.nextSyncAt, manualActionsOpen]);

  // Function to refresh sync status
  const refreshSyncStatus = () => {
    setSyncStatusLoading(true);
    setGithubSyncStatus(null);
    fetch("/api/github/sync-status")
      .then((res) => res.json())
      .then((data: GitHubSyncStatus) => {
        setGithubSyncStatus(data);
        setSyncStatusLoading(false);
      })
      .catch(() => {
        setSyncStatusLoading(false);
      });
  };

  // Function to execute the actual sync (called after conflict check)
  const executeSyncFromRemote = async () => {
    setIsSyncing(true);
    try {
      const res = await fetch("/api/github/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (res.ok) {
        // Refresh sync status and pending changes before reload
        await refreshSyncStatus();
        if (syncContext) {
          syncContext.refreshSyncStatus();
        }
        window.location.reload();
      } else {
        setIsSyncing(false);
      }
    } catch {
      setIsSyncing(false);
    }
  };

  // Function to sync from remote (pull latest changes) - checks for conflicts first
  const handleSyncFromRemote = async () => {
    setIsSyncing(true);
    try {
      // Check for conflicts first
      const conflictRes = await fetch("/api/github/pull-conflicts");
      if (conflictRes.ok) {
        const conflictData = await conflictRes.json();
        if (conflictData.hasConflicts && conflictData.conflictingFiles.length > 0) {
          // Show conflict modal instead of pulling
          setPullConflictFiles(conflictData.conflictingFiles);
          setPullConflictModalOpen(true);
          setIsSyncing(false);
          return;
        }
      }
      // No conflicts, proceed with sync
      await executeSyncFromRemote();
    } catch {
      setIsSyncing(false);
    }
  };

  // Fetch pending changes when GitHub sync is enabled
  const fetchPendingChanges = () => {
    setPendingChangesLoading(true);
    fetch(`/api/github/pending-changes?_t=${Date.now()}`)
      .then((res) => res.json())
      .then((data: { changes: PendingChange[]; count: number }) => {
        setPendingChanges(data.changes || []);
        setPendingChangesLoading(false);
      })
      .catch(() => {
        setPendingChanges([]);
        setPendingChangesLoading(false);
      });
  };

  const handlePushAllLocal = async (commitMessage: string, files: string[]) => {
    setIsPushingAllLocal(true);
    setPushAllLocalError(null);
    try {
      const token = getDebugToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Token ${token}`;
      const res = await fetch('/api/github/commit', {
        method: 'POST',
        headers,
        body: JSON.stringify({ message: commitMessage, files, force: true }),
      });
      const data = await res.json();
      if (data.success) {
        fetchPendingChanges();
        refreshSyncStatus();
        setPushAllLocalError(null);
      } else {
        setPushAllLocalError(data.error || 'Failed to push changes');
      }
    } catch (e) {
      setPushAllLocalError(e instanceof Error ? e.message : 'Failed to push changes');
    } finally {
      setIsPushingAllLocal(false);
    }
  };

  const handleFlush = async () => {
    setIsFlushing(true);
    try {
      const token = getDebugToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Token ${token}`;
      await fetch('/api/github/auto-commit/flush', { method: 'POST', headers });
      const res = await fetch('/api/github/auto-commit/status');
      const data = await res.json();
      setAutoCommitStatus(data);
      fetchPendingChanges();
    } catch (e) {
      console.error('Flush failed:', e);
    } finally {
      setIsFlushing(false);
    }
  };

  const handleClearConflict = async (filePath: string) => {
    try {
      const token = getDebugToken();
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = `Token ${token}`;
      await fetch('/api/github/auto-commit/clear-conflict', {
        method: 'POST',
        headers,
        body: JSON.stringify({ filePath }),
      });
      const res = await fetch('/api/github/auto-commit/status');
      const data = await res.json();
      setAutoCommitStatus(data);
    } catch (e) {
      console.error('Clear conflict failed:', e);
    }
  };

  // Handle session check (validates without clearing cache first)
  const fetchSeoPreview = async () => {  // eslint-disable-next-line react-hooks/exhaustive-deps
    if (!contentInfo.type || !contentInfo.slug) return;
    setSeoLoading(true);
    setSeoData(null);
    try {
      const urlLocale = getEffectiveLocale();
      const locale = normalizeLocale(urlLocale || i18n.language);
      const apiContentType = contentTypesMap ? getFolderFromType(contentTypesMap, contentInfo.type) : contentInfo.type;
      const params = new URLSearchParams({ locale });
      const urlVariant = getUrlVariant();
      if (urlVariant) params.set("variant", urlVariant);
      const res = await fetch(`/api/seo-preview/${apiContentType}/${contentInfo.slug}?${params}`);
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error((errData as { error?: string }).error || "Failed to fetch SEO data");
      }
      const data = await res.json();
      setSeoData(data);
      const nextMeta: SeoMeta = {
        page_title: (data.meta?.page_title as string) || "",
        description: (data.meta?.description as string) || "",
        og_image: (data.meta?.og_image as string) || "",
        canonical_url: (data.meta?.canonical_url as string) || "",
        robots: (data.meta?.robots as string) || "",
        priority: data.meta?.priority != null ? String(data.meta.priority) : "",
        change_frequency: (data.meta?.change_frequency as string) || "",
        redirects: ((data.meta?.redirects as Array<string | { path: string; status?: number }>) || [])
          .map((r) => (typeof r === "string" ? r : r?.path))
          .filter((r): r is string => Boolean(r)),
      };
      seoBaselineMetaRef.current = nextMeta;
      setSeoMeta(nextMeta);
      setSeoDirtyKeys(new Set());
      const loadedLocations = (data.locations as string[]) || [];
      seoBaselineLocationsRef.current = [...loadedLocations];
      setLocationsBaseline([...loadedLocations]);
      setSeoLocations(loadedLocations);
      setSeoAvailableLocations((data.availableLocations as Array<{ slug: string; name: string; city: string; country: string }>) || []);
      setSeoLocationSearch("");
    } catch (error) {
      console.error("Error fetching SEO preview:", error);
      toast({
        title: "Failed to load SEO data",
        description: error instanceof Error ? error.message : "Could not fetch page SEO information.",
        variant: "destructive",
      });
    } finally {
      setSeoLoading(false);
    }
  };

  const getEffectiveLocale = (): string => {
    if (pathname.startsWith("/private/preview/")) {
      const qLocale = new URLSearchParams(window.location.search).get("locale");
      if (qLocale) return qLocale;
    }
    const seg = pathname.split("/").filter(Boolean)[0];
    if (seg && /^[a-z]{2}$/.test(seg)) return seg;
    return pageDiagnostics?.locale || i18n.language || "en";
  };

  const currentLocaleSlug = (seoData?.slug as string) || contentInfo.slug || "";

  useEffect(() => {
    if (!newSlugValue || !contentInfo.type || newSlugValue === currentLocaleSlug) {
      setSlugCheckStatus("idle");
      setSlugCheckReason(null);
      return;
    }
    const slugRegex = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
    if (!slugRegex.test(newSlugValue)) {
      setSlugCheckStatus("taken");
      setSlugCheckReason("Use only lowercase letters, numbers, and hyphens");
      return;
    }
    setSlugCheckStatus("available");
    setSlugCheckReason(null);
  }, [newSlugValue, contentInfo.type, currentLocaleSlug]);

  const handleSlugRename = async (createRedirect: boolean) => {
    if (!contentInfo.type || !contentInfo.slug || !newSlugValue || slugCheckStatus !== "available") return;
    setSlugRenaming(true);
    setSlugRedirectPrompt(false);
    try {
      const apiType = contentInfo.type;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      const token = getDebugToken();
      if (token) headers["X-Debug-Token"] = token;
      const urlLocale = getEffectiveLocale();
      const res = await fetch("/api/content/rename-slug", {
        method: "POST",
        headers,
        body: JSON.stringify({
          contentType: apiType,
          folderSlug: contentInfo.slug,
          locale: urlLocale,
          newSlug: newSlugValue,
          createRedirect,
        }),
      });
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.error || "Failed to rename");
      }
      const result = await res.json();
      toast({
        title: "Slug renamed",
        description: `${result.oldSlug} → ${result.newSlug}${createRedirect ? " (redirect created)" : ""}`,
      });
      setSeoModalOpen(false);
      setNewSlugValue("");
      const isPreview = pathname.startsWith("/private/preview/");
      if (isPreview) {
        const search = window.location.search;
        window.location.href = `/private/preview/${contentInfo.type}/${contentInfo.slug}${search}`;
      } else if (result.newUrl) {
        window.location.href = result.newUrl;
      } else {
        window.location.reload();
      }
    } catch (error) {
      toast({
        title: "Failed to rename slug",
        description: error instanceof Error ? error.message : "Could not rename content slug.",
        variant: "destructive",
      });
    } finally {
      setSlugRenaming(false);
    }
  };

  const handleSlugRenameClick = () => {
    if (!contentInfo.type || !contentInfo.slug || slugCheckStatus !== "available") return;
    const apiType = contentInfo.type;
    const urlLocale = getEffectiveLocale() || "en";
    const pattern = contentTypesMap?.[apiType]?.url_pattern;
    setSlugOldUrl(buildContentUrlFromPattern(pattern, currentLocaleSlug, urlLocale));
    setSlugNewUrl(buildContentUrlFromPattern(pattern, newSlugValue, urlLocale));
    setSlugRedirectPrompt(true);
  };

  const debugSeoLocale = normalizeLocale(getEffectiveLocale() || i18n.language);
  const debugSeoContext =
    seoData?.context ?? (getUrlVariant() ? "variant" : "live");
  const debugSeoVariant = seoData?.variant ?? getUrlVariant();
  const debugMetaOverrides = Array.isArray(seoData?.metaOverrides)
    ? seoData!.metaOverrides!
    : [];

  const seoSaves = useSeoModalSaves({
    contentType: contentInfo.type,
    slug: contentInfo.slug,
    locale: debugSeoLocale,
    seoContext: debugSeoContext,
    seoVariant: debugSeoVariant,
    seoMeta,
    setSeoMeta,
    dirtyKeys: seoDirtyKeys,
    setDirtyKeys: setSeoDirtyKeys,
    baselineMetaRef: seoBaselineMetaRef,
    baselineLocationsRef: seoBaselineLocationsRef,
    seoData,
    metaOverrides: debugMetaOverrides,
    refetch: fetchSeoPreview,
  });

  const handleCheckSession = async () => {
    setIsCheckingSession(true);
    try {
      const result = await checkSession();
      if (result.valid) {
        toast({
          title: "Session valid",
          description: "Your authentication is still active.",
        });
      } else if (result.networkError) {
        // Network error - session not cleared, just inform user
        toast({
          title: "Network error",
          description: "Could not reach server to verify session. Try again later.",
          variant: "destructive",
        });
      } else if (result.expired) {
        toast({
          title: "Session expired",
          description: "Please log in again.",
          variant: "destructive",
        });
      } else {
        toast({
          title: "Session invalid",
          description: "Please log in again.",
          variant: "destructive",
        });
      }
    } catch {
      toast({
        title: "Check failed",
        description: "Could not verify session.",
        variant: "destructive",
      });
    } finally {
      setIsCheckingSession(false);
    }
  };

  // Fetch pending changes when sync status indicates sync is enabled
  useEffect(() => {
    if (githubSyncStatus?.syncEnabled) {
      fetchPendingChanges();
    }
  }, [githubSyncStatus?.syncEnabled]);

  // Listen for content updates to refresh pending changes immediately
  useEffect(() => {
    const unsubscribe = subscribeToContentUpdates(() => {
      // Refresh pending changes when any content is updated
      if (!githubSyncStatus) {
        // Fetch sync status first, which will trigger pending changes fetch
        fetch("/api/github/sync-status")
          .then((res) => res.json())
          .then((data: GitHubSyncStatus) => {
            setGithubSyncStatus(data);
            if (data.syncEnabled) {
              fetchPendingChanges();
            }
          })
          .catch(() => {});
      } else if (githubSyncStatus.syncEnabled) {
        fetchPendingChanges();
      }
    });

    return unsubscribe;
  }, [githubSyncStatus]);

  // Handle commit
  const handleCommit = async () => {
    if (!commitMessage.trim()) return;
    if (githubConnectRequired) {
      alert(
        "Connect GitHub to commit content in production. Use Connect on the GitHub sync chip.",
      );
      return;
    }

    setIsCommitting(true);
    try {
      const forceCommit = syncContext?.forceCommitEnabled || false;
      const author = await resolveAuthorName();
      const res = await fetch("/api/github/commit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getSessionHeaders(),
        },
        credentials: "include",
        body: JSON.stringify({ 
          message: commitMessage.trim(),
          force: forceCommit,
          author,
        }),
      });
      
      const data = await res.json();
      
      if (data.success) {
        setCommitModalOpen(false);
        setCommitMessage("");
        setPendingChanges([]);
        refreshSyncStatus();
        if (syncContext) {
          syncContext.refreshSyncStatus();
          syncContext.syncWithRemote();
        }
      } else {
        alert(data.error || "Failed to commit changes");
      }
    } catch (error) {
      alert("Failed to commit changes");
    } finally {
      setIsCommitting(false);
    }
  };

  // Handle per-file commit
  const handleFileCommit = async (filePath: string) => {
    if (!fileCommitMessage.trim()) return;
    if (githubConnectRequired) {
      alert(
        "Connect GitHub to commit content in production. Use Connect on the GitHub sync chip.",
      );
      return;
    }

    setFileCommitting(filePath);
    try {
      const author = await resolveAuthorName();
      const res = await fetch("/api/github/commit-file", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...getSessionHeaders(),
        },
        credentials: "include",
        body: JSON.stringify({ 
          filePath,
          message: fileCommitMessage.trim(),
          author,
        }),
      });
      
      const data = await res.json();
      
      if (data.success) {
        // Remove committed file from pending changes
        const remainingChanges = pendingChanges.filter(c => c.file !== filePath);
        setPendingChanges(remainingChanges);
        setSelectedFileForCommit(null);
        setFileCommitMessage("");
        
        // If all pending changes are resolved, sync with remote to update lastSyncedCommit
        if (remainingChanges.length === 0) {
          try {
            await fetch("/api/github/sync-with-remote", { method: "POST" });
          } catch {
            // Silently fail - sync status will still be refreshed
          }
        }
        
        refreshSyncStatus();
        if (syncContext) {
          syncContext.refreshSyncStatus();
        }
      } else {
        alert(data.error || "Failed to commit file");
      }
    } catch {
      alert("Failed to commit file");
    } finally {
      setFileCommitting(null);
    }
  };

  // Handle per-file pull
  const handleFilePull = async (filePath: string) => {
    setFilePulling(filePath);
    try {
      const res = await fetch("/api/github/pull-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filePath }),
      });
      
      const data = await res.json();
      
      if (data.success) {
        // Remove file from pending changes (now synced)
        const remainingChanges = pendingChanges.filter(c => c.file !== filePath);
        setPendingChanges(remainingChanges);
        setConfirmPullFile(null);
        
        // If all pending changes are resolved, sync with remote to update lastSyncedCommit
        if (remainingChanges.length === 0) {
          try {
            await fetch("/api/github/sync-with-remote", { method: "POST" });
          } catch {
            // Silently fail - sync status will still be refreshed
          }
        }
        
        refreshSyncStatus();
        if (syncContext) {
          syncContext.refreshSyncStatus();
        }
      } else {
        alert(data.error || "Failed to pull file");
      }
    } catch {
      alert("Failed to pull file");
    } finally {
      setFilePulling(null);
    }
  };

  // Handle ignore all local changes - reset to remote state
  const handleIgnoreAllChanges = async () => {
    const localChanges = pendingChanges.filter(c => c.source === 'local' || c.source === 'conflict');
    if (localChanges.length === 0) return;
    
    const confirmed = window.confirm(
      `This will erase all changes you have made to Marketing Content YAMLs (${localChanges.length} file${localChanges.length > 1 ? 's' : ''}). This cannot be undone. Continue?`
    );
    if (!confirmed) return;
    
    setIsIgnoringAllChanges(true);
    try {
      // Pull each file with local changes from remote
      for (const change of localChanges) {
        const res = await fetch("/api/github/pull-file", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filePath: change.file }),
        });
        
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || `Failed to reset ${change.file}`);
        }
      }
      
      // Clear pending changes and refresh
      setPendingChanges(pendingChanges.filter(c => c.source !== 'local' && c.source !== 'conflict'));
      setAdvancedOptionsOpen(false);
      
      // Sync with remote to update status
      try {
        await fetch("/api/github/sync-with-remote", { method: "POST" });
      } catch {
        // Silently fail
      }
      
      refreshSyncStatus();
      if (syncContext) {
        syncContext.refreshSyncStatus();
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : "Failed to ignore local changes");
    } finally {
      setIsIgnoringAllChanges(false);
    }
  };

  // Handle popover open/close - reset search but preserve menu view
  const handleOpenChange = (newOpen: boolean) => {
    setOpen(newOpen);
    if (!newOpen) {
      setSitemapSearch("");
      setShowSitemapSearch(false);
      setSitemapPresenceFilter("all");
    }
  };

  // Filter sitemap URLs by search + optional in/out of sitemap presence
  const filteredSitemapUrls = sitemapUrls.filter((url) => {
    const matchesSearch =
      url.label.toLowerCase().includes(sitemapSearch.toLowerCase()) ||
      url.loc.toLowerCase().includes(sitemapSearch.toLowerCase());
    if (!matchesSearch) return false;
    if (sitemapPresenceFilter === "not-in-sitemap") return url.inSitemap === false;
    if (sitemapPresenceFilter === "in-sitemap") return url.inSitemap !== false;
    return true;
  });

  // Group sitemap URLs into nested folders based on URL path structure
  interface SitemapFolder {
    name: string;
    path: string; // Full path to this folder level
    urls: SitemapUrl[]; // URLs that terminate at this folder level
    subfolders: SitemapFolder[];
    contentType?: string;
  }

  const groupedSitemapUrls = (): { folders: SitemapFolder[]; rootUrls: SitemapUrl[] } => {
    const rootUrls: SitemapUrl[] = [];
    const folderMap = new Map<string, SitemapFolder>();

    filteredSitemapUrls.forEach((url) => {
      let path: string;
      try {
        path = new URL(url.loc).pathname;
      } catch {
        rootUrls.push(url);
        return;
      }
      const segments = path.split('/').filter(Boolean);
      
      // Root level pages (e.g., "/", "/about")
      if (segments.length <= 1) {
        rootUrls.push(url);
        return;
      }

      // Build folder path from all segments except the last (the page)
      const folderSegments = segments.slice(0, -1);
      const folderPath = '/' + folderSegments.join('/');
      
      // Create or get the folder
      if (!folderMap.has(folderPath)) {
        folderMap.set(folderPath, {
          name: folderSegments.join('/'),
          path: folderPath,
          urls: [],
          subfolders: [],
        });
      }
      
      folderMap.get(folderPath)!.urls.push(url);
    });

    // Convert map to sorted array
    const folders = Array.from(folderMap.values()).sort((a, b) => 
      a.path.localeCompare(b.path)
    );

    for (const folder of folders) {
      const consensus = consensusSitemapContentType(folder.urls);
      const type = contentTypeForSitemapFolder(folder.path, contentTypesMap, consensus);
      if (type) folder.contentType = type;
    }

    return { folders, rootUrls };
  };

  const { folders, rootUrls } = groupedSitemapUrls();

  // When filtering by sitemap presence, expand folders so matches are visible
  useEffect(() => {
    if (sitemapPresenceFilter === "all") return;
    setExpandedFolders(new Set(folders.map((f) => f.name)));
    // Only re-expand when the filter mode changes (not on every folders recalculation)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: fold on filter toggle only
  }, [sitemapPresenceFilter]);

  const toggleFolder = (folderName: string) => {
    setExpandedFolders((prev) => {
      const next = new Set(prev);
      if (next.has(folderName)) {
        next.delete(folderName);
      } else {
        next.add(folderName);
      }
      return next;
    });
  };

  // Only show bubble if debug mode is active
  // In dev: always active
  // In production: requires ?debug=true in URL
  if (!isDebugMode) {
    return null;
  }
  
  // Wait for loading to complete
  if (isLoading) {
    return null;
  }
  
  // Token states for different warning scenarios
  const noTokenDetected = !hasToken;
  const tokenWithoutCapabilities = hasToken && isValidated === false;
  const hasCommitIndicator =
    githubSyncStatus?.syncEnabled &&
    pendingChanges.some((c) => c.source === "local" || c.source === "conflict") &&
    !noTokenDetected &&
    !tokenWithoutCapabilities;
  const hasSystemAlerts =
    (criticalAlerts.length > 0 || githubConnectCritical) &&
    !noTokenDetected &&
    !tokenWithoutCapabilities;
  const pillTop = (index: number) => (index === 0 ? "-0.25rem" : `${index * 1.5}rem`);

  const toggleTheme = () => {
    const newTheme = theme === "light" ? "dark" : "light";
    setTheme(newTheme);
    if (newTheme === "dark") {
      document.documentElement.classList.add("dark");
    } else {
      document.documentElement.classList.remove("dark");
    }
    localStorage.setItem("theme", newTheme);
  };

  const toggleLanguage = () => {
    const newLang = i18n.language === "en" ? "es" : "en";
    i18n.changeLanguage(newLang);
  };

  const currentLang = i18n.language === "es" ? "ES" : "EN";

  const handleDuplicatePage = (url: SitemapUrl) => {
    const path = new URL(url.loc).pathname;
    const info = detectContentInfo(path, contentTypesMap);
    if (info.type && info.slug) {
      // Always pass sourceSlug so draft preview URLs (/private/preview/...) still
      // duplicate folder YAML — sourceUrl alone only resolves live public patterns.
      setDuplicatingPage({
        loc: url.loc,
        label: url.label,
        contentType: info.type,
        locale: url.locale,
        sourceSlug: info.slug,
        isDraft: !!url.isDraft,
      });
      setCreateContentType(info.type);
      setCreateContentTitle("");
      setCreateContentSlugEn("");
      setCreateContentSlugEs("");
      setCreateContentSlugEnStatus('idle');
      setCreateContentSlugEsStatus('idle');
      setSlugEnConflictReason(null);
      setSlugEsConflictReason(null);
      setCreateContentModalOpen(true);
    } else {
      toast({ title: "Cannot duplicate", description: "Unrecognized content type", variant: "destructive" });
    }
  };

  const handleDeletePage = (url: SitemapUrl) => {
    const urlPath = new URL(url.loc).pathname;
    const info = detectContentInfo(urlPath, contentTypesMap);
    if (!info.type || !info.slug) {
      toast({ title: "Cannot delete", description: "Unrecognized content type", variant: "destructive" });
      return;
    }
    const pathLocale = urlPath.startsWith('/es/') ? 'es' : urlPath.startsWith('/en/') ? 'en' : 'en';
    setDeletingPage({ slug: info.slug, contentType: info.type, locale: pathLocale });
    setDeleteConfirmInput("");
    setDeletePageModalOpen(true);
  };

  const handleDownloadYml = async (url: SitemapUrl) => {
    const urlPath = new URL(url.loc).pathname;
    const parts = urlPath.split('/').filter(Boolean);
    const hasLocale = parts[0] === 'en' || parts[0] === 'es';
    const contentParts = hasLocale ? parts.slice(1) : parts;
    const slug = contentParts.length === 0 ? 'home' : contentParts[contentParts.length - 1];
    if (!slug) {
      toast({ title: "Cannot download", description: "Could not determine slug from URL", variant: "destructive" });
      return;
    }
    const token = getDebugToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Token ${token}`;

    try {
      const resolveRes = await fetch(`/api/content/resolve-folder?slug=${encodeURIComponent(slug)}`, { headers });
      if (!resolveRes.ok) {
        toast({ title: "No YAML found", description: `This page has no YAML content files (code-only route)` });
        return;
      }
      const resolveData = await resolveRes.json();

      const entries: { directory: string; files: string[]; title?: string; contentType: string }[] = resolveData.multiple
        ? resolveData.matches
        : [resolveData];

      let downloadedCount = 0;
      for (const entry of entries) {
        for (const filename of entry.files) {
          try {
            const res = await fetch(`/api/content/file?path=${encodeURIComponent(`${entry.directory}/${filename}`)}`, { headers });
            if (!res.ok) continue;
            const text = await res.text();
            const blob = new Blob([text], { type: 'text/yaml' });
            const blobUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = blobUrl;
            a.download = entries.length > 1 ? `${entry.contentType}-${slug}-${filename}` : `${slug}-${filename}`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(blobUrl);
            downloadedCount++;
          } catch {}
        }
      }
      if (downloadedCount > 0) {
        toast({ title: "Download complete", description: `Downloaded ${downloadedCount} YAML file(s) for "${slug}"` });
      } else {
        toast({ title: "No files found", description: `No YAML files could be downloaded for "${slug}"`, variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Download failed", description: "An error occurred while downloading", variant: "destructive" });
    }
  };

  const handleRefreshCache = async (url: SitemapUrl) => {
    try {
      const token = getDebugToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Token ${token}`;
      const res = await fetch("/api/debug/clear-page-cache", {
        method: "POST",
        headers,
        body: JSON.stringify({ url: url.loc }),
      });
      const data = await res.json();
      if (res.ok) {
        toast({ title: "Cache refreshed", description: data.message || url.loc, duration: 3000 });
      } else {
        toast({ title: "Failed to refresh cache", description: data.error || "Unknown error", variant: "destructive" });
      }
    } catch {
      toast({ title: "Failed to refresh cache", description: "Network error", variant: "destructive" });
    }
  };

  const handleEditYaml = async (url: SitemapUrl) => {
    const urlPath = new URL(url.loc).pathname;
    const info = detectContentInfo(urlPath, contentTypesMap);
    if (!info.type || !info.slug) {
      toast({ title: "Cannot edit YAML", description: "Unrecognized content type", variant: "destructive" });
      return;
    }
    const pathLocale = url.locale || (urlPath.startsWith('/es/') ? 'es' : urlPath.startsWith('/en/') ? 'en' : 'en');
    const token = getDebugToken();
    const headers: Record<string, string> = {};
    if (token) headers["Authorization"] = `Token ${token}`;
    try {
      const res = await fetch(`/api/content/raw-file?contentType=${encodeURIComponent(info.type)}&slug=${encodeURIComponent(info.slug)}&locale=${encodeURIComponent(pathLocale)}`, { headers });
      if (!res.ok) {
        toast({ title: "No YAML found", description: "This page has no YAML content files", variant: "destructive" });
        return;
      }
      const data = await res.json();
      if (!data.exists) {
        toast({ title: "No YAML found", description: "This page has no YAML content files", variant: "destructive" });
        return;
      }
      setYamlEditorInfo({ contentType: info.type, slug: info.slug, locale: pathLocale });
      setShowYamlEditor(true);
      navigate(urlPath);
      if (editMode && !editMode.isEditMode) {
        editMode.toggleEditMode();
      }
    } catch {
      toast({ title: "Error", description: "Failed to check YAML files", variant: "destructive" });
    }
  };

  const handleEditPageMeta = (url: SitemapUrl) => {
    const urlPath = new URL(url.loc).pathname;
    const info = detectContentInfo(urlPath, contentTypesMap);
    const type = url.content_type || info.type;
    const slug = url.slug || info.slug;
    if (!type || !slug) {
      toast({ title: "Cannot edit page meta", description: "Unrecognized content type", variant: "destructive" });
      return;
    }
    const pathLocale =
      url.locale || (urlPath.startsWith("/es/") ? "es" : urlPath.startsWith("/en/") ? "en" : "en");
    setManagedSeoModalTarget({ contentType: type, slug, locale: pathLocale });
    setManagedSeoModalOpen(true);
  };

  const handleOpenDiagnosticsForUrl = async (urlPath: string) => {
    lastDiagnosticsUrlRef.current = urlPath;
    setPageDiagnosticsLoading(true);
    setPageDiagnostics(null);
    setPageDiagnosticsError(null);
    setPageErrorsModalOpen(true);
    try {
      const data = await fetchPageDiagnostics(urlPath, getUrlVariant() ?? null);
      setPageDiagnostics(data);
    } catch (err) {
      setPageDiagnosticsError(err instanceof Error ? err.message : "Failed to load diagnostics");
    } finally {
      setPageDiagnosticsLoading(false);
    }
  };

  const confirmDeletePage = async (localesToDelete: string[]) => {
    if (!deletingPage || deleteConfirmInput !== deletingPage.slug) return;
    setIsDeletingPage(true);
    try {
      const token = getDebugToken();
      const author = await resolveAuthorName();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Token ${token}`;
      const response = await fetch("/api/content/delete", {
        method: "POST",
        headers,
        body: JSON.stringify({
          type: deletingPage.contentType,
          slug: deletingPage.slug,
          confirmSlug: deleteConfirmInput,
          author,
          ...(localesToDelete.length > 0 ? { localesToDelete } : {}),
        }),
      });
      const data = await response.json();
      if (response.ok) {
        toast({ title: "Page deleted", description: data.message });
        setDeletePageModalOpen(false);
        setDeletingPage(null);
        setDeleteConfirmInput("");
        const sitemapRes = await fetch("/api/debug/sitemap-urls");
        if (sitemapRes.ok) {
          const sitemapData = await sitemapRes.json();
          setSitemapUrls(sitemapData);
        }
      } else {
        toast({ title: "Error", description: data.error || "Failed to delete", variant: "destructive" });
      }
    } catch (error) {
      toast({ title: "Error", description: "Connection error", variant: "destructive" });
    } finally {
      setIsDeletingPage(false);
    }
  };

  const clearSitemapCache = async () => {
    setCacheClearStatus("loading");
    try {
      const token = getDebugToken();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };
      if (token) {
        headers["Authorization"] = `Token ${token}`;
      }

      const response = await fetch("/api/debug/clear-sitemap-cache", {
        method: "POST",
        headers,
      });

      if (response.ok) {
        setCacheClearStatus("success");
        setTimeout(() => setCacheClearStatus("idle"), 2000);
        const freshRes = await fetch("/api/debug/sitemap-urls");
        if (freshRes.ok) {
          const freshData = await freshRes.json();
          setSitemapUrls(freshData);
          setSitemapUrlCount(
            Array.isArray(freshData)
              ? freshData.filter((u: SitemapUrl) => u.inSitemap !== false).length
              : 0,
          );
        }
      } else {
        console.error("Failed to clear sitemap cache");
        setCacheClearStatus("idle");
      }
    } catch (error) {
      console.error("Error clearing sitemap cache:", error);
      setCacheClearStatus("idle");
    }
  };


  const refreshVersioning = () => {
    if (!contentInfo.type || !contentInfo.slug) return;
    setVersioningLoading(true);
    // Always GET with the entry slug so detached status is returned correctly
    fetch(`/api/versioning/${contentInfo.type}/${contentInfo.slug}`)
      .then((res) => res.json())
      .then((data: VersioningResponse) => {
        setVersioningData(data);
        setVersioningLoading(false);
      })
      .catch(() => {
        setVersioningLoading(false);
      });
  };

  const handleDetachEntry = async () => {
    if (!contentInfo.type || !contentInfo.slug || detachBusy) return;
    setDetachBusy(true);
    try {
      const token = getDebugToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Token ${token}`;
      const res = await fetch(`/api/content/${contentInfo.type}/${contentInfo.slug}/detach`, {
        method: "POST",
        headers,
        body: "{}",
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: data.error || "Failed to detach entry", variant: "destructive" });
        return;
      }
      toast({ title: "Entry detached", description: "This page now owns its own structure and Page Versions." });
      refreshVersioning();
      queryClient.invalidateQueries();
    } catch {
      toast({ title: "Failed to detach entry", variant: "destructive" });
    } finally {
      setDetachBusy(false);
    }
  };

  const handleReattachEntry = async () => {
    if (!contentInfo.type || !contentInfo.slug || detachBusy) return;
    setDetachBusy(true);
    try {
      const token = getDebugToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Token ${token}`;
      const res = await fetch(`/api/content/${contentInfo.type}/${contentInfo.slug}/reattach`, {
        method: "POST",
        headers,
        body: JSON.stringify({ confirm: true }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const missing = Array.isArray(data.missing_fields)
          ? (data.missing_fields as string[]).join(", ")
          : "";
        toast({
          title:
            data.code === "reattach_missing_required_fields"
              ? "Cannot re-attach — required fields missing"
              : "Failed to re-attach entry",
          description: [data.error, missing ? `Missing: ${missing}` : ""]
            .filter(Boolean)
            .join("\n"),
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Entry re-attached",
        description: data.hadTrafficVariants
          ? "Custom structure removed. Entry variants with traffic were also cleared."
          : "This entry uses the shared template again.",
      });
      refreshVersioning();
      queryClient.invalidateQueries();
    } catch {
      toast({ title: "Failed to re-attach entry", variant: "destructive" });
    } finally {
      setDetachBusy(false);
    }
  };

  const panelContentProps = {
    noTokenDetected,
    tokenWithoutCapabilities,
    hasToken,
    tokenInput,
    setTokenInput,
    setPendingAutoEditMode,
    validateManualToken,
    isLoading,
    breathecodeHost,
    retryValidation,
    clearToken,
    githubSyncStatus,
    pendingChanges,
    pendingChangesLoading,
    syncStatusLoading,
    refreshSyncStatus,
    fetchPendingChanges,
    setCommitModalOpen,
    contentInfo,
    editMode,
    pathname,
    navigate,
    setSeoModalOpen,
    fetchSeoPreview,
    menuView,
    setMenuView,
    sitemapExpanded,
    setSitemapExpanded,
    componentsExpanded,
    setComponentsExpanded,
    aiAgentsExpanded,
    setAiAgentsExpanded,
    cacheClearStatus,
    clearSitemapCache,
    sitemapUrlCount,
    redirectsList,
    componentSearch,
    setComponentSearch,
    showComponentSearch,
    setShowComponentSearch,
    filteredComponents,
    componentRegistryData,
    componentIconMap,
    siteInfo,
    versioningLoading,
    versioningData,
    onVersioningDataUpdate: setVersioningData,
    pageIsSharedLayout,
    pageIsDetached,
    detachBusy,
    onDetachEntry: handleDetachEntry,
    onReattachEntry: handleReattachEntry,
    onEditVariantYaml: (locale: string, variantSlug: string) => {
      if (!contentInfo.type || !contentInfo.slug) return;
      const isPreview = pathname.startsWith("/private/preview/");
      const currentVariant = typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("variant")
        : null;
      if (!isPreview || currentVariant !== variantSlug) {
        navigate(`/private/preview/${contentInfo.type}/${contentInfo.slug}?variant=${encodeURIComponent(variantSlug)}&locale=${locale}`);
      }
      // Shared-layout template variants live at the type root; raw editor uses `_common.single`.
      const editorSlug =
        versioningData?.isSharedLayout && !versioningData?.detached
          ? "_common.single"
          : contentInfo.slug;
      setYamlEditorInfo({ contentType: contentInfo.type, slug: editorSlug, locale, variantSlug });
      setShowYamlEditor(true);
    },
    onEditDefaultYaml: (locale: string) => {
      if (!contentInfo.type || !contentInfo.slug) return;
      const isPreview = pathname.startsWith("/private/preview/");
      const currentVariant = typeof window !== "undefined"
        ? new URLSearchParams(window.location.search).get("variant")
        : null;
      if (!isPreview || currentVariant) {
        navigate(`/private/preview/${contentInfo.type}/${contentInfo.slug}?locale=${locale}`);
      }
      const editorSlug =
        versioningData?.isSharedLayout && !versioningData?.detached
          ? "_common.single"
          : contentInfo.slug;
      setYamlEditorInfo({ contentType: contentInfo.type, slug: editorSlug, locale });
      setShowYamlEditor(true);
    },
    onRequestDeletePage: ({ locale, liveLocales }: { locale: string; liveLocales: string[] }) => {
      if (!contentInfo.type || !contentInfo.slug) return;
      setDeletingPage({
        slug: contentInfo.slug,
        contentType: contentInfo.type,
        locale,
        availableLocales: liveLocales,
      });
      setDeleteConfirmInput("");
      setDeletePageModalOpen(true);
    },
    onOpenTemplateYaml: async () => {
      if (!contentInfo.type) return;
      const locale =
        (typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get("locale")
          : null) ||
        pageDiagnostics?.locale ||
        i18n.language ||
        "en";
      const token = getDebugToken();
      const headers: Record<string, string> = {};
      if (token) headers["Authorization"] = `Token ${token}`;
      try {
        const res = await fetch(
          `/api/content/raw-file?contentType=${encodeURIComponent(contentInfo.type)}&slug=${encodeURIComponent("_common.single")}&locale=${encodeURIComponent(normalizeLocale(locale))}`,
          { headers },
        );
        if (!res.ok) {
          toast({
            title: "No template found",
            description: "This content type has no _common.single.yml (or single.*.yml) yet.",
            variant: "destructive",
          });
          return;
        }
        const data = await res.json();
        if (!data.exists) {
          toast({
            title: "No template found",
            description: "This content type has no _common.single.yml (or single.*.yml) yet.",
            variant: "destructive",
          });
          return;
        }
        setYamlEditorInfo({
          contentType: contentInfo.type,
          slug: "_common.single",
          locale: normalizeLocale(locale),
          readOnly: true,
        });
        setShowYamlEditor(true);
      } catch {
        toast({ title: "Error", description: "Failed to open the template YAML", variant: "destructive" });
      }
    },
    handleLinkClick,
    sitemapUrls,
    sitemapLoading,
    sitemapSearch,
    setSitemapSearch,
    showSitemapSearch,
    setShowSitemapSearch,
    sitemapPresenceFilter,
    setSitemapPresenceFilter,
    filteredSitemapUrls,
    folders,
    rootUrls,
    expandedFolders,
    toggleFolder,
    setCreateContentModalOpen,
    handleDuplicatePage,
    handleDeletePage,
    handleDownloadYml,
    handleEditYaml,
    handleEditPageMeta,
    onEditContentTypesYml: () => setShowContentTypesYmlEditor(true),
    handleRefreshCache,
    validationSummary,
    onOpenDiagnosticsForUrl: handleOpenDiagnosticsForUrl,
    contentLocale: pageDiagnostics?.locale || null,
    currentLang,
    toggleLanguage,
    theme,
    toggleTheme,
    isCheckingSession,
    handleCheckSession,
    setSessionModalOpen,
    onOpenSiteManager: () => setSiteManagerModalOpen(true),
    publicPageUrl: resolvedPublicPageUrl,
  };

  // Don't render if hide_debug param is set (for embedded previews)
  if (shouldHide) {
    return null;
  }

  const forkVariantCount = !versioningData?.versioning ? 0 : Math.max(...Object.values(versioningData.versioning).map((ld) => ld?.variants?.length ?? 0));

  // Fork bubble is always visible alongside the debug bubble — same show/hide rules.
  const showForkBubble = !shouldHide;

  const search = useSearch();
  const activeVariant = new URLSearchParams(search).get("variant");
  const activeVariantLabel = activeVariant ? activeVariant.split("-").map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(" ") : null;

  return (
    <div className="fixed bottom-4 left-4 z-50 flex flex-col gap-2 items-start" data-testid="debug-bubble">
      {showForkBubble && (
        <div className="relative flex items-center">
          {pageIsSharedLayout && (
            <span
              className="absolute -top-1 -left-1 z-10 flex items-center justify-center h-4 w-4 rounded-full bg-background border border-border shadow pointer-events-none"
              title={pageIsDetached ? "Detached from shared template" : "Attached to shared template"}
              data-testid={pageIsDetached ? "badge-fork-detached" : "badge-fork-linked"}
            >
              {pageIsDetached ? (
                <Unlink className="h-2.5 w-2.5 text-muted-foreground" />
              ) : (
                <Link2 className="h-2.5 w-2.5 text-status-online" />
              )}
            </span>
          )}
          <Button
            size="icon"
            variant="default"
            className="h-10 w-10 rounded-full shadow-lg flex-shrink-0"
            title={
              pageIsDetached
                ? "Page versions (detached)"
                : pageIsSharedLayout
                  ? "Page versions (linked)"
                  : "Variant versions"
            }
            data-testid="button-fork-bubble"
            onClick={() => {
              setOpen(true);
              setMenuView("versioning");
            }}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <span
            className="absolute top-[-14px] right-[-14px] z-10 flex items-center justify-center gap-px h-4 min-w-4 px-1 rounded-full text-primary-foreground text-[10px] font-bold leading-none pointer-events-none shadow-sm ring-1 ring-background"
            style={{ backgroundColor: "color-mix(in srgb, hsl(var(--primary)) 58%, black)" }}
            data-testid="badge-fork-variant-count"
          >
            <GitBranch className="h-3 w-3 shrink-0" strokeWidth={2.5} />
            {forkVariantCount}
          </span>
          {activeVariantLabel && (
            <span
              className="-ml-2 pl-3 pr-2 py-0.5 rounded-full text-xs font-medium bg-background text-foreground border border-primary shadow whitespace-nowrap pointer-events-none flex items-center gap-1"
              data-testid="badge-active-variant"
            >
              <GitBranch className="h-3 w-3 shrink-0" strokeWidth={2.5} />
              {activeVariantLabel}
            </span>
          )}
        </div>
      )}
      <Popover open={open} onOpenChange={handleOpenChange}>
        <PopoverTrigger asChild>
          <div className="relative">
            <Button
              size="icon"
              variant="default"
              className="h-12 w-12 rounded-full shadow-lg"
              data-testid="button-debug-toggle"
            >
              {open ? <X className="h-5 w-5" /> : <Bug className="h-5 w-5" />}
            </Button>
            {/* Show "Commit" indicator when there are local changes that need uploading - only when logged in */}
            {hasCommitIndicator && (
              <button
                onClick={() => {
                  setCommitModalOpen(true);
                  fetchPendingChanges(); // Refresh pending changes when opening modal
                }}
                className="absolute -top-1 left-full ml-1 flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium animate-pulse cursor-pointer hover:opacity-90 transition-opacity"
                style={{
                  backgroundColor: '#fbbf24',
                  color: '#000',
                  boxShadow: '0 0 12px 2px rgba(251, 191, 36, 0.6), 0 0 20px 4px rgba(251, 191, 36, 0.3)',
                }}
                data-testid="indicator-pending-changes"
                title={`${pendingChanges.length} pending change${pendingChanges.length > 1 ? 's' : ''} - click to commit`}
              >
                <ArrowUp className="h-3 w-3" />
                <span>Commit</span>
              </button>
            )}
            {hasSystemAlerts && (
              <button
                onClick={() => setOpen(true)}
                className="absolute left-full ml-1 flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer hover:opacity-90 transition-opacity whitespace-nowrap"
                style={{
                  top: pillTop(hasCommitIndicator ? 1 : 0),
                  backgroundColor: "#ef4444",
                  color: "#fff",
                  boxShadow: "0 0 12px 2px rgba(239, 68, 68, 0.6), 0 0 20px 4px rgba(239, 68, 68, 0.3)",
                }}
                data-testid="indicator-system-alerts"
                title={`${criticalAlerts.length} critical system alert${criticalAlerts.length !== 1 ? "s" : ""} - click to view`}
              >
                <AlertTriangle className="h-3 w-3" />
                <span>System error</span>
              </button>
            )}
            {(pageErrorCount > 0 || pageWarningCount > 0 || pageDiagnostics?.dirty) && (
              <button
                onClick={() => setPageErrorsModalOpen(true)}
                className="absolute left-full ml-1 flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium cursor-pointer hover:opacity-90 transition-opacity whitespace-nowrap"
                style={{
                  top: pillTop((hasCommitIndicator ? 1 : 0) + (hasSystemAlerts ? 1 : 0)),
                  backgroundColor: pageErrorCount > 0 ? '#ef4444' : pageDiagnostics?.dirty ? '#78716c' : '#f59e0b',
                  color: '#fff',
                  boxShadow: pageErrorCount > 0
                    ? '0 0 12px 2px rgba(239, 68, 68, 0.6), 0 0 20px 4px rgba(239, 68, 68, 0.3)'
                    : '0 0 12px 2px rgba(245, 158, 11, 0.6), 0 0 20px 4px rgba(245, 158, 11, 0.3)',
                }}
                data-testid="indicator-page-errors"
                title={
                  pageDiagnostics?.dirty && pageErrorCount === 0 && pageWarningCount === 0
                    ? "Validation may be outdated — click to view"
                    : `${pageErrorCount} error${pageErrorCount !== 1 ? 's' : ''}, ${pageWarningCount} warning${pageWarningCount !== 1 ? 's' : ''} - click to view`
                }
              >
                <AlertTriangle className="h-3 w-3" />
                <span>
                  {pageDiagnostics?.dirty && pageErrorCount === 0 && pageWarningCount === 0
                    ? "Stale"
                    : pageErrorCount === 0 && pageWarningCount > 0
                      ? "Page Warnings"
                      : "Page errors"}
                </span>
              </button>
            )}
          </div>
        </PopoverTrigger>
        {!isMobile && (
          <PopoverContent
            side="top"
            align="start"
            className="p-0 flex flex-col w-96 max-h-[85vh]"
            sideOffset={8}
            onPointerDownOutside={(e) => {
              const target = (e.detail.originalEvent as PointerEvent).target as Element | null;
              if (target?.closest("[data-radix-popper-content-wrapper]")) {
                e.preventDefault();
              }
            }}
          >
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
              <DebugPanelContent {...panelContentProps} />
            </div>
          </PopoverContent>
        )}
      </Popover>
      {isMobile && (
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetContent side="bottom" className="h-[100dvh] p-0 flex flex-col">
            <div className="flex items-center justify-between p-3 border-b border-border flex-shrink-0">
              <SheetTitle className="text-sm font-semibold">Debug Tools</SheetTitle>
            </div>
            <div className="flex-1 overflow-y-auto overflow-x-hidden">
              <DebugPanelContent {...panelContentProps} />
            </div>
          </SheetContent>
        </Sheet>
      )}
      <SiteManagerModal
        open={siteManagerModalOpen}
        onOpenChange={setSiteManagerModalOpen}
        siteInfo={siteInfo}
        onSwitchSite={() => setSwitchSiteModalOpen(true)}
      />
      <SwitchSiteModal
        open={switchSiteModalOpen}
        onOpenChange={setSwitchSiteModalOpen}
        activeDomain={siteInfo?.domain ?? ""}
        isDevOverride={siteInfo?.isDevOverride ?? false}
      />
      <SessionModal
        open={sessionModalOpen}
        onOpenChange={setSessionModalOpen}
        session={session}
        hasToken={hasToken}
        getDebugToken={getDebugToken}
        getDebugUserName={getDebugUserName}
        clearToken={clearToken}
        handleCheckSession={handleCheckSession}
        isCheckingSession={isCheckingSession}
      />
      <SyncModal
        open={commitModalOpen}
        onOpenChange={setCommitModalOpen}
        autoCommitStatus={autoCommitStatus}
        autoCommitCountdown={autoCommitCountdown}
        isFlushing={isFlushing}
        handleFlush={handleFlush}
        handleClearConflict={handleClearConflict}
        pendingChanges={pendingChanges}
        pendingChangesLoading={pendingChangesLoading}
        selectedFileForCommit={selectedFileForCommit}
        setSelectedFileForCommit={setSelectedFileForCommit}
        fileCommitMessage={fileCommitMessage}
        setFileCommitMessage={setFileCommitMessage}
        fileCommitting={fileCommitting}
        handleFileCommit={handleFileCommit}
        filePulling={filePulling}
        handleFilePull={handleFilePull}
        setConfirmPullFile={setConfirmPullFile}
        githubSyncStatus={githubSyncStatus}
        commitMessage={commitMessage}
        setCommitMessage={setCommitMessage}
        isCommitting={isCommitting}
        handleCommit={handleCommit}
        githubConnectRequired={githubConnectRequired}
        handleSyncFromRemote={handleSyncFromRemote}
        isSyncing={isSyncing}
        handleIgnoreAllChanges={handleIgnoreAllChanges}
        isIgnoringAllChanges={isIgnoringAllChanges}
        fetchPendingChanges={fetchPendingChanges}
        handlePushAllLocal={handlePushAllLocal}
        isPushingAllLocal={isPushingAllLocal}
        pushAllLocalError={pushAllLocalError}
        setPushAllLocalError={setPushAllLocalError}
        manualActionsOpen={manualActionsOpen}
        setManualActionsOpen={setManualActionsOpen}
        advancedOptionsOpen={advancedOptionsOpen}
        setAdvancedOptionsOpen={setAdvancedOptionsOpen}
        getDebugToken={getDebugToken}
        onViewDiff={(filePath) => {
          // Close Sync before opening the diff — avoids stacking two Radix dialogs
          setCommitModalOpen(false);
          setDiffFile(filePath);
        }}
        toast={toast}
      />
      <FileDiffModal
        filePath={diffFile}
        onOpenChange={(open) => {
          if (!open) {
            setDiffFile(null);
            setCommitModalOpen(true);
          }
        }}
      />
      <PullConflictModal
        open={pullConflictModalOpen}
        onOpenChange={setPullConflictModalOpen}
        pullConflictFiles={pullConflictFiles}
        onCommitFirst={() => {
          setPullConflictModalOpen(false);
          fetchPendingChanges();
          setCommitModalOpen(true);
        }}
        onPullAnyway={() => {
          setPullConflictModalOpen(false);
          executeSyncFromRemote();
        }}
      />
      <ConfirmPullFileModal
        confirmPullFile={confirmPullFile}
        onOpenChange={(open) => { if (!open) setConfirmPullFile(null); }}
        onConfirm={() => { if (confirmPullFile) handleFilePull(confirmPullFile); }}
        filePulling={filePulling}
      />
      <DeletePageModal
        open={deletePageModalOpen}
        onOpenChange={setDeletePageModalOpen}
        deletingPage={deletingPage}
        deleteConfirmInput={deleteConfirmInput}
        setDeleteConfirmInput={setDeleteConfirmInput}
        isDeletingPage={isDeletingPage}
        onConfirm={confirmDeletePage}
        currentLocale={deletingPage?.locale}
        availableLocales={deletingPage?.availableLocales}
      />
      <CreateContentModal
        open={createContentModalOpen}
        onOpenChange={setCreateContentModalOpen}
        duplicatingPage={duplicatingPage}
        createContentType={createContentType}
        setCreateContentType={setCreateContentType}
        createContentTitle={createContentTitle}
        setCreateContentTitle={setCreateContentTitle}
        createContentSlugEn={createContentSlugEn}
        setCreateContentSlugEn={setCreateContentSlugEn}
        createContentSlugEs={createContentSlugEs}
        setCreateContentSlugEs={setCreateContentSlugEs}
        createContentSlugEnStatus={createContentSlugEnStatus}
        setCreateContentSlugEnStatus={setCreateContentSlugEnStatus}
        createContentSlugEsStatus={createContentSlugEsStatus}
        setCreateContentSlugEsStatus={setCreateContentSlugEsStatus}
        slugEnConflictReason={slugEnConflictReason}
        setSlugEnConflictReason={setSlugEnConflictReason}
        slugEsConflictReason={slugEsConflictReason}
        setSlugEsConflictReason={setSlugEsConflictReason}
        editingSlugEn={editingSlugEn}
        setEditingSlugEn={setEditingSlugEn}
        editingSlugEs={editingSlugEs}
        setEditingSlugEs={setEditingSlugEs}
        isCreatingContent={isCreatingContent}
        setIsCreatingContent={setIsCreatingContent}
        setSitemapUrls={setSitemapUrls}
        setSitemapLoading={setSitemapLoading}
        setDuplicatingPage={setDuplicatingPage}
        toast={toast}
      />
      <PageErrorsModal
        open={pageErrorsModalOpen}
        onOpenChange={setPageErrorsModalOpen}
        pageDiagnostics={pageDiagnostics}
        pageUrl={pageDiagnostics?.url}
        loading={pageDiagnosticsLoading}
        error={pageDiagnosticsError}
        onRefreshDiagnostics={refreshPageDiagnostics}
        onSolveWithAi={({ agentId, setupTab, label, prompt, prefillUrlPrefix }) => {
          setPageErrorsModalOpen(false);
          setMcpRequiredAgentId(agentId);
          setMcpRequiredSetupTab(setupTab);
          setMcpRequiredAgentLabel(label);
          setMcpRequiredPrompt(prompt);
          setMcpRequiredPrefillPrefix(prefillUrlPrefix);
          setMcpRequiredForAiOpen(true);
        }}
      />
      <McpRequiredForAiModal
        open={mcpRequiredForAiOpen}
        onOpenChange={setMcpRequiredForAiOpen}
        defaultTab={mcpRequiredSetupTab}
        agentId={mcpRequiredAgentId}
        agentLabel={mcpRequiredAgentLabel}
        prompt={mcpRequiredPrompt}
        prefillUrlPrefix={mcpRequiredPrefillPrefix}
      />
      <SeoModal
        open={seoModalOpen}
        onOpenChange={setSeoModalOpen}
        contentInfo={contentInfo}
        seoLoading={seoLoading}
        seoData={seoData}
        seoMeta={seoMeta}
        setSeoMeta={applySeoMetaFromForm}
        seoLocations={seoLocations}
        setSeoLocations={setSeoLocations}
        seoAvailableLocations={seoAvailableLocations}
        seoLocationSearch={seoLocationSearch}
        setSeoLocationSearch={setSeoLocationSearch}
        baselineLocations={locationsBaseline}
        saving={seoSaves.saving}
        onSaveLocations={async (locs) => {
          await seoSaves.saveLocations(locs);
          setLocationsBaseline([...locs]);
        }}
        onSaveVisibility={seoSaves.saveVisibility}
        onRevertVisibility={() => {
          applySeoMetaFromForm({
            ...seoMeta,
            robots: seoBaselineMetaRef.current.robots,
            priority: seoBaselineMetaRef.current.priority,
            change_frequency: seoBaselineMetaRef.current.change_frequency,
          });
        }}
        onSaveSnippet={seoSaves.saveSnippet}
        onRevertSnippet={() => {
          applySeoMetaFromForm({
            ...seoMeta,
            page_title: seoBaselineMetaRef.current.page_title,
            description: seoBaselineMetaRef.current.description,
          });
        }}
        onSaveCanonical={seoSaves.saveCanonical}
        onSaveOgImage={seoSaves.saveOgImage}
        visibilityDirty={["robots", "priority", "change_frequency"].some((k) =>
          seoDirtyKeys.has(k),
        )}
        snippetDirty={["page_title", "description"].some((k) => seoDirtyKeys.has(k))}
        snippetSaveBlocked={
          seoSaves.isLiveLocale &&
          liveSnippetClearBlocked(seoMeta, seoDirtyKeys)
        }
        canonicalDirty={seoDirtyKeys.has("canonical_url")}
        newSlugValue={newSlugValue}
        setNewSlugValue={setNewSlugValue}
        slugCheckStatus={slugCheckStatus}
        slugRenaming={slugRenaming}
        slugRedirectPrompt={slugRedirectPrompt}
        slugOldUrl={slugOldUrl}
        slugNewUrl={slugNewUrl}
        handleSlugRenameClick={handleSlugRenameClick}
        handleSlugRename={handleSlugRename}
        currentLocaleSlug={currentLocaleSlug}
        slugCheckReason={slugCheckReason}
        setSlugRedirectPrompt={setSlugRedirectPrompt}
        locale={getEffectiveLocale()}
        contentTypeLabel={contentInfo.type ? contentInfo.label : undefined}
        seoContext={seoData?.context ?? (getUrlVariant() ? "variant" : "live")}
        seoVariant={seoData?.variant ?? getUrlVariant()}
        metaOverrides={seoData?.metaOverrides ?? []}
      />
      <ManagedSeoModal
        open={managedSeoModalOpen}
        onOpenChange={(open) => {
          setManagedSeoModalOpen(open);
          if (!open) setManagedSeoModalTarget(null);
        }}
        target={managedSeoModalTarget}
      />
      {showYamlEditor && yamlEditorInfo && (
        <Suspense fallback={null}>
          <RawFileEditorPanel
            contentType={yamlEditorInfo.contentType}
            slug={yamlEditorInfo.slug}
            locale={yamlEditorInfo.locale}
            variantSlug={yamlEditorInfo.variantSlug}
            readOnly={yamlEditorInfo.readOnly}
            onClose={() => setShowYamlEditor(false)}
            onSaved={() => window.location.reload()}
          />
        </Suspense>
      )}
      {showContentTypesYmlEditor && (
        <Suspense fallback={null}>
          <ContentTypesYmlEditorPanel
            onClose={() => setShowContentTypesYmlEditor(false)}
            onSaved={() => {
              queryClient.invalidateQueries({ queryKey: ["/api/content-types"] });
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
