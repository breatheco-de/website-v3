import type { CSSProperties, ComponentType } from "react";
import { AlertTriangle, Link, Loader2, Trash2 } from "lucide-react";
import { useState, useCallback, useMemo, useRef, useEffect } from "react";
import type { Section, EditOperation, SectionLayout, ResponsiveSpacing, ShowOn, PageSettings } from "@shared/schema";
import { useSession } from "@/contexts/SessionContext";
import { useMenuVisualContext } from "@/contexts/MenuVisualContext";
import { VariableHighlightProvider } from "@/components/editing/VariableHighlight";
import { useVariableDefinitions, useVariableContext } from "@/hooks/useVariables";
import { resolveDeep, resolveTemplateString, type VariableContext } from "@/lib/variable-manager";
import { SectionContextProvider } from "@/contexts/SectionContext";
import { isSSRHydration } from "@/lib/initialData";


// Spacing presets in pixels (top, bottom)
const SPACING_PRESETS: Record<string, { top: string; bottom: string }> = {
  none: { top: "0px", bottom: "0px" },
  sm: { top: "16px", bottom: "16px" },
  md: { top: "32px", bottom: "32px" },
  lg: { top: "64px", bottom: "64px" },
  xl: { top: "96px", bottom: "96px" },
};

// Resolve a single spacing value (preset name or custom CSS)
function resolveSpacingValue(val: string): string {
  const preset = SPACING_PRESETS[val];
  if (preset) return preset.top; // All presets have equal top/bottom
  return val; // Return as-is (custom CSS value like "20px")
}

// Parse a single breakpoint's spacing value - supports presets or custom CSS values
// Returns { top, bottom } for the given value string
function parseSpacingValue(value: string): { top: string; bottom: string } {
  // Check if it's a single preset
  if (SPACING_PRESETS[value]) {
    return SPACING_PRESETS[value];
  }

  // Parse two-value format (e.g., "lg xl" or "20px 32px")
  const parts = value.trim().split(/\s+/);
  if (parts.length === 1) {
    const resolved = resolveSpacingValue(parts[0]);
    return { top: resolved, bottom: resolved };
  }
  return { 
    top: resolveSpacingValue(parts[0]), 
    bottom: resolveSpacingValue(parts[1] || parts[0]) 
  };
}

// Parse responsive spacing object - returns mobile and desktop values
// Inheritance: if only one breakpoint is specified, the other inherits its value
function parseResponsiveSpacing(value: ResponsiveSpacing | undefined): {
  mobile: { top: string; bottom: string };
  desktop: { top: string; bottom: string };
} | null {
  if (!value) return null;

  // Handle inheritance: if one is missing, use the other's value
  const mobileValue = value.mobile ?? value.desktop ?? "none";
  const desktopValue = value.desktop ?? value.mobile ?? "none";

  return {
    mobile: parseSpacingValue(mobileValue),
    desktop: parseSpacingValue(desktopValue),
  };
}

// Default spacing when YAML doesn't specify values
const DEFAULT_SPACING = { top: "0px", bottom: "0px" };
const DEFAULT_SPACING_X = { left: "0px", right: "0px" };
const DEFAULT_INNER_PADDING_X = "0px";

function parseResponsiveSpacingX(value: ResponsiveSpacing | undefined): {
  mobile: { left: string; right: string };
  desktop: { left: string; right: string };
} | null {
  if (!value) return null;

  const mobileValue = value.mobile ?? value.desktop ?? "none";
  const desktopValue = value.desktop ?? value.mobile ?? "none";

  const parseLR = (v: string) => {
    if (!v || v === "none") return { left: "0px", right: "0px" };
    const parts = v.trim().split(/\s+/);
    if (parts.length === 1) {
      const resolved = resolveSpacingValue(parts[0]);
      return { left: resolved, right: resolved };
    }
    return {
      left: resolveSpacingValue(parts[0]),
      right: resolveSpacingValue(parts[1] || parts[0]),
    };
  };

  return {
    mobile: parseLR(mobileValue),
    desktop: parseLR(desktopValue),
  };
}

// Max-width presets mapped to CSS values
const MAX_WIDTH_PRESETS: Record<string, string> = {
  none: "none",
  sm: "672px",
  md: "768px",
  lg: "896px",
  xl: "1152px",
  "2xl": "1280px",
  "6xl": "1152px",
  full: "100%",
};

function resolveMaxWidthValue(val: string): string {
  if (MAX_WIDTH_PRESETS[val]) return MAX_WIDTH_PRESETS[val];
  return val;
}

function parseResponsiveMaxWidth(value: ResponsiveSpacing | undefined): {
  mobile: string;
  desktop: string;
} | null {
  if (!value) return null;

  const mobileValue = value.mobile ?? value.desktop ?? "none";
  const desktopValue = value.desktop ?? value.mobile ?? "none";

  return {
    mobile: resolveMaxWidthValue(mobileValue),
    desktop: resolveMaxWidthValue(desktopValue),
  };
}

