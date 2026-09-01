import { useState, useEffect, useLayoutEffect, useMemo, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, Link, ExternalLink, Check, Globe } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import {
  filterSitemapEntries,
  sitemapPathname,
  type FilterSitemapOptions,
  type SitemapSearchEntry,
} from "@/lib/sitemapSearch";
import { LocaleFlag } from "@/components/DebugBubble/components/LocaleFlag";

interface SitemapSearchProps {
  value: string;
  onChange: (value: string, isCustom: boolean) => void;
  placeholder?: string;
  testId?: string;
  locale?: string;
  portalContainer?: HTMLElement | null;
  /**
   * Render only the search panel (for nesting inside a parent Popover).
   * Calls onClose after a selection or custom save.
   */
  embedded?: boolean;
  onClose?: () => void;
  /** When set, sitemap row picks call this with the full entry instead of onChange. */
  onSelectEntry?: (entry: SitemapSearchEntry, path: string) => void;
  /** Show a flag dropdown next to search so staff can switch or clear the locale filter. */
  showLocaleFilter?: boolean;
  /** Paths and seo-index member ids to hide from results (hub, existing members). */
  excludePaths?: string[];
  excludeIds?: string[];
  /** Hide custom URL mode — cluster picker only lists sitemap pages. */
  hideCustomUrl?: boolean;
}

interface SitemapResultRowProps {
  entry: SitemapSearchEntry;
  path: string;
  selected: boolean;
  testId?: string;
  onSelect: (path: string) => void;
}

/**
 * Truncated by default; on hover/focus, a fixed overlay expands to the right
 * so long paths stay readable without widening the picker (escapes ScrollArea clip).
 */
function SitemapResultRow({
  entry,
  path,
  selected,
  testId,
  onSelect,
}: SitemapResultRowProps) {
  const rowRef = useRef<HTMLButtonElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const [overlayRect, setOverlayRect] = useState<DOMRect | null>(null);

  const hideOverlay = useCallback(() => setOverlayRect(null), []);

  const showOverlay = useCallback(() => {
    const el = rowRef.current;
    if (!el) return;
    setOverlayRect(el.getBoundingClientRect());
  }, []);

  useEffect(() => {
    if (!overlayRect) return;

    const hide = () => hideOverlay();
    window.addEventListener("scroll", hide, true);
    window.addEventListener("resize", hide);
    return () => {
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("resize", hide);
    };
  }, [overlayRect, hideOverlay]);

  // Grow with content, then nudge left if the chip would leave the viewport.
  useLayoutEffect(() => {
    if (!overlayRect || !overlayRef.current) return;
    const el = overlayRef.current;
    const width = el.getBoundingClientRect().width;
    const overflowRight = overlayRect.left + width - (window.innerWidth - 8);
    el.style.left =
      overflowRight > 0
        ? `${Math.max(8, overlayRect.left - overflowRight)}px`
        : `${overlayRect.left}px`;
  }, [overlayRect, path, entry.label]);

  const pathNeedsExpand = path.length > 36 || (entry.label?.length ?? 0) > 42;

  return (
    <>
      <button
        ref={rowRef}
        type="button"
        onClick={() => onSelect(path)}
        onMouseEnter={() => {
          if (pathNeedsExpand) showOverlay();
        }}
        onMouseLeave={hideOverlay}
        onFocus={() => {
          if (pathNeedsExpand) showOverlay();
        }}
        onBlur={hideOverlay}
        className={cn(
          "relative w-full text-left px-2 py-1.5 rounded-md text-sm hover-elevate flex items-start gap-2 group",
          selected && "bg-primary/10",
        )}
        data-testid={testId}
      >
        <div className="flex-1 min-w-0">
          <div className="font-medium text-foreground truncate text-xs">
            {entry.label}
          </div>
          <div className="text-xs text-muted-foreground truncate">{path}</div>
        </div>
        {selected && (
          <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
        )}
      </button>

      {overlayRect &&
        createPortal(
          <div
            ref={overlayRef}
            aria-hidden
            className={cn(
              "pointer-events-none fixed z-[10051] flex w-max items-start gap-2 rounded-md border bg-popover px-2 py-1.5 text-sm shadow-md",
              selected && "bg-primary/10",
            )}
            style={{
              top: overlayRect.top,
              left: overlayRect.left,
              minWidth: overlayRect.width,
              minHeight: overlayRect.height,
            }}
          >
            <div>
              <div className="font-medium text-foreground text-xs whitespace-nowrap">
                {entry.label}
              </div>
              <div className="text-xs text-muted-foreground whitespace-nowrap">
                {path}
              </div>
            </div>
            {selected && (
              <Check className="h-4 w-4 text-primary flex-shrink-0 mt-0.5" />
            )}
          </div>,
          document.body,
        )}
    </>
  );
}

