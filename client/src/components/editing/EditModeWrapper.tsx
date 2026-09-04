import { useState, useEffect, useRef, useCallback, useMemo, type ReactNode } from "react";
import { useDebugAuth, getDebugToken } from "@/hooks/useDebugAuth";
import { useEditModeOptional } from "@/contexts/EditModeContext";
import { EditModeProvider } from "@/contexts/EditModeContext";
import { SyncProvider } from "@/contexts/SyncContext";
import { SyncConflictBanner } from "@/components/SyncConflictBanner";
import { StaffSystemAlertBanner } from "@/components/StaffSystemAlertBanner";
import { PageHistoryProvider, usePageHistoryOptional } from "@/contexts/PageHistoryContext";
import { subscribeToEditStarted, emitVariantCreated, emitVariantPromoted } from "@/lib/contentEvents";
import { FirstEditPromptModal, type ExistingVariant } from "@/components/editing/FirstEditPromptModal";
import { navigate } from "wouter/use-browser-location";
import { useLocation, useSearch } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { IconCopy, IconCrown, IconGitFork, IconShare, IconX } from "@tabler/icons-react";
import { Loader2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useContentTypes, useContentTypesRaw } from "@/hooks/useContentTypes";
import {
  isSharedLayoutType,
  versioningContentSlug,
} from "@/lib/sharedLayoutEntry";
import { detectContentInfo } from "@/components/DebugBubble/utils/debugHelpers";
import { SolveWithAiAgentDropdown } from "@/components/DebugBubble/SolveWithAiAgentDropdown";
import { buildDraftFeedbackAiPrompt, type SolveWithAiAgentId } from "@/components/DebugBubble/solveWithAiPrompt";
import { McpRequiredForAiModal } from "@/components/mcp/McpRequiredForAiModal";
import type { McpSetupTabId } from "@/components/mcp/mcpUrlHelpers";
import { buildContentUrlFromPattern } from "@/lib/locale";
import { cn } from "@/lib/utils";
import type { Section } from "@shared/schema";

interface EditModeWrapperProps {
  children: React.ReactNode;
  sections?: Section[];
  contentType?: string;
  slug?: string;
  locale?: string;
}

// Sync wrapper that only renders when edit mode is active
// This ensures no GitHub API calls happen until user explicitly enters edit mode
function SyncWrapper({ children }: { children: React.ReactNode }) {
  const editMode = useEditModeOptional();
  
  // Only mount SyncProvider when edit mode is actually active
  // Regular browsers (even with debug capabilities) won't trigger any sync API calls
  if (!editMode?.isEditMode) {
    return <>{children}</>;
  }
  
  return (
    <SyncProvider>
      <SyncConflictBanner />
      {children}
    </SyncProvider>
  );
}

const AUTO_OPEN_KEY = "firstEdit_autoOpen";

interface PendingEdit {
  contentType: string;
  slug: string;
  locale: string;
  sectionIndex?: number;
  variant?: string;
  resume: () => void;
}

/**
 * Mounted once inside EditModeProvider. Subscribes to editStarted events and
 * intercepts the first edit on a promoted (default) variant page each session.
 */