function hasConstrainedMaxWidth(value: string): boolean {
  return value !== "none" && value !== "100%";
}

function parseResponsiveInnerPaddingXFromMaxWidth(value: ResponsiveSpacing | undefined): {
  mobile: string;
  desktop: string;
} | null {
  const maxWidth = parseResponsiveMaxWidth(value);
  if (!maxWidth) return null;

  return {
    mobile: hasConstrainedMaxWidth(maxWidth.mobile) ? "1rem" : DEFAULT_INNER_PADDING_X,
    desktop: hasConstrainedMaxWidth(maxWidth.desktop) ? "1rem" : DEFAULT_INNER_PADDING_X,
  };
}

// Semantic background tokens mapped to CSS variables
const BACKGROUND_TOKENS: Record<string, string> = {
  background: "hsl(var(--background))",
  muted: "hsl(var(--muted))",
  card: "hsl(var(--card))",
  accent: "hsl(var(--accent))",
  primary: "hsl(var(--primary))",
  secondary: "hsl(var(--secondary))",
  sidebar: "hsl(var(--sidebar-background))",
  destructive: "hsl(var(--destructive))",
};

// Parse background value - supports semantic tokens or custom CSS
function parseBackground(value: string | undefined): string | undefined {
  if (!value || value === "inherit" || value === "none") return undefined;

  // Check if it's a semantic token
  if (BACKGROUND_TOKENS[value]) {
    return BACKGROUND_TOKENS[value];
  }

  // Return as-is for custom values (gradients, colors, etc.)
  return value;
}

// Get section wrapper styles - full-bleed background + spacing + CSS vars
// Uses CSS custom properties + media query for responsive behavior
// paddingY/marginY/paddingX/marginX: Applied to wrapper
// background: Applied to wrapper (semantic token or custom CSS)
// maxWidth: stored as CSS vars (--section-mw-*) and applied on inner container
// Inner gutter is auto-applied only when maxWidth constrains the content
function getSectionWrapperStyles(section: Section): CSSProperties & Record<string, string> {
  const layoutSection = section as SectionLayout;

  const padding = parseResponsiveSpacing(layoutSection.paddingY);
  const margin = parseResponsiveSpacing(layoutSection.marginY);
  const paddingX = parseResponsiveSpacingX(layoutSection.paddingX);
  const marginX = parseResponsiveSpacingX(layoutSection.marginX);
  const maxWidth = parseResponsiveMaxWidth(layoutSection.maxWidth);
  const innerPaddingX = parseResponsiveInnerPaddingXFromMaxWidth(layoutSection.maxWidth);
  const background = parseBackground(layoutSection.background);

  const styles: CSSProperties & Record<string, string> = {
    paddingTop: 'var(--section-pt)',
    paddingBottom: 'var(--section-pb)',
    marginTop: 'var(--section-mt)',
    marginBottom: 'var(--section-mb)',
    paddingLeft: 'var(--section-pl)',
    paddingRight: 'var(--section-pr)',
    marginLeft: 'var(--section-ml)',
    marginRight: 'var(--section-mr)',
  };

  styles['--section-pt-mobile'] = padding?.mobile.top ?? DEFAULT_SPACING.top;
  styles['--section-pb-mobile'] = padding?.mobile.bottom ?? DEFAULT_SPACING.bottom;
  styles['--section-mt-mobile'] = margin?.mobile.top ?? DEFAULT_SPACING.top;
  styles['--section-mb-mobile'] = margin?.mobile.bottom ?? DEFAULT_SPACING.bottom;
  styles['--section-pt-desktop'] = padding?.desktop.top ?? DEFAULT_SPACING.top;
  styles['--section-pb-desktop'] = padding?.desktop.bottom ?? DEFAULT_SPACING.bottom;
  styles['--section-mt-desktop'] = margin?.desktop.top ?? DEFAULT_SPACING.top;
  styles['--section-mb-desktop'] = margin?.desktop.bottom ?? DEFAULT_SPACING.bottom;

  styles['--section-pl-mobile'] = paddingX?.mobile.left ?? DEFAULT_SPACING_X.left;
  styles['--section-pr-mobile'] = paddingX?.mobile.right ?? DEFAULT_SPACING_X.right;
  styles['--section-ml-mobile'] = marginX?.mobile.left ?? DEFAULT_SPACING_X.left;
  styles['--section-mr-mobile'] = marginX?.mobile.right ?? DEFAULT_SPACING_X.right;
  styles['--section-pl-desktop'] = paddingX?.desktop.left ?? DEFAULT_SPACING_X.left;
  styles['--section-pr-desktop'] = paddingX?.desktop.right ?? DEFAULT_SPACING_X.right;
  styles['--section-ml-desktop'] = marginX?.desktop.left ?? DEFAULT_SPACING_X.left;
  styles['--section-mr-desktop'] = marginX?.desktop.right ?? DEFAULT_SPACING_X.right;

  styles['--section-mw-mobile'] = maxWidth?.mobile ?? "none";
  styles['--section-mw-desktop'] = maxWidth?.desktop ?? "none";
  styles['--section-inner-px-mobile'] = innerPaddingX?.mobile ?? DEFAULT_INNER_PADDING_X;
  styles['--section-inner-px-desktop'] = innerPaddingX?.desktop ?? DEFAULT_INNER_PADDING_X;

  if (background) {
    styles.background = background;
  }

  return styles;
}

