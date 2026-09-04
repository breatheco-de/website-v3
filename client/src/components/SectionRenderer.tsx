import type { CSSProperties } from "react";
import { AlertTriangle, Link, Loader2, Trash2 } from "lucide-react";
import { useState, useRef, useEffect, lazy, Suspense, useMemo } from "react";
import { useContentTypesRaw } from "@/hooks/useContentTypes";
import type { Section, EditOperation, SectionLayout, ResponsiveSpacing, ShowOn, PageSettings } from "@shared/schema";
import { canonicalSectionId } from "@shared/sectionIdentity";
import { useSession } from "@/contexts/SessionContext";
import { PageFunnelProvider } from "@/contexts/PageFunnelContext";
import { PageSectionsProvider } from "@/contexts/PageSectionsContext";
import type { FunnelBlock } from "@shared/funnel";
import { useMenuVisualContext } from "@/contexts/MenuVisualContext";
import { VariableHighlightProvider } from "@/components/editing/VariableHighlight";
import { useVariableDefinitions, useVariableContext } from "@/hooks/useVariables";
import { resolveDeep, resolveTemplateString, type VariableContext } from "@/lib/variable-manager";
import { findReplaceableTextRange } from "@/lib/cm-variable-highlight";
import { SectionContextProvider } from "@/contexts/SectionContext";
import {
  getCachedSectionComponent,
  hasSectionType,
  loadSectionComponent,
  normalizeSectionVariant,
} from "@/components/sectionRegistry";
import { SectionRenderErrorBoundary } from "@/components/editing/SectionRenderErrorBoundary";

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
    mobile: hasConstrainedMaxWidth(maxWidth.mobile) ? "0.8rem" : DEFAULT_INNER_PADDING_X,
    desktop: hasConstrainedMaxWidth(maxWidth.desktop) ? "0.8rem" : DEFAULT_INNER_PADDING_X,
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
export function getSectionWrapperStyles(section: Section): CSSProperties & Record<string, string> {
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
const EditableSection = lazy(() =>
  import("@/components/editing/EditableSection").then((m) => ({ default: m.EditableSection }))
);
const AddSectionButton = lazy(() =>
  import("@/components/editing/AddSectionButton").then((m) => ({ default: m.AddSectionButton }))
);
const ComponentPickerModal = lazy(() => import("@/components/editing/ComponentPickerModal"));
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
const DbTemplateWarningDialog = lazy(() =>
  import("@/components/editing/DbTemplateWarningDialog").then((m) => ({ default: m.DbTemplateWarningDialog }))
);

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
      // Wake this section when it IS the hash target (id lives on the wrapper that
      // contains this sentinel) or when it sits above the target on the way down.
      const isSelf = target === sentinel || target.contains(sentinel);
      const position = sentinel.compareDocumentPosition(target);
      const isOnTheWay = !!(position & Node.DOCUMENT_POSITION_FOLLOWING);
      if (isSelf || isOnTheWay) {
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
  variant?: string;
  version?: number;
  programSlug?: string;
  landingLocations?: string[];
  isSharedTemplate?: boolean;
  singleEntry?: Record<string, unknown>;
  /** Page-level funnel from merged _common.yml (tracking scope). */
  funnel?: FunnelBlock | null;
  /** Page SEO meta for {{ meta.* }} in sections (may still contain {{ single.* }}). */
  meta?: Record<string, unknown>;
  /** Unified URL path + querystring params for {{ param.* }}. */
  param?: Record<string, unknown>;
  /** When false, hide entry-scoped structural actions on attached shared-layout pages. */
  allowEntryStructuralOverrides?: boolean;
  perEntryRemovedSections?: Array<{ section: Record<string, unknown>; originalIndex: number }>;
  /** Staff preview: open raw YAML editor when a section fails to render. */
  onEditYaml?: () => void;
}

function EmptyPageState({ 
  isEditMode, 
  locale, 
  contentType, 
  slug,
  variant,
  version,
  isSharedTemplate,
}: { 
  isEditMode: boolean; 
  locale?: string; 
  contentType?: string;
  slug?: string;
  variant?: string;
  version?: number;
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
            <Suspense fallback={null}>
              <ComponentPickerModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                insertIndex={0}
                contentType={contentType}
                slug={slug}
                locale={locale}
                variant={variant}
                version={version}
                isSharedTemplate={isSharedTemplate}
              />
            </Suspense>
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

async function sendEditOperation(
  contentType: string,
  slug: string,
  locale: string,
  operations: EditOperation[],
  opts?: { variant?: string; version?: number; layoutTarget?: string }
): Promise<{
  success: boolean;
  error?: string;
  clearedFields?: Array<{ sectionType?: string; path?: string; sectionIndex?: number }>;
}> {
  const token = getDebugToken();
  const author = await resolveAuthorName();
  const response = await fetch("/api/content/edit-sections", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Token ${token}` } : {}),
    },
    body: JSON.stringify({
      contentType,
      slug,
      locale,
      operations,
      author,
      ...(opts?.variant ? { variant: opts.variant } : {}),
      ...(opts?.version !== undefined ? { version: opts.version } : {}),
      ...(opts?.layoutTarget ? { layoutTarget: opts.layoutTarget } : {}),
    }),
  });
  return response.json();
}

/** Loads a section chunk on demand when it was not preloaded (CSR, editor previews). */
function LazySection({ section, index }: { section: Section; index: number }) {
  const sectionType = (section as { type: string }).type;
  const sectionVariant = normalizeSectionVariant(
    (section as { variant?: string }).variant ?? "default",
  );

  const [Component, setComponent] = useState(() =>
    getCachedSectionComponent(sectionType, sectionVariant),
  );

  useEffect(() => {
    if (Component) return;
    let cancelled = false;
    loadSectionComponent(sectionType, sectionVariant)
      .then((loaded) => {
        if (!cancelled && loaded) setComponent(() => loaded);
      })
      .catch((err) => {
        console.error(
          `[SectionRenderer] Failed to load section chunk "${sectionType}/${sectionVariant}":`,
          err,
        );
      });
    return () => {
      cancelled = true;
    };
  }, [Component, sectionType, sectionVariant]);

  if (!Component) return null;

  return <Component key={index} data={section} />;
}

export interface SectionPageContext {
  url?: string;
  yamlFile?: string;
}

export function renderSection(section: Section, index: number, pageContext?: SectionPageContext): React.ReactNode {
  const sectionType = (section as { type: string }).type;
  const sectionVariant = normalizeSectionVariant(
    (section as { variant?: string }).variant ?? "default",
  );

  if (!hasSectionType(sectionType)) {
    if (process.env.NODE_ENV === "development") {
      const url = pageContext?.url ?? (typeof window !== "undefined" ? window.location.pathname : undefined);
      const yamlFile = pageContext?.yamlFile;
      const lines = [`[SectionRenderer] Unknown section type: "${sectionType}"`];
      if (url) lines.push(`  URL:  ${url}`);
      if (yamlFile) lines.push(`  File: ${yamlFile}`);
      console.warn(lines.join("\n"));
    }
    return null;
  }

  // Strip editor-only metadata before passing props to section components
  const { _label: _ignoredLabel, ...sectionProps } = section as Section & {
    _label?: unknown;
  };

  const Component =
    getCachedSectionComponent(sectionType, sectionVariant) ??
    getCachedSectionComponent(sectionType, "default");

  if (Component) {
    return <Component key={index} data={sectionProps as Section} />;
  }

  return <LazySection key={index} section={sectionProps as Section} index={index} />;
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

function getAtDotPath(obj: Record<string, unknown>, dotPath: string): unknown {
  const parts = dotPath.split(".");
  let cur: unknown = obj;
  for (const part of parts) {
    if (cur === null || cur === undefined || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function patchVariableFieldHighlights(
  section: Record<string, unknown>,
  variableFields: Record<string, string>,
  singleEntry: Record<string, unknown>,
  context: VariableContext,
): Record<string, unknown> {
  const patched: Record<string, unknown> = { ...section };
  for (const [dotPath, templateExpr] of Object.entries(variableFields)) {
    // Only patch string fields; keep structured values (arrays/objects) intact in edit mode.
    const currentValue = getAtDotPath(patched, dotPath);
    if (typeof currentValue !== "string") continue;
    const { text } = resolveTemplateString(templateExpr, {}, context, { preserveTemplate: true, singleEntry });
    setAtDotPath(patched, dotPath, text);
  }
  return patched;
}

/** Returns a singular human-readable noun for a content type, e.g. "course" from "Courses". */
function toSingularLabel(ct: string | undefined, rawTypes: { name: string; label: string }[] | undefined): string {
  if (!ct) return "entry";
  const found = rawTypes?.find((t) => t.name === ct);
  const label = found?.label ?? ct.replace(/_/g, " ");
  const lower = label.toLowerCase();
  if (lower.endsWith("ies")) return lower.slice(0, -3) + "y";
  if (lower.endsWith("ses") || lower.endsWith("xes") || lower.endsWith("zes")) return lower.slice(0, -2);
  if (lower.endsWith("s") && lower.length > 2) return lower.slice(0, -1);
  return lower;
}

export function SectionRenderer({ sections, settings, contentType, slug, locale, variant, version, programSlug, landingLocations, isSharedTemplate, singleEntry, meta, param, funnel, allowEntryStructuralOverrides = true, perEntryRemovedSections, onEditYaml }: SectionRendererProps) {
  const { toast } = useToast();
  const editMode = useEditModeOptional();
  const isEditMode = editMode?.isEditMode ?? false;
  const previewBreakpoint = editMode?.previewBreakpoint;
  const { session } = useSession();
  const { sectionBackgroundOverlapsMenu, topChromeHeightDesktop, topChromeHeightMobile } = useMenuVisualContext();
  const sessionLocationSlug = session.location?.slug;
  const sessionLocationRegion = session.location?.region;
  const { data: rawContentTypes } = useContentTypesRaw();
  const singularLabel = toSingularLabel(contentType, rawContentTypes);

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
          if (foundMatch) return obj;
          const range = findReplaceableTextRange(obj, originalText);
          if (!range) return obj;
          foundMatch = true;
          return (
            obj.slice(0, range.from) + templateSyntax + obj.slice(range.to)
          );
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
        toast({
          title: "Text not found",
          description:
            "The selected text was not found outside an existing variable.",
          variant: "destructive",
        });
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

  const resolvedSections = (() => {
    const hasGlobalDefs = varDefinitions && Object.keys(varDefinitions).length > 0;
    if (!hasGlobalDefs && !singleEntry && !meta && !param) {
      return sections;
    }
    // Resolve {{ single.* }} inside meta so {{ meta.page_title }} sees concrete SEO strings
    let metaBag = meta;
    if (meta && singleEntry) {
      const { data: resolvedMeta } = resolveDeep(meta, {}, varContext, { singleEntry });
      metaBag = resolvedMeta as Record<string, unknown>;
    }
    const { data } = resolveDeep(
      sections,
      varDefinitions || {},
      varContext,
      {
        preserveTemplate: isEditMode ? true : undefined,
        singleEntry,
        meta: metaBag,
        param,
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
  })();

  // Build sections maps for PageSectionsContext (inline render + cross-section features)
  const pageSectionsContextValue = useMemo(() => {
    const byId: Record<string, Record<string, unknown>> = {};
    const ordered: Array<{
      sectionKey: string;
      index: number;
      data: Record<string, unknown>;
    }> = [];
    for (let i = 0; i < sections.length; i++) {
      const raw = sections[i] as Record<string, unknown>;
      const data = (resolvedSections[i] as Record<string, unknown>) ?? raw;
      const sectionType = (data.type as string) || "section";
      const sectionId = raw.section_id as string | undefined;
      const sectionKey = sectionId || `${sectionType}-${i}`;
      if (sectionId) {
        byId[sectionId] = data;
      }
      ordered.push({ sectionKey, index: i, data });
    }
    return { byId, ordered };
  }, [sections, resolvedSections]);

  // Dialog shown when a template section being moved has per-entry dependants
  const [moveDependantsDialog, setMoveDependantsDialog] = useState<{
    open: boolean;
    index: number;
    direction: "up" | "down";
    dependants: string[];
  }>({ open: false, index: -1, direction: "up", dependants: [] });

  // Confirmation dialog for moving a template section from a per-entry page
  const [dbEntryMoveDialog, setDbEntryMoveDialog] = useState<{
    open: boolean;
    index: number;
    direction: "up" | "down";
  }>({ open: false, index: -1, direction: "up" });

  const performMove = async (from: number, to: number) => {
    if (!contentType || !slug || !locale) return;
    const result = await sendEditOperation(contentType, slug, locale, [
      { action: "reorder_sections", from, to }
    ], { variant, version, ...(isSharedTemplate && variant ? { layoutTarget: "type_template" } : {}) });
    if (result.success) {
      toast({ title: from < to ? "Section moved down" : "Section moved up" });
      emitContentUpdated({ contentType, slug, locale });
    } else {
      toast({ title: "Failed to move section", description: result.error, variant: "destructive" });
    }
  };

  const handleMoveUp = async (index: number) => {
    if (!contentType || !slug || !locale || index <= 0) return;

    if (isSharedTemplate && singleEntry && allowEntryStructuralOverrides) {
      const rawSection = sections[index] as Record<string, unknown>;
      const adjacentSection = sections[index - 1] as Record<string, unknown>;
      const isPerEntry = !!rawSection?._perEntrySource;
      const adjacentIsPerEntry = !!adjacentSection?._perEntrySource;

      if (isPerEntry !== adjacentIsPerEntry) {
        // Boundary move: per-entry section crossing a template section boundary.
        // The server handles this by updating _insertAfterSectionId — no confirmation
        // needed because the shared template is not modified.
        await performMove(index, index - 1);
        return;
      }

      if (isPerEntry) {
        // Both per-entry: move directly within the per-entry file, no confirmation needed
        await performMove(index, index - 1);
      } else if (variant) {
        // In variant preview: move directly in the variant template, no confirmation needed
        await performMove(index, index - 1);
      } else {
        // Both template: confirm before applying to all entries
        setDbEntryMoveDialog({ open: true, index, direction: "up" });
      }
      return;
    }

    if (isSharedTemplate) {
      // On the shared template admin page: always show confirmation (with dependants info)
      const rawSection = sections[index] as Record<string, unknown>;
      const sectionId = canonicalSectionId(rawSection) ?? null;
      let dependants: string[] = [];
      if (sectionId) {
        try {
          const res = await fetch(`/api/section-dependants?contentType=${encodeURIComponent(contentType)}&sectionId=${encodeURIComponent(sectionId)}`);
          const data = await res.json();
          dependants = data.dependants ?? [];
        } catch {}
      }
      setMoveDependantsDialog({ open: true, index, direction: "up", dependants });
      return;
    }

    await performMove(index, index - 1);
  };

  const handleMoveDown = async (index: number) => {
    if (!contentType || !slug || !locale || index >= sections.length - 1) return;

    if (isSharedTemplate && singleEntry && allowEntryStructuralOverrides) {
      const rawSection = sections[index] as Record<string, unknown>;
      const adjacentSection = sections[index + 1] as Record<string, unknown>;
      const isPerEntry = !!rawSection?._perEntrySource;
      const adjacentIsPerEntry = !!adjacentSection?._perEntrySource;

      if (isPerEntry !== adjacentIsPerEntry) {
        // Boundary move: per-entry section crossing a template section boundary.
        // The server handles this by updating _insertAfterSectionId — no confirmation
        // needed because the shared template is not modified.
        await performMove(index, index + 1);
        return;
      }

      if (isPerEntry) {
        // Both per-entry: move directly within the per-entry file, no confirmation needed
        await performMove(index, index + 1);
      } else if (variant) {
        // In variant preview: move directly in the variant template, no confirmation needed
        await performMove(index, index + 1);
      } else {
        // Both template: confirm before applying to all entries
        setDbEntryMoveDialog({ open: true, index, direction: "down" });
      }
      return;
    }

    if (isSharedTemplate) {
      // On the shared template admin page: always show confirmation (with dependants info)
      const rawSection = sections[index] as Record<string, unknown>;
      const sectionId = canonicalSectionId(rawSection) ?? null;
      let dependants: string[] = [];
      if (sectionId) {
        try {
          const res = await fetch(`/api/section-dependants?contentType=${encodeURIComponent(contentType)}&sectionId=${encodeURIComponent(sectionId)}`);
          const data = await res.json();
          dependants = data.dependants ?? [];
        } catch {}
      }
      setMoveDependantsDialog({ open: true, index, direction: "down", dependants });
      return;
    }

    await performMove(index, index + 1);
  };

  const [deleteDialog, setDeleteDialog] = useState<{
    open: boolean;
    index: number;
    bindingGroup: { id: string; name?: string; locale: string; members: Array<{ contentType: string; slug: string; sectionIndex: number }> } | null;
    isDeleting: boolean;
  }>({ open: false, index: -1, bindingGroup: null, isDeleting: false });

  const [dbTemplateDeleteDialog, setDbTemplateDeleteDialog] = useState<{
    open: boolean;
    index: number;
    isDeleting: boolean;
  }>({ open: false, index: -1, isDeleting: false });

  // Dialog for scope choice when deleting on a specific DB entry page (isSharedTemplate && singleEntry)
  const [dbEntryDeleteDialog, setDbEntryDeleteDialog] = useState<{
    open: boolean;
    index: number;
    isPerEntry: boolean;
    isDeleting: boolean;
    sectionId?: string;
    /** Fallback when section has no id — merged-view position of the section. */
    mergedIndex?: number;
  }>({ open: false, index: -1, isPerEntry: false, isDeleting: false });

  // Restore dialog for ghost (removed) sections
  const [restoreDialog, setRestoreDialog] = useState<{
    open: boolean;
    section: Record<string, unknown>;
    isRestoring: boolean;
  }>({ open: false, section: {}, isRestoring: false });

  const [simpleDeleteDialog, setSimpleDeleteDialog] = useState<{
    open: boolean;
    index: number;
    isDeleting: boolean;
  }>({ open: false, index: -1, isDeleting: false });

  const [duplicateDialog, setDuplicateDialog] = useState<{
    open: boolean;
    index: number;
    isDuplicating: boolean;
  }>({ open: false, index: -1, isDuplicating: false });

  const handleDelete = async (index: number) => {
    if (!contentType || !slug || !locale) return;

    try {
      const res = await fetch(`/api/bindings/section?contentType=${contentType}&slug=${slug}&sectionIndex=${index}&locale=${locale}`);
      const data = await res.json();
      if (data.group && data.group.members && data.group.members.length > 1) {
        setDeleteDialog({ open: true, index, bindingGroup: data.group, isDeleting: false });
        return;
      }
    } catch {}

    if (isSharedTemplate && singleEntry && allowEntryStructuralOverrides) {
      // On a specific DB entry page — check if section is per-entry-only
      const rawSection = sections[index] as Record<string, unknown>;
      const isPerEntry = !!(rawSection?._perEntrySource);
      const sectionId = canonicalSectionId(rawSection);

      if (isPerEntry) {
        // Per-entry sections: delete directly — no scope dialog needed
        deletePerEntryDirect(index);
        return;
      }

      if (variant) {
        // In variant preview: show confirmation first, then delete from the variant template file
        setSimpleDeleteDialog({ open: true, index, isDeleting: false });
        return;
      }

      setDbEntryDeleteDialog({ open: true, index, isPerEntry: false, isDeleting: false, sectionId, mergedIndex: index });
      return;
    }

    if (isSharedTemplate) {
      setDbTemplateDeleteDialog({ open: true, index, isDeleting: false });
      return;
    }

    setSimpleDeleteDialog({ open: true, index, isDeleting: false });
  };

  const handleSimpleDeleteConfirm = async () => {
    if (!contentType || !slug || !locale) return;
    const { index } = simpleDeleteDialog;
    setSimpleDeleteDialog(prev => ({ ...prev, isDeleting: true }));

    // Best-effort: remove this section from any binding group before deleting it.
    // handleDelete already checked and found no group (or the check failed), so this
    // is a retry that catches the "check failed" edge case.
    let bindingCleanedUp = false;
    try {
      const bindRes = await fetch(
        `/api/bindings/section?contentType=${encodeURIComponent(contentType)}&slug=${encodeURIComponent(slug)}&sectionIndex=${index}&locale=${encodeURIComponent(locale)}`
      );
      const bindData = await bindRes.json();
      if (bindData.group?.id) {
        const token = getDebugToken();
        const removeRes = await fetch(`/api/bindings/${bindData.group.id}/members`, {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
            ...(token ? { "x-debug-token": token } : {}),
          },
          body: JSON.stringify({ contentType, slug, sectionIndex: index }),
        });
        // Only mark as cleaned up when the server confirmed the removal.
        // When no group is found we leave bindingCleanedUp=false so the
        // post-delete cleanup still runs — the JSON file may have a stale
        // reference that the per-section lookup didn't surface.
        bindingCleanedUp = removeRes.ok;
      }
    } catch {}

    const result = await sendEditOperation(contentType, slug, locale, [
      { action: "remove_item", path: "sections", index }
    ], { variant, version, ...(isSharedTemplate && variant ? { layoutTarget: "type_template" } : {}) });

    if (result.success) {
      // If the lookup failed entirely OR the member removal returned an error,
      // ask the server to prune any orphaned references for the now-deleted section.
      if (!bindingCleanedUp) {
        try {
          const token = getDebugToken();
          await fetch("/api/bindings/cleanup", {
            method: "POST",
            headers: token ? { "x-debug-token": token } : {},
          });
        } catch {}
      }
      toast({ title: "Section deleted" });
      emitContentUpdated({ contentType, slug, locale });
    } else {
      toast({ title: "Failed to delete section", description: result.error, variant: "destructive" });
    }
    setSimpleDeleteDialog({ open: false, index: -1, isDeleting: false });
  };

  const handleDbTemplateDeleteConfirm = async () => {
    if (!contentType || !slug || !locale) return;
    const { index } = dbTemplateDeleteDialog;
    setDbTemplateDeleteDialog(prev => ({ ...prev, isDeleting: true }));

    // Best-effort: look up and delete the entire binding group for this shared-template
    // section. Because this section is shared across all entries, removing just one member
    // would leave orphaned references — so we delete the whole group.
    try {
      const bindRes = await fetch(
        `/api/bindings/section?contentType=${encodeURIComponent(contentType)}&slug=${encodeURIComponent(slug)}&sectionIndex=${index}&locale=${encodeURIComponent(locale)}`
      );
      const bindData = await bindRes.json();
      if (bindData.group?.id) {
        const token = getDebugToken();
        await fetch(`/api/bindings/${bindData.group.id}`, {
          method: "DELETE",
          headers: token ? { "x-debug-token": token } : {},
        });
      }
    } catch {}

    const result = await sendEditOperation(contentType, slug, locale, [
      { action: "remove_item", path: "sections", index }
    ]);

    if (result.success) {
      // Always run a server-side cleanup after a template section deletion so any
      // per-entry members that also referenced this sectionId are pruned.
      try {
        const token = getDebugToken();
        await fetch("/api/bindings/cleanup", {
          method: "POST",
          headers: token ? { "x-debug-token": token } : {},
        });
      } catch {}
      toast({ title: "Section deleted", description: "Removed from shared template." });
      emitContentUpdated({ contentType, slug, locale });
    } else {
      toast({ title: "Failed to delete section", description: result.error, variant: "destructive" });
    }
    setDbTemplateDeleteDialog({ open: false, index: -1, isDeleting: false });
  };

  const handleDeleteThisOnly = async () => {
    if (!contentType || !slug || !locale || !deleteDialog.bindingGroup) return;
    setDeleteDialog(prev => ({ ...prev, isDeleting: true }));

    try {
      const group = deleteDialog.bindingGroup;
      const token = getDebugToken();
      const unbindRes = await fetch(`/api/bindings/${group.id}/members`, {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { "x-debug-token": token } : {}),
        },
        body: JSON.stringify({ contentType, slug, sectionIndex: deleteDialog.index }),
      });

      if (!unbindRes.ok) {
        let description = `Server returned ${unbindRes.status}`;
        try {
          const body = await unbindRes.json();
          if (body?.error) description = body.error;
        } catch {
          // ignore parse errors
        }
        toast({ title: "Failed to remove binding", description, variant: "destructive" });
        return;
      }

      const result = await sendEditOperation(contentType, slug, locale, [
        { action: "remove_item", path: "sections", index: deleteDialog.index }
      ], { variant, version });

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
  };

  const handleDeleteAllBound = async () => {
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
      ], { variant, version });

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
  };

  // Directly deletes a per-entry section (no scope dialog needed for _perEntrySource sections)
  const deletePerEntryDirect = async (index: number) => {
    if (!contentType || !slug || !locale) return;
    try {
      const token = getDebugToken();
      const resp = await fetch("/api/per-entry-section-remove", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Token ${token}` } : {}) },
        body: JSON.stringify({ contentType, slug, locale, sectionIndex: index, isPerEntry: true }),
      });
      const data = await resp.json();
      if (data.success) {
        toast({ title: "Section deleted" });
        emitContentUpdated({ contentType, slug, locale });
      } else {
        toast({ title: "Failed to delete section", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error deleting section", variant: "destructive" });
    }
  };

  // Called when user chooses "Hide from this entry only" in the scope dialog
  const handleDbEntryRemoveThisEntry = async () => {
    if (!contentType || !slug || !locale) return;
    const { index, isPerEntry } = dbEntryDeleteDialog;
    setDbEntryDeleteDialog(prev => ({ ...prev, isDeleting: true }));
    try {
      const token = getDebugToken();
      const resp = await fetch("/api/per-entry-section-remove", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Token ${token}` } : {}) },
        body: JSON.stringify({ contentType, slug, locale, sectionIndex: index, isPerEntry }),
      });
      const data = await resp.json();
      if (data.success) {
        toast({ title: isPerEntry ? "Section deleted" : "Section hidden for this entry" });
        emitContentUpdated({ contentType, slug, locale });
      } else {
        toast({ title: "Failed to remove section", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error removing section", variant: "destructive" });
    }
    setDbEntryDeleteDialog({ open: false, index: -1, isPerEntry: false, isDeleting: false });
  };

  // Called when user chooses "Delete from shared template" in the scope dialog.
  // Prefers ID-based deletion (avoids merged-index vs. template-index divergence) but
  // falls back to mergedIndex for id-less shared sections so deletion always works.
  const handleDbEntryDeleteAllEntries = async () => {
    if (!contentType || !slug || !locale) return;
    const { sectionId, mergedIndex } = dbEntryDeleteDialog;
    if (!sectionId && mergedIndex === undefined) {
      toast({ title: "Cannot delete: section has no id or position", variant: "destructive" });
      setDbEntryDeleteDialog({ open: false, index: -1, isPerEntry: false, isDeleting: false });
      return;
    }
    setDbEntryDeleteDialog(prev => ({ ...prev, isDeleting: true }));
    try {
      const token = getDebugToken();
      const resp = await fetch("/api/per-entry-section-delete-from-template", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Token ${token}` } : {}) },
        body: JSON.stringify({ contentType, slug, locale, sectionId, mergedIndex }),
      });
      const data = await resp.json();
      if (data.success) {
        toast({ title: "Section deleted from shared template" });
        emitContentUpdated({ contentType, slug, locale });
      } else {
        toast({ title: "Failed to delete section", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error deleting section", variant: "destructive" });
    }
    setDbEntryDeleteDialog({ open: false, index: -1, isDeleting: false, isPerEntry: false });
  };

  // Restore a ghost section (per-entry removed section)
  const handleRestoreConfirm = async () => {
    if (!contentType || !slug || !locale) return;
    const sectionId = canonicalSectionId(restoreDialog.section) ?? null;
    if (!sectionId) {
      toast({ title: "Cannot restore: section has no id", variant: "destructive" });
      setRestoreDialog({ open: false, section: {}, isRestoring: false });
      return;
    }
    setRestoreDialog(prev => ({ ...prev, isRestoring: true }));
    try {
      const token = getDebugToken();
      const resp = await fetch("/api/per-entry-section-restore", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Token ${token}` } : {}) },
        body: JSON.stringify({ contentType, slug, locale, sectionId }),
      });
      const data = await resp.json();
      if (data.success) {
        toast({ title: "Section restored" });
        emitContentUpdated({ contentType, slug, locale });
      } else {
        toast({ title: "Failed to restore section", description: data.error, variant: "destructive" });
      }
    } catch {
      toast({ title: "Error restoring section", variant: "destructive" });
    }
    setRestoreDialog({ open: false, section: {}, isRestoring: false });
  };

  const handleDuplicate = async (index: number) => {
    if (!contentType || !slug || !locale) return;

    const sectionToDuplicate = sections[index];
    if (!sectionToDuplicate) return;

    setDuplicateDialog({ open: true, index, isDuplicating: false });
  };

  const handleDuplicateConfirm = async () => {
    if (!contentType || !slug || !locale) return;
    const { index } = duplicateDialog;
    const sectionToDuplicate = sections[index];
    if (!sectionToDuplicate) return;
    setDuplicateDialog(prev => ({ ...prev, isDuplicating: true }));

    const result = await sendEditOperation(contentType, slug, locale, [
      { action: "add_item", path: "sections", index: index + 1, item: sectionToDuplicate }
    ], { variant, version });

    if (result.success) {
      const cleared = result.clearedFields ?? [];
      toast({
        title: "Section duplicated",
        description:
          cleared.length > 0
            ? `Cleared ${cleared.length} conversion/ecommerce field(s) — re-set them before save/publish.`
            : undefined,
      });
      emitContentUpdated({ contentType, slug, locale });
    } else {
      toast({ title: "Failed to duplicate section", description: result.error, variant: "destructive" });
    }
    setDuplicateDialog({ open: false, index: -1, isDuplicating: false });
  };

  // Interleaved rendering items: live sections + ghost placeholders for per-entry removed sections
  const interleavedItems = (() => {
    if (!isEditMode || !singleEntry || !perEntryRemovedSections || perEntryRemovedSections.length === 0) {
      return null; // Fall through to regular rendering
    }

    type InterleavedItem =
      | { kind: 'live'; rawSection: Section; resolvedSection: Section; liveIndex: number }
      | { kind: 'ghost'; section: Record<string, unknown>; originalIndex: number };

    // Split live sections into base (from shared template) and per-entry additions
    const baseLiveSections: Array<{ raw: Section; resolved: Section; liveIndex: number }> = [];
    const perEntryAdditions: Array<{ raw: Section; resolved: Section; liveIndex: number }> = [];
    for (let i = 0; i < sections.length; i++) {
      const raw = sections[i];
      const resolved = resolvedSections[i] ?? raw;
      if ((raw as Record<string, unknown>)._perEntrySource) {
        perEntryAdditions.push({ raw, resolved, liveIndex: i });
      } else {
        baseLiveSections.push({ raw, resolved, liveIndex: i });
      }
    }

    // Sort removed sections by originalIndex
    const removedSorted = [...perEntryRemovedSections].sort((a, b) => a.originalIndex - b.originalIndex);

    const result: InterleavedItem[] = [];
    let liveIdx = 0;
    let removedIdx = 0;
    let slot = 0;

    while (liveIdx < baseLiveSections.length || removedIdx < removedSorted.length) {
      const nextRemovedSlot = removedIdx < removedSorted.length ? removedSorted[removedIdx].originalIndex : Infinity;
      if (slot === nextRemovedSlot) {
        result.push({ kind: 'ghost', section: removedSorted[removedIdx].section, originalIndex: slot });
        removedIdx++;
      } else if (liveIdx < baseLiveSections.length) {
        const item = baseLiveSections[liveIdx];
        result.push({ kind: 'live', rawSection: item.raw, resolvedSection: item.resolved, liveIndex: item.liveIndex });
        liveIdx++;
      } else {
        break;
      }
      slot++;
    }

    // Per-entry additions go at the end
    for (const item of perEntryAdditions) {
      result.push({ kind: 'live', rawSection: item.raw, resolvedSection: item.resolved, liveIndex: item.liveIndex });
    }

    return result;
  })();

  const content = (
    <>
      {isEditMode && (
        <Suspense fallback={null}>
          <AddSectionButton
            insertIndex={0}
            sections={sections}
            contentType={contentType}
            slug={slug}
            locale={locale}
            variant={variant}
            version={version}
            isSharedTemplate={isSharedTemplate}
            singleEntry={singleEntry}
            allowEntryStructuralOverrides={allowEntryStructuralOverrides}
          />
        </Suspense>
      )}
      {sections.length === 0 && (
        <EmptyPageState 
          isEditMode={isEditMode} 
          locale={locale} 
          contentType={contentType}
          slug={slug}
          variant={variant}
          version={version}
          isSharedTemplate={isSharedTemplate}
        />
      )}
      {(() => {
        let hasAppliedTopCover = false;

        const renderGhost = (section: Record<string, unknown>, originalIndex: number) => {
          const ghostType = typeof section.type === 'string' ? section.type : 'section';
          const ghostVariant = typeof section.variant === 'string' ? section.variant : null;
          const ghostLabel = ghostVariant ? `${ghostType} (${ghostVariant})` : ghostType;
          return (
            <div key={`ghost-${originalIndex}`} className="relative group">
              <div
                className="flex items-center justify-between px-6 py-4 mx-4 my-2 border-2 border-dashed border-muted-foreground/30 rounded-lg bg-muted/20 text-muted-foreground"
                data-testid={`ghost-section-${originalIndex}`}
              >
                <div className="flex items-center gap-3">
                  <Trash2 className="h-4 w-4 shrink-0 text-muted-foreground/60" />
                  <div>
                    <p className="text-sm font-medium">{ghostLabel} — hidden for this entry</p>
                    {canonicalSectionId(section as Record<string, unknown>) && (
                      <p className="text-xs text-muted-foreground/60 font-mono">#{canonicalSectionId(section as Record<string, unknown>)}</p>
                    )}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => setRestoreDialog({ open: true, section, isRestoring: false })}
                  data-testid={`button-restore-section-${originalIndex}`}
                >
                  Restore
                </Button>
              </div>
            </div>
          );
        };

        const renderLiveSection = (section: Section, index: number, opts?: { skipHiddenCheck?: boolean }) => {
          const skipHiddenCheck = opts?.skipHiddenCheck ?? false;
          const rawSection = sections[index];
          const sectionType = (section as { type: string }).type;
          // contact_bubble renders as a fixed-position element with no in-flow
          // height; lazy-loading it behind a scroll sentinel means it may never
          // appear, so it must always load eagerly.
          const loadStrategy = isEditMode || section.type === "contact_bubble"
            ? "eager"
            : resolveLoadStrategy(rawSection, index, settings);

          // Hidden-until-redirection: suppress in live mode; full render + badge in edit mode
          const isHiddenUntilRedirection = (rawSection as SectionLayout).hidden_until_redirection === true;
          if (isHiddenUntilRedirection && !skipHiddenCheck) {
            if (!isEditMode) return null;
            const fullContent = renderLiveSection(section, index, { skipHiddenCheck: true });
            return (
              <div key={index} className="relative" data-testid={`hidden-until-redirect-section-${index}`}>
                {fullContent}
              </div>
            );
          }

          const pageContext: SectionPageContext = {
            url: typeof window !== "undefined" ? window.location.pathname : undefined,
          };
          if (contentType && slug && locale && rawContentTypes) {
            const ctEntry = rawContentTypes.find((ct) => ct.name === contentType);
            if (ctEntry) {
              const dir = ctEntry.directory;
              if (singleEntry) {
                pageContext.yamlFile = `4geeks-com/${dir}/template.${locale}.yml`;
              } else {
                pageContext.yamlFile = `4geeks-com/${dir}/${slug}/_common.yml`;
              }
            }
          }

          const renderedContent = renderSection(section, index, pageContext);
          const wrapperStyles = getSectionWrapperStyles(section);
          const innerStyles: CSSProperties = {
            maxWidth: "var(--section-mw)",
            marginLeft: "auto",
            marginRight: "auto",
            width: "100%",
            paddingLeft: "var(--section-inner-px)",
            paddingRight: "var(--section-inner-px)",
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
                <Suspense fallback={null}>
                  <AddSectionButton
                    insertIndex={index + 1}
                    sections={sections}
                    contentType={contentType}
                    slug={slug}
                    locale={locale}
                    variant={variant}
                    version={version}
                    isSharedTemplate={isSharedTemplate}
                    singleEntry={singleEntry}
                    allowEntryStructuralOverrides={allowEntryStructuralOverrides}
                  />
                </Suspense>
              </div>
            );
          }

          const isFirstVisibleSection = isVisible && !hasAppliedTopCover;
          if (isFirstVisibleSection) hasAppliedTopCover = true;

          const topCoverBackground = typeof wrapperStyles.background === "string" ? wrapperStyles.background : undefined;
          const hasTopCover = isFirstVisibleSection
            && sectionBackgroundOverlapsMenu
            && !!topCoverBackground
            && (topChromeHeightDesktop > 0 || topChromeHeightMobile > 0);
          const sectionWrapperStyles = hasTopCover ? { ...wrapperStyles, background: "transparent" } : wrapperStyles;
          const contentLayerStyles: CSSProperties = hasTopCover ? { ...innerStyles, position: "relative" } : innerStyles;
          const sectionId = (rawSection as SectionLayout).section_id || `${sectionType}-${index}`;
          const isPriority = loadStrategy === "eager";
          const sectionVariableFields = (rawSection as Record<string, unknown>)._variableFields as Record<string, string> | undefined;
          const sectionVariableKeys = (rawSection as Record<string, unknown>)._variableKeys as Record<string, string> | undefined;
          const imageSizes = ((rawSection as Record<string, unknown>)._imageSizes as Record<string, string> | undefined) ?? {};
          const priorityWrapped = (
            <SectionContextProvider
              value={{
                isPriority,
                sectionIndex: index,
                contentType: contentType ?? "",
                slug: slug ?? "",
                locale: locale ?? "",
                singleEntry,
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
                      style={{ top: `${-topChromeHeightDesktop}px`, background: topCoverBackground }}
                    />
                  )}
                  {topChromeHeightMobile > 0 && (
                    <div
                      aria-hidden="true"
                      className="pointer-events-none absolute inset-x-0 bottom-0 z-0 md:hidden"
                      style={{ top: `${-topChromeHeightMobile}px`, background: topCoverBackground }}
                    />
                  )}
                </>
              )}
              <div style={contentLayerStyles}>
                <SectionRenderErrorBoundary
                  sectionType={sectionType}
                  sectionId={sectionId}
                  onEditYaml={onEditYaml}
                >
                  {isEditMode ? (
                    <Suspense fallback={null}>
                      <EditableSection
                        section={rawSection}
                        index={index}
                        sectionType={sectionType}
                        contentType={contentType}
                        slug={slug}
                        locale={locale}
                        variant={variant}
                        totalSections={sections.length}
                        allSections={sections}
                        isSharedTemplate={isSharedTemplate}
                        singleEntry={singleEntry}
                        allowEntryStructuralOverrides={allowEntryStructuralOverrides}
                        onMoveUp={handleMoveUp}
                        onMoveDown={handleMoveDown}
                        onDelete={handleDelete}
                        onDuplicate={handleDuplicate}
                      >
                        <VariableHighlightProvider sectionIndex={index} contentType={contentType} hasSingleVars={!!singleEntry} singleEntry={singleEntry}>
                          {renderedSection}
                        </VariableHighlightProvider>
                      </EditableSection>
                    </Suspense>
                  ) : (
                    <VariableHighlightProvider sectionIndex={index} contentType={contentType} hasSingleVars={!!singleEntry} singleEntry={singleEntry}>
                      {renderedSection}
                    </VariableHighlightProvider>
                  )}
                </SectionRenderErrorBoundary>
                {isEditMode && (
                  <Suspense fallback={null}>
                    <AddSectionButton
                      insertIndex={index + 1}
                      sections={sections}
                      contentType={contentType}
                      slug={slug}
                      locale={locale}
                      variant={variant}
                      version={version}
                      isSharedTemplate={isSharedTemplate}
                      singleEntry={singleEntry}
                      allowEntryStructuralOverrides={allowEntryStructuralOverrides}
                    />
                  </Suspense>
                )}
              </div>
            </div>
          );
        };

        if (interleavedItems) {
          // Interleaved rendering: ghosts + live sections in template order
          return interleavedItems.map((item) => {
            if (item.kind === 'ghost') {
              return renderGhost(item.section, item.originalIndex);
            }
            return renderLiveSection(item.resolvedSection, item.liveIndex);
          });
        }

        // Default: render live sections only
        return resolvedSections.map((section, index) => renderLiveSection(section, index));
      })()}
    </>
  );

  const deleteDialogSiblings = deleteDialog.bindingGroup?.members.filter(
    m => !(m.contentType === contentType && m.slug === slug && m.sectionIndex === deleteDialog.index)
  ) || [];

  return (
    <PageFunnelProvider funnel={funnel}>
    <PageSectionsProvider value={pageSectionsContextValue}>
      <>
        {content}
        {isEditMode && (
        <Suspense>
          <DbTemplateWarningDialog
            open={dbTemplateDeleteDialog.open}
            onClose={() => setDbTemplateDeleteDialog({ open: false, index: -1, isDeleting: false })}
            onConfirm={handleDbTemplateDeleteConfirm}
            operation="delete"
            contentType={contentType || "page"}
            isLoading={dbTemplateDeleteDialog.isDeleting}
          />
        </Suspense>
      )}

      {/* Scope choice dialog: delete on specific DB entry page */}
      <Dialog open={dbEntryDeleteDialog.open} onOpenChange={(open) => { if (!open && !dbEntryDeleteDialog.isDeleting) setDbEntryDeleteDialog({ open: false, index: -1, isPerEntry: false, isDeleting: false }); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Remove section
            </DialogTitle>
            <DialogDescription>
              Choose how to remove this section for this {singularLabel}.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2 pt-1">
            <Button
              variant="outline"
              disabled={dbEntryDeleteDialog.isDeleting}
              className="w-full justify-start gap-2"
              data-testid="button-scope-delete-this-entry"
              onClick={handleDbEntryRemoveThisEntry}
            >
              {dbEntryDeleteDialog.isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Hide from this {singularLabel} only
            </Button>
            {!dbEntryDeleteDialog.isPerEntry && (
              <Button
                variant="destructive"
                disabled={dbEntryDeleteDialog.isDeleting}
                className="w-full justify-start gap-2"
                data-testid="button-scope-delete-all-entries"
                onClick={handleDbEntryDeleteAllEntries}
              >
                {dbEntryDeleteDialog.isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete from all {singularLabel}s (shared template)
              </Button>
            )}
            <Button
              variant="ghost"
              disabled={dbEntryDeleteDialog.isDeleting}
              className="w-full"
              onClick={() => setDbEntryDeleteDialog({ open: false, index: -1, isPerEntry: false, isDeleting: false })}
            >
              Cancel
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Restore dialog for ghost sections */}
      <Dialog open={restoreDialog.open} onOpenChange={(open) => { if (!open && !restoreDialog.isRestoring) setRestoreDialog({ open: false, section: {}, isRestoring: false }); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Restore hidden section</DialogTitle>
            <DialogDescription>
              This will restore the section from the shared template for this entry.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => setRestoreDialog({ open: false, section: {}, isRestoring: false })}
              disabled={restoreDialog.isRestoring}
              data-testid="button-restore-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={handleRestoreConfirm}
              disabled={restoreDialog.isRestoring}
              data-testid="button-restore-confirm"
            >
              {restoreDialog.isRestoring ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Restore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
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

      {/* Simple delete confirmation dialog */}
      <Dialog open={simpleDeleteDialog.open} onOpenChange={(open) => { if (!open && !simpleDeleteDialog.isDeleting) setSimpleDeleteDialog({ open: false, index: -1, isDeleting: false }); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete section
            </DialogTitle>
            <DialogDescription>
              This section will be permanently removed. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => setSimpleDeleteDialog({ open: false, index: -1, isDeleting: false })}
              disabled={simpleDeleteDialog.isDeleting}
              data-testid="button-delete-cancel-simple"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleSimpleDeleteConfirm}
              disabled={simpleDeleteDialog.isDeleting}
              data-testid="button-delete-confirm-simple"
            >
              {simpleDeleteDialog.isDeleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Duplicate confirmation dialog */}
      <Dialog open={duplicateDialog.open} onOpenChange={(open) => { if (!open && !duplicateDialog.isDuplicating) setDuplicateDialog({ open: false, index: -1, isDuplicating: false }); }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Duplicate section</DialogTitle>
            <DialogDescription>
              A copy of this section will be inserted directly below the original.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => setDuplicateDialog({ open: false, index: -1, isDuplicating: false })}
              disabled={duplicateDialog.isDuplicating}
              data-testid="button-duplicate-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={handleDuplicateConfirm}
              disabled={duplicateDialog.isDuplicating}
              data-testid="button-duplicate-confirm"
            >
              {duplicateDialog.isDuplicating ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Duplicate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Move warning dialog — shown on the shared template admin page before reordering a section */}
      <Dialog
        open={moveDependantsDialog.open}
        onOpenChange={(open) => { if (!open) setMoveDependantsDialog(prev => ({ ...prev, open: false })); }}
      >
        <DialogContent className="sm:max-w-sm" data-testid="dialog-move-dependants">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-muted-foreground" />
              Move section
            </DialogTitle>
            <DialogDescription>
              {moveDependantsDialog.dependants.length === 0
                ? "This will reorder this section across all entries."
                : moveDependantsDialog.dependants.length === 1
                ? "1 entry has a custom section anchored here — it will follow this section to its new position."
                : `${moveDependantsDialog.dependants.length} entries have custom sections anchored here — they will follow this section to its new position.`}
            </DialogDescription>
          </DialogHeader>
          {moveDependantsDialog.dependants.length > 0 && (
            <div className="space-y-1 max-h-[180px] overflow-auto">
              <p className="text-xs font-medium text-muted-foreground">Affected entries:</p>
              {moveDependantsDialog.dependants.map((slug) => (
                <div key={slug} className="text-sm text-foreground truncate" data-testid={`move-dependant-slug-${slug}`}>
                  {slug}
                </div>
              ))}
            </div>
          )}
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => setMoveDependantsDialog(prev => ({ ...prev, open: false }))}
              data-testid="button-move-dependants-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                const { index, direction } = moveDependantsDialog;
                setMoveDependantsDialog(prev => ({ ...prev, open: false }));
                await performMove(index, direction === "up" ? index - 1 : index + 1);
              }}
              data-testid="button-move-dependants-confirm"
            >
              {moveDependantsDialog.dependants.length === 0 ? "Move" : "Move anyway"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirmation dialog — shown when moving a template section from a specific DB entry page */}
      <Dialog
        open={dbEntryMoveDialog.open}
        onOpenChange={(open) => { if (!open) setDbEntryMoveDialog(prev => ({ ...prev, open: false })); }}
      >
        <DialogContent className="sm:max-w-sm" data-testid="dialog-db-entry-move">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-muted-foreground" />
              Move section
            </DialogTitle>
            <DialogDescription>
              This moves the section across all {contentType} entries. The order change will apply to the shared template.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="ghost"
              onClick={() => setDbEntryMoveDialog(prev => ({ ...prev, open: false }))}
              data-testid="button-db-entry-move-cancel"
            >
              Cancel
            </Button>
            <Button
              onClick={async () => {
                const { index, direction } = dbEntryMoveDialog;
                setDbEntryMoveDialog(prev => ({ ...prev, open: false }));
                await performMove(index, direction === "up" ? index - 1 : index + 1);
              }}
              data-testid="button-db-entry-move-confirm"
            >
              Move
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  </PageSectionsProvider>
  </PageFunnelProvider>
  );
}