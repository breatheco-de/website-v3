import { useState } from "react";
import { useSearch } from "wouter";
import { deslugify } from "../utils/debugHelpers";
import { IconArrowLeft, IconGitBranch, IconRefresh, IconPencil, IconCheck, IconX, IconPlayerPlay, IconPlus, IconHistory, IconExternalLink, IconArrowBackUp, IconCrown, IconTrash, IconDots, IconCode, IconShare, IconCopy, IconEyeOff } from "@tabler/icons-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Link2, Loader2, Unlink } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { getDebugToken } from "@/hooks/useDebugAuth";
import { emitVariantCreated, emitVariantDeleted, emitVariantPromoted } from "@/lib/contentEvents";
import { TEMPLATE_VERSIONING_SLUG, versioningContentSlug } from "@/lib/sharedLayoutEntry";
import type { MenuView, ContentInfo, VersioningResponse } from "../types";
import { STORAGE_KEY, OPEN_STORAGE_KEY } from "../types";
import { PageHealthIndicators } from "./PageHealthIndicators";
import type { PageErrorsTab } from "./PageErrorsModal";

interface VersioningViewProps {
  setMenuView: (v: MenuView) => void;
  contentInfo: ContentInfo;
  versioningLoading: boolean;
  versioningData: VersioningResponse | null;
  navigate: (path: string) => void;
  pathname: string;
  onVersioningDataUpdate?: (data: VersioningResponse) => void;
  onEditVariantYaml: (locale: string, variantSlug: string) => void;
  onEditDefaultYaml?: (locale: string) => void;
  onRequestDeletePage?: (opts: { locale: string; liveLocales: string[] }) => void;
  onOpenTemplateYaml?: () => void;
  detachBusy?: boolean;
  onRequestDetach?: () => void;
  onRequestReattach?: () => void;
  pageErrorCount?: number;
  pageWarningCount?: number;
  pageDiagnosticsLoading?: boolean;
  pageDiagnosticsUrl?: string | null;
  onOpenPageErrors?: (tab: PageErrorsTab) => void;
}

