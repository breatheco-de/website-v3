import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconAlertTriangle, IconChevronDown, IconForms, IconPencil, IconX } from "@tabler/icons-react";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { catalogSourceKey, parseFormFieldSource } from "@shared/parseFormFieldSource";

/** Same rich layouts as menu dropdowns, plus text/phone/textarea/select for forms. */
const COMPONENT_RENDERERS = [
  { value: "text", label: "Text" },
  { value: "phone", label: "Phone" },
  { value: "textarea", label: "Textarea" },
  { value: "select", label: "Select" },
  { value: "cards", label: "Cards" },
  { value: "simple-list", label: "Simple List" },
  { value: "grouped-list", label: "Grouped List" },
] as const;

export interface FormFieldConfig {
  visible?: boolean;
  required?: boolean;
  default?: string;
  component_renderer?: string;
  [key: string]: unknown;
}

export type FormFieldEditableKey =
  | "visible"
  | "required"
  | "default"
  | "component_renderer"
  | "source.value_path"
  | "source.label_path";

export interface FormFieldsCardProps {
  fields: Record<string, FormFieldConfig>;
  onFieldChange: (fieldName: string, key: FormFieldEditableKey, value: boolean | string) => void;
}

/** Preferred display order for known lead-form fields; unknown keys follow alphabetically. */
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

function summarizeField(cfg: FormFieldConfig): string[] {
  const parts: string[] = [];
  const source = cfg.source;
  if (typeof source === "string" && source.trim()) {
    parts.push(`source: ${source.trim()}`);
  } else if (source && typeof source === "object" && !Array.isArray(source)) {
    const parsed = parseFormFieldSource(source as { content_type?: string; database?: string; related_field?: string; query?: string });
    if (parsed.related_field) parts.push(`related_field: ${parsed.related_field}`);
    else if (parsed.content_type) parts.push(`content_type: ${parsed.content_type}`);
    else if (parsed.database) parts.push(`database: ${parsed.database}`);
    if (parsed.query) parts.push(`query: ${parsed.query}`);
    if (parsed.value_path) parts.push(`value_path: ${parsed.value_path}`);
    if (parsed.label_path) parts.push(`label_path: ${parsed.label_path}`);
  }
  if (cfg.visible === true) parts.push("visible");
  if (cfg.visible === false) parts.push("hidden");
  if (cfg.required === true) parts.push("required");
  if (cfg.required === false) parts.push("optional");
  if (typeof cfg.default === "string" && cfg.default.trim()) {
    parts.push(`default: ${cfg.default}`);
  }
  if (
    typeof cfg.component_renderer === "string" &&
    cfg.component_renderer.trim()
  ) {
    parts.push(cfg.component_renderer);
  }
  return parts;
}

function catalogNeedsQuery(
  cfg: FormFieldConfig,
  ecommerceTypes: Set<string>,
): boolean {
  const source = cfg.source;
  if (source == null) return false;
  const parsed = parseFormFieldSource(
    source as string | { content_type?: string; database?: string; related_field?: string; query?: string },
  );
  const key = catalogSourceKey(parsed);
  if (!key || parsed.related_field) return false;
  if (parsed.query && parsed.query.trim()) return false;
  const ct = parsed.content_type || (!parsed.database ? key : undefined);
  return !!ct && ecommerceTypes.has(ct);
}

