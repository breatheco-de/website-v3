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
  for (const op of operations) {
    // The operations-array format carries the section as `section`; the
    // simplified single-op format arrives here already normalized to the
    // same shape, but accept `sectionData` too so no caller shape slips
    // past the stop. (Found live: a probe using `sectionData` in the array
    // format was silently ignored by the writer AND missed by this guard's
    // first version - the two mistakes cancelled in testing and would have
    // let real saves bypass the stop.)
    const data = (op?.section ?? op?.sectionData) as Record<string, unknown> | undefined;
    if (!data || data.type !== "geekchart") continue;
    const source = typeof data.source === "string" ? data.source : "";
    if (!source.trim()) continue; // empty source is the schema's problem
    const duration = typeof data.duration === "number" ? data.duration : undefined;
    try {
      const r = await renderToSvg(source, {
        display: { desktop: 612, phone: 358 },
        ...(duration ? { duration } : {}),
      });
      violations.push(...geometryViolations((r.warnings ?? []).map(String)));
    } catch (e) {
      violations.push(`render failed: ${(e as Error).message}`);
    }
  }
  return violations.length ? { ok: false, violations } : { ok: true };
}
