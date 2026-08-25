import { useState, useEffect } from "react";
import { ArrowRight, Calendar, ChevronLeft, ChevronRight, Search, User } from "lucide-react";
import { useLocation, useSearch } from "wouter";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useInternalNav } from "@/hooks/useInternalNav";
import { deslugifyLabel } from "@shared/relation-field";

interface PermanentFilter {
  item_property_slug: string;
  value: unknown;
}

interface UserFilter {
  item_property_slug: string;
  component_renderer: "text-input" | "dropdown" | "tags";
  default_value?: unknown;
  all_label?: string;
}

interface ListingItem {
  image?: string;
  title?: string;
  description?: string;
  /** @deprecated Prefer `taxonomy` for category/tag chips on listing cards */
  badge?: string;
  /** Taxonomy term (category, tag, technology, etc.) shown as the card chip and used by filters */
  taxonomy?: string;
  url?: string;
  meta_left?: string;
  meta_right?: string;
  cta_text?: string;
  [key: string]: unknown;
}

interface ListingCardsData {
  type: string;
  title?: string;
  sub_heading?: string;
  items?: ListingItem[];
  layout?: {
    columns?: number;
  };
  search?: {
    enabled?: boolean;
    placeholder?: string;
  };
  pagination?: {
    page_size?: number;
    page_label?: string;
    of_label?: string;
    items_label?: string;
    empty_text?: string;
  };
  dynamic_entries?: {
    content_type?: string;
    database?: string;
    limit?: number;
    sort?: string;
    item_template?: Record<string, unknown>;
    hardcoded_entries?: unknown[];
    permanent_filters?: PermanentFilter[];
    user_filters?: UserFilter[];
  };
  columns?: number;
  show_search?: boolean;
  page_size?: number;
  search_placeholder?: string;
  empty_text?: string;
  page_label?: string;
  of_label?: string;
  page_info_template?: string;
  items_label?: string;
  _dynamic_meta?: {
    content_type?: string;
    total?: number;
    locale?: string;
  };
}

