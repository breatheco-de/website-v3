import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Star } from "lucide-react";
import {
  IconArrowBackUp,
  IconEyeOff,
  IconLoader2,
  IconTrash,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/queryClient";
import {
  TESTIMONIALS_DATABASE,
  editorItemToBankRow,
  isAnonymousTestimonial,
  testimonialIgnoreIdentity,
  testimonialText,
  type TestimonialBankRow,
  type TestimonialEditorItem,
  type TestimonialsSectionType,
} from "@shared/testimonials-listing";

/** Editor-friendly shape for a manually added testimonial (this section only). */
export type HardcodedTestimonialItem = TestimonialEditorItem;

type DisplaySource = "hardcoded" | "db";

type DisplayItem = {
  key: string;
  name: string;
  role?: string;
  company?: string;
  rating?: number;
  text: string;
  avatar?: string;
  source: DisplaySource;
  featured?: boolean;
  ignoreIdentity: string;
  rawRow?: TestimonialBankRow;
};

export interface TestimonialsItemsPickerProps {
  sectionType: TestimonialsSectionType;
  locale: string;
  permanentFilters: Array<{ item_property_slug: string; value: string | string[] }>;
  searchPhrase?: string;
  resolvedSearchPhrase?: string;
  sort?: string;
  limit: number;
  hardcodedItems?: HardcodedTestimonialItem[];
  hardcodedBankRows?: TestimonialBankRow[];
  ignoredEntries: string[];
  onIgnoredEntriesChange?: (keys: string[]) => void;
  onHardcodedItemsChange?: (items: HardcodedTestimonialItem[]) => void;
  singleEntry?: Record<string, unknown>;
}

type PreviewResponse = {
  items: TestimonialBankRow[];
  total: number;
  hardcodedCount: number;
};

const PREVIEW_DEBOUNCE_MS = 300;

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function hardcodedKey(item: HardcodedTestimonialItem, index: number): string {
  const base = item.name.trim().toLowerCase() || "unnamed";
  return `hardcoded:${base}:${index}`;
}

function buildPreviewUrl(params: {
  sectionType: TestimonialsSectionType;
  locale: string;
  dynamicEntries: Record<string, unknown>;
  singleEntry?: Record<string, unknown>;
}): string {
  const qs = new URLSearchParams();
  qs.set("section_type", params.sectionType);
  qs.set("locale", params.locale);
  qs.set("dynamic_entries", JSON.stringify(params.dynamicEntries));
  if (params.singleEntry && Object.keys(params.singleEntry).length > 0) {
    qs.set("single_entry", JSON.stringify(params.singleEntry));
  }
  return `/api/listings/testimonials-section-preview?${qs.toString()}`;
}

export function TestimonialsItemsPicker({
  sectionType,
  locale,
  permanentFilters,
  searchPhrase = "",
  resolvedSearchPhrase,
  sort,
  limit,
  hardcodedItems = [],
  hardcodedBankRows = [],
  ignoredEntries,
  onIgnoredEntriesChange,
  onHardcodedItemsChange,
  singleEntry,
}: TestimonialsItemsPickerProps) {
  const isSpanish = locale === "es";
  const [deleteConfirm, setDeleteConfirm] = useState<{
    index: number;
    name: string;
  } | null>(null);

  const activeSearch = (resolvedSearchPhrase ?? searchPhrase ?? "").trim();
  const hasSearch = activeSearch.length >= 3;
  const hasTopics = permanentFilters.some(
    (pf) =>
      pf.item_property_slug === "related_features" &&
      (Array.isArray(pf.value) ? pf.value.length > 0 : Boolean(pf.value)),
  );
  const hasFilters = hasTopics || hasSearch;

  const dynamicEntriesPayload = useMemo(() => {
    const hardcoded_entries =
      hardcodedBankRows.length > 0
        ? hardcodedBankRows
        : hardcodedItems.map((entry, index) =>
            editorItemToBankRow(entry, hardcodedBankRows[index]),
          );

    const payload: Record<string, unknown> = {
      database: TESTIMONIALS_DATABASE,
      limit,
    };
    if (sort?.trim()) payload.sort = sort.trim();
    if (searchPhrase.trim()) payload.search = searchPhrase.trim();
    if (permanentFilters.length) payload.permanent_filters = permanentFilters;
    if (ignoredEntries.length) payload.ignored_entries = ignoredEntries;
    if (hardcoded_entries.length) payload.hardcoded_entries = hardcoded_entries;
    return payload;
  }, [
    hardcodedBankRows,
    hardcodedItems,
    ignoredEntries,
    limit,
    permanentFilters,
    searchPhrase,
    sort,
  ]);

  const previewParamsKey = useMemo(
    () =>
      JSON.stringify({
        sectionType,
        locale,
        dynamicEntriesPayload,
        singleEntry: singleEntry ?? null,
      }),
    [sectionType, locale, dynamicEntriesPayload, singleEntry],
  );

  const [debouncedParams, setDebouncedParams] = useState(previewParamsKey);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debouncedParams === previewParamsKey) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setDebouncedParams(previewParamsKey);
    }, PREVIEW_DEBOUNCE_MS);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [previewParamsKey, debouncedParams]);

  const previewUrl = useMemo(() => {
    if (!debouncedParams) return null;
    const parsed = JSON.parse(debouncedParams) as {
      sectionType: TestimonialsSectionType;
      locale: string;
      dynamicEntriesPayload: Record<string, unknown>;
      singleEntry: Record<string, unknown> | null;
    };
    return buildPreviewUrl({
      sectionType: parsed.sectionType,
      locale: parsed.locale,
      dynamicEntries: parsed.dynamicEntriesPayload,
      singleEntry: parsed.singleEntry ?? undefined,
    });
  }, [debouncedParams]);

  const {
    data: previewData,
    isLoading,
    isFetching,
    isError,
    error,
    refetch,
  } = useQuery<PreviewResponse>({
    queryKey: previewUrl ? [previewUrl] : ["testimonials-section-preview-idle"],
    queryFn: async () => {
      if (!previewUrl) {
        throw new Error("Preview URL not ready");
      }
      const res = await apiFetch(previewUrl);
      if (!res.ok) {
        const text = (await res.text()) || res.statusText;
        throw new Error(text || `Preview failed (${res.status})`);
      }
      return (await res.json()) as PreviewResponse;
    },
    enabled: Boolean(previewUrl),
    staleTime: 30 * 1000,
    retry: 1,
  });

  const identityLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const row of previewData?.items ?? []) {
      const identity = testimonialIgnoreIdentity(row as Record<string, unknown>);
      map.set(identity, row.student_name ?? identity);
      const nameKey = testimonialIgnoreIdentity({ student_name: row.student_name });
      if (row.student_name) map.set(nameKey, row.student_name);
    }
    return map;
  }, [previewData?.items]);

  const displayedItems: DisplayItem[] = useMemo(() => {
    const hardcodedCount = previewData?.hardcodedCount ?? 0;
    const rows = previewData?.items ?? [];

    return rows
      .filter((row) => !isAnonymousTestimonial(row.student_name))
      .map((row, index) => {
        const isHardcoded = index < hardcodedCount;
        const ignoreIdentity = testimonialIgnoreIdentity(row as Record<string, unknown>);
        return {
          key: isHardcoded
            ? hardcodedKey(
                {
                  name: row.student_name ?? "",
                  role: row.role ?? "",
                  rating: typeof row.rating === "number" ? row.rating : 5,
                  comment: testimonialText(row),
                },
                index,
              )
            : `db:${ignoreIdentity}:${index}`,
          name: row.student_name ?? "",
          role: row.role,
          company: row.company,
          rating: row.rating,
          text: testimonialText(row),
          avatar: row.student_thumb,
          source: isHardcoded ? ("hardcoded" as const) : ("db" as const),
          featured: row.featured,
          ignoreIdentity,
          rawRow: row,
        };
      });
  }, [previewData?.hardcodedCount, previewData?.items]);

  const hardcodedCount = displayedItems.filter((i) => i.source === "hardcoded").length;
  const dbCount = displayedItems.filter((i) => i.source === "db").length;
  const canDeleteHardcoded = !!onHardcodedItemsChange;
  const canHideDb = !!onIgnoredEntriesChange;
  const loading = isLoading || isFetching || debouncedParams !== previewParamsKey;

  const ignoredItemsResolved = useMemo(() => {
    if (!ignoredEntries.length) return [];
    return ignoredEntries.map((key) => ({
      key,
      name: identityLabels.get(key) ?? key,
    }));
  }, [ignoredEntries, identityLabels]);

  const confirmDelete = () => {
    if (!deleteConfirm || !onHardcodedItemsChange) return;
    onHardcodedItemsChange(
      hardcodedItems.filter((_, i) => i !== deleteConfirm.index),
    );
    setDeleteConfirm(null);
  };

  const handleHideDbRow = (item: DisplayItem) => {
    if (!onIgnoredEntriesChange) return;
    const key = item.ignoreIdentity;
    if (ignoredEntries.includes(key)) return;
    onIgnoredEntriesChange([...ignoredEntries, key]);
  };

  if (isError) {
    return (
      <div className="space-y-2">
        <Label className="text-sm font-medium">Items</Label>
        <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 space-y-2">
          <p className="text-xs text-destructive font-medium">
            {isSpanish ? "No se pudo cargar la vista previa" : "Couldn’t load preview"}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {error instanceof Error ? error.message : String(error)}
          </p>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-7 text-xs"
            onClick={() => refetch()}
            data-testid="button-testimonials-preview-retry"
          >
            {isSpanish ? "Reintentar" : "Retry"}
          </Button>
        </div>
      </div>
    );
  }

  if (loading && !previewData) {
    return (
      <div className="space-y-2">
        <Label className="text-sm font-medium flex items-center gap-1.5">
          Items
          <IconLoader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        </Label>
        <div className="animate-pulse space-y-2">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-12 bg-muted rounded-lg" />
          ))}
        </div>
      </div>
    );
  }

  if (displayedItems.length === 0) {
    const emptyCopy = hasFilters
      ? isSpanish
        ? "Nada del banco coincide con los topics o la búsqueda actuales."
        : "Nothing from the bank matches the current topics or search."
      : isSpanish
        ? "Sin testimonios todavía. Agrega uno manualmente o espera filas del banco."
        : "No testimonials yet. Add one manually or wait for bank rows to resolve.";
    return (
      <div className="space-y-2">
        <Label className="text-sm font-medium">Items (0)</Label>
        <p className="text-xs text-muted-foreground">{emptyCopy}</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <Label className="text-sm font-medium flex items-center gap-1.5 flex-wrap">
        Items ({displayedItems.length})
        {loading && (
          <IconLoader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
        )}
        {hardcodedCount > 0 && (
          <Badge variant="secondary" className="text-[10px] font-normal">
            {hardcodedCount} manually added
          </Badge>
        )}
        {dbCount > 0 && (
          <Badge variant="outline" className="text-[10px] font-normal">
            {dbCount} DB
          </Badge>
        )}
        {ignoredEntries.length > 0 && (
          <Badge variant="outline" className="text-[10px] font-normal">
            {ignoredEntries.length} hidden
          </Badge>
        )}
      </Label>
      <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
        {displayedItems.map((item) => {
          const hardcodedIndex =
            item.source === "hardcoded"
              ? hardcodedItems.findIndex(
                  (h, i) => hardcodedKey(h, i) === item.key,
                )
              : -1;
          return (
            <TestimonialItemRow
              key={item.key}
              item={item}
              locale={locale}
              onDelete={
                item.source === "hardcoded" && canDeleteHardcoded && hardcodedIndex >= 0
                  ? () =>
                      setDeleteConfirm({
                        index: hardcodedIndex,
                        name: item.name,
                      })
                  : undefined
              }
              onHide={
                item.source === "db" && canHideDb
                  ? () => handleHideDbRow(item)
                  : undefined
              }
            />
          );
        })}
      </div>

      {ignoredItemsResolved.length > 0 && (
        <div className="mt-3 space-y-1">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider px-0.5">
            {isSpanish ? "Ocultos en esta sección" : "Hidden on this section"} (
            {ignoredItemsResolved.length})
          </p>
          {ignoredItemsResolved.map(({ key, name }) => (
            <div
              key={key}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed bg-muted/20"
            >
              <p className="text-xs text-muted-foreground line-clamp-1 flex-1 italic">
                {name}
              </p>
              {onIgnoredEntriesChange && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 text-[10px] px-2 flex-shrink-0"
                  onClick={() =>
                    onIgnoredEntriesChange(ignoredEntries.filter((k) => k !== key))
                  }
                  data-testid={`button-restore-testimonial-${key}`}
                  title={isSpanish ? "Mostrar de nuevo" : "Restore"}
                >
                  <IconArrowBackUp className="h-3 w-3 mr-1" />
                  Restore
                </Button>
              )}
            </div>
          ))}
        </div>
      )}

      {deleteConfirm && (
        <Dialog
          open
          onOpenChange={(v) => {
            if (!v) setDeleteConfirm(null);
          }}
        >
          <DialogContent className="max-w-sm z-[10002]">
            <DialogHeader>
              <DialogTitle>
                {isSpanish
                  ? "¿Quitar testimonio local?"
                  : "Remove local testimonial?"}
              </DialogTitle>
              <DialogDescription>
                {isSpanish
                  ? "Se elimina de esta sección. El banco centralizado no se afecta."
                  : "This removes it from this section's content. The centralized bank is not affected."}
              </DialogDescription>
            </DialogHeader>
            <p className="text-xs text-muted-foreground border rounded-md p-2 line-clamp-3">
              {deleteConfirm.name}
            </p>
            <DialogFooter>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeleteConfirm(null)}
              >
                Cancel
              </Button>
              <Button
                variant="destructive"
                size="sm"
                onClick={confirmDelete}
                data-testid="button-confirm-delete-hardcoded-testimonial"
              >
                Remove
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

interface TestimonialItemRowProps {
  item: DisplayItem;
  locale: string;
  onDelete?: () => void;
  onHide?: () => void;
}

function TestimonialItemRow({ item, onDelete, onHide, locale }: TestimonialItemRowProps) {
  const [isOpen, setIsOpen] = useState(false);
  const isHardcoded = item.source === "hardcoded";
  const isSpanish = locale === "es";

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className={`border rounded-lg ${isHardcoded ? "bg-secondary" : "bg-muted/50"}`}
      >
        <div className="flex items-center gap-1 pr-1">
          <CollapsibleTrigger className="flex-1 min-w-0" asChild>
            <button
              type="button"
              className="flex items-center gap-2 w-full p-2 rounded-md hover:bg-muted/80 transition-colors text-left"
              data-testid={`testimonial-item-${item.key}`}
            >
              <Avatar className="w-7 h-7 flex-shrink-0">
                {item.avatar && (
                  <AvatarImage src={item.avatar} alt={item.name} />
                )}
                <AvatarFallback className="bg-foreground/10 text-foreground/70 text-[10px] font-semibold">
                  {getInitials(item.name || "?")}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium text-foreground truncate">
                  {item.name}
                  <Badge
                    variant="outline"
                    className="text-[9px] px-1 py-0 ml-1.5 text-muted-foreground align-middle no-default-hover-elevate no-default-active-elevate"
                  >
                    {isHardcoded ? "manually added" : "DB"}
                  </Badge>
                  {item.featured && (
                    <Badge
                      variant="outline"
                      className="text-[9px] px-1 py-0 ml-1 text-muted-foreground align-middle no-default-hover-elevate no-default-active-elevate"
                    >
                      featured
                    </Badge>
                  )}
                </p>
                <p className="text-[10px] text-muted-foreground truncate">
                  {item.role || ""}
                  {item.company ? ` - ${item.company}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {item.rating != null && item.rating > 0 && (
                  <div className="flex items-center gap-0.5">
                    <Star className="fill-current w-3 h-3 text-yellow-500" />
                    <span className="text-[10px] text-muted-foreground">
                      {item.rating}
                    </span>
                  </div>
                )}
                <ChevronDown
                  className={`w-3.5 h-3.5 text-muted-foreground transition-transform ${isOpen ? "rotate-180" : ""}`}
                />
              </div>
            </button>
          </CollapsibleTrigger>
          {onHide && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                onHide();
              }}
              data-testid={`button-testimonial-item-hide-${item.key}`}
              title={isSpanish ? "Ocultar en esta sección" : "Hide on this section"}
            >
              <IconEyeOff className="h-3.5 w-3.5" />
            </Button>
          )}
          {onDelete && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="h-8 w-8 shrink-0"
              onClick={(e) => {
                e.stopPropagation();
                onDelete();
              }}
              data-testid={`button-testimonial-item-delete-${item.key}`}
              title="Delete"
            >
              <IconTrash className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <CollapsibleContent>
          <div className="pl-11 pr-2 pb-2 space-y-3">
            {item.text && (
              <p className="text-[11px] text-muted-foreground line-clamp-3 italic">
                &ldquo;{item.text}&rdquo;
              </p>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