function FormFieldEditorRow({
  name,
  cfg,
  onFieldChange,
  ecommerceTypes,
}: {
  name: string;
  cfg: FormFieldConfig;
  onFieldChange: FormFieldsCardProps["onFieldChange"];
  ecommerceTypes: Set<string>;
}) {
  const [open, setOpen] = useState(false);
  const visible = cfg.visible === true;
  const required = cfg.required === true;
  const defaultValue = typeof cfg.default === "string" ? cfg.default : "";
  const hasRenderer =
    typeof cfg.component_renderer === "string" && cfg.component_renderer.trim();
  const renderer = hasRenderer ? cfg.component_renderer!.trim() : undefined;
  const summary = summarizeField(cfg);
  const missingQuery = catalogNeedsQuery(cfg, ecommerceTypes);
  const source = cfg.source;
  const parsedSource =
    source != null
      ? parseFormFieldSource(
          source as string | { content_type?: string; database?: string; related_field?: string; query?: string },
        )
      : null;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-md border bg-background/50"
      data-testid={`form-field-row-${name}`}
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-2 p-2.5 text-left hover:bg-muted/40 transition-colors rounded-md"
          data-testid={`button-toggle-form-field-${name}`}
        >
          <span className="text-xs font-mono font-medium shrink-0">{name}</span>
          <div className="flex flex-wrap gap-1 min-w-0 flex-1">
            {summary.length > 0 ? (
              summary.map((part) => (
                <Badge
                  key={part}
                  variant="secondary"
                  className="text-[10px] px-1.5 py-0 leading-4 font-normal font-mono"
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
      <CollapsibleContent>
        <div className="space-y-2 px-2.5 pb-2.5 pt-0 border-t border-border/60">
          {missingQuery && (
            <div
              className="mt-2 flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-100"
              data-testid={`banner-missing-catalog-query-${name}`}
            >
              <IconAlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <p>
                Ecommerce catalogs need an explicit{" "}
                <code className="font-mono text-[10px]">source.query</code> (typically{" "}
                <code className="font-mono text-[10px]">purchasable=true</code>). Without it this
                dropdown lists every entry, including discontinued products. On a non-purchasable
                program page, bind that program with{" "}
                <code className="font-mono text-[10px]">source.related_field</code> or{" "}
                <code className="font-mono text-[10px]">query: slug=&lt;this&gt;</code> instead.
              </p>
            </div>
          )}
          {parsedSource && (
            <div className="pt-2 space-y-2">
              <div className="grid grid-cols-1 gap-1 text-[11px] font-mono text-muted-foreground">
                {parsedSource.content_type && <span>content_type: {parsedSource.content_type}</span>}
                {parsedSource.database && <span>database: {parsedSource.database}</span>}
                {parsedSource.related_field && (
                  <span>related_field: {parsedSource.related_field}</span>
                )}
                {parsedSource.query && <span>query: {parsedSource.query}</span>}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label
                    htmlFor={`field-${name}-value-path`}
                    className="text-xs text-muted-foreground"
                  >
                    value_path <span className="text-red-400">*</span>
                  </Label>
                  <Input
                    id={`field-${name}-value-path`}
                    required
                    value={parsedSource.value_path ?? ""}
                    onChange={(e) => onFieldChange(name, "source.value_path", e.target.value)}
                    placeholder="e.g. bc_slug or slug"
                    className="h-8 text-xs font-mono bg-background"
                    data-testid={`input-field-${name}-value-path`}
                  />
                </div>
                <div className="space-y-1">
                  <Label
                    htmlFor={`field-${name}-label-path`}
                    className="text-xs text-muted-foreground"
                  >
                    label_path <span className="text-red-400">*</span>
                  </Label>
                  <Input
                    id={`field-${name}-label-path`}
                    required
                    value={parsedSource.label_path ?? ""}
                    onChange={(e) => onFieldChange(name, "source.label_path", e.target.value)}
                    placeholder="e.g. title"
                    className="h-8 text-xs font-mono bg-background"
                    data-testid={`input-field-${name}-label-path`}
                  />
                </div>
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-4 pt-2">
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
            <Label
              htmlFor={`field-${name}-default`}
              className="text-xs text-muted-foreground"
            >
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
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">Component renderer</Label>
            <Select
              value={renderer}
              onValueChange={(val) => onFieldChange(name, "component_renderer", val)}
            >
              <SelectTrigger
                className="h-8 text-xs"
                data-testid={`select-field-${name}-component-renderer`}
              >
                <SelectValue placeholder="Runtime default…" />
              </SelectTrigger>
              <SelectContent>
                {COMPONENT_RENDERERS.map((r) => (
                  <SelectItem key={r.value} value={r.value} className="text-xs">
                    {r.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

/**
 * Conversion-tab card for form fields already present in YAML.
 * No add/remove — only edit visible / required / default / component_renderer / source paths.
 */
export function FormFieldsCard({ fields, onFieldChange }: FormFieldsCardProps) {
  const [editing, setEditing] = useState(false);
  const names = sortFieldNames(Object.keys(fields));
  const { data: productMap } = useQuery<{ products?: Array<{ content_type?: string }> }>({
    queryKey: ["/api/ecommerce/product-map"],
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const res = await fetch("/api/ecommerce/product-map");
      if (!res.ok) return { products: [] };
      return res.json();
    },
  });
  const ecommerceTypes = new Set(
    (productMap?.products ?? [])
      .map((p) => p.content_type)
      .filter((t): t is string => typeof t === "string" && t.length > 0),
  );
  const anyMissingQuery = names.some((n) => catalogNeedsQuery(fields[n] ?? {}, ecommerceTypes));

  return (
    <div
      className="rounded-md border bg-muted/20 p-3 space-y-3"
      data-testid="card-form-fields"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <IconForms className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium">Fields</span>
        </div>
        {names.length > 0 && (
          <Button
            type="button"
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={() => setEditing((v) => !v)}
            data-testid="button-edit-form-fields"
          >
            {editing ? <IconX className="h-3.5 w-3.5" /> : <IconPencil className="h-3.5 w-3.5" />}
          </Button>
        )}
      </div>

      <div
        className="rounded-md border border-border/60 bg-muted/30 px-2.5 py-2 text-[11px] text-muted-foreground space-y-1.5"
        data-testid="form-fields-source-education"
      >
        <p>
          Choice options come from <span className="font-medium text-foreground">source</span> — set
          exactly one of{" "}
          <code className="font-mono text-[10px]">content_type</code>,{" "}
          <code className="font-mono text-[10px]">database</code>, or{" "}
          <code className="font-mono text-[10px]">related_field</code>. Catalogs (
          <code className="font-mono text-[10px]">content_type</code> /{" "}
          <code className="font-mono text-[10px]">database</code>) load{" "}
          <code className="font-mono text-[10px]">/api/query-options</code>.{" "}
          <code className="font-mono text-[10px]">related_field</code> is this entry&apos;s field
          name (e.g. <code className="font-mono text-[10px]">programs</code> on _common.yml); that
          field&apos;s editor describes the other type. Every source needs{" "}
          <code className="font-mono text-[10px]">value_path</code> (property used as the option
          value) and <code className="font-mono text-[10px]">label_path</code> (visible text) —
          not the form field name and not{" "}
          <code className="font-mono text-[10px]">routes[].conditions.value</code>. Ecommerce
          catalogs must set <code className="font-mono text-[10px]">query: purchasable=true</code>{" "}
          unless this is a non-product program page (that slug / related_field only).{" "}
          <code className="font-mono text-[10px]">purchasable</code> on the Fields tab is read-only;{" "}
          <code className="font-mono text-[10px]">actively_selling</code> lives on _product.yml
          (store pause), not the form.
        </p>
        <p>
          The form field name (e.g. <code className="font-mono text-[10px]">program</code>) is still
          the submit key. <code className="font-mono text-[10px]">options[]</code> only overlays
          labels — it does not filter.           <code className="font-mono text-[10px]">slugs</code> is ignored
          when source is set.
        </p>
        <p>
          <code className="font-mono text-[10px]">referral_key</code> is the submit key for
          Breathecode <code className="font-mono text-[10px]">form_entry.referral_key</code>.
          Visible shows an input; hidden still sends a YAML <code className="font-mono text-[10px]">default</code>{" "}
          or URL <code className="font-mono text-[10px]">?referral_key=</code>{" "}
          (fallback <code className="font-mono text-[10px]">?referral=</code> /{" "}
          <code className="font-mono text-[10px]">?ref=</code>). It does not replace UTM{" "}
          <code className="font-mono text-[10px]">referral</code>.
        </p>
        {anyMissingQuery && (
          <div
            className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1.5 text-amber-100"
            data-testid="banner-form-catalog-query-missing"
          >
            <IconAlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <p>
              At least one catalog source is missing{" "}
              <code className="font-mono text-[10px]">query</code>. Add{" "}
              <code className="font-mono text-[10px]">purchasable=true</code> in YAML (or a slug
              subset) so discontinued products stay out of the dropdown.
            </p>
          </div>
        )}
        <details className="text-[10px]">
          <summary className="cursor-pointer text-foreground/80 hover:text-foreground">
            Read more (advanced)
          </summary>
          <ul className="mt-1 list-disc pl-4 space-y-0.5">
            <li>
              Parse: <code className="font-mono">shared/parseFormFieldSource.ts</code>
            </li>
            <li>
              Catalog API: <code className="font-mono">server/query-options.ts</code>
            </li>
            <li>
              Product index: <code className="font-mono">server/ecommerce/ecommerce-index.ts</code>
            </li>
            <li>
              Relation resolver:{" "}
              <code className="font-mono">shared/resolveFormFieldRelationSource.ts</code>
            </li>
            <li>
              Do not combine <code className="font-mono">source.related_field</code> with{" "}
              <code className="font-mono">slugs</code> — put allowed pointers on the entry field.
            </li>
          </ul>
        </details>
      </div>

      {names.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="text-form-fields-empty">
          No fields configured in YAML for this form. Add field keys under{" "}
          <code className="font-mono text-[11px]">fields</code> in the section YAML to edit
          visibility, required, defaults, and component renderer here.
        </p>
      ) : !editing ? (
        <div className="space-y-2" data-testid="form-fields-summary">
          {names.map((name) => {
            const summary = summarizeField(fields[name] ?? {});
            return (
              <div key={name} className="flex items-start gap-2 min-w-0">
                <span className="text-xs font-mono w-28 shrink-0 pt-0.5 truncate" title={name}>
                  {name}
                </span>
                <div className="flex flex-wrap gap-1 min-w-0">
                  {summary.length > 0 ? (
                    summary.map((part) => (
                      <Badge
                        key={part}
                        variant="secondary"
                        className="text-[11px] px-1.5 py-0 leading-4 font-normal font-mono"
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
          {names.map((name) => (
            <FormFieldEditorRow
              key={name}
              name={name}
              cfg={fields[name] ?? {}}
              onFieldChange={onFieldChange}
              ecommerceTypes={ecommerceTypes}
            />
          ))}
        </div>
      )}
    </div>
  );
}