function FirstEditGate({ children }: { children: React.ReactNode }) {
  const editMode = useEditModeOptional();
  const { toast } = useToast();
  const [pathname] = useLocation();
  const searchString = useSearch();
  const contentTypesMap = useContentTypes();
  const { data: contentTypesRaw } = useContentTypesRaw();
  const [pendingEdit, setPendingEdit] = useState<PendingEdit | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [existingVariants, setExistingVariants] = useState<ExistingVariant[]>([]);
  const pendingRef = useRef<PendingEdit | null>(null);
  const [variantTraffic, setVariantTraffic] = useState<{
    isDraft: boolean;
    allocation: number | null;
    versioningSlug: string | null;
  } | null>(null);
  const [publishConfirmOpen, setPublishConfirmOpen] = useState(false);
  const [shareDraftOpen, setShareDraftOpen] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [mcpRequiredForAiOpen, setMcpRequiredForAiOpen] = useState(false);
  const [mcpRequiredSetupTab, setMcpRequiredSetupTab] = useState<McpSetupTabId>("cursor");
  const [mcpRequiredAgentId, setMcpRequiredAgentId] = useState<SolveWithAiAgentId>("copy-prompt");
  const [mcpRequiredAgentLabel, setMcpRequiredAgentLabel] = useState("AI Agent");
  const [mcpRequiredPrompt, setMcpRequiredPrompt] = useState("");
  const [mcpRequiredPrefillPrefix, setMcpRequiredPrefillPrefix] = useState<string | undefined>();

  // Derive the active variant from the URL (?variant=xxx on private preview routes)
  const searchParams = useMemo(() => new URLSearchParams(searchString), [searchString]);
  const activeVariantFromUrl = searchParams.get("variant") ?? searchParams.get("force_variant") ?? null;
  const urlLocale = searchParams.get("locale") ?? "en";
  const contentInfo = useMemo(
    () => detectContentInfo(pathname, contentTypesMap),
    [pathname, contentTypesMap],
  );

  const draftShareUrl = useMemo(() => {
    if (!contentInfo.type || !contentInfo.slug || !activeVariantFromUrl) return "";
    const pattern = contentTypesMap?.[contentInfo.type]?.url_pattern;
    const path = buildContentUrlFromPattern(pattern, contentInfo.slug, urlLocale);
    const qs = new URLSearchParams({ force_variant: activeVariantFromUrl });
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    return `${origin}${path}?${qs.toString()}`;
  }, [activeVariantFromUrl, contentInfo.slug, contentInfo.type, contentTypesMap, urlLocale]);

  const draftFeedbackPrompt = useMemo(() => {
    if (!contentInfo.type || !contentInfo.slug || !activeVariantFromUrl || !draftShareUrl) {
      return "";
    }
    return buildDraftFeedbackAiPrompt({
      shareUrl: draftShareUrl,
      contentType: contentInfo.type,
      slug: contentInfo.slug,
      locale: urlLocale,
      variant: activeVariantFromUrl,
    });
  }, [
    activeVariantFromUrl,
    contentInfo.slug,
    contentInfo.type,
    draftShareUrl,
    urlLocale,
  ]);

  const handleCopyDraftShareUrl = useCallback(() => {
    if (!draftShareUrl) return;
    void navigator.clipboard.writeText(draftShareUrl).then(() => {
      toast({ title: "Link copied", description: "Share it with colleagues for feedback." });
    });
  }, [draftShareUrl, toast]);

  useEffect(() => {
    if (!activeVariantFromUrl || !editMode?.isEditMode || !contentInfo.type || !contentInfo.slug) {
      setVariantTraffic(null);
      return;
    }
    let cancelled = false;
    fetch(`/api/versioning/${encodeURIComponent(contentInfo.type)}/${encodeURIComponent(contentInfo.slug)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (cancelled || !data) return;
        const isDraft = !!data.isDraft || data.hasLiveDefault === false;
        const versioning = data.versioning as Record<string, { variants?: { slug: string; allocation: number }[] }> | null;
        const localeData =
          versioning?.[urlLocale] ??
          (versioning ? versioning[Object.keys(versioning)[0]] : undefined);
        const match = localeData?.variants?.find((v) => v.slug === activeVariantFromUrl);
        setVariantTraffic({
          isDraft,
          allocation: match ? (match.allocation ?? 0) : null,
          versioningSlug: typeof data.versioningSlug === "string" ? data.versioningSlug : contentInfo.slug,
        });
      })
      .catch(() => {
        if (!cancelled) setVariantTraffic(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeVariantFromUrl, editMode?.isEditMode, contentInfo.type, contentInfo.slug, urlLocale]);

  const resolveVersioningSlug = useCallback(
    async (contentType: string, entrySlug: string): Promise<string> => {
      const typeInfo = contentTypesRaw?.find((t) => t.name === contentType);
      const shared = isSharedLayoutType(typeInfo);
      if (!shared) return entrySlug;
      try {
        const res = await fetch(
          `/api/content/${encodeURIComponent(contentType)}/${encodeURIComponent(entrySlug)}/attach-status`,
        );
        if (res.ok) {
          const data = await res.json();
          return versioningContentSlug(entrySlug, {
            isSharedLayout: true,
            isDetached: !!data.detached,
          });
        }
      } catch {
        // fall through
      }
      // Attached by default for shared-layout when status is unavailable
      return versioningContentSlug(entrySlug, { isSharedLayout: true, isDetached: false });
    },
    [contentTypesRaw],
  );

  const handlePublishDraft = useCallback(async () => {
    if (
      !contentInfo.type ||
      !contentInfo.slug ||
      !activeVariantFromUrl ||
      !variantTraffic?.isDraft
    ) {
      return;
    }
    setIsPublishing(true);
    try {
      const token = getDebugToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Token ${token}`;

      const versioningWriteSlug =
        variantTraffic.versioningSlug ||
        (await resolveVersioningSlug(contentInfo.type, contentInfo.slug));

      const res = await fetch(
        `/api/versioning/${contentInfo.type}/${versioningWriteSlug}/publish`,
        {
          method: "POST",
          headers,
          body: JSON.stringify({ variantSlug: activeVariantFromUrl }),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: data.error || "Failed to publish draft", variant: "destructive" });
        return;
      }
      toast({
        title: `Published "${activeVariantFromUrl}"`,
        description: `Live for locale(s): ${(data.locales || []).join(", ") || "all"}`,
      });
      emitVariantPromoted({
        contentType: contentInfo.type,
        slug: contentInfo.slug,
        locale: urlLocale,
        variantSlug: activeVariantFromUrl,
      });
      setPublishConfirmOpen(false);
      navigate(`/private/preview/${contentInfo.type}/${contentInfo.slug}?locale=${urlLocale}`);
    } catch {
      toast({ title: "Failed to publish draft", variant: "destructive" });
    } finally {
      setIsPublishing(false);
    }
  }, [
    activeVariantFromUrl,
    contentInfo.slug,
    contentInfo.type,
    resolveVersioningSlug,
    toast,
    urlLocale,
    variantTraffic?.isDraft,
    variantTraffic?.versioningSlug,
  ]);

  useEffect(() => {
    return subscribeToEditStarted((payload) => {
      if (!editMode?.isEditMode) {
        payload.resume();
        return;
      }

      const slug = payload.slug || "";
      const isOnPromotedVariant = !payload.variant || payload.variant === "";

      // Skip gate: already prompted this session OR already on a named variant
      if (!isOnPromotedVariant || editMode.promptedPageSlugs.has(slug)) {
        payload.resume();
        return;
      }

      // Hold the resume callback and show the modal
      const pending: PendingEdit = {
        contentType: payload.contentType,
        slug,
        locale: payload.locale,
        sectionIndex: payload.sectionIndex,
        variant: payload.variant,
        resume: payload.resume,
      };
      pendingRef.current = pending;
      setPendingEdit(pending);
      setExistingVariants([]);
      setModalOpen(true);

      // Fetch existing variants (template slug when attached shared-layout)
      void (async () => {
        try {
          const versioningSlug = await resolveVersioningSlug(payload.contentType, slug);
          const r = await fetch(
            `/api/versioning/${encodeURIComponent(payload.contentType)}/${encodeURIComponent(versioningSlug)}`,
          );
          if (!r.ok) return;
          const data = await r.json();
          if (!data?.versioning) return;
          const localeData =
            data.versioning[payload.locale] ?? data.versioning[Object.keys(data.versioning)[0]];
          const variants: ExistingVariant[] = (localeData?.variants ?? []).map(
            (v: { slug: string }) => ({ slug: v.slug }),
          );
          setExistingVariants(variants);
        } catch {
          // ignore
        }
      })();
    });
  }, [editMode, resolveVersioningSlug]);

  const handleEditLive = useCallback(() => {
    if (!editMode || !pendingRef.current) return;
    editMode.markPagePrompted(pendingRef.current.slug);
    setModalOpen(false);
    const resume = pendingRef.current.resume;
    pendingRef.current = null;
    setPendingEdit(null);
    resume();
  }, [editMode]);

  const handleSwitchToVariant = useCallback((variantSlug: string) => {
    if (!editMode || !pendingRef.current) return;
    const { contentType, slug, locale, sectionIndex } = pendingRef.current;
    editMode.markPagePrompted(slug);
    setModalOpen(false);

    // Persist section index so the variant page auto-opens the same editor
    if (typeof sessionStorage !== "undefined" && sectionIndex !== undefined) {
      sessionStorage.setItem(
        AUTO_OPEN_KEY,
        JSON.stringify({ sectionIndex, variantName: variantSlug })
      );
    }

    pendingRef.current = null;
    setPendingEdit(null);
    navigate(`/private/preview/${contentType}/${slug}?variant=${encodeURIComponent(variantSlug)}&locale=${locale}`);
  }, [editMode]);

  const handleCreateVariant = useCallback(async (variantName: string) => {
    if (!editMode || !pendingRef.current) return;
    const { contentType, slug, locale } = pendingRef.current;

    const token = getDebugToken();
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (token) headers["Authorization"] = `Token ${token}`;

    const versioningSlug = await resolveVersioningSlug(contentType, slug);
    const res = await fetch(`/api/versioning/${contentType}/${versioningSlug}`, {
      method: "POST",
      headers,
      body: JSON.stringify({ variantSlug: variantName, locale }),
    });

    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || "Failed to create variant");
    }

    emitVariantCreated({ contentType, slug, locale, variantSlug: variantName });
    editMode.markPagePrompted(slug);
    setModalOpen(false);

    // Persist the section index so the new variant page can auto-open the same editor
    if (typeof sessionStorage !== "undefined" && pendingRef.current?.sectionIndex !== undefined) {
      sessionStorage.setItem(
        AUTO_OPEN_KEY,
        JSON.stringify({ sectionIndex: pendingRef.current.sectionIndex, variantName })
      );
    }

    pendingRef.current = null;
    setPendingEdit(null);

    // Navigate to the new variant so subsequent edits happen in the variant context
    navigate(`/private/preview/${contentType}/${slug}?variant=${encodeURIComponent(variantName)}&locale=${locale}`);
  }, [editMode, resolveVersioningSlug]);

  return (
    <>
      {children}
      {/* Variant indicator badge — visible whenever the URL carries a named variant */}
      {activeVariantFromUrl && editMode?.isEditMode && (
        <div
          className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[9999] pointer-events-none"
          data-testid="variant-indicator-badge"
        >
          <Badge
            variant="secondary"
            className={cn(
              "flex items-center gap-1.5 px-3 py-1.5 text-sm shadow-md pointer-events-auto",
              variantTraffic?.isDraft &&
                "border-destructive/40 bg-destructive/10 text-destructive hover:bg-destructive/15",
            )}
          >
            <IconGitFork className="h-3.5 w-3.5 shrink-0" />
            <span>
              Editing variant: <strong>{activeVariantFromUrl}</strong>
              {variantTraffic?.isDraft ? (
                <> · Page has not been published</>
              ) : variantTraffic?.allocation != null ? (
                variantTraffic.allocation > 0 ? (
                  <> · {variantTraffic.allocation}% traffic</>
                ) : (
                  <> · 0% traffic (not receiving visitors)</>
                )
              ) : null}
            </span>
            {variantTraffic?.isDraft && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-xs ml-1 border-destructive/30 text-destructive hover:bg-destructive/10"
                  onClick={() => setShareDraftOpen(true)}
                  data-testid="button-share-draft-badge"
                >
                  <IconShare className="h-3 w-3" />
                  Get Feedback
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  className="h-6 px-2 text-xs ml-1"
                  onClick={() => setPublishConfirmOpen(true)}
                  data-testid="button-publish-draft-badge"
                >
                  <IconCrown className="h-3 w-3" />
                  Publish
                </Button>
              </>
            )}
          </Badge>
        </div>
      )}
      <Dialog
        open={publishConfirmOpen}
        onOpenChange={(open) => {
          if (!open && !isPublishing) setPublishConfirmOpen(false);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Publish this draft?</DialogTitle>
            <DialogDescription>
              This will publish{" "}
              <code className="text-xs bg-muted px-1 py-0.5 rounded">{activeVariantFromUrl}</code>{" "}
              as the live page for <strong>all remaining draft locales</strong> that have this draft.
              Other drafts become normal variants at 0% traffic. The page will appear in the sitemap.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              variant="destructive"
              onClick={handlePublishDraft}
              disabled={isPublishing}
              className="w-full"
              data-testid="button-confirm-publish-draft-badge"
            >
              {isPublishing ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <IconCrown className="h-4 w-4" />
              )}
              Yes, publish now
            </Button>
            <Button
              variant="outline"
              onClick={() => setPublishConfirmOpen(false)}
              disabled={isPublishing}
              className="w-full"
              data-testid="button-cancel-publish-draft-badge"
            >
              <IconX className="h-4 w-4" />
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={shareDraftOpen} onOpenChange={setShareDraftOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <IconShare className="h-5 w-5 shrink-0" aria-hidden />
              Share your draft
            </DialogTitle>
            <DialogDescription>
              Send this link to colleagues so they can review the page in their browser. They do not
              need edit access — anyone with the link sees this draft only. The live site stays
              unchanged until you publish.
            </DialogDescription>
          </DialogHeader>
          {draftShareUrl && (
            <div className="flex items-center gap-2">
              <Input
                readOnly
                value={draftShareUrl}
                className="font-mono text-xs"
                data-testid="input-share-draft-url"
              />
              <Button
                size="icon"
                variant="outline"
                onClick={handleCopyDraftShareUrl}
                data-testid="button-copy-share-draft-url"
                aria-label="Copy link"
              >
                <IconCopy className="h-4 w-4" />
              </Button>
            </div>
          )}
          <DialogFooter className="sm:justify-end gap-2 flex-wrap">
            <SolveWithAiAgentDropdown
              label="Get feedback from AI Agent"
              prompt={draftFeedbackPrompt}
              disabled={!draftFeedbackPrompt}
              testId="share-draft-ai-agent"
              entryKey={
                contentInfo.type && contentInfo.slug
                  ? `${contentInfo.type}/${contentInfo.slug}/${urlLocale}`
                  : undefined
              }
              onAgentSelect={({ agentId, setupTab, label, prompt, prefillUrlPrefix }) => {
                setShareDraftOpen(false);
                setMcpRequiredAgentId(agentId);
                setMcpRequiredSetupTab(setupTab);
                setMcpRequiredAgentLabel(label);
                setMcpRequiredPrompt(prompt);
                setMcpRequiredPrefillPrefix(prefillUrlPrefix);
                setMcpRequiredForAiOpen(true);
              }}
            />
            <Button
              variant="outline"
              onClick={() => setShareDraftOpen(false)}
              data-testid="button-close-share-draft-modal"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <McpRequiredForAiModal
        open={mcpRequiredForAiOpen}
        onOpenChange={setMcpRequiredForAiOpen}
        defaultTab={mcpRequiredSetupTab}
        agentId={mcpRequiredAgentId}
        agentLabel={mcpRequiredAgentLabel}
        prompt={mcpRequiredPrompt}
        prefillUrlPrefix={mcpRequiredPrefillPrefix}
      />
      {pendingEdit && (
        <FirstEditPromptModal
          isOpen={modalOpen}
          contentType={pendingEdit.contentType}
          slug={pendingEdit.slug}
          locale={pendingEdit.locale}
          existingVariants={existingVariants}
          onCreateVariant={handleCreateVariant}
          onSwitchToVariant={handleSwitchToVariant}
          onEditLive={handleEditLive}
        />
      )}
    </>
  );
}

