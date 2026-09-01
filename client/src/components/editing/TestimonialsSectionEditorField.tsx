import React, { useEffect, useState } from "react";
import { ArrowUpDown, ListOrdered, Plus, Quote, Sparkles, Tags } from "lucide-react";
import { IconAlertTriangle, IconChevronDown, IconLoader2 } from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { RelatedFeaturesPicker } from "@/components/editing/RelatedFeaturesPicker";
import {
  TestimonialItemsPreview,
  type HardcodedTestimonialItem,
} from "@/components/editing/TestimonialItemsPreview";
import { MAX_RELATED_FEATURES } from "@/lib/faqConstants";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  TESTIMONIALS_DATABASE,
  TESTIMONIALS_LIMIT_DEFAULTS,
  TESTIMONIALS_MAX_LIMIT,
  TESTIMONIALS_SORT,
  TESTIMONIALS_SORT_PRESETS,
  testimonialSortBadge,
  testimonialSortLabel,
  type TestimonialBankRow,
  type TestimonialsSectionType,
} from "@shared/testimonials-listing";

export type { TestimonialsSectionType };

const TESTIMONIAL_LIMIT_PRESETS = [5, 6, 9, 10, 12, 15, 20, 30] as const;
const MIN_TESTIMONIAL_LIMIT = 1;
const MIN_SEARCH_CHARS = 3;

export interface TestimonialsSectionEditorFieldProps {
  /** `dynamic_entries.permanent_filters` → `related_features`. */
  topics: string[];
  onTopicsChange: (value: string[]) => void;
  /** `dynamic_entries.search` — semantic phrase, min 3 chars. */
  searchPhrase?: string;
  onSearchChange?: (value: string | null) => void;
  locale: string;
  sectionType: TestimonialsSectionType;
  /** `dynamic_entries.limit` — total rows, manually added counted first. */
  limit?: number;
  onLimitChange?: (value: number | null) => void;
  /** `dynamic_entries.sort` — bank row order after manually added entries. */
  sort?: string;
  onSortChange?: (value: string | null) => void;
  /** `dynamic_entries.hardcoded_entries`, in editor shape. */
  hardcodedItems?: HardcodedTestimonialItem[];
  onHardcodedItemsChange?: (items: HardcodedTestimonialItem[]) => void;
  /** Server-resolved `items` for this section (manually added first, then bank). */
  resolvedItems?: TestimonialBankRow[];
  "data-testid"?: string;
}

const EMPTY_FORM = {
  name: "",
  role: "",
  company: "",
  rating: "5",
  comment: "",
  outcome: "",
  avatar: "",
};

