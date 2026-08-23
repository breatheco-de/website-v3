#!/usr/bin/env npx tsx
/**
 * Schema Sync Script
 * Parses Zod schemas from component registry schema.ts files
 * and generates/updates adjacent schema.yml files while preserving documentation.
 *
 * Usage:
 *   npm run schema:sync [-- --dry-run] [-- --component=hero]
 *   npm run schema:sync:check [-- --component=hero]
 *   npx tsx scripts/schema-sync/sync-schemas.ts [--dry-run] [--check] [--component=hero]
 */

process.env.LOG_LEVEL = process.env.LOG_LEVEL || "silent";

import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";
import {
  ZodObject,
  ZodType,
  ZodOptional,
  ZodDefault,
  ZodArray,
  ZodEnum,
  ZodLiteral,
  ZodUnion,
  ZodDiscriminatedUnion,
  ZodString,
  ZodNumber,
  ZodBoolean,
  ZodRecord,
  ZodTuple,
  ZodEffects,
} from "zod";

interface PropDef {
  type: string;
  required?: boolean;
  description?: string;
  example?: string | string[];
  default?: unknown;
  options?: string[];
  items?: Record<string, PropDef>;
  properties?: Record<string, PropDef>;
}

interface SchemaYml {
  name?: string;
  version?: string;
  component?: string;
  file?: string;
  description?: string;
  when_to_use?: string;
  schema_org?: { handler?: string; description?: string };
  behaviors?: Record<string, unknown>;
  variants?: Record<string, { description?: string; best_for?: string }>;
  props?: Record<string, PropDef>;
  variant_props?: Record<string, Record<string, PropDef>>;
  image_sizes?: Record<string, string>;
  section_defaults?: unknown;
}

export interface DriftIssue {
  site: string;
  component: string;
  version: string;
  path: string;
  message: string;
}

let _siteFolders: string[] | null = null;

async function getSiteFolders(): Promise<string[]> {
  if (!_siteFolders) {
    const { requireSiteConfigs } = await import("../../server/site-config");
    _siteFolders = requireSiteConfigs().map((s) => s.contentFolder);
  }
  return _siteFolders;
}

async function registryPaths(): Promise<Array<{ root: string; label: string }>> {
  const sharedRoot = path.join(process.cwd(), "shared", "component-registry");
  const out: Array<{ root: string; label: string }> = [];
  if (fs.existsSync(sharedRoot)) {
    out.push({ root: sharedRoot, label: "shared" });
  }
  const folders = await getSiteFolders();
  for (const contentFolder of folders) {
    const folder = path.isAbsolute(contentFolder)
      ? contentFolder
      : path.join(process.cwd(), contentFolder);
    const registry = path.join(folder, "component-registry");
    if (fs.existsSync(registry)) {
      out.push({ root: registry, label: path.basename(folder) });
    }
  }
  // Dedupe by absolute path
  const seen = new Set<string>();
  return out.filter((e) => {
    if (seen.has(e.root)) return false;
    seen.add(e.root);
    return true;
  });
}

function unwrapEffects(schema: ZodType): ZodType {
  if (schema instanceof ZodEffects) {
    return unwrapEffects(schema._def.schema);
  }
  return schema;
}

function unwrapOptional(schema: ZodType): ZodType {
  let current = unwrapEffects(schema);
  while (current instanceof ZodOptional || current instanceof ZodDefault) {
    current = unwrapEffects(current._def.innerType);
  }
  return current;
}

function variantLiteralName(field: ZodType | undefined): string | null {
  if (!field) return null;
  const inner = unwrapOptional(field);
  if (inner instanceof ZodLiteral && typeof inner._def.value === "string") {
    return inner._def.value;
  }
  return null;
}

/** When a single SectionSchema uses `variant: z.enum([...])`, those names belong in schema.yml `variants:`. */
function extractEnumVariantNamesFromObject(
  schema: ZodObject<Record<string, ZodType>>,
): string[] {
  const shape = schema._def.shape();
  const field = shape.variant as ZodType | undefined;
  if (!field) return [];
  const inner = unwrapOptional(field);
  if (!(inner instanceof ZodEnum)) return [];
  const values = inner._def.values as string[];
  return values.filter((v) => typeof v === "string").sort();
}

function collectVariantsFromOptions(
  options: ZodType[],
  into: Record<string, ZodObject<Record<string, ZodType>>>,
): void {
  for (const opt of options) {
    collectVariantsFromSchema(opt, into);
  }
}

