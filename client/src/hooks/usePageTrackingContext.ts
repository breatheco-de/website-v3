import { useEffect } from "react";
import { normalizeFunnelBlock } from "@shared/funnel";
import { buildFunnelTrackingContext, type PageTrackingContext } from "@shared/tracking-context";
import { ensureTrackingKeys } from "@/lib/ecommerceProductMap";
import { setPageTrackingContext } from "@/lib/tracking";

/**
 * Report the page's product / persona tracking values (codes) for every event on this page.
 * Uses the server seed (`_tracking`, first load) when present; otherwise builds them from the
 * page funnel and the site's tracking keys. Sets an empty context when the site's tracking
 * switch is off or `skip` (staff edit mode, forced previews), so route changes never wait.
 */
export function usePageTrackingContext(
  data: unknown,
  opts: { contentType: string; slug: string; skip?: boolean },
): void {
  const record = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
  useEffect(() => {
    if (!record || typeof window === "undefined") return;
    const pathname = window.location.pathname;
    if (opts.skip) {
      setPageTrackingContext(null, pathname);
      return;
    }
    const seeded = record._tracking as PageTrackingContext | undefined;
    if (seeded && typeof seeded === "object") {
      setPageTrackingContext(seeded, pathname);
      return;
    }
    let cancelled = false;
    void ensureTrackingKeys().then(({ ready, keys }) => {
      if (cancelled) return;
      setPageTrackingContext(
        ready
          ? buildFunnelTrackingContext(
              normalizeFunnelBlock(record.funnel),
              { contentType: opts.contentType, contentSlug: opts.slug },
              keys,
            )
          : null,
        pathname,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [record, opts.contentType, opts.slug, opts.skip]);
}
