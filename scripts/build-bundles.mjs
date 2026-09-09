/**
 * Production esbuild bundles (server, sidequest, MCP, CLI) with optional
 * site-component-schemas → stub plugin.
 */
import * as esbuild from "esbuild";
import path from "path";
import { fileURLToPath } from "url";
import siteSchemaStubPlugin from "./esbuild-site-schema-stub-plugin.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const shared = path.join(root, "shared");

/** Bundle into CLI so npx weblify does not need these on the user's machine. */
const CLI_BUNDLE_PACKAGES = ["@clack/prompts", "picocolors"];

const common = {
  platform: "node",
  packages: "external",
  bundle: true,
  format: "esm",
  absWorkingDir: root,
  alias: {
    "@shared": shared,
  },
  plugins: [siteSchemaStubPlugin],
  logLevel: "info",
};

function cliBundleUiPlugin() {
  return {
    name: "cli-bundle-ui-deps",
    setup(build) {
      build.onResolve({ filter: /.*/ }, (args) => {
        if (args.kind === "entry-point") return null;
        if (CLI_BUNDLE_PACKAGES.some((p) => args.path === p || args.path.startsWith(`${p}/`))) {
          return null; // bundle
        }
        if (
          args.path.startsWith(".") ||
          args.path.startsWith("/") ||
          args.path.startsWith("@shared")
        ) {
          return null;
        }
        return { path: args.path, external: true };
      });
    },
  };
}

function cliBuildOptions() {
  return {
    entryPoints: ["cli/src/index.ts"],
    outfile: "dist/cli.js",
    banner: { js: "#!/usr/bin/env node" },
    packages: undefined,
    plugins: [siteSchemaStubPlugin, cliBundleUiPlugin()],
  };
}

const builds = process.argv.includes("--cli-only")
  ? [cliBuildOptions()]
  : [
      { entryPoints: ["server/index.ts"], outdir: "dist" },
      { entryPoints: ["sidequest.jobs.ts"], outfile: "dist/sidequest.jobs.js" },
      { entryPoints: ["server/jobs/sidequest-worker.ts"], outfile: "dist/sidequest-worker.js" },
      { entryPoints: ["mcp-server/index.ts"], outfile: "dist/mcp-server.js" },
      cliBuildOptions(),
    ];

for (const b of builds) {
  await esbuild.build({ ...common, ...b, plugins: b.plugins ?? common.plugins });
}

console.log("[build] Server / MCP / CLI esbuild bundles done");
