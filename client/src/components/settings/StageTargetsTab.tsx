import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconDeviceFloppy, IconLoader2, IconPlus, IconTarget, IconTrash } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useSettingsDirty } from "@/components/settings/SettingsShell";
import { useToast } from "@/hooks/use-toast";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import { apiFetch, apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import { FUNNEL_STAGE_ICON, FUNNEL_STAGE_ICON_TONE, FUNNEL_STAGE_LABEL, FUNNEL_STAGE_TAPER } from "@/lib/funnel-stage-ui";
import { FUNNEL_STAGES, type FunnelStage } from "@shared/funnel";
import { STAGE_OBJECTIVES, type StageTargets } from "@shared/page-objectives";
import type { StageBenchmarks } from "@shared/page-stats";
import { formatMoney } from "@/components/ads/ads-format";

type CostRow = { currency: string; amount: string };
type StageDraft = { rate: string; cost: CostRow[] };
type Draft = Record<FunnelStage, StageDraft>;

const CURRENCY_RE = /^[A-Z]{3}$/;

function toDraft(targets: StageTargets | undefined): Draft {
  const out = {} as Draft;
  for (const stage of FUNNEL_STAGES) {
    const t = targets?.[stage];
    out[stage] = {
      rate: t?.rate !== undefined ? String(Math.round(t.rate * 10000) / 100) : "",
      cost: Object.entries(t?.cost ?? {}).map(([currency, amount]) => ({ currency, amount: String(amount) })),
    };
  }
  return out;
}

function fromDraft(draft: Draft): { targets: StageTargets; errors: string[] } {
  const targets: StageTargets = {};
  const errors: string[] = [];
  for (const stage of FUNNEL_STAGES) {
    const d = draft[stage];
    const label = FUNNEL_STAGE_LABEL[stage];
    const entry: { rate?: number; cost?: Record<string, number> } = {};
    if (d.rate.trim()) {
      const n = Number(d.rate);
      if (!Number.isFinite(n) || n <= 0 || n > 100) errors.push(`${label}: the rate must be between 0 and 100%.`);
      else entry.rate = n / 100;
    }
    for (const row of d.cost) {
      const cur = row.currency.trim().toUpperCase();
      if (!cur && !row.amount.trim()) continue;
      const amount = Number(row.amount);
      if (!CURRENCY_RE.test(cur)) errors.push(`${label}: "${row.currency}" isn't a 3-letter currency code (e.g. USD).`);
      else if (!Number.isFinite(amount) || amount <= 0) errors.push(`${label}: the ${cur} cost must be a positive number.`);
      else entry.cost = { ...(entry.cost ?? {}), [cur]: amount };
    }
    if (entry.rate !== undefined || entry.cost) targets[stage] = entry;
  }
  return { targets, errors };
}

export function StageTargetsTab() {
  const { hasCapability } = useDebugAuth();
  const canEdit = hasCapability("ads_settings") || hasCapability("seo_settings");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({
    queryKey: ["/api/settings/funnel"],
    queryFn: async () => {
      const res = await apiFetch("/api/settings/funnel");
      if (!res.ok) throw new Error("Couldn't load targets");
      return (await res.json()) as { settings: { enforcement: boolean; targets?: StageTargets } };
    },
  });
  const benchQuery = useQuery({
    queryKey: ["/api/analytics/page-stats/benchmarks"],
    queryFn: async () => {
      const res = await apiFetch("/api/analytics/page-stats/benchmarks");
      if (!res.ok) return { updated_at: null, stages: {} as StageBenchmarks };
      return (await res.json()) as { updated_at: string | null; stages: StageBenchmarks };
    },
  });

  const saved = useMemo(() => toDraft(settingsQuery.data?.settings.targets), [settingsQuery.data]);
  const [draft, setDraft] = useState<Draft>(saved);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(saved), [saved]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  useSettingsDirty(dirty);

  const update = (stage: FunnelStage, next: Partial<StageDraft>) => setDraft((d) => ({ ...d, [stage]: { ...d[stage], ...next } }));

  const save = async () => {
    const { targets, errors } = fromDraft(draft);
    if (errors.length > 0) {
      toast({ title: "Check the targets", description: errors.join(" "), variant: "destructive" });
      return;
    }
    setSaving(true);
    try {
      const res = await apiRequest("PUT", "/api/settings/funnel", { targets });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error || `Save failed (${res.status})`);
      }
      await queryClient.invalidateQueries({ queryKey: ["/api/settings/funnel"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/analytics/page-stats"] });
      toast({ title: "Targets saved", description: "Page stats use them on the next open (cached results refresh within 10 minutes)." });
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const bench = benchQuery.data?.stages ?? {};

  return (
    <div className="space-y-4 pb-20">
      <Card data-testid="card-stage-targets">
        <CardHeader className="flex flex-row items-center gap-2 pb-4">
          <IconTarget className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">Stage targets</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">
            Each stage has one goal. The main target counts all visitors; the cost target counts ad traffic only. Leaving a field empty uses
            the automatic benchmark (similar pages, then the page's previous 28 days).
          </p>
          {settingsQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <div className="space-y-4">
              {FUNNEL_STAGES.map((stage) => {
                const def = STAGE_OBJECTIVES[stage];
                const Icon = FUNNEL_STAGE_ICON[stage];
                const b = bench[stage];
                const d = draft[stage];
                return (
                  <div key={stage} className="rounded-lg border border-border p-4 space-y-3" data-testid={`stage-targets-${stage}`}>
                    <div className="flex items-start gap-2">
                      <Icon className={cn("h-4 w-4 mt-0.5", FUNNEL_STAGE_ICON_TONE[FUNNEL_STAGE_TAPER[stage]])} />
                      <div>
                        <p className="text-sm font-medium text-foreground">{FUNNEL_STAGE_LABEL[stage]}</p>
                        <p className="text-xs text-muted-foreground">{def.job}</p>
                      </div>
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor={`target-rate-${stage}`} className="text-xs">
                          {def.primary.label} (%, all visitors)
                        </Label>
                        <Input
                          id={`target-rate-${stage}`}
                          inputMode="decimal"
                          value={d.rate}
                          disabled={!canEdit}
                          placeholder={b?.rate != null ? `Benchmark ${(b.rate * 100).toFixed(1)}` : "Benchmark"}
                          onChange={(e) => update(stage, { rate: e.target.value })}
                          data-testid={`input-target-rate-${stage}`}
                        />
                      </div>
                      {def.cost ? (
                        <div className="space-y-1.5">
                          <Label className="text-xs">{def.cost.label} (ads only)</Label>
                          {d.cost.map((row, i) => (
                            <div key={i} className="flex items-center gap-2">
                              <Input
                                aria-label="Currency"
                                className="w-20 uppercase"
                                maxLength={3}
                                value={row.currency}
                                disabled={!canEdit}
                                placeholder="USD"
                                onChange={(e) => update(stage, { cost: d.cost.map((r, j) => (j === i ? { ...r, currency: e.target.value.toUpperCase() } : r)) })}
                                data-testid={`input-target-cost-currency-${stage}-${i}`}
                              />
                              <Input
                                aria-label="Amount"
                                inputMode="decimal"
                                value={row.amount}
                                disabled={!canEdit}
                                placeholder={b?.cost?.[row.currency] != null ? `Benchmark ${b.cost[row.currency]}` : "Amount"}
                                onChange={(e) => update(stage, { cost: d.cost.map((r, j) => (j === i ? { ...r, amount: e.target.value } : r)) })}
                                data-testid={`input-target-cost-amount-${stage}-${i}`}
                              />
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 shrink-0"
                                aria-label="Remove currency"
                                disabled={!canEdit}
                                onClick={() => update(stage, { cost: d.cost.filter((_, j) => j !== i) })}
                              >
                                <IconTrash className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          ))}
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            disabled={!canEdit}
                            onClick={() => update(stage, { cost: [...d.cost, { currency: d.cost.length === 0 ? "USD" : "", amount: "" }] })}
                            data-testid={`button-target-cost-add-${stage}`}
                          >
                            <IconPlus className="h-3.5 w-3.5" />
                            {d.cost.length === 0 ? "Set a cost target" : "Add currency"}
                          </Button>
                          {b?.cost && <p className="text-[11px] text-muted-foreground">Benchmark: {formatMoney(b.cost)}</p>}
                        </div>
                      ) : (
                        <p className="text-xs text-muted-foreground self-end">No cost target: ad spend on this stage is flagged instead.</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {benchQuery.data?.updated_at && (
            <p className="text-[11px] text-muted-foreground">
              Benchmarks were last measured when a page stats drawer was opened ({new Date(benchQuery.data.updated_at).toLocaleDateString()}).
            </p>
          )}
        </CardContent>
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-background/95 backdrop-blur" data-testid="stage-targets-save-bar">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-end gap-3">
          <p className={cn("text-xs min-w-0 truncate text-right", dirty ? "text-destructive" : "text-muted-foreground")}>
            {saving ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"}
          </p>
          <Button size="sm" className="gap-1.5 shrink-0" onClick={save} disabled={!canEdit || !dirty || saving} data-testid="button-stage-targets-save">
            {saving ? <IconLoader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <IconDeviceFloppy className="h-3.5 w-3.5" aria-hidden />}
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
