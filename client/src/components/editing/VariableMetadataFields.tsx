import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  SearchableMultiSelect,
  type SearchableMultiSelectOption,
} from "@/components/ui/searchable-multi-select";
import {
  VARIABLE_CATEGORIES,
  VARIABLE_CATEGORY_HINTS,
  VARIABLE_CATEGORY_LABELS,
  VARIABLE_SOURCES,
  VARIABLE_SOURCE_FIELD_HINT,
  VARIABLE_SOURCE_LABELS,
  VARIABLE_UNITS,
  VARIABLE_UNIT_LABELS,
  isFigureCategory,
  normalizeVariableProducts,
} from "@shared/variable-metadata";
import { cn } from "@/lib/utils";

export interface VariableMetadataDraft {
  description: string;
  category: string;
  unit: string;
  source: string;
  products: string[];
  deprecated: boolean;
  replaced_by: string;
}

export const EMPTY_METADATA_DRAFT: VariableMetadataDraft = {
  description: "",
  category: "",
  unit: "",
  source: "",
  products: [],
  deprecated: false,
  replaced_by: "",
};

export function metadataDraftFrom(def?: {
  description?: string;
  category?: string;
  unit?: string;
  source?: string;
  products?: string[];
  deprecated?: boolean;
  replaced_by?: string;
} | null): VariableMetadataDraft {
  return {
    description: def?.description ?? "",
    category: def?.category ?? "",
    unit: def?.unit ?? "",
    source: def?.source ?? "",
    products: normalizeVariableProducts(def?.products) ?? [],
    deprecated: def?.deprecated === true,
    replaced_by: def?.replaced_by ?? "",
  };
}

export function metadataDraftReady(draft: VariableMetadataDraft): boolean {
  return draft.description.trim() !== "" && draft.category.trim() !== "";
}

export function metadataDraftToBody(draft: VariableMetadataDraft): Record<string, unknown> {
  return {
    description: draft.description.trim(),
    category: draft.category,
    unit: draft.unit || null,
    source: draft.source || null,
    products: draft.products.length > 0 ? draft.products : null,
    deprecated: draft.deprecated,
    replaced_by: draft.deprecated && draft.replaced_by ? draft.replaced_by : null,
  };
}

type ProductOption = {
  content_slug: string;
  name: string;
  actively_selling?: boolean;
};

const NONE = "__none__";

function VariableProductsPicker({
  products,
  onChange,
  testIdPrefix,
}: {
  products: string[];
  onChange: (next: string[]) => void;
  testIdPrefix: string;
}) {
  const { data, isLoading } = useQuery<{ products: ProductOption[] }>({
    queryKey: ["/api/ecommerce/products"],
  });

  const options = useMemo((): SearchableMultiSelectOption[] => {
    const fromApi = (data?.products ?? [])
      .slice()
      .sort((a, b) => (a.name || a.content_slug).localeCompare(b.name || b.content_slug))
      .map((p) => ({
        value: p.content_slug,
        label: p.name || p.content_slug,
        badgeLabel: p.content_slug,
        searchTerms: [p.content_slug, p.name || ""],
      }));
    const known = new Set(fromApi.map((o) => o.value));
    // Keep badges for slugs saved on the variable that are no longer in the catalog.
    const orphans = products
      .filter((slug) => !known.has(slug))
      .map((slug) => ({
        value: slug,
        label: slug,
        badgeLabel: slug,
        searchTerms: [slug],
      }));
    return [...fromApi, ...orphans];
  }, [data?.products, products]);

  return (
    <div className="space-y-1">
      <SearchableMultiSelect
        options={options}
        value={products}
        onChange={onChange}
        label="Products"
        searchPlaceholder="Search products…"
        addLabel="Add products"
        clearAllLabel="Clear products"
        emptyMessage="No products found"
        isLoading={isLoading}
        testIdPrefix={`${testIdPrefix}-product`}
        listClassName="max-h-[148px]"
      />
      <p className="text-xs text-muted-foreground">
        Optional. Sellable product slugs this fact applies to. Leave empty for site-wide.
      </p>
    </div>
  );
}

