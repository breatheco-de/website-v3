import { useEffect, useState } from "react";
import {
  IconChevronDown,
  IconDeviceFloppy,
  IconLoader2,
  IconPlugConnected,
  IconSearch,
  IconToggleLeft,
  IconToggleRight,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";

type OpenRushConfigResponse = {
  configured: boolean;
  api_key_configured: boolean;
  settings: {
    enabled: boolean;
    serp_top_n: number;
    location: string;
    language: string;
    session_credit_limit: number;
    daily_credit_limit: number;
    budget_warn_percent: number;
  };
};

export function SearchConsoleOpenRushCard({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [serpTopN, setSerpTopN] = useState(20);
  const [location, setLocation] = useState("United States");
  const [language, setLanguage] = useState("English");
  const [sessionLimit, setSessionLimit] = useState(50);
  const [dailyLimit, setDailyLimit] = useState(200);
  const [warnPercent, setWarnPercent] = useState(80);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/settings/openrush"],
    queryFn: async () => {
      const res = await apiFetch("/api/settings/openrush");
      if (!res.ok) throw new Error("Failed to load OpenRush settings");
      return res.json() as Promise<OpenRushConfigResponse>;
    },
  });

  useEffect(() => {
    if (!data?.settings || dirty) return;
    setEnabled(data.settings.enabled);
    setSerpTopN(data.settings.serp_top_n || 20);
    setLocation(data.settings.location || "United States");
    setLanguage(data.settings.language || "English");
    setSessionLimit(data.settings.session_credit_limit ?? 50);
    setDailyLimit(data.settings.daily_credit_limit ?? 200);
    setWarnPercent(data.settings.budget_warn_percent ?? 80);
  }, [data, dirty]);

  async function save() {
    setSaving(true);
    try {
      await apiRequest("PUT", "/api/settings/openrush", {
        enabled,
        serp_top_n: serpTopN,
        location: location.trim(),
        language: language.trim(),
        session_credit_limit: sessionLimit,
        daily_credit_limit: dailyLimit,
        budget_warn_percent: warnPercent,
      });
      setDirty(false);
      toast({ title: "OpenRush settings saved" });
      await refetch();
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
      const res = await apiRequest("POST", "/api/settings/openrush/test");
      const body = await res.json();
      if (!res.ok || !body.ok) {
        throw new Error(body.error || "Test failed");
      }
      toast({ title: "OpenRush connected", description: "inspect_serp succeeded (2 credits)." });
    } catch (err) {
      toast({
        title: "OpenRush test failed",
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
        Loading OpenRush…
      </div>
    );
  }

  return (
    <Card data-testid="card-openrush-settings">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <IconSearch className="h-4 w-4" />
          OpenRush SERP
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Optional live SERP snapshots for the Organic dashboard. Credits are charged per inspect.
          This does not start a Search Console export or change URL Inspection.
        </p>
        <p className="text-xs text-muted-foreground" data-testid="text-openrush-markets-note">
          OpenRush keeps search result snapshots, keyword ideas and competitors. When DataForSEO is on, it
          supplies keyword volume and difficulty instead. Which country each lookup uses now comes from{" "}
          <Link href="/private/settings/seo/search-console" className="underline underline-offset-2 hover:text-foreground">
            Search Console → Organic markets
          </Link>
          ; the location and language below are only used when no market applies.
        </p>
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">Enable OpenRush</p>
            <p className="text-xs text-muted-foreground">
              Key stays in <code className="font-mono">OPENRUSH_API_KEY</code>
              {data.api_key_configured ? " (set)" : " (missing)"}.
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
            data-testid="button-openrush-enabled"
          >
            {enabled ? (
              <IconToggleRight className="h-5 w-5 text-chart-3" />
            ) : (
              <IconToggleLeft className="h-5 w-5 text-muted-foreground" />
            )}
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground" htmlFor="openrush-top-n">
              SERP top N
            </label>
            <Input
              id="openrush-top-n"
              type="number"
              min={1}
              max={100}
              value={serpTopN}
              disabled={!canEdit}
              onChange={(e) => {
                setSerpTopN(Number(e.target.value) || 20);
                setDirty(true);
              }}
              data-testid="input-openrush-serp-top-n"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground" htmlFor="openrush-location">
              Fallback location
            </label>
            <Input
              id="openrush-location"
              value={location}
              disabled={!canEdit}
              onChange={(e) => {
                setLocation(e.target.value);
                setDirty(true);
              }}
              data-testid="input-openrush-location"
            />
          </div>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground" htmlFor="openrush-language">
              Fallback language
            </label>
            <Input
              id="openrush-language"
              value={language}
              disabled={!canEdit}
              onChange={(e) => {
                setLanguage(e.target.value);
                setDirty(true);
              }}
              data-testid="input-openrush-language"
            />
          </div>
        </div>

        <div className="space-y-2 rounded-md border border-border p-3">
          <p className="text-sm font-medium text-foreground">SEO research budgets</p>
          <p className="text-xs text-muted-foreground">
            Agents share a daily credit pot with staff refreshes. Each agent session also has its own
            cap. At the warn %, agents must confirm before more paid research; at 100% research is
            blocked until the next day or session. Cache hits do not spend credits. Staff refreshes
            count toward the daily limit only.
          </p>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor="seo-research-session">
                Agent session limit
              </label>
              <Input
                id="seo-research-session"
                type="number"
                min={1}
                value={sessionLimit}
                disabled={!canEdit}
                onChange={(e) => {
                  setSessionLimit(Number(e.target.value) || 50);
                  setDirty(true);
                }}
                data-testid="input-seo-research-session-limit"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor="seo-research-daily">
                Daily site limit
              </label>
              <Input
                id="seo-research-daily"
                type="number"
                min={1}
                value={dailyLimit}
                disabled={!canEdit}
                onChange={(e) => {
                  setDailyLimit(Number(e.target.value) || 200);
                  setDirty(true);
                }}
                data-testid="input-seo-research-daily-limit"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-foreground" htmlFor="seo-research-warn">
                Warn at %
              </label>
              <Input
                id="seo-research-warn"
                type="number"
                min={1}
                max={99}
                value={warnPercent}
                disabled={!canEdit}
                onChange={(e) => {
                  setWarnPercent(Number(e.target.value) || 80);
                  setDirty(true);
                }}
                data-testid="input-seo-research-warn-percent"
              />
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={save}
            disabled={!canEdit || !dirty || saving}
            data-testid="button-openrush-save"
          >
            {saving ? <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <IconDeviceFloppy className="h-4 w-4 mr-1.5" />}
            Save
          </Button>
          <Button
            size="sm"
            variant="secondary"
            onClick={test}
            disabled={!canEdit || testing || !enabled}
            data-testid="button-openrush-test"
          >
            {testing ? <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <IconPlugConnected className="h-4 w-4 mr-1.5" />}
            Test connection
          </Button>
        </div>
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger asChild>
            <button
              type="button"
              className="flex items-center gap-2 text-sm font-medium text-foreground"
              data-testid="button-openrush-advanced"
            >
              Read more (advanced)
              <IconChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
            </button>
          </CollapsibleTrigger>
          <CollapsibleContent className="mt-3 space-y-1 text-xs font-mono text-muted-foreground">
            <p>settings.yml → openrush</p>
            <p>OPENRUSH_API_KEY (env only)</p>
            <p>.cache/{"{site}"}/openrush-serp.json · openrush-keywords.json</p>
            <p>.cache/{"{site}"}/seo-research-{"{ideas|competitors|gaps}"}.json</p>
            <p>.cache/{"{site}"}/seo-research-budget.json</p>
            <p>Keyword/SERP/ideas TTL 7d; competitors/gaps 14d. Market (location+language) in cache keys.</p>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
