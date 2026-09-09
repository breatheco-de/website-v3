#!/usr/bin/env tsx
/**
 * Verify that shared/schema.ts can import named exports from local
 * site component-registry schema.ts files (gitignored, content-synced).
 *
 * When site content is absent (or WEBLIFY_SITE_SCHEMAS_STUB=1), skips the live
 * import check — pack/CI builds use the stub bridge via Vite/esbuild alias.
 *
 * Usage: npm run check:registry
 */

import {
  shouldUseSiteSchemaStub,
  siteComponentRegistryExists,
} from "../shared/site-schema-stub-mode.ts";

const RECOVERY = `
Recovery:
  1. npm run content:pull
     (needs GITHUB_TOKEN + github_repo_url in sites.yml; does not need the server)
  2. Or open GitHub Sync in the Debug bubble once the server is running
  3. If remote also lacks the export: land the schema in the content repo first,
     or temporarily remove the premature re-export from shared/schema.ts

Note: site_*/component-registry is content-synced (gitignored), not part of the app git repo.
shared/site-component-schemas.ts is the single coupling point that re-exports Zod from those files
(shared/schema.ts imports the bridge only) — a content lag breaks boot/build.
`.trim();

export interface RegistryCheckResult {
  ok: boolean;
  errorMessage?: string;
  missingExport?: string;
  modulePath?: string;
}

function parseImportError(err: unknown): {
  message: string;
  missingExport?: string;
  modulePath?: string;
} {
  const message = err instanceof Error ? err.message : String(err);

  const named = message.match(
    /does not provide an export named ['"]([^'"]+)['"]/,
  );
  const mod = message.match(/The requested module ['"]([^'"]+)['"]/);

  return {
    message,
    missingExport: named?.[1],
    modulePath: mod?.[1],
  };
}

export function formatRegistryFailure(result: RegistryCheckResult): string {
  const lines: string[] = [
    "FAILED — shared/schema cannot load site component-registry schemas",
    "",
  ];

  if (result.missingExport) {
    lines.push(`  Missing export: ${result.missingExport}`);
  }
  if (result.modulePath) {
    lines.push(`  Module:        ${result.modulePath}`);
  }
  if (result.errorMessage && !result.missingExport) {
    lines.push(`  Error:         ${result.errorMessage}`);
  }
  lines.push("");
  lines.push(RECOVERY);
  return lines.join("\n");
}

export async function checkRegistryImports(): Promise<RegistryCheckResult> {
  try {
    await import("../shared/schema.ts");
    return { ok: true };
  } catch (err) {
    const parsed = parseImportError(err);
    return {
      ok: false,
      errorMessage: parsed.message,
      missingExport: parsed.missingExport,
      modulePath: parsed.modulePath,
    };
  }
}

const isMain =
  process.argv[1]?.endsWith("check-registry.ts") ||
  process.argv[1]?.endsWith("check-registry.js");

if (isMain) {
  const quiet = process.argv.includes("--quiet");
  if (shouldUseSiteSchemaStub()) {
    if (!quiet) {
      const reason = siteComponentRegistryExists()
        ? "WEBLIFY_SITE_SCHEMAS_STUB is set"
        : "site_4geeks-com/component-registry not found";
      console.log(
        `✓ site schema stub mode (${reason}) — skipping live registry import check`,
      );
    }
    process.exit(0);
  }
  checkRegistryImports()
    .then((result) => {
      if (result.ok) {
        if (!quiet) {
          console.log("✓ shared/schema ↔ site_*/component-registry exports OK");
        }
        process.exit(0);
      }
      console.error(formatRegistryFailure(result));
      process.exit(1);
    })
    .catch((err) => {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    });
}
