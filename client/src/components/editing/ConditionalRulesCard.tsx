import { useEffect, useMemo, useState } from "react";
import { Braces } from "lucide-react";
import {
  IconArrowRight,
  IconCircleCheck,
  IconGitBranch,
  IconGripVertical,
  IconInfoCircle,
  IconMinus,
  IconPencil,
  IconPlus,
  IconRobot,
  IconTags,
  IconTargetArrow,
  IconTrash,
  IconWebhook,
  IconX,
} from "@tabler/icons-react";
import type { ElementType } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
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
import * as yaml from "js-yaml";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { SuccessCard } from "./SuccessCard";
import { WebhookCard } from "./WebhookCard";
import { AutomationsTagsCard } from "./AutomationsTagsCard";
import { TemplateCodeInput } from "./TemplateCodeInput";
import { VariableTypeChooserModal } from "./VariableTypeChooserModal";
import { SingleVariablePickerModal } from "./SingleVariablePickerModal";
import { VariableDetailModal } from "./VariableDetailModal";
import type { Section } from "@shared/schema";

export type FormOverrideCondition = {
  field_property_slug?: string;
  form_field_slug?: string;
  entry_field_slug?: string;
  match_method?: "equals" | "contains";
  value?: unknown;
  [key: string]: unknown;
};

export type FormOverrideRule = {
  conditions?: FormOverrideCondition[];
  conversion_name?: string;
  success?: {
    url?: string;
    message?: string;
    reload_entry_fields?: boolean;
  };
  tags?: string;
  automations?: string;
  webhook?: {
    url?: string;
    method?: "POST" | "GET";
    headers?: Record<string, string>;
    fail_silently?: boolean;
  };
  messages?: Record<string, unknown>;
  [key: string]: unknown;
};

export type FormDefaultsForRules = {
  conversion_name?: string | null;
  success?: {
    url?: string;
    message?: string;
    reload_entry_fields?: boolean;
  };
  tags?: string;
  automations?: string;
  webhook?: {
    url?: string;
    method?: "POST" | "GET";
    headers?: Record<string, string>;
    fail_silently?: boolean;
  };
  messages?: Record<string, unknown>;
};

/** Keys we serialize with equality-to-default strip (includes YAML-only messages). */
const CANONICAL_OUTCOME_KEYS = [
  "conversion_name",
  "success",
  "tags",
  "automations",
  "webhook",
  "messages",
] as const;

type CanonicalOutcomeKey = (typeof CANONICAL_OUTCOME_KEYS)[number];

/** Change… menu = only outcomes that already have Forms-tab cards (no Messages). */
const CHANGE_MENU: {
  key: CanonicalOutcomeKey;
  label: string;
  Icon: ElementType;
}[] = [
  { key: "conversion_name", label: "Conversion goal", Icon: IconTargetArrow },
  { key: "success", label: "Success", Icon: IconCircleCheck },
  { key: "webhook", label: "Webhook", Icon: IconWebhook },
  { key: "tags", label: "Tags", Icon: IconTags },
  { key: "automations", label: "Automations", Icon: IconRobot },
];

const CHANGE_MENU_KEYS = new Set(CHANGE_MENU.map((m) => m.key));

/** Display slots for THEN cards (tags+automations share one card). */
type ThenSlot = "conversion_name" | "success" | "webhook" | "automations_tags";

function thenSlotsFromRule(rule: FormOverrideRule): ThenSlot[] {
  const slots: ThenSlot[] = [];
  if (rule.conversion_name !== undefined) slots.push("conversion_name");
  if (rule.success !== undefined) slots.push("success");
  if (rule.webhook !== undefined) slots.push("webhook");
  if (rule.tags !== undefined || rule.automations !== undefined) {
    slots.push("automations_tags");
  }
  return slots;
}

function menuKeyToThenSlot(key: CanonicalOutcomeKey): ThenSlot | null {
  if (key === "tags" || key === "automations") return "automations_tags";
  if (key === "conversion_name" || key === "success" || key === "webhook") return key;
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const keys = Array.from(new Set([...Object.keys(a), ...Object.keys(b)]));
    for (const k of keys) {
      if (!deepEqual(a[k], b[k])) return false;
    }
    return true;
  }
  return false;
}

/** Deep-omit leaves equal to defaults; drop empty objects. */
function omitEqualsDefault(value: unknown, defaults: unknown): unknown {
  if (value === undefined) return undefined;
  if (deepEqual(value, defaults)) return undefined;
  if (isPlainObject(value) && isPlainObject(defaults)) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) {
      const next = omitEqualsDefault(v, defaults[k]);
      if (next !== undefined) out[k] = next;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  if (isPlainObject(value) && defaults == null) {
    return value;
  }
  return value;
}

