import { useState } from "react";
import { Check, ChevronDown, ChevronUp, EyeOff, MapPin, Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useLocationCatalog } from "@/hooks/useLocationCatalog";
import { filterFaqsByRelatedFeatures, faqItemKey, type FaqItem } from "@/lib/faqConstants";
import { getDebugToken } from "@/hooks/useDebugAuth";
import type { Location } from "@shared/session";

interface FaqItemsVisibilityProps {
  relatedFeatures: string[];
  locale: string;
  inlineItems?: Array<{ question: string; answer: string }>;
  itemOverrides: Record<string, { hideOnLocations?: string[] }>;
  onChange: (overrides: Record<string, { hideOnLocations?: string[] }>) => void;
}

function ItemLocationPicker({
  itemKey,
  question,
  hideOnLocations,
  onChange,
}: {
  itemKey: string;
  question: string;
  hideOnLocations: string[];
  onChange: (itemKey: string, locations: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data: allLocations = [] } = useLocationCatalog();

  const hasOverrides = hideOnLocations.length > 0;

  const grouped = (() => {
    const groups: Record<string, Location[]> = {};
    const searchLower = search.toLowerCase();
    for (const loc of allLocations) {
      if (loc.visibility !== "listed") continue;
      if (
        searchLower &&
        !loc.name.toLowerCase().includes(searchLower) &&
        !loc.country.toLowerCase().includes(searchLower) &&
        !loc.slug.toLowerCase().includes(searchLower)
      )
        continue;
      const region = loc.region;
      if (!groups[region]) groups[region] = [];
      groups[region].push(loc);
    }
    return groups;
  })();

  const regionLabels: Record<string, string> = {
    "usa-canada": "USA & Canada",
    latam: "Latin America",
    europe: "Europe",
    online: "Online",
  };

  const toggleLocation = (slug: string) => {
    if (hideOnLocations.includes(slug)) {
      onChange(
        itemKey,
        hideOnLocations.filter((s) => s !== slug),
      );
    } else {
      onChange(itemKey, [...hideOnLocations, slug]);
    }
  };

  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs text-foreground leading-tight line-clamp-2 flex-1">
          {question}
        </p>
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              className={hasOverrides ? "border-amber-400 dark:border-amber-600" : ""}
              data-testid={`button-faq-item-locations-${itemKey}`}
            >
              <MapPin className="h-3.5 w-3.5 mr-1" />
              {hasOverrides ? (
                <span className="text-xs">{hideOnLocations.length} hidden</span>
              ) : (
                <span className="text-xs">All visible</span>
              )}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-72 p-0 z-[10000]" align="end">
            <div className="p-2 border-b">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search locations..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  data-testid={`input-search-faq-locations-${itemKey}`}
                />
              </div>
            </div>
            <div className="max-h-64 overflow-y-auto p-1">
              {Object.entries(grouped).map(([region, locs]) => (
                <div key={region} className="mb-1">
                  <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {regionLabels[region] || region}
                  </div>
                  {locs.map((loc) => {
                    const isHidden = hideOnLocations.includes(loc.slug);
                    return (
                      <button
                        key={loc.slug}
                        onClick={() => toggleLocation(loc.slug)}
                        className="flex items-center gap-2 w-full px-2 py-1.5 text-left text-sm rounded-md hover-elevate"
                        data-testid={`button-toggle-faq-loc-${itemKey}-${loc.slug}`}
                      >
                        <div
                          className={`w-4 h-4 rounded-sm border flex items-center justify-center flex-shrink-0 ${
                            isHidden
                              ? "bg-destructive/20 border-destructive text-destructive"
                              : "border-muted-foreground/30"
                          }`}
                        >
                          {isHidden && <EyeOff className="h-3 w-3" />}
                        </div>
                        <span className={isHidden ? "text-muted-foreground line-through" : ""}>
                          {loc.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground ml-auto">
                          {loc.country}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ))}
            </div>
            {hasOverrides && (
              <div className="p-2 border-t">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full text-xs"
                  onClick={() => {
                    onChange(itemKey, []);
                    setOpen(false);
                  }}
                  data-testid={`button-clear-faq-locations-${itemKey}`}
                >
                  <Check className="h-3.5 w-3.5 mr-1" />
                  Show on all locations
                </Button>
              </div>
            )}
          </PopoverContent>
        </Popover>
      </div>
      {hasOverrides && (
        <div className="flex flex-wrap gap-1">
          {hideOnLocations.map((slug) => {
            const loc = allLocations.find((l) => l.slug === slug);
            return (
              <Badge
                key={slug}
                variant="outline"
                className="text-[10px] cursor-pointer border-destructive/50 text-destructive"
                onClick={() => toggleLocation(slug)}
                data-testid={`badge-hidden-loc-${itemKey}-${slug}`}
              >
                <EyeOff className="h-2.5 w-2.5 mr-0.5" />
                {loc?.name || slug}
              </Badge>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function FaqItemsVisibility({
  relatedFeatures,
  locale,
  inlineItems,
  itemOverrides,
  onChange,
}: FaqItemsVisibilityProps) {
  const [expanded, setExpanded] = useState(false);

  const hasCentralized = relatedFeatures.length > 0;
  const hasInline = inlineItems && inlineItems.length > 0;

  const { data: faqsData, isLoading } = useQuery<{ faqs: FaqItem[] }>({
    queryKey: ["/api/databases/frequently_asked_questions/items", locale],
    queryFn: async () => {
      const token = getDebugToken();
      const res = await fetch(
        `/api/databases/frequently_asked_questions/items?limit=1000&locale=${encodeURIComponent(locale)}`,
        {
          headers: token ? { "X-Debug-Token": token } : {},
        },
      );
      if (!res.ok) throw new Error("Failed to load FAQs");
      const data = await res.json();
      const items = Array.isArray(data?.items)
        ? data.items
        : Array.isArray(data)
          ? data
          : [];
      return { faqs: items as FaqItem[] };
    },
    enabled: hasCentralized,
    staleTime: 5 * 60 * 1000,
  });

  const displayedItems = (() => {
    if (hasCentralized && faqsData?.faqs) {
      return filterFaqsByRelatedFeatures(faqsData.faqs, {
        relatedFeatures,
        limit: 9,
      });
    }
    if (hasInline) {
      return inlineItems!;
    }
    return [];
  })();

  const handleItemLocationsChange = (itemKey: string, locations: string[]) => {
    const newOverrides = { ...itemOverrides };
    if (locations.length === 0) {
      delete newOverrides[itemKey];
    } else {
      newOverrides[itemKey] = { hideOnLocations: locations };
    }
    onChange(newOverrides);
  };

  const overrideCount = Object.keys(itemOverrides).filter(
    (k) => (itemOverrides[k]?.hideOnLocations?.length ?? 0) > 0,
  ).length;

  if (!hasCentralized && !hasInline) return null;

  return (
    <div className="space-y-2">
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full group"
        data-testid="button-toggle-faq-items-visibility"
      >
        <Label className="text-sm font-medium flex items-center gap-1.5 cursor-pointer">
          <EyeOff className="h-3.5 w-3.5" />
          FAQ visibility by location
          {overrideCount > 0 && (
            <Badge variant="secondary" className="text-[10px] ml-1">
              {overrideCount} with overrides
            </Badge>
          )}
        </Label>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {expanded && (
        <div className="space-y-2 mt-2">
          {isLoading && (
            <div className="animate-pulse space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 bg-muted rounded" />
              ))}
            </div>
          )}
          {!isLoading && displayedItems.length === 0 && (
            <p className="text-xs text-muted-foreground py-2">
              No FAQ items found for the selected topics.
            </p>
          )}
          {!isLoading &&
            displayedItems.map((item) => {
              const key = faqItemKey(item.question);
              const override = itemOverrides[key];
              return (
                <ItemLocationPicker
                  key={key}
                  itemKey={key}
                  question={item.question}
                  hideOnLocations={override?.hideOnLocations || []}
                  onChange={handleItemLocationsChange}
                />
              );
            })}
        </div>
      )}
    </div>
  );
}

