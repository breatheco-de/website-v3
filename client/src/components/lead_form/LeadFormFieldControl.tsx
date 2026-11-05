import { useState, type Ref, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PhoneInput } from "@/components/ui/phone-input";
import type { Country } from "react-phone-number-input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  CardsDropdown,
  SimpleListDropdown,
  GroupedListDropdown,
  type CardsDropdownData,
  type GroupedListDropdownData,
  type SimpleListDropdownData,
} from "@/components/menus/Dropdown";
import { cn } from "@/lib/utils";

/** All `fields.*.component_renderer` values LeadForm understands. */
export type LeadFormComponentRenderer =
  | "text"
  | "phone"
  | "textarea"
  | "select"
  | "cards"
  | "simple-list"
  | "grouped-list";

/** Cards arrangement: equal columns vs first option full-width + rest below. */
export type LeadFormCardsLayout = "grid" | "showcase";

export type LeadFormOption = {
  value: string;
  label: string;
  /**
   * Cards renderer only: card heading. When omitted, falls back to `label`.
   * Closed input / select / lists always use `label`.
   */
  title?: string;
  description?: string;
  group?: string;
  cta?: string;
  icon?: string;
  /** Optional chip on cards renderer (top-right). */
  badge?: string;
};

type RichMenuRenderer = "cards" | "simple-list" | "grouped-list";

type MenuDropdownFromOptions =
  | CardsDropdownData
  | SimpleListDropdownData
  | GroupedListDropdownData;

function isRichMenuRenderer(
  renderer: LeadFormComponentRenderer,
): renderer is RichMenuRenderer {
  return (
    renderer === "cards" ||
    renderer === "simple-list" ||
    renderer === "grouped-list"
  );
}

function groupOptions(options: LeadFormOption[]): Map<string, LeadFormOption[]> {
  const map = new Map<string, LeadFormOption[]>();
  for (const opt of options) {
    const key = opt.group?.trim() || "";
    const list = map.get(key) ?? [];
    list.push(opt);
    map.set(key, list);
  }
  return map;
}

/** Map form options into menu dropdown layout data (href/value = option.value). */
function buildMenuDropdownFromOptions(
  renderer: RichMenuRenderer,
  options: LeadFormOption[],
  meta?: {
    title?: string;
    description?: string;
    layout?: LeadFormCardsLayout;
  },
): MenuDropdownFromOptions {
  const title = meta?.title;
  const description = meta?.description;

  if (renderer === "simple-list") {
    return {
      type: "simple-list",
      title,
      description,
      items: options.map((o) => ({
        label: o.label,
        href: o.value,
        value: o.value,
      })),
    };
  }

  if (renderer === "cards") {
    return {
      type: "cards",
      title,
      description,
      layout:
        meta?.layout === "showcase"
          ? { arrangement: "showcase" }
          : undefined,
      items: options.map((o) => ({
        title: (typeof o.title === "string" && o.title.trim() ? o.title.trim() : o.label),
        description: o.description ?? "",
        cta: o.cta ?? "Select",
        href: o.value,
        value: o.value,
        icon: o.icon,
        badge: o.badge,
      })),
    };
  }

  const grouped = groupOptions(options);

  const groups =
    grouped.size <= 1 && grouped.has("")
      ? [
          {
            title: title || "Options",
            items: options.map((o) => ({
              label: o.label,
              href: o.value,
              value: o.value,
            })),
          },
        ]
      : Array.from(grouped.entries()).map(([groupTitle, items]) => ({
          title: groupTitle || "Options",
          items: items.map((o: LeadFormOption) => ({
            label: o.label,
            href: o.value,
            value: o.value,
          })),
        }));

  return {
    type: "grouped-list",
    title,
    description,
    groups,
  };
}