// Get CSS classes for section visibility based on showOn property
// Uses Tailwind responsive classes to show/hide sections at breakpoints
// mobile: hidden at md and up (>= 768px)
// desktop: hidden below md (< 768px)
// all or undefined: visible at all breakpoints
function getSectionVisibilityClasses(showOn: ShowOn | undefined): string {
  switch (showOn) {
    case 'mobile':
      return 'block md:hidden'; // Show on mobile, hide on desktop
    case 'desktop':
      return 'hidden md:block'; // Hide on mobile, show on desktop
    case 'all':
    default:
      return ''; // Visible on all breakpoints
  }
}
import { EditableSection } from "@/components/editing/EditableSection";
import { AddSectionButton } from "@/components/editing/AddSectionButton";
import ComponentPickerModal from "@/components/editing/ComponentPickerModal";
import { useToast } from "@/hooks/use-toast";
import { getDebugToken, resolveAuthorName } from "@/hooks/useDebugAuth";
import { emitContentUpdated } from "@/lib/contentEvents";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useEditModeOptional, type PreviewBreakpoint } from "@/contexts/EditModeContext";

// Check if a section should be visible based on showOn and current preview breakpoint
// In edit mode: always show all sections (visibility alert is shown instead of hiding)
// In production: CSS handles visibility
function shouldShowSection(showOn: ShowOn | undefined, previewBreakpoint: PreviewBreakpoint | undefined, isEditMode: boolean): boolean {
  if (isEditMode) return true;
  return true;
}

function shouldShowSectionForLocation(
  section: Section,
  locationSlug: string | undefined,
  locationRegion: string | undefined,
  isEditMode: boolean
): boolean {
  if (isEditMode) return true;

  const layout = section as SectionLayout;
  const { showOnLocations, showOnRegions } = layout;

  const hasLocationFilter = showOnLocations && showOnLocations.length > 0;
  const hasRegionFilter = showOnRegions && showOnRegions.length > 0;

  if (!hasLocationFilter && !hasRegionFilter) return true;

  if (hasLocationFilter && locationSlug && showOnLocations.includes(locationSlug)) return true;
  if (hasRegionFilter && locationRegion && showOnRegions.includes(locationRegion)) return true;

  if (hasLocationFilter && !hasRegionFilter) return false;
  if (hasRegionFilter && !hasLocationFilter) return false;

  return false;
}

const DEFAULT_EAGER_COUNT = 3;

function resolveLoadStrategy(
  section: Section,
  index: number,
  settings?: PageSettings
): "eager" | "lazy" {
  const layout = section as SectionLayout;
  if (layout.load) return layout.load;
  const eagerCount = settings?.loading?.eager_count ?? DEFAULT_EAGER_COUNT;
  return index < eagerCount ? "eager" : "lazy";
}

function DeferredSection({ children }: { children: React.ReactNode }) {
  const [isVisible, setIsVisible] = useState(true);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (document.documentElement.hasAttribute("data-ssr-hydrating")) return;
    if (typeof IntersectionObserver === "undefined") return;
    setIsVisible(false);
  }, []);

  useEffect(() => {
    if (isVisible) return;
    if (typeof IntersectionObserver === "undefined") return;
    const el = sentinelRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setIsVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "200px" }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [isVisible]);

  useEffect(() => {
    if (isVisible) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const handleScrollTo = (e: Event) => {
      const targetId = (e as CustomEvent<{ targetId: string }>).detail?.targetId;
      if (!targetId) return;
      const target = document.getElementById(targetId);
      if (!target) return;
      const position = sentinel.compareDocumentPosition(target);
      if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
        setIsVisible(true);
      }
    };

    window.addEventListener("scrollToSection", handleScrollTo);
    return () => window.removeEventListener("scrollToSection", handleScrollTo);
  }, [isVisible]);

  if (!isVisible) {
    return <div ref={sentinelRef} style={{ minHeight: "100px" }} />;
  }

  return <>{children}</>;
}

interface SectionRendererProps {
  sections: Section[];
  settings?: PageSettings;
  contentType?: string;
  slug?: string;
  locale?: string;
  programSlug?: string;
  landingLocations?: string[];
  isSharedTemplate?: boolean;
  singleEntry?: Record<string, unknown>;
}

