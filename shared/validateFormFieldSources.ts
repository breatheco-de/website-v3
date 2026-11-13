/**
 * Validate lead-form fields.*.source (relation vs catalog) against entry + CT editor.
 * Soft for drafts; hard for publish/live.
 */

import { parseFormFieldSourceStrict } from "./parseFormFieldSource";
import {
  resolveFormFieldRelationSource,
  type FormFieldOption,
} from "./resolveFormFieldRelationSource";
import type { RelationEditorHint } from "./relation-field";

export type FormFieldSourceIssue = {
  severity: "error" | "warning";
  code:
    | "source_invalid"
    | "relation_and_slugs"
    | "relation_missing_field"
    | "relation_not_relation"
    | "relation_empty"
    | "relation_broken_pointer"
    | "relation_invalid_shape";
  /** e.g. fields.program.source.related_field */
  formPath: string;
  /** CT field name when relation */
  relationField?: string;
  message: string;
  staffMessage: string;
  sectionIndex?: number;
  formFieldName?: string;
};

export type ValidateFormFieldSourcesOptions = {
  /** Merged entry bag (singleEntry / pageData root fields) */
  singleEntry: Record<string, unknown>;
  /** content-types.yml editor map */
  editor?: Record<string, { type?: string } & RelationEditorHint> | null;
  /**
   * Sections to scan. Each may be a lead_form (fields at root) or contain nested forms.
   * When `formObjects` is provided, sections are ignored.
   */
  sections?: unknown[];
  /**
   * Explicit form objects to validate (already located). Prefer when caller resolved form-settings paths.
   */
  formObjects?: Array<{ form: Record<string, unknown>; sectionIndex?: number; formPathPrefix?: string }>;
  /** Optional catalog maps keyed by relation field → pointer → {label, bc_slug} */
  catalogsByRelationField?: Map<
    string,
    Map<string, { label?: string; bc_slug?: string }>
  >;
  /** draft = warnings for empty/broken; publish = errors */
  mode: "draft" | "publish";
};

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/** Collect form objects that look like lead forms (have fields object). */
function collectFormsFromSections(
  sections: unknown[],
): Array<{ form: Record<string, unknown>; sectionIndex: number }> {
  const out: Array<{ form: Record<string, unknown>; sectionIndex: number }> = [];

  const visit = (node: unknown, sectionIndex: number) => {
    if (!isPlainObject(node)) return;
    if (isPlainObject(node.fields)) {
      out.push({ form: node, sectionIndex });
    }
    for (const v of Object.values(node)) {
      if (isPlainObject(v) && isPlainObject(v.fields)) {
        out.push({ form: v, sectionIndex });
      } else if (Array.isArray(v)) {
        for (const item of v) visit(item, sectionIndex);
      } else if (isPlainObject(v)) {
        // Nested one level (e.g. productShowcase.form)
        if (isPlainObject(v.fields)) {
          out.push({ form: v, sectionIndex });
        } else if (isPlainObject(v.form) && isPlainObject(v.form.fields)) {
          out.push({ form: v.form, sectionIndex });
        }
      }
    }
  };

  sections.forEach((sec, i) => visit(sec, i));
  return out;
}

