import type { Express, Response } from "express";
import path from "path";
import { api } from "../rate-limit/api.js";
import { getDefaultContentRoot } from "../site-config";
import { contentIndex } from "../content-index";
import { requireCapability } from "./_helpers";
import { writeFormLocation } from "../form-location-write";
import { child } from "../logger";

const log = child({ module: "routes/form-location" });

function getCI(res: Response): typeof contentIndex {
  return (res.locals.site as { contentIndex?: typeof contentIndex } | undefined)?.contentIndex ?? contentIndex;
}
function getContentRoot(res: Response): string {
  return (res.locals.site as { contentRoot?: string } | undefined)?.contentRoot ?? getDefaultContentRoot();
}

/** Forms tab → Locations box: save for the whole page or for this form in every language. */
export function registerFormLocationRoutes(app: Express): void {
  api.post(app, "/api/content/form-location", { rate: "staffWrite" }, async (req, res) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      const contentType = typeof body.contentType === "string" ? body.contentType : "";
      const slug = typeof body.slug === "string" ? body.slug : "";
      const locale = typeof body.locale === "string" ? body.locale : "";
      const scope = body.scope === "page" || body.scope === "form" ? body.scope : null;
      if (!contentType || !slug || !locale || !scope) {
        res.status(400).json({ error: "contentType, slug, locale and scope (page | form) are required" });
        return;
      }
      const auth = await requireCapability(req, res, "content_edit_default", contentType);
      if (!auth.authorized) return;
      const locations = Array.isArray(body.locations)
        ? body.locations.filter((l): l is string => typeof l === "string")
        : [];
      const rawSection = body.section as Record<string, unknown> | undefined;
      const section =
        rawSection && typeof rawSection.index === "number" && typeof rawSection.type === "string"
          ? {
              index: rawSection.index,
              type: rawSection.type,
              id: typeof rawSection.id === "string" ? rawSection.id : null,
            }
          : undefined;
      const contentRoot = getContentRoot(res);
      const result = await writeFormLocation({
        contentType,
        slug,
        locale,
        variant: typeof body.variant === "string" && body.variant.trim() ? body.variant.trim() : null,
        scope,
        locations,
        section,
        clearOverrideIndexes: Array.isArray(body.clearOverrideIndexes)
          ? body.clearOverrideIndexes.filter((n): n is number => typeof n === "number")
          : [],
        author: auth.author || auth.username || "staff",
        contentRoot,
        contentRootName: path.isAbsolute(contentRoot) ? path.relative(process.cwd(), contentRoot) : contentRoot,
        ci: getCI(res),
      });
      if (!result.ok) {
        res.status(400).json({ error: result.error, ...(result.code ? { code: result.code } : {}), details: result.details });
        return;
      }
      res.json({ success: true, ...result });
    } catch (error) {
      log.error({ err: error }, "form location write failed");
      res.status(500).json({ error: "Internal server error" });
    }
  });
}