function EmptyPageState({ 
  isEditMode, 
  locale, 
  contentType, 
  slug,
  isSharedTemplate,
}: { 
  isEditMode: boolean; 
  locale?: string; 
  contentType?: string;
  slug?: string;
  isSharedTemplate?: boolean;
}) {
  const [isModalOpen, setIsModalOpen] = useState(false);

  return (
    <div 
      className="min-h-[60vh] flex items-center justify-center"
      data-testid="empty-sections-state"
    >
      {isEditMode ? (
        <>
          <button
            onClick={() => setIsModalOpen(true)}
            className="text-center space-y-4 p-8 rounded-lg border-2 border-dashed border-muted-foreground/30 hover:border-primary/50 hover:bg-muted/50 transition-all cursor-pointer"
            data-testid="button-add-first-section"
          >
            <div className="w-16 h-16 mx-auto rounded-full bg-primary/10 flex items-center justify-center">
              <svg className="w-8 h-8 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
              </svg>
            </div>
            <div>
              <h3 className="text-lg font-medium text-foreground">
                {locale === "es" ? "Esta página está vacía" : "This page is empty"}
              </h3>
              <p className="text-sm text-muted-foreground mt-1">
                {locale === "es" 
                  ? "Haz clic aquí para agregar tu primera sección" 
                  : "Click here to add your first section"}
              </p>
            </div>
          </button>
          {isModalOpen && (
            <ComponentPickerModal
              isOpen={isModalOpen}
              onClose={() => setIsModalOpen(false)}
              insertIndex={0}
              contentType={contentType}
              slug={slug}
              locale={locale}
              isSharedTemplate={isSharedTemplate}
            />
          )}
        </>
      ) : (
        <div className="text-center p-8">
          <p className="text-muted-foreground">
            {locale === "es" ? "Contenido próximamente" : "Content coming soon"}
          </p>
        </div>
      )}
    </div>
  );
}
// test
async function sendEditOperation(
  contentType: string,
  slug: string,
  locale: string,
  operations: EditOperation[]
): Promise<{ success: boolean; error?: string }> {
  const token = getDebugToken();
  const author = await resolveAuthorName();
  const response = await fetch("/api/content/edit-sections", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Token ${token}` } : {}),
    },
    body: JSON.stringify({ contentType, slug, locale, operations, author }),
  });
  return response.json();
}

// === SECTION REGISTRY (auto-discovered via import.meta.glob) ===
const _sectionModules = import.meta.glob('./*/variants/*.tsx', { eager: true }) as Record<
  string,
  { default: ComponentType<any> }
>;

function _snakeToPascal(str: string): string {
  return str.split('_').map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()).join('');
}

function _deriveVariant(type: string, filenameBase: string): string {
  const prefix = _snakeToPascal(type);
  const remainder = filenameBase.slice(prefix.length);
  if (!remainder) return 'default';
  return remainder.charAt(0).toLowerCase() + remainder.slice(1);
}

function _normalizeVariant(v: string): string {
  return v.replace(/[-_]/g, '').replace(/[A-Z]/g, c => c.toLowerCase());
}

const _sectionRegistry: Record<string, Record<string, ComponentType<any>>> = {};

for (const [filePath, mod] of Object.entries(_sectionModules)) {
  const match = filePath.match(/^\.\/([^/]+)\/variants\/([^/]+)\.tsx$/);
  if (!match || !mod.default) continue;
  const type = match[1];
  const filenameBase = match[2];
  const variantName = _normalizeVariant(_deriveVariant(type, filenameBase));
  if (!_sectionRegistry[type]) _sectionRegistry[type] = {};
  _sectionRegistry[type][variantName] = mod.default;
}

export function renderSection(section: Section, index: number): React.ReactNode {
  const sectionType = (section as { type: string }).type;
  const sectionVariant = _normalizeVariant((section as { variant?: string }).variant ?? 'default');

  const typeRegistry = _sectionRegistry[sectionType];
  if (!typeRegistry) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[SectionRenderer] Unknown section type: "${sectionType}"`);
    }
    return null;
  }

  const Component = typeRegistry[sectionVariant] ?? typeRegistry['default'];;
  if (!Component) {
    if (process.env.NODE_ENV === 'development') {
      console.warn(`[SectionRenderer] No component for type="${sectionType}" variant="${sectionVariant}"`);
    }
    return null;
  }

  return <Component key={index} data={section as any} />;
}


