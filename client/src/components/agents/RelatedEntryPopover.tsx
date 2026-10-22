import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconCopy, IconExternalLink, IconSearch } from "@tabler/icons-react";
import { deslugifyLabel } from "@shared/relation-field";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import {
  ManagedSeoModal,
  type ManagedSeoModalTarget,
} from "@/components/editing/ManagedSeoModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export type RelatedEntryInfo = {
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

export function relatedEntryQueryKey(contentType: string, slug: string, locale: string) {
  return ["/api/seo/entry", contentType, slug, locale, "related-entry"] as const;
}

export async function fetchRelatedEntry(
  contentType: string,
  slug: string,
  locale: string,
): Promise<RelatedEntryInfo> {
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
}

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
  primaryHref,
  primaryLabel,
  metaLabel,
  onOpenMeta,
  triggerClassName,
  children,
  testId,
}: {
  contentType: string;
  slug: string;
  locale: string;
  variant?: string | null;
  previewHref?: string | null;
  /** Replaces the public page URL on the main button; stays enabled while the entry lookup loads or fails. */
  primaryHref?: string | null;
  primaryLabel?: string;
  metaLabel?: string;
  /** When set, the parent owns the meta modal instead of this popover. */
  onOpenMeta?: (target: ManagedSeoModalTarget) => void;
  triggerClassName?: string;
  children: ReactNode;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  const [seoModalOpen, setSeoModalOpen] = useState(false);
  const [seoModalTarget, setSeoModalTarget] = useState<ManagedSeoModalTarget | null>(null);
  const { toast } = useToast();
  const { data, isLoading, isError, error } = useQuery<RelatedEntryInfo>({
    queryKey: relatedEntryQueryKey(contentType, slug, locale),
    enabled: open && !!contentType && !!slug,
    staleTime: 60_000,
    queryFn: () => fetchRelatedEntry(contentType, slug, locale),
  });

  const href = primaryHref || data?.path || "";
  const hrefLabel = primaryHref ? (primaryLabel ?? "Open preview") : "Open page";
  const heading = data?.title || data?.page_title || deslugifyLabel(slug);
  const slugValue = data?.slug || slug;
  const lastmod = data?.lastmod || null;
  const manageHref = `/private/type/${encodeURIComponent(contentType)}`;

  return (
    <>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex max-w-full cursor-pointer rounded-md text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            triggerClassName,
          )}
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
              <dd className="truncate">
                <a
                  href={manageHref}
                  className="text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-sm"
                  title={`Manage ${data?.contentType || contentType}`}
                  data-testid={`link-related-entry-manage-type-${slug}`}
                >
                  {data?.contentType || contentType}
                </a>
              </dd>
              <dt className="text-muted-foreground">Slug</dt>
              <dd className="min-w-0">
                <button
                  type="button"
                  className="flex min-w-0 max-w-full items-center gap-1 rounded-sm text-left text-foreground font-mono hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title="Click to copy slug"
                  aria-label="Copy slug"
                  data-testid={`button-related-entry-copy-slug-${slug}`}
                  onClick={() => {
                    void navigator.clipboard.writeText(slugValue).then(
                      () => toast({ title: "Copied", description: "Slug copied to clipboard." }),
                      () => toast({ title: "Copy failed", variant: "destructive" }),
                    );
                  }}
                >
                  <span className="min-w-0 truncate" title={slugValue}>
                    {slugValue}
                  </span>
                  <IconCopy className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </dd>
              <dt className="text-muted-foreground">Locale</dt>
              <dd className="text-foreground uppercase">{data?.locale || locale}</dd>
              {variant ? (
                <>
                  <dt className="text-muted-foreground">Draft</dt>
                  <dd className="text-foreground font-mono truncate">{variant}</dd>
                </>
              ) : null}
              {data?.path ? (
                <>
                  <dt className="text-muted-foreground">Path</dt>
                  <dd className="text-foreground font-mono truncate" title={data.path}>
                    {data.path}
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
            {variant ? (
              <Badge variant="secondary" className="text-[10px] font-normal">
                Soft draft · {variant}
              </Badge>
            ) : null}
          </div>
        )}
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            {href ? (
              <Button
                asChild
                size="sm"
                className="min-w-0 flex-1"
                data-testid={`button-related-entry-url-${slug}`}
              >
                <a href={href} target="_blank" rel="noopener noreferrer">
                  <IconExternalLink className="h-3.5 w-3.5" aria-hidden />
                  {hrefLabel}
                </a>
              </Button>
            ) : (
              <Button
                size="sm"
                className="min-w-0 flex-1"
                disabled
                data-testid={`button-related-entry-url-${slug}`}
              >
                <IconExternalLink className="h-3.5 w-3.5" aria-hidden />
                {hrefLabel}
              </Button>
            )}
            <Button
              size="sm"
              variant="outline"
              className="min-w-0 flex-1"
              data-testid={`button-related-entry-meta-${slug}`}
              onClick={() => {
                const target: ManagedSeoModalTarget = {
                  contentType: data?.contentType || contentType,
                  slug: data?.slug || slug,
                  locale: data?.locale || locale,
                  variant: variant || undefined,
                };
                setOpen(false);
                if (onOpenMeta) {
                  onOpenMeta(target);
                  return;
                }
                setSeoModalTarget(target);
                setSeoModalOpen(true);
              }}
            >
              <IconSearch className="h-3.5 w-3.5" aria-hidden />
              {metaLabel ?? "Open meta"}
            </Button>
          </div>
          {previewHref ? (
            <Button asChild size="sm" variant="outline" className="w-full">
              <a href={previewHref} target="_blank" rel="noopener noreferrer">
                Preview draft
              </a>
            </Button>
          ) : null}
        </div>
      </PopoverContent>
    </Popover>
    {onOpenMeta ? null : (
      <ManagedSeoModal
        open={seoModalOpen}
        onOpenChange={(next) => {
          setSeoModalOpen(next);
          if (!next) setSeoModalTarget(null);
        }}
        target={seoModalTarget}
      />
    )}
    </>
  );
}
