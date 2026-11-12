/**
 * Tracking → Events: product / persona codes on every event — switch status, GA4 custom
 * dimensions (Test connection / Create them) and the code list download.
 */

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  IconAlertTriangle,
  IconCircleCheck,
  IconCircleX,
  IconDownload,
  IconListCheck,
  IconLoader2,
  IconPlugConnected,
  IconPlus,
  IconTags,
  IconX,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import { apiFetch, apiRequest } from "@/lib/queryClient";
import type { TrackingSettingsResponse } from "@/lib/tracking";
import { normalizeSkipDomain } from "@shared/gtm-payload";
import { ProductPersonaSetupDialog } from "./ProductPersonaSetupDialog";

type Readiness = {
  ready: boolean;
  ready_at: string | null;
  missing: { type: "product" | "persona"; product: string; persona?: string; name: string }[];
  products: number;
  personas: number;
};

type Ga4Status = {
  ok: boolean;
  existing: string[];
  missing: string[];
  created?: string[];
  error?: string;
  step?: string;
  fix?: string;
};

const DIMENSIONS = ["product", "persona", "product_persona", "funnel_stage", "content_key", "tracking_truncated"];
const READINESS_KEY = ["/api/settings/tracking/product-tracking"];
const GA4_KEY = ["/api/settings/tracking/ga4-dimensions"];