function collectVariantsFromSchema(
  schema: ZodType,
  into: Record<string, ZodObject<Record<string, ZodType>>>,
): void {
  const unwrapped = unwrapEffects(schema);

  if (unwrapped instanceof ZodDiscriminatedUnion) {
    collectVariantsFromOptions(unwrapped._def.options as ZodType[], into);
    return;
  }

  if (unwrapped instanceof ZodUnion) {
    collectVariantsFromOptions(unwrapped._def.options as ZodType[], into);
    return;
  }

  if (unwrapped instanceof ZodObject) {
    const shape = unwrapped._def.shape();
    const name = variantLiteralName(shape.variant as ZodType | undefined);
    if (name) {
      into[name] = unwrapped as ZodObject<Record<string, ZodType>>;
    }
  }
}

function zodToType(schema: ZodType): {
  type: string;
  optional: boolean;
  items?: Record<string, PropDef>;
  properties?: Record<string, PropDef>;
  options?: string[];
} {
  if (schema instanceof ZodEffects) {
    return zodToType(schema._def.schema);
  }

  if (schema instanceof ZodOptional) {
    const inner = zodToType(schema._def.innerType);
    return { ...inner, optional: true };
  }

  if (schema instanceof ZodString) {
    return { type: "string", optional: false };
  }

  if (schema instanceof ZodNumber) {
    return { type: "number", optional: false };
  }

  if (schema instanceof ZodBoolean) {
    return { type: "boolean", optional: false };
  }

  if (schema instanceof ZodLiteral) {
    return { type: "string", optional: false };
  }

  if (schema instanceof ZodEnum) {
    return { type: "string", optional: false, options: schema._def.values };
  }

  if (schema instanceof ZodArray) {
    const itemType = zodToType(schema._def.type);
    if (itemType.type === "object" && itemType.properties) {
      return { type: "array", optional: false, items: itemType.properties };
    }
    return {
      type: "array",
      optional: false,
      items: {
        type: {
          type: itemType.type,
          required: true,
          ...(itemType.options && { options: itemType.options }),
        },
      },
    };
  }

  if (schema instanceof ZodObject) {
    const shape = schema._def.shape();
    const properties: Record<string, PropDef> = {};

    for (const [key, value] of Object.entries(shape)) {
      const propInfo = zodToType(value as ZodType);
      properties[key] = {
        type: propInfo.type,
        required: !propInfo.optional,
        ...(propInfo.options && { options: propInfo.options }),
        ...(propInfo.properties && { properties: propInfo.properties }),
        ...(propInfo.items && { items: propInfo.items }),
      };
    }

    return { type: "object", optional: false, properties };
  }

  if (schema instanceof ZodUnion || schema instanceof ZodDiscriminatedUnion) {
    const options = schema._def.options as ZodType[];
    if (options.every((o: ZodType) => unwrapEffects(o) instanceof ZodLiteral)) {
      return {
        type: "string",
        optional: false,
        options: options.map(
          (o: ZodType) => (unwrapEffects(o) as ZodLiteral<string>)._def.value,
        ),
      };
    }
    return { type: "string", optional: false };
  }

  if (schema instanceof ZodRecord) {
    return { type: "object", optional: false };
  }

  if (schema instanceof ZodTuple) {
    return { type: "array", optional: false };
  }

  return { type: "string", optional: false };
}

function extractProps(schema: ZodObject<Record<string, ZodType>>): Record<string, PropDef> {
  const shape = schema._def.shape();
  const props: Record<string, PropDef> = {};

  for (const [key, value] of Object.entries(shape)) {
    if (key === "type" || key === "version") continue;

    const propInfo = zodToType(value as ZodType);
    props[key] = {
      type: propInfo.type,
      required: !propInfo.optional,
      ...(propInfo.options && { options: propInfo.options }),
      ...(propInfo.properties && { properties: propInfo.properties }),
      ...(propInfo.items && { items: propInfo.items }),
    };
  }

  return props;
}

