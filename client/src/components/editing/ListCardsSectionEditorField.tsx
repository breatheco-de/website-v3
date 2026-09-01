import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  FileText,
  Filter,
  LayoutList,
  ListOrdered,
  Search,
  Sparkles,
  X,
} from "lucide-react";
import { IconChevronDown } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useContentTypesRaw } from "@/hooks/useContentTypes";
import { LISTING_SEARCH_MIN_CHARS } from "@shared/listing-search-config";
import { cn } from "@/lib/utils";
import {
  ListCardsItemsPicker,
  type ListCardsPreviewItem,
} from "./ListCardsItemsPicker";

const MIN_LIMIT = 1;
const MAX_LIMIT = 100;
const LIMIT_PRESETS = [6, 9, 12, 24, 48] as const;

export interface ListCardsSectionEditorFieldProps {
  contentType?: string;
  database?: string | null;
  semanticSearchEnabled?: boolean;
  locale: string;
  hasDynamicEntries: boolean;
  searchEnabled: boolean;
  onSearchEnabledChange: (enabled: boolean) => void;
  searchPlaceholder?: string;
  onSearchPlaceholderChange: (value: string) => void;
  searchFields: string[];
  onSearchFieldsChange: (fields: string[]) => void;
  sectionSearchPhrase: string;
  onSectionSearchChange: (value: string | null) => void;
  permanentFilters: Array<{ item_property_slug: string; value: unknown }>;
  onPermanentFiltersChange: (
    filters: Array<{ item_property_slug: string; value: unknown }>,
  ) => void;
  limit?: number;
  onLimitChange: (value: number | null) => void;
  sort?: string;
  itemTemplate?: Record<string, unknown>;
  userFilters?: Array<{ item_property_slug: string; component_renderer: string }>;
  hardcodedItems?: ListCardsPreviewItem[];
  resolvedItems?: ListCardsPreviewItem[];
  unsaved?: boolean;
  "data-testid"?: string;
}

