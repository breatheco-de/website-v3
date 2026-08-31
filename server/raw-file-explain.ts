export type RawFileRole =
  | "template_live"
  | "template_variant"
  | "template_common"
  | "entry_live"
  | "entry_variant"
  | "entry_common";

export type RawFileMissingReason =
  | "shared_template"
  | "not_created"
  | "detached_missing"
  | "variant_locale_missing";

export interface RawFileMissing {
  name: string;
  path: string;
  reason: RawFileMissingReason;
  templatePath?: string;
}

export interface RawFileExplainContext {
  contentType: string;
  typeLabel: string;
  folder: string;
  contentRootName: string;
  slug: string;
  isTemplate: boolean;
  isSharedLayout: boolean;
  detached: boolean;
  requestedLocale: string;
  displayedLocale: string | null;
  variantSlug?: string;
  localeFallback: boolean;
  hasLocaleFile: boolean;
  missing: RawFileMissing[];
}

export function localeFromYamlFilename(filename: string): string | null {
  const base = filename.replace(/\.ya?ml$/i, "");
  if (base === "_common" || base === "_common.single" || base === "_common.template") return null;
  const parts = base.split(".");
  const last = parts[parts.length - 1];
  if (/^[a-z]{2}(-[a-z]{2})?$/i.test(last)) return last.toLowerCase();
  return null;
}

export function rawFileRole(opts: {
  isTemplate: boolean;
  isCommon: boolean;
  variantSlug?: string;
}): RawFileRole {
  if (opts.isTemplate) {
    if (opts.isCommon) return "template_common";
    return opts.variantSlug ? "template_variant" : "template_live";
  }
  if (opts.isCommon) return "entry_common";
  return opts.variantSlug ? "entry_variant" : "entry_live";
}

function posixJoin(...parts: string[]): string {
  return parts.filter(Boolean).join("/");
}

export function buildRawFileExplain(args: {
  contentRootName: string;
  folder: string;
  contentType: string;
  typeLabel?: string;
  slug: string;
  isTemplate: boolean;
  isSharedLayout: boolean;
  detached: boolean;
  requestedLocale: string;
  variantSlug?: string;
  localeFallback: boolean;
  displayedLocale: string | null;
  hasLocaleFile: boolean;
}): RawFileExplainContext {
  const typeLabel = args.typeLabel ?? args.contentType;
  const prefix = posixJoin(args.contentRootName, args.folder);
  const missing: RawFileMissing[] = [];
  const requested = args.requestedLocale;

  if (args.isTemplate && args.variantSlug && args.localeFallback) {
    const name = `template.${args.variantSlug}.${requested}.yml`;
    missing.push({
      name,
      path: posixJoin(prefix, name),
      reason: "variant_locale_missing",
    });
  } else if (!args.isTemplate && !args.hasLocaleFile) {
    const name = args.variantSlug
      ? `${args.variantSlug}.${requested}.yml`
      : `${requested}.yml`;
    const filePath = posixJoin(prefix, args.slug, name);
    if (args.variantSlug) {
      missing.push({ name, path: filePath, reason: "variant_locale_missing" });
    } else if (args.isSharedLayout && !args.detached) {
      missing.push({
        name,
        path: filePath,
        reason: "shared_template",
        templatePath: posixJoin(prefix, `template.${requested}.yml`),
      });
    } else if (args.isSharedLayout && args.detached) {
      missing.push({ name, path: filePath, reason: "detached_missing" });
    } else {
      missing.push({ name, path: filePath, reason: "not_created" });
    }
  }

  return {
    contentType: args.contentType,
    typeLabel,
    folder: args.folder,
    contentRootName: args.contentRootName,
    slug: args.slug,
    isTemplate: args.isTemplate,
    isSharedLayout: args.isSharedLayout,
    detached: args.detached,
    requestedLocale: requested,
    displayedLocale: args.displayedLocale,
    variantSlug: args.variantSlug,
    localeFallback: args.localeFallback,
    hasLocaleFile: args.hasLocaleFile,
    missing,
  };
}