function normalizeCondition(c: FormOverrideCondition): FormOverrideCondition {
  const match_method = c.match_method === "contains" ? "contains" : "equals";
  const value = c.value ?? "";
  if (typeof c.field_property_slug === "string" && c.field_property_slug.trim()) {
    return {
      field_property_slug: c.field_property_slug.trim(),
      match_method,
      value,
    };
  }
  if (typeof c.form_field_slug === "string" && c.form_field_slug.trim()) {
    return {
      field_property_slug: `{{ form.${c.form_field_slug.trim()} }}`,
      match_method,
      value,
    };
  }
  if (typeof c.entry_field_slug === "string" && c.entry_field_slug.trim()) {
    return {
      field_property_slug: `{{ entry.${c.entry_field_slug.trim()} }}`,
      match_method,
      value,
    };
  }
  return {
    field_property_slug: "",
    match_method,
    value,
  };
}

function serializeRule(
  rule: FormOverrideRule,
  defaults: FormDefaultsForRules,
): FormOverrideRule | null {
  // Drop empty IF rows (e.g. Add rule then close without filling); keep only usable conditions.
  const conditions = (rule.conditions ?? [])
    .map((c) => {
      const n = normalizeCondition(c);
      return {
        field_property_slug: String(n.field_property_slug ?? "").trim(),
        ...(n.match_method === "contains" ? { match_method: "contains" as const } : {}),
        value: n.value ?? "",
      };
    })
    .filter((c) => c.field_property_slug.length > 0);

  if (conditions.length === 0) return null;

  const out: FormOverrideRule = { conditions };

  for (const key of CANONICAL_OUTCOME_KEYS) {
    if (!(key in rule) || rule[key] === undefined) continue;
    const stripped = omitEqualsDefault(rule[key], defaults[key as keyof FormDefaultsForRules]);
    if (stripped !== undefined) {
      (out as Record<string, unknown>)[key] = stripped;
    }
  }

  // Preserve non-canonical keys already in YAML
  for (const [k, v] of Object.entries(rule)) {
    if (k === "conditions" || (CANONICAL_OUTCOME_KEYS as readonly string[]).includes(k)) continue;
    if (v !== undefined) out[k] = v;
  }

  return out;
}

function operandPillLabel(raw: string): string {
  const trimmed = raw.trim() || "?";
  if (/^\{\{[\s\S]*\}\}$/.test(trimmed)) {
    return trimmed.replace(/^\{\{\s*/, "").replace(/\s*\}\}$/, "");
  }
  return trimmed;
}

/** Same scale as tags elsewhere (secondary Badge); clamp with …; native title on hover. */
function ValueBadge({ value, className }: { value: string; className?: string }) {
  const full = value.trim() || "?";
  return (
    <Badge
      variant="secondary"
      className={cn(
        "max-w-[12rem] shrink px-1.5 py-0.5 text-[11px] leading-4 font-normal font-mono truncate",
        className,
      )}
      title={full}
    >
      {operandPillLabel(full)}
    </Badge>
  );
}

const LIST_BULLET =
  "w-3 shrink-0 text-center text-[10px] text-muted-foreground/70 select-none";
const CHANGES_LABEL =
  "w-[3.75rem] shrink-0 text-[11px] font-bold tracking-wide text-foreground";

function ruleChangeLabels(rule: FormOverrideRule): string[] {
  const changes = CANONICAL_OUTCOME_KEYS.filter((k) => rule[k] !== undefined);
  if (changes.length === 0) return ["no changes"];
  return changes.map((k) => CHANGE_MENU.find((m) => m.key === k)?.label ?? k);
}

function ruleTitleTooltip(rule: FormOverrideRule): string {
  const conds = (rule.conditions ?? []).map(normalizeCondition);
  const condParts = conds.map((c) => {
    const left = String(c.field_property_slug ?? "");
    const right = String(c.value ?? "");
    const op = c.match_method === "contains" ? "contains" : "equals";
    return `${left} ${op} ${right}`.trim();
  });
  const changes = ruleChangeLabels(rule).join(", ");
  return [...condParts, `changes: ${changes}`].filter(Boolean).join(" · ");
}

/** Compact one-line summary for read mode. */
function RuleOneLineView({ rule, index }: { rule: FormOverrideRule; index: number }) {
  const conds = (rule.conditions ?? []).map(normalizeCondition);
  const thenLabels = ruleChangeLabels(rule);
  const first = conds[0];
  const extraConds = Math.max(0, conds.length - 1);
  const title = ruleTitleTooltip(rule);

  return (
    <div
      className="flex items-center gap-1.5 min-w-0 overflow-hidden text-[11px]"
      title={title}
      data-testid={`form-rule-summary-${index}`}
    >
      <span className="shrink-0 font-medium text-foreground">Rule {index + 1}</span>
      {first ? (
        <>
          <ValueBadge value={String(first.field_property_slug ?? "")} />
          <span className="shrink-0 italic text-muted-foreground/80">
            {first.match_method === "contains" ? "contains" : "equals"}
          </span>
          <ValueBadge value={String(first.value ?? "")} />
          {extraConds > 0 && (
            <span className="shrink-0 text-muted-foreground">+{extraConds}</span>
          )}
        </>
      ) : (
        <span className="italic text-muted-foreground">No conditions</span>
      )}
      <IconArrowRight
        className="h-3 w-3 shrink-0 text-muted-foreground/70"
        aria-hidden
      />
      {thenLabels.map((label) => (
        <span
          key={label}
          className="inline-flex max-w-[8rem] shrink items-center truncate rounded-full bg-primary/5 px-2 py-0.5 font-medium tracking-wide text-foreground"
        >
          {label}
        </span>
      ))}
    </div>
  );
}

