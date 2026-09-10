import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconShoppingBag, IconInfoCircle, IconExternalLink, IconBraces } from "@tabler/icons-react";
import { Link } from "wouter";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import JsonViewer from "@/components/editing/JsonViewer";

interface EcommerceEventRow {
  name: string;
  wired: boolean;
  description: string;
  sample: Record<string, unknown>;
}

interface UsageRow {
  component_type: string;
  role?: string;
  events: string[];
  notes?: string;
}

interface EventsResponse {
  events: EcommerceEventRow[];
  usage: UsageRow[];
  product_count: number;
  education: { summary: string; advanced_paths: string[] };
}

interface ProductRow {
  product_id: string;
  name: string;
  content_type: string;
  content_slug: string;
  actively_selling?: boolean;
  active?: boolean;
}

/** Illustrative visitor-context sample (setVisitorContext). UTMs vary per visit. */
const SAMPLE_VISITOR_CONTEXT: Record<string, unknown> = {
  user_id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  visitor_location_city: "Miami",
  visitor_location_country: "United States",
  visitor_location_slug: "miami-usa",
  visitor_language: "en",
  visitor_latitude: 25.7701,
  visitor_longitude: -80.1928,
  utm_source: "google",
  utm_medium: "cpc",
  utm_campaign: "bootcamp-2024",
  utm_content: "hero-cta",
  utm_term: "ai bootcamp",
  utm_url: "https://4geeks.com/en/apply?utm_source=google",
  ppc_tracking_id: "Cj0KCQjw…",
};

function buildFullSamplePayload(sample: Record<string, unknown>): Record<string, unknown> {
  // Event sample wins on key clashes (e.g. user_id from trackEcommerce).
  return { ...SAMPLE_VISITOR_CONTEXT, ...sample };
}

