/**
 * Validates editor.required fields are non-empty (and JSON-schema-valid) on live content entries.
 * Also errors when a content type marks fields required without a valid fill_intent.
 */

import type { Validator, ValidatorResult, ValidationContext, ValidationIssue } from "../shared/types";
import { getContentTypeConfig, getAllConfigs } from "../../../server/content-types";
import {
  listRequiredEditorFields,
  satisfyRequiredEditorField,
  effectiveRequiredMode,
  buildRequiredFieldSuggestion,
  type EditorRequiredHint,
} from "../../../shared/validateRequiredFields";
import {
  listRequiredFieldsMissingFillIntent,
  listNonPresetFillIntentGoals,
} from "../../../shared/fillIntent";
import { isVariantLayerFile } from "../shared/draftFiles";
import {
  isEntryDetached,
  isSharedLayoutType,
} from "../../../server/shared-layout-entry";
import { getTrackingSettings } from "../../../server/settings";

function trackingOpts(contentRoot?: string): {
  conversionNames: string[];
  crmTags: string[];
} {
  try {
    const tracking = getTrackingSettings(contentRoot);
    const conversionNames = (tracking.conversion_events || [])
      .map((e) => (typeof e === "string" ? e : (e as { name?: string })?.name))
      .filter((n): n is string => typeof n === "string" && n.trim().length > 0);
    const crmTags = Array.isArray(tracking.leads_expected_tags)
      ? tracking.leads_expected_tags.filter((t): t is string => typeof t === "string")
      : [];
    return { conversionNames, crmTags };
  } catch {
    return { conversionNames: [], crmTags: [] };
  }
}

function emitTypeLevelFillIntentIssues(
  contentRoot: string | undefined,
  errors: ValidationIssue[],
  warnings: ValidationIssue[],
): void {
  const configs = getAllConfigs(contentRoot);
  for (const [contentType, config] of Object.entries(configs)) {
    const editor = (config.editor || {}) as Record<
      string,
      { required?: unknown; fill_intent?: unknown }
    >;
    const gaps = listRequiredFieldsMissingFillIntent(editor);
    for (const gap of gaps) {
      errors.push({
        type: "error",
        code: "REQUIRED_FIELD_MISSING_FILL_INTENT",
        message:
          `Content type "${contentType}" field "${gap.field}" has editor.required but ` +
          `${gap.reason === "missing" ? "no fill_intent" : "an invalid fill_intent"} ` +
          `(need non-empty goal + purpose).`,
        file: `${contentRoot || "site"}/content-types.yml`,
        suggestion:
          `Add editor.${gap.field}.fill_intent with goal (open string; presets optional) and purpose. ` +
          `Fields UI → field settings, or edit content-types.yml.`,
      });
    }
    for (const { field, goal } of listNonPresetFillIntentGoals(editor)) {
      warnings.push({
        type: "warning",
        code: "FILL_INTENT_GOAL_NOT_PRESET",
        message:
          `Content type "${contentType}" field "${field}" fill_intent.goal "${goal}" ` +
          `is outside the suggested preset list (custom goals are allowed).`,
        file: `${contentRoot || "site"}/content-types.yml`,
        suggestion:
          `Keep the custom goal if intentional, or pick a preset (geo_llm, conversion, seo, editorial, structural, compliance, other).`,
      });
    }
  }
}

export const requiredFieldsValidator: Validator = {
  name: "required-fields",
  description:
    "Validates editor.required fields (true | attached) are satisfied on live entries, and that required fields declare fill_intent",
  apiExposed: true,
  estimatedDuration: "fast",
  category: "content",

  async run(context: ValidationContext): Promise<ValidatorResult> {
    const startTime = Date.now();
    const errors: ValidationIssue[] = [];
    const warnings: ValidationIssue[] = [];
    const semantics = trackingOpts(context.contentRoot);

    emitTypeLevelFillIntentIssues(context.contentRoot, errors, warnings);

    for (const file of context.contentFiles) {
      if (isVariantLayerFile(file.filePath)) continue;
      const contentType = file.type;
      if (!contentType) continue;

      const config = getContentTypeConfig(contentType, context.contentRoot);
      const editor = (config?.editor || {}) as Record<string, EditorRequiredHint>;
      const shared = isSharedLayoutType(contentType, context.contentRoot);
      const detached = isEntryDetached(contentType, file.slug, context.contentRoot);
      const requiredOpts = { isSharedLayout: shared, isDetached: detached };
      const requiredKeys = listRequiredEditorFields(editor, requiredOpts);
      if (requiredKeys.length === 0) continue;

      const data = (file.entryFields || {
        title: file.title,
        description: file.description,
        slug: file.slug,
      }) as Record<string, unknown>;

      const entryLabel = `${contentType}/${file.slug}/${file.locale}`;

      for (const key of requiredKeys) {
        const hint = editor[key];
        const mode = effectiveRequiredMode(hint, requiredOpts);
        if (!mode) continue;
        const fieldErrors = satisfyRequiredEditorField(
          key,
          data[key],
          hint,
          mode,
          { ...requiredOpts, ...semantics },
        );
        for (const fe of fieldErrors) {
          const code =
            mode === "attached"
              ? "REQUIRED_ATTACHED_FIELD_EMPTY"
              : "REQUIRED_FIELD_EMPTY";
          const suggestion = buildRequiredFieldSuggestion({
            fieldPath: fe.field,
            mode,
            hint,
          });
          errors.push({
            type: "error",
            code,
            message:
              mode === "attached"
                ? `Required field "${fe.field}" is missing or invalid on live entry ${entryLabel} (editor.required: attached — enforced because this entry is attached to the shared layout). ${fe.message}`
                : `Required field "${fe.field}" is missing or invalid on live entry ${entryLabel} (editor.required: true). ${fe.message}`,
            file: file.filePath,
            suggestion,
          });
        }
      }
    }

    const duration = Date.now() - startTime;
    return {
      name: this.name,
      description: this.description,
      status: errors.length > 0 ? "failed" : "passed",
      errors,
      warnings,
      duration,
      artifacts: {
        emptyRequired: errors.filter(
          (e) =>
            e.code === "REQUIRED_FIELD_EMPTY" ||
            e.code === "REQUIRED_ATTACHED_FIELD_EMPTY",
        ).length,
        missingFillIntent: errors.filter(
          (e) => e.code === "REQUIRED_FIELD_MISSING_FILL_INTENT",
        ).length,
      },
    };
  },
};