function RuleSummaryView({ rule }: { rule: FormOverrideRule }) {
  const conds = (rule.conditions ?? []).map(normalizeCondition);
  const thenLabels = ruleChangeLabels(rule);

  return (
    <div className="min-w-0">
      {conds.length === 0 ? (
        <p className="text-xs text-muted-foreground italic">No conditions</p>
      ) : (
        <div className="space-y-1.5 min-w-0">
          {conds.map((c, i) => {
            const left = String(c.field_property_slug ?? "");
            const right = String(c.value ?? "");
            const op = c.match_method === "contains" ? "contains" : "equals";
            const full = `${left} ${op} ${right}`.trim();
            return (
              <div
                key={i}
                className="flex items-center gap-1.5 text-[11px] min-w-0 overflow-hidden"
                title={full}
              >
                <span className={LIST_BULLET} aria-hidden>
                  —
                </span>
                <ValueBadge value={left} />
                <span className="shrink-0 text-[11px] italic text-muted-foreground/80">
                  {op}
                </span>
                <ValueBadge value={right} />
              </div>
            );
          })}
        </div>
      )}
      <div className="mt-3 flex items-center gap-1.5 text-[11px] min-w-0 overflow-hidden">
        <span className={CHANGES_LABEL}>CHANGES</span>
        {thenLabels.map((label) => (
          <span
            key={label}
            className="inline-flex max-w-[12rem] shrink items-center truncate rounded-full bg-primary/5 px-2 py-0.5 text-[11px] font-medium tracking-wide text-foreground"
            title={label}
          >
            {label}
          </span>
        ))}
      </div>
    </div>
  );
}