// Mobile Preview using real iframe for proper media query support
function MobilePreviewFrame({ sections }: { sections: Section[] }) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Send sections to iframe
  const sendToIframe = useCallback(() => {
    const iframe = iframeRef.current;
    if (!iframe?.contentWindow) return;

    const theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
    iframe.contentWindow.postMessage({ type: 'preview-update', sections }, '*');
    iframe.contentWindow.postMessage({ type: 'theme-update', theme }, '*');
  }, [sections]);

  // Listen for iframe ready message and send sections
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === 'preview-ready') {
        sendToIframe();
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [sendToIframe]);

  // Re-send when sections change
  useEffect(() => {
    sendToIframe();
  }, [sections, sendToIframe]);

  const handleIframeLoad = useCallback(() => {
    // Send after iframe loads
    setTimeout(sendToIframe, 100);
  }, [sendToIframe]);

  return (
    <div className="flex justify-center bg-muted/50 min-h-screen py-8">
      <div 
        className="w-[375px] bg-background shadow-2xl rounded-[32px] overflow-hidden border-4 border-foreground/20 relative"
        style={{ height: 'calc(100vh - 4rem)' }}
      >
        {/* Phone notch */}
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-32 h-6 bg-foreground/20 rounded-b-xl z-10" />
        <iframe
          ref={iframeRef}
          onLoad={handleIframeLoad}
          src="/preview-frame"
          className="w-full h-full border-0"
          title="Vista previa móvil"
        />
      </div>
    </div>
  );
}