export function VariableMetadataFields({
  draft,
  onChange,
  showOptional = true,
  replacementOptions = [],
  errorField,
  testIdPrefix = "variable-meta",
}: {
  draft: VariableMetadataDraft;
  onChange: (next: VariableMetadataDraft) => void;
  showOptional?: boolean;
  replacementOptions?: string[];
  errorField?: "description" | "category" | null;
  testIdPrefix?: string;
}) {
  const set = (patch: Partial<VariableMetadataDraft>) => onChange({ ...draft, ...patch });

  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <label className="text-sm font-medium text-foreground" htmlFor={`${testIdPrefix}-description`}>
          Description <span className="text-destructive">*</span>
        </label>
        <Textarea
          id={`${testIdPrefix}-description`}
          value={draft.description}
          onChange={(e) => set({ description: e.target.value })}
          placeholder="What this fact is and when to use it (e.g. Full-stack tuition, one-time payment)"
          rows={2}
          className={cn(errorField === "description" && "border-destructive")}
          data-testid={`${testIdPrefix}-description`}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-1">
          <label className="text-sm font-medium text-foreground">
            Category <span className="text-destructive">*</span>
          </label>
          <Select value={draft.category || undefined} onValueChange={(v) => set({ category: v })}>
            <SelectTrigger
              className={cn(errorField === "category" && "border-destructive")}
              data-testid={`${testIdPrefix}-category`}
            >
              <SelectValue placeholder="Pick a category" />
            </SelectTrigger>
            <SelectContent className="z-[10002]">
              {VARIABLE_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c} data-testid={`${testIdPrefix}-category-${c}`}>
                  {VARIABLE_CATEGORY_LABELS[c]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {draft.category && (
            <p className="text-xs text-muted-foreground">
              {VARIABLE_CATEGORY_HINTS[draft.category as keyof typeof VARIABLE_CATEGORY_HINTS] ?? ""}
              {isFigureCategory(draft.category) ? " Changes get extra review." : ""}
            </p>
          )}
        </div>

        {showOptional && (
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Unit</label>
            <Select value={draft.unit || NONE} onValueChange={(v) => set({ unit: v === NONE ? "" : v })}>
              <SelectTrigger data-testid={`${testIdPrefix}-unit`}>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent className="z-[10002]">
                <SelectItem value={NONE}>None</SelectItem>
                {VARIABLE_UNITS.map((u) => (
                  <SelectItem key={u} value={u}>
                    {VARIABLE_UNIT_LABELS[u]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      {showOptional && (
        <>
          <div className="space-y-1">
            <label className="text-sm font-medium text-foreground">Source</label>
            <Select
              value={draft.source || NONE}
              onValueChange={(v) => set({ source: v === NONE ? "" : v })}
            >
              <SelectTrigger className="w-full" data-testid={`${testIdPrefix}-source`}>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent className="z-[10002]">
                <SelectItem value={NONE}>None</SelectItem>
                {VARIABLE_SOURCES.map((s) => (
                  <SelectItem key={s} value={s} data-testid={`${testIdPrefix}-source-${s}`}>
                    {VARIABLE_SOURCE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{VARIABLE_SOURCE_FIELD_HINT}</p>
          </div>

          <VariableProductsPicker
            products={draft.products}
            onChange={(products) => set({ products })}
            testIdPrefix={testIdPrefix}
          />

          <div className="space-y-2 rounded-md border p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-medium text-foreground">Deprecated</p>
                <p className="text-xs text-muted-foreground">
                  Hidden from agents for new content. Pick a replacement so they know what to use instead.
                </p>
              </div>
              <Switch
                checked={draft.deprecated}
                onCheckedChange={(checked) =>
                  set({ deprecated: checked, replaced_by: checked ? draft.replaced_by : "" })
                }
                data-testid={`${testIdPrefix}-deprecated`}
              />
            </div>
            {draft.deprecated && (
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Use this instead</label>
                {replacementOptions.length > 0 ? (
                  <Select
                    value={draft.replaced_by || NONE}
                    onValueChange={(v) => set({ replaced_by: v === NONE ? "" : v })}
                  >
                    <SelectTrigger data-testid={`${testIdPrefix}-replaced-by`}>
                      <SelectValue placeholder="No replacement" />
                    </SelectTrigger>
                    <SelectContent className="z-[10002] max-h-72">
                      <SelectItem value={NONE}>No replacement</SelectItem>
                      {replacementOptions.map((name) => (
                        <SelectItem key={name} value={name}>
                          <span className="font-mono text-xs">{name}</span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input
                    value={draft.replaced_by}
                    onChange={(e) => set({ replaced_by: e.target.value })}
                    placeholder="global.other_variable"
                    className="font-mono text-xs"
                    data-testid={`${testIdPrefix}-replaced-by`}
                  />
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