function RichLayout({
  renderer,
  options,
  dialogTitle,
  dialogDescription,
  layout,
  onSelect,
}: {
  renderer: RichMenuRenderer;
  options: LeadFormOption[];
  dialogTitle?: string;
  dialogDescription?: string;
  layout?: LeadFormCardsLayout;
  onSelect: (value: string) => void;
}) {
  const data = buildMenuDropdownFromOptions(renderer, options, {
    title: dialogTitle,
    description: dialogDescription,
    layout,
  });
  switch (data.type) {
    case "cards":
      return <CardsDropdown dropdown={data} onSelect={onSelect} />;
    case "simple-list":
      return <SimpleListDropdown dropdown={data} onSelect={onSelect} />;
    case "grouped-list":
      return <GroupedListDropdown dropdown={data} onSelect={onSelect} />;
    default:
      return null;
  }
}

function ChoiceSelect({
  options,
  value,
  onChange,
  placeholder,
  disabled,
  testId,
  groupSelectByGroup,
  ariaLabel,
}: {
  options: LeadFormOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  testId?: string;
  groupSelectByGroup?: boolean;
  ariaLabel: string;
}) {
  if (groupSelectByGroup) {
    const groups = new Map<string, LeadFormOption[]>();
    for (const opt of options) {
      const key = opt.group?.trim() || "";
      const list = groups.get(key) ?? [];
      list.push(opt);
      groups.set(key, list);
    }
    const hasNamedGroups = Array.from(groups.keys()).some((k) => k.length > 0);
    const selectValue = value && options.some((o) => o.value === value) ? value : undefined;
    return (
      <Select onValueChange={onChange} value={selectValue} disabled={disabled}>
        <SelectTrigger data-testid={testId} aria-label={ariaLabel}>
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          {hasNamedGroups
            ? Array.from(groups.entries()).map(([group, items]) =>
                group ? (
                  <SelectGroup key={group}>
                    <SelectLabel>{group}</SelectLabel>
                    {items.map((opt: LeadFormOption) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ) : (
                  items.map((opt: LeadFormOption) => (
                    <SelectItem key={opt.value} value={opt.value}>
                      {opt.label}
                    </SelectItem>
                  ))
                ),
              )
            : options.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
        </SelectContent>
      </Select>
    );
  }

  const selectValue = value && options.some((o) => o.value === value) ? value : undefined;
  return (
    <Select onValueChange={onChange} value={selectValue} disabled={disabled}>
      <SelectTrigger data-testid={testId} aria-label={ariaLabel}>
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((opt) => (
          <SelectItem key={opt.value} value={opt.value}>
            {opt.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Dialog width matches each menu layout so we don't leave empty gray space. */
const RICH_DIALOG_MAX_WIDTH: Record<RichMenuRenderer, string> = {
  cards: "max-w-3xl",
  "simple-list": "max-w-sm",
  "grouped-list": "max-w-xl",
};

function richDialogMaxWidth(
  renderer: RichMenuRenderer,
  options: LeadFormOption[],
): string {
  if (renderer === "grouped-list") {
    const groupKeys = new Set(
      options.map((o) => o.group?.trim() || "").filter(Boolean),
    );
    // No real groups → single list (no tabs); keep dialog compact.
    if (groupKeys.size <= 1) return "max-w-md";
  }
  return RICH_DIALOG_MAX_WIDTH[renderer];
}

function ChoiceModal({
  renderer,
  options,
  value,
  onChange,
  placeholder,
  disabled,
  testId,
  dialogTitle,
  dialogDescription,
  layout,
  ariaLabel,
}: {
  renderer: RichMenuRenderer;
  options: LeadFormOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  testId?: string;
  dialogTitle?: string;
  dialogDescription?: string;
  layout?: LeadFormCardsLayout;
  ariaLabel: string;
}) {
  const [open, setOpen] = useState(false);
  const selected = options.find((o) => o.value === value);
  const maxWidthClass = richDialogMaxWidth(renderer, options);

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        data-testid={testId}
        aria-label={ariaLabel}
        className={cn(
          // Match SelectTrigger so rich pickers look identical when closed
          "flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        )}
      >
        <span
          className={cn(
            "line-clamp-1 text-left",
            selected ? "text-foreground" : "text-muted-foreground",
          )}
        >
          {selected?.label || placeholder || "Select…"}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-50" />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        {/* Title/description live inside the menu layout (same as navbar) — no DialogHeader. */}
        <DialogContent
          className={cn(
            "w-[calc(100vw-2rem)] max-h-[85vh] overflow-y-auto overflow-x-hidden p-0 gap-0",
            maxWidthClass,
          )}
        >
          <DialogTitle className="sr-only">{dialogTitle || placeholder || "Select"}</DialogTitle>
          <RichLayout
            renderer={renderer}
            options={options}
            dialogTitle={dialogTitle}
            dialogDescription={dialogDescription}
            layout={layout}
            onSelect={(v) => {
              onChange(v);
              setOpen(false);
            }}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}

type FieldRenderProps = {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  name: string;
  ref: Ref<unknown>;
};

export type LeadFormFieldControlProps = {
  renderer: LeadFormComponentRenderer;
  field: FieldRenderProps;
  options?: LeadFormOption[];
  placeholder?: string;
  testId?: string;
  disabled?: boolean;
  dialogTitle?: string;
  /** Shown under the layout title inside the modal (menu-style). */
  dialogDescription?: string;
  /** Cards only: `grid` (default) or `showcase` (first full-width, rest below). */
  layout?: LeadFormCardsLayout;
  /** When true, location-style SelectGroups by `group` for inline select. */
  groupSelectByGroup?: boolean;
  phoneDefaultCountry?: Country;
  rows?: number;
  inputType?: string;
  /** When select has no options (e.g. free-text plan), render this instead. */
  selectEmptyFallback?: ReactNode;
};

/**
 * Renders a lead-form field from `component_renderer`:
 * text | phone | textarea | select | cards | simple-list | grouped-list.
 */
export function LeadFormFieldControl({
  renderer,
  field,
  options = [],
  placeholder,
  testId,
  disabled,
  dialogTitle,
  dialogDescription,
  layout,
  groupSelectByGroup,
  phoneDefaultCountry,
  rows,
  inputType,
  selectEmptyFallback,
}: LeadFormFieldControlProps) {
  // Accessible name for pickers: YAML/UI label (via dialogTitle) → placeholder → field name.
  // Callers already put `fields.*.label || locale fallback` into dialogTitle.
  const pickerAriaLabel =
    dialogTitle?.trim() || placeholder?.trim() || field.name;

  if (renderer === "select" || isRichMenuRenderer(renderer)) {
    if (renderer === "select" && options.length === 0 && selectEmptyFallback) {
      return <>{selectEmptyFallback}</>;
    }
    if (renderer === "select") {
      return (
        <ChoiceSelect
          options={options}
          value={field.value}
          onChange={field.onChange}
          placeholder={placeholder}
          disabled={disabled}
          testId={testId}
          groupSelectByGroup={groupSelectByGroup}
          ariaLabel={pickerAriaLabel}
        />
      );
    }
    return (
      <ChoiceModal
        renderer={renderer}
        options={options}
        value={field.value}
        onChange={field.onChange}
        placeholder={placeholder}
        disabled={disabled}
        testId={testId}
        dialogTitle={dialogTitle}
        dialogDescription={dialogDescription}
        layout={layout}
        ariaLabel={pickerAriaLabel}
      />
    );
  }

  if (renderer === "phone") {
    return (
      <PhoneInput
        value={field.value}
        onChange={(v) => field.onChange(v || "")}
        defaultCountry={phoneDefaultCountry}
        placeholder={placeholder}
        data-testid={testId}
      />
    );
  }

  if (renderer === "textarea") {
    return (
      <Textarea
        className="min-h-[100px]"
        placeholder={placeholder}
        rows={rows}
        name={field.name}
        value={field.value}
        onChange={(e) => field.onChange(e.target.value)}
        onBlur={field.onBlur}
        ref={field.ref as Ref<HTMLTextAreaElement>}
        data-testid={testId}
      />
    );
  }

  return (
    <Input
      type={inputType}
      placeholder={placeholder}
      name={field.name}
      value={field.value}
      onChange={(e) => field.onChange(e.target.value)}
      onBlur={field.onBlur}
      ref={field.ref as Ref<HTMLInputElement>}
      data-testid={testId}
      disabled={disabled}
    />
  );
}