// Inner component that uses the edit mode context
function EditModeInner({ 
  children, 
  sections, 
  contentType, 
  slug, 
  locale 
}: EditModeWrapperProps) {
  const pageHistory = usePageHistoryOptional();
  const [localSections, setLocalSections] = useState<Section[]>(sections || []);
  const localSectionsRef = useRef<Section[]>(localSections);
  
  // Keep ref in sync with state
  useEffect(() => {
    localSectionsRef.current = localSections;
  }, [localSections]);
  
  // Sync localSections when sections prop changes (e.g., after refetch)
  useEffect(() => {
    if (sections) {
      setLocalSections(sections);
    }
  }, [sections]);
  
  // Register page context with history provider
  // Keep context registered even when exiting edit mode so undo/redo still works
  useEffect(() => {
    if (pageHistory && contentType && slug && locale) {
      pageHistory.setPageContext({
        contentType: contentType || "page",
        slug,
        locale,
        onSectionsRestore: (restoredSections: Section[]) => {
          setLocalSections(restoredSections);
        },
        getCurrentSections: () => localSectionsRef.current,
      });
      
      return () => {
        pageHistory.setPageContext(null);
      };
    }
  }, [pageHistory, contentType, slug, locale]);
  
  return <>{children}</>;
}

// Main wrapper that provides the context
// Edit capabilities are checked but sync is deferred until edit mode is toggled on
export function EditModeWrapper({ 
  children, 
  sections, 
  contentType, 
  slug, 
  locale 
}: EditModeWrapperProps) {
  const { canEdit, isDebugMode, isLoading } = useDebugAuth();
  
  const withStaffAlerts = (node: ReactNode) => (
    <>
      <StaffSystemAlertBanner />
      {node}
    </>
  );
  
  // Non-debug users: render children directly (no overhead)
  if (!isDebugMode) {
    return <>{children}</>;
  }
  
  // While auth is loading, provide EditModeProvider so the toggle can appear
  // Once loaded, if user has no edit capabilities, they still see the toggle but can't edit
  if (isLoading) {
    // Provide context while loading so DebugBubble can show the toggle
    return withStaffAlerts(
      <EditModeProvider>
        <PageHistoryProvider enabled={true}>
          <FirstEditGate>
            <EditModeInner 
              sections={sections} 
              contentType={contentType} 
              slug={slug} 
              locale={locale}
            >
              {children}
            </EditModeInner>
          </FirstEditGate>
        </PageHistoryProvider>
      </EditModeProvider>
    );
  }
  
  // No edit capability: render children directly
  if (!canEdit) {
    return withStaffAlerts(<>{children}</>);
  }
  
  // Has edit capability: provide EditModeProvider for toggle UI
  // SyncWrapper only activates when user actually enters edit mode
  return withStaffAlerts(
    <EditModeProvider>
      <PageHistoryProvider enabled={true}>
        <SyncWrapper>
          <FirstEditGate>
            <EditModeInner 
              sections={sections} 
              contentType={contentType} 
              slug={slug} 
              locale={locale}
            >
              {children}
            </EditModeInner>
          </FirstEditGate>
        </SyncWrapper>
      </PageHistoryProvider>
    </EditModeProvider>
  );
}