function mergeProps(
  newProps: Record<string, PropDef>,
  existingProps?: Record<string, PropDef>,
): Record<string, PropDef> {
  if (!existingProps) return newProps;

  const merged: Record<string, PropDef> = {};

  for (const [key, newProp] of Object.entries(newProps)) {
    const existing = existingProps[key];
    merged[key] = {
      ...newProp,
      ...(existing?.description && { description: existing.description }),
      ...(existing?.example && { example: existing.example }),
      ...(newProp.properties &&
        existing?.properties && {
          properties: mergeProps(newProp.properties, existing.properties),
        }),
      ...(newProp.items &&
        existing?.items && {
          items: mergeProps(newProp.items, existing.items),
        }),
    };
  }

  return merged;
}

function loadExistingSchema(schemaPath: string): SchemaYml | null {
  if (!fs.existsSync(schemaPath)) return null;

  try {
    const content = fs.readFileSync(schemaPath, "utf-8");
    return yaml.load(content) as SchemaYml;
  } catch {
    console.warn(`  Warning: Could not parse existing ${schemaPath}`);
    return null;
  }
}

async function loadVariantSchemasFromModule(schemaTs: string): Promise<{
  mainSchema: ZodObject<Record<string, ZodType>> | null;
  variantSchemas: Record<string, ZodObject<Record<string, ZodType>>>;
}> {
  const modulePath = path.resolve(schemaTs);
  const module = await import(modulePath);

  let mainSchema: ZodObject<Record<string, ZodType>> | null = null;
  const variantSchemas: Record<string, ZodObject<Record<string, ZodType>>> = {};

  for (const [exportName, exportValue] of Object.entries(module)) {
    if (!exportValue || typeof exportValue !== "object") continue;
    if (!("_def" in (exportValue as object))) continue;

    const schema = exportValue as ZodType;
    const unwrapped = unwrapEffects(schema);

    if (
      unwrapped instanceof ZodUnion ||
      unwrapped instanceof ZodDiscriminatedUnion
    ) {
      collectVariantsFromSchema(unwrapped, variantSchemas);
      continue;
    }

    if (unwrapped instanceof ZodObject) {
      const shape = unwrapped._def.shape();
      const name = variantLiteralName(shape.variant as ZodType | undefined);
      if (name) {
        variantSchemas[name] = unwrapped as ZodObject<Record<string, ZodType>>;
      }

      if (exportName.endsWith("SectionSchema") && !mainSchema) {
        mainSchema = unwrapped as ZodObject<Record<string, ZodType>>;
      }
    }
  }

  return { mainSchema, variantSchemas };
}

export async function extractZodVariantNames(schemaTs: string): Promise<string[]> {
  const { mainSchema, variantSchemas } = await loadVariantSchemasFromModule(schemaTs);
  const fromLiterals = Object.keys(variantSchemas);
  if (fromLiterals.length > 0) return fromLiterals.sort();
  if (mainSchema) return extractEnumVariantNamesFromObject(mainSchema);
  return [];
}

function ymlVariantKeys(schemaYml: SchemaYml | null): string[] {
  if (!schemaYml?.variants || typeof schemaYml.variants !== "object") return [];
  return Object.keys(schemaYml.variants).sort();
}

