/**
 * Store Products — pick a CMS entry and make it sellable (or restore a removed product).
 */

import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Pencil, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ToastAction } from "@/components/ui/toast";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiRequest } from "@/lib/queryClient";
import {
  dedupeByContentEntry,
  sitemapContentEntryKey,
  sitemapMatchScore,
  sitemapPathname,
  type SitemapSearchEntry,
} from "@/lib/sitemapSearch";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import { suggestShortKey } from "@shared/tracking-keys";
import { TrackingKeyField, trackingKeyError } from "./TrackingKeyField";

type ContentTypeListItem = {
  name: string;
  label?: string;
};

type TypeConfigResponse = {
  name?: string;
  label?: string;
  products?: { allow_sellable_entries?: boolean } | null;
};

type ProductListRow = {
  product_id: string;
  name: string;
  content_type: string;
  content_slug: string;
  purchasable: boolean;
  short_key?: string;
};

type ProductListResponse = {
  products: ProductListRow[];
};

function entryKey(contentType: string, slug: string): string {
  return `${contentType}/${slug}`;
}

export function AddProductModal({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { hasCapability } = useDebugAuth();
  const canManageTypes = hasCapability("content_types_manage");

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<SitemapSearchEntry | null>(null);
  const [mode, setMode] = useState<"pick" | "enable-type">("pick");
  const [enableTypeName, setEnableTypeName] = useState<string>("");
  const [shortKey, setShortKey] = useState("");

  const resetLocal = () => {
    setQuery("");
    setSelected(null);
    setMode("pick");
    setEnableTypeName("");
    setShortKey("");
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) resetLocal();
    onOpenChange(next);
  };

  const { data: contentTypes = [], isLoading: typesLoading } = useQuery({
    queryKey: ["/api/content-types"],
    queryFn: async () => {
      const res = await fetch("/api/content-types", {
        credentials: "include",
        headers: { ...getSessionHeaders() },
      });
      if (!res.ok) throw new Error("Failed to load content types");
      return (await res.json()) as ContentTypeListItem[];
    },
    enabled: open,
    staleTime: 60_000,
  });

  const typeConfigQueries = useQueries({
    queries: contentTypes.map((ct) => ({
      queryKey: ["/api/content-types", ct.name, "config"] as const,
      queryFn: async () => {
        const res = await apiRequest("GET", `/api/content-types/${ct.name}/config`);
        return (await res.json()) as TypeConfigResponse;
      },
      enabled: open && contentTypes.length > 0,
      staleTime: 60_000,
    })),
  });

  const typeConfigsLoading = typeConfigQueries.some((q) => q.isLoading);
  const typeConfigs = useMemo(() => {
    const map = new Map<string, TypeConfigResponse>();
    for (let i = 0; i < contentTypes.length; i++) {
      const data = typeConfigQueries[i]?.data;
      if (data) map.set(contentTypes[i].name, data);
    }
    return map;
  }, [contentTypes, typeConfigQueries]);

  const sellableTypeNames = useMemo(() => {
    const names: string[] = [];
    for (const [name, cfg] of typeConfigs) {
      if (cfg.products?.allow_sellable_entries === true) names.push(name);
    }
    return names;
  }, [typeConfigs]);

  const nonSellableTypes = useMemo(() => {
    return contentTypes.filter((ct) => {
      const cfg = typeConfigs.get(ct.name);
      if (!cfg) return false;
      return cfg.products?.allow_sellable_entries !== true;
    });
  }, [contentTypes, typeConfigs]);

  const { data: indexedProducts = [], isLoading: indexedLoading } = useQuery({
    queryKey: ["/api/product", { include_paused: true }],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/product?include_paused=true");
      const json = (await res.json()) as ProductListResponse;
      return json.products ?? [];
    },
    enabled: open,
  });

  const { data: removedProducts = [], isLoading: removedLoading } = useQuery({
    queryKey: ["/api/product", { include_removed: true }],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/product?include_removed=true&include_paused=true");
      const json = (await res.json()) as ProductListResponse;
      return (json.products ?? []).filter((p) => p.purchasable === false);
    },
    enabled: open,
  });

  const { data: sitemapUrls = [], isLoading: sitemapLoading } = useQuery({
    queryKey: ["/api/sitemap-urls"],
    queryFn: async () => {
      const res = await fetch("/api/sitemap-urls", {
        credentials: "include",
        headers: { ...getSessionHeaders() },
      });
      if (!res.ok) throw new Error("Failed to load sitemap");
      return (await res.json()) as SitemapSearchEntry[];
    },
    enabled: open,
    staleTime: 60_000,
  });

  const indexedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const p of indexedProducts) {
      if (p.purchasable !== false) set.add(entryKey(p.content_type, p.content_slug));
    }
    return set;
  }, [indexedProducts]);

  const removedKeys = useMemo(() => {
    const set = new Set<string>();
    for (const p of removedProducts) {
      set.add(entryKey(p.content_type, p.content_slug));
    }
    return set;
  }, [removedProducts]);

  const sellableTypeSet = useMemo(() => new Set(sellableTypeNames), [sellableTypeNames]);

  const pickerEntries = useMemo(() => {
    if (sellableTypeNames.length === 0) return [];
    const filtered = sitemapUrls.filter((e) => {
      const key = sitemapContentEntryKey(e);
      if (!key) return false;
      if (!e.content_type || !sellableTypeSet.has(e.content_type)) return false;
      if (indexedKeys.has(key)) return false;
      return true;
    });
    const deduped = dedupeByContentEntry(filtered);
    const q = query.trim();
    if (!q) {
      return deduped.sort((a, b) =>
        (a.label || a.slug || "").localeCompare(b.label || b.slug || ""),
      );
    }
    return deduped
      .filter((e) => sitemapMatchScore(e, q) > 0)
      .sort((a, b) => {
        const diff = sitemapMatchScore(b, q) - sitemapMatchScore(a, q);
        if (diff !== 0) return diff;
        return sitemapPathname(a.loc).localeCompare(sitemapPathname(b.loc));
      });
  }, [sitemapUrls, sellableTypeNames, sellableTypeSet, indexedKeys, query]);

  const selectedKey = selected ? sitemapContentEntryKey(selected) : null;
  const isRestore = !!(selectedKey && removedKeys.has(selectedKey));
  const selectedType = selected?.content_type?.trim() ?? "";
  const selectedSlug = selected?.slug?.trim() ?? "";

  const takenProductKeys = useMemo(() => {
    const set = new Set<string>();
    for (const p of [...indexedProducts, ...removedProducts]) {
      if (p.short_key && p.content_slug !== selectedSlug) set.add(p.short_key);
    }
    return set;
  }, [indexedProducts, removedProducts, selectedSlug]);
  const restoredKey = removedProducts.find((p) => p.content_slug === selectedSlug)?.short_key ?? null;
  const keySuggestion = suggestShortKey(selected?.label || selectedSlug, takenProductKeys, selectedSlug);
  const keyError = restoredKey ? null : trackingKeyError(shortKey, takenProductKeys);
  const canManageSelected =
    !!selectedType && hasCapability("product_manage", selectedType);

  const dataLoading =
    typesLoading || typeConfigsLoading || indexedLoading || removedLoading || sitemapLoading;

  const goToProduct = (slug: string) => {
    handleOpenChange(false);
    setLocation(`/private/store/product/${encodeURIComponent(slug)}`);
  };

  const invalidateProductQueries = () => {
    void queryClient.invalidateQueries({ queryKey: ["/api/product"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/ecommerce/products"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/ecommerce/product-map"] });
  };

  const makeSellableMutation = useMutation({
    mutationFn: async (args: { contentType: string; slug: string; shortKey?: string }) => {
      if (indexedKeys.has(entryKey(args.contentType, args.slug))) {
        const err = new Error("already_a_product") as Error & { code?: string };
        err.code = "already_a_product";
        throw err;
      }
      const res = await apiFetch(`/api/product/${encodeURIComponent(args.slug)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content_type: args.contentType,
          purchasable: true,
          ...(args.shortKey ? { short_key: args.shortKey } : {}),
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        code?: string;
        details?: { content_type?: string; content_slug?: string };
        product?: { content_slug?: string };
      };
      if (!res.ok) {
        const err = new Error(body.error || res.statusText) as Error & {
          code?: string;
          details?: { content_type?: string; content_slug?: string };
        };
        err.code = body.code;
        err.details = body.details;
        throw err;
      }
      return body;
    },
    onSuccess: (_data, vars) => {
      invalidateProductQueries();
      toast({
        title: isRestore ? "Product is sellable again" : "Product is sellable",
        description: "Visible in the store index. Add audience when ready.",
      });
      goToProduct(vars.slug);
    },
    onError: (err: Error & { code?: string; details?: { content_slug?: string } }) => {
      if (err.code === "already_a_product" || err.message === "already_a_product") {
        const slug = selectedSlug;
        toast({
          title: "Already a product",
          description: "This page is already in the store.",
          action: slug ? (
            <ToastAction
              altText="Go to product"
              onClick={() => goToProduct(slug)}
              data-testid="toast-go-to-product"
            >
              Go to product
            </ToastAction>
          ) : undefined,
        });
        return;
      }
      if (err.code === "product_id_collision" && err.details?.content_slug) {
        const slug = err.details.content_slug;
        toast({
          title: "Could not make sellable",
          description: err.message,
          variant: "destructive",
          action: (
            <ToastAction
              altText="Go to product"
              onClick={() => goToProduct(slug)}
              data-testid="toast-go-to-product-collision"
            >
              Go to product
            </ToastAction>
          ),
        });
        return;
      }
      toast({
        title: "Could not make sellable",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const enableTypeMutation = useMutation({
    mutationFn: async (typeName: string) => {
      const res = await apiFetch(`/api/content-types/${encodeURIComponent(typeName)}/config`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ products: { allow_sellable_entries: true } }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error || res.statusText);
      return typeName;
    },
    onSuccess: async (typeName) => {
      await queryClient.invalidateQueries({ queryKey: ["/api/content-types", typeName, "config"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/content-types"] });
      toast({
        title: "Sellable products on",
        description: `Entries of type “${typeName}” can become products. Pick a page below.`,
      });
      setMode("pick");
      setEnableTypeName("");
    },
    onError: (err: Error) => {
      toast({
        title: "Could not enable type",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const showNoSellableTypes = !dataLoading && sellableTypeNames.length === 0;
  const showNoEligibleEntries =
    !dataLoading && sellableTypeNames.length > 0 && pickerEntries.length === 0 && !query.trim();
  const showSearchEmpty =
    !dataLoading && sellableTypeNames.length > 0 && pickerEntries.length === 0 && !!query.trim();

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-lg" data-testid="dialog-add-product">
        <DialogHeader>
          <DialogTitle>Add product</DialogTitle>
          <DialogDescription>
            Pick a page from a type that allows sellable products. It will show in the store as
            Selling. Does not change page copy or Funnel — audience can be filled next.
          </DialogDescription>
        </DialogHeader>

        {mode === "enable-type" ? (
          <div className="space-y-3" data-testid="panel-enable-type">
            <p className="text-sm text-muted-foreground">
              Allow pages of this content type to become products. You can pick an entry afterward.
            </p>
            {!canManageTypes ? (
              <p className="text-sm text-amber-600 dark:text-amber-400" data-testid="text-enable-type-denied">
                Needs Manage content types permission to enable sellable products for a type.
              </p>
            ) : nonSellableTypes.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-no-types-to-enable">
                Every content type already allows sellable products.
              </p>
            ) : (
              <Select value={enableTypeName || undefined} onValueChange={setEnableTypeName}>
                <SelectTrigger data-testid="select-enable-content-type">
                  <SelectValue placeholder="Choose a content type" />
                </SelectTrigger>
                <SelectContent>
                  {nonSellableTypes.map((ct) => (
                    <SelectItem key={ct.name} value={ct.name}>
                      {ct.label || ct.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setMode("pick");
                  setEnableTypeName("");
                }}
                data-testid="button-enable-type-back"
              >
                Back
              </Button>
              <Button
                type="button"
                disabled={
                  !canManageTypes ||
                  !enableTypeName ||
                  enableTypeMutation.isPending ||
                  nonSellableTypes.length === 0
                }
                onClick={() => enableTypeMutation.mutate(enableTypeName)}
                data-testid="button-confirm-enable-type"
              >
                {enableTypeMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Enabling…
                  </>
                ) : (
                  "Enable for selling"
                )}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            {dataLoading ? (
              <div className="flex items-center justify-center gap-2 py-10 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span className="text-sm">Loading pages…</span>
              </div>
            ) : showNoSellableTypes ? (
              <div className="space-y-3 py-4 text-center" data-testid="empty-no-sellable-types">
                <p className="text-sm font-medium">No content types allow sellable products yet</p>
                <p className="text-xs text-muted-foreground">
                  Enable a content type for selling, then pick a page to add.
                </p>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setMode("enable-type")}
                  data-testid="button-open-enable-type"
                >
                  Enable a content type for selling
                </Button>
              </div>
            ) : selected && selectedType && selectedSlug ? (
              <>
                <div
                  className="rounded-md border bg-card px-3 py-3 space-y-2"
                  data-testid="card-selected-entry"
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1 space-y-0.5">
                      <p className="text-sm font-medium truncate" data-testid="text-selected-entry-label">
                        {selected.label || selectedSlug}
                      </p>
                      <p
                        className="text-xs text-muted-foreground font-mono truncate"
                        data-testid="text-selected-entry"
                      >
                        {selectedType}/{selectedSlug}
                      </p>
                    </div>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0"
                      aria-label="Change page"
                      onClick={() => setSelected(null)}
                      data-testid="button-edit-selected-entry"
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                  </div>
                  {restoredKey ? (
                    <p className="text-xs text-muted-foreground" data-testid="text-restored-tracking-key">
                      Keeps its tracking key <code>{restoredKey}</code>.
                    </p>
                  ) : (
                    <TrackingKeyField
                      kind="product"
                      value={shortKey}
                      savedKey={null}
                      suggestion={keySuggestion}
                      renaming={false}
                      taken={takenProductKeys}
                      onChange={setShortKey}
                      onStartRename={() => {}}
                      testId="add-product-tracking-key"
                    />
                  )}
                  {isRestore && (
                    <p
                      className="text-xs text-amber-700 dark:text-amber-400"
                      data-testid="banner-restore-warning"
                    >
                      Was removed from the store; offer and personas are kept. Confirm restores
                      Selling.
                    </p>
                  )}
                  {!canManageSelected && (
                    <p
                      className="text-xs text-amber-700 dark:text-amber-400"
                      data-testid="text-product-manage-denied"
                    >
                      You cannot make this page sellable — your account doesn’t have permission for
                      “{selectedType}” products.
                    </p>
                  )}
                </div>

                <DialogFooter className="gap-2 sm:gap-0">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleOpenChange(false)}
                    data-testid="button-add-product-cancel"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={!canManageSelected || makeSellableMutation.isPending || !!keyError}
                    onClick={() => {
                      makeSellableMutation.mutate({
                        contentType: selectedType,
                        slug: selectedSlug,
                        ...(restoredKey ? {} : { shortKey: shortKey.trim().toLowerCase() || keySuggestion }),
                      });
                    }}
                    data-testid="button-confirm-make-sellable"
                  >
                    {makeSellableMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Saving…
                      </>
                    ) : isRestore ? (
                      "Make sellable again"
                    ) : (
                      "Make sellable"
                    )}
                  </Button>
                </DialogFooter>
              </>
            ) : (
              <>
                <div className="relative">
                  <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search pages…"
                    className="pl-9"
                    data-testid="input-add-product-search"
                  />
                </div>

                {showNoEligibleEntries ? (
                  <div className="space-y-3 py-6 text-center" data-testid="empty-no-eligible-entries">
                    <p className="text-sm text-muted-foreground">
                      Every page from sellable types is already a product.
                    </p>
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => setMode("enable-type")}
                      data-testid="button-open-enable-type-more"
                    >
                      Enable another content type for selling
                    </Button>
                  </div>
                ) : showSearchEmpty ? (
                  <p className="text-sm text-muted-foreground text-center py-6" data-testid="empty-search">
                    No pages match “{query.trim()}”.
                  </p>
                ) : (
                  <ScrollArea className="h-56 rounded-md border">
                    <ul className="p-1" data-testid="list-add-product-entries">
                      {pickerEntries.map((entry) => {
                        const key = sitemapContentEntryKey(entry)!;
                        const restore = removedKeys.has(key);
                        return (
                          <li key={key}>
                            <button
                              type="button"
                              className="w-full text-left rounded-md px-2.5 py-2 text-sm hover-elevate"
                              onClick={() => setSelected(entry)}
                              data-testid={`button-pick-entry-${key.replace(/\//g, "-")}`}
                            >
                              <span className="font-medium block truncate">
                                {entry.label || entry.slug}
                              </span>
                              <span className="text-xs text-muted-foreground font-mono block truncate">
                                {key}
                                {restore ? " · was removed" : ""}
                              </span>
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </ScrollArea>
                )}

                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-muted-foreground"
                    onClick={() => setMode("enable-type")}
                    data-testid="button-enable-type-link"
                  >
                    Enable a content type for selling
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => handleOpenChange(false)}
                    data-testid="button-add-product-cancel"
                  >
                    Cancel
                  </Button>
                </div>
              </>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