function formatCategoryLabel(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function formatDate(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function formatAuthor(value: unknown): string {
  if (!value) return "";
  if (Array.isArray(value)) {
    return value
      .map((v) => {
        if (typeof v === "string") return deslugifyLabel(v);
        if (v && typeof v === "object") {
          const o = v as Record<string, unknown>;
          const name =
            (typeof o.name === "string" && o.name) ||
            `${o.first_name || ""} ${o.last_name || ""}`.trim() ||
            (typeof o.slug === "string" ? deslugifyLabel(o.slug) : "");
          return name;
        }
        return "";
      })
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "string") return deslugifyLabel(value);
  if (typeof value === "object" && value !== null) {
    const author = value as Record<string, unknown>;
    const name = `${author.first_name || ""} ${author.last_name || ""}`.trim();
    return name || String(author.name || "");
  }
  return String(value);
}

function getFieldStringValue(item: Record<string, unknown>, slug: string): string {
  const raw = item[slug];
  if (raw === undefined || raw === null) return "";
  if (typeof raw === "object" && "slug" in (raw as Record<string, unknown>)) {
    return String((raw as Record<string, unknown>).slug);
  }
  return String(raw);
}

export default function ListingCards({ data }: { data: ListingCardsData }) {
  const [location, setLocation] = useLocation();
  const searchString = useSearch();
  const handleLinkClick = useInternalNav();

  const items = data.items || [];
  const columns = data.layout?.columns ?? data.columns ?? 3;
  const perPage = data.pagination?.page_size ?? data.page_size ?? 0;
  const showSearch = data.search?.enabled ?? data.show_search ?? false;
  const searchPlaceholder = data.search?.placeholder ?? data.search_placeholder ?? "Search...";
  const emptyText = data.pagination?.empty_text ?? data.empty_text ?? "No items found.";
  const pageLabel = data.pagination?.page_label ?? data.page_label ?? "Page";
  const ofLabel = data.pagination?.of_label ?? data.of_label ?? "of";
  const itemsLabel = data.pagination?.items_label ?? data.items_label ?? "items";

  const userFilters = data.dynamic_entries?.user_filters || [];
  const userFilterSlugs = userFilters.map((uf) => uf.item_property_slug);

  const params = new URLSearchParams(searchString);
  const currentPage = Math.max(1, parseInt(params.get("page") || "1", 10));
  const [searchQuery, setSearchQuery] = useState("");

  // URL is source of truth for filters (shareable / back-forward). Falls back to YAML default_value.
  const userFilterValues = (() => {
    const values: Record<string, string> = {};
    for (const uf of userFilters) {
      const fromUrl = params.get(uf.item_property_slug);
      if (fromUrl != null && fromUrl !== "") {
        values[uf.item_property_slug] = fromUrl;
      } else {
        values[uf.item_property_slug] =
          uf.default_value != null ? String(uf.default_value) : "";
      }
    }
    return values;
  })();

  const userFilterOptions = (() => {
    const opts: Record<string, string[]> = {};
    for (const uf of userFilters) {
      if (uf.component_renderer === "dropdown" || uf.component_renderer === "tags") {
        const values = new Set<string>();
        for (const item of items) {
          const v = getFieldStringValue(item as Record<string, unknown>, uf.item_property_slug);
          if (v) values.add(v);
        }
        opts[uf.item_property_slug] = Array.from(values).sort();
      }
    }
    return opts;
  })();

  const userFiltered = (() => {
    if (!userFilters.length) return items;
    return items.filter(item =>
      userFilters.every(f => {
        const val = userFilterValues[f.item_property_slug];
        if (!val) return true;
        const itemVal = getFieldStringValue(item as Record<string, unknown>, f.item_property_slug);
        if (f.component_renderer === "text-input") {
          return itemVal.toLowerCase().includes(val.toLowerCase());
        }
        return itemVal === val;
      })
    );
  })();

  const filteredBySearch = (() => {
    if (!searchQuery.trim()) return userFiltered;
    const query = searchQuery.toLowerCase();
    return userFiltered.filter(item =>
      (item.title || "").toLowerCase().includes(query) ||
      (item.description || "").toLowerCase().includes(query) ||
      (typeof item.taxonomy === "string" ? item.taxonomy : "").toLowerCase().includes(query) ||
      (typeof item.badge === "string" ? item.badge : "").toLowerCase().includes(query)
    );
  })();

  const totalItems = filteredBySearch.length;
  const totalPages = perPage > 0 ? Math.ceil(totalItems / perPage) : 1;
  const paginatedItems = perPage > 0
    ? filteredBySearch.slice((currentPage - 1) * perPage, currentPage * perPage)
    : filteredBySearch;

  const buildPageUrl = (page: number) => {
    const p = new URLSearchParams(searchString);
    for (const slug of userFilterSlugs) {
      const val = userFilterValues[slug];
      if (val) p.set(slug, val);
      else p.delete(slug);
    }
    if (page > 1) p.set("page", String(page));
    else p.delete("page");
    const qs = p.toString();
    return `${location.split("?")[0]}${qs ? `?${qs}` : ""}`;
  };

  const handlePageChange = (page: number) => {
    setLocation(buildPageUrl(page));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  useEffect(() => {
    if (perPage <= 0 || totalPages <= 1) return;

    const canonicalHref = buildPageUrl(currentPage);
    const prevHref = currentPage > 1 ? buildPageUrl(currentPage - 1) : null;
    const nextHref = currentPage < totalPages ? buildPageUrl(currentPage + 1) : null;

    document.querySelectorAll('link[data-listcards-pagination]').forEach(el => el.remove());

    const added: HTMLLinkElement[] = [];

    const canonical = document.createElement("link");
    canonical.rel = "canonical";
    canonical.href = canonicalHref;
    canonical.setAttribute("data-listcards-pagination", "true");
    document.head.appendChild(canonical);
    added.push(canonical);

    if (prevHref) {
      const prev = document.createElement("link");
      prev.rel = "prev";
      prev.href = prevHref;
      prev.setAttribute("data-listcards-pagination", "true");
      document.head.appendChild(prev);
      added.push(prev);
    }

    if (nextHref) {
      const next = document.createElement("link");
      next.rel = "next";
      next.href = nextHref;
      next.setAttribute("data-listcards-pagination", "true");
      document.head.appendChild(next);
      added.push(next);
    }

    return () => {
      added.forEach(el => el.remove());
    };
  }, [perPage, totalPages, currentPage, location, searchString]);

  const setUserFilter = (slug: string, value: string, opts?: { replace?: boolean }) => {
    const p = new URLSearchParams(searchString);
    if (value) p.set(slug, value);
    else p.delete(slug);
    // Changing filters resets pagination
    p.delete("page");
    const qs = p.toString();
    const next = `${location.split("?")[0]}${qs ? `?${qs}` : ""}`;
    setLocation(next, opts?.replace ? { replace: true } : undefined);
  };

  const pageNumbers = (() => {
    const pages: (number | "...")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push("...");
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (currentPage < totalPages - 2) pages.push("...");
      pages.push(totalPages);
    }
    return pages;
  })();

  const gridCols =
    columns === 1 ? "grid-cols-1"
    : columns === 2 ? "grid-cols-1 md:grid-cols-2"
    : columns === 4 ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-4"
    : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3";

  const getBadgeText = (value: unknown): string => {
    if (typeof value === "string") return value;
    if (value && typeof value === "object" && "slug" in (value as Record<string, unknown>)) {
      return String((value as Record<string, unknown>).slug);
    }
    return "";
  };

  const getTaxonomyText = (item: ListingItem): string =>
    getBadgeText(item.taxonomy) || getBadgeText(item.badge);

  const hasHeader = data.title || showSearch || userFilters.length > 0;

  return (
    <div data-testid="section-list-cards">
      {hasHeader && (
        <div className="mb-10">
          {data.title && (
            <h2 className="text-4xl font-bold text-foreground mb-3" data-testid="text-listing-title">
              {data.title}
            </h2>
          )}

          {(data.sub_heading || showSearch || userFilters.some(f => f.component_renderer === "text-input") || userFilters.some(f => f.component_renderer === "dropdown")) && (
            <div className="flex flex-col md:flex-row md:items-center gap-3 mb-4 flex-wrap">
              {data.sub_heading && (
                <p className="text-lg text-muted-foreground flex-1" data-testid="text-listing-subtitle">
                  {data.sub_heading}
                </p>
              )}

              {userFilters.filter(f => f.component_renderer === "text-input").map(uf => (
                <div key={uf.item_property_slug} className="relative max-w-md md:w-64 shrink-0">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder={uf.all_label || "Search..."}
                    value={userFilterValues[uf.item_property_slug] || ""}
                    onChange={e => setUserFilter(uf.item_property_slug, e.target.value, { replace: true })}
                    className="pl-10"
                    data-testid={`input-filter-${uf.item_property_slug}`}
                  />
                </div>
              ))}

              {showSearch && (
                <div className="relative max-w-md md:w-72 shrink-0">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder={searchPlaceholder}
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                    data-testid="input-listing-search"
                  />
                </div>
              )}

              {userFilters.filter(f => f.component_renderer === "dropdown").map(uf => (
                <Select
                  key={uf.item_property_slug}
                  value={userFilterValues[uf.item_property_slug] || ""}
                  onValueChange={v => setUserFilter(uf.item_property_slug, v === "__all__" ? "" : v)}
                >
                  <SelectTrigger className="w-48 shrink-0" data-testid={`select-filter-${uf.item_property_slug}`}>
                    <SelectValue placeholder={uf.all_label || "All"} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__all__">{uf.all_label || "All"}</SelectItem>
                    {(userFilterOptions[uf.item_property_slug] || []).map(v => (
                      <SelectItem key={v} value={v}>
                        {formatCategoryLabel(v)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ))}
            </div>
          )}

          {userFilters.filter(f => f.component_renderer === "tags").map(uf => (
            <div key={uf.item_property_slug} className="flex items-center gap-2 flex-wrap mb-4" data-testid={`section-tag-filter-${uf.item_property_slug}`}>
              <Badge
                variant={!userFilterValues[uf.item_property_slug] ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => setUserFilter(uf.item_property_slug, "")}
                data-testid={`chip-filter-all-${uf.item_property_slug}`}
              >
                {uf.all_label || "All"}
              </Badge>
              {(userFilterOptions[uf.item_property_slug] || []).map(v => (
                <Badge
                  key={v}
                  variant={userFilterValues[uf.item_property_slug] === v ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => setUserFilter(uf.item_property_slug, userFilterValues[uf.item_property_slug] === v ? "" : v)}
                  data-testid={`chip-filter-${uf.item_property_slug}-${v}`}
                >
                  {formatCategoryLabel(v)}
                </Badge>
              ))}
            </div>
          ))}

        </div>
      )}

      {paginatedItems.length === 0 ? (
        <div className="text-center py-16" data-testid="text-listing-empty">
          <p className="text-muted-foreground text-lg">
            {emptyText}
          </p>
        </div>
      ) : (
        <>
          <div className={`grid ${gridCols} gap-6`} data-testid="grid-listing-cards">
            {paginatedItems.map((item, index) => {
              const badgeText = getTaxonomyText(item);
              const metaLeft = formatAuthor(item.meta_left);
              const metaRight = item.meta_right ? formatDate(String(item.meta_right)) : "";
              const content = (
                <Card className="h-full overflow-visible hover-elevate transition-all">
                  {item.image && (
                    <div className="aspect-video w-full overflow-hidden rounded-t-md">
                      <img
                        src={String(item.image)}
                        alt={String(item.title || "")}
                        className="w-full h-full object-cover"
                        loading="lazy"
                        data-testid={`img-listing-card-${index}`}
                      />
                    </div>
                  )}
                  <div className="p-5">
                    {badgeText && (
                      <Badge variant="secondary" className="mb-3" data-testid={`badge-listing-${index}`}>
                        {formatCategoryLabel(badgeText)}
                      </Badge>
                    )}
                    {item.title && (
                      <h3
                        className="text-lg font-bold text-foreground mb-2 line-clamp-2 group-hover:text-primary transition-colors"
                        data-testid={`text-listing-title-${index}`}
                      >
                        {String(item.title)}
                      </h3>
                    )}
                    {item.description && (
                      <p
                        className="text-sm text-muted-foreground mb-4 line-clamp-3"
                        data-testid={`text-listing-desc-${index}`}
                      >
                        {String(item.description)}
                      </p>
                    )}
                    {(metaLeft || metaRight) && (
                      <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                        {metaLeft && (
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {metaLeft}
                          </span>
                        )}
                        {metaRight && (
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {metaRight}
                          </span>
                        )}
                      </div>
                    )}
                    {item.cta_text && (
                      <div className="mt-4 flex items-center gap-1 text-sm text-primary font-medium">
                        {String(item.cta_text)}
                        <ArrowRight className="w-4 h-4" />
                      </div>
                    )}
                  </div>
                </Card>
              );

              if (item.url) {
                return (
                  <a
                    key={index}
                    href={String(item.url)}
                    onClick={handleLinkClick}
                    className="block group"
                    data-testid={`link-listing-card-${index}`}
                  >
                    {content}
                  </a>
                );
              }

              return (
                <div key={index} data-testid={`card-listing-${index}`}>
                  {content}
                </div>
              );
            })}
          </div>

          {perPage > 0 && totalPages > 1 && (
            <>
              <nav className="flex items-center justify-center gap-1 mt-10" aria-label="Pagination" data-testid="nav-pagination">
                <a
                  href={currentPage > 1 ? buildPageUrl(currentPage - 1) : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    if (currentPage > 1) handlePageChange(currentPage - 1);
                  }}
                  aria-disabled={currentPage <= 1}
                >
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={currentPage <= 1}
                    data-testid="button-page-prev"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                </a>
                {pageNumbers.map((p, i) =>
                  p === "..." ? (
                    <span key={`ellipsis-${i}`} className="px-2 text-muted-foreground select-none">
                      ...
                    </span>
                  ) : (
                    <a
                      key={p}
                      href={buildPageUrl(p as number)}
                      onClick={(e) => {
                        e.preventDefault();
                        handlePageChange(p as number);
                      }}
                    >
                      <Button
                        variant={p === currentPage ? "default" : "outline"}
                        size="icon"
                        data-testid={`button-page-${p}`}
                      >
                        {p}
                      </Button>
                    </a>
                  )
                )}
                <a
                  href={currentPage < totalPages ? buildPageUrl(currentPage + 1) : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    if (currentPage < totalPages) handlePageChange(currentPage + 1);
                  }}
                  aria-disabled={currentPage >= totalPages}
                >
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={currentPage >= totalPages}
                    data-testid="button-page-next"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </a>
              </nav>
              <div className="text-center mt-4 text-sm text-muted-foreground" data-testid="text-page-info">
                {data.page_info_template
                  ? data.page_info_template
                      .replace("{page}", String(currentPage))
                      .replace("{totalPages}", String(totalPages))
                      .replace("{total}", String(totalItems))
                  : <>{pageLabel} {currentPage} {ofLabel} {totalPages} · {totalItems} {itemsLabel}</>}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