function validateOneFormField(
  formFieldName: string,
  fieldCfg: Record<string, unknown>,
  opts: ValidateFormFieldSourcesOptions,
  sectionIndex?: number,
): FormFieldSourceIssue[] {
  const issues: FormFieldSourceIssue[] = [];
  if (fieldCfg.source === undefined || fieldCfg.source === null) return issues;

  const formPath = `fields.${formFieldName}.source`;
  const parsed = parseFormFieldSourceStrict(
    fieldCfg.source as string | { content_type?: string; database?: string; related_field?: string },
  );
  if (!parsed.ok) {
    issues.push({
      severity: "error",
      code: "source_invalid",
      formPath,
      formFieldName,
      sectionIndex,
      message: `${formPath}: ${parsed.error}`,
      staffMessage: `The form field "${formFieldName}" has an invalid source setting. Use exactly one of content_type, database, or related_field — not more than one — plus value_path and label_path.`,
    });
    return issues;
  }

  const { config } = parsed;
  const listKey = formFieldName === "location" ? "allowed" : "slugs";
  const listValue = fieldCfg[listKey];
  const hasSlugs =
    Array.isArray(listValue) &&
    listValue.some((s) => typeof s === "string" && s.trim().length > 0);

  if (config.related_field && hasSlugs) {
    issues.push({
      severity: "error",
      code: "relation_and_slugs",
      formPath: `${formPath}.related_field`,
      relationField: config.related_field,
      formFieldName,
      sectionIndex,
      message: `${formPath}.related_field: "${config.related_field}" cannot be combined with fields.${formFieldName}.${listKey} — put allowed entries on the content field "${config.related_field}" instead`,
      staffMessage: `Remove the "${listKey}" list from form field "${formFieldName}". Allowed options should live on the entry field "${config.related_field}" (usually in _common.yml).`,
    });
  }

  if (!config.related_field) {
    // Catalog source: empty options do not fail publish
    return issues;
  }

  const relationPath = `${formPath}.related_field`;
  const catalog = opts.catalogsByRelationField?.get(config.related_field);
  const resolved = resolveFormFieldRelationSource({
    formFieldName,
    relationField: config.related_field,
    singleEntry: opts.singleEntry,
    editorHint: opts.editor?.[config.related_field],
    catalogByPointer: catalog,
    requireCatalogHit: !!catalog && catalog.size > 0,
    valuePath: config.value_path,
    labelPath: config.label_path,
  });

  if (resolved.ok) return issues;
  // An empty page field falls through to detection or "missing" (form-location gate decides).
  if (formFieldName === "location" && resolved.code === "empty") return issues;

  const soft =
    opts.mode === "draft" &&
    (resolved.code === "empty" ||
      resolved.code === "broken_pointer" ||
      resolved.code === "invalid_shape");

  const codeMap: Record<typeof resolved.code, FormFieldSourceIssue["code"]> = {
    missing_hint: "relation_missing_field",
    not_relation: "relation_not_relation",
    empty: "relation_empty",
    invalid_shape: "relation_invalid_shape",
    broken_pointer: "relation_broken_pointer",
  };

  // Missing/wrong CT field type always hard-fail (config bug)
  const alwaysHard =
    resolved.code === "missing_hint" || resolved.code === "not_relation";

  issues.push({
    severity: soft && !alwaysHard ? "warning" : "error",
    code: codeMap[resolved.code],
    formPath: relationPath,
    relationField: config.related_field,
    formFieldName,
    sectionIndex,
    message: resolved.error,
    staffMessage: resolved.staffMessage,
  });

  return issues;
}

/**
 * Validate all form choice sources on an entry document.
 */
export function validateFormFieldSources(
  opts: ValidateFormFieldSourcesOptions,
): FormFieldSourceIssue[] {
  const forms =
    opts.formObjects ??
    (opts.sections ? collectFormsFromSections(opts.sections) : []);

  const issues: FormFieldSourceIssue[] = [];
  for (const { form, sectionIndex, formPathPrefix } of forms) {
    const fields = form.fields;
    if (!isPlainObject(fields)) continue;
    for (const [fieldName, cfg] of Object.entries(fields)) {
      if (!isPlainObject(cfg)) continue;
      const fieldIssues = validateOneFormField(fieldName, cfg, opts, sectionIndex);
      if (formPathPrefix) {
        for (const issue of fieldIssues) {
          issue.formPath = `${formPathPrefix}.${issue.formPath}`;
        }
      }
      issues.push(...fieldIssues);
    }
  }
  return issues;
}

/** Hard errors only (for live gate / publish). */
export function formatFormFieldSourceErrors(
  issues: FormFieldSourceIssue[],
): string | null {
  const errors = issues.filter((i) => i.severity === "error");
  if (!errors.length) return null;
  return errors.map((e) => e.staffMessage || e.message).join(" ");
}

/** MCP next_actions hints from issues. */
export function formFieldSourceNextActions(
  issues: FormFieldSourceIssue[],
  ctx: { contentType: string; slug: string; site?: string },
): Array<{
  tool: string;
  reason: string;
  args_hint: Record<string, unknown>;
  priority: "recommended" | "optional";
}> {
  const actions: Array<{
    tool: string;
    reason: string;
    args_hint: Record<string, unknown>;
    priority: "recommended" | "optional";
  }> = [];
  const seen = new Set<string>();
  for (const issue of issues) {
    if (!issue.relationField) continue;
    const key = issue.relationField;
    if (seen.has(key)) continue;
    seen.add(key);
    actions.push({
      tool: "get_entry_fields",
      reason: `Inspect entry field "${issue.relationField}" (form path ${issue.formPath})`,
      args_hint: {
        contentType: ctx.contentType,
        slug: ctx.slug,
        site: ctx.site,
        fields: [issue.relationField],
      },
      priority: "recommended",
    });
    actions.push({
      tool: "update_fields",
      reason: `Set valid pointer slug(s) on "${issue.relationField}" (_common.yml for static types)`,
      args_hint: {
        contentType: ctx.contentType,
        slug: ctx.slug,
        fields: { [issue.relationField]: ["<related-slug>"] },
        site: ctx.site,
      },
      priority: "recommended",
    });
    actions.push({
      tool: "get_content_type_info",
      reason: `Confirm editor.${issue.relationField} is type relation`,
      args_hint: { contentType: ctx.contentType, site: ctx.site },
      priority: "optional",
    });
  }
  return actions;
}

/** Runtime helper: options already resolved — unused export for tests. */
export type { FormFieldOption };