function setAtDotPath(obj: Record<string, unknown>, dotPath: string, value: unknown): void {
  const parts = dotPath.split(".");
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    const next = cur[k];
    cur[k] = Array.isArray(next) ? [...next] : (typeof next === "object" && next !== null ? { ...(next as Record<string, unknown>) } : {});
    cur = cur[k] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

function patchVariableFieldHighlights(
  section: Record<string, unknown>,
  variableFields: Record<string, string>,
  singleEntry: Record<string, unknown>,
  context: VariableContext,
): Record<string, unknown> {
  const patched: Record<string, unknown> = { ...section };
  for (const [dotPath, templateExpr] of Object.entries(variableFields)) {
    const { text } = resolveTemplateString(templateExpr, {}, context, { preserveTemplate: true, singleEntry });
    setAtDotPath(patched, dotPath, text);
  }
  return patched;
}

export function SectionRenderer({ sections, settings, contentType, slug, locale, programSlug, landingLocations, isSharedTemplate, singleEntry }: SectionRendererProps) {
  const { toast } = useToast();
  const editMode = useEditModeOptional();
  const isEditMode = editMode?.isEditMode ?? false;
  const previewBreakpoint = editMode?.previewBreakpoint;
  const { session } = useSession();
  const { sectionBackgroundOverlapsMenu, topChromeHeightDesktop, topChromeHeightMobile } = useMenuVisualContext();
  const sessionLocationSlug = session.location?.slug;
  const sessionLocationRegion = session.location?.region;

  const { data: varDefinitions } = useVariableDefinitions();
  const varContext = useVariableContext();

  useEffect(() => {
    if (!contentType || !slug || !locale) return;

    const handler = async (e: Event) => {
      const detail = (e as CustomEvent).detail;
      await new Promise((r) => setTimeout(r, 0));
      if (detail._handled) return;
      const { sectionIndex, originalText, templateSyntax } = detail;
      if (sectionIndex < 0 || sectionIndex >= sections.length) return;

      const section = sections[sectionIndex];
      if (!section) return;

      let foundMatch = false;
      const replaceInObj = (obj: unknown): unknown => {
        if (typeof obj === "string") {
          if (obj.includes(originalText)) {
            foundMatch = true;
            return obj.replace(originalText, templateSyntax);
          }
          return obj;
        }
        if (Array.isArray(obj)) {
          return obj.map(replaceInObj);
        }
        if (obj && typeof obj === "object") {
          const result: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(obj)) {
            result[k] = replaceInObj(v);
          }
          return result;
        }
        return obj;
      };

      const updatedSection = replaceInObj(section);

      if (!foundMatch) {
        toast({ title: "Text not found", description: "The selected text was not found in the section content.", variant: "destructive" });
        return;
      }

      const result = await sendEditOperation(contentType, slug, locale, [
        { action: "update_section", index: sectionIndex, section: updatedSection }
      ]);

      if (result.success) {
        toast({ title: "Variable inserted", description: "Text replaced with variable template." });
        emitContentUpdated({ contentType, slug, locale });
      } else {
        toast({ title: "Failed to insert variable", description: result.error, variant: "destructive" });
      }
    };

    window.addEventListener("variable-created-replace", handler);
    return () => window.removeEventListener("variable-created-replace", handler);
  }, [contentType, slug, locale, sections, toast]);

  const resolvedSections = useMemo(() => {
    const hasGlobalDefs = varDefinitions && Object.keys(varDefinitions).length > 0;
    if (!hasGlobalDefs && !singleEntry) {
      return sections;
    }
    const { data } = resolveDeep(
      sections,
      varDefinitions || {},
      varContext,
      {
        preserveTemplate: isEditMode ? true : undefined,
        singleEntry,
      },
    );
    let result = data as Section[];
    if (isEditMode && singleEntry) {
      result = result.map((resolvedSection, i) => {
        const rawSection = sections[i] as Record<string, unknown>;
        const variableFields = rawSection?._variableFields as Record<string, string> | undefined;
        if (!variableFields || !Object.keys(variableFields).length) return resolvedSection;
        return patchVariableFieldHighlights(
          resolvedSection as Record<string, unknown>,
          variableFields,
          singleEntry,
          varContext,
        ) as Section;
      });
    }
    return result;
  }, [sections, isEditMode, varDefinitions, varContext, singleEntry]);

  const handleMoveUp = useCallback(async (index: number) => {
    if (!contentType || !slug || !locale || index <= 0) return;

    const result = await sendEditOperation(contentType, slug, locale, [
      { action: "reorder_sections", from: index, to: index - 1 }
    ]);

    if (result.success) {
      toast({ title: "Section moved up" });
      emitContentUpdated({ contentType, slug, locale });
    } else {
      toast({ title: "Failed to move section", description: result.error, variant: "destructive" });
    }
  }, [contentType, slug, locale, toast]);

  const handleMoveDown = useCallback(async (index: number) => {
    if (!contentType || !slug || !locale || index >= sections.length - 1) return;

    const result = await sendEditOperation(contentType, slug, locale, [
      { action: "reorder_sections", from: index, to: index + 1 }
    ]);

    if (result.success) {
      toast({ title: "Section moved down" });
      emitContentUpdated({ contentType, slug, locale });
    } else {
      toast({ title: "Failed to move section", description: result.error, variant: "destructive" });
    }
  }, [contentType, slug, locale, sections.length, toast]);

  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    index: number;
    bindingGroup: { id: string; name?: string; locale: string; members: Array<{ contentType: string; slug: string; sectionIndex: number }> } | null;
    isDeleting: boolean;
  }>({ open: false, index: -1, bindingGroup: null, isDeleting: false });

  const handleDelete = useCallback(async (index: number) => {
    if (!contentType || !slug || !locale) return;

    try {
      const res = await fetch(`/api/bindings/section?contentType=${contentType}&slug=${slug}&sectionIndex=${index}&locale=${locale}`);
      const data = await res.json();
      if (data.group && data.group.members && data.group.members.length > 1) {
        setDeleteDialog({ open: true, index, bindingGroup: data.group, isDeleting: false });
        return;
      }
    } catch {}

    if (!window.confirm("Are you sure you want to delete this section? This cannot be undone.")) {
      return;
    }

    const result = await sendEditOperation(contentType, slug, locale, [
      { action: "remove_item", path: "sections", index }
    ]);

    if (result.success) {
      toast({ title: "Section deleted" });
      emitContentUpdated({ contentType, slug, locale });
    } else {
      toast({ title: "Failed to delete section", description: result.error, variant: "destructive" });
    }
  }, [contentType, slug, locale, toast]);

  const handleDeleteThisOnly = useCallback(async () => {
    if (!contentType || !slug || !locale || !deleteDialog.bindingGroup) return;
    setDeleteDialog(prev => ({ ...prev, isDeleting: true }));

    try {
      const group = deleteDialog.bindingGroup;
      const token = getDebugToken();
      await fetch(`/api/bindings/${group.id}/members?contentType=${contentType}&slug=${slug}&sectionIndex=${deleteDialog.index}`, {
        method: "DELETE",
        headers: token ? { "x-debug-token": token } : {},
      });

      const result = await sendEditOperation(contentType, slug, locale, [
        { action: "remove_item", path: "sections", index: deleteDialog.index }
      ]);

      if (result.success) {
        toast({ title: "Section deleted and unbound" });
        emitContentUpdated({ contentType, slug, locale });
      } else {
        toast({ title: "Failed to delete section", description: result.error, variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Error deleting section", variant: "destructive" });
    } finally {
      setDeleteDialog({ open: false, index: -1, bindingGroup: null, isDeleting: false });
    }
  }, [contentType, slug, locale, deleteDialog, toast]);

  const handleDeleteAllBound = useCallback(async () => {
    if (!contentType || !slug || !locale || !deleteDialog.bindingGroup) return;
    setDeleteDialog(prev => ({ ...prev, isDeleting: true }));

    try {
      const group = deleteDialog.bindingGroup;
      const token = getDebugToken();
      const siblings = group.members.filter(
        m => !(m.contentType === contentType && m.slug === slug && m.sectionIndex === deleteDialog.index)
      );

      const siblingsByPage = new Map<string, number[]>();
      for (const s of siblings) {
        const key = `${s.contentType}::${s.slug}`;
        const list = siblingsByPage.get(key) || [];
        list.push(s.sectionIndex);
        siblingsByPage.set(key, list);
      }

      const errors: string[] = [];
      for (const [key, indices] of siblingsByPage) {
        const [ct, sl] = key.split("::");
        const sortedDesc = [...indices].sort((a, b) => b - a);
        for (const idx of sortedDesc) {
          const res = await sendEditOperation(ct, sl, group.locale, [
            { action: "remove_item", path: "sections", index: idx }
          ]);
          if (!res.success) errors.push(`${sl} section ${idx}: ${res.error}`);
          else emitContentUpdated({ contentType: ct, slug: sl, locale: group.locale });
        }
      }

      await fetch(`/api/bindings/${group.id}`, {
        method: "DELETE",
        headers: token ? { "x-debug-token": token } : {},
      });

      const result = await sendEditOperation(contentType, slug, locale, [
        { action: "remove_item", path: "sections", index: deleteDialog.index }
      ]);

      if (result.success) {
        emitContentUpdated({ contentType, slug, locale });
        toast({
          title: `Deleted from ${siblings.length + 1} pages`,
          description: errors.length > 0 ? `${errors.length} error(s): ${errors.join("; ")}` : undefined,
          variant: errors.length > 0 ? "destructive" : undefined,
        });
      } else {
        toast({ title: "Failed to delete current section", description: result.error, variant: "destructive" });
      }
    } catch (err) {
      toast({ title: "Error deleting bound sections", variant: "destructive" });
    } finally {
      setDeleteDialog({ open: false, index: -1, bindingGroup: null, isDeleting: false });
    }
  }, [contentType, slug, locale, deleteDialog, toast]);

  const handleDuplicate = useCallback(async (index: number) => {
    if (!contentType || !slug || !locale) return;

    const sectionToDuplicate = sections[index];
    if (!sectionToDuplicate) return;

    if (!window.confirm("Duplicate this section?")) {
      return;
    }

    const result = await sendEditOperation(contentType, slug, locale, [
      { action: "add_item", path: "sections", index: index + 1, item: sectionToDuplicate }
    ]);

    if (result.success) {
      toast({ title: "Section duplicated" });
      emitContentUpdated({ contentType, slug, locale });
    } else {
      toast({ title: "Failed to duplicate section", description: result.error, variant: "destructive" });
    }
  }, [contentType, slug, locale, sections, toast]);

  const isMobilePreview = isEditMode && previewBreakpoint === 'mobile';

  const content = (
    <>
      <AddSectionButton
        insertIndex={0}
        sections={sections}
        contentType={contentType}
        slug={slug}
        locale={locale}
        isSharedTemplate={isSharedTemplate}
      />
      {sections.length === 0 && (
        <EmptyPageState 
          isEditMode={isEditMode} 
          locale={locale} 
          contentType={contentType}
          slug={slug}
          isSharedTemplate={isSharedTemplate}
        />
      )}
      {(() => {
        let hasAppliedTopCover = false;

        return resolvedSections.map((section, index) => {
        const rawSection = sections[index];
        const sectionType = (section as { type: string }).type;
        const loadStrategy = isEditMode ? "eager" : resolveLoadStrategy(rawSection, index, settings);
        const renderedContent = renderSection(section, index);
        const wrapperStyles = getSectionWrapperStyles(section);
        const innerStyles: CSSProperties = {
          maxWidth: "var(--section-mw)",
          marginLeft: "auto",
          marginRight: "auto",
          width: "100%",
        };
        const showOn = (rawSection as SectionLayout).showOn;

        const isVisible = shouldShowSection(showOn, previewBreakpoint, isEditMode);
        const isLocationVisible = shouldShowSectionForLocation(rawSection, sessionLocationSlug, sessionLocationRegion, isEditMode);
        const visibilityClasses = isEditMode ? '' : getSectionVisibilityClasses(showOn);

        if (!renderedContent) return null;

        if (!isLocationVisible) return null;

        if (!isVisible && isEditMode) {
          return (
            <div key={index}>
              <AddSectionButton
                insertIndex={index + 1}
                sections={sections}
                contentType={contentType}
                slug={slug}
                locale={locale}
                isSharedTemplate={isSharedTemplate}
              />
            </div>
          );
        }

        const isFirstVisibleSection = isVisible && !hasAppliedTopCover;
        if (isFirstVisibleSection) {
          hasAppliedTopCover = true;
        }

        const topCoverBackground = typeof wrapperStyles.background === "string" ? wrapperStyles.background : undefined;
        const hasTopCover = isFirstVisibleSection
          && sectionBackgroundOverlapsMenu
          && !!topCoverBackground
          && (topChromeHeightDesktop > 0 || topChromeHeightMobile > 0);
        const sectionWrapperStyles = hasTopCover
          ? {
              ...wrapperStyles,
              background: "transparent",
            }
          : wrapperStyles;
        const contentLayerStyles: CSSProperties = hasTopCover
          ? {
              ...innerStyles,
              position: "relative",
            }
          : innerStyles;
        const sectionId = (rawSection as SectionLayout).section_id || `${sectionType}-${index}`;
        const isPriority = loadStrategy === "eager";
        const sectionVariableFields = (rawSection as Record<string, unknown>)._variableFields as Record<string, string> | undefined;
        const sectionVariableKeys = (rawSection as Record<string, unknown>)._variableKeys as Record<string, string> | undefined;
        const imageSizes =
          ((rawSection as Record<string, unknown>)._imageSizes as Record<string, string> | undefined) ??
          {};
        const priorityWrapped = (
          <SectionContextProvider
            value={{
              isPriority,
              sectionIndex: index,
              contentType: contentType ?? "",
              slug: slug ?? "",
              locale: locale ?? "",
              imageSizes,
              variableFields: sectionVariableFields,
              variableKeys: sectionVariableKeys,
            }}
          >
            {renderedContent}
          </SectionContextProvider>
        );
        const renderedSection = loadStrategy === "lazy"
          ? <DeferredSection>{priorityWrapped}</DeferredSection>
          : priorityWrapped;

        return (
          <div
            key={index}
            id={sectionId}
            data-section-type={sectionType}
            className={`section-wrapper${sectionType !== "modal" ? " scroll-mt-20" : ""}${hasTopCover ? " relative" : ""}${visibilityClasses ? " " + visibilityClasses : ""}`.trim()}
            style={sectionWrapperStyles}
          >
            {hasTopCover && (
              <>
                {topChromeHeightDesktop > 0 && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 bottom-0 z-0 hidden md:block"
                    style={{
                      top: `${-topChromeHeightDesktop}px`,
                      background: topCoverBackground,
                    }}
                  />
                )}
                {topChromeHeightMobile > 0 && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-0 bottom-0 z-0 md:hidden"
                    style={{
                      top: `${-topChromeHeightMobile}px`,
                      background: topCoverBackground,
                    }}
                  />
                )}
              </>
            )}
            <div style={contentLayerStyles}>
              <EditableSection
                section={rawSection}
                index={index}
                sectionType={sectionType}
                contentType={contentType}
                slug={slug}
                locale={locale}
                totalSections={sections.length}
                allSections={sections}
                onMoveUp={handleMoveUp}
                onMoveDown={handleMoveDown}
                onDelete={handleDelete}
                onDuplicate={handleDuplicate}
              >
                <VariableHighlightProvider sectionIndex={index} contentType={contentType} hasSingleVars={!!singleEntry}>
                  {renderedSection}
                </VariableHighlightProvider>
              </EditableSection>
              <AddSectionButton
                insertIndex={index + 1}
                sections={sections}
                contentType={contentType}
                slug={slug}
                locale={locale}
                isSharedTemplate={isSharedTemplate}
              />
            </div>
          </div>
        );
      });
      })()}
    </>
  );

  if (isMobilePreview) {
    return (
      <MobilePreviewFrame sections={sections} />
    );
  }

  const deleteDialogSiblings = deleteDialog.bindingGroup?.members.filter(
    m => !(m.contentType === contentType && m.slug === slug && m.sectionIndex === deleteDialog.index)
  ) || [];

  return (
    <>
      {content}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => { if (!open && !deleteDialog.isDeleting) setDeleteDialog({ open: false, index: -1, bindingGroup: null, isDeleting: false }); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete bound section
            </DialogTitle>
            <DialogDescription>
              This section is part of a binding group{deleteDialog.bindingGroup?.name ? ` "${deleteDialog.bindingGroup.name}"` : ""} and is synced with {deleteDialogSiblings.length} other page{deleteDialogSiblings.length !== 1 ? "s" : ""}.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 max-h-[200px] overflow-auto">
            <p className="text-xs font-medium text-muted-foreground">Bound pages:</p>
            {deleteDialogSiblings.map((m, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <Link className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <Badge variant="outline" className="text-xs shrink-0">{m.contentType}</Badge>
                <span className="truncate">{m.slug}</span>
                <span className="text-muted-foreground text-xs shrink-0">section {m.sectionIndex}</span>
              </div>
            ))}
          </div>
          <DialogFooter className="flex-col gap-2 sm:flex-col">
            <Button
              variant="outline"
              onClick={handleDeleteThisOnly}
              disabled={deleteDialog.isDeleting}
              className="w-full justify-start gap-2"
              data-testid="button-delete-this-only"
            >
              {deleteDialog.isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete this section only (unbind)
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteAllBound}
              disabled={deleteDialog.isDeleting}
              className="w-full justify-start gap-2"
              data-testid="button-delete-all-bound"
            >
              {deleteDialog.isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete from all {deleteDialogSiblings.length + 1} pages
            </Button>
            <Button
              variant="ghost"
              onClick={() => setDeleteDialog({ open: false, index: -1, bindingGroup: null, isDeleting: false })}
              disabled={deleteDialog.isDeleting}
              className="w-full"
              data-testid="button-delete-cancel"
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}