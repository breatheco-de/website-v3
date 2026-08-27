import React, { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

export const NOT_META_FIELD_COPY = {
  title: {
    badge: "Not meta title",
    badgeTestId: "badge-not-meta-title",
    popoverTestId: "popover-not-meta-title",
    singleVar: "{{ entry.title }}",
    metaKey: "meta.page_title",
  },
  description: {
    badge: "Not meta description",
    badgeTestId: "badge-not-meta-description",
    popoverTestId: "popover-not-meta-description",
    singleVar: "{{ entry.description }}",
    metaKey: "meta.description",
  },
} as const;

export function NotMetaFieldBadge({
  field,
  onOpenSeoMeta,
  portalContainer,
  defaultOpen = false,
}: {
  field: "title" | "description";
  onOpenSeoMeta?: () => void;
  portalContainer?: HTMLElement | null;
  /** Test hook: start with popover open. */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const copy = NOT_META_FIELD_COPY[field];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0"
          data-testid={copy.badgeTestId}
          onClick={(e) => e.stopPropagation()}
        >
          <Badge
            variant="outline"
            className="text-[9px] font-sans font-normal border-amber-500/50 text-amber-800 dark:text-amber-200 cursor-pointer hover-elevate"
          >
            {copy.badge}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 text-xs space-y-3"
        align="start"
        container={portalContainer}
        data-testid={copy.popoverTestId}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="space-y-2 text-muted-foreground">
          <p className="font-medium text-foreground">Internal use</p>
          <p>
            This is <code className="font-mono">{field}</code> (
            <code className="font-mono">{copy.singleVar}</code>). It powers in-page content and
            templates — section copy wired to{" "}
            <code className="font-mono">{copy.singleVar}</code>, admin labels, and search — not the
            public SEO head by default.
          </p>
          <p>
            On blog/shared-layout types it may feed meta when{" "}
            <code className="font-mono">single.{"{locale}"}.yml</code> uses{" "}
            <code className="font-mono">
              {copy.metaKey}: &quot;{copy.singleVar}&quot;
            </code>
            .
          </p>
          {field === "title" && (
            <p>
              On many landings, on-page headlines live in section fields; SEO title is set in meta
              only.
            </p>
          )}
          <p className="font-medium text-foreground pt-1">External use (Google and sharing)</p>
          <p>
            For Google results, the browser tab, and social previews, edit{" "}
            <code className="font-mono">{copy.metaKey}</code> on the <strong>SEO Meta</strong> tab
            (share preview).
          </p>
        </div>
        {onOpenSeoMeta && (
          <Button
            size="sm"
            variant="outline"
            className="w-full"
            data-testid={`button-open-seo-meta-from-${field}`}
            onClick={() => {
              setOpen(false);
              onOpenSeoMeta();
            }}
          >
            Open SEO Meta tab
          </Button>
        )}
        <button
          type="button"
          className="text-[11px] text-primary hover:underline"
          data-testid={`button-not-meta-advanced-${field}`}
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? "Hide advanced" : "Read more (advanced)"}
        </button>
        {showAdvanced && (
          <div className="space-y-0.5 font-mono text-[10px] text-muted-foreground border-t pt-2">
            <p>client/src/hooks/usePageMeta.ts</p>
            <p>server/routes/_helpers.ts — applyMetaFallback</p>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
