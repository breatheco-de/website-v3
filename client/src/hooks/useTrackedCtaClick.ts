/**
 * Ecommerce CTA click: fire trackEcommerce when tracking is set, then navigate
 * (waits briefly for GTM via useInternalNav beforeLeave).
 */

import { useCallback } from "react";
import { useInternalNav } from "@/hooks/useInternalNav";
import { trackEcommerce } from "@/lib/tracking";
import { ensureEcommerceProductLookup } from "@/lib/ecommerceProductMap";
import { resolveProgramIdForPage, programIdFromCtaUrl } from "@/lib/ecommerceProgramId";
import { isCtaTrackingValue } from "@shared/component-behaviors";

export type TrackedCtaLike = {
  url?: string;
  tracking?: string;
};

export function useTrackedCtaClick(opts: {
  componentType: string;
  componentVariant: string;
  /** Override program_id resolution (e.g. hero product scope). */
  resolveProgramId?: (ctaUrl?: unknown) => string | undefined;
}) {
  const handleLinkClick = useInternalNav();

  const programIdFor = useCallback(
    (ctaUrl?: unknown) => {
      if (opts.resolveProgramId) return opts.resolveProgramId(ctaUrl);
      const fromPath =
        typeof window !== "undefined" ? resolveProgramIdForPage(ctaUrl) : programIdFromCtaUrl(ctaUrl);
      return fromPath || programIdFromCtaUrl(ctaUrl);
    },
    [opts.resolveProgramId],
  );

  /** Promise to pass as InternalLink/useInternalNav beforeLeave (null when no ecommerce fire). */
  const beforeLeaveFor = useCallback(
    (cta: TrackedCtaLike | undefined | null): Promise<void> | null => {
      const tracking = cta?.tracking;
      if (!isCtaTrackingValue(tracking) || tracking === "none") return null;
      const programId = programIdFor(cta?.url);
      return ensureEcommerceProductLookup().then(() =>
        trackEcommerce(tracking, {
          program_id: programId,
          component_type: opts.componentType,
          component_variant: opts.componentVariant,
          path: typeof window !== "undefined" ? window.location.pathname : undefined,
        }),
      );
    },
    [opts.componentType, opts.componentVariant, programIdFor],
  );

  const onCtaClick = useCallback(
    (cta: TrackedCtaLike | undefined | null) => (e: React.MouseEvent<HTMLAnchorElement>) => {
      handleLinkClick(e, { beforeLeave: beforeLeaveFor(cta) });
    },
    [handleLinkClick, beforeLeaveFor],
  );

  return { onCtaClick, beforeLeaveFor, handleLinkClick };
}
