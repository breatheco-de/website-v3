import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconChevronDown,
  IconGripVertical,
  IconPencil,
  IconPlus,
  IconTrash,
  IconClipboardList,
  IconX,
} from "@tabler/icons-react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
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
import { cn } from "@/lib/utils";
import { parseFormFieldSource } from "@shared/parseFormFieldSource";
import {
  LeadFormFieldControl,
  type LeadFormComponentRenderer,
  type LeadFormOption,
} from "@/components/lead_form/LeadFormFieldControl";

const COMPONENT_RENDERERS = [
  { value: "text", label: "Text" },
  { value: "phone", label: "Phone" },
  { value: "textarea", label: "Textarea" },
  { value: "select", label: "Select" },
  { value: "cards", label: "Cards" },
  { value: "simple-list", label: "Simple List" },
  { value: "grouped-list", label: "Grouped List" },
] as const;

const CHOICE_RENDERERS = new Set(["select", "cards", "simple-list", "grouped-list"]);
/** Open preview only for these (last three rich layouts). */
const PREVIEW_RENDERERS = new Set(["cards", "simple-list", "grouped-list"]);
const SELECT_DEFAULT_FIELDS = new Set(["program", "plan", "location", "region"]);

function defaultComponentRenderer(fieldName: string): LeadFormComponentRenderer {
  if (fieldName === "phone") return "phone";
  if (fieldName === "client_comments") return "textarea";
  if (SELECT_DEFAULT_FIELDS.has(fieldName)) return "select";
  return "text";
}

function rendererLabel(value: string): string {
  return COMPONENT_RENDERERS.find((r) => r.value === value)?.label ?? value;
}

type OptionRow = Record<string, unknown> & { value: string };

export interface FormFieldConfig {
  visible?: boolean;
  required?: boolean;
  default?: string | number | boolean;
  component_renderer?: string;
  label?: string;
  placeholder?: string;
  helper_text?: string;
  show_label?: boolean;
  layout?: string;
  source?: unknown;
  options?: Array<Record<string, unknown> & { value: string }>;
  [key: string]: unknown;
}

export type FormFieldChangeValue = boolean | string | Record<string, unknown> | unknown[] | undefined;

export interface FormFieldsCardProps {
  fields: Record<string, FormFieldConfig>;
  onFieldChange: (fieldName: string, key: string, value: FormFieldChangeValue) => void;
  onFieldAdd: (name: string) => void;
  onFieldRemove: (name: string) => void;
  onFieldRename: (from: string, to: string) => void;
}

const FIELD_ORDER = [
  "email",
  "first_name",
  "last_name",
  "phone",
  "program",
  "plan",
  "region",
  "location",
  "coupon",
  "referral_key",
  "client_comments",
  "current_download",
];

function sortFieldNames(names: string[]): string[] {
  return [...names].sort((a, b) => {
    const ia = FIELD_ORDER.indexOf(a);
    const ib = FIELD_ORDER.indexOf(b);
    if (ia === -1 && ib === -1) return a.localeCompare(b);
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  });
}

const FIELD_FLAG_BADGES = new Set(["visible", "hidden", "required", "optional"]);

/** Fields that still load options from a content-type catalog when `source` is omitted. */
const FORM_OPTIONS_CONTENT_TYPE_FIELDS = new Set(["program"]);

/** Summary badges (no paths, query, or default). Source shows as kind only. */
function summarizeField(cfg: FormFieldConfig, fieldName?: string): string[] {
  const parts: string[] = [];
  const kind = sourceKindOf(cfg.source);
  if (kind === "content_type") parts.push("from a content type");
  else if (kind === "database") parts.push("from a database");
  else if (kind === "related_field") parts.push("from a related field");
  else if (typeof cfg.source === "string" && cfg.source.trim()) {
    parts.push("from a source");
  } else if (fieldName && FORM_OPTIONS_CONTENT_TYPE_FIELDS.has(fieldName) && cfg.source == null) {
    // No source → program still loads from the `program` content type via /api/form-options.
    parts.push("from a content type");
  }
  if (cfg.visible === true) parts.push("visible");
  if (cfg.visible === false) parts.push("hidden");
  if (cfg.required === true) parts.push("required");
  if (cfg.required === false) parts.push("optional");
  return parts;
}

type SourceKind = "content_type" | "database" | "related_field";

