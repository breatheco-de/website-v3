import { useEffect, useState } from "react";
import {
  IconChartBar,
  IconChevronDown,
  IconDeviceFloppy,
  IconLoader2,
  IconPlugConnected,
  IconToggleLeft,
  IconToggleRight,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { useSettingsDirty } from "@/components/settings/SettingsShell";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiRequest } from "@/lib/queryClient";

type DataForSeoMode = "live" | "sandbox";

type DataForSeoConfigResponse = {
  configured: boolean;
  credentials_configured: boolean;
  mode: DataForSeoMode;
  settings: {
    enabled: boolean;
    daily_usd_limit: number;
    session_usd_limit: number;
    budget_warn_percent: number;
  };
};

type BalanceResponse = { ok: boolean; balance_usd: number | null; mode?: DataForSeoMode; error?: string };

function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}

export function DataForSeoCard({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [dailyLimit, setDailyLimit] = useState("2");
  const [sessionLimit, setSessionLimit] = useState("0.5");
  const [warnPercent, setWarnPercent] = useState(80);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  useSettingsDirty(dirty);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/settings/dataforseo"],
    queryFn: async () => {
      const res = await apiFetch("/api/settings/dataforseo");
      if (!res.ok) throw new Error("Failed to load DataForSEO settings");
      return res.json() as Promise<DataForSeoConfigResponse>;
    },
  });

  const { data: balance, refetch: refetchBalance } = useQuery({
    queryKey: ["/api/seo/dataforseo/balance"],
    enabled: data?.configured === true,
    retry: false,
    staleTime: 60_000,
    queryFn: async () => {
      const res = await apiFetch("/api/seo/dataforseo/balance");
      return (await res.json().catch(() => ({ ok: false, balance_usd: null }))) as BalanceResponse;
    },
  });

  useEffect(() => {
    if (!data?.settings || dirty) return;
    setEnabled(data.settings.enabled);
    setDailyLimit(String(data.settings.daily_usd_limit));
    setSessionLimit(String(data.settings.session_usd_limit));
    setWarnPercent(data.settings.budget_warn_percent);
  }, [data, dirty]);

  const daily = Number(dailyLimit);
  const session = Number(sessionLimit);
  const limitsValid = Number.isFinite(daily) && daily > 0 && Number.isFinite(session) && session > 0;

  async function save() {
    setSaving(true);
    try {
      await apiRequest("PUT", "/api/settings/dataforseo", {
        enabled,
        daily_usd_limit: daily,
        session_usd_limit: session,
        budget_warn_percent: warnPercent,
      });
      setDirty(false);
      toast({ title: "DataForSEO settings saved" });
      await refetch();
      await refetchBalance();
    } catch (err) {
      toast({
        title: "Save failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    try {
      const res = await apiRequest("POST", "/api/settings/dataforseo/test");
      const body = (await res.json()) as {
        ok: boolean;
        error?: string;
        mode?: DataForSeoMode;
        balance_usd?: number | null;
      };
      if (!res.ok || !body.ok) throw new Error(body.error || "Test failed");
      toast({
        title: "Connection OK",
        description:
          body.mode === "sandbox"
            ? "Reached the DataForSEO sandbox (sample data, no charge)."
            : `Account balance ${body.balance_usd != null ? formatUsd(body.balance_usd) : "unknown"}. No lookup was charged.`,
      });
      await refetchBalance();
    } catch (err) {
      toast({
        title: "Connection failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setTesting(false);
    }
  }

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <IconLoader2 className="h-5 w-5 animate-spin mr-2" />
        Loading DataForSEO…
      </div>
    );
  }

  const sandbox = data.mode === "sandbox";

  return (
    <Card data-testid="card-dataforseo-settings">
      <CardHeader className="flex flex-row items-center gap-2 pb-4">
        <IconChartBar className="h-5 w-5 text-muted-foreground" />
        <CardTitle className="text-base">DataForSEO keyword metrics</CardTitle>
        {sandbox ? (
          <Badge variant="outline" className="ml-auto" data-testid="badge-dataforseo-sandbox">
            Sandbox (test data)
          </Badge>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          DataForSEO supplies keyword volume and how hard each keyword is to rank for. OpenRush still
          handles search result snapshots, keyword ideas and competitors. Lookups cost money; the limits
          below cap daily spend. Save stores these settings; Test connection checks the login and reads
          the account balance without paying for a lookup.
        </p>
        {sandbox ? (
          <p className="text-xs text-muted-foreground" data-testid="text-dataforseo-sandbox">
            This server is not the live site, so lookups use DataForSEO&apos;s free sandbox. Numbers are
            sample data — do not judge keywords by them.
          </p>
        ) : null}

        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">Enable DataForSEO</p>
            <p className="text-xs text-muted-foreground">
              {data.credentials_configured
                ? "Login is set on the server."
                : "Login is missing on the server — ask an admin to add it (see Read more)."}
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={!canEdit}
            onClick={() => {
              setEnabled((v) => !v);
              setDirty(true);
            }}
            aria-label={enabled ? "Turn off DataForSEO" : "Turn on DataForSEO"}
            data-testid="button-dataforseo-enabled"
          >
            {enabled ? (
              <IconToggleRight className="h-5 w-5 text-chart-3" />
            ) : (
              <IconToggleLeft className="h-5 w-5 text-muted-foreground" />
            )}
          </Button>
        </div>

        {data.configured ? (
          <p className="text-sm text-foreground" data-testid="text-dataforseo-balance">
            Account balance:{" "}
            <span className="font-medium tabular-nums">
              {balance?.ok && balance.balance_usd != null
                ? formatUsd(balance.balance_usd)
                : balance && !balance.ok
                  ? "could not load"
                  : "…"}
            </span>
          </p>
        ) : null}

        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="text-sm font-medium text-foreground">Spending limits (USD)</p>
          <p className="text-xs text-muted-foreground">
            Agents and staff share the daily limit; each agent session also has its own cap. From the warn
            %, agents must confirm before more paid lookups; at 100% lookups stop until the next day or
            session. Cached keywords (refreshed in the last 7 days) cost nothing.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor="dataforseo-daily">
                Daily site limit ($)
              </label>
              <Input
                id="dataforseo-daily"
                type="number"
                min={0.01}
                step={0.01}
                value={dailyLimit}
                disabled={!canEdit}
                onChange={(e) => {
                  setDailyLimit(e.target.value);
                  setDirty(true);
                }}
                data-testid="input-dataforseo-daily-limit"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor="dataforseo-session">
                Agent session limit ($)
              </label>
              <Input
                id="dataforseo-session"
                type="number"
                min={0.01}
                step={0.01}
                value={sessionLimit}
                disabled={!canEdit}
                onChange={(e) => {
                  setSessionLimit(e.target.value);
                  setDirty(true);
                }}
                data-testid="input-dataforseo-session-limit"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor="dataforseo-warn">
                Warn at %
              </label>
              <Input
                id="dataforseo-warn"
                type="number"
                min={1}
                max={99}
                value={warnPercent}
                disabled={!canEdit}
                onChange={(e) => {
                  setWarnPercent(Number(e.target.value) || 80);
                  setDirty(true);
                }}
                data-testid="input-dataforseo-warn-percent"
              />
            </div>
          </div>
          {!limitsValid ? (
            <p className="text-xs text-destructive">Limits must be more than $0.</p>
          ) : null}
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={save}
            disabled={!canEdit || !dirty || saving || !limitsValid}
            data-testid="button-dataforseo-save"
          >
            {saving ? (
              <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <IconDeviceFloppy className="h-4 w-4 mr-1.5" />
            )}
            Save
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={test}
            disabled={!canEdit || testing || !data.settings.enabled || !data.credentials_configured}
            data-testid="button-dataforseo-test"
          >
            {testing ? (
              <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : (
              <IconPlugConnected className="h-4 w-4 mr-1.5" />
            )}
            {testing ? "Testing…" : "Test connection"}
          </Button>
        </div>

        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 text-sm font-medium text-foreground"
              data-testid="button-dataforseo-advanced"
            >
              Read more (advanced)
              <IconChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-2 text-xs text-muted-foreground">
            <p>
              Difficulty is DataForSEO&apos;s 0–100 score from the link profiles of the top 10 results
              (logarithmic). It is not the same scale as other tools&apos; keyword difficulty. When it has no
              score, difficulty stays unknown — it is never filled from ad competition.
            </p>
            <p>
              Keyword numbers are shared with OpenRush in one cache: a keyword refreshed in the last 7 days is
              reused whichever tool filled it. Older ad-competition estimates stay until they expire.
            </p>
            <p>
              Markets (country + language) come from Search Console → organic markets and each page&apos;s
              language default.
            </p>
            <div className="space-y-1 font-mono">
              <p>settings.yml → dataforseo</p>
              <p>DATAFORSEO_LOGIN · DATAFORSEO_PASSWORD (env only)</p>
              <p>DATAFORSEO_USE_LIVE=true → real API off the live server</p>
              <p>.cache/{"{site}"}/openrush-keywords.json (shared keyword cache)</p>
              <p>.cache/{"{site}"}/seo-research-budget.json (providers.dataforseo, USD)</p>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