export function TestimonialsSectionEditorField({
  topics,
  onTopicsChange,
  searchPhrase = "",
  onSearchChange,
  locale,
  sectionType,
  limit,
  onLimitChange,
  sort,
  onSortChange,
  hardcodedItems = [],
  onHardcodedItemsChange,
  resolvedItems = [],
  "data-testid": testId,
}: TestimonialsSectionEditorFieldProps) {
  const { toast } = useToast();
  const [topicsOpen, setTopicsOpen] = useState(false);
  const [limitOpen, setLimitOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const isSpanish = locale === "es";
  const isGrid = sectionType === "testimonials_grid";
  const supportsHardcoded = !isGrid && !!onHardcodedItemsChange;
  const topicCount = topics.length;

  const defaultLimit = TESTIMONIALS_LIMIT_DEFAULTS[sectionType];
  const [draftLimit, setDraftLimit] = useState(
    String(limit && limit > 0 ? limit : defaultLimit),
  );
  const [draftSearch, setDraftSearch] = useState(searchPhrase);

  useEffect(() => {
    setDraftLimit(String(limit && limit > 0 ? limit : defaultLimit));
  }, [limit, defaultLimit]);

  useEffect(() => {
    setDraftSearch(searchPhrase);
  }, [searchPhrase]);

  const effectiveLimit = Math.min(
    TESTIMONIALS_MAX_LIMIT,
    limit && limit > 0 ? limit : defaultLimit,
  );
  const hasCustomLimit = typeof limit === "number" && limit > 0;
  const draftLimitNum = Number.parseInt(draftLimit, 10);
  const canApplyLimit =
    Number.isFinite(draftLimitNum) &&
    draftLimitNum >= MIN_TESTIMONIAL_LIMIT &&
    draftLimitNum <= TESTIMONIALS_MAX_LIMIT;

  const activeSearch = searchPhrase.trim();
  const hasSearch = activeSearch.length >= MIN_SEARCH_CHARS;
  const draftSearchTrimmed = draftSearch.trim();
  const canApplySearch = draftSearchTrimmed.length >= MIN_SEARCH_CHARS;

  const effectiveSort = sort?.trim() || TESTIMONIALS_SORT;
  const sortLabel = testimonialSortLabel(sort, locale || "en");
  const sortBadge = testimonialSortBadge(sort);
  const hasNonDefaultSort = effectiveSort !== TESTIMONIALS_SORT;

  // Cheap probe (one row) purely to tell staff when semantic search is cold and
  // the section fell back to keyword matching.
  const { data: searchProbe, isFetching: probing } = useQuery<{
    semantic: boolean;
    fallback_message?: string;
  }>({
    queryKey: [
      `/api/databases/${TESTIMONIALS_DATABASE}/search?q=${encodeURIComponent(activeSearch)}&limit=1&locale=${encodeURIComponent(locale || "en")}`,
    ],
    enabled: hasSearch,
    staleTime: 60 * 1000,
  });
  const isKeywordOnly = hasSearch && searchProbe?.semantic === false;

  const framing = isGrid
    ? isSpanish
      ? "Esta sección lista personas del banco central. Los topics y la búsqueda eligen a quién; el límite dice cuántas."
      : "This section lists people from the central bank. Topics and search choose who; the limit says how many."
    : isSpanish
      ? "Los topics y la búsqueda eligen personas del banco central. Los testimonios que agregues aquí viven solo en esta página y van primero."
      : "Topics and search pick people from the central bank. Testimonials you add here live on this page only and come first.";

  const openAdd = () => {
    setForm(EMPTY_FORM);
    setAddOpen(true);
  };

  const submitAdd = () => {
    if (!onHardcodedItemsChange) return;
    const name = form.name.trim();
    const role = form.role.trim();
    const comment = form.comment.trim();
    const ratingNum = Number.parseInt(form.rating, 10);
    if (!name || !role || !comment) {
      toast({
        title: isSpanish ? "Campos requeridos" : "Required fields",
        description: isSpanish
          ? "Nombre, rol y comentario son obligatorios."
          : "Name, role, and comment are required.",
        variant: "destructive",
      });
      return;
    }
    if (!Number.isFinite(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      toast({
        title: isSpanish ? "Rating inválido" : "Invalid rating",
        description: isSpanish
          ? "El rating debe ser entre 1 y 5."
          : "Rating must be between 1 and 5.",
        variant: "destructive",
      });
      return;
    }
    const entry: HardcodedTestimonialItem = {
      name,
      role,
      rating: ratingNum,
      comment,
    };
    const company = form.company.trim();
    const outcome = form.outcome.trim();
    const avatar = form.avatar.trim();
    if (company) entry.company = company;
    if (outcome) entry.outcome = outcome;
    if (avatar) entry.avatar = avatar;

    onHardcodedItemsChange([...hardcodedItems, entry]);
    setAddOpen(false);
    setForm(EMPTY_FORM);
    toast({
      title: isSpanish
        ? "Testimonio agregado a esta sección"
        : "Testimonial added to this section",
    });
  };

  return (
    <div
      className="rounded-md border border-input bg-background"
      data-testid={testId || "testimonials-section-editor-field"}
    >
      <div className="flex items-center justify-between gap-2 border-b border-input bg-muted/30 px-3 py-2">
        <div className="flex items-center gap-2 min-w-0">
          <Quote className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="text-sm font-medium">Testimonials</span>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          {onSearchChange && (
            <Popover open={searchOpen} onOpenChange={setSearchOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className={cn(
                    "relative",
                    isKeywordOnly &&
                      "border-amber-500/50 text-amber-600 dark:text-amber-400",
                  )}
                  data-testid="button-testimonials-search"
                  title={
                    isKeywordOnly
                      ? `Semantic search unavailable — keyword only: ${activeSearch}`
                      : hasSearch
                        ? `Semantic search: ${activeSearch}`
                        : "Find testimonials by meaning (semantic search)"
                  }
                >
                  {isKeywordOnly && (
                    <span
                      className="absolute -top-1 -left-1 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-destructive text-destructive-foreground shadow-sm pointer-events-none text-[9px] font-bold leading-none"
                      data-testid="badge-testimonials-search-unavailable"
                      aria-label="Vector search unavailable"
                    >
                      !
                    </span>
                  )}
                  <Sparkles className="h-3.5 w-3.5" />
                  {hasSearch && (
                    <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                      1
                    </span>
                  )}
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-80 p-0 z-[10001]"
                align="end"
                data-testid="popover-testimonials-search"
              >
                <div className="p-2 border-b space-y-1">
                  <p className="text-xs font-medium text-foreground">
                    {isSpanish ? "Buscar por significado" : "Search by meaning"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {isSpanish
                      ? `La frase se guarda en esta sección y ordena el banco por significado; los topics siguen filtrando. Mínimo ${MIN_SEARCH_CHARS} caracteres.`
                      : `The phrase is saved on this section and ranks the bank by meaning; topics still filter. Min ${MIN_SEARCH_CHARS} characters.`}
                  </p>
                </div>
                <div className="p-3 space-y-3">
                  <Input
                    value={draftSearch}
                    onChange={(e) => setDraftSearch(e.target.value)}
                    placeholder="e.g. career change from hospitality"
                    className="h-8 text-sm"
                    data-testid="input-testimonials-search"
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && canApplySearch) {
                        e.preventDefault();
                        onSearchChange(draftSearchTrimmed);
                        setSearchOpen(false);
                      }
                    }}
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="h-7 text-xs"
                      disabled={!canApplySearch}
                      onClick={() => {
                        onSearchChange(draftSearchTrimmed);
                        setSearchOpen(false);
                      }}
                      data-testid="button-testimonials-search-apply"
                    >
                      Apply
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs"
                      disabled={!hasSearch && !draftSearchTrimmed}
                      onClick={() => {
                        setDraftSearch("");
                        onSearchChange(null);
                      }}
                      data-testid="button-testimonials-search-clear"
                    >
                      Clear
                    </Button>
                  </div>
                  {draftSearchTrimmed.length > 0 &&
                    draftSearchTrimmed.length < MIN_SEARCH_CHARS && (
                      <p className="text-[11px] text-muted-foreground">
                        Enter at least {MIN_SEARCH_CHARS} characters to apply.
                      </p>
                    )}
                  {isKeywordOnly && (
                    <div
                      className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 space-y-1"
                      data-testid="testimonials-search-fallback-banner"
                    >
                      <div className="flex items-center gap-1.5 text-xs font-medium text-amber-700 dark:text-amber-400">
                        <IconAlertTriangle className="h-3.5 w-3.5 shrink-0" />
                        Keyword matching only
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        {searchProbe?.fallback_message ??
                          "Semantic search could not run, so results use exact keyword matching."}
                      </p>
                    </div>
                  )}
                  <div className="rounded-md border border-border bg-muted/30 p-2.5 space-y-1.5">
                    <p className="text-xs font-medium text-foreground flex items-center gap-1.5">
                      {probing ? (
                        <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Sparkles className="h-3.5 w-3.5 text-orange-500" />
                      )}
                      How search works here
                    </p>
                    <p className="text-[11px] text-muted-foreground leading-relaxed">
                      The phrase ranks bank testimonials by{" "}
                      <span className="text-foreground font-medium">meaning</span> when
                      semantic search is warm, and falls back to keyword matching when it
                      is not. Topics still filter the ranked list, and remaining slots are
                      filled from filter-only matches.
                    </p>
                  </div>
                </div>
              </PopoverContent>
            </Popover>
          )}

          {onSortChange && (
            <Popover open={sortOpen} onOpenChange={setSortOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="relative"
                  data-testid="button-testimonials-sort"
                  title={
                    isSpanish
                      ? `Orden: ${sortLabel}`
                      : `Sort: ${sortLabel}`
                  }
                >
                  <ArrowUpDown className="h-3.5 w-3.5" />
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                    {sortBadge}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-72 p-0 z-[10001]"
                align="end"
                data-testid="popover-testimonials-sort"
              >
                <div className="p-2 border-b space-y-1">
                  <p className="text-xs font-medium text-foreground">
                    {isSpanish ? "Orden del banco" : "Bank sort order"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {isSpanish
                      ? "Elige cómo se ordenan los testimonios del banco después de los que agregues manualmente. Por defecto: prioridad 1 antes que 3."
                      : "Choose how bank testimonials are ordered after any you add manually. Default: priority 1 before 3."}
                  </p>
                  {hasSearch && (
                    <p className="text-[11px] text-muted-foreground">
                      {isSpanish
                        ? "Con búsqueda activa, el significado ordena primero; este criterio desempata el resto."
                        : "With search active, meaning ranks first; this sort is the tiebreaker for filter-only backfill."}
                    </p>
                  )}
                </div>
                <div className="p-3 space-y-2">
                  <div className="flex flex-col gap-1">
                    {TESTIMONIALS_SORT_PRESETS.map((preset) => {
                      const label = isSpanish ? preset.labelEs : preset.labelEn;
                      const selected = effectiveSort === preset.value;
                      return (
                        <Button
                          key={preset.value}
                          type="button"
                          size="sm"
                          variant={selected ? "default" : "outline"}
                          className="h-8 justify-start text-xs"
                          onClick={() => {
                            onSortChange(
                              preset.value === TESTIMONIALS_SORT
                                ? TESTIMONIALS_SORT
                                : preset.value,
                            );
                            setSortOpen(false);
                          }}
                          data-testid={`button-testimonials-sort-preset-${preset.value.replace(/^-/, "desc-")}`}
                        >
                          {label}
                        </Button>
                      );
                    })}
                  </div>
                  {hasNonDefaultSort && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs px-0"
                      onClick={() => {
                        onSortChange(TESTIMONIALS_SORT);
                        setSortOpen(false);
                      }}
                      data-testid="button-testimonials-sort-reset"
                    >
                      {isSpanish ? "Restablecer por defecto" : "Reset to default"}
                    </Button>
                  )}
                  <p className="text-[11px] text-muted-foreground">
                    {isSpanish
                      ? "No cambia textos, fotos ni el otro idioma; no escribe en el banco."
                      : "Does not change text, photos, or the other locale; does not write to the bank."}
                  </p>
                </div>
              </PopoverContent>
            </Popover>
          )}

          {onLimitChange && (
            <Popover open={limitOpen} onOpenChange={setLimitOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="relative"
                  data-testid="button-testimonials-limit"
                  title={`Show up to ${effectiveLimit} testimonials`}
                >
                  <ListOrdered className="h-3.5 w-3.5" />
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                    {effectiveLimit}
                  </span>
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-72 p-0 z-[10001]"
                align="end"
                data-testid="popover-testimonials-limit"
              >
                <div className="p-2 border-b space-y-1">
                  <p className="text-xs font-medium text-foreground">
                    {isSpanish ? "Testimonios a mostrar" : "Testimonials to show"}
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    {isSpanish
                      ? `Total de la sección (los agregados manualmente cuentan primero; el resto viene del banco). Máx. ${TESTIMONIALS_MAX_LIMIT}. Se guarda como `
                      : `Total for this section (manually added count first; the rest come from the bank). Max ${TESTIMONIALS_MAX_LIMIT}. Saved as `}
                    <span className="font-mono text-foreground">
                      dynamic_entries.limit
                    </span>
                    .
                  </p>
                </div>
                <div className="p-3 space-y-3">
                  <div className="flex flex-wrap gap-1.5">
                    {TESTIMONIAL_LIMIT_PRESETS.map((n) => (
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
                        data-testid={`button-testimonials-limit-preset-${n}`}
                      >
                        {n}
                      </Button>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="number"
                      min={MIN_TESTIMONIAL_LIMIT}
                      max={TESTIMONIALS_MAX_LIMIT}
                      value={draftLimit}
                      onChange={(e) => setDraftLimit(e.target.value)}
                      className="h-8 text-sm"
                      data-testid="input-testimonials-limit"
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && canApplyLimit) {
                          e.preventDefault();
                          onLimitChange(draftLimitNum);
                          setLimitOpen(false);
                        }
                      }}
                    />
                    <Button
                      type="button"
                      size="sm"
                      className="h-8 text-xs shrink-0"
                      disabled={!canApplyLimit}
                      onClick={() => {
                        onLimitChange(draftLimitNum);
                        setLimitOpen(false);
                      }}
                      data-testid="button-testimonials-limit-apply"
                    >
                      Apply
                    </Button>
                  </div>
                  {!canApplyLimit && draftLimit.trim().length > 0 && (
                    <p className="text-[11px] text-muted-foreground">
                      Enter a number from {MIN_TESTIMONIAL_LIMIT} to{" "}
                      {TESTIMONIALS_MAX_LIMIT}.
                    </p>
                  )}
                  {hasCustomLimit && effectiveLimit !== defaultLimit && (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs px-0"
                      onClick={() => {
                        onLimitChange(defaultLimit);
                        setDraftLimit(String(defaultLimit));
                      }}
                      data-testid="button-testimonials-limit-reset"
                    >
                      Reset to {defaultLimit}
                    </Button>
                  )}
                </div>
              </PopoverContent>
            </Popover>
          )}

          <Popover open={topicsOpen} onOpenChange={setTopicsOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="relative"
                data-testid="button-testimonials-topics"
                title={
                  topicCount > 0
                    ? `Topics (${topicCount}/${MAX_RELATED_FEATURES})`
                    : "Filter testimonials by topic"
                }
              >
                <Tags className="h-3.5 w-3.5" />
                {topicCount > 0 && (
                  <span className="absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-medium text-primary-foreground">
                    {topicCount}
                  </span>
                )}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              className="w-80 p-0 z-[10001]"
              align="end"
              data-testid="popover-testimonials-topics"
            >
              <div className="p-2 border-b">
                <p className="text-xs font-medium text-foreground">
                  {isSpanish
                    ? "Filtrar testimonios por topic"
                    : "Filter testimonials by topic"}
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  {isSpanish
                    ? `Selecciona hasta ${MAX_RELATED_FEATURES} topics para traer testimonios del banco centralizado.`
                    : `Select up to ${MAX_RELATED_FEATURES} topics to pull matching testimonials from the centralized bank.`}
                </p>
              </div>
              <div className="p-3">
                <RelatedFeaturesPicker
                  value={topics}
                  onChange={onTopicsChange}
                  locale={locale}
                  context="testimonials"
                  hideLabel
                />
              </div>
            </PopoverContent>
          </Popover>

          {supportsHardcoded && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={openAdd}
              data-testid="button-testimonials-add-item"
            >
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Add
            </Button>
          )}
        </div>
      </div>

      <div className="px-3 py-3 space-y-3">
        <p className="text-xs text-muted-foreground">{framing}</p>
        {isGrid && (
          <p className="text-xs text-muted-foreground">
            {isSpanish
              ? "Los colores de las tarjetas siguen la marca “featured” del banco: las personas destacadas usan los colores featured de esta sección; el resto usa los colores por defecto."
              : "Card colors follow the bank’s “featured” flag: featured people use this section’s featured colors, everyone else uses the default colors."}
          </p>
        )}

        {(onSortChange ||
          topicCount > 0 ||
          hasSearch ||
          hardcodedItems.length > 0 ||
          hasCustomLimit) && (
          <div className="flex items-center gap-2 flex-wrap">
            {onSortChange && (
              <Badge
                variant="secondary"
                className="text-xs font-normal"
                data-testid="badge-testimonials-sort"
              >
                {isSpanish ? "Orden" : "Sort"}: {sortLabel}
              </Badge>
            )}
            {hasCustomLimit && (
              <Badge variant="secondary" className="text-xs font-normal">
                Limit: {effectiveLimit}
              </Badge>
            )}
            {hasSearch && (
              <Badge variant="secondary" className="text-xs font-normal">
                Search: {activeSearch}
              </Badge>
            )}
            {topicCount > 0 && (
              <Badge variant="secondary" className="text-xs font-normal">
                {topicCount} topic{topicCount !== 1 ? "s" : ""}
              </Badge>
            )}
            {hardcodedItems.length > 0 && (
              <Badge variant="secondary" className="text-xs font-normal">
                {hardcodedItems.length} manually added
              </Badge>
            )}
          </div>
        )}

        <TestimonialItemsPreview
          hardcodedItems={supportsHardcoded ? hardcodedItems : []}
          onHardcodedItemsChange={
            supportsHardcoded ? onHardcodedItemsChange : undefined
          }
          resolvedItems={resolvedItems}
          resolvedHardcodedCount={supportsHardcoded ? hardcodedItems.length : 0}
          hasTopics={topicCount > 0}
          hasSearch={hasSearch}
          locale={locale || "en"}
        />

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              data-testid="button-testimonials-advanced-read-more"
            >
              Read more (advanced)
              <IconChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform",
                  advancedOpen && "rotate-180",
                )}
              />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-2 rounded-md border border-border bg-muted/20 p-2.5 space-y-1.5 text-[11px] text-muted-foreground font-mono leading-relaxed">
              <p>
                Bank:{" "}
                <span className="text-foreground">
                  db/{TESTIMONIALS_DATABASE}
                </span>{" "}
                — one database for all locales, filtered by the row&apos;s{" "}
                <span className="text-foreground">locale</span>
              </p>
              <p>
                Filters / search / limit / sort:{" "}
                <span className="text-foreground">
                  dynamic_entries.permanent_filters
                </span>
                , <span className="text-foreground">dynamic_entries.search</span>,{" "}
                <span className="text-foreground">dynamic_entries.limit</span>,{" "}
                <span className="text-foreground">dynamic_entries.sort</span>
              </p>
              <p>
                Sort: default <span className="text-foreground">priority</span> (1
                before 3); prefix <span className="text-foreground">-</span> reverses
                (e.g. <span className="text-foreground">-rating</span>). Per-person rank
                lives on each bank row&apos;s{" "}
                <span className="text-foreground">priority</span> field.
              </p>
              <p>
                Topics: <span className="text-foreground">related_features</span> — a
                testimonial matches if it has any selected topic
              </p>
              {!isGrid && (
                <p>
                  Manually added:{" "}
                  <span className="text-foreground">
                    dynamic_entries.hardcoded_entries[]
                  </span>{" "}
                  on this section YAML only; may carry layout-only extras (slide
                  country, status, achievement)
                </p>
              )}
              <p>
                Resolve order: manually added first, then bank rows fill the remaining
                slots up to limit (default {defaultLimit}, max{" "}
                {TESTIMONIALS_MAX_LIMIT}); each layout then drops rows it cannot render
                (anonymous, and video or missing photo depending on layout)
              </p>
              <p>
                Shared search:{" "}
                <span className="text-foreground">server/database-search.ts</span> —
                vector fields excerpt / content / full_text, keyword fallback when cold
              </p>
              {isGrid && (
                <p>
                  Card colors:{" "}
                  <span className="text-foreground">
                    featured_box_color | featured_name_color | featured_role_color |
                    featured_comment_color
                  </span>{" "}
                  for rows with <span className="text-foreground">featured: true</span>{" "}
                  in the bank, else the default_* colors
                </p>
              )}
              <p>
                Non-effects: editing this section never writes the bank, never changes
                who is <span className="text-foreground">featured</span>, and never
                touches the other locale
              </p>
              <p>
                UI:{" "}
                <span className="text-foreground">
                  client/src/components/editing/TestimonialsSectionEditorField.tsx
                </span>
              </p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </div>

      {supportsHardcoded && (
        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent className="max-w-md z-[10002]">
            <DialogHeader>
              <DialogTitle>
                {isSpanish
                  ? "Agregar testimonio (solo esta sección)"
                  : "Add testimonial (this section only)"}
              </DialogTitle>
              <DialogDescription>
                {isSpanish
                  ? "Se guarda en el YAML de esta sección y aparece antes de los del banco. El banco centralizado no se modifica."
                  : "Saved on this section’s YAML and shown before bank rows. The centralized bank is not changed."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs">Name</Label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  className="h-8 text-sm"
                  data-testid="input-testimonial-add-name"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Role</Label>
                <Input
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                  className="h-8 text-sm"
                  data-testid="input-testimonial-add-role"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Company</Label>
                  <Input
                    value={form.company}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, company: e.target.value }))
                    }
                    className="h-8 text-sm"
                    data-testid="input-testimonial-add-company"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Rating (1–5)</Label>
                  <Input
                    type="number"
                    min={1}
                    max={5}
                    value={form.rating}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, rating: e.target.value }))
                    }
                    className="h-8 text-sm"
                    data-testid="input-testimonial-add-rating"
                  />
                </div>
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Comment</Label>
                <Textarea
                  value={form.comment}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, comment: e.target.value }))
                  }
                  className="text-sm min-h-[80px]"
                  data-testid="input-testimonial-add-comment"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Outcome (optional)</Label>
                <Input
                  value={form.outcome}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, outcome: e.target.value }))
                  }
                  className="h-8 text-sm"
                  data-testid="input-testimonial-add-outcome"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Avatar image ID (optional)</Label>
                <Input
                  value={form.avatar}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, avatar: e.target.value }))
                  }
                  className="h-8 text-sm"
                  data-testid="input-testimonial-add-avatar"
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setAddOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={submitAdd}
                data-testid="button-testimonial-add-save"
              >
                Add
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}