function DefaultLiveRowActions({
  locale,
  allocation,
  isTemplateVersioning,
  onShare,
  onConvert,
  onEditYaml,
  onDelete,
}: {
  locale: string;
  allocation: number;
  isTemplateVersioning: boolean;
  onShare: () => void;
  onConvert: () => void;
  onEditYaml?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex items-center gap-1.5 flex-shrink-0">
      <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
        {allocation}%
      </span>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5 shrink-0"
              onClick={onShare}
              data-testid={`button-share-variant-${locale}-default`}
            >
              <IconShare className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>Share live URL</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <TooltipProvider delayDuration={300}>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-5 w-5 shrink-0"
              onClick={onConvert}
              data-testid={`button-convert-to-draft-${locale}`}
            >
              <IconEyeOff className="h-3 w-3" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top">
            <p>{isTemplateVersioning ? "Detach first to convert this entry to draft" : "Convert to draft"}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            variant="ghost"
            className="h-5 w-5 shrink-0"
            data-testid={`button-variant-menu-${locale}-default`}
          >
            <IconDots className="h-3 w-3" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-48">
          {onEditYaml && (
            <DropdownMenuItem
              onClick={onEditYaml}
              className="text-[13px]"
              data-testid={`menu-edit-yaml-variant-${locale}-default`}
            >
              <IconCode className="h-3.5 w-3.5 mr-2" />
              Edit YAML
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={onConvert}
            className="text-[13px]"
            data-testid={`menu-convert-to-draft-${locale}-default`}
          >
            <IconEyeOff className="h-3.5 w-3.5 mr-2" />
            Convert to draft
          </DropdownMenuItem>
          {onDelete && (
            <DropdownMenuItem
              onClick={onDelete}
              className="text-[13px] text-destructive"
              data-testid={`menu-delete-${locale}-default`}
            >
              <IconTrash className="h-3.5 w-3.5 mr-2" />
              Delete
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

export function VersioningView({
  setMenuView,
  contentInfo,
  versioningLoading,
  versioningData,
  navigate,
  pathname,
  onVersioningDataUpdate,
  onEditVariantYaml,
  onEditDefaultYaml,
  onRequestDeletePage,
  onOpenTemplateYaml,
  detachBusy,
  onRequestDetach,
  onRequestReattach,
  pageErrorCount = 0,
  pageWarningCount = 0,
  pageDiagnosticsLoading = false,
  pageDiagnosticsUrl,
  onOpenPageErrors,
}: VersioningViewProps) {
  const { toast } = useToast();
  const locales = versioningData?.versioning ? Object.keys(versioningData.versioning) : [];
  const dialogLocales = locales.length > 0 ? locales : (versioningData?.availableLocales ?? ["en"]);

  const isSharedLayout = !!versioningData?.isSharedLayout;
  const isDetached = !!versioningData?.detached;
  // Template versioning only when attached shared-layout (API returns versioningSlug "single")
  const isTemplateVersioning =
    isSharedLayout && !isDetached && versioningData?.versioningSlug === TEMPLATE_VERSIONING_SLUG;
  // Mutations use the resolved slug from the API; never guess "single" while detached
  const versioningWriteSlug =
    versioningData?.versioningSlug ||
    (contentInfo.slug
      ? versioningContentSlug(contentInfo.slug, {
          isSharedLayout,
          isDetached,
        })
      : contentInfo.slug) ||
    "";
  const versionsTitle = isTemplateVersioning ? "Template Versions" : "Page Details";
  const contentTypeLabel = contentInfo.label || contentInfo.type || "entries";
  const isDraftEntry = !!versioningData?.isDraft || versioningData?.hasLiveDefault === false;
  const liveLocales = (() => {
    const byLocale = versioningData?.liveByLocale;
    if (byLocale) {
      const live = Object.entries(byLocale)
        .filter(([, isLive]) => isLive)
        .map(([loc]) => loc);
      if (live.length > 0) return live;
    }
    if (versioningData?.hasLiveDefault) {
      return versioningData.availableLocales ?? [];
    }
    return [] as string[];
  })();
  const availableVariantCount = (() => {
    if (!versioningData?.versioning) return 0;
    let total = 0;
    for (const locale of Object.keys(versioningData.versioning)) {
      total += versioningData.versioning[locale].variants.length;
    }
    if (!isDraftEntry) {
      total += Object.keys(versioningData.versioning).length;
    }
    return total;
  })();

  const searchString = useSearch();
  const activeVariant = new URLSearchParams(searchString).get("variant") ?? null;

  const [editingLocale, setEditingLocale] = useState<string | null>(null);
  const [tempAllocations, setTempAllocations] = useState<Record<string, number>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [savedLocale, setSavedLocale] = useState<string | null>(null);

  const [createVersionOpen, setCreateVersionOpen] = useState(false);
  const [createVersionSlug, setCreateVersionSlug] = useState("");
  const [createVersionLocale, setCreateVersionLocale] = useState("en");
  const [isCreatingVersion, setIsCreatingVersion] = useState(false);

  const [shareTarget, setShareTarget] = useState<{ locale: string; slug: string | null } | null>(null);

  const [promoteTarget, setPromoteTarget] = useState<{ locale: string; slug: string } | null>(null);
  const [isPromoting, setIsPromoting] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<{ locale: string; slug: string; allocation: number } | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const [convertTarget, setConvertTarget] = useState<string | null>(null);
  const [isConverting, setIsConverting] = useState(false);
  const [showDetachForConvert, setShowDetachForConvert] = useState(false);

  const [showRestorePanel, setShowRestorePanel] = useState(false);
  const [restoreHistory, setRestoreHistory] = useState<Array<{ sha: string; date: string; author: string; subject: string }>>([]);
  const [restoreHistoryLoading, setRestoreHistoryLoading] = useState(false);
  const [repoUrl, setRepoUrl] = useState<string | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<string | null>(null);
  const [isRestoring, setIsRestoring] = useState(false);
  const [publishConfirmVariants, setPublishConfirmVariants] = useState<string[] | null>(null);
  const [allocationSaveError, setAllocationSaveError] = useState<string | null>(null);

  const isPreview = pathname.startsWith("/private/preview/");

  const persistOpenStateForNavigation = () => {
    if (typeof window !== "undefined") {
      sessionStorage.setItem(OPEN_STORAGE_KEY, "true");
      sessionStorage.setItem(STORAGE_KEY, "versioning");
    }
  };

  const buildPublicPath = (type: string, slug: string, locale: string): string => {
    if (type === "program") return `/${locale}/career-programs/${slug}`;
    if (type === "location") return `/${locale}/location/${slug}`;
    if (type === "landing") return `/landing/${slug}`;
    return `/${locale}/${slug}`;
  };

  const handleSwitchVariant = (locale: string, variantSlug: string) => {
    persistOpenStateForNavigation();
    if (isPreview && contentInfo.type && contentInfo.slug) {
      navigate(
        `/private/preview/${contentInfo.type}/${contentInfo.slug}?variant=${encodeURIComponent(variantSlug)}&locale=${locale}`
      );
    } else {
      const { type, slug } = contentInfo;
      if (!type || !slug) return;
      const basePath = buildPublicPath(type, slug, locale);
      window.location.href = `${basePath}?force_variant=${encodeURIComponent(variantSlug)}`;
    }
  };

  const handleEditVariant = (locale: string, variantSlug: string) => {
    const { type, slug } = contentInfo;
    if (!type || !slug) return;
    persistOpenStateForNavigation();
    navigate(
      `/private/preview/${type}/${slug}?variant=${encodeURIComponent(variantSlug)}&locale=${locale}`
    );
  };

  const handleSwitchToDefault = (locale: string) => {
    persistOpenStateForNavigation();
    if (isPreview && contentInfo.type && contentInfo.slug) {
      navigate(`/private/preview/${contentInfo.type}/${contentInfo.slug}?locale=${locale}`);
    } else {
      const { type, slug } = contentInfo;
      if (!type || !slug) return;
      window.location.href = buildPublicPath(type, slug, locale);
    }
  };

  const handleEditDefault = (locale: string) => {
    const { type, slug } = contentInfo;
    if (!type || !slug) return;
    persistOpenStateForNavigation();
    navigate(`/private/preview/${type}/${slug}?locale=${locale}`);
  };

  const handleCreateVersion = async () => {
    const { type, slug } = contentInfo;
    if (!type || !slug || !createVersionSlug || !versioningWriteSlug) return;
    setIsCreatingVersion(true);
    try {
      const token = getDebugToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Token ${token}`;
      const res = await fetch(`/api/versioning/${type}/${versioningWriteSlug}`, {
        method: "POST",
        headers,
        body: JSON.stringify({ variantSlug: createVersionSlug, locale: createVersionLocale }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error || "Failed to create version", variant: "destructive" });
        return;
      }
      toast({ title: `Version "${createVersionSlug}" created` });
      emitVariantCreated({ contentType: type, slug, locale: createVersionLocale, variantSlug: createVersionSlug });
      setCreateVersionOpen(false);
      setCreateVersionSlug("");
      if (onVersioningDataUpdate) {
        fetch(`/api/versioning/${type}/${slug}`)
          .then((r) => r.json())
          .then(onVersioningDataUpdate)
          .catch(() => {});
      }
      persistOpenStateForNavigation();
      navigate(`/private/preview/${type}/${slug}?variant=${encodeURIComponent(createVersionSlug)}&locale=${createVersionLocale}`);
    } catch {
      toast({ title: "Failed to create version", variant: "destructive" });
    } finally {
      setIsCreatingVersion(false);
    }
  };

  const handlePromote = async () => {
    if (!promoteTarget || !contentInfo.type || !contentInfo.slug) return;
    setIsPromoting(true);
    try {
      const token = getDebugToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Token ${token}`;

      if (isDraftEntry) {
        const res = await fetch(
          `/api/versioning/${contentInfo.type}/${versioningWriteSlug}/publish`,
          {
            method: "POST",
            headers,
            body: JSON.stringify({ variantSlug: promoteTarget.slug }),
          },
        );
        const data = await res.json();
        if (!res.ok) {
          toast({ title: data.error || "Failed to publish draft", variant: "destructive" });
          return;
        }
        toast({
          title: `Published "${promoteTarget.slug}"`,
          description: `Live for locale(s): ${(data.locales || []).join(", ") || "all"}`,
        });
        emitVariantPromoted({
          contentType: contentInfo.type,
          slug: contentInfo.slug,
          locale: promoteTarget.locale,
          variantSlug: promoteTarget.slug,
        });
        setPromoteTarget(null);
        if (onVersioningDataUpdate) {
          fetch(`/api/versioning/${contentInfo.type}/${contentInfo.slug}`)
            .then((r) => r.json())
            .then(onVersioningDataUpdate)
            .catch(() => {});
        }
        persistOpenStateForNavigation();
        navigate(`/private/preview/${contentInfo.type}/${contentInfo.slug}?locale=${promoteTarget.locale}`);
        return;
      }

      const res = await fetch(
        `/api/versioning/${contentInfo.type}/${versioningWriteSlug}/${promoteTarget.locale}/promote/${promoteTarget.slug}`,
        { method: "POST", headers }
      );
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error || "Failed to promote variant", variant: "destructive" });
        return;
      }
      toast({ title: `Variant "${promoteTarget.slug}" promoted to default` });
      emitVariantPromoted({ contentType: contentInfo.type, slug: contentInfo.slug, locale: promoteTarget.locale, variantSlug: promoteTarget.slug });
      setPromoteTarget(null);
      if (onVersioningDataUpdate) {
        fetch(`/api/versioning/${contentInfo.type}/${contentInfo.slug}`)
          .then((r) => r.json())
          .then(onVersioningDataUpdate)
          .catch(() => {});
      }
    } catch {
      toast({ title: isDraftEntry ? "Failed to publish draft" : "Failed to promote variant", variant: "destructive" });
    } finally {
      setIsPromoting(false);
    }
  };

  const handleDeleteVariant = async () => {
    if (!deleteTarget || !contentInfo.type || !contentInfo.slug) return;
    setIsDeleting(true);
    try {
      const token = getDebugToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Token ${token}`;
      const res = await fetch(
        `/api/versioning/${contentInfo.type}/${versioningWriteSlug}/${deleteTarget.locale}/${deleteTarget.slug}`,
        { method: "DELETE", headers }
      );
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error || "Failed to delete variant", variant: "destructive" });
        return;
      }
      if (data.entryDeleted) {
        toast({ title: "Entry deleted", description: "Last draft removed; unpublished entry was deleted." });
        setDeleteTarget(null);
        setMenuView("main");
        navigate("/private");
        return;
      }
      toast({ title: `Variant "${deleteTarget.slug}" deleted` });
      emitVariantDeleted({ contentType: contentInfo.type, slug: contentInfo.slug, locale: deleteTarget.locale, variantSlug: deleteTarget.slug });
      setDeleteTarget(null);
      if (onVersioningDataUpdate) {
        fetch(`/api/versioning/${contentInfo.type}/${contentInfo.slug}`)
          .then((r) => r.json())
          .then(onVersioningDataUpdate)
          .catch(() => {});
      }
    } catch {
      toast({ title: "Failed to delete variant", variant: "destructive" });
    } finally {
      setIsDeleting(false);
    }
  };

  const requestConvertToDraft = (locale: string) => {
    if (isTemplateVersioning) {
      setShowDetachForConvert(true);
      return;
    }
    setConvertTarget(locale);
  };

  const handleConvertToDraft = async () => {
    if (!convertTarget || !contentInfo.type || !contentInfo.slug || !versioningWriteSlug) return;
    setIsConverting(true);
    try {
      const token = getDebugToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Token ${token}`;
      const res = await fetch(
        `/api/versioning/${contentInfo.type}/${versioningWriteSlug}/${convertTarget}/convert-to-draft`,
        { method: "POST", headers },
      );
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error || "Failed to convert to draft", variant: "destructive" });
        return;
      }
      toast({
        title: `Live ${convertTarget.toUpperCase()} converted to draft`,
        description: data.lastLiveLocale
          ? "This page is unpublished until you publish a draft."
          : "This locale is unpublished. Other live locales are unchanged.",
      });
      emitVariantCreated({
        contentType: contentInfo.type,
        slug: contentInfo.slug,
        locale: convertTarget,
        variantSlug: data.variantSlug || "draft",
      });
      const convertedLocale = convertTarget;
      const variantSlug = (data.variantSlug as string) || "draft";
      setConvertTarget(null);
      if (onVersioningDataUpdate) {
        fetch(`/api/versioning/${contentInfo.type}/${contentInfo.slug}`)
          .then((r) => r.json())
          .then(onVersioningDataUpdate)
          .catch(() => {});
      }
      persistOpenStateForNavigation();
      navigate(
        `/private/preview/${contentInfo.type}/${contentInfo.slug}?variant=${encodeURIComponent(variantSlug)}&locale=${convertedLocale}`,
      );
    } catch {
      toast({ title: "Failed to convert to draft", variant: "destructive" });
    } finally {
      setIsConverting(false);
    }
  };

  const defaultShareUrl = (locale: string, variantSlug: string | null) => {
    if (!contentInfo.type || !contentInfo.slug) return "";
    const base = `${window.location.origin}${buildPublicPath(contentInfo.type, contentInfo.slug, locale)}`;
    return variantSlug ? `${base}?force_variant=${encodeURIComponent(variantSlug)}` : base;
  };

  const openEditAllocations = (locale: string) => {
    const localeData = versioningData?.versioning?.[locale];
    if (!localeData) return;
    const allocations: Record<string, number> = {};
    localeData.variants.forEach((v) => {
      allocations[v.slug] = v.allocation;
    });
    const variantSum = localeData.variants.reduce((s, v) => s + v.allocation, 0);
    allocations["__default__"] = Math.max(0, 100 - variantSum);
    setTempAllocations(allocations);
    setEditingLocale(locale);
  };

  const cancelEdit = () => {
    setEditingLocale(null);
    setTempAllocations({});
    setAllocationSaveError(null);
    setPublishConfirmVariants(null);
  };

  const handleSaveAllocations = async (opts?: { confirmPublish?: boolean }) => {
    if (!editingLocale || !contentInfo.type || !contentInfo.slug) return;
    const localeData = versioningData?.versioning?.[editingLocale];
    if (!localeData) return;

    setIsSaving(true);
    setAllocationSaveError(null);
    try {
      const token = getDebugToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Token ${token}`;

      const variants = localeData.variants.map((v) => ({
        slug: v.slug,
        allocation: tempAllocations[v.slug] ?? v.allocation,
      })).filter((v) => v.slug !== "__default__");

      const body: {
        variants: typeof variants;
        confirm_publish_variants?: boolean;
      } = { variants };
      if (opts?.confirmPublish) {
        body.confirm_publish_variants = true;
      }

      const res = await fetch(
        `/api/versioning/${contentInfo.type}/${versioningWriteSlug}/${editingLocale}`,
        {
          method: "PATCH",
          headers,
          body: JSON.stringify(body),
        }
      );

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (
          data?.code === "confirm_publish_variants" ||
          data?.error === "action_required"
        ) {
          setPublishConfirmVariants(
            Array.isArray(data.variants) ? data.variants : [],
          );
          return;
        }
        if (data?.code === "variant_validation_failed") {
          const parts: string[] = [];
          const byVar = data.issuesByVariant || {};
          for (const [slug, issues] of Object.entries(byVar)) {
            const msgs = (issues as Array<{ message?: string; code?: string }>)
              .map((i) => i.message || i.code || "error")
              .slice(0, 3);
            parts.push(`${slug}: ${msgs.join("; ")}`);
          }
          const summary =
            parts.join(" · ") ||
            data.error ||
            "Validation failed for newly published variants.";
          setAllocationSaveError(summary);
          setPublishConfirmVariants(null);
          toast({
            title: "Cannot publish variants",
            description: summary,
            variant: "destructive",
            duration: 8000,
          });
          return;
        }
        throw new Error(data?.error || "Failed to save allocations");
      }

      setPublishConfirmVariants(null);

      const updated = await fetch(
        `/api/versioning/${contentInfo.type}/${contentInfo.slug}`
      ).then((r) => r.json());

      if (onVersioningDataUpdate) onVersioningDataUpdate(updated);

      const warningNote =
        data.warningsByVariant && Object.keys(data.warningsByVariant).length > 0
          ? " Published with validation warnings — check Diagnostics."
          : "";

      toast({
        title: "Traffic split saved",
        description:
          "Allocation changes have been committed to version control and will go live on next deploy." +
          warningNote,
        duration: 5000,
      });
      setSavedLocale(editingLocale);
      setTimeout(() => setSavedLocale(null), 4000);
      setEditingLocale(null);
      setTempAllocations({});
    } catch {
      toast({
        title: "Failed to save",
        description: "Could not update traffic allocation.",
        variant: "destructive",
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenRestorePanel = async () => {
    setShowRestorePanel(true);
    if (restoreHistory.length > 0) return;
    setRestoreHistoryLoading(true);
    const { type, slug } = contentInfo;
    if (!type || !slug) { setRestoreHistoryLoading(false); return; }
    const folder = `4geeks-com/${type}/${slug}`;
    try {
      const data = await fetch(`/api/git/folder-history?folder=${encodeURIComponent(folder)}&limit=30`).then(r => r.json());
      setRestoreHistory(data.entries || []);
      setRepoUrl(data.repoUrl || null);
    } catch {
      setRestoreHistory([]);
    } finally {
      setRestoreHistoryLoading(false);
    }
  };

  const handleRestore = async () => {
    if (!restoreTarget || !contentInfo.type || !contentInfo.slug) return;
    setIsRestoring(true);
    const folder = `4geeks-com/${contentInfo.type}/${contentInfo.slug}`;
    try {
      const token = getDebugToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Token ${token}`;
      const res = await fetch("/api/git/restore-folder", {
        method: "POST",
        headers,
        body: JSON.stringify({ folder, sha: restoreTarget }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ title: data.error || "Restore failed", variant: "destructive" });
        return;
      }
      toast({ title: "Folder restored", description: `Content restored to commit ${restoreTarget.slice(0, 7)}` });
      setRestoreTarget(null);
      setShowRestorePanel(false);
      setRestoreHistory([]);
      if (onVersioningDataUpdate && contentInfo.type && contentInfo.slug) {
        fetch(`/api/versioning/${contentInfo.type}/${contentInfo.slug}`)
          .then(r => r.json())
          .then(onVersioningDataUpdate)
          .catch(() => {});
      }
    } catch {
      toast({ title: "Restore failed", variant: "destructive" });
    } finally {
      setIsRestoring(false);
    }
  };

  const totalTemp = Object.values(tempAllocations).reduce((s, v) => s + v, 0);

  return (
    <>
      <div className="px-3 py-2 border-b">
        <div className="flex items-start gap-3">
          <button
            onClick={() => showRestorePanel ? setShowRestorePanel(false) : setMenuView("main")}
            className="p-1 rounded-md hover-elevate shrink-0"
            data-testid="button-back-to-main-versioning"
          >
            <IconArrowLeft className="h-4 w-4" />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-semibold text-sm min-w-0 truncate">
                {showRestorePanel ? "Restore History" : versionsTitle}
              </h3>
              {!showRestorePanel && (
                <div className="flex items-center gap-1.5 shrink-0">
                  {onOpenPageErrors && (
                    <PageHealthIndicators
                      errorCount={pageErrorCount}
                      warningCount={pageWarningCount}
                      loading={pageDiagnosticsLoading}
                      pageUrl={pageDiagnosticsUrl}
                      onOpenTab={onOpenPageErrors}
                    />
                  )}
                  {!(isSharedLayout && isDetached) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 gap-1 text-xs"
                      onClick={handleOpenRestorePanel}
                      data-testid="button-open-restore-panel"
                    >
                      <IconHistory className="h-3 w-3" />
                      Restore
                    </Button>
                  )}
                </div>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {contentInfo.type ? (
                <a
                  href={`/private/type/${contentInfo.type}`}
                  className="underline underline-offset-2 hover:text-foreground"
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(`/private/type/${contentInfo.type}`);
                  }}
                  data-testid="link-versioning-content-type"
                >
                  {contentInfo.label}
                </a>
              ) : (
                contentInfo.label
              )}
              : {contentInfo.slug}
              {isTemplateVersioning ? " · Shared template" : ""}
            </p>
          </div>
        </div>
      </div>

      {!showRestorePanel && isTemplateVersioning && (
        <div className="px-3 py-2 border-b bg-muted/40 flex items-start gap-2">
          <p className="text-xs text-muted-foreground flex-1 min-w-0" data-testid="text-template-versions-warning">
            All{" "}
            {contentInfo.type ? (
              <a
                href={`/private/type/${contentInfo.type}`}
                className="underline underline-offset-2 hover:text-foreground"
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`/private/type/${contentInfo.type}`);
                }}
                data-testid="link-open-content-type-dashboard"
              >
                {contentTypeLabel}&apos;s
              </a>
            ) : (
              `${contentTypeLabel}'s`
            )}{" "}
            share the{" "}
            {onOpenTemplateYaml ? (
              <a
                href="#"
                className="underline underline-offset-2 hover:text-foreground"
                onClick={(e) => {
                  e.preventDefault();
                  onOpenTemplateYaml();
                }}
                data-testid="link-open-template-yaml"
              >
                same template
              </a>
            ) : (
              "same template"
            )}{" "}
            unless detached, versioning occurs on the template itself
          </p>
          {onRequestDetach && (
            <Button
              size="sm"
              variant="outline"
              className="h-7 shrink-0 text-xs px-2 gap-1"
              disabled={detachBusy}
              onClick={onRequestDetach}
              data-testid="button-versioning-detach"
            >
              {detachBusy ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Unlink className="h-3 w-3 text-muted-foreground" />
              )}
              Detach
            </Button>
          )}
        </div>
      )}

      {!showRestorePanel && isSharedLayout && isDetached && (
        <div className="px-3 pt-2 pb-1 bg-muted/40 flex items-center justify-between gap-2">
          <p className="font-semibold text-sm text-foreground min-w-0 truncate" data-testid="text-detached-variant-count">
            {availableVariantCount === 1 ? "1 Variant available" : `${availableVariantCount} Variants available`}
          </p>
          <div className="flex items-center gap-1 shrink-0">
            <TooltipProvider delayDuration={300}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-[18px] w-[18px] shrink-0"
                    onClick={handleOpenRestorePanel}
                    data-testid="button-open-restore-panel"
                    aria-label="Restore history"
                  >
                    <IconHistory className="h-3 w-3" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p>Restore history</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
            <Popover>
              <PopoverTrigger asChild>
                <button
                  type="button"
                  className="inline-flex"
                  data-testid="badge-detached"
                  aria-label="Detached from shared template — click for details"
                >
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0 cursor-pointer">
                    Detached
                  </Badge>
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-72 text-xs space-y-2 z-[10001]"
                data-testid="text-detached-versions-notice"
              >
                <p className="font-medium text-foreground">
                  Detached from the {contentTypeLabel} template
                </p>
                <p className="text-muted-foreground">
                  Versions are independent. New locales start as drafts—promote to publish.
                </p>
                <p className="text-muted-foreground">
                  Empty locales 404 publicly (Manage → Errors).
                </p>
              </PopoverContent>
            </Popover>
            {onRequestReattach && (
              <Button
                size="sm"
                variant="outline"
                className="h-[18px] min-h-[18px] shrink-0 text-[10px] leading-none px-1.5 py-0 gap-0.5"
                disabled={detachBusy}
                onClick={onRequestReattach}
                data-testid="button-versioning-reattach"
              >
                {detachBusy ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Link2 className="h-3 w-3 text-status-online" />
                )}
                Re-attach
              </Button>
            )}
          </div>
        </div>
      )}

      {showRestorePanel && (
        <div className="overflow-y-auto overflow-x-hidden max-h-[570px] min-h-[246px]">
          <div className="p-2 space-y-1">
            {restoreHistoryLoading ? (
              <div className="flex items-center justify-center py-8">
                <IconRefresh className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : restoreHistory.length === 0 ? (
              <div className="text-center py-8 px-4">
                <IconHistory className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">No git history found for this content folder</p>
              </div>
            ) : (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground px-2 pb-1">
                  Select a commit to restore the entire content folder to that snapshot.
                </p>
                {restoreHistory.map((entry) => {
                  const relDate = (() => {
                    const diff = Date.now() - new Date(entry.date).getTime();
                    const mins = Math.floor(diff / 60000);
                    if (mins < 60) return `${mins}m ago`;
                    const hrs = Math.floor(mins / 60);
                    if (hrs < 24) return `${hrs}h ago`;
                    return `${Math.floor(hrs / 24)}d ago`;
                  })();
                  const githubUrl = repoUrl
                    ? `${repoUrl}/tree/${entry.sha}/4geeks-com/${contentInfo.type}/${contentInfo.slug}`
                    : null;
                  return (
                    <div key={entry.sha} className="flex items-start justify-between gap-2 px-2 py-1.5 rounded-md hover-elevate">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs truncate text-foreground">{entry.subject}</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          {entry.author} · {relDate} · <span className="font-mono">{entry.sha.slice(0, 7)}</span>
                        </p>
                      </div>
                      <div className="flex items-center gap-1 flex-shrink-0">
                        {githubUrl && (
                          <a
                            href={githubUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            title="View on GitHub"
                            className="p-1 rounded hover-elevate text-muted-foreground"
                            data-testid={`button-github-link-${entry.sha}`}
                          >
                            <IconExternalLink className="h-3.5 w-3.5" />
                          </a>
                        )}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-5 px-1.5 py-0 text-[10px] leading-none"
                          onClick={() => setRestoreTarget(entry.sha)}
                          data-testid={`button-restore-commit-${entry.sha}`}
                        >
                          Restore
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {!showRestorePanel && (
      <div className="overflow-y-auto overflow-x-hidden max-h-[570px] min-h-[246px]">
        <div className="px-2 pb-2 pt-1 space-y-1">
          {isDraftEntry && versioningData?.hasVersioningFile && (
            <div
              className="mx-1 mb-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-foreground space-y-1"
              data-testid="banner-draft-unpublished"
            >
              <p className="font-medium">Not published</p>
              <p className="text-muted-foreground">
                This page has no live locale yet. Traffic cannot be assigned. Publish one draft to go live for{" "}
                <strong>all remaining locales</strong> at once; other drafts become variants.
              </p>
              <details className="text-muted-foreground">
                <summary className="cursor-pointer hover:text-foreground">Read more (advanced)</summary>
                <ul className="mt-1 list-disc pl-4 space-y-0.5">
                  <li>Draft files: <code className="bg-muted px-1 rounded">{"{variant}.{locale}.yml"}</code></li>
                  <li>Live files: <code className="bg-muted px-1 rounded">{"{locale}.yml"}</code> (created on publish)</li>
                  <li>Config: <code className="bg-muted px-1 rounded">versioning.yml</code></li>
                  <li>ContentIndex skips folders with no live locales (public 404 / no sitemap).</li>
                </ul>
              </details>
            </div>
          )}
          {versioningLoading ? (
            <div className="flex items-center justify-center py-8">
              <IconRefresh className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : !versioningData?.hasVersioningFile ? (
            <div className="space-y-2">
              {liveLocales.length > 0 ? (
                liveLocales.map((locale) => {
                  const isDefaultActive = activeVariant === null;
                  return (
                    <div key={locale} className="px-2 py-2">
                      <div className="flex items-center gap-1.5 mb-2">
                        <span className="text-xs text-muted-foreground">
                          {isTemplateVersioning ? "Live template for" : "Live version for"}
                        </span>
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 leading-4">
                          {locale.toUpperCase()}
                        </Badge>
                        <span className="text-xs text-muted-foreground">locale</span>
                      </div>
                      <div className={isDefaultActive ? "rounded-md bg-primary/10 px-2 py-1 -mx-2" : ""}>
                        <div className="flex items-center justify-between text-sm gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {isDefaultActive && (
                              <span className="h-2 w-2 rounded-full bg-primary flex-shrink-0" data-testid={`dot-active-variant-${locale}-default`} />
                            )}
                            <button
                              onClick={() => handleEditDefault(locale)}
                              title="Edit live version"
                              className={`truncate text-left hover:underline ${isDefaultActive ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                              data-testid={`button-edit-variant-${locale}-default`}
                            >
                              Default
                            </button>
                            {isDefaultActive && (
                              <Badge variant="default" className="text-[10px] px-1.5 py-0 leading-4 flex-shrink-0" data-testid={`badge-active-variant-${locale}`}>
                                active
                              </Badge>
                            )}
                          </div>
                          <DefaultLiveRowActions
                            locale={locale}
                            allocation={100}
                            isTemplateVersioning={isTemplateVersioning}
                            onShare={() => setShareTarget({ locale, slug: null })}
                            onConvert={() => requestConvertToDraft(locale)}
                            onEditYaml={onEditDefaultYaml ? () => onEditDefaultYaml(locale) : undefined}
                            onDelete={
                              onRequestDeletePage
                                ? () => onRequestDeletePage({ locale, liveLocales })
                                : undefined
                            }
                          />
                        </div>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-6 px-4">
                  <IconGitBranch className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-foreground mb-1">Not published yet</p>
                  <p className="text-xs text-muted-foreground">
                    Visitors cannot see this page. Click <strong>New</strong> to create a version, then publish when it is ready.
                  </p>
                </div>
              )}
              <div
                className="mx-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs text-foreground space-y-1.5"
                data-testid="banner-live-only-versions"
              >
                {liveLocales.length > 0 ? (
                  <>
                    <p className="font-medium">
                      {isTemplateVersioning
                        ? "This shared template only has the live version"
                        : "This page only has the live version"}
                    </p>
                    <p className="text-muted-foreground">
                      {isTemplateVersioning
                        ? "Attached entries already use this template. Extra versions let you try a change without putting it in front of every live page."
                        : "Visitors already see this version. Extra versions let you try a change without putting it in front of everyone."}
                    </p>
                    <p className="text-muted-foreground">
                      Use them for a new headline or CTA, a layout experiment, or a stakeholder preview.
                      They start at <strong>0% traffic</strong>; promote later if it wins.
                      Click <strong>New</strong> to add one — a versioning file is created automatically then. You do not create it by hand.
                    </p>
                  </>
                ) : (
                  <p className="text-muted-foreground">
                    Extra versions start at <strong>0% traffic</strong> and stay private until you publish.
                    Click <strong>New</strong> to add one.
                  </p>
                )}
                <details className="text-muted-foreground">
                  <summary className="cursor-pointer hover:text-foreground">Read more (advanced)</summary>
                  <ul className="mt-1 list-disc pl-4 space-y-0.5">
                    <li>
                      Live:{" "}
                      <code className="bg-muted px-1 rounded">
                        {isTemplateVersioning ? "template.{locale}.yml" : "{locale}.yml"}
                      </code>
                    </li>
                    <li>
                      Extra version:{" "}
                      <code className="bg-muted px-1 rounded">
                        {isTemplateVersioning ? "template.{variant}.{locale}.yml" : "{variant}.{locale}.yml"}
                      </code>
                    </li>
                    <li>
                      Config: <code className="bg-muted px-1 rounded">versioning.yml</code>{" "}
                      (created on the first extra version)
                    </li>
                    <li>Non-effect: live YAML is not renamed until you promote.</li>
                  </ul>
                </details>
              </div>
            </div>
          ) : locales.length === 0 ? (
            <div className="text-center py-8 px-4">
              <IconGitBranch className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">No variants defined</p>
            </div>
          ) : (
            locales.map((locale) => {
              const localeData = versioningData!.versioning![locale];
              const isEditing = editingLocale === locale;
              return (
                <div key={locale} className="px-2 pb-2 pt-1">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-xs text-muted-foreground">
                        {isDraftEntry
                          ? "Drafts for"
                          : isTemplateVersioning
                            ? "Template variants for"
                            : "Traffic allocation for"}
                      </span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0 leading-4">
                        {locale.toUpperCase()}
                      </Badge>
                      <span className="text-xs text-muted-foreground">locale</span>
                      {isDraftEntry && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 leading-4">
                          Unpublished
                        </Badge>
                      )}
                      {savedLocale === locale && (
                        <Badge variant="default" className="text-[10px] px-1.5 py-0 leading-4 gap-0.5 flex items-center">
                          <IconCheck className="h-2.5 w-2.5" />
                          Saved
                        </Badge>
                      )}
                    </div>
                    {!isDraftEntry && (!isEditing ? (
                      <div className="flex items-center gap-0.5">
                        <button
                          onClick={() => {
                            setCreateVersionLocale(locale);
                            setCreateVersionSlug("");
                            setCreateVersionOpen(true);
                          }}
                          className="p-1 rounded-md hover-elevate text-muted-foreground"
                          title="New version"
                          data-testid={`button-new-version-${locale}`}
                        >
                          <IconPlus className="h-3.5 w-3.5" />
                        </button>
                        <button
                          onClick={() => openEditAllocations(locale)}
                          className="p-1 rounded-md hover-elevate text-muted-foreground"
                          title="Edit traffic allocation"
                          data-testid={`button-edit-allocations-${locale}`}
                        >
                          <IconPencil className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <Badge
                          variant={totalTemp === 100 ? "default" : "destructive"}
                          className="text-xs"
                          data-testid="badge-total-allocation"
                        >
                          {totalTemp}%
                        </Badge>
                        <button
                          onClick={() => void handleSaveAllocations()}
                          disabled={isSaving || totalTemp !== 100}
                          className="p-1 rounded-md hover-elevate text-muted-foreground disabled:opacity-40 disabled:cursor-not-allowed"
                          title={totalTemp !== 100 ? `Total must equal 100% (currently ${totalTemp}%)` : "Save allocations"}
                          data-testid={`button-save-allocations-${locale}`}
                        >
                          {isSaving ? (
                            <IconRefresh className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <IconCheck className="h-3.5 w-3.5" />
                          )}
                        </button>
                        <button
                          onClick={cancelEdit}
                          className="p-1 rounded-md hover-elevate text-muted-foreground"
                          title="Cancel"
                          data-testid={`button-cancel-allocations-${locale}`}
                        >
                          <IconX className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>

                  {isEditing && allocationSaveError && (
                    <p
                      className="text-xs text-destructive mb-2 px-0.5"
                      data-testid={`text-allocation-save-error-${locale}`}
                    >
                      {allocationSaveError}
                    </p>
                  )}

                  <div className="space-y-2">
                    {/* Synthetic default row — only when published */}
                    {!isDraftEntry && (() => {
                      const variantTotal = localeData.variants.reduce((sum, v) => sum + (v.allocation ?? 0), 0);
                      const defaultAllocation = Math.max(0, 100 - variantTotal);
                      const isDefaultActive = activeVariant === null;
                      const defaultTempValue = tempAllocations["__default__"] ?? defaultAllocation;
                      const variantTempTotal = localeData.variants.reduce((sum, v) => sum + (tempAllocations[v.slug] ?? (v.allocation ?? 0)), 0);
                      const defaultMaxAllowed = Math.max(0, 100 - variantTempTotal);
                      return (
                        <div key="__default__" className={isDefaultActive ? "rounded-md bg-primary/10 px-2 py-1 -mx-2" : ""}>
                          <div className="flex items-center justify-between text-sm gap-2">
                            <div className="flex items-center gap-1.5 min-w-0">
                              {isDefaultActive && (
                                <span className="h-2 w-2 rounded-full bg-primary flex-shrink-0" data-testid={`dot-active-variant-${locale}-default`} />
                              )}
                              <button
                                onClick={() => handleEditDefault(locale)}
                                title="Edit default version"
                                className={`truncate text-left hover:underline ${isDefaultActive ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                                data-testid={`button-edit-variant-${locale}-default`}
                              >
                                Default
                              </button>
                              {isDefaultActive && (
                                <Badge variant="default" className="text-[10px] px-1.5 py-0 leading-4 flex-shrink-0" data-testid={`badge-active-variant-${locale}`}>
                                  active
                                </Badge>
                              )}
                            </div>
                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {!isEditing && (
                                <DefaultLiveRowActions
                                  locale={locale}
                                  allocation={defaultAllocation}
                                  isTemplateVersioning={isTemplateVersioning}
                                  onShare={() => setShareTarget({ locale, slug: null })}
                                  onConvert={() => requestConvertToDraft(locale)}
                                  onEditYaml={onEditDefaultYaml ? () => onEditDefaultYaml(locale) : undefined}
                                  onDelete={
                                    onRequestDeletePage
                                      ? () => onRequestDeletePage({ locale, liveLocales })
                                      : undefined
                                  }
                                />
                              )}
                            </div>
                          </div>
                          {isEditing && (
                            <div className="mt-1.5 flex items-center gap-2">
                              <Slider
                                value={[defaultTempValue]}
                                min={0}
                                max={100}
                                step={1}
                                onValueChange={([value]) =>
                                  setTempAllocations((prev) => ({
                                    ...prev,
                                    __default__: Math.min(value, defaultMaxAllowed),
                                  }))
                                }
                                className="flex-1"
                                data-testid={`slider-allocation-${locale}-default`}
                              />
                              <span className="text-xs font-medium tabular-nums w-8 text-right">
                                {defaultTempValue}%
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })()}
                    {localeData.variants.map((variant) => {
                      const isActive = activeVariant === variant.slug;
                      return (
                      <div key={variant.slug} className={isActive ? "rounded-md bg-primary/10 px-2 py-1 -mx-2" : ""}>
                        <div className="flex items-center justify-between text-sm gap-2">
                          <div className="flex items-center gap-1.5 min-w-0">
                            {isActive && (
                              <span className="h-2 w-2 rounded-full bg-primary flex-shrink-0" data-testid={`dot-active-variant-${locale}-${variant.slug}`} />
                            )}
                            <div className="flex flex-col min-w-0">
                              <button
                                onClick={() => handleEditVariant(locale, variant.slug)}
                                title={`Edit variant: ${variant.slug}`}
                                className={`truncate text-left hover:underline ${isActive ? "font-semibold text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                                data-testid={`button-edit-variant-${locale}-${variant.slug}`}
                              >
                                {deslugify(variant.slug)}
                              </button>
                              {isActive && isTemplateVersioning && contentInfo.slug && contentInfo.type && (
                                <button
                                  onClick={() => navigate(`/private/preview/${contentInfo.type}/${contentInfo.slug}`)}
                                  className="text-[10px] text-muted-foreground hover:text-foreground hover:underline text-left truncate leading-tight mt-0.5"
                                  title={`View original entry: ${contentInfo.slug}`}
                                >
                                  ↳ {contentInfo.slug}
                                </button>
                              )}
                            </div>
                            {isActive && (
                              <Badge variant="default" className="text-[10px] px-1.5 py-0 leading-4 flex-shrink-0" data-testid={`badge-active-variant-${locale}`}>
                                active
                              </Badge>
                            )}
                          </div>
                          <div className="flex items-center gap-1.5 flex-shrink-0">
                            {!isEditing && !isDraftEntry && (
                              <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                                {variant.allocation ?? 0}%
                              </span>
                            )}
                            {isDraftEntry && (
                              <Badge variant="secondary" className="text-[10px] px-1.5 py-0 leading-4">
                                draft
                              </Badge>
                            )}
                            {!isEditing && (
                              <TooltipProvider delayDuration={300}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-5 w-5 shrink-0"
                                      onClick={() => setShareTarget({ locale, slug: variant.slug })}
                                      data-testid={`button-share-variant-${locale}-${variant.slug}`}
                                    >
                                      <IconShare className="h-3 w-3" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top">
                                    <p>Share preview link</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                            {!isEditing && (
                              <TooltipProvider delayDuration={300}>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <Button
                                      size="icon"
                                      variant="ghost"
                                      className="h-5 w-5 shrink-0 transition-colors hover:bg-yellow-100 hover:text-yellow-700 dark:hover:bg-yellow-900/40 dark:hover:text-yellow-400"
                                      onClick={() => setPromoteTarget({ locale, slug: variant.slug })}
                                      data-testid={`button-promote-variant-${locale}-${variant.slug}`}
                                    >
                                      <IconCrown className="h-3 w-3" />
                                    </Button>
                                  </TooltipTrigger>
                                  <TooltipContent side="top">
                                    <p>{isDraftEntry ? "Publish this draft (all remaining locales)" : "Promote this version"}</p>
                                  </TooltipContent>
                                </Tooltip>
                              </TooltipProvider>
                            )}
                            {!isEditing && (
                              <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    size="icon"
                                    variant="ghost"
                                    className="h-5 w-5 shrink-0"
                                    data-testid={`button-variant-menu-${locale}-${variant.slug}`}
                                  >
                                    <IconDots className="h-3 w-3" />
                                  </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="w-40">
                                  <DropdownMenuItem
                                    onClick={() => onEditVariantYaml(locale, variant.slug)}
                                    className="text-[13px]"
                                    data-testid={`menu-edit-yaml-variant-${locale}-${variant.slug}`}
                                  >
                                    <IconCode className="h-3.5 w-3.5 mr-2" />
                                    Edit YAML
                                  </DropdownMenuItem>
                                  <DropdownMenuItem
                                    onClick={() => setDeleteTarget({ locale, slug: variant.slug, allocation: variant.allocation })}
                                    className="text-[13px] text-destructive"
                                    data-testid={`menu-delete-variant-${locale}-${variant.slug}`}
                                  >
                                    <IconTrash className="h-3.5 w-3.5 mr-2" />
                                    Delete variant
                                  </DropdownMenuItem>
                                </DropdownMenuContent>
                              </DropdownMenu>
                            )}
                          </div>
                        </div>
                        {isEditing && (() => {
                          const thisValue = tempAllocations[variant.slug] ?? (variant.allocation ?? 0);
                          const othersTotal = localeData.variants.reduce((sum, v) => {
                            if (v.slug === variant.slug) return sum;
                            return sum + (tempAllocations[v.slug] ?? (v.allocation ?? 0));
                          }, 0) + (tempAllocations["__default__"] ?? 0);
                          const maxAllowed = Math.max(0, 100 - othersTotal);
                          return (
                            <div className="mt-1.5 flex items-center gap-2">
                              <Slider
                                value={[thisValue]}
                                min={0}
                                max={100}
                                step={1}
                                onValueChange={([value]) =>
                                  setTempAllocations((prev) => ({
                                    ...prev,
                                    [variant.slug]: Math.min(value, maxAllowed),
                                  }))
                                }
                                className="flex-1"
                                data-testid={`slider-allocation-${locale}-${variant.slug}`}
                              />
                              <span className="text-xs font-medium tabular-nums w-8 text-right">
                                {thisValue}%
                              </span>
                            </div>
                          );
                        })()}
                      </div>
                    );
                    })}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
      )}

      <Dialog
        open={publishConfirmVariants !== null}
        onOpenChange={(open) => {
          if (!open && !isSaving) setPublishConfirmVariants(null);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Publish variants with traffic?</DialogTitle>
            <DialogDescription className="space-y-2">
              <span className="block">
                Assigning traffic publishes these variants and runs validation. Redirects
                cannot live on variants — only on the live locale file.
              </span>
              <ul className="list-disc pl-4 text-sm">
                {(publishConfirmVariants ?? []).map((slug) => (
                  <li key={slug}>
                    <code className="text-xs bg-muted px-1 py-0.5 rounded">{slug}</code>
                  </li>
                ))}
              </ul>
              <details className="text-xs text-muted-foreground pt-1">
                <summary className="cursor-pointer">Read more (advanced)</summary>
                <p className="mt-1">
                  Published variants use entry key{" "}
                  <code className="bg-muted px-1 rounded">type/slug/locale@variant</code>.
                  Files:{" "}
                  <code className="bg-muted px-1 rounded">scripts/validation/shared/entryKey.ts</code>
                  ,{" "}
                  <code className="bg-muted px-1 rounded">server/routes/versioning.ts</code>.
                </p>
              </details>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={isSaving}
              onClick={() => setPublishConfirmVariants(null)}
              data-testid="button-cancel-publish-variants"
            >
              Cancel
            </Button>
            <Button
              disabled={isSaving}
              onClick={() => void handleSaveAllocations({ confirmPublish: true })}
              data-testid="button-confirm-publish-variants"
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Validating…
                </>
              ) : (
                "Publish & save"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={createVersionOpen} onOpenChange={(open) => {
        setCreateVersionOpen(open);
        if (!open) setCreateVersionSlug("");
      }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {isTemplateVersioning ? "Create template variant" : `Create new version for ${contentInfo.slug}`}
            </DialogTitle>
            <DialogDescription>
              {isTemplateVersioning
                ? <>A draft copy of <code className="text-xs bg-muted px-1 py-0.5 rounded">template.{createVersionLocale}.yml</code> will be created. Promote it to replace the shared template when ready.</>
                : <>A new version of <strong>{contentInfo.label || contentInfo.slug}</strong> will be created but your users will not see it unless traffic is assigned to it later.</>
              }
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-1">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Locale</label>
              <Select value={createVersionLocale} onValueChange={setCreateVersionLocale}>
                <SelectTrigger data-testid="select-version-locale">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {dialogLocales.map((loc) => (
                    <SelectItem key={loc} value={loc}>{loc.toUpperCase()}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Version name</label>
              <Input
                placeholder="e.g. colorful, dark-hero, new-cta"
                value={createVersionSlug}
                onChange={(e) => setCreateVersionSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                data-testid="input-version-slug"
              />
              <p className="text-xs text-muted-foreground">Lowercase letters, numbers, and hyphens only.</p>
            </div>
            {createVersionSlug && contentInfo.slug && (
              <div className="rounded-md bg-muted px-3 py-2 space-y-0.5">
                <p className="text-xs font-medium">File that will be created:</p>
                <p className="text-xs font-mono text-muted-foreground break-all">
                  {isTemplateVersioning
                    ? `template.${createVersionSlug}.${createVersionLocale}.yml`
                    : `${contentInfo.slug}/${createVersionSlug}.${createVersionLocale}.yml`}
                </p>
              </div>
            )}
            <div className="rounded-md bg-muted px-3 py-2">
              <p className="text-xs text-muted-foreground">
                Starts with <strong>0% traffic allocation</strong> — no real visitors will see it until you allocate traffic. You can preview it anytime using <code className="text-xs">?force_variant=</code>.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateVersionOpen(false)}>Cancel</Button>
            <Button
              onClick={handleCreateVersion}
              disabled={!createVersionSlug || isCreatingVersion}
              data-testid="button-confirm-create-version"
            >
              {isCreatingVersion && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              Create version
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={promoteTarget !== null} onOpenChange={(open) => { if (!open) setPromoteTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {isDraftEntry ? "Publish this draft?" : "Are you sure you want to promote this variant?"}
            </DialogTitle>
            <DialogDescription>
              {isDraftEntry ? (
                <>
                  This will publish{" "}
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">{promoteTarget?.slug}</code>{" "}
                  as the live page for <strong>all remaining draft locales</strong> that have this draft.
                  Other drafts become normal variants at 0% traffic. The page will appear in the sitemap.
                </>
              ) : (
                <>
                  This action will remove the default current page and replace it with this{" "}
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">{promoteTarget?.slug}</code>{" "}
                  variant and 100% of the traffic will now be directed to this by default.
                </>
              )}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              variant="destructive"
              onClick={handlePromote}
              disabled={isPromoting}
              className="w-full"
              data-testid="button-confirm-promote"
            >
              {isPromoting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <IconCrown className="h-4 w-4" />
              )}
              {isDraftEntry ? "Yes, publish now" : "Yes, promote and replace original"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setPromoteTarget(null)}
              disabled={isPromoting}
              className="w-full"
              data-testid="button-cancel-promote"
            >
              <IconX className="h-4 w-4" />
              {isDraftEntry ? "Cancel" : "No, keep it as a secondary variant"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open && !isDeleting) setDeleteTarget(null); }}>
        <DialogContent className="max-w-md">
          {deleteTarget?.allocation && deleteTarget.allocation > 0 ? (
            <>
              <DialogHeader>
                <DialogTitle>Cannot delete this variant</DialogTitle>
                <DialogDescription>
                  Variant{" "}
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">{deleteTarget?.slug}</code>{" "}
                  currently has <strong>{deleteTarget?.allocation}% traffic allocation</strong>. You must set its traffic to 0% before deleting it.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDeleteTarget(null)}
                  data-testid="button-close-delete-blocked"
                >
                  Close
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Delete this variant?</DialogTitle>
                <DialogDescription>
                  This will permanently remove the variant file for{" "}
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">{deleteTarget?.slug}</code>{" "}
                  ({deleteTarget?.locale}) and remove it from the versioning list. This action cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setDeleteTarget(null)}
                  disabled={isDeleting}
                  data-testid="button-cancel-delete-variant"
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={handleDeleteVariant}
                  disabled={isDeleting}
                  data-testid="button-confirm-delete-variant"
                >
                  {isDeleting ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <IconTrash className="h-4 w-4 mr-2" />
                  )}
                  Delete variant
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={shareTarget !== null} onOpenChange={(open) => { if (!open) setShareTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{shareTarget?.slug ? "Share this variant" : "Share the live page"}</DialogTitle>
            <DialogDescription>
              {shareTarget?.slug ? (
                <>
                  Anyone with this link will see the{" "}
                  <code className="text-xs bg-muted px-1 py-0.5 rounded">{shareTarget.slug}</code>{" "}
                  variant regardless of traffic allocation. Use it to share a preview with stakeholders or clients without changing any live traffic split.
                </>
              ) : (
                <>This is the public URL visitors already see. No variant override is applied.</>
              )}
            </DialogDescription>
          </DialogHeader>
          {shareTarget && contentInfo.type && contentInfo.slug && (
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={defaultShareUrl(shareTarget.locale, shareTarget.slug)}
                className="font-mono text-xs"
                data-testid="input-share-variant-url"
              />
              <Button
                size="icon"
                variant="ghost"
                onClick={() => {
                  const url = defaultShareUrl(shareTarget.locale, shareTarget.slug);
                  navigator.clipboard.writeText(url).then(() => {
                    toast({ title: "Copied!", description: "Link copied to clipboard." });
                  });
                }}
                data-testid="button-copy-share-url"
              >
                <IconCopy className="h-4 w-4" />
              </Button>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setShareTarget(null)} data-testid="button-close-share-modal">
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={convertTarget !== null} onOpenChange={(open) => { if (!open && !isConverting) setConvertTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Convert live {convertTarget?.toUpperCase()} to draft?</DialogTitle>
            <DialogDescription className="space-y-2">
              <span className="block">
                This locale will stop being public (404, not in the sitemap) until you publish a draft.
                Other live locales are unchanged.
              </span>
              <span className="block">
                The live file is renamed to{" "}
                <code className="text-xs bg-muted px-1 py-0.5 rounded">draft.{convertTarget}.yml</code>{" "}
                at 0% traffic. A versioning file is created automatically if needed. You do not need to click New.
              </span>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              variant="destructive"
              onClick={handleConvertToDraft}
              disabled={isConverting}
              className="w-full"
              data-testid="button-confirm-convert-to-draft"
            >
              {isConverting ? <Loader2 className="h-4 w-4 animate-spin" /> : <IconEyeOff className="h-4 w-4" />}
              Yes, convert to draft
            </Button>
            <Button
              variant="outline"
              onClick={() => setConvertTarget(null)}
              disabled={isConverting}
              className="w-full"
              data-testid="button-cancel-convert-to-draft"
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showDetachForConvert} onOpenChange={setShowDetachForConvert}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Detach first</DialogTitle>
            <DialogDescription>
              Convert to draft is blocked on the shared template — that would unpublish every attached entry.
              Detach this entry first, then convert this entry only.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            {onRequestDetach && (
              <Button
                onClick={() => {
                  setShowDetachForConvert(false);
                  onRequestDetach();
                }}
                disabled={detachBusy}
                className="w-full"
                data-testid="button-detach-before-convert"
              >
                {detachBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unlink className="h-4 w-4" />}
                Detach this entry
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => setShowDetachForConvert(false)}
              className="w-full"
              data-testid="button-cancel-detach-for-convert"
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={restoreTarget !== null} onOpenChange={(open) => { if (!open) setRestoreTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Restore content folder?</DialogTitle>
            <DialogDescription>
              This will overwrite every file in{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">
                4geeks-com/{contentInfo.type}/{contentInfo.slug}/
              </code>{" "}
              with the versions from commit{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">{restoreTarget?.slice(0, 7)}</code>.
              The restore itself will be saved as a new commit so it can be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setRestoreTarget(null)}
              disabled={isRestoring}
              data-testid="button-cancel-restore"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleRestore}
              disabled={isRestoring}
              data-testid="button-confirm-restore"
            >
              {isRestoring ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <IconArrowBackUp className="h-4 w-4 mr-2" />
              )}
              Yes, restore this snapshot
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
