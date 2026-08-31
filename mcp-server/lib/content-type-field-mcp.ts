/**
 * MCP handler helpers for update_content_type field patches.
 */
import path from "path";
import { loadContentTypes } from "./content.js";
import {
  actionRequired,
  fail,
  ok,
  type McpSideEffect,
  type McpWarning,
  type NextAction,
} from "./respond.js";
import type { ContentTypeEditorHint } from "../../server/content-types.js";
import {
  prepareFieldPatch,
  buildFieldPatchWarnings,
  type FieldPatchValidationContext,
} from "./content-type-field-validate.js";
import {
  mappingEntrySource,
  type FieldAction,
  type FieldMappingEntry,
  type ContentTypeConfigSlice,
} from "./content-type-field-patch.js";

export type FieldPatchToolInput = {
  contentType: string;
  field_action: FieldAction;
  field_key: string;
  field_mapping?: FieldMappingEntry;
  editor?: ContentTypeEditorHint;
  confirm?: boolean;
  site?: string;
  domain?: string;
  contentPath: string;
  mcpToken?: string;
  mainServerPort: string;
  internalHeaders: (token?: string) => Record<string, string>;
};

export async function fetchContentTypeConfigSlice(
  contentType: string,
  domain: string | undefined,
  mainServerPort: string,
  internalHeaders: (token?: string) => Record<string, string>,
  mcpToken?: string,
): Promise<
  | { ok: true; config: ContentTypeConfigSlice }
  | { ok: false; message: string; status?: number }
> {
  const q = domain ? `?__site=${encodeURIComponent(domain)}` : "";
  const res = await fetch(
    `http://localhost:${mainServerPort}/api/content-types/${encodeURIComponent(contentType)}/config${q}`,
    { headers: internalHeaders(mcpToken) },
  );
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return {
      ok: false,
      message: String(data.error ?? `config fetch failed (${res.status})`),
      status: res.status,
    };
  }
  return {
    ok: true,
    config: {
      field_mapping: (data.field_mapping as ContentTypeConfigSlice["field_mapping"]) ?? {},
      editor: (data.editor as ContentTypeConfigSlice["editor"]) ?? {},
      indexes: (data.indexes as string[] | null) ?? undefined,
      unique_fields: (data.unique_fields as string[] | null) ?? undefined,
      strategy: data.strategy,
      database: (data.database as ContentTypeConfigSlice["database"]) ?? undefined,
    },
  };
}

export async function fetchDatabaseNameList(
  domain: string | undefined,
  mainServerPort: string,
  internalHeaders: (token?: string) => Record<string, string>,
  mcpToken?: string,
): Promise<string[]> {
  const q = domain ? `?__site=${encodeURIComponent(domain)}` : "";
  try {
    const res = await fetch(`http://localhost:${mainServerPort}/api/databases${q}`, {
      headers: internalHeaders(mcpToken),
    });
    const data = (await res.json()) as Array<{ name?: string }> | { error?: string };
    if (!res.ok || !Array.isArray(data)) return [];
    return data.map((row) => String(row.name ?? "")).filter(Boolean);
  } catch {
    return [];
  }
}

function buildValidationContext(
  contentPath: string,
  contentType: string,
  databaseNames: string[],
): FieldPatchValidationContext {
  const configs = loadContentTypes(contentPath);
  return {
    contentType,
    contentTypeNames: Object.keys(configs),
    databaseNames,
  };
}

function fieldPatchNextActions(
  input: FieldPatchToolInput,
  isDbBacked: boolean,
  isNewField?: boolean,
): NextAction[] {
  const siteHint = input.site ? { site: input.site } : {};
  const actions: NextAction[] = [
    {
      tool: "update_content_type",
      reason: "Re-call with confirm: true to execute after principal approval",
      args_hint: {
        contentType: input.contentType,
        field_action: input.field_action,
        field_key: input.field_key,
        ...(input.field_mapping !== undefined ? { field_mapping: input.field_mapping } : {}),
        ...(input.editor !== undefined ? { editor: input.editor } : {}),
        confirm: true,
        ...siteHint,
      },
      priority: "required",
    },
  ];

  if (input.field_action === "add" && isNewField !== false) {
    if (!isDbBacked) {
      actions.push({
        tool: "update_fields",
        reason: "Populate the new field on entries (static YAML types)",
        args_hint: { contentType: input.contentType, ...siteHint },
        priority: "optional",
      });
    }
  }

  if (input.field_action === "remove") {
    actions.push({
      tool: "get_content_type_info",
      reason: "Verify field removed from contract",
      args_hint: { contentType: input.contentType, ...siteHint },
      priority: "recommended",
    });
  } else {
    actions.push({
      tool: "get_content_type_info",
      reason: "Verify field contract after execute",
      args_hint: { contentType: input.contentType, ...siteHint },
      priority: "recommended",
    });
  }

  return actions;
}

function indexBlockedNextActions(
  input: FieldPatchToolInput,
  code: string,
): NextAction[] {
  const siteHint = input.site ? { site: input.site } : {};
  return [
    {
      tool: "get_content_type_info",
      reason:
        code === "field_in_indexes"
          ? "Inspect indexes — remove the field from indexes in Content Type manage, then retry remove"
          : "Inspect unique_fields — clear the field in Content Type manage, then retry remove",
      args_hint: { contentType: input.contentType, ...siteHint },
      priority: "required",
    },
  ];
}

