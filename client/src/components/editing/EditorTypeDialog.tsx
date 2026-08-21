import { useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Info,
  Loader2,
  Plus,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { collectEditorFieldTokens } from "@shared/editor-field-values";
import { compileJsonSchema } from "@shared/json-field";
import {
  FILL_INTENT_GOAL_PRESETS,
  isValidFillIntent,
  parseFillIntent,
  type EditorFillIntent,
} from "@shared/fillIntent";

export type EditorHint = {
  type?: string;
  options?: (string | { value: string; label: string })[];
  populate_options?: boolean;
  allow_custom_values?: boolean;
  /** Split comma-separated strings into tokens. Arrays always expand. */
  split_comma_values?: boolean;
  cache_images?: boolean;
  description?: string;
  /** Required for publish / cannot clear when live. `"attached"` = only when not detached. */
  required?: boolean | "attached";
  /** Declarative fill brief (required when editor.required is set). */
  fill_intent?: EditorFillIntent;
  /**
   * Required when type is `json`. JSON Schema document validated on Apply
   * and used to lint/persist structured field values.
   */
  schema?: Record<string, unknown>;
  /** Content type or database name for `relation` editors. */
  source?: string;
  /** Option value field (e.g. slug). */
  value?: string;
  /** Option label field (e.g. name). */
  label?: string;
  /** Allow selecting multiple related entries. */
  multiple?: boolean;
};

export type EditorTypeDialogProps = {
  open: boolean;
  fieldName: string | null;
  initialHint?: EditorHint;
  /** When true, type select is locked to image (DB image-cache mode). */
  lockImageType?: boolean;
  /**
   * Mapped items (same shape the item editor uses) for the populate/CSV preview.
   * Pass post–field_mapping rows keyed by editor field names.
   */
  existingItems?: Record<string, unknown>[];
  /** True while parent is still loading sample/items for the preview. */
  existingItemsLoading?: boolean;
  onClose: () => void;
  onApply: (hint: EditorHint) => void;
};

const PREVIEW_CAP = 20;

function CheckboxInfoPopover({
  testId,
  children,
}: {
  testId: string;
  children: ReactNode;
}) {
  return (
    <Popover modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label="More information"
          data-testid={testId}
          onClick={(e) => e.stopPropagation()}
        >
          <Info className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 space-y-2 text-sm text-muted-foreground z-[10003] pointer-events-auto"
        side="top"
        align="start"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        {children}
      </PopoverContent>
    </Popover>
  );
}

export function EditorTypeDialog({
  open,
  fieldName,
  initialHint,
  lockImageType = false,
  existingItems,
  existingItemsLoading = false,
  onClose,
  onApply,
}: EditorTypeDialogProps) {
  const [type, setType] = useState("text");
  const [options, setOptions] = useState<{ value: string; label: string }[]>([]);
  const [newOption, setNewOption] = useState("");
  const [populateOptions, setPopulateOptions] = useState(false);
  const [allowCustom, setAllowCustom] = useState(false);
  const [splitComma, setSplitComma] = useState(false);
  const [description, setDescription] = useState("");
  const [fillGoal, setFillGoal] = useState("");
  const [fillPurpose, setFillPurpose] = useState("");
  const [fillConstraintsText, setFillConstraintsText] = useState("");
  const [fillIntentError, setFillIntentError] = useState<string | null>(null);
  const [schemaText, setSchemaText] = useState("");
  const [schemaError, setSchemaError] = useState<string | null>(null);
  const [relationSource, setRelationSource] = useState("");
  const [relationValue, setRelationValue] = useState("");
  const [relationLabel, setRelationLabel] = useState("");
  const [relationMultiple, setRelationMultiple] = useState(false);
  const [relationError, setRelationError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showSchemaAiPrompt, setShowSchemaAiPrompt] = useState(false);
  const [schemaAiPrompt, setSchemaAiPrompt] = useState("");
  const [schemaAiGenerating, setSchemaAiGenerating] = useState(false);

  useEffect(() => {
    if (!open) return;
    const hint = initialHint || {};
    setType(lockImageType || hint.cache_images ? "image" : hint.type || "text");
    setOptions(
      (hint.options || []).map((opt) =>
        typeof opt === "string"
          ? { value: opt, label: "" }
          : { value: opt.value, label: opt.label ?? "" },
      ),
    );
    setNewOption("");
    setPopulateOptions(hint.populate_options ?? false);
    setAllowCustom(hint.allow_custom_values ?? false);
    setSplitComma(hint.split_comma_values ?? false);
    setDescription(hint.description || "");
    const fi = parseFillIntent(hint.fill_intent);
    setFillGoal(fi?.goal || "");
    setFillPurpose(fi?.purpose || "");
    setFillConstraintsText(fi?.constraints?.join("\n") || "");
    setFillIntentError(null);
    setSchemaText(
      hint.schema && typeof hint.schema === "object"
        ? JSON.stringify(hint.schema, null, 2)
        : "",
    );
    setSchemaError(null);
    setRelationSource(hint.source || "");
    setRelationValue(hint.value || "");
    setRelationLabel(hint.label || "");
    setRelationMultiple(hint.multiple ?? false);
    setRelationError(null);
    setShowAdvanced(false);
    setShowSchemaAiPrompt(false);
    setSchemaAiPrompt("");
    setSchemaAiGenerating(false);
  }, [open, fieldName, initialHint, lockImageType]);

  const addOptions = () => {
    const existingValues = new Set(options.map((o) => o.value));
    const newOpts = newOption
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0 && !existingValues.has(s))
      .map((v) => ({ value: v, label: "" }));
    if (newOpts.length === 0) return;
    setOptions((prev) => [...prev, ...newOpts]);
    setNewOption("");
  };

  const handleGenerateSchema = async () => {
    const prompt = schemaAiPrompt.trim();
    if (!prompt || !fieldName || schemaAiGenerating) return;
    setSchemaAiGenerating(true);
    setSchemaError(null);
    try {
      const res = await fetch("/api/ai/generate-json-schema", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fieldName,
          userPrompt: prompt,
          currentSchema: schemaText.trim() || undefined,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        schema?: Record<string, unknown>;
        error?: string;
      };
      if (!res.ok) {
        throw new Error(data.error || "Failed to generate JSON schema");
      }
      if (!data.schema || typeof data.schema !== "object") {
        throw new Error("AI returned no schema");
      }
      const compiled = compileJsonSchema(data.schema);
      if (!compiled.ok) {
        throw new Error(compiled.error);
      }
      setSchemaText(JSON.stringify(compiled.schema, null, 2));
      setSchemaError(null);
      setShowSchemaAiPrompt(false);
      setSchemaAiPrompt("");
    } catch (err) {
      setSchemaError(
        err instanceof Error ? err.message : "Failed to generate JSON schema",
      );
    } finally {
      setSchemaAiGenerating(false);
    }
  };

  const handleApply = () => {
    const resolvedType = lockImageType ? "image" : type;
    const hint: EditorHint = { type: resolvedType };
    if (initialHint?.required === true || initialHint?.required === "attached") {
      hint.required = initialHint.required;
    }
    if (description.trim()) hint.description = description.trim();

    const goal = fillGoal.trim();
    const purpose = fillPurpose.trim();
    const constraints = fillConstraintsText
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    const draftIntent =
      goal || purpose || constraints.length > 0
        ? {
            goal,
            purpose,
            ...(constraints.length > 0 ? { constraints } : {}),
          }
        : undefined;

    if (hint.required === true || hint.required === "attached") {
      if (!draftIntent || !isValidFillIntent(draftIntent)) {
        setFillIntentError(
          "Required fields need fill_intent: non-empty goal and purpose.",
        );
        return;
      }
    }
    if (draftIntent) {
      if (!isValidFillIntent(draftIntent)) {
        setFillIntentError("fill_intent needs both a non-empty goal and purpose (or clear both).");
        return;
      }
      hint.fill_intent = parseFillIntent(draftIntent) ?? undefined;
    }
    setFillIntentError(null);

    if (resolvedType === "select" || resolvedType === "tags") {
      if (options.length > 0) {
        hint.options = options.map((o) =>
          (o.label ?? "").trim() ? { value: o.value, label: o.label } : o.value,
        );
      }
      if (populateOptions) hint.populate_options = true;
      if (allowCustom) hint.allow_custom_values = true;
      if (splitComma) hint.split_comma_values = true;
    }
    if (resolvedType === "json") {
      const trimmed = schemaText.trim();
      if (!trimmed) {
        setSchemaError("JSON fields require a schema");
        return;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(trimmed);
      } catch (err) {
        setSchemaError(err instanceof Error ? err.message : "Invalid JSON Schema document");
        return;
      }
      const compiled = compileJsonSchema(parsed);
      if (!compiled.ok) {
        setSchemaError(compiled.error);
        return;
      }
      hint.schema = compiled.schema;
      setSchemaError(null);
    }
    if (resolvedType === "relation") {
      const source = relationSource.trim();
      if (!source) {
        setRelationError("Relation fields require a source (content type or database)");
        return;
      }
      hint.source = source;
      const value = relationValue.trim();
      const label = relationLabel.trim();
      if (value) hint.value = value;
      if (label) hint.label = label;
      if (relationMultiple) hint.multiple = true;
      setRelationError(null);
    }
    if (initialHint?.cache_images) hint.cache_images = true;
    onApply(hint);
  };

  const manualValueSet = useMemo(
    () => new Set(options.map((o) => o.value)),
    [options],
  );

  const previewTokens = useMemo(() => {
    if (!populateOptions || !fieldName || !existingItems) return [];
    return collectEditorFieldTokens(existingItems, fieldName, {
      splitComma,
    }).filter((t) => !manualValueSet.has(t));
  }, [populateOptions, fieldName, existingItems, splitComma, manualValueSet]);

  const previewVisible = previewTokens.slice(0, PREVIEW_CAP);
  const previewMore = Math.max(0, previewTokens.length - PREVIEW_CAP);
  const hasItemsProp = existingItems !== undefined;
  const itemsLoaded = hasItemsProp && !existingItemsLoading;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      {/* Nested above Field Mapping / DB config dialogs (both use z-[10000]). */}
      <DialogContent
        className="z-[10002] max-w-md max-h-[90vh] flex flex-col gap-4 overflow-hidden p-6"
        overlayClassName="z-[10002]"
        onPointerDownOutside={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
      >        <DialogHeader className="shrink-0">
          <DialogTitle>Editor Type for "{fieldName}"</DialogTitle>
          <DialogDescription>
            Choose how this field renders in the item editor.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2 min-h-0 flex-1 overflow-y-auto">
          <div className="space-y-2">
            <Label className="text-xs">Field type</Label>
            <Select
              value={lockImageType ? "image" : type}
              onValueChange={setType}
              disabled={lockImageType}
            >
              <SelectTrigger className="text-sm" data-testid="select-hint-type">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="z-[10003]">
                <SelectItem value="text">text — single-line input</SelectItem>
                <SelectItem value="textarea">textarea — multi-line</SelectItem>
                <SelectItem value="markdown">markdown — editor with preview</SelectItem>
                <SelectItem value="number">number — numeric</SelectItem>
                <SelectItem value="boolean">boolean — toggle</SelectItem>
                <SelectItem value="date">date — date only</SelectItem>
                <SelectItem value="datetime">datetime — date + time (UTC or naive)</SelectItem>
                <SelectItem value="image">image — URL with preview + cache status</SelectItem>
                <SelectItem value="pdf">pdf — document URL with gallery picker</SelectItem>
                <SelectItem value="select">select — dropdown</SelectItem>
                <SelectItem value="tags">multi select — multi-value</SelectItem>
                <SelectItem value="json">json — structured JSON (schema required)</SelectItem>
                <SelectItem value="relation">relation — link to content type or database entries</SelectItem>
              </SelectContent>
            </Select>
            {lockImageType && (
              <p className="text-[11px] text-muted-foreground">
                Editor type is locked to image while image caching is enabled.
              </p>
            )}
            {type === "pdf" && !lockImageType && (
              <p className="text-[11px] text-muted-foreground" data-testid="text-hint-pdf-howto">
                Item editor shows a gallery picker limited to PDFs. Paste a URL or choose from the media gallery.
              </p>
            )}
            {type === "json" && !lockImageType && (
              <p className="text-[11px] text-muted-foreground" data-testid="text-hint-json-howto">
                Stores structured data (object/array), not a string. Use exact{" "}
                <code className="text-foreground">{"{{ single.field }}"}</code> or{" "}
                <code className="text-foreground">{"{{ single.field | [] }}"}</code> in templates.
                A JSON Schema is required.
              </p>
            )}
            {type === "relation" && !lockImageType && (
              <p className="text-[11px] text-muted-foreground" data-testid="text-hint-relation-howto">
                Stores pointer slug(s) to related entries. Source is a content type or database;
                options come from <code className="text-foreground">/api/query-options</code>.
              </p>
            )}
          </div>
          <div className="space-y-1">
            <Label className="text-xs">Description (shown as hint in editor)</Label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g. Choose the programming language for this course"
              className="w-full text-sm px-3 py-1.5 rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
              data-testid="input-hint-description"
            />
          </div>
          <div
            className="space-y-2 rounded-md border border-border/60 bg-muted/20 p-3"
            data-testid="fill-intent-editor"
          >
            <div className="space-y-0.5">
              <Label className="text-xs">Fill intent</Label>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Declarative why/how agents and Diagnostics should fill this field. Required when the
                field is marked required for publish. Goal is an open tag — presets are shortcuts;
                custom goals are fine. Purpose is the brief.
              </p>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Goal</Label>
              <div className="flex flex-col gap-1.5 sm:flex-row">
                <Select
                  value={
                    (FILL_INTENT_GOAL_PRESETS as readonly string[]).includes(fillGoal)
                      ? fillGoal
                      : fillGoal
                        ? "__custom__"
                        : ""
                  }
                  onValueChange={(v) => {
                    if (v === "__custom__") {
                      if ((FILL_INTENT_GOAL_PRESETS as readonly string[]).includes(fillGoal)) {
                        setFillGoal("");
                      }
                      return;
                    }
                    setFillGoal(v);
                    setFillIntentError(null);
                  }}
                >
                  <SelectTrigger className="h-8 text-xs sm:w-44" data-testid="select-fill-intent-goal-preset">
                    <SelectValue placeholder="Preset…" />
                  </SelectTrigger>
                  <SelectContent>
                    {FILL_INTENT_GOAL_PRESETS.map((g) => (
                      <SelectItem key={g} value={g} className="text-xs">
                        {g}
                      </SelectItem>
                    ))}
                    <SelectItem value="__custom__" className="text-xs">
                      Custom…
                    </SelectItem>
                  </SelectContent>
                </Select>
                <input
                  type="text"
                  value={fillGoal}
                  onChange={(e) => {
                    setFillGoal(e.target.value);
                    setFillIntentError(null);
                  }}
                  placeholder="goal slug (e.g. geo_llm or lead_nurture)"
                  className="w-full flex-1 text-sm px-3 py-1.5 rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  data-testid="input-fill-intent-goal"
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Purpose</Label>
              <Textarea
                value={fillPurpose}
                onChange={(e) => {
                  setFillPurpose(e.target.value);
                  setFillIntentError(null);
                }}
                placeholder="Why this field exists and how to fill it well…"
                className="text-xs min-h-[4.5rem] resize-y"
                data-testid="textarea-fill-intent-purpose"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Constraints (optional, one per line)</Label>
              <Textarea
                value={fillConstraintsText}
                onChange={(e) => setFillConstraintsText(e.target.value)}
                placeholder={"At least 5 items\nNever invent CRM tags\nRefresh frequently"}
                className="text-xs min-h-[3.5rem] resize-y font-mono"
                data-testid="textarea-fill-intent-constraints"
              />
            </div>
            {fillIntentError && (
              <p className="text-[11px] text-destructive" data-testid="text-fill-intent-error">
                {fillIntentError}
              </p>
            )}
          </div>
          {type === "json" && !lockImageType && (
            <div className="space-y-2" data-testid="json-schema-editor">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs">JSON Schema (required)</Label>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-6 w-6 shrink-0"
                  title="Generate with AI"
                  aria-label="Generate with AI"
                  aria-expanded={showSchemaAiPrompt}
                  disabled={schemaAiGenerating}
                  onClick={() => setShowSchemaAiPrompt((v) => !v)}
                  data-testid="button-generate-json-schema"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                </Button>
              </div>
              {showSchemaAiPrompt && (
                <div className="space-y-1.5 rounded-md border bg-muted/30 p-2">
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Describe what this field stores; AI drafts a JSON Schema you can edit before Apply.
                  </p>
                  <div className="flex gap-1.5 items-end">
                    <Textarea
                      placeholder={`What should "${fieldName || "this field"}" store? e.g. author name, email, and avatar URL`}
                      value={schemaAiPrompt}
                      onChange={(e) => setSchemaAiPrompt(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void handleGenerateSchema();
                        }
                      }}
                      className="min-h-[36px] max-h-[72px] flex-1 resize-none text-xs"
                      disabled={schemaAiGenerating}
                      data-testid="input-generate-json-schema-prompt"
                    />
                    <Button
                      type="button"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      onClick={() => void handleGenerateSchema()}
                      disabled={schemaAiGenerating || !schemaAiPrompt.trim()}
                      data-testid="button-generate-json-schema-send"
                    >
                      {schemaAiGenerating ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-3.5 w-3.5" />
                      )}
                    </Button>
                  </div>
                </div>
              )}
              <Textarea
                value={schemaText}
                onChange={(e) => {
                  setSchemaText(e.target.value);
                  setSchemaError(null);
                }}
                placeholder={`{\n  "type": "array",\n  "items": {\n    "type": "object",\n    "required": ["question", "answer"],\n    "properties": {\n      "question": { "type": "string" },\n      "answer": { "type": "string" }\n    }\n  }\n}`}
                className="text-xs font-mono min-h-[10rem] resize-y"
                data-testid="textarea-hint-json-schema"
              />
              {schemaError && (
                <p className="text-[11px] text-destructive" data-testid="text-hint-schema-error">
                  {schemaError}
                </p>
              )}
              <button
                type="button"
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => setShowAdvanced((v) => !v)}
                data-testid="button-hint-json-advanced"
              >
                {showAdvanced ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                {showAdvanced ? "Hide advanced details" : "Read more (advanced)"}
              </button>
              {showAdvanced && (
                <div
                  className="rounded-md border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground space-y-1.5"
                  data-testid="hint-json-advanced-details"
                >
                  <p>
                    Validation: <code className="text-foreground">shared/json-field.ts</code>
                  </p>
                  <p>
                    AI draft: <code className="text-foreground">POST /api/ai/generate-json-schema</code>{" "}
                    fills this textarea only — Apply still required to persist{" "}
                    <code className="text-foreground">editor.&lt;field&gt;.schema</code>.
                  </p>
                  <p>
                    Item editor:{" "}
                    <code className="text-foreground">client/src/components/databases/ItemEditModal.tsx</code>
                  </p>
                  <p>
                    Agents: call <code className="text-foreground">get_content_type_info</code> and read{" "}
                    <code className="text-foreground">editor.&lt;field&gt;.schema</code> before writing.
                  </p>
                </div>
              )}
            </div>
          )}
          {type === "relation" && !lockImageType && (
            <div className="space-y-2" data-testid="relation-hint-editor">
              <div className="space-y-1">
                <Label className="text-xs">Source (required)</Label>
                <input
                  type="text"
                  value={relationSource}
                  onChange={(e) => {
                    setRelationSource(e.target.value);
                    setRelationError(null);
                  }}
                  placeholder="content type or database name"
                  className="w-full text-sm px-3 py-1.5 rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  data-testid="input-hint-relation-source"
                />
                <p className="text-[11px] text-muted-foreground" data-testid="text-hint-relation-source-help">
                  Content-type key or private database slug that supplies picker options (same namespace as{" "}
                  <code className="text-foreground">/api/query-options</code>). Must not collide across those namespaces.
                </p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Value field</Label>
                <input
                  type="text"
                  value={relationValue}
                  onChange={(e) => setRelationValue(e.target.value)}
                  placeholder="slug"
                  className="w-full text-sm px-3 py-1.5 rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  data-testid="input-hint-relation-value"
                />
                <p className="text-[11px] text-muted-foreground" data-testid="text-hint-relation-value-help">
                  Field on related entries stored as the pointer (default <code className="text-foreground">slug</code>).
                  The field value is this pointer only — not the full related object.
                </p>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Label field</Label>
                <input
                  type="text"
                  value={relationLabel}
                  onChange={(e) => setRelationLabel(e.target.value)}
                  placeholder="name"
                  className="w-full text-sm px-3 py-1.5 rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  data-testid="input-hint-relation-label"
                />
                <p className="text-[11px] text-muted-foreground" data-testid="text-hint-relation-label-help">
                  Field shown in the picker UI (default <code className="text-foreground">title</code> /{" "}
                  <code className="text-foreground">name</code>). Display-only; not what gets saved.
                </p>
              </div>
              <label
                className="flex items-center gap-2 cursor-pointer"
                data-testid="label-hint-relation-multiple"
              >
                <input
                  type="checkbox"
                  checked={relationMultiple}
                  onChange={(e) => setRelationMultiple(e.target.checked)}
                  className="h-3.5 w-3.5 rounded"
                  data-testid="checkbox-hint-relation-multiple"
                />
                <span className="text-xs text-muted-foreground">
                  Allow multiple related entries
                </span>
              </label>
              {relationError && (
                <p className="text-[11px] text-destructive" data-testid="text-hint-relation-error">
                  {relationError}
                </p>
              )}
              <button
                type="button"
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                onClick={() => setShowAdvanced((v) => !v)}
                data-testid="button-hint-relation-advanced"
              >
                {showAdvanced ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                {showAdvanced ? "Hide advanced details" : "Read more (advanced)"}
              </button>
              {showAdvanced && (
                <div
                  className="rounded-md border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground space-y-1.5"
                  data-testid="hint-relation-advanced-details"
                >
                  <p>
                    Options API: <code className="text-foreground">server/query-options.ts</code>
                  </p>
                  <p>
                    Resolve at load:{" "}
                    <code className="text-foreground">server/resolve-relations.ts</code>
                  </p>
                  <p>
                    Query entries:{" "}
                    <code className="text-foreground">server/query-entries.ts</code>
                  </p>
                </div>
              )}
            </div>
          )}
          {(type === "select" || type === "tags") && !lockImageType && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5">
                <Label className="text-xs">Options</Label>
                <CheckboxInfoPopover testId="info-hint-options">
                  <p>
                    Manual options are the curated list shown in the item editor.
                    They are saved on this field&apos;s editor config.
                  </p>
                  <p>
                    Values discovered from existing data (when enabled below) are
                    merged at edit time and are <strong className="text-foreground">not</strong> written
                    into this list when you Apply.
                  </p>
                </CheckboxInfoPopover>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed" data-testid="text-hint-how-it-works">
                Curate options below. Arrays in existing data already expand into
                distinct choices when you include values from data. Comma-separated
                strings need the CSV checkbox. Use &quot;Allow custom values&quot; for
                free-text entries not in the list.
              </p>
              <div className="flex gap-2 items-start">
                <Textarea
                  value={newOption}
                  onChange={(e) => setNewOption(e.target.value)}
                  placeholder="One or more comma separated values. E.g: one, two, three"
                  className="text-sm flex-1 resize-none"
                  rows={2}
                  data-testid="textarea-hint-bulk-input"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={addOptions}
                  disabled={!newOption.trim()}
                  data-testid="button-add-hint-options-bulk"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  {newOption.split(",").filter((s) => s.trim().length > 0).length > 1
                    ? "Add multiple"
                    : "Add"}
                </Button>
              </div>
              {options.length > 0 && (
                <div className="border rounded-md divide-y max-h-48 overflow-y-auto">
                  {options.map((opt, idx) => (
                    <div key={idx} className="flex items-center gap-2 px-3 py-1.5 text-sm">
                      <span className="font-mono text-xs text-muted-foreground w-1/3 truncate flex-shrink-0">
                        {opt.value}
                      </span>
                      <input
                        type="text"
                        value={opt.label}
                        onChange={(e) => {
                          const updated = [...options];
                          updated[idx] = { ...opt, label: e.target.value };
                          setOptions(updated);
                        }}
                        placeholder="Label (optional)"
                        className="flex-1 text-xs px-2 py-0.5 rounded border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                        data-testid={`input-hint-option-label-${idx}`}
                      />
                      <button
                        type="button"
                        onClick={() => setOptions((prev) => prev.filter((_, i) => i !== idx))}
                        className="ml-1 text-muted-foreground hover:text-destructive flex-shrink-0"
                        data-testid={`button-remove-hint-option-${idx}`}
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              {options.length === 0 && (
                <p className="text-xs text-muted-foreground">No options added yet.</p>
              )}

              <label className="flex items-center gap-2 cursor-pointer pt-1" data-testid="label-populate-options">
                <input
                  type="checkbox"
                  checked={populateOptions}
                  onChange={(e) => setPopulateOptions(e.target.checked)}
                  className="h-3.5 w-3.5 rounded"
                  data-testid="checkbox-populate-options"
                />
                <span className="text-xs text-muted-foreground flex-1">
                  Also include values from existing data
                </span>
                <CheckboxInfoPopover testId="info-populate-options">
                  <p>
                    Scans loaded items for this field and unions distinct string
                    tokens into the editor option list at edit time (not saved into
                    Options above).
                  </p>
                  <p>
                    Arrays always expand (each element becomes a token). Without the
                    CSV checkbox, a whole string like{" "}
                    <code className="text-foreground">python, javascript</code> is
                    one option.
                  </p>
                  <p>
                    Enabling this does not by itself allow free-text entry — use
                    &quot;Allow custom values&quot; for that. (Older configs that
                    only set populate may still allow custom add as a legacy fallback.)
                  </p>
                </CheckboxInfoPopover>
              </label>

              {populateOptions && (
                <div className="space-y-1.5" data-testid="preview-from-existing-data">
                  <p className="text-[11px] font-medium text-muted-foreground">
                    From existing data (preview)
                  </p>
                  {existingItemsLoading && (
                    <p className="text-xs text-muted-foreground">Loading sample values…</p>
                  )}
                  {!existingItemsLoading && !hasItemsProp && (
                    <p className="text-xs text-muted-foreground">
                      Sample data not loaded. Open this dialog from Manage → Fields so peer
                      values can be previewed; the item editor also loads peers when this
                      option is on.
                    </p>
                  )}
                  {itemsLoaded && previewTokens.length === 0 && (
                    <p className="text-xs text-muted-foreground">
                      No values found in existing data yet
                      {manualValueSet.size > 0 ? " (beyond your manual options)" : ""}.
                    </p>
                  )}
                  {itemsLoaded && previewVisible.length > 0 && (
                    <>
                      <p className="text-[10px] text-muted-foreground">
                        Preview from loaded data ({previewTokens.length} unique
                        {previewMore > 0 ? `, showing ${PREVIEW_CAP}` : ""}). Not
                        saved into Options on Apply.
                      </p>
                      <div className="border border-dashed rounded-md divide-y max-h-40 overflow-y-auto bg-muted/30">
                        {previewVisible.map((token) => (
                          <div
                            key={token}
                            className="px-3 py-1.5 text-xs font-mono text-muted-foreground truncate"
                            data-testid={`preview-token-${token}`}
                          >
                            {token}
                          </div>
                        ))}
                      </div>
                      {previewMore > 0 && (
                        <p className="text-[10px] text-muted-foreground">
                          and {previewMore} more
                        </p>
                      )}
                    </>
                  )}
                </div>
              )}

              <label className="flex items-center gap-2 cursor-pointer" data-testid="label-split-comma">
                <input
                  type="checkbox"
                  checked={splitComma}
                  onChange={(e) => setSplitComma(e.target.checked)}
                  className="h-3.5 w-3.5 rounded"
                  data-testid="checkbox-split-comma"
                />
                <span className="text-xs text-muted-foreground flex-1">
                  Treat comma-separated strings as multiple values
                </span>
                <CheckboxInfoPopover testId="info-split-comma">
                  <p>
                    Splits string cells on{" "}
                    <code className="text-foreground">,</code> (trim each part).
                    Arrays always expand regardless of this flag.
                  </p>
                  <p>
                    With populate on, the preview above updates immediately. For{" "}
                    <strong className="text-foreground">tags</strong>, the current
                    field value is also parsed this way in the item editor. For{" "}
                    <strong className="text-foreground">select</strong>, only the
                    option list is affected — the stored single value is unchanged.
                  </p>
                  <p>
                    Saving a tags field may normalize a comma-separated string into
                    a string array.
                  </p>
                  <p>
                    Facets for this field follow the same flag after the next database
                    refresh.
                  </p>
                </CheckboxInfoPopover>
              </label>

              {splitComma && (
                <div
                  className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-200/90"
                  data-testid="warning-split-comma"
                  role="status"
                >
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-400" />
                  <div className="space-y-1">
                    <p>
                      Values that legitimately contain commas (e.g.{" "}
                      <code className="text-amber-100">San Francisco, CA</code>) will
                      be split into separate tokens.
                    </p>
                    <p className="text-amber-200/70">
                      Agents: set <code className="text-amber-100">split_comma_values: true</code>{" "}
                      only when field values are delimiter lists, not prose with commas.
                    </p>
                  </div>
                </div>
              )}

              <label className="flex items-center gap-2 cursor-pointer" data-testid="label-allow-custom">
                <input
                  type="checkbox"
                  checked={allowCustom}
                  onChange={(e) => setAllowCustom(e.target.checked)}
                  className="h-3.5 w-3.5 rounded"
                  data-testid="checkbox-allow-custom"
                />
                <span className="text-xs text-muted-foreground flex-1">
                  Allow typing custom values (not in list)
                </span>
                <CheckboxInfoPopover testId="info-allow-custom">
                  <p>
                    Shows an add/free-text control in the item editor so staff can
                    enter values that are not in the manual or populated list.
                  </p>
                  <p>
                    Prefer enabling this explicitly. Populate alone is for discovering
                    options from data, not for free-text (legacy configs may still
                    fall back).
                  </p>
                </CheckboxInfoPopover>
              </label>

              <button
                type="button"
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground pt-1"
                onClick={() => setShowAdvanced((v) => !v)}
                data-testid="button-hint-advanced"
              >
                {showAdvanced ? (
                  <ChevronDown className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
                {showAdvanced ? "Hide advanced details" : "Read more (advanced)"}
              </button>
              {showAdvanced && (
                <div
                  className="rounded-md border bg-muted/40 px-3 py-2 text-[11px] text-muted-foreground space-y-1.5"
                  data-testid="hint-advanced-details"
                >
                  <p>
                    Runtime merge and tags parsing:{" "}
                    <code className="text-foreground">client/src/components/databases/ItemEditModal.tsx</code>
                  </p>
                  <p>
                    Token helper:{" "}
                    <code className="text-foreground">shared/editor-field-values.ts</code>
                  </p>
                  <p>
                    Facets (follow <code className="text-foreground">split_comma_values</code> after
                    DB refresh):{" "}
                    <code className="text-foreground">server/database.ts</code>
                  </p>
                  <p>
                    Config shape:{" "}
                    <code className="text-foreground">server/content-types.ts</code>{" "}
                    (<code className="text-foreground">ContentTypeEditorHint</code> / YAML{" "}
                    <code className="text-foreground">editor</code> header)
                  </p>
                  <p>
                    This dialog:{" "}
                    <code className="text-foreground">client/src/components/editing/EditorTypeDialog.tsx</code>
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0 flex items-center justify-end gap-2">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            data-testid="button-cancel-hint"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleApply();
            }}
            data-testid="button-save-hint"
          >
            <Check className="h-3.5 w-3.5 mr-1" />
            Apply
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