export default function StoreEcommercePage() {
  const { data, isLoading, isError } = useQuery<EventsResponse>({
    queryKey: ["/api/ecommerce/events"],
    staleTime: 0,
  });
  const { data: mapData } = useQuery<{ products: ProductRow[] }>({
    queryKey: ["/api/ecommerce/product-map"],
    staleTime: 0,
  });
  const [fullSampleEvent, setFullSampleEvent] = useState<EcommerceEventRow | null>(null);

  const products = mapData?.products ?? [];
  const fullSampleJson = useMemo(
    () =>
      fullSampleEvent
        ? JSON.stringify(buildFullSamplePayload(fullSampleEvent.sample), null, 2)
        : "",
    [fullSampleEvent],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        <div className="flex items-center gap-3">
          <Link href="/private/diagnostics">
            <button className="p-1.5 rounded-md hover-elevate" data-testid="button-back" title="Back">
              <ArrowLeft className="h-4 w-4 text-muted-foreground" />
            </button>
          </Link>
          <IconShoppingBag className="h-5 w-5 text-muted-foreground" />
          <h1 className="text-xl font-semibold" data-testid="heading-ecommerce">
            Ecommerce events
          </h1>
          {data && (
            <Badge variant="secondary" data-testid="badge-product-count">
              {data.product_count} products
            </Badge>
          )}
        </div>

        <Card data-testid="card-education">
          <CardHeader className="pb-2">
            <CardTitle className="text-base flex items-center gap-2">
              <IconInfoCircle className="h-4 w-4" />
              How it works
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm text-muted-foreground">
            <p>
              {data?.education.summary ??
                "Ecommerce funnel events are purchasable-gated. Call sites send selection fields; trackEcommerce resolves product identity from _ecommerce.yml. Visitor session is pushed once via setVisitorContext (not on every ecommerce event). Forms/conversions are separate; begin_checkout and purchase are off-site."}
            </p>
            <p>
              Funnel: <code className="text-xs bg-muted px-1 rounded">view_item</code> →{" "}
              <code className="text-xs bg-muted px-1 rounded">add_to_cart</code> →{" "}
              <code className="text-xs bg-muted px-1 rounded">view_item_list</code> /{" "}
              <code className="text-xs bg-muted px-1 rounded">select_item</code> →{" "}
              <code className="text-xs bg-muted px-1 rounded">click_begin_checkout</code> →{" "}
              <code className="text-xs bg-muted px-1 rounded">begin_checkout</code> / purchase
              (off-site).
            </p>
            <p className="text-xs">
              Visitor session context is also on the dataLayer (once via{" "}
              <code className="font-mono">setVisitorContext</code>
              ): <code className="font-mono">user_id</code>, geo, language, UTMs. It is not
              re-attached on every ecommerce event — GTM can read those DLVs or map them as GA4
              user properties. Each ecommerce push still includes{" "}
              <code className="font-mono">user_id</code> from cookie when present.
            </p>
            <details className="text-xs">
              <summary className="cursor-pointer text-foreground font-medium">Read more (advanced)</summary>
              <ul className="mt-2 list-disc pl-5 space-y-1 font-mono">
                {(data?.education.advanced_paths ?? [
                  "docs/component-behaviors.md",
                  "docs/gtm-analytics-setup.md",
                  "client/src/lib/tracking.ts",
                  "client/src/lib/ecommerceProgramId.ts",
                  "client/src/lib/ecommerceProductMap.ts",
                  "shared/component-behaviors.ts",
                ]).map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </details>
          </CardContent>
        </Card>

        <section className="space-y-3">
          <Card data-testid="card-event-catalog">
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                Event catalog
                {data?.events && (
                  <Badge variant="secondary" className="font-normal text-xs">
                    {data.events.length}
                  </Badge>
                )}
              </CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                Ecommerce funnel events fired via{" "}
                <code className="font-mono text-xs">trackEcommerce</code>. Wired events run on
                this site; off-site events (begin_checkout / purchase) fire elsewhere.
              </p>
            </CardHeader>
            <CardContent className="pt-0">
              {isError && (
                <p className="text-sm text-muted-foreground">Failed to load events.</p>
              )}
              {isLoading && (
                <div className="space-y-2">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              )}
              {data?.events && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm" data-testid="table-events-ecommerce">
                    <thead>
                      <tr className="border-b">
                        <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground w-2/5">
                          Event / Push
                        </th>
                        <th className="text-left py-2 pr-4 text-xs font-medium text-muted-foreground">
                          Trigger
                        </th>
                        <th className="py-2 text-xs font-medium text-muted-foreground text-right">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.events.map((ev) => (
                        <tr key={ev.name} className="border-b last:border-0" data-testid={`row-event-${ev.name}`}>
                          <td className="py-2 pr-4 align-middle">
                            <div className="flex items-center gap-2 flex-wrap">
                              <Badge variant="secondary" className="font-mono text-xs">
                                {ev.name}
                              </Badge>
                              <Badge variant={ev.wired ? "default" : "outline"} className="text-xs font-normal">
                                {ev.wired ? "wired" : "off-site"}
                              </Badge>
                            </div>
                          </td>
                          <td className="py-2 pr-4 align-middle text-muted-foreground text-xs">
                            {ev.description}
                          </td>
                          <td className="py-2 align-middle text-right">
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  onClick={() => setFullSampleEvent(ev)}
                                  data-testid={`button-full-sample-${ev.name}`}
                                >
                                  <IconBraces className="h-3.5 w-3.5" />
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent>Show payload</TooltipContent>
                            </Tooltip>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Products
          </h2>
          {products.length === 0 && (
            <p className="text-sm text-muted-foreground">
              No purchasable products. Add{" "}
              <code className="bg-muted px-1 rounded">_product.yml</code> with{" "}
              <code className="bg-muted px-1 rounded">purchasable: true</code>.
            </p>
          )}
          <div className="grid gap-2">
            {products.map((p) => (
              <Link key={p.product_id} href={`/private/store/product/${p.content_slug}`}>
                <Card
                  className="hover-elevate cursor-pointer"
                  data-testid={`card-product-${p.content_slug}`}
                >
                  <CardContent className="py-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground font-mono">
                        {p.product_id} · {p.content_type}/{p.content_slug}
                      </p>
                    </div>
                    <IconExternalLink className="h-4 w-4 text-muted-foreground" />
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </section>

        <section className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Components with ecommerce behavior
          </h2>
          {(data?.usage ?? []).map((u) => (
            <Card key={u.component_type} data-testid={`card-usage-${u.component_type}`}>
              <CardContent className="py-3">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium font-mono">{u.component_type}</span>
                  {u.role && <Badge variant="secondary">{u.role}</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">
                  events: {u.events.join(", ") || "—"}
                </p>
                {u.notes && <p className="text-xs text-muted-foreground mt-1">{u.notes}</p>}
              </CardContent>
            </Card>
          ))}
        </section>
      </div>

      <Dialog
        open={!!fullSampleEvent}
        onOpenChange={(open) => {
          if (!open) setFullSampleEvent(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[90vh] flex flex-col overflow-hidden" data-testid="dialog-full-sample">
          <DialogHeader className="shrink-0">
            <DialogTitle className="font-mono text-sm font-semibold">
              {fullSampleEvent?.name} — full sample
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {fullSampleEvent?.description} + visitor session (
              <code className="font-mono text-xs">setVisitorContext</code>
              ). <code className="font-mono text-xs">user_id</code>, language, and location are
              normally always set; geo coords depend on the geo lookup; UTMs only include keys
              present for that visit (values below are examples).
            </DialogDescription>
          </DialogHeader>
          <div
            className="overflow-y-auto min-h-0 flex-1 rounded-md"
            data-testid="text-full-sample-json"
          >
            <JsonViewer
              value={fullSampleJson}
              className="[&_.cm-editor]:!max-w-full [&_.cm-scroller]:!overflow-auto [&_.cm-editor]:!max-h-none"
            />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
