/**
 * Field-level merge for content-types.yml — one key at a time so MCP never wipes sibling fields.
 */
import type { ContentTypeEditorHint } from "../../server/content-types.js";
import {
  KNOWN_SPECIAL_FIELDS,
  RESERVED_IMAGE_FIELD,
  RESERVED_SLUG_FIELD,
} from "../../server/content-types.js";
import {
  isIdentityFieldMapping,
  validateFieldMapping,
  type MappingValidationResult,
} from "../../scripts/validation/shared/fieldMappingValidator.js";

export type FieldMappingEntry = string | { source: string; default: string | null };

export type ContentTypeConfigSlice = {
  field_mapping?: Record<string, FieldMappingEntry> | null;
  editor?: Record<string, ContentTypeEditorHint> | null;
  indexes?: string[] | null;
  unique_fields?: string[] | null;
  strategy?: unknown;
  database?: { slug?: string } | null;
};

export type FieldAction = "add" | "update" | "remove";

export type FieldPatchInput = {
  action: FieldAction;
  field_key: string;
  field_mapping?: FieldMappingEntry;
  editor?: ContentTypeEditorHint;
  isDbBacked: boolean;
};

export type FieldSnapshot = {
  field_mapping: FieldMappingEntry | null;
  editor: ContentTypeEditorHint | null;
};

export type FieldDiff = {
  before: FieldSnapshot;
  after: FieldSnapshot;
  unchanged_field_count: number;
};

export type RemoveBlocker =
  | { code: "field_in_indexes"; indexes: string[] }
  | { code: "field_in_unique_fields"; unique_fields: string[] };

const FORBIDDEN_PLAIN_KEYS = new Set(["slug", "image"]);

export function isForbiddenFieldKey(fieldKey: string): boolean {
  const k = fieldKey.trim();
  if (!k) return true;
  if (k.startsWith("_")) return true;
  if (FORBIDDEN_PLAIN_KEYS.has(k)) return true;
  if ((KNOWN_SPECIAL_FIELDS as readonly string[]).includes(k)) return true;
  if (k === RESERVED_IMAGE_FIELD || k === RESERVED_SLUG_FIELD) return true;
  return false;
}

export function mappingEntrySource(entry: FieldMappingEntry): string {
  if (typeof entry === "string") return entry;
  return entry.source ?? "";
}

export function flattenMappingForValidation(
  mapping: Record<string, FieldMappingEntry>,
): Record<string, string> {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(mapping)) {
    flat[k] = mappingEntrySource(v);
  }
  return flat;
}

export function defaultStaticMapping(fieldKey: string): FieldMappingEntry {
  return { source: fieldKey, default: null };
}

export function checkRemoveAllowed(
  config: ContentTypeConfigSlice,
  fieldKey: string,
): { ok: true } | { ok: false; blocker: RemoveBlocker } {
  const indexes = config.indexes ?? [];
  const uniqueFields = config.unique_fields ?? [];
  if (indexes.includes(fieldKey)) {
    return { ok: false, blocker: { code: "field_in_indexes", indexes: [...indexes] } };
  }
  if (uniqueFields.includes(fieldKey)) {
    return {
      ok: false,
      blocker: { code: "field_in_unique_fields", unique_fields: [...uniqueFields] },
    };
  }
  return { ok: true };
}

export function checkRelationSourceCollision(
  source: string,
  contentTypeNames: readonly string[],
  databaseNames: readonly string[],
): { ok: true } | { ok: false; error: string } {
  const name = source.trim();
  if (!name) return { ok: true };
  const inCt = contentTypeNames.includes(name);
  const inDb = databaseNames.includes(name);
  if (inCt && inDb) {
    return {
      ok: false,
      error:
        `Relation source "${name}" collides with both a content type and a database name — unusable. ` +
        "Rename one side or pick a different source.",
    };
  }
  return { ok: true };
}

export function snapshotField(
  config: ContentTypeConfigSlice,
  fieldKey: string,
): FieldSnapshot {
  const mapping = config.field_mapping ?? {};
  const editor = config.editor ?? {};
  return {
    field_mapping: fieldKey in mapping ? mapping[fieldKey] : null,
    editor: fieldKey in editor ? { ...editor[fieldKey] } : null,
  };
}

export function buildFieldDiff(
  config: ContentTypeConfigSlice,
  nextMapping: Record<string, FieldMappingEntry>,
  nextEditor: Record<string, ContentTypeEditorHint> | null,
  fieldKey: string,
): FieldDiff {
  const before = snapshotField(config, fieldKey);
  const after: FieldSnapshot = {
    field_mapping: fieldKey in nextMapping ? nextMapping[fieldKey] : null,
    editor:
      nextEditor && fieldKey in nextEditor ? { ...nextEditor[fieldKey] } : null,
  };
  const unchangedFieldCount = Object.keys(config.field_mapping ?? {}).filter(
    (k) => k !== fieldKey,
  ).length;
  return {
    before,
    after,
    unchanged_field_count: unchangedFieldCount,
  };
}