export function ListCardsSectionEditorField({
  contentType,
  database,
  semanticSearchEnabled,
  locale,
  hasDynamicEntries,
  searchEnabled,
  onSearchEnabledChange,
  searchPlaceholder = "",
  onSearchPlaceholderChange,
  searchFields,
  onSearchFieldsChange,
  sectionSearchPhrase,
  onSectionSearchChange,
  permanentFilters,
  onPermanentFiltersChange,
  limit,
  onLimitChange,
  sort,
  itemTemplate,
  userFilters,
  hardcodedItems = [],
  resolvedItems = [],
  unsaved,
  "data-testid": testId,
}: ListCardsSectionEditorFieldProps) {
  const [limitOpen, setLimitOpen] = useState(false);
  const [rankingOpen, setRankingOpen] = useState(false);
  const [visitorSearchOpen, setVisitorSearchOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [draftRanking, setDraftRanking] = useState(sectionSearchPhrase);
  const [draftLimit, setDraftLimit] = useState(String(limit && limit > 0 ? limit : 12));
  const [draftFields, setDraftFields] = useState(searchFields.join(", "));
  const [draftFilterField, setDraftFilterField] = useState("");
  const [draftFilterValue, setDraftFilterValue] = useState("");

  const { data: contentTypesRaw } = useContentTypesRaw();
  const contentTypeConfig = contentTypesRaw?.find((c) => c.name === contentType);
  const dbSlug = database ?? contentTypeConfig?.database_slug ?? null;

  const { data: rawFieldsData, isLoading: rawFieldsLoading } = useQuery<{ fields: string[] }>({
    queryKey: [`/api/databases/${dbSlug}/raw-fields`],
    enabled: Boolean(dbSlug),
    staleTime: 5 * 60 * 1000,
  });

  const filterFieldOptions = useMemo(() => {
    const fromDb = rawFieldsData?.fields ?? [];
    const fromCt = contentTypeConfig?.field_mapping_keys ?? [];
    const merged = dbSlug && fromDb.length > 0 ? fromDb : fromCt;
    return [...new Set(merged)].sort((a, b) => a.localeCompare(b));
  }, [rawFieldsData?.fields, contentTypeConfig?.field_mapping_keys, dbSlug]);

  useEffect(() => setDraftRanking(sectionSearchPhrase), [sectionSearchPhrase]);
  useEffect(() => setDraftLimit(String(limit && limit > 0 ? limit : 12)), [limit]);
  useEffect(() => setDraftFields(searchFields.join(", ")), [searchFields]);

  const permanentFilterCount = permanentFilters.length;

  const upsertPermanentFilter = (slug: string, value: unknown) => {
    const without = permanentFilters.filter((f) => f.item_property_slug !== slug);
    onPermanentFiltersChange([...without, { item_property_slug: slug, value }]);
  };

  const removePermanentFilter = (slug: string) => {
    onPermanentFiltersChange(
      permanentFilters.filter((f) => f.item_property_slug !== slug),
    );
  };

  const addDraftPermanentFilter = () => {
    const slug = draftFilterField.trim();
    if (!slug) return;
    upsertPermanentFilter(slug, draftFilterValue.trim());
    setDraftFilterValue("");
  };

  const headerLabel = contentType
    ? deslugifyContentType(contentType)
    : database
      ? deslugifyContentType(database)
      : "Listing";

  const hasRanking =
    sectionSearchPhrase.trim().length >= LISTING_SEARCH_MIN_CHARS;
  const effectiveLimit = limit && limit > 0 ? limit : 12;
  const noDb = !database;
  const staticOnly = !hasDynamicEntries;
  const visitorSearchFieldCount = searchFields.length;

  if (staticOnly) {
    return (
      <div
        className="rounded-md border border-input bg-background p-4 space-y-2"
        data-testid={testId || "list-cards-section-editor-field"}
      >
        <div className="flex items-center gap-2">
          <LayoutList className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium">Listing</span>
        </div>
        <p className="text-xs text-muted-foreground">
          This section uses static cards only. Add{" "}
          <span className="font-mono text-foreground">dynamic_entries</span> to connect a content
          type or database for preview and semantic search.
        </p>
      </div>
    );
  }

  return (
    <div
      className="rounded-md border border-input bg-background"
      data-testid={testId || "list-cards-section-editor-field"}
    >
      <div className="flex items-center justify-between gap-2 border-b border-input bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium truncate">{headerLabel}</span>
          {unsaved ? (
            <Badge variant="secondary" className="text-[10px]">
              Unsaved
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <Popover open={rankingOpen} onOpenChange={setRankingOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className={cn("relative", noDb && "opacity-60")}
                disabled={noDb}
                title={
                  noDb
                    ? "No database — section ranking unavailable"
                    : hasRanking
                      ? `SSR ranking: ${sectionSearchPhrase.trim()}`
                      : "Default ranking when page loads"
                }
                data-testid="button-list-cards-ranking-search"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {hasRanking && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                    1
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-3 space-y-3 z-[10001]" align="end">
              <div className="space-y-1">
                <p className="text-xs font-medium">Default ranking when page loads</p>
                <p className="text-[11px] text-muted-foreground">
                  Saved as{" "}
                  <span className="font-mono text-foreground">dynamic_entries.search</span>. Not
                  the visitor search box.
                </p>
              </div>
              <Input
                value={draftRanking}
                onChange={(e) => setDraftRanking(e.target.value)}
                placeholder="e.g. python loops"
                className="h-8 text-sm"
                data-testid="input-list-cards-ranking-search"
              />
              <div className="flex gap-2">
                <Button
                  type="button"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={
                    draftRanking.trim().length > 0 &&
                    draftRanking.trim().length < LISTING_SEARCH_MIN_CHARS
                  }
                  onClick={() => {
                    const t = draftRanking.trim();
                    onSectionSearchChange(t.length >= LISTING_SEARCH_MIN_CHARS ? t : null);
                    setRankingOpen(false);
                  }}
                >
                  Apply
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs"
                  onClick={() => {
                    setDraftRanking("");
                    onSectionSearchChange(null);
                  }}
                >
                  Clear
                </Button>
              </div>
            </PopoverContent>
          </Popover>

          <Popover open={visitorSearchOpen} onOpenChange={setVisitorSearchOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className={cn(
                  "relative",
                  noDb && "border-amber-500/50 text-amber-600 dark:text-amber-400",
                )}
                title={
                  noDb
                    ? "No database — semantic search unavailable"
                    : searchEnabled
                      ? `Visitor search on${visitorSearchFieldCount ? ` (${visitorSearchFieldCount} fields)` : ""}`
                      : "Visitor search box (?q=)"
                }
                data-testid="button-list-cards-visitor-search"
              >
                {noDb && (
                  <span
                    className="absolute -top-1 -left-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm pointer-events-none text-[9px] font-bold leading-none"
                    data-testid="badge-list-cards-search-no-db"
                    aria-label="Semantic search unavailable"
                  >
                    !
                  </span>
                )}
                <Search className="h-3.5 w-3.5" />
                {searchEnabled && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                    {visitorSearchFieldCount > 0 ? visitorSearchFieldCount : "1"}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-80 p-0 z-[10001]" align="end">
              <div className="p-2 border-b space-y-1">
                <p className="text-xs font-medium text-foreground">Visitor search box</p>
                <p className="text-[11px] text-muted-foreground">
                  Live search on the public page via URL{" "}
                  <span className="font-mono text-foreground">?q=</span>. Saved as{" "}
                  <span className="font-mono text-foreground">search.enabled</span> and related
                  keys — not the section ranking phrase.
                </p>
              </div>
              <div className="p-3 space-y-3">
                {noDb && (
                  <div
                    className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 flex gap-2 text-xs"
                    data-testid="list-cards-no-db-warning"
                  >
                    <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <p className="text-muted-foreground">
                      No database linked to this content type — semantic search is unavailable.
                      Visitor search will use basic text matching on loaded cards only.
                    </p>
                  </div>
                )}
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="list-cards-visitor-search" className="text-xs font-medium">
                    Show search input
                  </Label>
                  <Switch
                    id="list-cards-visitor-search"
                    checked={searchEnabled}
                    onCheckedChange={onSearchEnabledChange}
                    data-testid="switch-list-cards-visitor-search"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="list-cards-search-placeholder" className="text-[11px] text-muted-foreground">
                    Placeholder
                  </Label>
                  <Input
                    id="list-cards-search-placeholder"
                    placeholder="Search placeholder"
                    value={searchPlaceholder}
                    onChange={(e) => onSearchPlaceholderChange(e.target.value)}
                    className="h-8 text-sm"
                    disabled={!searchEnabled}
                    data-testid="input-list-cards-search-placeholder"
                  />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="list-cards-search-fields" className="text-[11px] text-muted-foreground">
                    Search fields
                  </Label>
                  <p className="text-[11px] text-muted-foreground">
                    Comma-separated DB fields (
                    <span className="font-mono">search.fields</span>
                    ).
                    {noDb ? " Unavailable without a database." : null}
                  </p>
                  <Input
                    id="list-cards-search-fields"
                    value={draftFields}
                    onChange={(e) => setDraftFields(e.target.value)}
                    placeholder="title, description, tags"
                    className="h-8 text-sm"
                    disabled={!searchEnabled || noDb}
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    size="sm"
                    className="h-7 text-xs"
                    disabled={!searchEnabled || noDb}
                    onClick={() => {
                      const fields = draftFields
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean);
                      onSearchFieldsChange(fields);
                      setVisitorSearchOpen(false);
                    }}
                    data-testid="button-list-cards-search-fields-apply"
                  >
                    Apply fields
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => setVisitorSearchOpen(false)}
                  >
                    Close
                  </Button>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="relative"
                title={
                  permanentFilterCount > 0
                    ? `Permanent filters (${permanentFilterCount})`
                    : "Permanent filters — entire pool"
                }
                data-testid="button-list-cards-permanent-filters"
              >
                <Filter className="h-3.5 w-3.5" />
                {permanentFilterCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                    {permanentFilterCount}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-80 p-0 z-[10001]"
              align="end"
              data-testid="popover-list-cards-permanent-filters"
            >
              <div className="p-2 border-b space-y-1">
                <p className="text-xs font-medium text-foreground">Permanent filters</p>
                <p className="text-[11px] text-muted-foreground">
                  Limit which rows this section can load from the database. Visitor search and tag
                  chips narrow further. Value can be plain text or a template.
                </p>
              </div>
              <div className="p-3 space-y-3">
                {permanentFilterCount === 0 ? (
                  <p className="text-[11px] text-muted-foreground">None — entire database pool.</p>
                ) : (
                  <ul className="space-y-1.5" data-testid="list-cards-permanent-filters-list">
                    {permanentFilters.map((pf) => (
                      <li
                        key={pf.item_property_slug}
                        className="flex items-center justify-between gap-2 rounded-md border border-input px-2 py-1.5 text-[11px] font-mono"
                      >
                        <span className="text-muted-foreground truncate">
                          {pf.item_property_slug} = {String(pf.value)}
                        </span>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6 shrink-0"
                          onClick={() => removePermanentFilter(pf.item_property_slug)}
                          data-testid={`button-remove-filter-${pf.item_property_slug}`}
                          aria-label={`Remove filter ${pf.item_property_slug}`}
                        >
                          <X className="h-3 w-3" />
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}

                {filterFieldOptions.length === 0 && !rawFieldsLoading ? (
                  <p className="text-[11px] text-muted-foreground">
                    Connect a content type or database to pick filter fields.
                  </p>
                ) : (
                  <div className="space-y-2">
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">Field</Label>
                      <Select
                        value={draftFilterField || undefined}
                        onValueChange={setDraftFilterField}
                        disabled={rawFieldsLoading || filterFieldOptions.length === 0}
                      >
                        <SelectTrigger
                          className="h-8 text-xs"
                          data-testid="select-list-cards-filter-field"
                        >
                          <SelectValue
                            placeholder={rawFieldsLoading ? "Loading fields…" : "Select field"}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {filterFieldOptions.map((field) => (
                            <SelectItem key={field} value={field} className="text-xs">
                              {field}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1">
                      <Label className="text-[11px] text-muted-foreground">Value</Label>
                      <Input
                        placeholder="e.g. en or {{ single.locale }}"
                        value={draftFilterValue}
                        onChange={(e) => setDraftFilterValue(e.target.value)}
                        className="h-8 text-xs"
                        data-testid="input-list-cards-filter-value"
                      />
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs w-full"
                      disabled={!draftFilterField.trim()}
                      onClick={addDraftPermanentFilter}
                      data-testid="button-list-cards-add-filter"
                    >
                      Add filter
                    </Button>
                  </div>
                )}
              </div>
            </PopoverContent>
          </Popover>

          <Popover open={limitOpen} onOpenChange={setLimitOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="relative"
                data-testid="button-list-cards-limit"
                title={`Show up to ${effectiveLimit} cards`}
              >
                <ListOrdered className="h-3.5 w-3.5" />
                <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                  {effectiveLimit}
                </span>
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 p-3 space-y-3 z-[10001]" align="end">
              <p className="text-xs font-medium">Cards to show</p>
              <div className="flex flex-wrap gap-1.5">
                {LIMIT_PRESETS.map((n) => (
                  <Button
                    key={n}
                    type="button"
                    size="sm"
                    variant={effectiveLimit === n ? "default" : "outline"}
                    className="h-7 min-w-9 px-2 text-xs"
                    onClick={() => {
                      onLimitChange(n);
                      setDraftLimit(String(n));
                      setLimitOpen(false);
                    }}
                  >
                    {n}
                  </Button>
                ))}
              </div>
              <Input
                type="number"
                min={MIN_LIMIT}
                max={MAX_LIMIT}
                value={draftLimit}
                onChange={(e) => setDraftLimit(e.target.value)}
                className="h-8 text-sm"
              />
              <Button
                type="button"
                size="sm"
                className="h-7 text-xs"
                onClick={() => {
                  const n = Number.parseInt(draftLimit, 10);
                  if (Number.isFinite(n) && n >= MIN_LIMIT && n <= MAX_LIMIT) {
                    onLimitChange(n);
                    setLimitOpen(false);
                  }
                }}
              >
                Apply
              </Button>
            </PopoverContent>
          </Popover>
        </div>
      </div>

      <div className="px-3 py-3 space-y-4">
        <p className="text-xs text-muted-foreground">
          The preview below shows what loads before a visitor uses search or tag filters.
        </p>

        <ListCardsItemsPicker
          contentType={contentType}
          database={database}
          locale={locale}
          permanentFilters={permanentFilters}
          itemTemplate={itemTemplate}
          sort={sort}
          searchFields={searchFields}
          sectionSearchPhrase={sectionSearchPhrase}
          limit={limit}
          hardcodedItems={hardcodedItems}
          resolvedItems={resolvedItems}
          semanticSearchEnabled={semanticSearchEnabled}
        />

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <IconChevronDown
                className={cn("h-3.5 w-3.5 transition-transform", advancedOpen && "rotate-180")}
              />
              Read more (advanced)
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-2 space-y-2 text-[11px] text-muted-foreground">
            <p>
              <span className="font-medium text-foreground">Visitor search</span> uses URL{" "}
              <span className="font-mono">?q=</span> and does not change YAML.{" "}
              <span className="font-medium text-foreground">Section ranking</span> is{" "}
              <span className="font-mono">dynamic_entries.search</span>.{" "}
              <span className="font-medium text-foreground">Permanent filters</span> write to{" "}
              <span className="font-mono">dynamic_entries.permanent_filters</span> — field names
              must match database or content-index columns.
            </p>
            {sort ? (
              <p>
                Sort: <span className="font-mono text-foreground">{sort}</span>
              </p>
            ) : null}
            {userFilters?.length ? (
              <p>User filters: {userFilters.map((f) => f.item_property_slug).join(", ")}</p>
            ) : null}
            {itemTemplate ? (
              <p>
                Item template keys:{" "}
                <span className="font-mono">{Object.keys(itemTemplate).join(", ")}</span>
              </p>
            ) : null}
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
}

function deslugifyContentType(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}
