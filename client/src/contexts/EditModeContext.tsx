import { createContext, useContext, useState, useEffect, useRef } from "react";
import type { Section, EditOperation } from "@shared/schema";
import { editContent } from "@/lib/contentApi";
import { navigate } from "wouter/use-browser-location";
import { useLocation, useSearch } from "wouter";
import { useContentTypes } from "@/hooks/useContentTypes";
import { queryClient } from "@/lib/queryClient";
import { UnresolvedEditModeLinkDialog } from "@/components/editing/UnresolvedEditModeLinkDialog";
import { prepareEditModeHref } from "@/contexts/editModeHref";
import { isPrivatePreviewPath } from "@/lib/visual-edit-path";
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
import {
  PREVIEW_LOCATION_PARAM,
  PREVIEW_MODE_PARAM,
  applyPreviewModeToSearchParams,
  decidePreviewUrlSync,
  parsePreviewModeParam,
  persistPreviewMode,
  readStoredPreviewMode,
  stashLocationForLlm,
  takeStashedLocationForLlm,
  type PreviewMode,
} from "@/lib/preview-mode";

export type PreviewBreakpoint = 'desktop' | 'mobile';
export type { PreviewDeviceId };
export type { PreviewMode };

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
  if (typeof window === "undefined" || typeof localStorage === "undefined") return false;
  if (isDeviceEmbedPreview()) return false;
  // Persist only on the visual preview route — not settings, diagnostics, or other admin pages.
  if (!window.location?.pathname?.startsWith("/private/preview/")) return false;
  return localStorage.getItem(EDIT_MODE_KEY) === "true";
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
  /** Staff LLM crawler viewport on /private/preview (read-only). */
  isLlmPreview: boolean;
  setPreviewBreakpoint: (breakpoint: PreviewBreakpoint) => void;
  setPreviewDevice: (deviceId: PreviewDeviceId) => void;
  setPreviewMode: (mode: PreviewMode) => void;
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
  if (typeof window === "undefined" || !window.location) return false;
  if (isDeviceEmbedPreview()) return false;
  const urlParams = new URLSearchParams(window.location.search ?? "");
  return urlParams.get('edit_mode') === 'true' || urlParams.get('edit') === '1';
}

function readInitialPreviewFromUrl(): {
  breakpoint: PreviewBreakpoint;
  deviceId: PreviewDeviceId;
  isLlm: boolean;
  fromUrl: boolean;
} {
  if (typeof window === "undefined" || !window.location) {
    return {
      breakpoint: "desktop",
      deviceId: DEFAULT_PREVIEW_DEVICE_ID,
      isLlm: false,
      fromUrl: false,
    };
  }
  const fromUrl = parsePreviewModeParam(
    new URLSearchParams(window.location.search ?? "").get(PREVIEW_MODE_PARAM),
  );
  // URL wins; otherwise restore last staff choice on /private/preview only
  // (keeps LLM across refresh without activating crawler chrome on public URLs).
  const onPrivatePreview = isPrivatePreviewPath(window.location.pathname ?? "");
  const mode = fromUrl ?? (onPrivatePreview ? readStoredPreviewMode() : null);
  if (!mode) {
    return {
      breakpoint: getStoredPreviewBreakpoint(),
      deviceId: getStoredPreviewDeviceId(),
      isLlm: false,
      fromUrl: false,
    };
  }
  if (mode.kind === "llm") {
    return {
      breakpoint: "desktop",
      deviceId: getStoredPreviewDeviceId(),
      isLlm: true,
      fromUrl: !!fromUrl,
    };
  }
  if (mode.kind === "device") {
    return {
      breakpoint: "mobile",
      deviceId: mode.deviceId,
      isLlm: false,
      fromUrl: !!fromUrl,
    };
  }
  return {
    breakpoint: "desktop",
    deviceId: getStoredPreviewDeviceId(),
    isLlm: false,
    fromUrl: !!fromUrl,
  };
}

function replacePreviewSearch(mutate: (params: URLSearchParams) => void): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  mutate(url.searchParams);
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) {
    window.history.replaceState(window.history.state, "", next);
  }
}

