import { createContext, useContext, useState, useEffect, useRef } from "react";
import type { Section, EditOperation } from "@shared/schema";
import { editContent } from "@/lib/contentApi";
import { navigate } from "wouter/use-browser-location";
import { useContentTypes } from "@/hooks/useContentTypes";
import { queryClient } from "@/lib/queryClient";
import { UnresolvedEditModeLinkDialog } from "@/components/editing/UnresolvedEditModeLinkDialog";
import { prepareEditModeHref } from "@/contexts/editModeHref";
import {
  DEFAULT_PREVIEW_DEVICE_ID,
  PREVIEW_BREAKPOINT_KEY,
  PREVIEW_DEVICE_KEY,
  clearStoredPreviewSelection,
  isDeviceEmbedPreview,
  migrateLegacyPreviewDevice,
  persistPreviewSelection,
  notifyDeviceEmbedNavBlocked,
  shouldAllowDeviceEmbedHref,
  type PreviewDeviceId,
} from "@/lib/preview-devices";

export type PreviewBreakpoint = 'desktop' | 'mobile';
export type { PreviewDeviceId };

const EDIT_MODE_KEY = '4geeks_edit_mode';

function getStoredPreviewBreakpoint(): PreviewBreakpoint {
  if (typeof localStorage === 'undefined') return 'desktop';
  const stored = localStorage.getItem(PREVIEW_BREAKPOINT_KEY);
  if (stored === 'mobile' || stored === 'desktop') return stored;
  return 'desktop';
}

function getStoredPreviewDeviceId(): PreviewDeviceId {
  if (typeof localStorage === 'undefined') return DEFAULT_PREVIEW_DEVICE_ID;
  return migrateLegacyPreviewDevice(
    localStorage.getItem(PREVIEW_DEVICE_KEY),
    localStorage.getItem(PREVIEW_BREAKPOINT_KEY),
  );
}

function getStoredEditMode(): boolean {
  if (typeof localStorage === 'undefined') return false;
  if (isDeviceEmbedPreview()) return false;
  // Persist only on the visual preview route — not settings, diagnostics, or other admin pages.
  if (!window.location.pathname.startsWith('/private/preview/')) return false;
  return localStorage.getItem(EDIT_MODE_KEY) === 'true';
}

