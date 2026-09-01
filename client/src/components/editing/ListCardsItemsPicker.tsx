import React, { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { deslugifyLabel } from "@shared/relation-field";
import { LISTING_SEARCH_MIN_CHARS } from "@shared/listing-search-config";
import {
  buildListingSearchUrl,
  type ListingSearchApiResponse,
} from "@/lib/listing-search";

export type ListCardsPreviewItem = {
  title?: string;
  description?: string;
  taxonomy?: unknown;
  badge?: unknown;
  url?: string;
  _source?: "hardcoded" | "db";
};

export interface ListCardsItemsPickerProps {
  contentType?: string;
  database?: string | null;
  locale: string;
  permanentFilters: Array<{ item_property_slug: string; value: unknown }>;
  itemTemplate?: Record<string, unknown>;
  sort?: string;
  searchFields?: string[];
  /** Section ranking phrase (dynamic_entries.search), not visitor ?q=. */
  sectionSearchPhrase?: string;
  limit?: number;
  hardcodedItems?: ListCardsPreviewItem[];
  resolvedItems?: ListCardsPreviewItem[];
  semanticSearchEnabled?: boolean;
}

function chipLabel(value: unknown): string {
  if (typeof value === "string") return deslugifyLabel(value);
  if (value && typeof value === "object" && "slug" in (value as Record<string, unknown>)) {
    return deslugifyLabel(String((value as Record<string, unknown>).slug));
  }
  return "";
}

export function ListCardsItemsPicker({
  contentType,
  database,
  locale,
  permanentFilters,
  itemTemplate,
  sort,
  searchFields,
  sectionSearchPhrase = "",
  limit,
  hardcodedItems = [],
  resolvedItems = [],
  semanticSearchEnabled,
}: ListCardsItemsPickerProps) {
  const rankingPhrase = sectionSearchPhrase.trim();
  const useRankingSearch = rankingPhrase.length >= LISTING_SEARCH_MIN_CHARS && Boolean(database);

  const searchConfig = useMemo(
    () => ({
      permanent_filters: permanentFilters,
      item_template: itemTemplate,
      sort,
      fields: searchFields,
    }),
    [permanentFilters, itemTemplate, sort, searchFields],
  );

  const previewUrl = useMemo(() => {
    if (!database && !contentType) return null;
    return buildListingSearchUrl({
      database,
      contentType,
      locale,
      q: useRankingSearch ? rankingPhrase : undefined,
      limit: limit && limit > 0 ? limit : 100,
      searchConfig,
    });
  }, [
    database,
    contentType,
    locale,
    useRankingSearch,
    rankingPhrase,
    limit,
    searchConfig,
  ]);

  const { data, isLoading, isFetching } = useQuery<ListingSearchApiResponse>({
    queryKey: [previewUrl],
    queryFn: async () => {
      const res = await fetch(previewUrl!, { credentials: "include" });
      if (!res.ok) throw new Error("Preview load failed");
      return res.json() as Promise<ListingSearchApiResponse>;
    },
    enabled: Boolean(previewUrl) && Boolean(database),
    staleTime: 30_000,
  });

  const displayed = useMemo(() => {
    const hardcoded = hardcodedItems.map((item) => ({ ...item, _source: "hardcoded" as const }));
    if (!database) {
      return resolvedItems.map((item, i) => ({
        ...item,
        _source: i < hardcoded.length ? ("hardcoded" as const) : ("db" as const),
      }));
    }
    const dbItems = (data?.items ?? []).map((item) => ({
      ...(item as ListCardsPreviewItem),
      _source: "db" as const,
    }));
    const merged = [...hardcoded, ...dbItems];
    if (limit && limit > 0) return merged.slice(0, limit);
    return merged;
  }, [hardcodedItems, resolvedItems, database, data?.items, limit]);

  const loading = Boolean(database) && (isLoading || isFetching) && !data;

  if (!database && !contentType) {
    return (
      <p className="text-xs text-muted-foreground" data-testid="list-cards-picker-no-source">
        Connect <span className="font-mono text-foreground">dynamic_entries</span> to preview
        database-backed cards here.
      </p>
    );
  }

  return (
    <div className="space-y-2" data-testid="list-cards-items-picker">
      {!database && (
        <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="list-cards-picker-no-db">
          No linked database — preview shows SSR-resolved items only.
        </p>
      )}
      {database && semanticSearchEnabled === false && (
        <p className="text-xs text-muted-foreground">
          Semantic search is not enabled on this database — ranking uses keyword matching when search is set.
        </p>
      )}
      {useRankingSearch && data?.semantic === false && data.fallback_message && (
        <p className="text-xs text-amber-700 dark:text-amber-400" data-testid="list-cards-search-fallback">
          {data.fallback_message}
        </p>
      )}
      {loading ? (
        <div className="space-y-2" data-testid="list-cards-picker-loading">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : displayed.length === 0 ? (
        <p className="text-xs text-muted-foreground py-4 text-center">No items match this listing.</p>
      ) : (
        <ScrollArea className="h-48 rounded-md border border-input">
          <ul className="divide-y divide-border">
            {displayed.map((item, index) => {
              const taxonomy = chipLabel(item.taxonomy ?? item.badge);
              return (
                <li
                  key={`${item.title}-${index}`}
                  className="px-3 py-2 text-xs space-y-1"
                  data-testid={`list-cards-picker-row-${index}`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-medium text-foreground line-clamp-1">
                      {item.title ? String(item.title) : "(Untitled)"}
                    </span>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {item._source === "hardcoded" ? "Manual" : "DB"}
                    </Badge>
                  </div>
                  {taxonomy ? (
                    <p className="text-muted-foreground">{taxonomy}</p>
                  ) : null}
                  {item.url ? (
                    <p className="text-muted-foreground font-mono truncate">{String(item.url)}</p>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </ScrollArea>
      )}
    </div>
  );
}
