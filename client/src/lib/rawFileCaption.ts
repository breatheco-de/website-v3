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

export interface RawFileCaptionAdvanced {
  label: string;
  text: string;
}

export interface RawFileCaption {
  visible: string;
  advanced: RawFileCaptionAdvanced[];
}

const PANEL_CODE = "client/src/components/editing/RawFileEditorPanel.tsx";
const ROUTE_CODE = "server/routes/components.ts";
const LOADER_CODE = "server/database-single-loader.ts";
const DRAFT_CODE = "server/draft-entry.ts";

function loc(code: string): string {
  return code.toUpperCase();
}

function typePlural(label: string): string {
  return label.endsWith("s") ? label : `${label}s`;
}

function posixJoin(...parts: string[]): string {
  return parts.filter(Boolean).join("/");
}

function prefix(ctx: RawFileExplainContext): string {
  return posixJoin(ctx.contentRootName, ctx.folder);
}

function entrySlug(ctx: RawFileExplainContext): string {
  return ctx.isTemplate ? "{slug}" : ctx.slug;
}

function entryCommonPath(ctx: RawFileExplainContext): string {
  return posixJoin(prefix(ctx), entrySlug(ctx), "_common.yml");
}

function entryLocalePath(ctx: RawFileExplainContext, locale = ctx.requestedLocale): string {
  return posixJoin(prefix(ctx), entrySlug(ctx), `${locale}.yml`);
}

function singleLivePath(ctx: RawFileExplainContext, locale = ctx.requestedLocale): string {
  return posixJoin(prefix(ctx), `template.${locale}.yml`);
}

function withCode(
  items: RawFileCaptionAdvanced[],
  extra?: string,
): RawFileCaptionAdvanced[] {
  const out = [...items];
  if (extra) out.push({ label: "Extra path", text: extra });
  out.push({ label: "Code", text: `${PANEL_CODE}, ${ROUTE_CODE}` });
  return out;
}