function parseTagsString(raw: string | undefined): string[] {
  if (!raw) return [];
  return String(raw)
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function countRulesChangingKey(
  rules: FormOverrideRule[] | null | undefined,
  key: CanonicalOutcomeKey,
): number {
  if (!Array.isArray(rules)) return 0;
  return rules.filter((r) => r && typeof r === "object" && r[key] !== undefined).length;
}

/** Count rules that override any of the given outcome keys (deduped). */
export function countRulesChangingAnyKey(
  rules: FormOverrideRule[] | null | undefined,
  keys: readonly CanonicalOutcomeKey[],
): number {
  if (!Array.isArray(rules) || keys.length === 0) return 0;
  return rules.filter(
    (r) => r && typeof r === "object" && keys.some((k) => r[k] !== undefined),
  ).length;
}

function SortableRuleRow({
  id,
  children,
}: {
  id: string;
  children: (handleProps: {
    attributes: Record<string, unknown>;
    listeners: Record<string, unknown> | undefined;
  }) => React.ReactNode;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
  };
  return (
    <div ref={setNodeRef} style={style}>
      {children({
        attributes: attributes as unknown as Record<string, unknown>,
        listeners: listeners as unknown as Record<string, unknown> | undefined,
      })}
    </div>
  );
}

export interface ConditionalRulesCardProps {
  rules: FormOverrideRule[];
  onChange: (rules: FormOverrideRule[]) => void;
  formDefaults: FormDefaultsForRules;
  conversionEventNames?: string[];
  automationSuggestions?: string[];
  tagSuggestions?: string[];
  contentType?: string;
  singleEntry?: Record<string, unknown>;
  allSections?: Section[];
  locale?: string;
  /** Scroll target id prefix for badges (rule index appended). */
  idPrefix?: string;
}

export function ConditionalRulesCard({
  rules,
  onChange,
  formDefaults,
  conversionEventNames = [],
  automationSuggestions = [],
  tagSuggestions = [],
  contentType = "",
  singleEntry,
  allSections,
  locale = "en",
  idPrefix = "form-rule",
}: ConditionalRulesCardProps) {
  const [editing, setEditing] = useState(false);
  /** Index in `rules` while editing an existing rule; `rules.length` while drafting a new one. */
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [ruleDraft, setRuleDraft] = useState<FormOverrideRule | null>(null);
  const [draftIsNew, setDraftIsNew] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<{
    condIndex: number;
    side: "left" | "right";
  } | null>(null);
  const [varModal, setVarModal] = useState<"chooser" | "single" | "global" | null>(null);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [overDragId, setOverDragId] = useState<string | null>(null);

  function cloneRule(rule: FormOverrideRule): FormOverrideRule {
    return JSON.parse(JSON.stringify(rule)) as FormOverrideRule;
  }

  function openRuleEditor(index: number, rule: FormOverrideRule, isNew: boolean) {
    setEditingIndex(index);
    setRuleDraft(cloneRule(rule));
    setDraftIsNew(isNew);
  }

  function cancelRuleEditor() {
    setEditingIndex(null);
    setRuleDraft(null);
    setDraftIsNew(false);
    setPickerTarget(null);
    setVarModal(null);
  }

  function doneRuleEditor() {
    if (editingIndex == null || ruleDraft == null) return;
    const next = draftIsNew
      ? [...rules, ruleDraft]
      : rules.map((r, i) => (i === editingIndex ? ruleDraft : r));
    commitSerialized(next);
    cancelRuleEditor();
  }

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ids = useMemo(
    () => rules.map((_, i) => `rule-${i}`),
    [rules],
  );

  /** While dragging, numbers follow the preview order (top = Rule 1). */
  const displayOrderIds = useMemo(() => {
    if (!activeDragId || !overDragId || activeDragId === overDragId) return ids;
    const oldIndex = ids.indexOf(activeDragId);
    const newIndex = ids.indexOf(overDragId);
    if (oldIndex < 0 || newIndex < 0) return ids;
    return arrayMove(ids, oldIndex, newIndex);
  }, [ids, activeDragId, overDragId]);

  /** Live edits: keep empty IF lefts so clearing an input does not delete the row. */
  function commitDraft(next: FormOverrideRule[]) {
    const out = next.map((raw) => ({
      ...raw,
      conditions: (raw.conditions ?? []).map(normalizeCondition),
    }));
    onChange(out);
  }

  /** Final pass: equality-strip outcomes; keep all condition rows (remove only via −). */
  function commitSerialized(next: FormOverrideRule[]) {
    const out = next
      .map((raw) => serializeRule(raw, formDefaults))
      .filter((r): r is FormOverrideRule => r != null && (r.conditions?.length ?? 0) > 0);
    onChange(out);
  }

  function addRule() {
    setEditing(true);
    openRuleEditor(
      rules.length,
      {
        conditions: [{ field_property_slug: "", match_method: "equals", value: "" }],
      },
      true,
    );
  }

  function toggleCardEditing() {
    if (editing) {
      cancelRuleEditor();
      commitSerialized(rules);
      clearDragPreview();
      setEditing(false);
    } else {
      setEditing(true);
    }
  }

  function removeRule(index: number) {
    if (editingIndex === index) cancelRuleEditor();
    commitSerialized(rules.filter((_, i) => i !== index));
  }

  function clearDragPreview() {
    setActiveDragId(null);
    setOverDragId(null);
  }

  function handleDragStart(event: DragStartEvent) {
    const id = String(event.active.id);
    setActiveDragId(id);
    setOverDragId(id);
  }

  function handleDragOver(event: DragOverEvent) {
    if (!event.over) return;
    setOverDragId(String(event.over.id));
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    clearDragPreview();
    if (!over || active.id === over.id) return;
    const oldIndex = ids.indexOf(String(active.id));
    const newIndex = ids.indexOf(String(over.id));
    if (oldIndex < 0 || newIndex < 0) return;
    commitDraft(arrayMove(rules, oldIndex, newIndex));
  }

  function insertTemplate(syntax: string) {
    if (!pickerTarget || !ruleDraft) return;
    const { condIndex, side } = pickerTarget;
    const conditions = [...(ruleDraft.conditions ?? [])].map(normalizeCondition);
    const cond = { ...conditions[condIndex] };
    if (side === "left") {
      cond.field_property_slug = syntax;
    } else {
      cond.value = syntax;
    }
    conditions[condIndex] = cond;
    setRuleDraft({ ...ruleDraft, conditions });
    setPickerTarget(null);
    setVarModal(null);
  }

  const emptyConditions = rules.some(
    (r) => !(r.conditions ?? []).some((c) => normalizeCondition(c).field_property_slug?.trim()),
  );

  return (
    <div
      className="rounded-md border bg-muted/20 p-3 space-y-3"
      data-testid="card-conditional-rules"
    >
      <div className="space-y-1">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <IconGitBranch className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
            <span className="text-sm font-medium">Rules that change this form</span>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            {editing && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={addRule}
                data-testid="button-add-form-rule"
              >
                <IconPlus className="h-3.5 w-3.5 mr-1" />
                Add rule
              </Button>
            )}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-6 w-6"
              onClick={toggleCardEditing}
              data-testid="button-edit-conditional-rules"
              title={editing ? "Done" : "Edit rules"}
            >
              {editing ? <IconX className="h-3.5 w-3.5" /> : <IconPencil className="h-3.5 w-3.5" />}
            </Button>
          </div>
        </div>
        {editing && (
          <p className="text-xs text-muted-foreground">
            Change this form&apos;s values and what happens when a rule matches. Rules are checked
            top to bottom; the first match applies.
          </p>
        )}
      </div>

      {rules.length === 0 ? (
        <p className="text-xs text-muted-foreground italic" data-testid="text-no-form-rules">
          No rules yet.{" "}
          {editing
            ? "Add one to change conversion, success, webhook, tags, or automations when a condition matches."
            : "Edit to add a rule that changes the form when a condition matches."}
        </p>
      ) : !editing ? (
        <div className="divide-y divide-border/60" data-testid="form-rules-summary">
          {rules.map((rule, ruleIndex) => (
            <div
              key={ids[ruleIndex]}
              id={`${idPrefix}-${ruleIndex}`}
              className="py-2 first:pt-0 last:pb-0 min-w-0"
              data-testid={`form-rule-${ruleIndex}`}
            >
              <RuleOneLineView rule={rule} index={ruleIndex} />
            </div>
          ))}
        </div>
      ) : (
        <>
          {emptyConditions && (
            <p
              className="text-xs text-amber-800 dark:text-amber-200"
              data-testid="warn-rule-missing-conditions"
            >
              Every rule needs at least one IF condition (a rule with none would apply to everyone).
            </p>
          )}
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDragCancel={clearDragPreview}
          >
            <SortableContext items={ids} strategy={verticalListSortingStrategy}>
              <div className="space-y-2">
                {rules.map((rule, ruleIndex) => {
                  const id = ids[ruleIndex];
                  const displayNumber = displayOrderIds.indexOf(id) + 1;
                  return (
                    <SortableRuleRow key={id} id={id}>
                      {({ attributes, listeners }) => (
                        <div
                          id={`${idPrefix}-${ruleIndex}`}
                          className="rounded-md border bg-background px-2 py-2 space-y-2"
                          data-testid={`form-rule-${ruleIndex}`}
                        >
                          <div className="flex items-center gap-1.5 min-w-0">
                            <button
                              type="button"
                              className="p-1 -ml-0.5 text-muted-foreground cursor-grab shrink-0"
                              aria-label="Reorder rule"
                              {...attributes}
                              {...listeners}
                            >
                              <IconGripVertical className="h-3.5 w-3.5" />
                            </button>
                            <span className="flex-1 min-w-0 text-xs font-medium text-foreground">
                              Rule {displayNumber > 0 ? displayNumber : ruleIndex + 1}
                            </span>
                            <div className="flex items-center shrink-0">
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6"
                                onClick={() => openRuleEditor(ruleIndex, rule, false)}
                                title="Edit rule"
                                data-testid={`button-edit-form-rule-${ruleIndex}`}
                              >
                                <IconPencil className="h-3 w-3" />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-6 w-6 text-destructive"
                                onClick={() => removeRule(ruleIndex)}
                                title="Delete"
                              >
                                <IconTrash className="h-3 w-3" />
                              </Button>
                            </div>
                          </div>
                          <RuleSummaryView rule={rule} />
                        </div>
                      )}
                    </SortableRuleRow>
                  );
                })}
              </div>
            </SortableContext>
          </DndContext>
        </>
      )}

      <div
        className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground"
        data-testid="form-rules-otherwise"
      >
        <span className="font-medium text-foreground">Otherwise</span>
        {" → "}
        Form defaults (anything a rule doesn&apos;t change stays as above).
      </div>

      <RuleEditorDialog
        open={ruleDraft != null && editingIndex != null}
        onOpenChange={(open) => {
          if (!open) cancelRuleEditor();
        }}
        ruleIndex={editingIndex ?? 0}
        rule={ruleDraft ?? { conditions: [] }}
        formDefaults={formDefaults}
        conversionEventNames={conversionEventNames}
        automationSuggestions={automationSuggestions}
        tagSuggestions={tagSuggestions}
        allSections={allSections}
        locale={locale}
        onUpdateRule={(patch) => {
          setRuleDraft(patch);
        }}
        onOpenVariablePicker={(condIndex, side) => {
          setPickerTarget({ condIndex, side });
          setVarModal(contentType ? "chooser" : "global");
        }}
        onDone={doneRuleEditor}
        onCancel={cancelRuleEditor}
      />

      <VariableTypeChooserModal
        open={varModal === "chooser"}
        onOpenChange={(open) => {
          if (!open) {
            setVarModal(null);
            setPickerTarget(null);
          }
        }}
        contentType={contentType}
        onChoose={(type) => setVarModal(type)}
      />
      <SingleVariablePickerModal
        open={varModal === "single"}
        onOpenChange={(open) => {
          if (!open) {
            setVarModal(null);
            setPickerTarget(null);
          }
        }}
        contentType={contentType}
        inlineDefault=""
        singleEntry={singleEntry}
        onCreated={(_name, syntax) => insertTemplate(syntax)}
      />
      <VariableDetailModal
        open={varModal === "global"}
        onOpenChange={(open) => {
          if (!open) {
            setVarModal(null);
            setPickerTarget(null);
          }
        }}
        variableName=""
        inlineDefault=""
        mode="create"
        onCreated={(_name, syntax) => insertTemplate(syntax)}
      />
    </div>
  );
}