function publicUrlToPreviewUrl(
  pathname: string,
  contentTypes?: Record<string, { directory: string; url_pattern: Record<string, string> }> | null
): string | null {
  if (!contentTypes) return null;

  const pathLocale = pathname.startsWith('/es/') ? 'es' : 'en';

  const sortedTypes = Object.entries(contentTypes).sort(([a], [b]) => {
    if (a === 'page') return 1;
    if (b === 'page') return -1;
    return 0;
  });

  for (const [typeName, ct] of sortedTypes) {
    for (const [locale, pattern] of Object.entries(ct.url_pattern)) {
      let slugGroupIndex = 1;
      let paramIndex = 0;
      const regexStr = '^' + pattern.replace(/:([a-zA-Z_]+)/g, (_m, name) => {
        paramIndex++;
        if (name === 'slug') slugGroupIndex = paramIndex;
        return '([^/]+)';
      }) + '\\/?$';
      try {
        const regex = new RegExp(regexStr);
        const match = pathname.match(regex);
        if (match) {
          const effectiveLocale = pattern.match(/^\/(en|es)\//) ? locale : pathLocale;
          return `/private/preview/${ct.directory}/${match[slugGroupIndex]}?locale=${effectiveLocale}`;
        }
      } catch {}
    }
  }

  return null;
}

interface EditModeContextValue {
  isEditMode: boolean;
  enableEditMode: () => void;
  disableEditMode: () => void;
  toggleEditMode: () => void;
  selectedSectionIndex: number | null;
  setSelectedSectionIndex: (index: number | null) => void;
  pendingChanges: Map<string, EditOperation[]>;
  addPendingChange: (pageKey: string, operation: EditOperation) => void;
  clearPendingChanges: (pageKey: string) => void;
  hasPendingChanges: boolean;
  isSaving: boolean;
  saveChanges: (pageKey: string, contentType: string, slug: string, locale: string) => Promise<boolean>;
  previewBreakpoint: PreviewBreakpoint;
  previewDeviceId: PreviewDeviceId;
  setPreviewBreakpoint: (breakpoint: PreviewBreakpoint) => void;
  setPreviewDevice: (deviceId: PreviewDeviceId) => void;
  togglePreviewBreakpoint: () => void;
  /** Slugs that have already been prompted for first-edit this session. */
  promptedPageSlugs: Set<string>;
  /** Mark a slug as prompted so subsequent edits skip the modal. */
  markPagePrompted: (slug: string) => void;
}

const EditModeContext = createContext<EditModeContextValue | null>(null);

interface EditModeProviderProps {
  children: React.ReactNode;
}

// Check if edit_mode=true or edit=1 is in URL params
function shouldAutoEnableEditMode(): boolean {
  if (isDeviceEmbedPreview()) return false;
  const urlParams = new URLSearchParams(window.location.search);
  return urlParams.get('edit_mode') === 'true' || urlParams.get('edit') === '1';
}

export function EditModeProvider({ children }: EditModeProviderProps) {
  const [isEditMode, setIsEditMode] = useState(() => shouldAutoEnableEditMode() || getStoredEditMode());
  const [selectedSectionIndex, setSelectedSectionIndex] = useState<number | null>(null);
  const [pendingChanges, setPendingChanges] = useState<Map<string, EditOperation[]>>(new Map());
  const [isSaving, setIsSaving] = useState(false);
  const [previewBreakpoint, setPreviewBreakpointState] = useState<PreviewBreakpoint>(getStoredPreviewBreakpoint);
  const [previewDeviceId, setPreviewDeviceIdState] = useState<PreviewDeviceId>(getStoredPreviewDeviceId);
  const [promptedPageSlugs, setPromptedPageSlugs] = useState<Set<string>>(new Set());
  const [unresolvedLinkOpen, setUnresolvedLinkOpen] = useState(false);
  const [unresolvedLinkVar, setUnresolvedLinkVar] = useState<string | undefined>();
  const contentTypesMap = useContentTypes();
  const contentTypesRef = useRef(contentTypesMap);

  const exitDevicePreview = () => {
    setPreviewBreakpointState("desktop");
    clearStoredPreviewSelection();
  };

  const setPreviewBreakpoint = (breakpoint: PreviewBreakpoint) => {
    setPreviewBreakpointState(breakpoint);
    persistPreviewSelection(breakpoint, previewDeviceId);
  };

  const setPreviewDevice = (deviceId: PreviewDeviceId) => {
    setPreviewDeviceIdState(deviceId);
    setPreviewBreakpointState("mobile");
    persistPreviewSelection("mobile", deviceId);
  };

  const togglePreviewBreakpoint = () => {
    setPreviewBreakpointState(prev => {
      const next = prev === "desktop" ? "mobile" : "desktop";
      persistPreviewSelection(next, previewDeviceId);
      return next;
    });
  };

  const persistEditMode = (value: boolean) => {
    if (typeof localStorage !== 'undefined') {
      if (value) {
        localStorage.setItem(EDIT_MODE_KEY, 'true');
      } else {
        localStorage.removeItem(EDIT_MODE_KEY);
      }
    }
  };

  const enableEditMode = () => {
    if (isDeviceEmbedPreview()) return;
    setIsEditMode(true);
    persistEditMode(true);
  };

  const disableEditMode = () => {
    if (isDeviceEmbedPreview()) return;
    setIsEditMode(false);
    persistEditMode(false);
    setSelectedSectionIndex(null);
    exitDevicePreview();
  };

  const toggleEditMode = () => {
    if (isDeviceEmbedPreview()) return;
    if (isEditMode) {
      setIsEditMode(false);
      persistEditMode(false);
      setSelectedSectionIndex(null);
      exitDevicePreview();
      return;
    }
    setIsEditMode(true);
    persistEditMode(true);
  };

  const addPendingChange = (pageKey: string, operation: EditOperation) => {
    setPendingChanges(prev => {
      const next = new Map(prev);
      const existing = next.get(pageKey) || [];
      next.set(pageKey, [...existing, operation]);
      return next;
    });
  };

  const clearPendingChanges = (pageKey: string) => {
    setPendingChanges(prev => {
      const next = new Map(prev);
      next.delete(pageKey);
      return next;
    });
  };

  const markPagePrompted = (slug: string) => {
    setPromptedPageSlugs(prev => {
      const next = new Set(prev);
      next.add(slug);
      return next;
    });
  };

  const hasPendingChanges = pendingChanges.size > 0 && Array.from(pendingChanges.values()).some(ops => ops.length > 0);

  const saveChanges = async (
    pageKey: string,
    contentType: string,
    slug: string,
    locale: string
  ): Promise<boolean> => {
    const operations = pendingChanges.get(pageKey);
    if (!operations || operations.length === 0) {
      return true;
    }

    setIsSaving(true);
    try {
      const result = await editContent({
        contentType,
        slug,
        locale,
        operations,
      });

      if (result.success) {
        clearPendingChanges(pageKey);
        return true;
      } else {
        console.error("Failed to save changes:", result.error);
        return false;
      }
    } catch (error) {
      console.error("Error saving changes:", error);
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    contentTypesRef.current = contentTypesMap;
  }, [contentTypesMap]);

  useEffect(() => {
    if (!isEditMode) return;
    // SSR seeds a per-page image-registry subset; editors need the full catalog.
    void queryClient.invalidateQueries({ queryKey: ["/api/image-registry"] });
  }, [isEditMode]);

  // Unwrap preserveTemplate hrefs ({{ entry.x | https://… }}) so plain <a> CTAs
  // do not navigate to /private/preview/…/%7B%7B…. Cmd/middle-click: follow-up
  // (render-time honest href / InternalLink). Offenders: double_cta, comparison_table,
  // course_selector, community_support, pricing_plans CTA, MoleculeRenderer CtaButton.
  useEffect(() => {
    if (!isEditMode) return;

    const handleClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return;

      const rawHref = anchor.getAttribute("href");
      if (!rawHref) return;

      const prepared = prepareEditModeHref(rawHref);

      if (prepared.kind === "unresolved") {
        e.preventDefault();
        e.stopPropagation();
        setUnresolvedLinkVar(prepared.variableName);
        setUnresolvedLinkOpen(true);
        return;
      }

      if (prepared.kind === "external") {
        e.preventDefault();
        e.stopPropagation();
        const target = anchor.getAttribute("target") || undefined;
        if (target === "_blank") {
          window.open(prepared.href, "_blank", "noopener,noreferrer");
        } else if (target) {
          window.open(prepared.href, target);
        } else {
          window.location.assign(prepared.href);
        }
        return;
      }

      if (prepared.kind === "ignore") return;

      // internal: rewrite public content URLs into /private/preview when possible
      const previewUrl = publicUrlToPreviewUrl(prepared.href, contentTypesRef.current);
      if (previewUrl) {
        e.preventDefault();
        e.stopPropagation();
        navigate(previewUrl);
      }
    };

    document.addEventListener("click", handleClick, true);
    return () => document.removeEventListener("click", handleClick, true);
  }, [isEditMode]);

  useEffect(() => {
    if (!isDeviceEmbedPreview()) return;

    const blockOffPageAnchor = (e: MouseEvent) => {
      const anchor = (e.target as HTMLElement).closest("a");
      if (!anchor) return;
      const href = anchor.getAttribute("href");
      if (!href || shouldAllowDeviceEmbedHref(href)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.type === "click") notifyDeviceEmbedNavBlocked();
    };

    document.addEventListener("click", blockOffPageAnchor, true);
    document.addEventListener("auxclick", blockOffPageAnchor, true);
    return () => {
      document.removeEventListener("click", blockOffPageAnchor, true);
      document.removeEventListener("auxclick", blockOffPageAnchor, true);
    };
  }, []);

  const value: EditModeContextValue = {
    isEditMode,
    enableEditMode,
    disableEditMode,
    toggleEditMode,
    selectedSectionIndex,
    setSelectedSectionIndex,
    pendingChanges,
    addPendingChange,
    clearPendingChanges,
    hasPendingChanges,
    isSaving,
    saveChanges,
    previewBreakpoint,
    previewDeviceId,
    setPreviewBreakpoint,
    setPreviewDevice,
    togglePreviewBreakpoint,
    promptedPageSlugs,
    markPagePrompted,
  };

  return (
    <EditModeContext.Provider value={value}>
      {children}
      <UnresolvedEditModeLinkDialog
        open={unresolvedLinkOpen}
        onOpenChange={setUnresolvedLinkOpen}
        variableName={unresolvedLinkVar}
      />
    </EditModeContext.Provider>
  );
}

export function useEditMode() {
  const context = useContext(EditModeContext);
  if (!context) {
    throw new Error("useEditMode must be used within an EditModeProvider");
  }
  return context;
}

// Safe hook that returns null if not within provider (for lazy loading)
export function useEditModeOptional(): EditModeContextValue | null {
  return useContext(EditModeContext);
}
