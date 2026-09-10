/**
 * esbuild plugin: when site registry is absent (or WEBLIFY_SITE_SCHEMAS_STUB=1),
 * redirect site-component-schemas imports to the stub module.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const realSchemas = path.join(packageRoot, "shared", "site-component-schemas.ts");
const stubSchemas = path.join(packageRoot, "shared", "site-component-schemas.stub.ts");

function projectRoot() {
  const override = process.env.WEBLIFY_PROJECT_ROOT?.trim();
  return override ? path.resolve(override) : process.cwd();
}

function shouldUseStub() {
  const flag = process.env.WEBLIFY_SITE_SCHEMAS_STUB?.trim();
  if (flag === "1" || flag?.toLowerCase() === "true") return true;
  if (flag === "0" || flag?.toLowerCase() === "false") return false;
  const registry = path.join(projectRoot(), "site_4geeks-com", "component-registry");
  return !fs.existsSync(registry);
}

function isSiteComponentSchemasImport(importPath, resolveDir) {
  if (importPath.includes("site-component-schemas.stub")) return false;
  if (
    importPath === "@shared/site-component-schemas" ||
    importPath.endsWith("/site-component-schemas") ||
    importPath.endsWith("/site-component-schemas.ts") ||
    importPath === "./site-component-schemas" ||
    importPath === "./site-component-schemas.ts"
  ) {
    return true;
  }
  if (!path.isAbsolute(importPath) && resolveDir) {
    const resolved = path.resolve(resolveDir, importPath);
    const withTs = resolved.endsWith(".ts") ? resolved : `${resolved}.ts`;
    return path.resolve(withTs) === path.resolve(realSchemas);
  }
  if (path.isAbsolute(importPath)) {
    const withTs = importPath.endsWith(".ts") ? importPath : `${importPath}.ts`;
    return path.resolve(withTs) === path.resolve(realSchemas);
  }
  return false;
}

/** @type {import('esbuild').Plugin} */
const siteSchemaStubPlugin = {
  name: "site-schema-stub",
  setup(build) {
    if (!shouldUseStub()) return;
    if (!fs.existsSync(stubSchemas)) {
      throw new Error(`site-component-schemas stub missing: ${stubSchemas}`);
    }
    console.warn(
      "[esbuild] site_4geeks-com registry absent (or WEBLIFY_SITE_SCHEMAS_STUB=1) — aliasing site-component-schemas → stub",
    );
    build.onResolve({ filter: /site-component-schemas/ }, (args) => {
      if (!isSiteComponentSchemasImport(args.path, args.resolveDir)) return null;
      return { path: stubSchemas };
    });
  },
};

export default siteSchemaStubPlugin;
