import { useState, useEffect, useMemo, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowLeftRight, ArrowRight, ChevronDown, ChevronRight, Code, Eye, EyeOff, Filter, Hash, Image, Info, Loader2, MapPin, Pencil, RefreshCw, Search, Table2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ImagePickerDialog } from "@/components/editing/ImagePickerDialog";
import { EntrySeoClusterFields, MappingFieldsTab } from "@/components/editing/MappingFieldsTab";
import type { SeoModalSavedDetail } from "@/components/editing/seoModalSaved";
import { FunnelTab } from "@/components/DebugBubble/components/FunnelTab";
import { OpenRushFetchControl } from "@/components/seo/OpenRushFetchControl";
import { formatOpenRushFetchedAge } from "@/components/seo/openrushFetchAge";
import {
  hijackDestination,
  isLiveUrlRedirectHijack,
  LiveUrlRedirectHijackBanner,
  resolveSeoLiveProbePath,
  type RedirectTestLike,
} from "@/components/DebugBubble/components/seoRedirectHijack";
import { OG_IMAGE_ENSURE_TAGS } from "@shared/standardMediaTags";
import type { SeoModalSavingFlags } from "@/hooks/useSeoModalSaves";
import { useFormatSitePath } from "@/hooks/useFormatSitePath";
import { useToast } from "@/hooks/use-toast";
import { resolveAuthorName } from "@/hooks/useDebugAuth";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Tabs,
  TabsContent,
} from "@/components/ui/tabs";
import { ToggleButtonBarList, ToggleButtonBarTrigger } from "@/components/ui/toggle-button-bar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { ContentInfo, SeoMeta, SeoLocation, SlugCheckStatus } from "../types";
import { useResolveString } from "@/hooks/useVariables";
import { cn } from "@/lib/utils";

type OpenRushSerpHit = { url: string; rank: number };

type OpenRushSerpEntryClient = {
  query: string;
  fetched_at: string;
  organic: OpenRushSerpHit[];
  featured_snippet_url: string | null;
  has_paa: boolean;
  our_serp_rank: number | null;
  visible_in_serp: boolean | null;
};

type SeoEntrySerpPayload = {
  main_keyword?: string | null;
  path?: string;
  serp_snapshot?: {
    openrush_configured: boolean;
    query: string | null;
    entry: OpenRushSerpEntryClient | null;
    stale: boolean;
  };
};

export type SeoModalTab = "keywords" | "serp" | "fields" | "funnel" | "schema" | "visibility" | "redirects";

/** Truncate an absolute canonical URL for the header badge. */
function formatCanonicalBadgeLabel(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) return "";
  try {
    const u = new URL(trimmed);
    return `${u.hostname}${u.pathname}`.replace(/\/$/, "") || trimmed;
  } catch {
    return trimmed.length > 48 ? `${trimmed.slice(0, 45)}…` : trimmed;
  }
}

type SchemaOrgPreviewDoc = {
  schema: Record<string, unknown>;
  source: string;
};

export interface SeoModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  contentInfo: ContentInfo;
  seoLoading: boolean;
  seoData: any;
  seoMeta: SeoMeta;
  setSeoMeta: (v: SeoMeta) => void;
  seoLocations: string[];
  setSeoLocations: (v: string[] | ((prev: string[]) => string[])) => void;
  seoAvailableLocations: SeoLocation[];
  seoLocationSearch: string;
  setSeoLocationSearch: (v: string) => void;
  /** Baseline locations list (for auto-save diff). */
  baselineLocations: string[];
  saving: SeoModalSavingFlags;
  onSaveLocations: (locations: string[]) => Promise<void>;
  onSaveVisibility: () => Promise<void>;
  /** Reset robots / priority / change_frequency to last saved baseline (cancel edit). */
  onRevertVisibility?: () => void;
  onSaveSnippet: () => Promise<void>;
  /** Reset page_title / description to last saved baseline (cancel snippet edit). */
  onRevertSnippet?: () => void;
  onSaveCanonical: () => Promise<void>;
  onSaveOgImage: (src: string) => Promise<void>;
  visibilityDirty?: boolean;
  snippetDirty?: boolean;
  snippetSaveBlocked?: boolean;
  canonicalDirty?: boolean;
  newSlugValue: string;
  setNewSlugValue: (v: string) => void;
  slugCheckStatus: SlugCheckStatus;
  slugRenaming: boolean;
  slugRedirectPrompt: boolean;
  slugOldUrl: string;
  slugNewUrl: string;
  handleSlugRenameClick: () => void;
  handleSlugRename: (createRedirect: boolean) => Promise<void>;
  currentLocaleSlug: string;
  slugCheckReason: string | null;
  setSlugRedirectPrompt: (v: boolean) => void;
  /** Locale for Fields tab provenance / field_overrides (live locale). */
  locale?: string;
  contentTypeLabel?: string;
  /** Tab to show when the modal opens (defaults to SERP). */
  initialTab?: SeoModalTab;
  /** live = published locale file; variant = draft or A/B file. */
  seoContext?: "live" | "variant";
  /** Active variant slug when seoContext is variant. */
  seoVariant?: string;
  /** Meta keys defined on the variant file (overrides). */
  metaOverrides?: string[];
  /** Fired after nested keyword/fields/funnel saves so parents can refresh lists. */
  onSaved?: (detail: SeoModalSavedDetail) => void;
}

function resolveSchemaPreviewDocs(seoData: any): SchemaOrgPreviewDoc[] {
  const docs = seoData?.schemaOrgDocuments;
  if (Array.isArray(docs) && docs.length > 0) {
    return docs.filter(
      (d: unknown): d is SchemaOrgPreviewDoc =>
        !!d &&
        typeof d === "object" &&
        typeof (d as SchemaOrgPreviewDoc).source === "string" &&
        !!(d as SchemaOrgPreviewDoc).schema,
    );
  }
  const out: SchemaOrgPreviewDoc[] = [];
  if (seoData?.faqSchema) {
    out.push({ schema: seoData.faqSchema, source: "faq" });
  }
  if (Array.isArray(seoData?.schemaOrg)) {
    for (const schema of seoData.schemaOrg) {
      if (!schema || typeof schema !== "object") continue;
      const t = String((schema as Record<string, unknown>)["@type"] ?? "");
      if (t === "FAQPage" && seoData?.faqSchema) continue;
      let source = "schema_org";
      if (t === "FAQPage") source = "faq";
      else if (t === "Article" || t === "BlogPosting") source = "article";
      else if (t === "BreadcrumbList") source = "breadcrumb";
      else if (t === "Organization") source = "organization";
      out.push({ schema, source });
    }
  }
  return out;
}

const ROBOTS_OPTIONS = [
  { value: "", label: "index, follow", description: "Show in search results and follow all links on this page. Recommended for most pages." },
  { value: "noindex", label: "noindex", description: "Hide from search results but still follow links. Useful for private or duplicate pages." },
  { value: "noindex, nofollow", label: "noindex, nofollow", description: "Hide from search results and don't follow any links. Use for pages you never want crawled." },
] as const;

function formatRobotsDisplay(robots: string): string {
  const match = ROBOTS_OPTIONS.find((o) => o.value === robots);
  if (match) return match.value === "" ? `${match.label} (default)` : match.label;
  return robots.trim() || "index, follow (default)";
}

function formatPriorityDisplay(priority: string): string {
  return priority.trim() ? priority : "Default";
}

function formatChangeFrequencyDisplay(changeFrequency: string): string {
  return changeFrequency.trim() ? changeFrequency : "Default";
}

