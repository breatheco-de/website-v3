/**
 * The hard stop for geekchart sections (owner's ruling, 2026-09-07): a save
 * whose chart fails the renderer's geometry checks is rejected with the
 * violations as the error, so an agent (or human) fixes the mermaid and
 * retries instead of publishing a broken drawing. Advisory warnings — phone
 * height, label length — pass through; only the `-runtime` geometry class
 * (an edge through a box, a line off its source, stacked arrowheads) blocks.
 * The demo endpoint stays warn-only on purpose: previews are the practice
 * space, the page is not.
 */
import { renderToSvg } from "geekchart/server";

const GEOMETRY = /^6\.\d-runtime /;

/** The blocking subset of a render's warnings. Pure, unit-testable. */
export function geometryViolations(warnings: readonly string[]): string[] {
  return warnings.filter((w) => GEOMETRY.test(w));
}

export type GeekchartGuardResult =
  | { ok: true }
  | { ok: false; violations: string[] };

/** Render every geekchart section in a set of edit operations and collect
 * geometry violations. A source that fails to render at all is also a
 * violation — an unparseable chart has no business on a page. */
export async function checkGeekchartSections(
  operations: ReadonlyArray<Record<string, unknown>>,
): Promise<GeekchartGuardResult> {
  const violations: string[] = [];
  const renderAndCollect = async (source: string, duration?: number) => {
    try {
      const r = await renderToSvg(source, {
        display: { desktop: 612, phone: 358 },
        ...(duration ? { duration } : {}),
      });
      violations.push(...geometryViolations((r.warnings ?? []).map(String)));
    } catch (e) {
      violations.push(`render failed: ${(e as Error).message}`);
    }
  };
  for (const op of operations) {
    // Every shape a chart can enter this endpoint through gets rendered.
    // The real MCP add tool sends {action:"add_item", path:"sections",
    // item:{...}}; update_section carries `section`; the simplified
    // single-op format normalizes to `section` upstream but `sectionData`
    // is accepted for safety; and update_field can rewrite one section's
    // `source` in place. Each of these was found the hard way: three probe
    // rounds each caught this guard reading a pocket the writer ignored
    // while the writer used one the guard ignored.
    const data = (op?.item ?? op?.section ?? op?.sectionData) as
      | Record<string, unknown>
      | undefined;
    if (data && data.type === "geekchart") {
      const source = typeof data.source === "string" ? data.source : "";
      if (source.trim()) {
        const duration = typeof data.duration === "number" ? data.duration : undefined;
        await renderAndCollect(source, duration);
      }
      continue;
    }
    // update_field aimed at a section's mermaid source.
    if (
      op?.action === "update_field" &&
      typeof op.path === "string" &&
      /^sections\.\d+\.source$/.test(op.path) &&
      typeof op.value === "string" &&
      op.value.trim()
    ) {
      await renderAndCollect(op.value);
    }
  }
  return violations.length ? { ok: false, violations } : { ok: true };
}
