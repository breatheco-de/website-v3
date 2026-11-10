/**
 * In-page layout measurements for the render review. Runs in the preview page
 * after images settle and reports raw geometry per rendered section plus
 * candidate findings with exact `sections[i]` paths. The server filters
 * candidates with component layout traits (out-of-flow, self-padded) and
 * learned rules before they become design issues.
 */

export interface MeasuredSection {
  index: number;
  path: string;
  type: string;
  top: number;
  height: number;
  padding_top: number;
  padding_bottom: number;
  margin_top: number;
  margin_bottom: number;
  /** Computed background (color or image), "transparent" when none. */
  background: string;
  /** Space between the previous rendered section's bottom and this top. */
  gap_before: number | null;
}

export interface MeasurementFinding {
  code:
    | "horizontal_overflow"
    | "color_edge_without_padding"
    | "heading_order"
    | "multiple_h1"
    | "empty_section"
    | "section_not_loaded"
    | "section_unknown_type"
    | "broken_image"
    | "tight_gap";
  severity: "error" | "warning";
  section_path: string | null;
  message: string;
  evidence?: Record<string, unknown>;
}

export interface PageMeasurements {
  version: 1;
  viewport: { width: number; height: number };
  page_height: number;
  document_scroll_width: number;
  sections: MeasuredSection[];
  findings: MeasurementFinding[];
}

const MIN_EDGE_PADDING_PX = 16;
const EMPTY_SECTION_PX = 24;

function px(v: string): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

/**
 * True when an ancestor between `child` and its section wrapper clips horizontal
 * overflow and itself ends inside the viewport — a carousel track, not page scroll.
 */
function clippedWithinViewport(child: HTMLElement, wrapper: HTMLElement, vw: number): boolean {
  let node = child.parentElement;
  while (node) {
    const cs = getComputedStyle(node);
    const clips = /hidden|clip/.test(cs.overflowX || "") || /hidden|clip/.test(cs.overflow || "");
    if (clips && node.getBoundingClientRect().right <= vw + 1) return true;
    if (node === wrapper) return false;
    node = node.parentElement;
  }
  return false;
}

function backgroundOf(el: HTMLElement): string {
  const cs = getComputedStyle(el);
  if (cs.backgroundImage && cs.backgroundImage !== "none") return cs.backgroundImage;
  const c = cs.backgroundColor;
  if (!c || c === "transparent" || /rgba\([^)]*,\s*0\)$/.test(c)) return "transparent";
  return c;
}

export interface MeasureOptions {
  /** Section indexes whose code did not load in time (timed out or failed to download). */
  notLoaded?: ReadonlySet<number>;
  /** Section indexes whose type has no component at all. */
  unknownTypes?: ReadonlySet<number>;
}

