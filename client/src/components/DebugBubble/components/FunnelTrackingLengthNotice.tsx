import { AlertTriangle } from "lucide-react";
import { measureFunnelTrackingLength } from "@shared/tracking-context";
import type { FunnelProductBinding } from "@shared/funnel";
import type { TrackingKeyIndex } from "@shared/tracking-keys";

/**
 * Live warning while staff pick product + persona bindings: Google Analytics keeps 100
 * characters per value, so a long list is cut in reports (leads and the CRM keep it all).
 */
export function FunnelTrackingLengthNotice({
  bindings,
  keys,
  contentType,
  contentSlug,
}: {
  bindings: FunnelProductBinding[];
  keys: TrackingKeyIndex | null | undefined;
  contentType?: string;
  contentSlug?: string;
}) {
  if (!keys || bindings.length === 0) return null;
  const report = measureFunnelTrackingLength(
    { products: bindings },
    { contentType: contentType ?? "", contentSlug: contentSlug ?? "" },
    keys,
  );
  if (!report.over) return null;
  const longest = Math.max(report.product, report.persona, report.product_persona);
  return (
    <div
      className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs flex gap-2"
      data-testid="funnel-tracking-too-long"
    >
      <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
      <div className="space-y-1">
        <p>
          These products and personas add up to {longest} characters. Google Analytics keeps only{" "}
          {report.max}, so some will be cut from reports. Leads and the CRM still get the full list.
        </p>
        <details className="text-[11px] text-muted-foreground">
          <summary className="cursor-pointer select-none text-primary hover:underline">Read more (advanced)</summary>
          <p className="mt-1 font-mono">
            product {report.product} · persona {report.persona} · product_persona {report.product_persona} / {report.max}
          </p>
          <p className="mt-1">
            Events carry tracking_truncated: true when a value is cut. Shorter tracking keys (Store) or fewer
            bindings fix it.
          </p>
        </details>
      </div>
    </div>
  );
}