export type ApplyFieldPatchResult =
  | {
      ok: true;
      nextFieldMapping: Record<string, FieldMappingEntry>;
      nextEditor: Record<string, ContentTypeEditorHint> | null;
      diff: FieldDiff;
    }
  | { ok: false; code: string; message: string; details?: Record<string, unknown> };

export function applyFieldPatch(
  config: ContentTypeConfigSlice,
  input: FieldPatchInput,
): ApplyFieldPatchResult {
  const fieldKey = input.field_key.trim();
  if (!fieldKey) {
    return { ok: false, code: "invalid_field_key", message: "field_key is required." };
  }
  if (isForbiddenFieldKey(fieldKey)) {
    return {
      ok: false,
      code: "reserved_field_key",
      message: `Field key "${fieldKey}" is reserved or system-managed and cannot be patched via MCP.`,
    };
  }

  const currentMapping = { ...(config.field_mapping ?? {}) };
  const currentEditor = { ...(config.editor ?? {}) };
  const exists = fieldKey in currentMapping;

  if (input.action === "add") {
    if (exists) {
      return {
        ok: false,
        code: "field_exists",
        message: `Field "${fieldKey}" already exists on this content type.`,
      };
    }
    if (input.isDbBacked && input.field_mapping === undefined) {
      return {
        ok: false,
        code: "mapping_required",
        message:
          "DB-backed content types require an explicit field_mapping entry when adding a field.",
      };
    }
    const mappingEntry =
      input.field_mapping ?? (input.isDbBacked ? undefined : defaultStaticMapping(fieldKey));
    if (mappingEntry === undefined) {
      return {
        ok: false,
        code: "mapping_required",
        message: "field_mapping is required for this content type.",
      };
    }
    currentMapping[fieldKey] = mappingEntry;
    if (input.editor !== undefined) {
      currentEditor[fieldKey] = { ...input.editor };
    }
  } else if (input.action === "update") {
    if (!exists) {
      return {
        ok: false,
        code: "field_not_found",
        message: `Field "${fieldKey}" does not exist on this content type.`,
      };
    }
    if (input.field_mapping !== undefined) {
      currentMapping[fieldKey] = input.field_mapping;
    }
    if (input.editor !== undefined) {
      currentEditor[fieldKey] = {
        ...(currentEditor[fieldKey] ?? {}),
        ...input.editor,
      };
    }
    if (input.field_mapping === undefined && input.editor === undefined) {
      return {
        ok: false,
        code: "empty_update",
        message: "update requires at least one of field_mapping or editor.",
      };
    }
  } else {
    if (!exists) {
      return {
        ok: false,
        code: "field_not_found",
        message: `Field "${fieldKey}" does not exist on this content type.`,
      };
    }
    const removeCheck = checkRemoveAllowed(config, fieldKey);
    if (!removeCheck.ok) {
      const b = removeCheck.blocker;
      if (b.code === "field_in_indexes") {
        return {
          ok: false,
          code: b.code,
          message:
            `Cannot remove "${fieldKey}": it is listed in indexes. ` +
            "Remove it from indexes in Content Type manage first, then retry remove.",
          details: { indexes: b.indexes, field_key: fieldKey },
        };
      }
      return {
        ok: false,
        code: b.code,
        message:
          `Cannot remove "${fieldKey}": it is listed in unique_fields. ` +
          "Remove it from unique_fields in Content Type manage first, then retry remove.",
        details: { unique_fields: b.unique_fields, field_key: fieldKey },
      };
    }
    delete currentMapping[fieldKey];
    delete currentEditor[fieldKey];
  }

  const nextEditor =
    Object.keys(currentEditor).length > 0 ? currentEditor : null;

  const diff = buildFieldDiff(config, currentMapping, nextEditor, fieldKey);

  return {
    ok: true,
    nextFieldMapping: currentMapping,
    nextEditor,
    diff,
  };
}

export function validateStaticRemapForKey(
  contentType: string,
  fieldKey: string,
  mappingEntry: FieldMappingEntry,
  isDbBacked: boolean,
): MappingValidationResult | null {
  if (isDbBacked) return null;
  const source = mappingEntrySource(mappingEntry);
  if (isIdentityFieldMapping(fieldKey, source)) return null;
  return validateFieldMapping(contentType, { [fieldKey]: source });
}

export function relationSourceFromEditor(
  editor: ContentTypeEditorHint | undefined,
): string | null {
  if (!editor || editor.type !== "relation") return null;
  const s = editor.source?.trim();
  return s || null;
}

export function hasRequiredAttached(editor: ContentTypeEditorHint | null | undefined): boolean {
  return editor?.required === "attached";
}

export function hasRequiredTrue(editor: ContentTypeEditorHint | null | undefined): boolean {
  return editor?.required === true;
}