export async function runContentTypeFieldPatch(input: FieldPatchToolInput) {
  const fieldKey = input.field_key.trim();
  if (!fieldKey) {
    return fail("field_key is required for field_action.", { code: "invalid_field_key" });
  }

  const fetched = await fetchContentTypeConfigSlice(
    input.contentType,
    input.domain,
    input.mainServerPort,
    input.internalHeaders,
    input.mcpToken,
  );
  if (!fetched.ok) {
    return fail(fetched.message, { code: "config_fetch_failed", status: fetched.status });
  }

  const isDbBacked = !!fetched.config.database?.slug;
  const databaseNames = await fetchDatabaseNameList(
    input.domain,
    input.mainServerPort,
    input.internalHeaders,
    input.mcpToken,
  );
  const ctx = buildValidationContext(input.contentPath, input.contentType, databaseNames);

  const patchInput = {
    action: input.field_action,
    field_key: fieldKey,
    field_mapping: input.field_mapping,
    editor: input.editor,
    isDbBacked,
  };

  const prepared = prepareFieldPatch(fetched.config, patchInput, ctx);
  if (!prepared.ok) {
    const next_actions =
      prepared.code === "field_in_indexes" || prepared.code === "field_in_unique_fields"
        ? indexBlockedNextActions(input, prepared.code)
        : prepared.code === "missing_strategy"
          ? [
              {
                tool: "update_content_type",
                reason: "Set type strategy before required field changes",
                args_hint: {
                  contentType: input.contentType,
                  strategy: { purpose: "…" },
                  ...(input.site ? { site: input.site } : {}),
                },
                priority: "required" as const,
              },
            ]
          : [];
    return fail(prepared.message, {
      code: prepared.code,
      ...(prepared.details ?? {}),
      next_actions,
    });
  }

  let isNewField = prepared.isNewField;

  const ymlPath = `${path.basename(input.contentPath)}/content-types.yml`;
  const siteHint = input.site ? { site: input.site } : {};
  const warnings = buildFieldPatchWarnings(patchInput, fetched.config, isNewField) as McpWarning[];

  if (input.confirm !== true) {
    return actionRequired(
      {
        success: false,
        action_required: "confirm_field_change",
        code: "confirm_field_change",
        message:
          `${input.field_action} field "${fieldKey}" on content type "${input.contentType}". ` +
          "Execute applies this change on top of the latest config. " +
          "Re-call with confirm: true after principal approval.",
        contentType: input.contentType,
        field_action: input.field_action,
        field_key: fieldKey,
        intendedChange: {
          field_action: input.field_action,
          field_key: fieldKey,
          diff: prepared.diff,
          unchanged_field_count: prepared.diff.unchanged_field_count,
        },
        warnings,
      },
      fieldPatchNextActions(input, isDbBacked, isNewField),
    );
  }

  const fresh = await fetchContentTypeConfigSlice(
    input.contentType,
    input.domain,
    input.mainServerPort,
    input.internalHeaders,
    input.mcpToken,
  );
  if (!fresh.ok) {
    return fail(fresh.message, { code: "config_fetch_failed", status: fresh.status });
  }

  const preparedFresh = prepareFieldPatch(fresh.config, patchInput, ctx);
  if (!preparedFresh.ok) {
    return fail(
      `${preparedFresh.message} Config may have changed since preview — call get_content_type_info and preview again.`,
      { code: preparedFresh.code, ...(preparedFresh.details ?? {}), drift: true },
    );
  }

  const q = input.domain ? `?__site=${encodeURIComponent(input.domain)}` : "";
  const body: Record<string, unknown> = {
    field_mapping: preparedFresh.nextFieldMapping,
    editor: preparedFresh.nextEditor,
  };

  const res = await fetch(
    `http://localhost:${input.mainServerPort}/api/content-types/${encodeURIComponent(input.contentType)}/config${q}`,
    {
      method: "PUT",
      headers: {
        ...input.internalHeaders(input.mcpToken),
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    },
  );
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    return fail(String(data.error ?? data.message ?? `update failed (${res.status})`), {
      code: data.code,
      ...data,
    });
  }

  const side_effects: McpSideEffect[] = [
    {
      kind: "content_types_yml",
      summary: `${input.field_action} field "${fieldKey}" on ${ymlPath}`,
      paths: [ymlPath],
    },
  ];

  const executeWarnings: McpWarning[] = [...warnings];
  if (JSON.stringify(fresh.config.field_mapping) !== JSON.stringify(fetched.config.field_mapping)) {
    executeWarnings.push({
      code: "config_changed_since_preview",
      message: "Underlying field_mapping changed between preview and execute; merge used latest config.",
    });
  }

  const next_actions: NextAction[] = [
    {
      tool: "get_content_type_info",
      reason: "Confirm field contract after write",
      args_hint: { contentType: input.contentType, ...siteHint },
      priority: "recommended",
    },
  ];
  if (input.field_action === "add") {
    next_actions.push({
      tool: "update_fields",
      reason: "Populate values on existing entries if needed",
      args_hint: { contentType: input.contentType, ...siteHint },
      priority: "optional",
    });
  }

  return ok(
    {
      message: `${input.field_action} field "${fieldKey}" on content type '${input.contentType}'`,
      contentType: input.contentType,
      field_action: input.field_action,
      field_key: fieldKey,
      patched: ["field_mapping", "editor"],
      mapping_source: preparedFresh.nextFieldMapping[fieldKey]
        ? mappingEntrySource(preparedFresh.nextFieldMapping[fieldKey])
        : null,
    },
    { warnings: executeWarnings, side_effects, next_actions },
  );
}
