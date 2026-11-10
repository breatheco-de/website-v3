import type { Plugin } from "vite";
import { checkPublicClosure, formatHit, type BundleChunk } from "./public-closure";

/** Raw (uncompressed) bytes of the public closure; warn above this. Measured 2,391 KB on 10 Nov 2026, plus 5%. */
export const PUBLIC_CLOSURE_BUDGET_BYTES = 2_510 * 1024;

/**
 * Client build only. Fails the build when admin-only libraries reach the JS
 * every visitor downloads; warns for libraries still being moved out and when
 * the closure grows past the budget.
 */
export function publicBundleGuardPlugin(isSsr: boolean): Plugin {
  return {
    name: "public-bundle-guard",
    apply: "build",
    generateBundle(_options, bundle) {
      if (isSsr) return;
      const chunks: BundleChunk[] = [];
      for (const item of Object.values(bundle)) {
        if (item.type !== "chunk") continue;
        chunks.push({
          fileName: item.fileName,
          isEntry: item.isEntry,
          facadeModuleId: item.facadeModuleId ?? null,
          imports: item.imports,
          moduleIds: item.moduleIds,
          sizeBytes: Buffer.byteLength(item.code),
        });
      }
      const report = checkPublicClosure(chunks);
      const kb = Math.round(report.rawBytes / 1024);
      console.log("[public-bundle-guard] public JS closure", {
        files: report.files.length,
        rawKb: kb,
        roots: report.roots,
      });

      for (const hit of report.warnings) {
        this.warn(`still in the public bundle, move behind edit mode: ${formatHit(hit)}`);
      }
      if (report.rawBytes > PUBLIC_CLOSURE_BUDGET_BYTES) {
        const budgetKb = Math.round(PUBLIC_CLOSURE_BUDGET_BYTES / 1024);
        this.warn(`public JS closure is ${kb} KB raw, over the ${budgetKb} KB budget`);
      }
      if (report.errors.length > 0) {
        this.error(
          "Admin-only libraries are in the JS every visitor downloads:\n  " +
            report.errors.map(formatHit).join("\n  ") +
            "\nGive the shared module its own manualChunks group in vite.config.ts or lazy-load the importer.",
        );
      }
    },
  };
}