/** Prefer raw YAML keys so an empty database/content_type value still keeps the selected kind. */
function sourceKindOf(source: unknown): SourceKind | null {
  if (!source || typeof source !== "object" || Array.isArray(source)) return null;
  const s = source as Record<string, unknown>;
  if ("related_field" in s) return "related_field";
  if ("database" in s) return "database";
  if ("content_type" in s) return "content_type";
  return null;
}

function selectTargetLabel(kind: SourceKind): string {
  if (kind === "database") return "Select the database";
  if (kind === "related_field") return "Select the related field";
  return "Select the content type";
}

function toLeadFormOptions(rows: OptionRow[]): LeadFormOption[] {
  return rows.map((o) => ({
    value: String(o.value),
    label: typeof o.label === "string" ? o.label : String(o.value),
    title: typeof o.title === "string" ? o.title : undefined,
    description: typeof o.description === "string" ? o.description : undefined,
    badge: typeof o.badge === "string" ? o.badge : undefined,
    group: typeof o.group === "string" ? o.group : undefined,
  }));
}

function FieldPreviewModal({
  open,
  onOpenChange,
  name,
  cfg,
  effectiveRenderer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  name: string;
  cfg: FormFieldConfig;
  effectiveRenderer: LeadFormComponentRenderer;
}) {
  const yamlOptions = Array.isArray(cfg.options) ? cfg.options : [];
  const options = toLeadFormOptions(yamlOptions);
  const [previewValue, setPreviewValue] = useState("");
  const label = typeof cfg.label === "string" ? cfg.label : "";
  const placeholder = typeof cfg.placeholder === "string" ? cfg.placeholder : "";
  const helperText = typeof cfg.helper_text === "string" ? cfg.helper_text : "";
  const layout = cfg.layout === "showcase" ? "showcase" : ("grid" as const);

  useEffect(() => {
    if (open) setPreviewValue("");
  }, [open, name]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" data-testid={`dialog-field-preview-${name}`}>
        <DialogHeader>
          <DialogTitle className="text-sm">
            Preview · {name}
            <span className="ml-2 font-normal text-muted-foreground">
              ({rendererLabel(effectiveRenderer)})
            </span>
          </DialogTitle>
        </DialogHeader>
        <div className="rounded-md border bg-muted/30 p-3 space-y-2">
          {(label || helperText) && (
            <div className="space-y-0.5">
              {label ? <p className="text-xs font-medium">{label}</p> : null}
              {helperText ? (
                <p className="text-[11px] text-muted-foreground">{helperText}</p>
              ) : null}
            </div>
          )}
          {options.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              No options yet — add them under this field, then reopen preview.
            </p>
          ) : (
            <LeadFormFieldControl
              renderer={effectiveRenderer}
              field={{
                name,
                value: previewValue,
                onChange: setPreviewValue,
                onBlur: () => {},
                ref: () => {},
              }}
              options={options}
              placeholder={placeholder || "Select…"}
              layout={layout}
              testId={`preview-control-${name}`}
            />
          )}
        </div>
        <DialogFooter>
          <p className="text-[11px] text-muted-foreground mr-auto">
            Uses the options and layout configured below the renderer.
          </p>
          <Button type="button" size="sm" onClick={() => onOpenChange(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SortableOptionRow({
  id,
  index,
  option,
  fieldName,
  showRich,
  onPatch,
  onRemove,
}: {
  id: string;
  index: number;
  option: OptionRow;
  fieldName: string;
  showRich: boolean;
  onPatch: (index: number, patch: Record<string, string>) => void;
  onRemove: (index: number) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };
  const label =
    typeof option.label === "string" && option.label.trim()
      ? option.label
      : String(option.value || "Untitled");

  return (
    <div
      ref={setNodeRef}
      style={style}
      className="rounded-md border bg-background/80"
      data-testid={`form-option-row-${fieldName}-${index}`}
    >
      <div className="flex items-center gap-1 p-1.5">
        <button
          type="button"
          className="p-1 rounded text-muted-foreground hover:bg-muted cursor-grab active:cursor-grabbing shrink-0"
          aria-label="Drag to reorder"
          data-testid={`button-drag-option-${fieldName}-${index}`}
          {...attributes}
          {...listeners}
        >
          <IconGripVertical className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left hover:opacity-90"
          onClick={() => setExpanded((v) => !v)}
          data-testid={`button-toggle-option-${fieldName}-${index}`}
        >
          <span className="text-xs truncate flex-1">{label}</span>
          <span className="text-[10px] font-mono text-muted-foreground truncate max-w-[6rem] shrink-0">
            {String(option.value || "")}
          </span>
          <IconChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-180",
            )}
          />
        </button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-6 w-6 shrink-0 text-destructive"
          onClick={() => onRemove(index)}
          data-testid={`button-remove-option-${fieldName}-${index}`}
        >
          <IconTrash className="h-3.5 w-3.5" />
        </Button>
      </div>
      {expanded && (
        <div className="space-y-2 border-t border-border/60 px-2 pb-2 pt-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Value</Label>
            <Input
              className="h-8 text-xs font-mono"
              value={String(option.value ?? "")}
              onChange={(e) => onPatch(index, { value: e.target.value })}
              placeholder="submitted value"
              data-testid={`input-option-value-${fieldName}-${index}`}
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Label</Label>
            <Input
              className="h-8 text-xs"
              value={typeof option.label === "string" ? option.label : ""}
              onChange={(e) => onPatch(index, { label: e.target.value })}
              placeholder="shown to visitor"
              data-testid={`input-option-label-${fieldName}-${index}`}
            />
          </div>
          {showRich && (
            <>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Title</Label>
                <Input
                  className="h-8 text-xs"
                  value={typeof option.title === "string" ? option.title : ""}
                  onChange={(e) => onPatch(index, { title: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Description</Label>
                <Input
                  className="h-8 text-xs"
                  value={typeof option.description === "string" ? option.description : ""}
                  onChange={(e) => onPatch(index, { description: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Badge</Label>
                <Input
                  className="h-8 text-xs"
                  value={typeof option.badge === "string" ? option.badge : ""}
                  onChange={(e) => onPatch(index, { badge: e.target.value })}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Group</Label>
                <Input
                  className="h-8 text-xs"
                  value={typeof option.group === "string" ? option.group : ""}
                  onChange={(e) => onPatch(index, { group: e.target.value })}
                  placeholder="for grouped-list"
                />
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function FieldOptionsEditor({
  fieldName,
  options,
  showRich,
  onChange,
  onOpenPreview,
  hasSource,
}: {
  fieldName: string;
  options: OptionRow[];
  showRich: boolean;
  onChange: (next: OptionRow[]) => void;
  onOpenPreview?: () => void;
  hasSource?: boolean;
}) {
  const ids = useMemo(
    () => options.map((_, i) => `${fieldName}-opt-${i}`),
    [fieldName, options],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    onChange(arrayMove(options, oldIndex, newIndex));
  }

  function patch(index: number, patch: Record<string, string>) {
    const next = options.map((o, i) => (i === index ? { ...o, ...patch } : o));
    onChange(next);
  }

  function remove(index: number) {
    onChange(options.filter((_, i) => i !== index));
  }

  function add() {
    const n = options.length + 1;
    onChange([...options, { value: `option-${n}`, label: `Option ${n}` }]);
  }

  return (
    <div className="space-y-2" data-testid={`form-options-editor-${fieldName}`}>
      <div className="flex items-center gap-2 min-w-0">
        <Label className="text-xs font-medium">Options</Label>
        {onOpenPreview && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 px-2 text-xs shrink-0"
            onClick={onOpenPreview}
            data-testid={`button-open-preview-${fieldName}`}
          >
            Open preview
          </Button>
        )}
      </div>
      {options.length === 0 ? (
        <p className="text-[11px] text-muted-foreground">
          No options yet
          {hasSource ? " (loaded from the source configured above)" : ""}.
        </p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={ids} strategy={verticalListSortingStrategy}>
            <div className="space-y-1.5">
              {options.map((opt, index) => (
                <SortableOptionRow
                  key={ids[index]}
                  id={ids[index]}
                  index={index}
                  option={opt}
                  fieldName={fieldName}
                  showRich={showRich}
                  onPatch={patch}
                  onRemove={remove}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="h-7 w-full justify-center text-xs border border-dashed border-border/70"
        onClick={add}
        data-testid={`button-add-option-${fieldName}`}
      >
        <IconPlus className="h-3.5 w-3.5 mr-1" />
        Add option
      </Button>
    </div>
  );
}

function FormFieldEditorRow({
  name,
  cfg,
  onFieldChange,
  onFieldRemove,
  onFieldRename,
  contentTypes,
  databases,
  forceOpen,
}: {
  name: string;
  cfg: FormFieldConfig;
  onFieldChange: FormFieldsCardProps["onFieldChange"];
  onFieldRemove: (name: string) => void;
  onFieldRename: (from: string, to: string) => void;
  contentTypes: Array<{ name: string; label?: string }>;
  databases: Array<{ slug: string; name?: string }>;
  forceOpen?: boolean;
}) {
  const [open, setOpen] = useState(!!forceOpen);
  const [nameDraft, setNameDraft] = useState(name);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [loadOptions, setLoadOptions] = useState(cfg.source != null);
  const [sourceOpen, setSourceOpen] = useState(true);

  useEffect(() => {
    if (forceOpen) setOpen(true);
  }, [forceOpen]);

  useEffect(() => {
    setNameDraft(name);
  }, [name]);

  useEffect(() => {
    setLoadOptions(cfg.source != null);
  }, [cfg.source]);

  const visible = cfg.visible === true;
  const required = cfg.required === true;
  const defaultValue =
    typeof cfg.default === "string"
      ? cfg.default
      : typeof cfg.default === "number" || typeof cfg.default === "boolean"
        ? String(cfg.default)
        : "";
  const runtimeDefault = defaultComponentRenderer(name);
  const hasExplicitRenderer =
    typeof cfg.component_renderer === "string" && cfg.component_renderer.trim().length > 0;
  const effectiveRenderer = (
    hasExplicitRenderer ? cfg.component_renderer!.trim() : runtimeDefault
  ) as LeadFormComponentRenderer;
  const isChoice = CHOICE_RENDERERS.has(effectiveRenderer);
  const canPreview = PREVIEW_RENDERERS.has(effectiveRenderer);
  const showRichOptions =
    effectiveRenderer === "cards" ||
    effectiveRenderer === "simple-list" ||
    effectiveRenderer === "grouped-list";
  const summary = summarizeField(cfg, name);
  const optionRows: OptionRow[] = Array.isArray(cfg.options)
    ? cfg.options.map((o) => ({ ...o, value: String(o.value) }))
    : [];
  const parsedSource =
    cfg.source != null
      ? parseFormFieldSource(
          cfg.source as
            | string
            | {
                content_type?: string;
                database?: string;
                related_field?: string;
                query?: string;
              },
        )
      : null;
  const kind = sourceKindOf(cfg.source) ?? "content_type";

  function commitName() {
    const next = nameDraft.trim();
    if (!next || next === name) {
      setNameDraft(name);
      return;
    }
    onFieldRename(name, next);
  }

  function writeSource(partial: {
    kind?: SourceKind;
    content_type?: string;
    database?: string;
    related_field?: string;
    query?: string;
    value_path?: string;
    label_path?: string;
  }) {
    const nextKind = partial.kind ?? kind;
    const value_path = partial.value_path ?? parsedSource?.value_path ?? "";
    const label_path = partial.label_path ?? parsedSource?.label_path ?? "";
    const query = partial.query ?? parsedSource?.query ?? "";
    const source: Record<string, string> = {
      value_path,
      label_path,
    };
    if (query.trim()) source.query = query.trim();
    if (nextKind === "content_type") {
      source.content_type =
        partial.content_type ??
        parsedSource?.content_type ??
        contentTypes[0]?.name ??
        "program";
    } else if (nextKind === "database") {
      // Always keep the `database` key so kind does not snap back to content_type
      // when the databases list is still empty.
      source.database =
        partial.database ?? parsedSource?.database ?? databases[0]?.slug ?? "";
    } else {
      source.related_field =
        partial.related_field ?? parsedSource?.related_field ?? "programs";
    }
    onFieldChange(name, "source", source);
  }

  function setRenderer(val: string) {
    onFieldChange(name, "component_renderer", val);
    if (!CHOICE_RENDERERS.has(val) && cfg.source != null) {
      onFieldChange(name, "source", undefined);
      setLoadOptions(false);
    }
  }

  return (
    <>
      <Collapsible
        open={open}
        onOpenChange={setOpen}
        className="rounded-md border bg-background/60"
        data-testid={`form-field-row-${name}`}
      >
        <div className="flex w-full items-center gap-2 p-2.5">
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-2 text-left hover:opacity-90"
              data-testid={`button-toggle-form-field-${name}`}
            >
              <IconClipboardList className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
              <span className="text-xs font-mono font-medium shrink-0 truncate max-w-[7rem]">
                {name}
              </span>
              <div className="flex flex-wrap gap-1 min-w-0 flex-1 justify-end">
                {summary.length > 0 ? (
                  summary.map((part) => (
                    <Badge
                      key={part}
                      variant="secondary"
                      className={
                        FIELD_FLAG_BADGES.has(part)
                          ? "text-[10px] px-1.5 py-0 leading-4 font-normal font-mono"
                          : "text-[10px] px-1.5 py-0 leading-4 font-normal font-mono bg-primary/15 text-foreground border-transparent"
                      }
                    >
                      {part}
                    </Badge>
                  ))
                ) : (
                  <span className="text-[10px] text-muted-foreground italic">no options set</span>
                )}
              </div>
              <IconChevronDown
                className={cn(
                  "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                  open && "rotate-180",
                )}
              />
            </button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <div className="space-y-3 px-2.5 pb-2.5 pt-0 border-t border-border/60">
            <div className="space-y-1 pt-2">
              <div className="flex items-center justify-between gap-2">
                <Label className="text-xs text-muted-foreground">Field name</Label>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs text-destructive"
                  onClick={() => {
                    if (window.confirm(`Remove field “${name}” from this form?`)) {
                      onFieldRemove(name);
                    }
                  }}
                  data-testid={`button-remove-field-${name}`}
                >
                  <IconTrash className="h-3.5 w-3.5 mr-1" />
                  Remove field
                </Button>
              </div>
              <Input
                autoFocus={!!forceOpen}
                className="h-8 text-xs font-mono"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onBlur={commitName}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitName();
                  }
                }}
                data-testid={`input-field-name-${name}`}
              />
            </div>

            <div className="flex flex-wrap items-center gap-4">
              <div className="flex items-center gap-1.5">
                <Switch
                  id={`field-${name}-visible`}
                  checked={visible}
                  onCheckedChange={(v) => onFieldChange(name, "visible", v)}
                  data-testid={`switch-field-${name}-visible`}
                />
                <Label htmlFor={`field-${name}-visible`} className="text-xs text-muted-foreground">
                  Visible
                </Label>
              </div>
              <div className="flex items-center gap-1.5">
                <Switch
                  id={`field-${name}-required`}
                  checked={required}
                  onCheckedChange={(v) => onFieldChange(name, "required", v)}
                  data-testid={`switch-field-${name}-required`}
                />
                <Label htmlFor={`field-${name}-required`} className="text-xs text-muted-foreground">
                  Required
                </Label>
              </div>
            </div>

            <div className="space-y-1">
              <Label htmlFor={`field-${name}-default`} className="text-xs text-muted-foreground">
                Default
              </Label>
              <Input
                id={`field-${name}-default`}
                value={defaultValue}
                onChange={(e) => onFieldChange(name, "default", e.target.value)}
                placeholder="e.g. auto, or a static value"
                className="h-8 text-xs font-mono"
                data-testid={`input-field-${name}-default`}
              />
            </div>

            <div
              className="space-y-3 rounded-md border border-border/60 p-2.5"
              data-testid={`choice-config-${name}`}
            >
              <div className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <Label className="text-xs text-muted-foreground">Component renderer</Label>
                  {!hasExplicitRenderer && (
                    <span className="text-[10px] text-muted-foreground">
                      Runtime default: {rendererLabel(runtimeDefault)}
                    </span>
                  )}
                </div>
                <Select value={effectiveRenderer} onValueChange={setRenderer}>
                  <SelectTrigger
                    className="h-8 text-xs"
                    data-testid={`select-field-${name}-component-renderer`}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {COMPONENT_RENDERERS.map((r) => (
                      <SelectItem key={r.value} value={r.value} className="text-xs">
                        {r.label}
                        {r.value === runtimeDefault && !hasExplicitRenderer
                          ? " (runtime default)"
                          : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {isChoice && effectiveRenderer === "cards" && (
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">Cards layout</Label>
                  <Select
                    value={cfg.layout === "showcase" ? "showcase" : "grid"}
                    onValueChange={(v) => onFieldChange(name, "layout", v)}
                  >
                    <SelectTrigger
                      className="h-8 text-xs"
                      data-testid={`select-field-${name}-layout`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="grid" className="text-xs">
                        Grid (equal columns)
                      </SelectItem>
                      <SelectItem value="showcase" className="text-xs">
                        Showcase (first full width)
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              {isChoice && (
                <>
                <div
                  className="rounded-md border border-border/60 bg-muted"
                  data-testid={`source-config-${name}`}
                >
                  <div className="flex items-center gap-1.5 p-2.5">
                    <button
                      type="button"
                      className="p-0.5 rounded text-muted-foreground hover:bg-muted shrink-0"
                      onClick={() => setSourceOpen((v) => !v)}
                      aria-expanded={sourceOpen}
                      aria-label={sourceOpen ? "Collapse source settings" : "Expand source settings"}
                      data-testid={`button-toggle-source-${name}`}
                    >
                      <IconChevronDown
                        className={cn(
                          "h-3.5 w-3.5 transition-transform",
                          !sourceOpen && "-rotate-90",
                        )}
                      />
                    </button>
                    <Label
                      htmlFor={`field-${name}-load-source`}
                      className="text-xs font-medium flex-1 min-w-0"
                    >
                      Load options from a source
                    </Label>
                    <Switch
                      id={`field-${name}-load-source`}
                      checked={loadOptions}
                      onCheckedChange={(on) => {
                        setLoadOptions(on);
                        if (on) setSourceOpen(true);
                        if (!on) onFieldChange(name, "source", undefined);
                        else writeSource({ kind: "content_type" });
                      }}
                      data-testid={`switch-field-${name}-source`}
                    />
                  </div>
                  {sourceOpen && (
                  <div className="space-y-2 px-2.5 pb-2.5 border-t border-border/40 pt-2">
                  <p className="text-[11px] text-muted-foreground">
                    Pulls the choice list from a catalog, database, or related field on this page.
                    Manual options below match by <span className="font-mono">value</span>: same
                    value overrides that item; no match appends a new one. The field only shows
                    when the source returns 2+ items (0 or 1 hides it, even if you added manual
                    options).
                  </p>
                  {loadOptions && (
                    <div className="space-y-2">
                      <div className="flex items-end gap-2">
                        <div className="space-y-1 shrink-0">
                          <Label className="text-xs text-muted-foreground">
                            Load options from
                          </Label>
                          <Select
                            value={kind}
                            onValueChange={(v) => writeSource({ kind: v as SourceKind })}
                          >
                            <SelectTrigger
                              className="h-8 text-xs w-[11rem]"
                              data-testid={`select-field-${name}-source-kind`}
                            >
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="content_type" className="text-xs">
                                Content type
                              </SelectItem>
                              <SelectItem value="database" className="text-xs">
                                Database
                              </SelectItem>
                              <SelectItem value="related_field" className="text-xs">
                                Related field
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1 min-w-0 flex-1">
                          <Label className="text-xs text-muted-foreground">
                            {selectTargetLabel(kind)}
                          </Label>
                          {kind === "content_type" && (
                            <Select
                              value={parsedSource?.content_type || contentTypes[0]?.name || ""}
                              onValueChange={(v) =>
                                writeSource({ kind: "content_type", content_type: v })
                              }
                            >
                              <SelectTrigger
                                className="h-8 text-xs"
                                data-testid={`select-field-${name}-source-target`}
                              >
                                <SelectValue placeholder="Pick a content type…" />
                              </SelectTrigger>
                              <SelectContent>
                                {contentTypes.map((ct) => (
                                  <SelectItem key={ct.name} value={ct.name} className="text-xs">
                                    {ct.label || ct.name}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          )}
                          {kind === "database" && (
                            databases.length > 0 ? (
                              <Select
                                value={parsedSource?.database || databases[0]?.slug || ""}
                                onValueChange={(v) =>
                                  writeSource({ kind: "database", database: v })
                                }
                              >
                                <SelectTrigger
                                  className="h-8 text-xs"
                                  data-testid={`select-field-${name}-source-target`}
                                >
                                  <SelectValue placeholder="Pick a database…" />
                                </SelectTrigger>
                                <SelectContent>
                                  {databases.map((db) => (
                                    <SelectItem key={db.slug} value={db.slug} className="text-xs">
                                      {db.name || db.slug}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            ) : (
                              <Input
                                className="h-8 text-xs font-mono"
                                value={parsedSource?.database ?? ""}
                                onChange={(e) =>
                                  writeSource({ kind: "database", database: e.target.value })
                                }
                                placeholder="database slug"
                                data-testid={`input-field-${name}-source-target`}
                              />
                            )
                          )}
                          {kind === "related_field" && (
                            <Input
                              className="h-8 text-xs font-mono"
                              value={parsedSource?.related_field ?? ""}
                              onChange={(e) =>
                                writeSource({
                                  kind: "related_field",
                                  related_field: e.target.value,
                                })
                              }
                              placeholder="e.g. programs"
                              data-testid={`input-field-${name}-source-target`}
                            />
                          )}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs text-muted-foreground">Query filter</Label>
                        <Input
                          className="h-8 text-xs font-mono"
                          value={parsedSource?.query ?? ""}
                          onChange={(e) => writeSource({ query: e.target.value })}
                          placeholder="e.g. purchasable=true"
                          data-testid={`input-field-${name}-source-query`}
                        />
                        <p className="text-[10px] text-muted-foreground">
                          Optional. Narrows which items load — same idea as a URL query string:{" "}
                          <code className="font-mono text-[10px]">key=value</code>
                          {" "}or{" "}
                          <code className="font-mono text-[10px]">a=1&amp;b=2</code>.
                        </p>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Value path</Label>
                          <Input
                            className="h-8 text-xs font-mono"
                            value={parsedSource?.value_path ?? ""}
                            onChange={(e) => writeSource({ value_path: e.target.value })}
                            placeholder="e.g. bc_slug"
                            data-testid={`input-field-${name}-value-path`}
                          />
                          <p className="text-[10px] text-muted-foreground">
                            Field on each source item whose value is sent when the form is
                            submitted.
                          </p>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs text-muted-foreground">Label path</Label>
                          <Input
                            className="h-8 text-xs font-mono"
                            value={parsedSource?.label_path ?? ""}
                            onChange={(e) => writeSource({ label_path: e.target.value })}
                            placeholder="e.g. title"
                            data-testid={`input-field-${name}-label-path`}
                          />
                          <p className="text-[10px] text-muted-foreground">
                            Field on each source item shown as the option text to the visitor.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                  </div>
                  )}
                </div>

                <FieldOptionsEditor
                  fieldName={name}
                  options={optionRows}
                  showRich={showRichOptions}
                  onChange={(next) => onFieldChange(name, "options", next)}
                  onOpenPreview={canPreview ? () => setPreviewOpen(true) : undefined}
                  hasSource={loadOptions || cfg.source != null}
                />
                </>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
      {canPreview && (
        <FieldPreviewModal
          open={previewOpen}
          onOpenChange={setPreviewOpen}
          name={name}
          cfg={cfg}
          effectiveRenderer={effectiveRenderer}
        />
      )}
    </>
  );
}

function nextUniqueFieldName(existing: Set<string>): string {
  if (!existing.has("new_field")) return "new_field";
  let n = 2;
  while (existing.has(`new_field_${n}`)) n += 1;
  return `new_field_${n}`;
}

/**
 * Conversion-tab card for lead-form fields.
 */
export function FormFieldsCard({
  fields,
  onFieldChange,
  onFieldAdd,
  onFieldRemove,
  onFieldRename,
}: FormFieldsCardProps) {
  const [editing, setEditing] = useState(false);
  const [forceOpenName, setForceOpenName] = useState<string | null>(null);
  const names = sortFieldNames(Object.keys(fields));
  const { data: contentTypesRaw } = useQuery({
    queryKey: ["/api/content-types"],
    staleTime: 5 * 60 * 1000,
  });
  const { data: databasesRaw } = useQuery({
    queryKey: ["/api/databases"],
    staleTime: 5 * 60 * 1000,
  });
  const contentTypes: Array<{ name: string; label?: string }> = Array.isArray(contentTypesRaw)
    ? contentTypesRaw
    : Array.isArray((contentTypesRaw as { types?: unknown })?.types)
      ? ((contentTypesRaw as { types: Array<{ name: string; label?: string }> }).types)
      : [];
  const databases: Array<{ slug: string; name?: string }> = (
    Array.isArray(databasesRaw)
      ? databasesRaw
      : Array.isArray((databasesRaw as { databases?: unknown })?.databases)
        ? ((databasesRaw as { databases: unknown[] }).databases)
        : []
  )
    .map((raw) => {
      const db = raw as { slug?: string; name?: string; label?: string };
      const slug = String(db.slug ?? db.name ?? "").trim();
      if (!slug) return null;
      return {
        slug,
        name: typeof db.label === "string" && db.label.trim() ? db.label : db.name || slug,
      };
    })
    .filter((db): db is { slug: string; name?: string } => db != null);

  function startAdd() {
    const name = nextUniqueFieldName(new Set(names));
    onFieldAdd(name);
    setEditing(true);
    setForceOpenName(name);
  }

  function toggleEditing() {
    setEditing((v) => !v);
  }

  return (
    <div
      className="rounded-md border bg-muted/40 p-3 space-y-3"
      data-testid="card-form-fields"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <IconClipboardList className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium">Fields</span>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={toggleEditing}
          data-testid="button-edit-form-fields"
        >
          {editing ? <IconX className="h-3.5 w-3.5" /> : <IconPencil className="h-3.5 w-3.5" />}
        </Button>
      </div>

      <div className="text-[11px] text-muted-foreground space-y-1" data-testid="form-fields-source-education">
        <p>
          These are the fields on this form. Expand one to change visibility, required, default,
          look, and where choice options come from.
        </p>
        <details className="text-[10px]">
          <summary className="cursor-pointer text-foreground/80 hover:text-foreground">
            Read more (advanced)
          </summary>
          <div className="mt-1 space-y-1.5 list-disc">
            <p>
              Choice options use <code className="font-mono">source</code> (exactly one of{" "}
              <code className="font-mono">content_type</code>,{" "}
              <code className="font-mono">database</code>, or{" "}
              <code className="font-mono">related_field</code>) plus{" "}
              <code className="font-mono">value_path</code> /{" "}
              <code className="font-mono">label_path</code>. Manual{" "}
              <code className="font-mono">options[]</code> merge by{" "}
              <code className="font-mono">value</code> (match overrides; else append). With
              source, visibility follows catalog size (2+ show; 0/1 hide).
            </p>
            <p>
              <code className="font-mono">referral_key</code> maps to Breathecode{" "}
              <code className="font-mono">form_entry.referral_key</code>.
            </p>
            <ul className="list-disc pl-4 space-y-0.5">
              <li>
                Parse: <code className="font-mono">shared/parseFormFieldSource.ts</code>
              </li>
              <li>
                Catalog API: <code className="font-mono">server/query-options.ts</code>
              </li>
            </ul>
          </div>
        </details>
      </div>

      {names.length === 0 && !editing ? (
        <p className="text-xs text-muted-foreground" data-testid="text-form-fields-empty">
          No fields on this form yet.
        </p>
      ) : !editing ? (
        <div className="divide-y divide-border/60" data-testid="form-fields-summary">
          {names.map((n) => {
            const summary = summarizeField(fields[n] ?? {}, n);
            return (
              <div key={n} className="flex items-start gap-2 min-w-0 py-2 first:pt-0 last:pb-0">
                <IconClipboardList className="h-3.5 w-3.5 shrink-0 text-muted-foreground mt-0.5" />
                <span className="text-xs font-mono w-28 shrink-0 pt-0.5 truncate" title={n}>
                  {n}
                </span>
                <div className="flex flex-wrap gap-1 min-w-0">
                  {summary.length > 0 ? (
                    summary.map((part) => (
                      <Badge
                        key={part}
                        variant="secondary"
                        className={
                          FIELD_FLAG_BADGES.has(part)
                            ? "text-[11px] px-1.5 py-0 leading-4 font-normal font-mono"
                            : "text-[11px] px-1.5 py-0 leading-4 font-normal font-mono bg-primary/15 text-foreground border-transparent"
                        }
                      >
                        {part}
                      </Badge>
                    ))
                  ) : (
                    <span className="text-xs text-muted-foreground italic">no options set</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2" data-testid="form-fields-editor">
          {names.map((n) => (
            <FormFieldEditorRow
              key={n}
              name={n}
              cfg={fields[n] ?? {}}
              onFieldChange={onFieldChange}
              onFieldRemove={onFieldRemove}
              onFieldRename={(from, to) => {
                if (names.includes(to) && to !== from) {
                  window.alert(`Field “${to}” already exists.`);
                  setForceOpenName(to);
                  return;
                }
                onFieldRename(from, to);
                setForceOpenName(to);
              }}
              contentTypes={contentTypes}
              databases={databases}
              forceOpen={forceOpenName === n}
            />
          ))}
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 w-full justify-center text-xs border border-dashed border-border/70"
            onClick={startAdd}
            data-testid="button-add-form-field"
          >
            <IconPlus className="h-3.5 w-3.5 mr-1" />
            Add field
          </Button>
        </div>
      )}
    </div>
  );
}
