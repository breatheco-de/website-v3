import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconExternalLink } from "@tabler/icons-react";
import { deslugifyLabel } from "@shared/relation-field";
import { formatSitePath } from "@shared/formatSitePath";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";

type RelatedEntryInfo = {
  title: string | null;
  page_title: string | null;
  description: string | null;
  path: string;
  contentType: string;
  slug: string;
  locale: string;
  file: string | null;
  lastmod?: string | null;
  updated_at?: string | null;
};

function formatLastmodAgo(lastmod: string, now = new Date()): string {
  const day = lastmod.split("T")[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return lastmod;
  const then = Date.parse(`${day}T00:00:00.000Z`);
  if (!Number.isFinite(then)) return lastmod;
  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round((nowDay - then) / (24 * 60 * 60 * 1000));
  if (days <= 0) return "today";
  if (days === 1) return "1 day ago";
  if (days < 14) return `${days} days ago`;
  const weeks = Math.floor(days / 7);
  if (days < 60) return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? "1 month ago" : `${months} months ago`;
  const years = Math.floor(days / 365);
  return years === 1 ? "1 year ago" : `${years} years ago`;
}

export function RelatedEntryPopover({
  contentType,
  slug,
  locale,
  variant,
  previewHref,
  children,
  testId,
}: {
  contentType: string;
  slug: string;
  locale: string;
  variant?: string | null;
  previewHref?: string | null;
  children: ReactNode;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const { data, isLoading, isError, error } = useQuery<RelatedEntryInfo>({
    queryKey: ["/api/seo/entry", contentType, slug, locale, "related-entry"],
    enabled: open && !!contentType && !!slug,
    staleTime: 60_000,
    queryFn: async () => {
      const params = new URLSearchParams({ locale: locale || "en" });
      const res = await fetch(
        `/api/seo/entry/${encodeURIComponent(contentType)}/${encodeURIComponent(slug)}?${params}`,
        { credentials: "include", headers: getSessionHeaders() },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error || "Failed to load entry");
      }
      return res.json();
    },
  });

  const href = data?.path || "";
  const heading = data?.title || data?.page_title || deslugifyLabel(slug);
  const lastmod = data?.lastmod || null;
  const manageHref = `/private/type/${encodeURIComponent(contentType)}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex max-w-full cursor-pointer rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        >
          {children}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 space-y-3 bg-popover text-popover-foreground"
        data-testid={testId ?? `popover-related-entry-${slug}`}
      >
        {isLoading ? (
          <div className="space-y-2" data-testid="related-entry-loading">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-2/3" />
          </div>
        ) : isError ? (
          <p className="text-xs text-destructive" data-testid="related-entry-error">
            {error instanceof Error ? error.message : "Could not load this entry."}
          </p>
        ) : (
          <div className="space-y-2">
            <div>
              <p
                className="text-sm font-medium text-foreground leading-snug"
                data-testid="text-related-entry-title"
              >
                {heading}
              </p>
              {data?.description ? (
                <p className="text-xs text-muted-foreground mt-1 line-clamp-3">{data.description}</p>
              ) : null}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-2 gap-y-1 text-xs">
              <dt className="text-muted-foreground">Type</dt>
              <dd className="text-foreground truncate">{data?.contentType || contentType}</dd>
              <dt className="text-muted-foreground">Slug</dt>
              <dd className="text-foreground font-mono truncate" title={data?.slug || slug}>
                {data?.slug || slug}
              </dd>
              <dt className="text-muted-foreground">Locale</dt>
              <dd className="text-foreground uppercase">{data?.locale || locale}</dd>
              {variant ? (
                <>
                  <dt className="text-muted-foreground">Draft</dt>
                  <dd className="text-foreground font-mono truncate">{variant}</dd>
                </>
              ) : null}
              {href ? (
                <>
                  <dt className="text-muted-foreground">Path</dt>
                  <dd className="text-foreground font-mono truncate" title={href}>
                    {href}
                  </dd>
                </>
              ) : null}
              {lastmod ? (
                <>
                  <dt className="text-muted-foreground">Updated</dt>
                  <dd
                    className="text-foreground"
                    title={lastmod.split("T")[0]}
                    data-testid="text-related-entry-lastmod"
                  >
                    {formatLastmodAgo(lastmod)}
                  </dd>
                </>
              ) : null}
            </dl>
            {data?.file ? (
              <p
                className="text-[11px] text-muted-foreground font-mono truncate"
                title={data.file}
              >
                {formatSitePath(data.file)}
              </p>
            ) : null}
            {variant ? (
              <Badge variant="secondary" className="text-[10px] font-normal">
                Soft draft · {variant}
              </Badge>
            ) : null}
          </div>
        )}
        <div className="flex flex-col gap-2">
          {href ? (
            <Button
              asChild
              size="sm"
              className="w-full"
              data-testid={`button-related-entry-url-${slug}`}
            >
              <a href={href} target="_blank" rel="noopener noreferrer">
                <IconExternalLink className="h-3.5 w-3.5" aria-hidden />
                Open page
              </a>
            </Button>
          ) : (
            <Button
              size="sm"
              className="w-full"
              disabled
              data-testid={`button-related-entry-url-${slug}`}
            >
              <IconExternalLink className="h-3.5 w-3.5" aria-hidden />
              Open page
            </Button>
          )}
          {previewHref ? (
            <Button asChild size="sm" variant="outline" className="w-full">
              <a href={previewHref} target="_blank" rel="noopener noreferrer">
                Preview draft
              </a>
            </Button>
          ) : null}
          <Button asChild size="sm" variant="ghost" className="w-full">
            <a href={manageHref}>Manage {contentType}</a>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