async function processComponent(
  componentPath: string,
  dryRun: boolean,
  siteLabel: string,
): Promise<boolean> {
  const schemaTs = path.join(componentPath, "schema.ts");
  const schemaYml = path.join(componentPath, "schema.yml");
  const componentName = path.basename(path.dirname(componentPath));
  const version = path.basename(componentPath);

  if (!fs.existsSync(schemaTs)) {
    return false;
  }

  console.log(`\nProcessing ${siteLabel}/${componentName}/${version}...`);

  try {
    const { mainSchema, variantSchemas } = await loadVariantSchemasFromModule(schemaTs);

    if (!mainSchema && Object.keys(variantSchemas).length === 0) {
      console.log(`  Skipping: No section schema found`);
      return false;
    }

    const existing = loadExistingSchema(schemaYml);

    const newSchema: SchemaYml = {
      name:
        existing?.name ||
        `${componentName.charAt(0).toUpperCase() + componentName.slice(1).replace(/_/g, " ")} Section`,
      version: existing?.version || version.replace("v", ""),
      component:
        existing?.component ||
        componentName.charAt(0).toUpperCase() +
          componentName.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase()),
      file:
        existing?.file ||
        `client/src/components/${componentName}/${
          componentName.charAt(0).toUpperCase() +
          componentName.slice(1).replace(/_([a-z])/g, (_, c) => c.toUpperCase())
        }.tsx`,
      description: existing?.description || "",
      when_to_use: existing?.when_to_use || "",
      ...(existing?.schema_org ? { schema_org: existing.schema_org } : {}),
      ...(existing?.behaviors ? { behaviors: existing.behaviors } : {}),
      ...(existing?.image_sizes ? { image_sizes: existing.image_sizes } : {}),
      ...(existing?.section_defaults !== undefined
        ? { section_defaults: existing.section_defaults }
        : {}),
    };

    if (Object.keys(variantSchemas).length > 0) {
      newSchema.variants = {};
      newSchema.variant_props = {};

      const firstVariant = Object.values(variantSchemas)[0];
      const commonProps = extractProps(firstVariant);

      const allVariantProps = Object.values(variantSchemas).map((v) => extractProps(v));
      const commonKeys = Object.keys(commonProps).filter((key) => {
        if (key === "variant") return false;
        return allVariantProps.every((vp) => vp[key]?.type === commonProps[key]?.type);
      });

      newSchema.props = mergeProps(
        Object.fromEntries(commonKeys.map((k) => [k, commonProps[k]])),
        existing?.props,
      );

      for (const [variantName, variantSchema] of Object.entries(variantSchemas)) {
        const variantProps = extractProps(variantSchema);
        const specificProps = Object.fromEntries(
          Object.entries(variantProps).filter(
            ([k]) => !commonKeys.includes(k) && k !== "variant",
          ),
        );

        newSchema.variant_props[variantName] = mergeProps(
          specificProps,
          existing?.variant_props?.[variantName],
        );

        newSchema.variants![variantName] = existing?.variants?.[variantName] || {};
      }
    } else if (mainSchema) {
      newSchema.props = mergeProps(extractProps(mainSchema), existing?.props);
      // Single-schema components with `variant: z.enum([...])` still need a variants map
      // so section-variants validation / MCP get_component_schema see real names (not only "default").
      const enumVariants = extractEnumVariantNamesFromObject(mainSchema);
      if (enumVariants.length > 0) {
        newSchema.variants = {};
        for (const variantName of enumVariants) {
          newSchema.variants[variantName] = existing?.variants?.[variantName] || {};
        }
      } else if (existing?.variants && typeof existing.variants === "object") {
        newSchema.variants = existing.variants;
      }
    }

    const yamlContent = yaml.dump(newSchema, {
      indent: 2,
      lineWidth: 120,
      noRefs: true,
      sortKeys: false,
      quotingType: '"',
    });

    if (dryRun) {
      console.log(`  Would update ${schemaYml}`);
      console.log("  Preview (first 50 lines):");
      console.log(
        yamlContent
          .split("\n")
          .slice(0, 50)
          .map((l) => "    " + l)
          .join("\n"),
      );
    } else {
      fs.writeFileSync(schemaYml, yamlContent);
      console.log(`  Updated ${schemaYml}`);
    }

    return true;
  } catch (error) {
    console.error(`  Error processing ${componentPath}:`, error);
    return false;
  }
}

