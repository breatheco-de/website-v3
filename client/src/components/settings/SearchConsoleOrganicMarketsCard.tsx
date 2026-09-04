import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { apiRequestWithAuth, queryClient } from "@/lib/queryClient";
import { Link } from "wouter";

export type OrganicMarketDraft = {
  id: string;
  label: string;
  kind: "rollup" | "country";
  countries: string[];
};

type MarketsResponse = {
  markets: OrganicMarketDraft[];
  rollups?: OrganicMarketDraft[];
  countries?: OrganicMarketDraft[];
};

export function SearchConsoleOrganicMarketsCard({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [reloadHint, setReloadHint] = useState(false);
  const [draft, setDraft] = useState<OrganicMarketDraft[]>([]);

  const { data, isLoading } = useQuery<MarketsResponse>({
    queryKey: ["/api/settings/search-console/organic-markets"],
    enabled: canEdit || true,
    queryFn: async () => {
      const res = await fetch("/api/settings/search-console/organic-markets", {
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to load organic markets");
      return res.json() as Promise<MarketsResponse>;
    },
  });

  useEffect(() => {
    if (data?.markets) {
      setDraft(data.markets.map((m) => ({ ...m, countries: [...m.countries] })));
    }
  }, [data]);

  async function handleSave() {
    setSaving(true);
    try {
      await apiRequestWithAuth("PUT", "/api/settings/search-console/organic-markets", {
        organic_markets: draft,
      });
      await queryClient.invalidateQueries({
        queryKey: ["/api/settings/search-console/organic-markets"],
      });
      setReloadHint(true);
      toast({
        title: "Markets saved",
        description: "Wrote search_console.organic_markets. Re-load Search traffic if country lists changed.",
      });
    } catch (err: unknown) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function startReload() {
    try {
      const res = await apiRequestWithAuth("POST", "/api/seo/organic/days/backfill", {
        mode: "rebuild_60",
      });
      const body = (await res.json()) as { ok?: boolean; error?: string; remaining?: number };
      if (!res.ok || body.ok === false) {
        throw new Error(body.error || "Backfill failed");
      }
      toast({
        title: "Search traffic reload started",
        description:
          typeof body.remaining === "number"
            ? `Queued rebuild; ${body.remaining} day(s) still pending. Continue from Diagnostics → Organic if needed.`
            : "Continue from Diagnostics → Organic until the window is complete.",
      });
      setReloadHint(false);
    } catch (err: unknown) {
      toast({
        title: "Could not start reload",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  }

  function updateRow(index: number, patch: Partial<OrganicMarketDraft>) {
    setDraft((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function removeRow(index: number) {
    setDraft((prev) => prev.filter((_, i) => i !== index));
  }

  return (
    <Card data-testid="card-organic-markets">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Organic markets</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground leading-relaxed">
          Markets filter Cluster Map Search traffic by country. Empty country list means Worldwide
          (all rows). LatAm is a rollup that includes its listed countries.
        </p>
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading markets…
          </div>
        ) : (
          <div className="space-y-3" data-testid="organic-markets-editor">
            {draft.map((row, index) => (
              <div
                key={`${row.id}-${index}`}
                className="grid gap-2 rounded-md border border-border p-3 sm:grid-cols-[1fr_1fr_2fr_auto]"
                data-testid={`organic-market-row-${row.id || index}`}
              >
                <div className="space-y-1">
                  <Label className="text-xs">Id</Label>
                  <Input
                    value={row.id}
                    disabled={!canEdit || row.id === "worldwide"}
                    onChange={(e) => updateRow(index, { id: e.target.value })}
                    className="h-8 text-xs font-mono"
                    data-testid={`input-market-id-${index}`}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Label</Label>
                  <Input
                    value={row.label}
                    disabled={!canEdit}
                    onChange={(e) => updateRow(index, { label: e.target.value })}
                    className="h-8 text-xs"
                    data-testid={`input-market-label-${index}`}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Countries (comma-separated GSC codes)</Label>
                  <Input
                    value={row.countries.join(", ")}
                    disabled={!canEdit || row.id === "worldwide"}
                    placeholder={row.id === "worldwide" ? "all countries" : "usa, can"}
                    onChange={(e) =>
                      updateRow(index, {
                        countries: e.target.value
                          .split(/[,\s]+/)
                          .map((s) => s.trim())
                          .filter(Boolean),
                      })
                    }
                    className="h-8 text-xs font-mono"
                    data-testid={`input-market-countries-${index}`}
                  />
                </div>
                <div className="flex items-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    disabled={!canEdit || row.id === "worldwide"}
                    onClick={() => removeRow(index)}
                    data-testid={`button-remove-market-${index}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
            {canEdit ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    setDraft((prev) => [
                      ...prev,
                      { id: `market-${prev.length + 1}`, label: "New market", kind: "country", countries: [] },
                    ])
                  }
                  data-testid="button-add-organic-market"
                >
                  <Plus className="h-3.5 w-3.5 mr-1" />
                  Add market
                </Button>
                <Button
                  type="button"
                  size="sm"
                  disabled={saving}
                  onClick={() => void handleSave()}
                  data-testid="button-save-organic-markets"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : null}
                  Save markets
                </Button>
              </div>
            ) : null}
          </div>
        )}

        {reloadHint ? (
          <div
            className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 space-y-2"
            data-testid="banner-reload-search-traffic"
          >
            <p className="text-xs text-foreground">
              Re-load Search traffic to apply country filters to the day cache (does not run automatically).
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                onClick={() => void startReload()}
                data-testid="button-reload-search-traffic"
              >
                Re-load Search traffic
              </Button>
              <Button type="button" size="sm" variant="ghost" asChild>
                <Link href="/private/diagnostics/seo/organic">Open Diagnostics organic</Link>
              </Button>
            </div>
          </div>
        ) : null}

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="px-0 h-auto text-xs" data-testid="button-organic-markets-advanced">
              Read more (advanced)
              <ChevronDown className={`h-3.5 w-3.5 ml-1 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-1 space-y-1 text-xs text-muted-foreground">
            <p>
              GSC bulk export uses 3-letter codes (<code className="font-mono">usa</code>,{" "}
              <code className="font-mono">esp</code>). Two-letter codes like <code className="font-mono">US</code>{" "}
              are normalized on save. LatAm includes every country listed on that rollup—named markets are
              drill-downs, not additive. Saving markets does not rewrite{" "}
              <code className="font-mono">.cache/…/gsc-organic-days</code>; use Re-load Search traffic after
              changing codes. Day ingest prefers configured-market countries when near the row cap.
            </p>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