export function SeoModal({
  open,
  onOpenChange,
  contentInfo,
  seoLoading,
  seoData,
  seoMeta,
  setSeoMeta,
  seoLocations,
  setSeoLocations,
  seoAvailableLocations,
  seoLocationSearch,
  setSeoLocationSearch,
  baselineLocations,
  saving,
  onSaveLocations,
  onSaveVisibility,
  onRevertVisibility,
  onSaveSnippet,
  onRevertSnippet,
  onSaveCanonical,
  onSaveOgImage,
  visibilityDirty = false,
  snippetDirty = false,
  snippetSaveBlocked = false,
  canonicalDirty = false,
  newSlugValue,
  setNewSlugValue,
  slugCheckStatus,
  slugRenaming,
  slugRedirectPrompt,
  slugOldUrl,
  slugNewUrl,
  handleSlugRenameClick,
  handleSlugRename,
  currentLocaleSlug,
  slugCheckReason,
  setSlugRedirectPrompt,
  locale = "en",
  contentTypeLabel,
  initialTab = "serp",
  seoContext = "live",
  seoVariant,
  metaOverrides = [],
  onSaved,
}: SeoModalProps) {
  const [activeTab, setActiveTab] = useState<SeoModalTab>(initialTab);
  const [schemaAdvancedOpen, setSchemaAdvancedOpen] = useState(false);
  const [expandedSchemaDocs, setExpandedSchemaDocs] = useState<Record<number, boolean>>({});
  const [variantAdvancedOpen, setVariantAdvancedOpen] = useState(false);
  const [serpAdvancedOpen, setSerpAdvancedOpen] = useState(false);
  const [serpFeaturesAdvancedOpen, setSerpFeaturesAdvancedOpen] = useState(false);
  const [keywordsAdvancedOpen, setKeywordsAdvancedOpen] = useState(false);
  const [canonicalEditing, setCanonicalEditing] = useState(false);
  const [canonicalAdvancedOpen, setCanonicalAdvancedOpen] = useState(false);
  const [refreshingSerp, setRefreshingSerp] = useState(false);
  const { toast } = useToast();
  const formatSitePath = useFormatSitePath();

  const liveProbePath = useMemo(
    () => resolveSeoLiveProbePath(seoData, seoMeta.canonical_url),
    [seoData, seoMeta.canonical_url],
  );

  const { data: redirectInspect } = useQuery<RedirectTestLike | null>({
    queryKey: ["/api/debug/redirects/test", liveProbePath, locale],
    queryFn: async () => {
      if (!liveProbePath) return null;
      const res = await fetch(
        `/api/debug/redirects/test?url=${encodeURIComponent(liveProbePath)}&locale=${encodeURIComponent(locale)}`,
      );
      if (!res.ok) return null;
      return (await res.json()) as RedirectTestLike;
    },
    enabled: open && !!liveProbePath,
    retry: false,
    staleTime: 30_000,
  });

  const fieldsLocale = locale || contentInfo.locale || "en";
  const { data: entrySerpInfo, refetch: refetchEntrySerp } = useQuery<SeoEntrySerpPayload>({
    queryKey: ["/api/seo/entry", contentInfo.type, contentInfo.slug, fieldsLocale, "serp-snapshot"],
    enabled: open && !!contentInfo.type && !!contentInfo.slug,
    staleTime: 60_000,
    queryFn: async () => {
      const params = new URLSearchParams({ locale: fieldsLocale });
      const res = await fetch(
        `/api/seo/entry/${encodeURIComponent(contentInfo.type!)}/${encodeURIComponent(contentInfo.slug!)}?${params}`,
        { credentials: "include", headers: getSessionHeaders() },
      );
      if (!res.ok) return {};
      return res.json();
    },
  });

  const mainKeywordForSerp = (entrySerpInfo?.main_keyword || "").trim();
  const serpSnapshot = entrySerpInfo?.serp_snapshot;
  const serpEntry = serpSnapshot?.entry ?? null;
  const openrushSerpConfigured = serpSnapshot?.openrush_configured === true;
  const serpFetchedAge = formatOpenRushFetchedAge(serpEntry?.fetched_at, serpSnapshot?.stale);

  const handleRequestSerp = async () => {
    if (!contentInfo.type || !contentInfo.slug) return;
    const fresh = await refetchEntrySerp();
    const keyword = (fresh.data?.main_keyword || "").trim();
    if (!keyword) {
      toast({
        title: "No keyword yet",
        description: "Set a main keyword on the Keywords tab first.",
        variant: "destructive",
      });
      throw new Error("no_keyword");
    }
    setRefreshingSerp(true);
    try {
      const author = await resolveAuthorName();
      const res = await fetch("/api/seo/serp/refresh", {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...getSessionHeaders(),
        },
        body: JSON.stringify({
          contentType: contentInfo.type,
          slug: contentInfo.slug,
          locale: fieldsLocale,
          keyword,
          author: author || undefined,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error || "SERP refresh failed");
      }
      toast({
        title: "SERP snapshot updated",
        description: "OpenRush features were saved to the shared SERP cache.",
      });
      await refetchEntrySerp();
    } catch (err) {
      if (err instanceof Error && err.message === "no_keyword") throw err;
      toast({
        title: "Could not request SERP",
        description: err instanceof Error ? err.message : "Request failed",
        variant: "destructive",
      });
      throw err;
    } finally {
      setRefreshingSerp(false);
    }
  };

  const liveUrlHijacked = isLiveUrlRedirectHijack(redirectInspect);
  const hijackDest = redirectInspect ? hijackDestination(redirectInspect) : "";
  const hijackSource = redirectInspect?.source
    ? formatSitePath(redirectInspect.source)
    : "";

  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [open, initialTab]);

  useEffect(() => {
    if (open && activeTab === "serp" && contentInfo.type && contentInfo.slug) {
      void refetchEntrySerp();
    }
  }, [open, activeTab, contentInfo.type, contentInfo.slug, refetchEntrySerp]);
  const [ogImageError, setOgImageError] = useState(false);
  const [ogImageTooSmall, setOgImageTooSmall] = useState(false);
  const [imagePickerOpen, setImagePickerOpen] = useState(false);
  const [snippetEditing, setSnippetEditing] = useState(false);
  const [visibilityEditing, setVisibilityEditing] = useState(false);
  const [slugEditing, setSlugEditing] = useState(false);
  const [dialogContainer, setDialogContainer] = useState<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) {
      setSlugEditing(false);
      setVisibilityEditing(false);
      setSnippetEditing(false);
      setCanonicalEditing(false);
      setCanonicalAdvancedOpen(false);
    }
  }, [open]);

  const resolveString = useResolveString();
  const resolvedPageTitle = useMemo(() => {
    const raw = seoMeta.page_title || "";
    if (!raw.includes("{{")) return raw;
    return resolveString(raw).text;
  }, [seoMeta.page_title, resolveString]);
  const resolvedDescription = useMemo(() => {
    const raw = seoMeta.description || "";
    if (!raw.includes("{{")) return raw;
    return resolveString(raw).text;
  }, [seoMeta.description, resolveString]);
  const fieldsTypeLabel =
    contentTypeLabel ||
    (contentInfo.type
      ? contentInfo.type.charAt(0).toUpperCase() + contentInfo.type.slice(1)
      : "Content type");
  const fieldsVariant = useMemo(() => {
    if (seoVariant) return seoVariant;
    if (typeof window === "undefined") return null;
    const q = new URLSearchParams(window.location.search);
    return q.get("variant") || q.get("force_variant");
  }, [open, contentInfo.type, contentInfo.slug, seoVariant]);

  const isVariantContext = seoContext === "variant" && !!seoVariant;
  const variantFileName = isVariantContext
    ? `${seoVariant}.${fieldsLocale}.yml`
    : `${fieldsLocale}.yml`;
  const slugRenameDisabled = isVariantContext;

  const locationsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const locationsSkipFirstRef = useRef(true);

  useEffect(() => {
    if (!open || contentInfo.type !== "landing") return;
    if (locationsSkipFirstRef.current) {
      locationsSkipFirstRef.current = false;
      return;
    }
    if (locationsTimerRef.current) clearTimeout(locationsTimerRef.current);
    locationsTimerRef.current = setTimeout(() => {
      const sortedA = [...seoLocations].sort().join(",");
      const sortedB = [...baselineLocations].sort().join(",");
      if (sortedA !== sortedB) {
        void onSaveLocations(seoLocations);
      }
    }, 500);
    return () => {
      if (locationsTimerRef.current) clearTimeout(locationsTimerRef.current);
    };
  }, [seoLocations, baselineLocations, contentInfo.type, open, onSaveLocations]);

  useEffect(() => {
    if (!open) {
      locationsSkipFirstRef.current = true;
    }
  }, [open]);

  const snippetUrl = seoMeta.canonical_url || (typeof window !== "undefined" ? `${window.location.origin}/${contentInfo.slug || ""}` : "");
  const snippetBreadcrumb = (() => {
    try {
      const u = new URL(snippetUrl);
      const parts = (u.hostname + u.pathname).replace(/\/$/, "").split("/");
      return parts.join(" › ");
    } catch {
      return snippetUrl;
    }
  })();
  const snippetDomain = (() => {
    try { return new URL(snippetUrl).hostname; } catch { return ""; }
  })();
  const externalCanonical = (seoMeta.canonical_url || "").trim();
  const hasExternalCanonical = externalCanonical.length > 0;
  const canonicalBadgeLabel = hasExternalCanonical
    ? formatCanonicalBadgeLabel(externalCanonical)
    : "This page has no external canonical";

  return (
    <>
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) setImagePickerOpen(false); onOpenChange(isOpen); }}>
      <DialogContent ref={setDialogContainer} className="sm:max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit your entry fields and more</DialogTitle>
          <DialogDescription asChild>
            <div className="space-y-2">
              {!slugEditing || !contentInfo.type ? (
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="truncate">
                    {(currentLocaleSlug || contentInfo.slug)
                      ? `${contentInfo.label}: ${currentLocaleSlug || contentInfo.slug}`
                      : "Page SEO settings"}
                    {isVariantContext ? ` · variant ${seoVariant}` : ""}
                  </span>
                  {contentInfo.type && !slugRenameDisabled && (
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0"
                      onClick={() => {
                        setNewSlugValue(currentLocaleSlug);
                        setSlugEditing(true);
                      }}
                      data-testid="button-edit-slug-inline"
                      title="Edit page slug"
                      aria-label="Edit page slug"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              ) : (
                <div className="space-y-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm shrink-0">{contentInfo.label}:</span>
                    <input
                      id="slug-editor-input"
                      type="text"
                      value={newSlugValue}
                      onChange={(e) =>
                        setNewSlugValue(
                          e.target.value
                            .toLowerCase()
                            .replace(/\s+/g, "-")
                            .replace(/[^a-z0-9-]/g, ""),
                        )
                      }
                      placeholder={currentLocaleSlug}
                      className={`flex-1 min-w-0 px-2 py-1 text-sm font-mono rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring ${slugCheckStatus === "taken" ? "border-destructive" : slugCheckStatus === "available" ? "border-green-500" : ""}`}
                      data-testid="input-slug-editor"
                      disabled={slugRenaming}
                      autoFocus
                    />
                    {newSlugValue &&
                      newSlugValue !== currentLocaleSlug &&
                      !slugRedirectPrompt && (
                        <>
                          <Button
                            size="sm"
                            onClick={handleSlugRenameClick}
                            disabled={slugCheckStatus !== "available" || slugRenaming}
                            data-testid="button-rename-slug"
                          >
                            {slugRenaming ? "Renaming…" : "Apply"}
                          </Button>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => setNewSlugValue(currentLocaleSlug)}
                            disabled={slugRenaming}
                            data-testid="button-reset-slug"
                          >
                            Reset
                          </Button>
                        </>
                      )}
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-6 w-6 shrink-0"
                      onClick={() => {
                        setNewSlugValue(currentLocaleSlug);
                        setSlugRedirectPrompt(false);
                        setSlugEditing(false);
                      }}
                      disabled={slugRenaming}
                      data-testid="button-cancel-slug-edit"
                      title="Cancel"
                      aria-label="Cancel slug edit"
                    >
                      <X className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  {slugCheckStatus === "checking" && (
                    <p className="text-xs text-muted-foreground">Checking availability…</p>
                  )}
                  {slugCheckStatus === "available" && newSlugValue !== currentLocaleSlug && (
                    <p className="text-xs text-green-600">Slug is available</p>
                  )}
                  {slugCheckStatus === "taken" && slugCheckReason && (
                    <p className="text-xs text-destructive">{slugCheckReason}</p>
                  )}
                </div>
              )}
              {slugRenameDisabled && !slugEditing && (
                <p className="text-xs" data-testid="text-slug-rename-disabled-variant">
                  Slug rename is disabled while editing a variant. Open LIVE context to rename.
                </p>
              )}
              {slugRedirectPrompt && (
                <div className="space-y-3 rounded-md border p-3 text-foreground">
                  <p className="text-sm font-medium">Create a redirect?</p>
                  <p className="text-xs text-muted-foreground">
                    Do you want to create a redirect from the old URLs to the new ones? This ensures existing links and
                    bookmarks still work.
                  </p>
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-2 text-xs font-mono">
                      <code className="bg-muted px-1.5 py-0.5 rounded truncate">{slugOldUrl}</code>
                      <ArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                      <code className="bg-muted px-1.5 py-0.5 rounded truncate">{slugNewUrl}</code>
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      size="sm"
                      onClick={() => handleSlugRename(true)}
                      disabled={slugRenaming}
                      data-testid="button-rename-with-redirect"
                    >
                      {slugRenaming ? "Renaming..." : "Yes, create redirect"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleSlugRename(false)}
                      disabled={slugRenaming}
                      data-testid="button-rename-without-redirect"
                    >
                      No, just rename
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setSlugRedirectPrompt(false)}
                      disabled={slugRenaming}
                      data-testid="button-cancel-rename"
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}

              <div className="space-y-2 pt-0.5" data-testid="seo-canonical-header">
                {!canonicalEditing ? (
                  <button
                    type="button"
                    className="inline-flex max-w-full min-w-0 text-left"
                    onClick={() => setCanonicalEditing(true)}
                    data-testid="badge-seo-canonical"
                    title={
                      hasExternalCanonical
                        ? `External canonical: ${externalCanonical}`
                        : "Set an external canonical URL"
                    }
                  >
                    <Badge
                      variant="outline"
                      className={cn(
                        "max-w-full font-normal text-[10px] sm:text-[11px] cursor-pointer hover-elevate gap-1",
                        hasExternalCanonical
                          ? "border-amber-500/50 text-amber-800 dark:text-amber-200"
                          : "text-muted-foreground",
                      )}
                    >
                      {hasExternalCanonical ? (
                        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden />
                      ) : null}
                      <span className="truncate">{canonicalBadgeLabel}</span>
                    </Badge>
                  </button>
                ) : (
                  <div
                    className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-left"
                    data-testid="form-seo-canonical"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs text-foreground leading-relaxed">
                        An external canonical tells Google and LLMs to treat another URL as the preferred page for
                        this content. This page can drop out of search and AI results.
                      </p>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 shrink-0"
                        onClick={() => {
                          setCanonicalEditing(false);
                          setCanonicalAdvancedOpen(false);
                        }}
                        data-testid="button-cancel-canonical-edit"
                        title="Close"
                        aria-label="Close canonical editor"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-foreground" htmlFor="seo-canonical-url">
                        Canonical URL
                      </label>
                      <input
                        id="seo-canonical-url"
                        type="text"
                        value={seoMeta.canonical_url}
                        onChange={(e) => setSeoMeta({ ...seoMeta, canonical_url: e.target.value })}
                        placeholder="Leave empty unless this page should defer to another URL"
                        className="w-full px-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                        data-testid="input-seo-canonical-url"
                        autoFocus
                      />
                      <div className="flex gap-2 pt-1 flex-wrap">
                        <Button
                          size="sm"
                          disabled={!canonicalDirty || !!saving.canonical}
                          onClick={() => {
                            void (async () => {
                              try {
                                await onSaveCanonical();
                                setCanonicalEditing(false);
                              } catch {
                                /* stay open */
                              }
                            })();
                          }}
                          data-testid="button-save-canonical"
                        >
                          {saving.canonical ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                          Save canonical URL
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={!!saving.canonical}
                          onClick={() => {
                            setCanonicalEditing(false);
                            setCanonicalAdvancedOpen(false);
                          }}
                          data-testid="button-canonical-cancel"
                        >
                          Cancel
                        </Button>
                      </div>
                    </div>
                    <Collapsible open={canonicalAdvancedOpen} onOpenChange={setCanonicalAdvancedOpen}>
                      <CollapsibleTrigger
                        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        data-testid="button-canonical-advanced"
                      >
                        <ChevronDown
                          className={`h-3.5 w-3.5 transition-transform ${canonicalAdvancedOpen ? "rotate-180" : ""}`}
                        />
                        Read more (advanced)
                      </CollapsibleTrigger>
                      <CollapsibleContent className="text-xs text-muted-foreground mt-1 space-y-0.5 font-mono">
                        <p>meta.canonical_url — entry YAML head</p>
                      </CollapsibleContent>
                    </Collapsible>
                  </div>
                )}
              </div>
            </div>
          </DialogDescription>
        </DialogHeader>

        {isVariantContext && (
          <div
            className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm space-y-2"
            data-testid="banner-seo-variant-context"
          >
            <p>
              You are editing <strong>variant</strong> SEO (
              <code className="font-mono text-xs">{variantFileName}</code>
              ). Values shown are variant-first; missing keys inherit from LIVE
              {metaOverrides.length > 0
                ? ` (${metaOverrides.length} override${metaOverrides.length === 1 ? "" : "s"})`
                : ""}
              . Saves write only to this variant — not LIVE. Publish/promote copies them to LIVE.
            </p>
            <Collapsible open={variantAdvancedOpen} onOpenChange={setVariantAdvancedOpen}>
              <CollapsibleTrigger className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
                <ChevronDown
                  className={`h-3.5 w-3.5 transition-transform ${variantAdvancedOpen ? "rotate-180" : ""}`}
                />
                Read more (advanced)
              </CollapsibleTrigger>
              <CollapsibleContent className="text-xs text-muted-foreground mt-1 space-y-0.5 font-mono">
                <p>server/routes/seo.ts — preview merge (common → live → variant)</p>
                <p>server/draft-entry.ts — draft write gate</p>
                <p>server/routes/versioning.ts — promote to live</p>
                <p>update-locations → _common.yml</p>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}

        {seoLoading ? (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <RefreshCw className="h-6 w-6 animate-spin text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Loading SEO data...</p>
          </div>
        ) : seoData ? (
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as SeoModalTab)} className="w-full min-w-0">
            <ToggleButtonBarList className="inline-flex w-auto max-w-full" data-testid="tabs-seo-nav">
              <ToggleButtonBarTrigger value="keywords" data-testid="tab-keywords" className="gap-1.5" title="Keywords" aria-label="Keywords">
                <Hash className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">Keywords</span>
              </ToggleButtonBarTrigger>
              <ToggleButtonBarTrigger value="serp" data-testid="tab-serp" className="gap-1.5" title="SERP" aria-label="SERP">
                <Search className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">SERP</span>
              </ToggleButtonBarTrigger>
              <ToggleButtonBarTrigger value="fields" data-testid="tab-fields" className="gap-1.5" title="Fields" aria-label="Fields">
                <Table2 className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">Fields</span>
              </ToggleButtonBarTrigger>
              <ToggleButtonBarTrigger value="funnel" data-testid="tab-funnel" className="gap-1.5" title="Funnel" aria-label="Funnel">
                <Filter className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">Funnel</span>
              </ToggleButtonBarTrigger>
              <ToggleButtonBarTrigger value="schema" data-testid="tab-schema" className="gap-1.5" title="Schema" aria-label="Schema">
                <Code className="h-3.5 w-3.5 shrink-0" />
                <span className="hidden sm:inline">Schema</span>
              </ToggleButtonBarTrigger>
              <ToggleButtonBarTrigger value="visibility" data-testid="tab-visibility" className="gap-1.5" title="Visibility" aria-label="Visibility">
                {seoMeta.robots && seoMeta.robots.includes("noindex") ? (
                  <EyeOff className="h-3.5 w-3.5 shrink-0 text-destructive" />
                ) : (
                  <Eye className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="hidden sm:inline">Visibility</span>
              </ToggleButtonBarTrigger>
              <ToggleButtonBarTrigger
                value="redirects"
                data-testid="tab-redirects"
                className="gap-1.5"
                title={liveUrlHijacked ? "Redirects — this page’s live URL is redirected away" : "Redirects"}
                aria-label={liveUrlHijacked ? "Redirects, warning" : "Redirects"}
              >
                {liveUrlHijacked ? (
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" data-testid="icon-redirects-hijack" />
                ) : (
                  <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" />
                )}
                <span className="hidden sm:inline">Redirects</span>
              </ToggleButtonBarTrigger>
            </ToggleButtonBarList>

            {/* ── Keywords tab ───────────────────────────────────────── */}
            <TabsContent value="keywords" className="min-w-0 space-y-4 pt-4">
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-1">
                <p>
                  Set the main keyword and cluster settings used for SEO monitoring on this page. Saved separately
                  from how the page looks in Google or when shared.
                </p>
                <Collapsible open={keywordsAdvancedOpen} onOpenChange={setKeywordsAdvancedOpen}>
                  <CollapsibleTrigger
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    data-testid="button-keywords-advanced"
                  >
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${keywordsAdvancedOpen ? "rotate-180" : ""}`}
                    />
                    Read more (advanced)
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-1 space-y-0.5 font-mono text-[11px]">
                    <p>seo: — main_keyword, volume, difficulty, is_pillar, pillar_path</p>
                    <p>Save SEO fields writes locale YAML under seo: (not meta:)</p>
                  </CollapsibleContent>
                </Collapsible>
              </div>
              {contentInfo.type && contentInfo.slug ? (
                <EntrySeoClusterFields
                  contentType={contentInfo.type}
                  slug={contentInfo.slug}
                  locale={fieldsLocale}
                  variant={fieldsVariant}
                  portalContainer={dialogContainer}
                  onSaved={(detail) => {
                    onSaved?.(detail);
                    if (detail.areas.includes("keywords")) {
                      void refetchEntrySerp();
                    }
                  }}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  Open from a content entry to manage keyword and cluster fields.
                </p>
              )}
            </TabsContent>

            {/* ── SERP tab ───────────────────────────────────────────── */}
            <TabsContent value="serp" className="min-w-0 space-y-6 pt-4">
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-2">
                <p>
                  Edit how this page looks in Google results and when shared on social. Saving updates the live
                  snippet without republishing the whole page. Title and description cannot be cleared on a live
                  locale.
                </p>
                <p>
                  OpenRush loads live SERP features for this page’s main keyword. The shared OpenRush control spends
                  credits and updates the cache only — not page YAML.
                </p>
                <div
                  className="flex items-start gap-2 rounded border border-border/60 bg-background/60 px-2 py-1.5"
                  data-testid="openrush-serp-panel"
                >
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <p className="text-[11px] text-foreground" data-testid="text-openrush-serp-last-fetched">
                      Last SERP from OpenRush:{" "}
                      <span className="font-medium">
                        {serpFetchedAge || (serpEntry ? "unknown" : "Never")}
                      </span>
                      {serpSnapshot?.stale && serpEntry ? (
                        <span className="text-amber-700 dark:text-amber-300"> · may be stale</span>
                      ) : null}
                    </p>
                    {serpEntry ? (
                      <div className="flex flex-wrap gap-1" data-testid="openrush-serp-features">
                        <Badge variant="outline" className="text-[10px] font-normal">
                          PAA: {serpEntry.has_paa ? "Yes" : "No"}
                        </Badge>
                        <Badge variant="outline" className="text-[10px] font-normal max-w-full">
                          <span className="truncate">
                            Featured:{" "}
                            {serpEntry.featured_snippet_url ? (
                              <a
                                href={serpEntry.featured_snippet_url}
                                target="_blank"
                                rel="noreferrer"
                                className="underline underline-offset-2"
                                onClick={(e) => e.stopPropagation()}
                              >
                                {serpEntry.featured_snippet_url.replace(/^https?:\/\//, "").slice(0, 40)}
                                {serpEntry.featured_snippet_url.length > 48 ? "…" : ""}
                              </a>
                            ) : (
                              "None"
                            )}
                          </span>
                        </Badge>
                        <Badge variant="outline" className="text-[10px] font-normal">
                          {typeof serpEntry.our_serp_rank === "number"
                            ? `Our rank: #${serpEntry.our_serp_rank}`
                            : "Not in snapshot"}
                        </Badge>
                      </div>
                    ) : (
                      <p className="text-[11px] text-muted-foreground">No SERP features cached yet.</p>
                    )}
                    {serpEntry && serpEntry.organic.length > 0 ? (
                      <Collapsible
                        open={serpFeaturesAdvancedOpen}
                        onOpenChange={setSerpFeaturesAdvancedOpen}
                      >
                        <CollapsibleTrigger
                          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                          data-testid="button-serp-organic-advanced"
                        >
                          <ChevronDown
                            className={`h-3 w-3 transition-transform ${serpFeaturesAdvancedOpen ? "rotate-180" : ""}`}
                          />
                          Read more (advanced)
                        </CollapsibleTrigger>
                        <CollapsibleContent className="mt-1 space-y-0.5 font-mono text-[10px] text-muted-foreground">
                          {serpEntry.organic.slice(0, 5).map((hit) => (
                            <p key={`${hit.rank}-${hit.url}`} className="truncate" title={hit.url}>
                              #{hit.rank} {hit.url}
                            </p>
                          ))}
                        </CollapsibleContent>
                      </Collapsible>
                    ) : null}
                  </div>
                  <OpenRushFetchControl
                    kind="serp"
                    queryLabel={mainKeywordForSerp || "this keyword"}
                    openrushConfigured={openrushSerpConfigured}
                    fetchedAt={serpEntry?.fetched_at}
                    stale={serpSnapshot?.stale}
                    loading={refreshingSerp}
                    data-testid="button-openrush-serp"
                    dialogTestId="dialog-openrush-serp"
                    onBeforeOpen={async () => {
                      const fresh = await refetchEntrySerp();
                      if ((fresh.data?.main_keyword || "").trim()) return true;
                      toast({
                        title: "No keyword yet",
                        description: "Set a main keyword on the Keywords tab first.",
                        variant: "destructive",
                      });
                      return false;
                    }}
                    onConfirm={handleRequestSerp}
                  />
                </div>
                <Collapsible open={serpAdvancedOpen} onOpenChange={setSerpAdvancedOpen}>
                  <CollapsibleTrigger
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                    data-testid="button-serp-advanced"
                  >
                    <ChevronDown
                      className={`h-3.5 w-3.5 transition-transform ${serpAdvancedOpen ? "rotate-180" : ""}`}
                    />
                    Read more (advanced)
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-1 space-y-0.5 font-mono text-[11px]">
                    <p>meta.page_title / meta.description / meta.og_image</p>
                    <p>{"Sections may read {{ meta.page_title }}, {{ meta.description }}, etc."}</p>
                    <p>.cache/{"{site}"}/openrush-serp.json</p>
                    <p>POST /api/seo/serp/refresh</p>
                  </CollapsibleContent>
                </Collapsible>
              </div>

              {/* Search Snippet */}
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <h4 className="text-sm font-semibold">This is how your page looks when shared</h4>
                </div>

                {!snippetEditing ? (
                  /* ── Preview card ── */
                  <div className="space-y-3">
                    {/* Google SERP preview */}
                    <div
                      className="relative rounded-md border bg-background px-4 py-3 pr-10 space-y-0.5 cursor-pointer hover-elevate"
                      onClick={() => setSnippetEditing(true)}
                      data-testid="card-serp-preview"
                      title="Click to edit"
                    >
                      <div
                        className="absolute top-2 right-2 z-10"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6"
                          onClick={() => setSnippetEditing(true)}
                          data-testid="button-toggle-snippet-edit"
                          title="Edit snippet"
                          aria-label="Edit snippet"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                      <p className="text-[11px] text-[#0d652d] dark:text-[#81c995] truncate" data-testid="text-serp-breadcrumb">
                        {snippetBreadcrumb || "your-site.com"}
                      </p>
                      <p className="text-sm font-medium text-[#1558d6] dark:text-[#8ab4f8] leading-snug line-clamp-1" data-testid="text-serp-title">
                        {resolvedPageTitle || <span className="text-muted-foreground italic font-normal">No title set — click to edit</span>}
                      </p>
                      <p className="text-xs text-[#4d5156] dark:text-[#bdc1c6] line-clamp-2 leading-relaxed" data-testid="text-serp-description">
                        {resolvedDescription || <span className="italic">No description set — click to edit</span>}
                      </p>
                    </div>

                    {/* Social / OG card preview */}
                    <div
                      className="rounded-md border overflow-hidden cursor-pointer hover-elevate"
                      onClick={() => setSnippetEditing(true)}
                      data-testid="card-og-preview"
                      title="Click to edit snippet"
                    >
                      <div className="bg-muted flex items-center justify-center overflow-hidden" style={{ aspectRatio: "1200/630", maxHeight: "140px" }}>
                        {seoMeta.og_image && !ogImageError ? (
                          <img
                            src={seoMeta.og_image}
                            alt="og:image preview"
                            className="object-cover w-full h-full"
                            onError={() => { setOgImageError(true); setOgImageTooSmall(false); }}
                            onLoad={(e) => {
                              const img = e.currentTarget;
                              setOgImageTooSmall(img.naturalWidth < 1200 || img.naturalHeight < 630);
                            }}
                            data-testid="img-og-image-preview"
                          />
                        ) : (
                          <div className="flex flex-col items-center gap-1.5 text-muted-foreground">
                            <Image className="h-6 w-6" />
                            <p className="text-xs">{ogImageError ? "Could not load image" : "No social image set"}</p>
                          </div>
                        )}
                      </div>
                      <div className="px-3 py-2 border-t bg-muted/40">
                        <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{snippetDomain || "your-site.com"}</p>
                        <p className="text-xs font-medium line-clamp-1 text-foreground mt-0.5" data-testid="text-og-card-title">
                          {resolvedPageTitle || <span className="text-muted-foreground italic font-normal">No title</span>}
                        </p>
                        <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5" data-testid="text-og-card-description">
                          {resolvedDescription || ""}
                        </p>
                      </div>
                    </div>
                    {ogImageTooSmall && !ogImageError && seoMeta.og_image && (
                      <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1" data-testid="text-og-image-too-small">
                        <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                        Social image is smaller than 1200×630 px — it may appear blurry or cropped.
                      </p>
                    )}
                  </div>
                ) : (
                  /* ── Edit form ── */
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium text-foreground">Edit share preview</p>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 shrink-0"
                        onClick={() => {
                          onRevertSnippet?.();
                          setSnippetEditing(false);
                        }}
                        data-testid="button-cancel-snippet-edit"
                        title="Cancel"
                        aria-label="Cancel snippet edit"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-foreground" htmlFor="seo-page-title">
                        Page Title
                      </label>
                      <input
                        id="seo-page-title"
                        type="text"
                        value={seoMeta.page_title}
                        onChange={(e) => setSeoMeta({ ...seoMeta, page_title: e.target.value })}
                        placeholder="e.g. Full Stack Developer Program | 4Geeks"
                        className="w-full px-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring font-mono text-[13px]"
                        data-testid="input-seo-page-title"
                        autoFocus
                      />
                      {seoMeta.page_title.includes("{{") && (
                        <p className="text-xs text-muted-foreground" data-testid="text-seo-title-resolved-preview">
                          Looks like: {resolvedPageTitle.includes("{{") ? "…" : resolvedPageTitle}
                        </p>
                      )}
                      <p className={`text-xs ${(resolvedPageTitle.includes("{{") ? seoMeta.page_title.length : resolvedPageTitle.length) > 60 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                        {(resolvedPageTitle.includes("{{") ? seoMeta.page_title.length : resolvedPageTitle.length)}/60 characters (recommended)
                        {seoMeta.page_title.includes("{{") ? " after variables resolve" : ""}
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-foreground" htmlFor="seo-description">
                        Description
                      </label>
                      <textarea
                        id="seo-description"
                        value={seoMeta.description}
                        onChange={(e) => setSeoMeta({ ...seoMeta, description: e.target.value })}
                        placeholder="e.g. Learn full stack development with unlimited mentorship..."
                        rows={3}
                        className="w-full px-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring resize-none font-mono text-[13px]"
                        data-testid="input-seo-description"
                      />
                      {seoMeta.description.includes("{{") && (
                        <p className="text-xs text-muted-foreground" data-testid="text-seo-description-resolved-preview">
                          Looks like: {resolvedDescription.includes("{{") ? "…" : resolvedDescription}
                        </p>
                      )}
                      <p className={`text-xs ${(resolvedDescription.includes("{{") ? seoMeta.description.length : resolvedDescription.length) > 160 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>
                        {(resolvedDescription.includes("{{") ? seoMeta.description.length : resolvedDescription.length)}/160 characters (recommended)
                        {seoMeta.description.includes("{{") ? " after variables resolve" : ""}
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-foreground" htmlFor="seo-og-image">
                        Social Image (og:image)
                      </label>
                      <div className="flex gap-2 flex-wrap">
                        <input
                          id="seo-og-image"
                          type="url"
                          value={seoMeta.og_image}
                          onChange={(e) => {
                            setSeoMeta({ ...seoMeta, og_image: e.target.value });
                            setOgImageError(false);
                            setOgImageTooSmall(false);
                          }}
                          placeholder="e.g. https://4geeks.com/images/social-preview.jpg"
                          className="flex-1 min-w-0 px-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                          data-testid="input-seo-og-image"
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          onClick={() => setImagePickerOpen(true)}
                          data-testid="button-seo-og-image-picker"
                        >
                          <Image className="h-4 w-4 mr-1.5" />
                          Choose from gallery
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Recommended size: 1200×630 px.
                      </p>
                      {seoMeta.og_image && (
                        <>
                          <div className="mt-1.5 rounded-md border bg-muted max-h-[120px] flex items-center justify-center overflow-hidden" style={{ aspectRatio: "1200/630" }}>
                            {ogImageError ? (
                              <p className="text-xs text-muted-foreground px-4 text-center" data-testid="text-og-image-error">
                                Could not load image — check that the URL is publicly accessible.
                              </p>
                            ) : (
                              <img
                                src={seoMeta.og_image}
                                alt="og:image preview"
                                className="object-cover w-full h-full"
                                onError={() => { setOgImageError(true); setOgImageTooSmall(false); }}
                                onLoad={(e) => {
                                  const img = e.currentTarget;
                                  setOgImageTooSmall(img.naturalWidth < 1200 || img.naturalHeight < 630);
                                }}
                                data-testid="img-og-image-preview"
                              />
                            )}
                          </div>
                          {ogImageTooSmall && !ogImageError && (
                            <p className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1 mt-1" data-testid="text-og-image-too-small">
                              <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                              Image is smaller than the recommended 1200×630 px — it may appear blurry or cropped when shared on social media.
                            </p>
                          )}
                        </>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                    <Button
                      size="sm"
                      disabled={
                        !snippetDirty || !!saving.snippet || snippetSaveBlocked
                      }
                      onClick={() => {
                        void (async () => {
                          try {
                            await onSaveSnippet();
                            setSnippetEditing(false);
                          } catch {
                            /* stay in edit mode */
                          }
                        })();
                      }}
                      data-testid="button-save-snippet"
                    >
                      {saving.snippet ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                      Save snippet
                    </Button>
                    {snippetSaveBlocked ? (
                      <p className="text-xs text-amber-600 dark:text-amber-400 self-center">
                        Title and description cannot be empty on a live locale.
                      </p>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!!saving.snippet}
                      onClick={() => {
                        onRevertSnippet?.();
                        setSnippetEditing(false);
                      }}
                      data-testid="button-snippet-cancel"
                    >
                      Cancel
                    </Button>
                    </div>
                  </div>
                )}
              </div>
            </TabsContent>

            {/* ── Fields tab ─────────────────────────────────────────── */}
            <TabsContent value="fields" className="min-w-0 pt-1">
              {contentInfo.type && contentInfo.slug ? (
                <MappingFieldsTab
                  contentType={contentInfo.type}
                  slug={contentInfo.slug}
                  locale={fieldsLocale}
                  typeLabel={fieldsTypeLabel}
                  variant={fieldsVariant}
                  hideSeoFields
                  onOpenSeoMeta={() => setActiveTab("serp")}
                  portalContainer={dialogContainer}
                  onSaved={onSaved}
                />
              ) : (
                <p className="text-sm text-muted-foreground pt-4">
                  Open from a content entry to manage content-type fields.
                </p>
              )}
            </TabsContent>

            {/* ── Funnel tab ─────────────────────────────────────────── */}
            <TabsContent value="funnel" className="min-w-0 pt-1">
              <FunnelTab
                contentInfo={contentInfo}
                contentTypeLabel={fieldsTypeLabel}
                portalContainer={dialogContainer}
                locale={fieldsLocale}
                variant={fieldsVariant}
                onSaved={onSaved}
              />
            </TabsContent>

            {/* ── Schema tab (read-only preview) ─────────────────────── */}
            <TabsContent value="schema" className="min-w-0 space-y-6 pt-4">
              <div className="rounded-md border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground space-y-2" data-testid="banner-schema-education">
                <p className="text-foreground font-medium flex items-center gap-1.5">
                  <Info className="h-3.5 w-3.5 shrink-0" />
                  How Schema.org works on this page
                </p>
                <p>
                  Schema.org comes from leading <code className="font-mono">schema_org</code> sections plus FAQ, Article, and Breadcrumb contributors.
                  Site Organization/Website in <code className="font-mono">schema-org.yml</code> are templates (prefill + dual-emit + social defaults).
                  WebSite/Organization belong on the home page as <code className="font-mono">schema_org</code> sections; elsewhere they are page-local overrides. Course hero needs a Course companion section.
                </p>
                <p>
                  On a live page, missing companions (Course, LocalBusiness, etc.) show as Diagnostics / validation errors — Add Section is not blocked by that rule.
                  Publish and promote still require companions and required SEO. This tab is a read-only preview of resolved JSON-LD. Edit sections on the page (or SEO &amp; GEO → Schema.org for site templates) — legacy <code className="font-mono">schema.include</code> is removed and ignored.
                </p>
                <Collapsible open={schemaAdvancedOpen} onOpenChange={setSchemaAdvancedOpen}>
                  <CollapsibleTrigger asChild>
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline inline-flex items-center gap-1"
                      data-testid="button-schema-read-more"
                    >
                      Read more (advanced)
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${schemaAdvancedOpen ? "rotate-180" : ""}`} />
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="pt-2 space-y-0.5 font-mono text-[11px]">
                    <p>shared/component-registry/schema_org/v1.0/</p>
                    <p>server/schema-components/</p>
                    <p>shared/schema-org-sections.ts</p>
                    <p>server/schema-org-seed.ts</p>
                    <p>schema-org.yml</p>
                    <p>client/src/components/settings/SchemaOrgTab.tsx</p>
                    <p>shared/validationScope.ts</p>
                    <p>server/live-entry-seo-gate.ts</p>
                    <p>scripts/validation/validators/schema-org-companions.ts</p>
                  </CollapsibleContent>
                </Collapsible>
              </div>

              {(() => {
                const previewDocs = resolveSchemaPreviewDocs(seoData);
                if (previewDocs.length === 0) {
                  return (
                    <div className="rounded-md border border-dashed px-3 py-6 text-center space-y-1" data-testid="empty-schema-documents">
                      <p className="text-sm text-foreground">No JSON-LD documents on this page yet</p>
                      <p className="text-xs text-muted-foreground">
                        Add a leading <code className="font-mono">schema_org</code> section (or FAQ / Article / Breadcrumb) to emit structured data.
                      </p>
                    </div>
                  );
                }
                return (
                  <div className="space-y-3" data-testid="list-schema-documents">
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-semibold">Resolved JSON-LD</h4>
                      <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                        {previewDocs.length} document{previewDocs.length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    {previewDocs.map((doc, i) => {
                      const typeLabel = String(doc.schema["@type"] ?? "Document");
                      const expanded = expandedSchemaDocs[i] ?? false;
                      return (
                        <div key={i} className="rounded-md border overflow-hidden" data-testid={`schema-document-${i}`}>
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedSchemaDocs((prev) => ({ ...prev, [i]: !expanded }))
                            }
                            className="flex items-center gap-2 w-full text-left px-3 py-2 hover-elevate"
                            data-testid={`button-toggle-schema-doc-${i}`}
                          >
                            {expanded ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                            )}
                            <span className="text-sm font-medium font-mono truncate">{typeLabel}</span>
                            <span
                              className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium uppercase tracking-wide"
                              data-testid={`badge-schema-source-${doc.source}`}
                            >
                              {doc.source}
                            </span>
                          </button>
                          {expanded && (
                            <pre
                              className="bg-muted/60 p-3 text-xs font-mono max-h-[240px] overflow-y-auto whitespace-pre-wrap break-all border-t"
                              data-testid={`text-schema-doc-preview-${i}`}
                            >
                              {JSON.stringify(doc.schema, null, 2)}
                            </pre>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </TabsContent>

            {/* ── Visibility tab ─────────────────────────────────────── */}
            <TabsContent value="visibility" className="min-w-0 space-y-6 pt-4">
              <div className="rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground space-y-1">
                <p>
                  <strong>Locations</strong> save automatically to <code className="font-mono">_common.yml</code>.
                  Robots, priority, and change frequency patch <code className="font-mono">meta.*</code> on the locale
                  file — no republish required.
                </p>
                <Collapsible>
                  <CollapsibleTrigger className="flex items-center gap-1 text-muted-foreground hover:text-foreground">
                    <ChevronDown className="h-3.5 w-3.5" />
                    Read more (advanced)
                  </CollapsibleTrigger>
                  <CollapsibleContent className="text-muted-foreground mt-1 space-y-0.5 font-mono">
                    <p>server/routes/seo.ts — update-locations</p>
                    <p>server/live-entry-seo-gate.ts — micro validation scope</p>
                  </CollapsibleContent>
                </Collapsible>
              </div>

              {/* Crawl & sitemap settings */}
              <div className="space-y-3">
                {!visibilityEditing ? (
                  <div
                    className="relative rounded-md border bg-background px-4 py-3 pr-10 space-y-2 cursor-pointer hover-elevate"
                    onClick={() => setVisibilityEditing(true)}
                    data-testid="card-visibility-settings"
                    title="Click to edit"
                  >
                    <div
                      className="absolute top-2 right-2 z-10"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6"
                        onClick={() => setVisibilityEditing(true)}
                        data-testid="button-edit-visibility"
                        title="Edit crawl & sitemap settings"
                        aria-label="Edit crawl and sitemap settings"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-[7rem_1fr] text-xs">
                      <span className="text-muted-foreground">Robots</span>
                      <span className="font-mono text-foreground" data-testid="text-visibility-robots">
                        {formatRobotsDisplay(seoMeta.robots)}
                      </span>
                      <span className="text-muted-foreground">Priority</span>
                      <span className="font-mono text-foreground" data-testid="text-visibility-priority">
                        {formatPriorityDisplay(seoMeta.priority)}
                      </span>
                      <span className="text-muted-foreground">Change frequency</span>
                      <span className="font-mono text-foreground capitalize" data-testid="text-visibility-change-frequency">
                        {formatChangeFrequencyDisplay(seoMeta.change_frequency)}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="rounded-md border bg-background px-4 py-3 space-y-4" data-testid="form-visibility-settings">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <h4 className="text-sm font-semibold">Crawl &amp; sitemap settings</h4>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Robots directive, sitemap priority, and change frequency for this locale.
                        </p>
                      </div>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-6 w-6 shrink-0"
                        onClick={() => {
                          onRevertVisibility?.();
                          setVisibilityEditing(false);
                        }}
                        data-testid="button-cancel-visibility-edit"
                        title="Cancel"
                        aria-label="Cancel visibility edit"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>

                    <div className="space-y-1.5">
                      <p className="text-xs font-medium text-foreground">Robots</p>
                      <p className="text-xs text-muted-foreground">
                        Control how search engines crawl and index this page.
                      </p>
                      <div className="space-y-1.5" data-testid="select-seo-robots">
                        {ROBOTS_OPTIONS.map(({ value, label, description }) => (
                          <label
                            key={value}
                            className={`flex items-start gap-2.5 rounded-md border px-3 py-2 cursor-pointer hover-elevate ${seoMeta.robots === value ? "border-ring bg-muted/50" : ""}`}
                            data-testid={`option-seo-robots-${value || "default"}`}
                          >
                            <input
                              type="radio"
                              name="seo-robots"
                              value={value}
                              checked={seoMeta.robots === value}
                              onChange={() => setSeoMeta({ ...seoMeta, robots: value })}
                              className="mt-0.5 shrink-0"
                            />
                            <div className="space-y-0.5">
                              <p className="text-xs font-mono font-medium text-foreground leading-none">
                                {label}
                                {value === "" && (
                                  <span className="ml-1.5 text-muted-foreground font-sans font-normal">(default)</span>
                                )}
                              </p>
                              <p className="text-xs text-muted-foreground">{description}</p>
                            </div>
                          </label>
                        ))}
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-foreground" htmlFor="seo-priority">
                        Priority
                      </label>
                      <input
                        id="seo-priority"
                        type="number"
                        min={0}
                        max={1}
                        step={0.1}
                        value={seoMeta.priority}
                        onChange={(e) => setSeoMeta({ ...seoMeta, priority: e.target.value })}
                        placeholder="e.g. 0.8"
                        className="w-full px-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                        data-testid="input-seo-priority"
                      />
                      <p className="text-xs text-muted-foreground">
                        Sitemap crawl priority (0.0–1.0). Leave empty to use the default.
                      </p>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-xs font-medium text-foreground" htmlFor="seo-change-frequency">
                        Change Frequency
                      </label>
                      <select
                        id="seo-change-frequency"
                        value={seoMeta.change_frequency}
                        onChange={(e) => setSeoMeta({ ...seoMeta, change_frequency: e.target.value })}
                        className="w-full px-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                        data-testid="select-seo-change-frequency"
                      >
                        <option value="">Default</option>
                        <option value="always">always</option>
                        <option value="hourly">hourly</option>
                        <option value="daily">daily</option>
                        <option value="weekly">weekly</option>
                        <option value="monthly">monthly</option>
                        <option value="yearly">yearly</option>
                        <option value="never">never</option>
                      </select>
                      <p className="text-xs text-muted-foreground">
                        How frequently the page content is likely to change. Used in the sitemap.
                      </p>
                    </div>

                    <div className="flex flex-wrap gap-2 pt-1">
                      <Button
                        size="sm"
                        disabled={!visibilityDirty || !!saving.visibility}
                        onClick={() => {
                          void (async () => {
                            try {
                              await onSaveVisibility();
                              setVisibilityEditing(false);
                            } catch {
                              /* stay in edit mode */
                            }
                          })();
                        }}
                        data-testid="button-save-visibility"
                      >
                        {saving.visibility ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : null}
                        Save visibility settings
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={!!saving.visibility}
                        onClick={() => {
                          onRevertVisibility?.();
                          setVisibilityEditing(false);
                        }}
                        data-testid="button-cancel-visibility"
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </div>

              {saving.locations ? (
                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Saving locations…
                </div>
              ) : null}

              {/* Locations (landing pages only) */}
              {contentInfo.type === "landing" && seoAvailableLocations.length > 0 && (
                <div className="space-y-3">
                  <div>
                    <h4 className="text-sm font-semibold flex items-center gap-2">
                      Locations
                      <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground font-medium">
                        {seoLocations.length === 0 ? "All (session-based)" : `${seoLocations.length} selected`}
                      </span>
                    </h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Choose which campus locations appear on this landing page. If none are selected, the visitor's nearest location is used automatically.
                      {" "}Locations always live in <code className="font-mono">_common.yml</code> (entry-wide — not per variant).
                    </p>
                  </div>

                  {seoLocations.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {seoLocations.map((locSlug) => {
                        const locInfo = seoAvailableLocations.find(l => l.slug === locSlug);
                        return (
                          <span
                            key={locSlug}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md bg-muted text-sm"
                            data-testid={`chip-location-${locSlug}`}
                          >
                            <span className="truncate max-w-[180px]">
                              {locInfo ? `${locInfo.city}, ${locInfo.country}` : locSlug}
                            </span>
                            <button
                              onClick={() => setSeoLocations(prev => prev.filter(s => s !== locSlug))}
                              className="ml-0.5 rounded-sm hover-elevate"
                              data-testid={`button-remove-location-${locSlug}`}
                            >
                              <X className="h-3.5 w-3.5 text-muted-foreground" />
                            </button>
                          </span>
                        );
                      })}
                      <button
                        onClick={() => setSeoLocations([])}
                        className="text-xs text-muted-foreground hover:text-foreground underline"
                        data-testid="button-clear-all-locations"
                      >
                        Clear all
                      </button>
                    </div>
                  )}

                  <div className="space-y-1.5">
                    <input
                      type="text"
                      value={seoLocationSearch}
                      onChange={(e) => setSeoLocationSearch(e.target.value)}
                      placeholder="Search locations..."
                      className="w-full px-3 py-2 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                      data-testid="input-location-search"
                    />
                    <div className="max-h-[160px] overflow-y-auto rounded-md border">
                      {seoAvailableLocations
                        .filter(loc => {
                          if (seoLocations.includes(loc.slug)) return false;
                          if (!seoLocationSearch) return true;
                          const q = seoLocationSearch.toLowerCase();
                          return loc.name.toLowerCase().includes(q)
                            || loc.city.toLowerCase().includes(q)
                            || loc.country.toLowerCase().includes(q)
                            || loc.slug.toLowerCase().includes(q);
                        })
                        .map(loc => (
                          <button
                            key={loc.slug}
                            onClick={() => setSeoLocations(prev => [...prev, loc.slug])}
                            className="flex items-center gap-2 w-full text-left px-3 py-1.5 text-sm hover-elevate"
                            data-testid={`button-add-location-${loc.slug}`}
                          >
                            <MapPin className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                            <span>{loc.city}, {loc.country}</span>
                            <span className="text-xs text-muted-foreground ml-auto">{loc.slug}</span>
                          </button>
                        ))
                      }
                      {seoAvailableLocations.filter(loc => {
                        if (seoLocations.includes(loc.slug)) return false;
                        if (!seoLocationSearch) return true;
                        const q = seoLocationSearch.toLowerCase();
                        return loc.name.toLowerCase().includes(q)
                          || loc.city.toLowerCase().includes(q)
                          || loc.country.toLowerCase().includes(q)
                          || loc.slug.toLowerCase().includes(q);
                      }).length === 0 && (
                        <p className="px-3 py-2 text-xs text-muted-foreground">
                          {seoLocationSearch ? "No matching locations" : "All locations already added"}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>

            {/* ── Redirects tab ──────────────────────────────────────── */}
            <TabsContent value="redirects" className="min-w-0 space-y-4 pt-4">
              <div>
                <h4 className="text-sm font-semibold">Redirects</h4>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Old URL paths that should redirect to this page (301). Each entry is a path relative to the site root, e.g. <code className="font-mono bg-muted px-1 rounded">/old-page-slug</code>.
                </p>
              </div>

              {liveUrlHijacked && liveProbePath && (
                <LiveUrlRedirectHijackBanner
                  livePath={liveProbePath}
                  destination={hijackDest || undefined}
                  sourceLabel={hijackSource || undefined}
                />
              )}

              {isVariantContext && (
                <div
                  className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-muted-foreground"
                  data-testid="banner-seo-redirects-variant"
                >
                  If you edit redirects on this variant, they apply only to this variant and you lose inherited
                  LIVE redirects. Edit LIVE if you want redirects for all.
                </div>
              )}

              {seoMeta.redirects.length > 0 ? (
                <div className="min-w-0 space-y-1.5">
                  {seoMeta.redirects.map((redirect, idx) => (
                    <div
                      key={idx}
                      className="flex min-w-0 items-start gap-2 px-2.5 py-1.5 rounded-md border bg-muted/40 text-sm font-mono"
                      data-testid={`row-redirect-${idx}`}
                    >
                      <span className="min-w-0 flex-1 break-all text-xs" title={redirect}>{redirect}</span>
                      <button
                        onClick={() => setSeoMeta({ ...seoMeta, redirects: seoMeta.redirects.filter((_, i) => i !== idx) })}
                        className="mt-0.5 shrink-0 rounded-sm hover-elevate"
                        data-testid={`button-remove-redirect-${idx}`}
                      >
                        <X className="h-3.5 w-3.5 text-muted-foreground" />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}

              <p className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="text-redirects-note">
                <Info className="h-3.5 w-3.5 shrink-0" />
                To add or update redirects, visit the{" "}
                <a
                  href="/private/redirects"
                  className="underline underline-offset-2 hover:text-foreground transition-colors"
                  data-testid="link-redirects-page"
                >
                  Redirects page
                </a>.
              </p>
            </TabsContent>
          </Tabs>
        ) : (
          <div className="flex flex-col items-center justify-center py-12 gap-3">
            <AlertTriangle className="h-6 w-6 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">Could not load SEO data for this page.</p>
          </div>
        )}

      </DialogContent>
    </Dialog>

    <ImagePickerDialog
      open={imagePickerOpen}
      onOpenChange={setImagePickerOpen}
      title="Choose Social Image"
      defaultTagFilter="og-image"
      ensureTagsOnSave={[...OG_IMAGE_ENSURE_TAGS]}
      initialSrc={seoMeta.og_image}
      onSave={(src) => {
        setSeoMeta({ ...seoMeta, og_image: src });
        setOgImageError(false);
        setOgImageTooSmall(false);
        void onSaveOgImage(src);
      }}
    />
    </>
  );
}