async function checkComponent(
  componentPath: string,
  siteLabel: string,
): Promise<DriftIssue | null> {
  const schemaTs = path.join(componentPath, "schema.ts");
  const schemaYmlPath = path.join(componentPath, "schema.yml");
  const componentName = path.basename(path.dirname(componentPath));
  const version = path.basename(componentPath);
  const rel = path.relative(process.cwd(), componentPath);

  if (!fs.existsSync(schemaTs)) return null;

  try {
    const { mainSchema, variantSchemas } = await loadVariantSchemasFromModule(schemaTs);
    let zodVariants = Object.keys(variantSchemas).sort();
    if (zodVariants.length === 0 && mainSchema) {
      zodVariants = extractEnumVariantNamesFromObject(mainSchema);
    }
    const syncable = !!mainSchema || zodVariants.length > 0;

    // schema.ts with no extractable section/variant schemas cannot be healed by sync — skip.
    if (!syncable) return null;

    const existing = loadExistingSchema(schemaYmlPath);

    if (!existing) {
      return {
        site: siteLabel,
        component: componentName,
        version,
        path: rel,
        message: `schema.ts exists but schema.yml is missing`,
      };
    }

    if (zodVariants.length === 0) {
      return null;
    }

    const ymlKeys = ymlVariantKeys(existing);
    const missing = zodVariants.filter((v) => !ymlKeys.includes(v));
    if (missing.length > 0 || ymlKeys.length === 0) {
      return {
        site: siteLabel,
        component: componentName,
        version,
        path: rel,
        message:
          ymlKeys.length === 0
            ? `schema.yml has no variants; Zod has: ${zodVariants.join(", ")}`
            : `schema.yml missing variants: ${missing.join(", ")} (Zod: ${zodVariants.join(", ")}; yml: ${ymlKeys.join(", ") || "(none)"})`,
      };
    }

    return null;
  } catch (error) {
    return {
      site: siteLabel,
      component: componentName,
      version,
      path: rel,
      message: `Failed to inspect schemas: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

function listVersionDirs(
  registryPath: string,
  componentFilter?: string,
): Array<{ componentDir: string; versionDir: string; name: string }> {
  const out: Array<{ componentDir: string; versionDir: string; name: string }> = [];
  if (!fs.existsSync(registryPath)) return out;

  const components = fs
    .readdirSync(registryPath, { withFileTypes: true })
    .filter((d) => d.isDirectory() && !d.name.startsWith("_") && d.name !== "common")
    .filter((d) => !componentFilter || d.name === componentFilter);

  for (const component of components) {
    const componentDir = path.join(registryPath, component.name);
    const versions = fs
      .readdirSync(componentDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^v\d/.test(d.name));

    for (const version of versions) {
      out.push({
        componentDir,
        versionDir: path.join(componentDir, version.name),
        name: component.name,
      });
    }
  }
  return out;
}

async function runCheck(componentFilter?: string): Promise<DriftIssue[]> {
  const issues: DriftIssue[] = [];
  const registries = await registryPaths();

  if (registries.length === 0) {
    console.error("No component-registry folders found (shared/ or sites.yml)");
    process.exit(1);
  }

  // Collision: same type in shared and any site
  try {
    const { assertNoRegistryCollisionsForAllSites } = await import("../../shared/registry-resolve");
    const { requireSiteConfigs } = await import("../../server/site-config");
    assertNoRegistryCollisionsForAllSites(
      requireSiteConfigs().map((s) => ({
        contentFolder: s.contentFolder,
        inheritComponentsFrom: s.inheritComponentsFrom,
      })),
    );
  } catch (err) {
    issues.push({
      site: "shared∩site",
      component: "*",
      version: "-",
      path: "shared/component-registry + site_*/component-registry",
      message: err instanceof Error ? err.message : String(err),
    });
  }

  for (const { root, label } of registries) {
    for (const entry of listVersionDirs(root, componentFilter)) {
      const issue = await checkComponent(entry.versionDir, label);
      if (issue) issues.push(issue);
    }
  }

  return issues;
}

async function runSync(
  dryRun: boolean,
  componentFilter?: string,
): Promise<{ processed: number; updated: number }> {
  const registries = await registryPaths();
  if (registries.length === 0) {
    console.error("No component-registry folders found (shared/ or sites.yml)");
    process.exit(1);
  }

  let processed = 0;
  let updated = 0;

  for (const { root, label } of registries) {
    for (const entry of listVersionDirs(root, componentFilter)) {
      processed++;
      if (await processComponent(entry.versionDir, dryRun, label)) {
        updated++;
      }
    }
  }

  return { processed, updated };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const checkOnly = args.includes("--check");
  const componentFilter = args.find((a) => a.startsWith("--component="))?.split("=")[1];

  console.log("Schema Sync Tool");
  console.log("================");
  console.log(`Mode: ${checkOnly ? "CHECK" : dryRun ? "DRY RUN" : "UPDATE"}`);
  if (componentFilter) console.log(`Filter: ${componentFilter}`);

  if (checkOnly) {
    const issues = await runCheck(componentFilter);
    if (issues.length === 0) {
      console.log("\n✓ No schema.yml drift detected");
      process.exit(0);
    }
    console.error(`\n✗ Found ${issues.length} schema.yml drift issue(s):\n`);
    for (const issue of issues) {
      console.error(`  - ${issue.site}/${issue.component}/${issue.version}: ${issue.message}`);
      console.error(`    path: ${issue.path}`);
    }
    console.error("\nFix with: npm run schema:sync");
    console.error("Or:       npm run ensure:schema-yml");
    process.exit(1);
  }

  const { processed, updated } = await runSync(dryRun, componentFilter);
  console.log(`\nDone! Processed ${processed} components, updated ${updated}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