export function ProductPersonaTrackingCard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { canMutateMetrics } = useDebugAuth();
  const [setupOpen, setSetupOpen] = useState(false);

  const { data: readiness } = useQuery<Readiness>({
    queryKey: READINESS_KEY,
    queryFn: async () => (await apiFetch(READINESS_KEY[0])).json(),
  });
  const { data: ga4, isLoading: ga4Loading, refetch, isFetching } = useQuery<Ga4Status>({
    queryKey: GA4_KEY,
    queryFn: async () => (await apiFetch(GA4_KEY[0])).json(),
  });

  const create = useMutation({
    mutationFn: async () => (await apiFetch(GA4_KEY[0], { method: "POST" })).json() as Promise<Ga4Status>,
    onSuccess: (result) => {
      queryClient.setQueryData(GA4_KEY, result);
      if (result.ok) {
        toast({
          title: "Dimensions ready",
          description: result.created?.length ? `Created ${result.created.join(", ")}.` : "They already existed.",
        });
      } else {
        toast({ title: "Couldn't create dimensions", description: result.fix ?? result.error, variant: "destructive" });
      }
    },
  });

  const testConnection = async () => {
    const { data: result, error } = await refetch();
    if (!result || error || result.step || (result.error && !result.ok)) {
      toast({
        title: "Connection failed",
        description: result?.fix ?? result?.error ?? (error instanceof Error ? error.message : "Try again in a moment."),
        variant: "destructive",
      });
    } else if (result.ok) {
      toast({ title: "Connection OK", description: "All product / persona dimensions are registered in Google Analytics." });
    } else {
      toast({
        title: `Connection OK, ${result.missing.length} missing`,
        description: canMutateMetrics ? "Use Create them to add them." : "Someone with tracking edit access can add them.",
      });
    }
  };

  const download = async () => {
    const res = await apiFetch("/api/settings/tracking/short-keys.csv");
    if (!res.ok) {
      toast({ title: "Couldn't download the code list", variant: "destructive" });
      return;
    }
    const blob = await res.blob();
    const name = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "tracking-keys.csv";
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const missingCount = readiness?.missing.length ?? 0;

  return (
    <Card data-testid="card-product-persona-tracking">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
        <div className="flex items-center gap-2">
          <IconTags className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">Product &amp; persona on events</CardTitle>
        </div>
        <Button variant="secondary" onClick={() => void testConnection()} disabled={isFetching} data-testid="button-tracking-ga4-test">
          {isFetching ? <IconLoader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <IconPlugConnected className="mr-1.5 h-4 w-4" />}
          {isFetching ? "Testing…" : "Test connection"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Every event includes the page&apos;s product and persona as short codes, plus the page key. Download the code
          list to translate codes in other tools. Leads and the CRM get the full names.
        </p>

        {readiness && (
          readiness.ready ? (
            <p className="flex items-start gap-2 text-sm" data-testid="text-product-tracking-on">
              <IconCircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-status-online" />
              On since {readiness.ready_at ? new Date(readiness.ready_at).toLocaleDateString() : "launch"}.
              {missingCount > 0 &&
                ` ${missingCount} product/persona key${missingCount === 1 ? " is" : "s are"} missing; those send their full name until fixed in Diagnostics.`}
            </p>
          ) : (
            <p className="flex items-start gap-2 text-sm text-status-away" data-testid="text-product-tracking-off">
              <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>
                Product and persona tracking is off until every product and persona on this site has a tracking key (
                {missingCount} missing). Run migration 009 from{" "}
                <Link href="/private/settings/migrations" className="text-primary hover:underline">
                  Settings → General → Migrations
                </Link>
                , or set keys in the Store.
              </span>
            </p>
          )
        )}

        {ga4Loading || !ga4 ? (
          <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="space-y-3">
            <ul className="grid gap-1.5 text-sm sm:grid-cols-2">
              {DIMENSIONS.map((name) => {
                const ok = ga4.existing.includes(name);
                return (
                  <li key={name} className="flex items-center gap-2" data-testid={`tracking-ga4-dimension-${name}`}>
                    {ok ? (
                      <IconCircleCheck className="h-4 w-4 text-status-online" />
                    ) : (
                      <IconCircleX className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span className="font-mono text-xs">{name}</span>
                    <span className="text-xs text-muted-foreground">{ok ? "registered" : "missing"}</span>
                  </li>
                );
              })}
            </ul>
            {ga4.fix && <p className="text-sm text-destructive">{ga4.fix}</p>}
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => create.mutate()}
                disabled={!canMutateMetrics || create.isPending || ga4.ok || ga4.step === "configure_bigquery"}
                data-testid="button-tracking-ga4-create"
              >
                {create.isPending && <IconLoader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {ga4.ok ? "All dimensions exist" : "Create them"}
              </Button>
              <Button variant="outline" onClick={() => void download()} data-testid="button-download-tracking-keys">
                <IconDownload className="mr-1.5 h-4 w-4" />
                Download code list
              </Button>
              <Button variant="outline" onClick={() => setSetupOpen(true)} data-testid="button-product-persona-setup">
                <IconListCheck className="mr-1.5 h-4 w-4" />
                Setup instructions
              </Button>
            </div>
          </div>
        )}

        <CheckoutLinksBlock canEdit={canMutateMetrics} />

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Read more (advanced)</summary>
          <ul className="mt-2 list-disc pl-5 space-y-1 leading-relaxed">
            <li>
              Keys: <code>product</code>, <code>persona</code>, <code>product_persona</code> (code pairs like{" "}
              <code>aie:cc</code>), <code>funnel_stage</code>, <code>content_key</code> (<code>type:slug</code>),{" "}
              <code>tracking_truncated</code>. Several values are comma-joined.
            </li>
            <li>
              <code>all</code> = the page&apos;s funnel covers every product; <code>none</code> = a content page with no
              funnel.
            </li>
            <li>
              Lead forms can send other values with hidden <code>product</code> / <code>persona</code> fields (full id or
              code). Overriding only the product keeps just the personas the page binds to that product.
            </li>
            <li>
              Google Analytics keeps 100 characters per value; longer lists are cut at a whole code and the event says{" "}
              <code>tracking_truncated: true</code>.
            </li>
            <li>
              The lead ledger stores the full ids in <code>product</code> / <code>persona</code> from launch on (older leads
              are empty).
            </li>
            <li>Tag Manager is set up by hand: see Setup instructions.</li>
            <li className="font-mono">_product.yml → short_key, personas[].short_key, retired_short_keys</li>
            <li>
              Links leaving the checkout path carry <code>gtm_payload</code>: URL-encoded JSON with <code>v: 1</code>,{" "}
              <code>product</code>, <code>persona</code>, <code>product_persona</code> (short codes, same keys older
              links used), <code>funnel_stage</code>, <code>content_key</code>, <code>experiment_id</code> /{" "}
              <code>variant</code>, <code>ts</code> and <code>is_staff</code> (staff sessions only).
            </li>
            <li>
              Checkout path = decision pages, plus pages with no stage for 30 minutes after one (per browser tab). An
              awareness, consideration or post-enrollment page clears it. A broader decision page (for example one
              listing every product) keeps the more specific context it received.
            </li>
            <li>
              Hand-written <code>gtm_payload</code> on a link (<code>{"{{ funnel.products }}"}</code>,{" "}
              <code>{"{qs:gtm_payload|…}"}</code>, encoded ids) is replaced on the checkout path; other keys typed in it
              win key by key. A <code>gtm_payload</code> arriving in the page URL is remembered.
            </li>
            <li>
              Sent whatever the visitor chose in the cookie banner; never while this switch is off. Internal links that
              redirect off-site carry it through the redirect. Right-click &quot;Copy link&quot; and links inside rich
              text don&apos;t.
            </li>
            <li className="font-mono">
              settings.yml → tracking.gtm_payload.skip_domains · shared/gtm-payload.ts · docs/gtm-analytics-setup.md
            </li>
          </ul>
        </details>
      </CardContent>
      <ProductPersonaSetupDialog
        open={setupOpen}
        onOpenChange={setSetupOpen}
        keysReady={readiness?.ready}
        dimensionsReady={ga4?.ok}
      />
    </Card>
  );
}

const TRACKING_SETTINGS_KEY = ["/api/settings/tracking"];

function errorText(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  const body = msg.replace(/^\d{3}:\s*/, "");
  try {
    const parsed = JSON.parse(body) as { error?: string };
    return parsed.error ?? body;
  } catch {
    return body;
  }
}

/** Links leaving the checkout path: domains whose links are never changed. */
function CheckoutLinksBlock({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState("");
  const { data: settings } = useQuery<TrackingSettingsResponse>({ queryKey: TRACKING_SETTINGS_KEY });
  const domains = settings?.gtm_payload?.skip_domains ?? [];

  const save = useMutation({
    mutationFn: async (next: string[]) =>
      (await apiRequest("PUT", "/api/settings/tracking", { gtm_payload: { skip_domains: next } })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: TRACKING_SETTINGS_KEY });
      toast({ title: "Saved", description: "Visitors get the change from their next visit." });
    },
    onError: (err) => toast({ title: "Couldn't save", description: errorText(err), variant: "destructive" }),
  });

  const add = () => {
    const domain = normalizeSkipDomain(draft);
    if (!domain) {
      toast({ title: "Not a domain", description: "Use a domain like pay.example.com.", variant: "destructive" });
      return;
    }
    setDraft("");
    if (!domains.includes(domain)) save.mutate([...domains, domain]);
  };

  return (
    <div className="space-y-2 rounded-md border border-border p-3" data-testid="block-checkout-links">
      <p className="text-sm font-medium">Links leaving the checkout path</p>
      <p className="text-sm text-muted-foreground leading-relaxed">
        On the checkout path, links to other sites carry the visitor&apos;s product and persona, so checkout can report
        them. Add a domain below if its links must stay exactly as written (for example, payment links). Changes apply
        from a visitor&apos;s next visit.
      </p>
      {domains.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="text-skip-domains-empty">
          No domains excluded: every link to another site gets the context.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5" data-testid="list-skip-domains">
          {domains.map((d) => (
            <li
              key={d}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-0.5 font-mono text-xs"
            >
              {d}
              <button
                type="button"
                className="text-muted-foreground hover:text-foreground disabled:opacity-50"
                aria-label={`Remove ${d}`}
                disabled={!canEdit || save.isPending}
                onClick={() => save.mutate(domains.filter((x) => x !== d))}
                data-testid={`button-remove-skip-domain-${d}`}
              >
                <IconX className="h-3 w-3" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="pay.example.com"
          className="h-8 max-w-xs text-sm"
          disabled={!canEdit || save.isPending}
          data-testid="input-skip-domain"
        />
        <Button
          type="submit"
          size="sm"
          variant="secondary"
          disabled={!canEdit || save.isPending || !draft.trim()}
          data-testid="button-add-skip-domain"
        >
          {save.isPending ? <IconLoader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <IconPlus className="mr-1.5 h-4 w-4" />}
          Exclude domain
        </Button>
      </form>
    </div>
  );
}