export function rawFileCaption(opts: {
  role: RawFileRole;
  path: string;
  fileLocale?: string | null;
  context: RawFileExplainContext;
}): RawFileCaption {
  const { role, path, context: ctx } = opts;
  const fileLocale = (opts.fileLocale || ctx.displayedLocale || ctx.requestedLocale).toLowerCase();
  const type = ctx.typeLabel;
  const requested = ctx.requestedLocale;
  const displayed = ctx.displayedLocale || fileLocale;

  if (role === "template_live") {
    if (fileLocale === "en") {
      return {
        visible:
          `This is the shared live layout for every attached ${type} in ${loc(fileLocale)}. It is not one article. Title, body, and SEO for a post live in that post’s \`_common.yml\`. Saving here changes the shell all attached ${loc(fileLocale)} ${typePlural(type)} use.`,
        advanced: withCode([
          { label: "This file", text: path },
          { label: "Type defaults (no sections)", text: posixJoin(prefix(ctx), "_common.template.yml") },
          { label: "Article fields", text: entryCommonPath(ctx) },
          {
            label: "Non-effect",
            text: `does not change a post’s \`_common.yml\`, other locales (\`template.{other}.yml\`), or template versions (\`template.{variant}.${fileLocale}.yml\`) until you promote`,
          },
        ]),
      };
    }
    return {
      visible:
        `This is the shared live layout for every attached ${type} in ${loc(fileLocale)}. It is not one article. Post fields stay in each article’s \`_common.yml\`. Copy does not auto-sync from English; structure is shared, wording is per locale.`,
      advanced: withCode([
        { label: "This file", text: path },
        { label: "Sibling live template", text: singleLivePath(ctx, "en") },
        { label: "Article fields", text: entryCommonPath(ctx) },
        {
          label: "Non-effect",
          text: "saving this locale does not update `template.en.yml` or any post’s `_common.yml`",
        },
      ]),
    };
  }

  if (role === "template_variant") {
    const variant = ctx.variantSlug || "variant";
    if (ctx.localeFallback) {
      return {
        visible:
          `You opened ${loc(requested)}; this panel is showing ${loc(displayed)} because \`template.${variant}.${requested}.yml\` does not exist. This is still a shared template version (“${variant}”), not an article. Saving it edits the ${loc(displayed)} variant file only.`,
        advanced: withCode([
          { label: "Showing", text: posixJoin(prefix(ctx), `template.${variant}.${displayed}.yml`) },
          { label: "Missing", text: posixJoin(prefix(ctx), `template.${variant}.${requested}.yml`) },
          { label: `Live ${loc(requested)} template`, text: singleLivePath(ctx, requested) },
          {
            label: "Non-effect",
            text: `this fallback does not create the missing ${loc(requested)} file. Saving ${loc(displayed)} does not create or update ${loc(requested)}`,
          },
        ]),
      };
    }
    return {
      visible:
        `This is a shared template version named “${variant}” for ${loc(fileLocale)}. Attached ${typePlural(type)} can be assigned this layout. It is not an article and not the live template visitors see unless this version is allocated traffic.`,
      advanced: withCode([
        { label: "This file", text: path },
        { label: "Live template (default)", text: singleLivePath(ctx, fileLocale) },
        { label: "Article fields", text: entryCommonPath(ctx) },
        {
          label: "Non-effect",
          text: `saving this file does not rename or overwrite live \`template.${fileLocale}.yml\` until you promote. It does not edit any post’s \`_common.yml\``,
        },
      ]),
    };
  }

  if (role === "template_common") {
    return {
      visible:
        "This file is type-level layout defaults (menus and shared chrome). Sections in this file are ignored. The section list lives in `template.en.yml` / `template.es.yml`.",
      advanced: withCode(
        [
          { label: "This file", text: path },
          { label: "Structure", text: singleLivePath(ctx, requested) },
          {
            label: "Non-effect",
            text: "adding `sections` here does not render on the page; the loader drops them",
          },
        ],
        LOADER_CODE,
      ),
    };
  }

  if (role === "entry_live") {
    if (ctx.isSharedLayout && !ctx.detached) {
      return {
        visible:
          `This is a locale overlay on an attached ${type}, not the full page. Heroes, article chrome, and CTAs come from \`template.${fileLocale}.yml\`. Use this file only for per-article section patches. For a wholly different layout, detach the post.`,
        advanced: withCode(
          [
            { label: "This file", text: path },
            { label: "Shared layout", text: singleLivePath(ctx, fileLocale) },
            { label: "Fields", text: entryCommonPath(ctx) },
            {
              label: "Non-effect",
              text: "saving this overlay does not update the shared template or other posts",
            },
          ],
          LOADER_CODE,
        ),
      };
    }
    if (ctx.isSharedLayout && ctx.detached) {
      return {
        visible:
          `This is the live ${loc(fileLocale)} file for this page only: sections and ${loc(fileLocale)} copy. Visitors see this file. \`_common.yml\` (other tab, if present) holds fields shared across locales.`,
        advanced: withCode([
          { label: "This file", text: path },
          { label: "Shared fields", text: entryCommonPath(ctx) },
          {
            label: "Non-effect",
            text: `this page is detached, so saving here does not change \`${type}/template.${fileLocale}.yml\` or other posts`,
          },
        ]),
      };
    }
    return {
      visible:
        `This is the live ${loc(fileLocale)} file for this page: sections and ${loc(fileLocale)} copy. \`_common.yml\` holds fields shared across locales for this page only.`,
      advanced: withCode([
        { label: "This file", text: path },
        { label: "Shared fields", text: entryCommonPath(ctx) },
        {
          label: "Non-effect",
          text: `there is no \`template.${fileLocale}.yml\` for this type. Saving this file does not change other ${typePlural(type)}`,
        },
      ]),
    };
  }

  if (role === "entry_variant") {
    const variant = ctx.variantSlug || "variant";
    return {
      visible:
        `This is version “${variant}” for ${loc(fileLocale)} on this page only. It is not what most visitors see unless this version has traffic. The live file \`${fileLocale}.yml\` is not in this panel.`,
      advanced: withCode([
        { label: "This file", text: path },
        { label: "Live (not open)", text: entryLocalePath(ctx, fileLocale) },
        { label: "Shared fields", text: entryCommonPath(ctx) },
        {
          label: "Non-effect",
          text: `saving this version does not change live \`${fileLocale}.yml\` until you promote`,
        },
      ]),
    };
  }

  // entry_common
  if (ctx.isSharedLayout && !ctx.detached && !ctx.hasLocaleFile) {
    return {
      visible:
        `This is the article’s fields (title, body, SEO) shared across locales. There is no \`${requested}.yml\` on this post — that is normal while it is attached. Layout and sections come from the shared template \`${type}/template.${requested}.yml\`, not from a per-article locale file.`,
      advanced: withCode(
        [
          { label: "This file", text: path },
          {
            label: "Missing on this article",
            text: `${entryLocalePath(ctx, requested)} (expected for attached posts)`,
          },
          { label: "Layout", text: singleLivePath(ctx, requested) },
          {
            label: "Non-effect",
            text: `saving \`_common.yml\` does not change the shared template. Creating \`${requested}.yml\` here would be an overlay; detach if this post needs its own layout`,
          },
        ],
        LOADER_CODE,
      ),
    };
  }

  if (ctx.isSharedLayout && !ctx.detached && ctx.hasLocaleFile) {
    return {
      visible:
        "This is the article’s fields shared across locales. The other tab is a locale overlay on the shared template, not a full standalone page.",
      advanced: withCode(
        [
          { label: "This file", text: path },
          { label: "Overlay", text: entryLocalePath(ctx, requested) },
          { label: "Full layout", text: singleLivePath(ctx, requested) },
          {
            label: "Non-effect",
            text: `saving \`_common.yml\` does not change \`template.${requested}.yml\``,
          },
        ],
        LOADER_CODE,
      ),
    };
  }

  if (ctx.isSharedLayout && ctx.detached && !ctx.hasLocaleFile) {
    return {
      visible:
        `\`${requested}.yml\` is missing on this detached page. Detached entries own their layout, so ${loc(requested)} has no live file and 404s publicly until you add or promote a locale file. This is not “because of the shared template.”`,
      advanced: withCode(
        [
          { label: "This file", text: path },
          { label: "Missing", text: entryLocalePath(ctx, requested) },
          {
            label: "Non-effect",
            text: `the shared template \`template.${requested}.yml\` is not used while detached. Saving \`_common.yml\` does not create \`${requested}.yml\``,
          },
        ],
        DRAFT_CODE,
      ),
    };
  }

  if (ctx.isSharedLayout && ctx.detached && ctx.hasLocaleFile) {
    return {
      visible:
        `This file is fields shared across this page’s locales (slug, dates, shared meta). Sections and locale copy are in the locale tab (\`${requested}.yml\`).`,
      advanced: withCode([
        { label: "This file", text: path },
        { label: "Live locale", text: entryLocalePath(ctx, requested) },
        {
          label: "Non-effect",
          text: "saving `_common.yml` does not add or remove sections in the locale file",
        },
      ]),
    };
  }

  if (!ctx.hasLocaleFile) {
    return {
      visible:
        `There is no \`${requested}.yml\` for this page. The panel only loads the locale you opened plus \`_common.yml\`, so you are seeing shared fields only. Another locale file (e.g. \`en.yml\`) may exist — it is not opened from this row. This page is not on a shared template.`,
      advanced: withCode([
        { label: "This file", text: path },
        { label: "Missing", text: entryLocalePath(ctx, requested) },
        { label: "Sibling (not loaded)", text: entryLocalePath(ctx, "en") },
        {
          label: "Non-effect",
          text: `this is not inherited from a \`template.${requested}.yml\`. Saving \`_common.yml\` does not create \`${requested}.yml\``,
        },
      ]),
    };
  }

  return {
    visible:
      "This file is fields shared across this page’s locales (slug, programs, shared meta). Sections live in the locale tab.",
    advanced: withCode([
      { label: "This file", text: path },
      { label: "Live locale", text: entryLocalePath(ctx, requested) },
      {
        label: "Non-effect",
        text: `saving \`_common.yml\` does not rewrite sections in \`${requested}.yml\``,
      },
    ]),
  };
}
