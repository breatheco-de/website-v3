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
import type { ComponentServerHooks } from "../../_common/server-hooks";

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

async function renderViolations(source: string, duration?: number): Promise<string[]> {
  try {
    const { renderToSvg } = await loadRenderer();
    const r = await renderToSvg(source, {
      display: DISPLAY,
      ...(duration ? { duration } : {}),
    });
    return geometryViolations((r.warnings ?? []).map(String));
  } catch (e) {
    // A source that fails to render at all has no business on a page.
    return [`render failed: ${(e as Error).message}`];
  }
}

export const hooks: ComponentServerHooks = {
  saveRejection: {
    code: "geekchart_geometry",
    message:
      "geekchart section rejected: the chart's drawing fails geometry checks — fix the mermaid source and retry (see the geekchart component's authoring rules)",
  },

  async validateSection(section) {
    const source = typeof section.source === "string" ? section.source : "";
    if (!source.trim()) return [];
    const duration =
      typeof section.duration === "number" ? section.duration : undefined;
    return renderViolations(source, duration);
  },

  async validateFieldUpdate(field, value) {
    if (field !== "source" || typeof value !== "string" || !value.trim()) {
      return [];
    }
    return renderViolations(value);
  },

  async previewSection(section) {
    const source = typeof section.source === "string" ? section.source : "";
    const duration =
      typeof section.duration === "number" ? section.duration : undefined;
    try {
      const { renderToSvg } = await loadRenderer();
      const r = await renderToSvg(source, {
        display: DISPLAY,
        ...(duration ? { duration } : {}),
      });
      return { warnings: (r.warnings ?? []).map(String) };
    } catch (e) {
      return { error: (e as Error).message };
    }
  },
};
