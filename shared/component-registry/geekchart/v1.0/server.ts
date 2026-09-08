/**
 * Geekchart's server-side hooks (see _common/server-hooks.ts for the
 * contract). The hard stop (owner's ruling, 2026-09-07): a save whose chart
 * fails the renderer's geometry checks is rejected with the violations as
 * the error, so an agent (or human) fixes the mermaid and retries instead of
 * publishing a broken drawing. Advisory warnings — phone height, label
 * length — pass through; only the `-runtime` geometry class (an edge through
 * a box, a line off its source, stacked arrowheads) blocks. The demo/preview
 * hook stays warn-only on purpose: previews are the practice space, the page
 * is not.
 *
 * The geekchart bundle (mermaid + font measurement) costs seconds to load,
 * so it is imported on the first actual render, never at module load.
 */
import type {
  ComponentServerHooks,
  SectionValidationContext,
} from "../../_common/server-hooks";

let mod: Promise<typeof import("geekchart/server")> | null = null;
function loadRenderer() {
  return (mod ??= import("geekchart/server"));
}

const GEOMETRY = /^6\.\d-runtime /;
const DISPLAY = { desktop: 612, phone: 358 };

/** The blocking subset of a render's warnings. Pure, unit-testable. */
export function geometryViolations(warnings: readonly string[]): string[] {
  return warnings.filter((w) => GEOMETRY.test(w));
}

async function renderViolations(
  source: string,
  duration?: number,
  wide?: boolean,
): Promise<string[]> {
  try {
    const { renderToSvg } = await loadRenderer();
    // A wide (hero) section renders at its natural width on the page, so it
    // is validated the same way; column sections validate at column widths.
    const r = await renderToSvg(source, {
      ...(wide ? {} : { display: DISPLAY }),
      ...(duration ? { duration } : {}),
    });
    return geometryViolations((r.warnings ?? []).map(String));
  } catch (e) {
    // A source that fails to render at all has no business on a page.
    return [`render failed: ${(e as Error).message}`];
  }
}

/**
 * Preview-first (owner's ruling, 2026-09-08): an MCP agent may only save a
 * chart whose exact source it has already demoed — creating the demo is what
 * produces the preview link a human sees. Matching is on the trimmed source
 * alone, so re-tuning duration or caption on an approved chart never forces
 * a fresh preview round. Human editor saves are exempt: the human is already
 * looking at the chart.
 */
function previewRequired(
  source: string,
  ctx: SectionValidationContext,
): { violations: string[]; code: string; message: string } | null {
  if (!ctx.isMcpAuthor) return null;
  const wanted = source.trim();
  const demoed = ctx
    .listDemoSections("geekchart")
    .some((s) => typeof s.source === "string" && s.source.trim() === wanted);
  if (demoed) return null;
  return {
    code: "geekchart_preview_required",
    message:
      "geekchart section rejected: this chart has not been previewed. Create a component section demo with this exact source, share its preview link with the user, and retry the save after they have seen it",
    violations: ["no demo exists with this chart source — preview it first"],
  };
}

export const hooks: ComponentServerHooks = {
  saveRejection: {
    code: "geekchart_geometry",
    message:
      "geekchart section rejected: the chart's drawing fails geometry checks — fix the mermaid source and retry (see the geekchart component's authoring rules)",
  },

  async validateSection(section, ctx) {
    const source = typeof section.source === "string" ? section.source : "";
    if (!source.trim()) return [];
    const unpreviewed = previewRequired(source, ctx);
    if (unpreviewed) return unpreviewed;
    const duration =
      typeof section.duration === "number" ? section.duration : undefined;
    return renderViolations(source, duration, section.wide === true);
  },

  async validateFieldUpdate(field, value, ctx) {
    if (field !== "source" || typeof value !== "string" || !value.trim()) {
      return [];
    }
    const unpreviewed = previewRequired(value, ctx);
    if (unpreviewed) return unpreviewed;
    return renderViolations(value);
  },

  async previewSection(section) {
    const source = typeof section.source === "string" ? section.source : "";
    const duration =
      typeof section.duration === "number" ? section.duration : undefined;
    try {
      const { renderToSvg } = await loadRenderer();
      const r = await renderToSvg(source, {
        ...(section.wide === true ? {} : { display: DISPLAY }),
        ...(duration ? { duration } : {}),
      });
      return { warnings: (r.warnings ?? []).map(String) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  },
};