const FALLBACK_SITEMAP_LOCALES = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
];

function isLocaleMenuTarget(target: EventTarget | null): boolean {
  return target instanceof Element && Boolean(target.closest("[data-sitemap-locale-menu]"));
}

function SitemapLocaleFilter({
  locale,
  onLocaleChange,
  testId,
  triggerClassName,
  title = "Filter pages by language",
}: {
  locale: string;
  onLocaleChange: (next: string) => void;
  testId?: string;
  triggerClassName?: string;
  title?: string;
}) {
  const { data: localeSettings } = useQuery<{
    supported_locales: Array<{ code: string; label: string }>;
  }>({
    queryKey: ["/api/settings/locales"],
    queryFn: async () => {
      const res = await fetch("/api/settings/locales");
      if (!res.ok) {
        return { supported_locales: FALLBACK_SITEMAP_LOCALES };
      }
      return res.json();
    },
    staleTime: Infinity,
  });

  const locales =
    localeSettings?.supported_locales?.length
      ? localeSettings.supported_locales
      : FALLBACK_SITEMAP_LOCALES;

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          title={title}
          className={cn(
            "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground hover-elevate",
            triggerClassName,
          )}
          data-testid={testId ? `${testId}-locale-filter` : "sitemap-locale-filter"}
        >
          {locale ? (
            <LocaleFlag locale={locale} className="h-3 w-4 rounded-sm" />
          ) : (
            <Globe className="h-3.5 w-3.5" />
          )}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        data-sitemap-locale-menu=""
        className="z-[10050] min-w-[9rem]"
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <DropdownMenuItem
          onSelect={() => onLocaleChange("")}
          data-testid={`${testId}-locale-all`}
        >
          <Globe className="h-3.5 w-3.5" />
          <span className="flex-1">All locales</span>
          {!locale ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
        </DropdownMenuItem>
        {locales.map((entry) => {
          const selected = locale === entry.code;
          return (
            <DropdownMenuItem
              key={entry.code}
              onSelect={() => onLocaleChange(entry.code)}
              data-testid={`${testId}-locale-${entry.code}`}
            >
              <LocaleFlag locale={entry.code} className="h-3 w-4 rounded-sm" />
              <span className="flex-1">{entry.code.toUpperCase()}</span>
              {selected ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export { SitemapLocaleFilter };

export function SitemapSearch({
  value,
  onChange,
  placeholder = "/page-url",
  testId,
  locale = "",
  portalContainer,
  embedded = false,
  onClose,
  onSelectEntry,
  showLocaleFilter = false,
  excludePaths,
  excludeIds,
  hideCustomUrl = false,
}: SitemapSearchProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isCustomMode, setIsCustomMode] = useState(false);
  const [customUrl, setCustomUrl] = useState(value);
  const [customError, setCustomError] = useState("");
  const [localeOverride, setLocaleOverride] = useState<string | null>(null);

  useEffect(() => {
    setCustomUrl(value);
  }, [value]);

  const filterLocale = showLocaleFilter ? (localeOverride ?? locale) : locale;

  const { data: sitemapUrls = [], isLoading } = useQuery<SitemapSearchEntry[]>({
    queryKey: ["/api/sitemap-urls", filterLocale],
    queryFn: async () => {
      const url = filterLocale
        ? `/api/sitemap-urls?locale=${filterLocale}`
        : "/api/sitemap-urls";
      const response = await fetch(url);
      if (!response.ok) throw new Error("Failed to load sitemap URLs");
      return response.json();
    },
  });

  const filterOptions = useMemo((): FilterSitemapOptions | undefined => {
    if (!excludePaths?.length && !excludeIds?.length) return undefined;
    return { excludePaths, excludeIds };
  }, [excludePaths, excludeIds]);

  const filteredUrls = useMemo(
    () => filterSitemapEntries(sitemapUrls, searchQuery, filterOptions),
    [sitemapUrls, searchQuery, filterOptions],
  );

  const isCurrentValueInSitemap = sitemapUrls.some((entry) => sitemapPathname(entry.loc) === value);

  const finish = () => {
    setOpen(false);
    setSearchQuery("");
    setIsCustomMode(false);
    onClose?.();
  };

  const handleSelect = (url: string, entry: SitemapSearchEntry) => {
    if (onSelectEntry) {
      onSelectEntry(entry, url);
    } else {
      onChange(url, false);
    }
    finish();
  };

  const hasLocalePrefix = (url: string) => /^\/[a-z]{2}(\/|$)/i.test(url.trim());

  const handleCustomSubmit = () => {
    const trimmed = customUrl.trim();
    if (!trimmed.startsWith("http") && hasLocalePrefix(trimmed)) {
      setCustomError("Custom URLs cannot start with a locale prefix like /en/ or /es/. Use the page search above instead.");
      return;
    }
    setCustomError("");
    onChange(trimmed, true);
    finish();
  };

  const panel = (
    <>
      <div className="p-2 border-b">
        <div className="flex items-center gap-1">
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setIsCustomMode(false);
              }}
              placeholder="Search pages..."
              className="h-8 pl-8 text-sm"
              autoFocus
              data-testid={`${testId}-search`}
            />
          </div>
          {showLocaleFilter ? (
            <SitemapLocaleFilter
              locale={filterLocale}
              onLocaleChange={(next) => setLocaleOverride(next)}
              testId={testId}
            />
          ) : null}
        </div>
      </div>

      {isCustomMode ? (
        <div className="p-2 space-y-2">
          <p className="text-xs text-muted-foreground">Enter a custom URL:</p>
          <div className="flex gap-2">
            <Input
              value={customUrl}
              onChange={(e) => { setCustomUrl(e.target.value.replace(/\s+/g, "-")); setCustomError(""); }}
              placeholder="/custom-url or https://..."
              className="h-8 text-sm flex-1"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCustomSubmit();
              }}
              data-testid={`${testId}-custom-input`}
            />
            <Button
              size="sm"
              className="h-8"
              onClick={handleCustomSubmit}
              data-testid={`${testId}-custom-save`}
            >
              Save
            </Button>
          </div>
          {customError && (
            <p className="text-xs text-destructive">{customError}</p>
          )}
          <button
            onClick={() => { setIsCustomMode(false); setCustomError(""); }}
            className="text-xs text-muted-foreground hover-elevate px-1 py-0.5 rounded"
          >
            Back to search
          </button>
        </div>
      ) : (
        <>
          <ScrollArea className="h-[200px]">
            {isLoading ? (
              <div className="p-4 text-sm text-muted-foreground text-center">
                Loading pages...
              </div>
            ) : filteredUrls.length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground text-center">
                {searchQuery ? "No pages found" : "No pages available"}
              </div>
            ) : (
              <div className="p-1">
                {filteredUrls.map((entry, index) => {
                  const path = sitemapPathname(entry.loc);
                  return (
                    <SitemapResultRow
                      key={path}
                      entry={entry}
                      path={path}
                      selected={value === path}
                      testId={`${testId}-option-${index}`}
                      onSelect={(path) => handleSelect(path, entry)}
                    />
                  );
                })}
              </div>
            )}
          </ScrollArea>

          {!onSelectEntry && !hideCustomUrl ? (
            <div className="p-2 border-t">
              <button
                onClick={() => {
                  setIsCustomMode(true);
                  setCustomUrl(value);
                }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-muted-foreground hover-elevate"
                data-testid={`${testId}-custom-toggle`}
              >
                <ExternalLink className="h-4 w-4" />
                <span>Use custom URL</span>
                {!isCurrentValueInSitemap && value && (
                  <span className="ml-auto text-xs text-primary">(current)</span>
                )}
              </button>
            </div>
          ) : null}
        </>
      )}
    </>
  );

  if (embedded) {
    return <div data-testid={testId}>{panel}</div>;
  }

  const displayValue = value || placeholder;
  const isExternal = value?.startsWith("http");

  return (
    // modal={false}: avoid Radix Dialog focus/pointer traps when nested in Dialogs
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "group inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md transition-colors max-w-full hover-elevate",
            value
              ? "text-primary/80 bg-primary/5"
              : "text-muted-foreground"
          )}
          data-testid={testId}
        >
          {isExternal ? (
            <ExternalLink className="h-3 w-3 flex-shrink-0" />
          ) : (
            <Link className="h-3 w-3 flex-shrink-0" />
          )}
          <span className="truncate">{displayValue}</span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 p-0 z-[10001] pointer-events-auto"
        align="start"
        container={portalContainer}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if (isLocaleMenuTarget(e.target)) e.preventDefault();
        }}
        onFocusOutside={(e) => {
          if (isLocaleMenuTarget(e.target)) e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (isLocaleMenuTarget(e.target)) e.preventDefault();
        }}
      >
        {panel}
      </PopoverContent>
    </Popover>
  );
}