export function measurePage(root: ParentNode = document, opts: MeasureOptions = {}): PageMeasurements {
  const vw = window.innerWidth;
  const wrappers = Array.from(root.querySelectorAll<HTMLElement>(".section-wrapper[data-section-index]"));
  const sections: MeasuredSection[] = [];
  const findings: MeasurementFinding[] = [];
  const scrollY = window.scrollY;

  let prev: MeasuredSection | null = null;
  for (const el of wrappers) {
    const index = Number(el.dataset.sectionIndex);
    const rect = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    const top = rect.top + scrollY;
    const m: MeasuredSection = {
      index,
      path: `sections[${index}]`,
      type: el.dataset.sectionType || "",
      top: Math.round(top),
      height: Math.round(rect.height),
      padding_top: px(cs.paddingTop),
      padding_bottom: px(cs.paddingBottom),
      margin_top: px(cs.marginTop),
      margin_bottom: px(cs.marginBottom),
      background: backgroundOf(el),
      gap_before: prev ? Math.round(top - (prev.top + prev.height)) : null,
    };
    sections.push(m);

    if (opts.unknownTypes?.has(index)) {
      findings.push({
        code: "section_unknown_type",
        severity: "error",
        section_path: m.path,
        message: `No component for section type "${m.type}"; check the type name.`,
        evidence: { type: m.type },
      });
    } else if (opts.notLoaded?.has(index)) {
      findings.push({
        code: "section_not_loaded",
        severity: "warning",
        section_path: m.path,
        message: `${m.type} code did not load during the review; re-run the review.`,
        evidence: { height: m.height },
      });
    } else if (m.height < EMPTY_SECTION_PX && el.offsetParent !== null) {
      findings.push({
        code: "empty_section",
        severity: "warning",
        section_path: m.path,
        message: `${m.type} renders ${m.height}px tall — likely empty or missing content.`,
        evidence: { height: m.height },
      });
    }

    let overflowRight = 0;
    el.querySelectorAll<HTMLElement>("*").forEach((child) => {
      const r = child.getBoundingClientRect();
      if (r.width > 0 && r.right > vw + 1 && !clippedWithinViewport(child, el, vw)) {
        overflowRight = Math.max(overflowRight, Math.round(r.right - vw));
      }
    });
    if (overflowRight > 0) {
      findings.push({
        code: "horizontal_overflow",
        severity: "error",
        section_path: m.path,
        message: `${m.type} overflows the viewport by ${overflowRight}px (horizontal scroll).`,
        evidence: { overflow_px: overflowRight, viewport_width: vw },
      });
    }

    el.querySelectorAll<HTMLImageElement>("img").forEach((img) => {
      if (img.complete && img.naturalWidth === 0 && img.getAttribute("src")) {
        findings.push({
          code: "broken_image",
          severity: "error",
          section_path: m.path,
          message: `Image failed to load in ${m.type}.`,
          evidence: { src: img.getAttribute("src") },
        });
      }
    });

    if (prev && m.background !== prev.background) {
      const colored = (s: MeasuredSection) => s.background !== "transparent";
      if (colored(m) && m.padding_top < MIN_EDGE_PADDING_PX) {
        findings.push({
          code: "color_edge_without_padding",
          severity: "warning",
          section_path: m.path,
          message: `${m.type} starts a new background with only ${m.padding_top}px top padding — content touches the color edge.`,
          evidence: { edge: "top", padding_top: m.padding_top, background: m.background, previous_background: prev.background },
        });
      }
      if (colored(prev) && prev.padding_bottom < MIN_EDGE_PADDING_PX) {
        findings.push({
          code: "color_edge_without_padding",
          severity: "warning",
          section_path: prev.path,
          message: `${prev.type} ends its background with only ${prev.padding_bottom}px bottom padding.`,
          evidence: { edge: "bottom", padding_bottom: prev.padding_bottom, background: prev.background, next_background: m.background },
        });
      }
    }
    if (prev && m.gap_before !== null && m.gap_before < 0) {
      findings.push({
        code: "tight_gap",
        severity: "warning",
        section_path: m.path,
        message: `${m.type} overlaps the previous section by ${-m.gap_before}px.`,
        evidence: { gap_before: m.gap_before },
      });
    }
    prev = m;
  }

  const headings = Array.from(root.querySelectorAll<HTMLElement>("h1, h2, h3, h4, h5, h6")).filter(
    (h) => h.offsetParent !== null,
  );
  const sectionOf = (h: HTMLElement) => {
    const w = h.closest<HTMLElement>(".section-wrapper[data-section-index]");
    return w ? `sections[${w.dataset.sectionIndex}]` : null;
  };
  const h1s = headings.filter((h) => h.tagName === "H1");
  if (h1s.length > 1) {
    findings.push({
      code: "multiple_h1",
      severity: "warning",
      section_path: sectionOf(h1s[1]!),
      message: `${h1s.length} H1 headings on the page; keep one (the hero title).`,
      evidence: { h1_sections: h1s.map(sectionOf) },
    });
  }
  let lastLevel = 0;
  for (const h of headings) {
    const level = Number(h.tagName.slice(1));
    if (lastLevel > 0 && level > lastLevel + 1) {
      findings.push({
        code: "heading_order",
        severity: "warning",
        section_path: sectionOf(h),
        message: `Heading jumps from H${lastLevel} to H${level} ("${(h.textContent || "").trim().slice(0, 60)}").`,
        evidence: { from: lastLevel, to: level },
      });
    }
    lastLevel = level;
  }

  // Always reported: this is the finding that means the page itself scrolls sideways.
  const scrollWidth = document.documentElement.scrollWidth;
  if (scrollWidth > vw + 1) {
    findings.push({
      code: "horizontal_overflow",
      severity: "error",
      section_path: null,
      message: `Page is ${scrollWidth - vw}px wider than the viewport.`,
      evidence: { scroll_width: scrollWidth, viewport_width: vw },
    });
  }

  return {
    version: 1,
    viewport: { width: vw, height: window.innerHeight },
    page_height: Math.round(document.documentElement.scrollHeight),
    document_scroll_width: scrollWidth,
    sections,
    findings,
  };
}