export function EditModeProvider({ children }: EditModeProviderProps) {
  const initialPreview = readInitialPreviewFromUrl();
  const [isEditMode, setIsEditMode] = useState(() => {
    if (initialPreview.isLlm) return false;
    return shouldAutoEnableEditMode() || getStoredEditMode();
  });
  const [selectedSectionIndex, setSelectedSectionIndex] = useState<number | null>(null);
  const [pendingChanges, setPendingChanges] = useState<Map<string, EditOperation[]>>(new Map());
  const [isSaving, setIsSaving] = useState(false);
  const [previewBreakpoint, setPreviewBreakpointState] = useState<PreviewBreakpoint>(
    () => initialPreview.breakpoint,
  );
  const [previewDeviceId, setPreviewDeviceIdState] = useState<PreviewDeviceId>(
    () => initialPreview.deviceId,
  );
  const [isLlmPreview, setIsLlmPreview] = useState(() => initialPreview.isLlm);
  const [promptedPageSlugs, setPromptedPageSlugs] = useState<Set<string>>(new Set());
  const [unresolvedLinkOpen, setUnresolvedLinkOpen] = useState(false);
  const [unresolvedLinkVar, setUnresolvedLinkVar] = useState<string | undefined>();
  const contentTypesMap = useContentTypes();
  const contentTypesRef = useRef(contentTypesMap);

  const syncPreviewModeToUrl = (mode: PreviewMode) => {
    persistPreviewMode(mode);
    replacePreviewSearch((params) => {
      const next = applyPreviewModeToSearchParams(params, mode, { stripLocationForLlm: true });
      params.clear();
      next.forEach((value, key) => params.set(key, value));
    });
  };

  const persistEditMode = (value: boolean) => {
    if (typeof localStorage !== "undefined") {
      if (value) {
        localStorage.setItem(EDIT_MODE_KEY, "true");
      } else {
        localStorage.removeItem(EDIT_MODE_KEY);
      }
    }
  };

  const [pathname] = useLocation();
  const searchString = useSearch();

  // Share links and in-app navigation: URL preview_mode wins on visual-edit paths.
  // Public pages only sync LLM; desktop/device stay /private/preview-only.
  // When the param is missing but React still says LLM, re-stamp the URL so
  // refresh and Share keep working across navbar clicks.
  useEffect(() => {
    const mode = parsePreviewModeParam(
      new URLSearchParams(searchString.startsWith("?") ? searchString.slice(1) : searchString).get(
        PREVIEW_MODE_PARAM,
      ),
    );
    const decision = decidePreviewUrlSync({ pathname, mode, isLlmPreview });
    if (decision.action === "ignore") return;

    if (decision.action === "restamp-llm") {
      syncPreviewModeToUrl({ kind: "llm" });
      return;
    }

    if (decision.action === "apply-llm") {
      // Always force read-only crawler chrome; enableEditMode can race and leave
      // edit mode on while isLlmPreview is already true.
      if (isEditMode) {
        setIsEditMode(false);
        persistEditMode(false);
        setSelectedSectionIndex(null);
      }
      if (!isLlmPreview) {
        setIsLlmPreview(true);
        setPreviewBreakpointState("desktop");
        clearStoredPreviewSelection();
        persistPreviewMode({ kind: "llm" });
      }
      if (decision.stripLocation) {
        const params = new URLSearchParams(
          searchString.startsWith("?") ? searchString.slice(1) : searchString,
        );
        if (params.has(PREVIEW_LOCATION_PARAM)) {
          params.delete(PREVIEW_LOCATION_PARAM);
          const qs = params.toString();
          window.history.replaceState(
            window.history.state,
            "",
            `${pathname}${qs ? `?${qs}` : ""}${window.location.hash}`,
          );
        }
      }
      return;
    }

    if (decision.action === "apply-desktop") {
      if (isLlmPreview || previewBreakpoint !== "desktop") {
        // Leaving LLM on private preview restores edit so staff can work again.
        if (isLlmPreview && !isDeviceEmbedPreview()) {
          setIsEditMode(true);
          persistEditMode(true);
        }
        setIsLlmPreview(false);
        setPreviewBreakpointState("desktop");
        clearStoredPreviewSelection();
        persistPreviewMode({ kind: "desktop" });
      }
      return;
    }

    // apply-device
    if (
      isLlmPreview ||
      previewBreakpoint !== "mobile" ||
      previewDeviceId !== decision.deviceId ||
      !isEditMode
    ) {
      // Device chrome on /private/preview requires edit mode; LLM turns it off.
      if (!isDeviceEmbedPreview()) {
        setIsEditMode(true);
        persistEditMode(true);
      }
      setIsLlmPreview(false);
      setPreviewDeviceIdState(decision.deviceId);
      setPreviewBreakpointState("mobile");
      persistPreviewSelection("mobile", decision.deviceId);
      persistPreviewMode({ kind: "device", deviceId: decision.deviceId });
    }
  }, [pathname, searchString]); // eslint-disable-line react-hooks/exhaustive-deps — URL is source of truth

  const exitDevicePreview = () => {
    setPreviewBreakpointState("desktop");
    setIsLlmPreview(false);
    clearStoredPreviewSelection();
  };

  const setPreviewMode = (mode: PreviewMode) => {
    if (mode.kind === "llm") {
      const currentLocation =
        typeof window !== "undefined"
          ? new URLSearchParams(window.location.search).get(PREVIEW_LOCATION_PARAM)
          : null;
      stashLocationForLlm(currentLocation);
      setIsEditMode(false);
      persistEditMode(false);
      setSelectedSectionIndex(null);
      setIsLlmPreview(true);
      setPreviewBreakpointState("desktop");
      clearStoredPreviewSelection();
      syncPreviewModeToUrl(mode);
      return;
    }

    const wasLlm = isLlmPreview;
    const onPrivatePreview =
      typeof window !== "undefined" && isPrivatePreviewPath(window.location.pathname);
    setIsLlmPreview(false);

    if (mode.kind === "desktop") {
      const stashed = wasLlm ? takeStashedLocationForLlm() : null;
      setPreviewBreakpointState("desktop");
      clearStoredPreviewSelection();
      persistPreviewMode(mode);

      // Leaving LLM on a public page: stay put, editing off, strip the param.
      if (wasLlm && !onPrivatePreview) {
        replacePreviewSearch((params) => {
          params.delete(PREVIEW_MODE_PARAM);
          if (stashed) {
            params.set(PREVIEW_LOCATION_PARAM, stashed);
          }
        });
        return;
      }

      // Private preview: restore edit when leaving LLM.
      if (wasLlm && !isDeviceEmbedPreview()) {
        setIsEditMode(true);
        persistEditMode(true);
      }

      if (stashed && typeof window !== "undefined") {
        const url = new URL(window.location.href);
        url.searchParams.set(PREVIEW_MODE_PARAM, "desktop");
        url.searchParams.set(PREVIEW_LOCATION_PARAM, stashed);
        window.location.assign(`${url.pathname}?${url.searchParams.toString()}${url.hash}`);
        return;
      }
      syncPreviewModeToUrl(mode);
      return;
    }

    // Device shell needs edit mode; LLM clears it.
    if (!isDeviceEmbedPreview()) {
      setIsEditMode(true);
      persistEditMode(true);
    }
    setPreviewDeviceIdState(mode.deviceId);
    setPreviewBreakpointState("mobile");
    persistPreviewSelection("mobile", mode.deviceId);
    syncPreviewModeToUrl(mode);
  };

  const setPreviewBreakpoint = (breakpoint: PreviewBreakpoint) => {
    if (breakpoint === "desktop") {
      setPreviewMode({ kind: "desktop" });
      return;
    }
    setPreviewMode({ kind: "device", deviceId: previewDeviceId });
  };

  const setPreviewDevice = (deviceId: PreviewDeviceId) => {
    setPreviewMode({ kind: "device", deviceId });
  };

  const togglePreviewBreakpoint = () => {
    if (isLlmPreview) {
      setPreviewMode({ kind: "desktop" });
      return;
    }
    setPreviewBreakpointState(prev => {
      const next = prev === "desktop" ? "mobile" : "desktop";
      persistPreviewSelection(next, previewDeviceId);
      syncPreviewModeToUrl(
        next === "mobile"
          ? { kind: "device", deviceId: previewDeviceId }
          : { kind: "desktop" },
      );
      return next;
    });
  };

  const enableEditMode = () => {
    if (isDeviceEmbedPreview() || isLlmPreview) return;
    setIsEditMode(true);
    persistEditMode(true);
  };

  const disableEditMode = () => {
    if (isDeviceEmbedPreview()) return;
    setIsEditMode(false);
    persistEditMode(false);
    setSelectedSectionIndex(null);
    exitDevicePreview();
    syncPreviewModeToUrl({ kind: "desktop" });
  };

  const toggleEditMode = () => {
    if (isDeviceEmbedPreview() || isLlmPreview) return;
    if (isEditMode) {
      setIsEditMode(false);
      persistEditMode(false);
      setSelectedSectionIndex(null);
      exitDevicePreview();
      syncPreviewModeToUrl({ kind: "desktop" });
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
    isLlmPreview,
    setPreviewBreakpoint,
    setPreviewDevice,
    setPreviewMode,
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
