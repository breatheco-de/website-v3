/**
 * When component-registry schema.yml changes, section-variants cached issues can
 * become stale (e.g. new variants: keys added). Debounced site-wide refresh.
 */
import { ValidationService } from "../scripts/validation/service";
import { applyValidationRunToCache } from "./services/validationCachePostProcess";
import type { SiteContext } from "./site-manager";
import { getSiteContextMap } from "./site-manager";
import { child } from "./logger";

const log = child({ module: "registrySchemaValidationRefresh" });

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const DEBOUNCE_MS = 2_000;

const REGISTRY_SCHEMA_PATH =
  /^[^/]+\/component-registry\/[^/]+\/[^/]+\/schema\.ya?ml$/;

export function isComponentRegistrySchemaPath(filePath: string): boolean {
  return REGISTRY_SCHEMA_PATH.test(filePath.replace(/\\/g, "/"));
}

async function refreshSectionVariants(ctx: SiteContext): Promise<void> {
  try {
    const service = new ValidationService();
    const context = await service.buildContext({
      contentRoot: ctx.contentRoot,
      ci: ctx.contentIndex,
    });
    const result = await service.runValidators({ validators: ["section-variants"] });
    await applyValidationRunToCache(ctx.validationCache, result, context, {
      markSiteWide: true,
    });
    await ctx.validationCache.flush();
    log.info(
      { site: ctx.contentRootName, errors: result.validators[0]?.errors.length ?? 0 },
      "Refreshed section-variants after registry schema change",
    );
  } catch (err) {
    log.warn({ err, site: ctx.contentRootName }, "section-variants refresh failed");
  }
}

export function scheduleSectionVariantsRefreshForFile(filePath: string): void {
  const normalized = filePath.replace(/\\/g, "/");
  if (!isComponentRegistrySchemaPath(normalized)) return;

  for (const ctx of getSiteContextMap().values()) {
    if (!normalized.startsWith(`${ctx.contentRootName}/`)) continue;

    const existing = timers.get(ctx.contentRootName);
    if (existing) clearTimeout(existing);

    timers.set(
      ctx.contentRootName,
      setTimeout(() => {
        timers.delete(ctx.contentRootName);
        void refreshSectionVariants(ctx);
      }, DEBOUNCE_MS),
    );
    break;
  }
}