function RuleEditorDialog({
  open,
  onOpenChange,
  ruleIndex,
  rule,
  formDefaults,
  conversionEventNames,
  automationSuggestions,
  tagSuggestions,
  allSections,
  locale,
  onUpdateRule,
  onOpenVariablePicker,
  onDone,
  onCancel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ruleIndex: number;
  rule: FormOverrideRule;
  formDefaults: FormDefaultsForRules;
  conversionEventNames: string[];
  automationSuggestions: string[];
  tagSuggestions: string[];
  allSections?: Section[];
  locale: string;
  onUpdateRule: (patch: FormOverrideRule) => void;
  onOpenVariablePicker: (condIndex: number, side: "left" | "right") => void;
  onDone: () => void;
  onCancel: () => void;
}) {
  const conditions = (rule.conditions ?? []).map(normalizeCondition);
  const activeChanges = CHANGE_MENU.map((m) => m.key).filter(
    (k) => rule[k] !== undefined,
  );
  const unknownKeys = Object.keys(rule).filter(
    (k) => k !== "conditions" && !CHANGE_MENU_KEYS.has(k as CanonicalOutcomeKey),
  );
  const presentSlots = thenSlotsFromRule(rule);
  const [slotOrder, setSlotOrder] = useState<ThenSlot[]>(presentSlots);

  useEffect(() => {
    if (!open) return;
    setSlotOrder(thenSlotsFromRule(rule));
    // Reset order when opening a different rule, not on every patch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, ruleIndex]);

  const orderedSlots = useMemo(() => {
    const present = new Set(presentSlots);
    const ordered = slotOrder.filter((s) => present.has(s));
    for (const s of presentSlots) {
      if (!ordered.includes(s)) ordered.push(s);
    }
    return ordered;
  }, [slotOrder, presentSlots]);

  function addThenChange(key: CanonicalOutcomeKey) {
    const patch: FormOverrideRule = { ...rule };
    if (key === "conversion_name") {
      patch.conversion_name =
        typeof formDefaults.conversion_name === "string"
          ? formDefaults.conversion_name
          : "";
    } else if (key === "tags") {
      patch.tags = formDefaults.tags ?? "";
    } else if (key === "automations") {
      patch.automations = formDefaults.automations ?? "";
    } else if (key === "success") {
      patch.success = { ...(formDefaults.success ?? {}) };
    } else if (key === "webhook") {
      patch.webhook = { ...(formDefaults.webhook ?? {}) };
    }
    const slot = menuKeyToThenSlot(key);
    if (slot) {
      setSlotOrder((prev) => [slot, ...prev.filter((s) => s !== slot)]);
    }
    onUpdateRule(patch);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-4xl max-h-[85vh] overflow-y-auto"
        data-testid="dialog-form-rule-editor"
      >
        <DialogHeader>
          <DialogTitle>Edit rule {ruleIndex + 1}</DialogTitle>
          <DialogDescription>
            When the IF conditions match, apply the THEN changes. Anything you don&apos;t change
            here keeps the form default. Only differing values are saved.
          </DialogDescription>
        </DialogHeader>
        <div className="border-b" />

        <div className="space-y-3 py-1">
          <div className="space-y-2">
            {conditions.map((cond, condIndex) => (
              <div key={condIndex} className="flex flex-wrap items-center gap-1.5">
                <span className="w-10 shrink-0 text-sm font-semibold text-muted-foreground">
                  {condIndex === 0 ? "IF" : "AND"}
                </span>
                <div className="flex items-center gap-1 flex-1 min-w-[10rem]">
                  <TemplateCodeInput
                    placeholder="{{ form.program }}"
                    value={String(cond.field_property_slug ?? "")}
                    onChange={(v) => {
                      const next = [...conditions];
                      next[condIndex] = {
                        ...cond,
                        field_property_slug: v,
                      };
                      onUpdateRule({ ...rule, conditions: next });
                    }}
                    testId={`rule-${ruleIndex}-cond-${condIndex}-left`}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-8 w-7 shrink-0"
                    title="Insert entry/global variable"
                    onClick={() => onOpenVariablePicker(condIndex, "left")}
                  >
                    <Braces className="h-3.5 w-3.5 text-primary" />
                  </Button>
                </div>
                <Select
                  value={cond.match_method === "contains" ? "contains" : "equals"}
                  onValueChange={(v) => {
                    const next = [...conditions];
                    next[condIndex] = {
                      ...cond,
                      match_method: v === "contains" ? "contains" : "equals",
                    };
                    onUpdateRule({ ...rule, conditions: next });
                  }}
                >
                  <SelectTrigger className="h-8 w-[7.5rem] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="equals">equals</SelectItem>
                    <SelectItem value="contains">contains</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex items-center gap-1 flex-1 min-w-[10rem]">
                  <TemplateCodeInput
                    placeholder="value or {{ visitor.id }}"
                    value={String(cond.value ?? "")}
                    onChange={(v) => {
                      const next = [...conditions];
                      next[condIndex] = { ...cond, value: v };
                      onUpdateRule({ ...rule, conditions: next });
                    }}
                    testId={`rule-${ruleIndex}-cond-${condIndex}-right`}
                  />
                  <Button
                    type="button"
                    size="icon"
                    variant="outline"
                    className="h-8 w-7 shrink-0"
                    title="Insert entry/global variable"
                    onClick={() => onOpenVariablePicker(condIndex, "right")}
                  >
                    <Braces className="h-3.5 w-3.5 text-primary" />
                  </Button>
                </div>
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  title="Remove condition"
                  disabled={conditions.length <= 1}
                  onClick={() => {
                    onUpdateRule({
                      ...rule,
                      conditions: conditions.filter((_, i) => i !== condIndex),
                    });
                  }}
                  data-testid={`rule-${ruleIndex}-cond-${condIndex}-remove`}
                >
                  <IconMinus className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            <div className="flex items-center justify-between">
              <span
                className="w-10 shrink-0 pl-0.5 text-sm leading-none text-muted-foreground/70"
                aria-hidden
              >
                ↓
              </span>
              <Button
                type="button"
                size="icon"
                variant="ghost"
                className="h-7 w-7"
                title="Add condition"
                onClick={() => {
                  onUpdateRule({
                    ...rule,
                    conditions: [
                      ...conditions,
                      { field_property_slug: "", match_method: "equals", value: "" },
                    ],
                  });
                }}
                data-testid={`rule-${ruleIndex}-cond-add`}
              >
                <IconPlus className="h-3.5 w-3.5" />
              </Button>
            </div>
          </div>

          <div className="space-y-3 pt-1">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0 flex items-baseline gap-1.5 flex-wrap">
                <Label className="text-sm font-semibold">THEN</Label>
                <span className="text-[10px] text-muted-foreground">
                  (Values below override the form defaults)
                </span>
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button type="button" size="sm" variant="outline" className="h-7 text-xs">
                      <IconPlus className="h-3 w-3 mr-1" />
                      Change a part of the form
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="z-[10001]">
                    {CHANGE_MENU.map((item) => {
                      const already = activeChanges.includes(item.key);
                      return (
                        <DropdownMenuItem
                          key={item.key}
                          disabled={already}
                          onClick={() => addThenChange(item.key)}
                        >
                          <item.Icon className="h-3.5 w-3.5 text-muted-foreground" />
                          {item.label}
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
                <Popover modal={false}>
                  <PopoverTrigger asChild>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-7 w-7"
                      title="About prefilled values"
                    >
                      <IconInfoCircle className="h-3.5 w-3.5 text-muted-foreground" />
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent
                    align="end"
                    className="w-64 p-3 text-xs text-muted-foreground z-[10001]"
                  >
                    Values are prefilled with the form&apos;s defaults.
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {orderedSlots.map((slot) => {
              if (slot === "conversion_name") {
                return (
                  <OutcomeBlock
                    key={slot}
                    title="Conversion goal"
                    onRemove={() => {
                      const { conversion_name: _, ...rest } = rule;
                      onUpdateRule(rest);
                    }}
                  >
                    <Select
                      value={
                        rule.conversion_name === null
                          ? "__none__"
                          : String(rule.conversion_name ?? "") || "__empty__"
                      }
                      onValueChange={(v) => {
                        onUpdateRule({
                          ...rule,
                          conversion_name:
                            v === "__none__"
                              ? (null as unknown as string)
                              : v === "__empty__"
                                ? ""
                                : v,
                        });
                      }}
                    >
                      <SelectTrigger
                        className="w-full min-w-0"
                        data-testid={`rule-${ruleIndex}-conversion-name`}
                      >
                        <SelectValue placeholder="Select conversion event…" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">None (off)</SelectItem>
                        {conversionEventNames.map((name) => (
                          <SelectItem key={name} value={name}>
                            {name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {formDefaults.conversion_name != null &&
                      formDefaults.conversion_name !== "" && (
                        <p className="text-[10px] text-muted-foreground">
                          Form default:{" "}
                          <span className="font-mono">
                            {String(formDefaults.conversion_name)}
                          </span>
                        </p>
                      )}
                  </OutcomeBlock>
                );
              }
              if (slot === "success") {
                return (
                  <SuccessCard
                    key={slot}
                    message={rule.success?.message ?? ""}
                    url={rule.success?.url ?? ""}
                    editing
                    onEditingChange={(next) => {
                      if (next) return;
                      const { success: _, ...rest } = rule;
                      onUpdateRule(rest);
                    }}
                    locale={locale}
                    allSections={allSections}
                    showReloadEntryFields
                    reloadEntryFields={rule.success?.reload_entry_fields === true}
                    testIdPrefix={`rule-${ruleIndex}-success`}
                    onChange={(field, value) => {
                      const nextSuccess = { ...(rule.success ?? {}) };
                      if (field === "reload_entry_fields") {
                        if (value === true) nextSuccess.reload_entry_fields = true;
                        else delete nextSuccess.reload_entry_fields;
                      } else if (field === "message") {
                        nextSuccess.message = value as string;
                        if (String(value).trim()) delete nextSuccess.url;
                      } else if (field === "url") {
                        nextSuccess.url = value as string;
                        if (String(value).trim()) delete nextSuccess.message;
                      }
                      onUpdateRule({ ...rule, success: nextSuccess });
                    }}
                  />
                );
              }
              if (slot === "webhook") {
                return (
                  <WebhookCard
                    key={slot}
                    url={rule.webhook?.url ?? ""}
                    method={rule.webhook?.method ?? "POST"}
                    headers={rule.webhook?.headers ?? {}}
                    failSilently={rule.webhook?.fail_silently === true}
                    editing
                    onEditingChange={(next) => {
                      if (next) return;
                      const { webhook: _, ...rest } = rule;
                      onUpdateRule(rest);
                    }}
                    source="section"
                    hint="Webhook for this rule only. Same controls as the Forms webhook card above."
                    testIdPrefix={`rule-${ruleIndex}-webhook`}
                    onChange={(field, value) => {
                      const nextWebhook = { ...(rule.webhook ?? {}) };
                      if (field === "url") {
                        nextWebhook.url = value as string;
                      } else if (field === "method") {
                        nextWebhook.method = value as "POST" | "GET";
                      } else if (field === "headers") {
                        const next = value as Record<string, string>;
                        if (!next || Object.keys(next).length === 0) delete nextWebhook.headers;
                        else nextWebhook.headers = next;
                      } else if (field === "failSilently") {
                        if (value === true) nextWebhook.fail_silently = true;
                        else delete nextWebhook.fail_silently;
                      }
                      onUpdateRule({ ...rule, webhook: nextWebhook });
                    }}
                  />
                );
              }
              return (
                <AutomationsTagsCard
                  key={slot}
                  editing
                  onEditingChange={(next) => {
                    if (next) return;
                    const { tags: _t, automations: _a, ...rest } = rule;
                    onUpdateRule(rest);
                  }}
                  automation={
                    rule.automations !== undefined ? String(rule.automations ?? "") : ""
                  }
                  tags={rule.tags !== undefined ? parseTagsString(rule.tags) : []}
                  automationSuggestions={automationSuggestions}
                  tagSuggestions={tagSuggestions}
                  inheritedAutomation={formDefaults.automations}
                  inheritedTags={parseTagsString(formDefaults.tags)}
                  automationOverridden={rule.automations !== undefined}
                  tagsOverridden={rule.tags !== undefined}
                  onAutomationChange={(val) =>
                    onUpdateRule({ ...rule, automations: val })
                  }
                  onTagsChange={(vals) =>
                    onUpdateRule({ ...rule, tags: vals.join(",") })
                  }
                  onAutomationOverrideChange={(override) => {
                    if (override) {
                      onUpdateRule({
                        ...rule,
                        automations: formDefaults.automations ?? "",
                      });
                    } else {
                      const { automations: _, ...rest } = rule;
                      onUpdateRule(rest);
                    }
                  }}
                  onTagsOverrideChange={(override) => {
                    if (override) {
                      onUpdateRule({ ...rule, tags: formDefaults.tags ?? "" });
                    } else {
                      const { tags: _, ...rest } = rule;
                      onUpdateRule(rest);
                    }
                  }}
                />
              );
            })}

            {unknownKeys.length > 0 && (
              <div className="rounded-md border border-dashed bg-muted/10 p-3 space-y-3">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">Extra overrides in this rule</p>
                  <p className="text-[10px] text-muted-foreground">
                    Present in YAML but not editable here. Edit the section YAML to change them.
                  </p>
                </div>
                {unknownKeys.map((k) => {
                  let body: string;
                  try {
                    body = yaml
                      .dump({ [k]: rule[k] }, { lineWidth: -1, noRefs: true, quotingType: '"' })
                      .trimEnd();
                  } catch {
                    body = `${k}: ${JSON.stringify(rule[k], null, 2)}`;
                  }
                  return (
                    <pre
                      key={k}
                      className="max-h-48 overflow-auto rounded-md border bg-background p-2 text-[11px] font-mono leading-relaxed whitespace-pre-wrap break-words"
                    >
                      {body}
                    </pre>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" onClick={onDone}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function OutcomeBlock({
  title,
  onRemove,
  children,
}: {
  title: string;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-md border bg-muted/10 p-2 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">{title}</span>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={onRemove}
          title="Remove change"
        >
          <IconX className="h-3 w-3" />
        </Button>
      </div>
      {children}
    </div>
  );
}
