/**
 * Render review preview: load every section's component code before measuring, so a
 * chunk still downloading is not measured as a 0px "empty" section. Capped so one
 * slow or broken chunk cannot stall the review; sections still missing are reported.
 */
import { hasSectionType, loadSectionComponent } from "@/components/sectionRegistry";

export const PREVIEW_SECTION_CODE_TIMEOUT_MS = 10_000;

export interface PreviewSectionCodeResult {
  /** Section indexes whose known type did not load (null or timed out). */
  notLoaded: Set<number>;
  /** Section indexes whose type has no component. */
  unknownTypes: Set<number>;
}

type Deps = {
  hasType: (type: string) => boolean;
  load: (type: string, variant: string) => Promise<unknown>;
};

export async function loadPreviewSectionCode(
  sections: ReadonlyArray<{ type?: unknown; variant?: unknown }>,
  timeoutMs = PREVIEW_SECTION_CODE_TIMEOUT_MS,
  deps: Deps = { hasType: hasSectionType, load: loadSectionComponent },
): Promise<PreviewSectionCodeResult> {
  const notLoaded = new Set<number>();
  const unknownTypes = new Set<number>();
  const byKey = new Map<string, number[]>();

  sections.forEach((s, index) => {
    const type = typeof s?.type === "string" ? s.type : "";
    if (!type || !deps.hasType(type)) {
      unknownTypes.add(index);
      return;
    }
    const variant = typeof s.variant === "string" && s.variant ? s.variant : "default";
    const key = `${type}::${variant}`;
    byKey.set(key, [...(byKey.get(key) ?? []), index]);
  });

  const loaded = new Set<string>();
  const loads = [...byKey.keys()].map(async (key) => {
    const [type, variant] = key.split("::") as [string, string];
    try {
      if (await deps.load(type, variant)) loaded.add(key);
    } catch {
      /* reported below as not loaded */
    }
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    Promise.all(loads),
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, timeoutMs);
    }),
  ]);
  if (timer) clearTimeout(timer);

  for (const [key, indexes] of byKey) {
    if (!loaded.has(key)) indexes.forEach((i) => notLoaded.add(i));
  }
  return { notLoaded, unknownTypes };
}
