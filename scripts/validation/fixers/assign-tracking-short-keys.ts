/**
 * Fixer: give every product / persona without a tracking short key its suggested key
 * (same suggestions as the Store and migration 009). Written files go through the normal
 * content sync; cached pages for those products are cleared.
 */

import type { Fixer } from "./types";
import { resolveScanRoot } from "../shared/draft-scan";
import { markFileAsModified } from "../../../server/sync-state";
import { assignMissingShortKeys } from "../../../server/product/tracking-keys-assign";
import { onTrackingKeysChanged } from "../../../server/product/tracking-keys-effects";
import { loadTrackingKeyIndex } from "../../../server/product/tracking-key-index";

export const assignTrackingShortKeysFixer: Fixer = {
  name: "assign-tracking-short-keys",
  description:
    "Give every product and persona without a tracking key its suggested key (keys staff already set are kept)",
  async run(ctx) {
    const dryRun = ctx.dryRun !== false;
    const root = resolveScanRoot(typeof ctx.contentRoot === "string" ? ctx.contentRoot : undefined);
    const result = assignMissingShortKeys(root, { dryRun });
    ctx.onProgress?.({ type: "start", total: result.assigned.length });
    for (const a of result.assigned) {
      ctx.onProgress?.({
        type: "item",
        id: a.persona ? `${a.product}/${a.persona}` : a.product,
        status: "ok",
        message: `${a.type} ${a.name} = ${a.key}`,
      });
    }
    if (!dryRun && result.files.length) {
      for (const file of result.files) markFileAsModified(file, "System", undefined, root);
      const products = loadTrackingKeyIndex(root).products;
      const touched = new Set(result.assigned.map((a) => a.product));
      onTrackingKeysChanged(
        root,
        products.filter((p) => touched.has(p.slug)).map((p) => ({ contentType: p.content_type, slug: p.slug })),
      );
    }
    return {
      ok: result.errors.length === 0,
      message: `${dryRun ? "Would assign" : "Assigned"} ${result.assigned.length} tracking key(s) in ${
        new Set(result.assigned.map((a) => a.product)).size
      } product file(s)${result.errors.length ? `; ${result.errors.length} file(s) could not be read` : ""}`,
      details: { dryRun, assigned: result.assigned, files: result.files, errors: result.errors },
    };
  },
};
