import { useEffect, useMemo, useState } from "react";
import {
  IconAlertTriangle,
  IconBrandMeta,
  IconChevronDown,
  IconCircleCheck,
  IconCopy,
  IconDeviceFloppy,
  IconFlask,
  IconHistory,
  IconLoader2,
  IconPlugConnected,
  IconRefresh,
  IconPlus,
  IconToggleLeft,
  IconToggleRight,
  IconX,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { SearchableMultiCombobox, type SearchableMultiComboboxOption } from "@/components/ui/searchable-multi-combobox";
import { Textarea } from "@/components/ui/textarea";
import { useSettingsDirty } from "@/components/settings/SettingsShell";
import { AdsAlertThresholdsCard } from "@/components/settings/AdsAlertThresholdsCard";
import { MetaTrackingParamsStatus } from "@/components/settings/MetaTrackingParamsStatus";
import { AdsResyncButton } from "@/components/ads/AdsResyncButton";
import { AdsPullProductionButton } from "@/components/ads/AdsPullProductionButton";
import type { TrackingParamsCoverage } from "@shared/ads-diagnostics-rules";
import { useToast } from "@/hooks/use-toast";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import { apiFetch, apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  DEFAULT_ADS_ALERT_THRESHOLDS,
  MAX_KNOWN_EXTERNAL_CAMPAIGNS,
  MAX_META_LEAD_CONVERSIONS,
  isKnownExternalCampaign,
  normalizeMetaLeadConversionKey,
  type AdsAlertThresholds,
  type AdsSettings,
  type KnownExternalCampaign,
} from "@shared/ads-settings";
import type { AdsUtmConventionView, MetaLeadConversionOptions } from "@/components/ads/ads-types";
import { AdsUtmConventionCard } from "@/components/ads/AdsUtmConvention";
import {
  isRefreshActive,
  refreshProgressPercent,
  refreshStatusCopy,
  type AdsRefreshStatus,
} from "@shared/ads-refresh-status";

type SettingsResponse = {
  ads: AdsSettings;
  token_configured: boolean;
  api_version: string;
  utm_template: string;
  utm_convention?: AdsUtmConventionView;
  tracking_params: TrackingParamsCoverage | null;
  refreshing: boolean;
  refresh: AdsRefreshStatus;
  sync: {
    last_success_at: string | null;
    last_attempt_at: string | null;
    last_error: string | null;
    last_error_kind: string | null;
    consecutive_failures: number;
    history_since: string | null;
    history_until: string | null;
    accounts: Record<string, { name?: string; currency?: string; account_status?: number; error?: string }>;
    pulled_from_production_at?: string | null;
    production_origin?: string | null;
    snapshot_last_date?: string | null;
    backup_pushed_at?: string | null;
    backup_error?: string | null;
  };
  ga4: { configured: boolean; last_success_at: string | null; last_export_date: string | null; last_error: string | null };
  policy: { refresh_days: number; backfill_days: number; retention_days: number; cache_dir: string };
};

type TestResponse = {
  ok: boolean;
  token_configured: boolean;
  error?: string;
  accounts: Array<{ id: string; ok: boolean; name?: string; currency?: string; error?: string }>;
};

type AccountsResponse = {
  token_configured: boolean;
  accounts: Array<{ id: string; name: string; currency: string; account_status: number }>;
  error?: string;
  error_kind?: string;
};

function fmtWhen(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function parseIds(raw: string): string[] {
  return Array.from(new Set(raw.split(/[\s,]+/).map((s) => s.trim().replace(/^act_/i, "")).filter(Boolean)));
}

function ReadMore({ testId, children }: { testId: string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger asChild>
        <button type="button" className="flex items-center gap-2 text-sm font-medium text-foreground" data-testid={testId}>
          Read more (advanced)
          <IconChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-3 space-y-1 text-xs text-muted-foreground">{children}</CollapsibleContent>
    </Collapsible>
  );
}

export function MetaAdsTab() {
  const { hasCapability } = useDebugAuth();
  const canEdit = hasCapability("ads_settings");
  const { toast } = useToast();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/settings/ads/meta"],
    queryFn: async () => {
      const res = await apiFetch("/api/settings/ads/meta");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load Ads settings");
      return res.json() as Promise<SettingsResponse>;
    },
    refetchInterval: (q) => {
      const state = (q.state.data as SettingsResponse | undefined)?.refresh?.state;
      return state === "running" ? 3000 : state === "queued" ? 5000 : false;
    },
  });

  const { data: accountList, isLoading: accountsLoading } = useQuery({
    queryKey: ["/api/settings/ads/meta/accounts"],
    queryFn: async () => {
      const res = await apiFetch("/api/settings/ads/meta/accounts");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load ad accounts");
      return res.json() as Promise<AccountsResponse>;
    },
    enabled: !!data?.token_configured,
    staleTime: 5 * 60 * 1000,
  });

  const [enabled, setEnabled] = useState(false);
  const [accountIds, setAccountIds] = useState<string[]>([]);
  const [leadConversions, setLeadConversions] = useState<string[]>([]);
  const [patternsText, setPatternsText] = useState("");
  const [thresholds, setThresholds] = useState<AdsAlertThresholds>(DEFAULT_ADS_ALERT_THRESHOLDS);
  const [floorText, setFloorText] = useState<Record<string, string>>({});
  const [knownCampaigns, setKnownCampaigns] = useState<KnownExternalCampaign[]>([]);
  const [newKnownKey, setNewKnownKey] = useState("");
  const [newKnownNote, setNewKnownNote] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState<null | "refresh" | "older">(null);
  const [testResult, setTestResult] = useState<TestResponse | null>(null);
  const [connectionOpen, setConnectionOpen] = useState(false);
  useSettingsDirty(dirty);

  useEffect(() => {
    if (!data || dirty) return;
    setEnabled(data.ads.meta.enabled);
    setAccountIds(data.ads.meta.ad_account_ids);
    setLeadConversions(data.ads.meta.lead_conversions ?? []);
    setPatternsText(data.ads.test_email_patterns.join("\n"));
    setThresholds(data.ads.meta.alert_thresholds);
    setFloorText(Object.fromEntries(Object.entries(data.ads.meta.alert_thresholds.severity_spend_floor).map(([c, v]) => [c, String(v)])));
    setKnownCampaigns(data.ads.meta.known_external_campaigns ?? []);
  }, [data, dirty]);

  const accountCurrencies = useMemo(
    () => Array.from(new Set(Object.values(data?.sync.accounts ?? {}).map((a) => a.currency).filter((c): c is string => !!c))),
    [data],
  );
  const missingFloors = accountCurrencies.filter((c) => !(c in floorText));

  const accountOptions = useMemo<SearchableMultiComboboxOption[]>(() => {
    const listed = accountList?.accounts ?? [];
    const options: SearchableMultiComboboxOption[] = listed.map((a) => ({
      value: a.id,
      label: [a.name || "Unnamed", a.currency, a.account_status !== 1 ? "disabled" : null].filter(Boolean).join(" · "),
    }));
    const listedIds = new Set(listed.map((a) => a.id));
    const listLoaded = !!accountList && !accountList.error;
    for (const id of accountIds) {
      if (listedIds.has(id)) continue;
      const known = data?.sync.accounts[id]?.name;
      if (listLoaded) options.push({ value: id, label: `${known || id} · not visible to the access key` });
      else if (known) options.push({ value: id, label: known });
    }
    return options;
  }, [accountList, accountIds, data]);

  const { data: conversions, isLoading: conversionsLoading } = useQuery({
    queryKey: ["/api/ads/meta/conversions", accountIds.join(","), leadConversions.join(",")],
    queryFn: async () => {
      const qs = new URLSearchParams({ account_ids: accountIds.join(","), picked: leadConversions.join(",") });
      const res = await apiFetch(`/api/ads/meta/conversions?${qs.toString()}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load Meta conversions");
      return res.json() as Promise<MetaLeadConversionOptions>;
    },
    enabled: connectionOpen && accountIds.length > 0,
    staleTime: 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const conversionOptions = useMemo<SearchableMultiComboboxOption[]>(() => {
    const accountLabel = (id: string) => accountList?.accounts.find((a) => a.id === id)?.name || data?.sync.accounts[id]?.name || id;
    const listed = conversions?.options ?? [];
    const options: SearchableMultiComboboxOption[] = listed.map((o) => ({
      value: o.key,
      label: [
        o.pixel_name ? `${o.name} — ${o.pixel_name}` : o.name,
        o.archived ? "archived" : null,
        o.missing_accounts.length > 0 ? `not shared with ${o.missing_accounts.map(accountLabel).join(", ")}` : null,
      ]
        .filter(Boolean)
        .join(" · "),
    }));
    const listedKeys = new Set(listed.map((o) => o.key));
    const anyReadable = !!conversions?.accounts.some((a) => a.source !== "none");
    for (const key of leadConversions) {
      if (listedKeys.has(key)) continue;
      const name = conversions?.unlisted_picked.find((u) => u.key === key)?.name ?? key;
      options.push({ value: key, label: anyReadable ? `${name} · no longer in Meta` : name });
    }
    return options;
  }, [conversions, leadConversions, accountList, data]);
  const conversionErrors = (conversions?.accounts ?? []).filter((a) => a.source === "none" && a.error);

  async function save() {
    setSaving(true);
    try {
      const floors: Record<string, number> = {};
      for (const [c, v] of Object.entries(floorText)) {
        const n = Number(v);
        if (/^[A-Z]{3}$/.test(c) && Number.isFinite(n) && v.trim() !== "") floors[c] = n;
      }
      const res = await apiRequest("PUT", "/api/settings/ads/meta", {
        enabled,
        ad_account_ids: accountIds,
        lead_conversions: leadConversions,
        test_email_patterns: patternsText.split(/\n+/).map((s) => s.trim()).filter(Boolean),
        alert_thresholds: { ...thresholds, severity_spend_floor: floors },
        known_external_campaigns: knownCampaigns,
      });
      const body = (await res.json()) as SettingsResponse & { sync_requested?: boolean };
      setDirty(false);
      toast({
        title: "Ads settings saved",
        description: body.sync_requested ? "Loading the last 90 days from Meta in the background." : undefined,
      });
      await refetch();
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function test() {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await apiRequest("POST", "/api/settings/ads/meta/test", { ad_account_ids: accountIds });
      const body = (await res.json()) as TestResponse;
      setTestResult(body);
      toast({
        title: body.ok ? "Meta connected" : "Meta test failed",
        description: body.ok ? `${body.accounts.length} account(s) readable.` : body.error || "One or more accounts failed.",
        variant: body.ok ? undefined : "destructive",
      });
    } catch (err) {
      toast({ title: "Meta test failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setTesting(false);
    }
  }

  async function sync(mode: "refresh" | "older") {
    setSyncing(mode);
    try {
      const res = await apiRequest("POST", "/api/ads/meta/sync", { mode });
      const body = (await res.json()) as { refresh?: AdsRefreshStatus };
      const state = body.refresh?.state;
      if (state === "failed" || state === "worker_down") {
        toast({
          title: "Sync didn't start",
          description: refreshStatusCopy(body.refresh, "settings")?.message,
          variant: "destructive",
        });
      } else {
        toast({
          title: mode === "older" ? "Loading older history" : "Sync started",
          description: state === "queued" ? "Queued for the background worker." : "This runs in the background.",
        });
      }
      await refetch();
    } catch (err) {
      toast({ title: "Sync failed to start", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setSyncing(null);
    }
  }

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <IconLoader2 className="h-5 w-5 animate-spin mr-2" />
        Loading Meta settings…
      </div>
    );
  }

  const markDirty = () => setDirty(true);
  const accountName = (id: string) => accountList?.accounts.find((a) => a.id === id)?.name || data.sync.accounts[id]?.name || id;
  const refreshActive = isRefreshActive(data.refresh);
  const refreshCopy = refreshStatusCopy(data.refresh, "settings");
  const progressPct = data.refresh.state === "running" ? refreshProgressPercent(data.refresh.progress) : null;

  return (
    <div className="space-y-4" data-testid="tab-panel-ads-meta">
      <Card data-testid="card-meta-connection">
        <CardHeader className="pb-3">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 text-left"
            aria-expanded={connectionOpen}
            onClick={() => setConnectionOpen((v) => !v)}
            data-testid="button-meta-connection-toggle"
          >
            <CardTitle className="text-base flex items-center gap-2">
              <IconBrandMeta className="h-4 w-4" />
              Meta connection
            </CardTitle>
            <IconChevronDown
              className={cn("h-4 w-4 text-muted-foreground transition-transform", connectionOpen && "rotate-180")}
            />
          </button>
        </CardHeader>
        <CardContent className="space-y-4">
          {connectionOpen && (
            <p className="text-sm text-muted-foreground">
              Connect your Meta ad accounts so Caxton can show spend and leads next to your pages. Syncing only reads — ads
              change only when someone with Edit live ads confirms Fix via Meta in Diagnostics.
            </p>
          )}

          <div className="flex items-center justify-between gap-3" data-testid="meta-connection-status">
            <div>
              <p className="text-sm font-medium text-foreground">Use Meta data</p>
              <p className="text-xs text-muted-foreground">
                Access key: {data.token_configured ? (
                  <span className="text-chart-3">set on the server</span>
                ) : (
                  <span className="text-amber-500">missing — ask an admin to add it to the server environment</span>
                )}
              </p>
              <p className="mt-1 flex items-center gap-1 text-xs text-muted-foreground" data-testid="text-meta-token-env">
                Environment variable:
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">META_ADS_ACCESS_TOKEN</code>
                <button
                  type="button"
                  className="rounded p-0.5 hover:bg-muted hover:text-foreground"
                  aria-label="Copy variable name"
                  onClick={() => {
                    void navigator.clipboard?.writeText("META_ADS_ACCESS_TOKEN");
                    toast({ title: "Variable name copied" });
                  }}
                  data-testid="button-copy-meta-token-env"
                >
                  <IconCopy className="h-3.5 w-3.5" />
                </button>
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!canEdit}
              onClick={() => {
                setEnabled((v) => !v);
                markDirty();
              }}
              data-testid="button-meta-enabled"
            >
              {enabled ? <IconToggleRight className="h-5 w-5 text-chart-3" /> : <IconToggleLeft className="h-5 w-5 text-muted-foreground" />}
            </Button>
          </div>

          {connectionOpen && (
            <div className="space-y-4" data-testid="meta-connection-details">
              <div className="grid gap-4 md:grid-cols-2">
              {data.token_configured && (
                <div className="space-y-1.5" data-testid="field-meta-account-ids">
                  <p className="text-sm font-medium text-foreground">Ad accounts</p>
                  <p className="text-xs text-muted-foreground">
                    Pick the accounts to report on. The list shows every account the server&apos;s Meta key can read.
                  </p>
                  <SearchableMultiCombobox
                    values={accountIds}
                    onChange={(next) => {
                      setAccountIds(parseIds(next.join("\n")));
                      markDirty();
                    }}
                    options={accountOptions}
                    placeholder="Select ad accounts…"
                    searchPlaceholder="Search by name or id…"
                    emptyMessage="No accounts match"
                    isLoading={accountsLoading}
                    disabled={!canEdit}
                    testId="meta-account-ids"
                  />
                  {accountList?.error && (
                    <p className="text-xs text-destructive" data-testid="text-meta-accounts-error">
                      Could not load accounts from Meta: {accountList.error}. You can still type an account id.
                    </p>
                  )}
                </div>
              )}
                <div className="space-y-1.5" data-testid="field-meta-lead-conversions">
                  <p className="text-sm font-medium text-foreground">Conversions that count as leads</p>
                  <p className="text-xs text-muted-foreground">
                    The Leads card counts only these. With none picked, it counts the standard Lead event.
                  </p>
                  <SearchableMultiCombobox
                    values={leadConversions}
                    onChange={(next) => {
                      const keys = Array.from(
                        new Set(next.map((v) => normalizeMetaLeadConversionKey(v)).filter((k): k is string => !!k)),
                      ).slice(0, MAX_META_LEAD_CONVERSIONS);
                      setLeadConversions(keys);
                      markDirty();
                    }}
                    options={conversionOptions}
                    placeholder={accountIds.length === 0 ? "Pick ad accounts first…" : "Select conversions…"}
                    searchPlaceholder="Search by name or id…"
                    emptyMessage="No conversions match"
                    isLoading={conversionsLoading}
                    disabled={!canEdit || accountIds.length === 0}
                    testId="meta-lead-conversions"
                  />
                  {conversions?.overlaps.map((o) => (
                    <p
                      key={o.keys.join("|")}
                      className="flex items-start gap-1 text-xs text-amber-600 dark:text-amber-400"
                      data-testid="text-meta-lead-conversions-overlap"
                    >
                      <IconAlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" />
                      <span>
                        {o.names[0]} and {o.names[1]} report on the same ads {o.both_days_pct}% of the time, so Meta may count the same lead
                        twice. Keep the one your campaigns optimize for.
                      </span>
                    </p>
                  ))}
                  {conversionErrors.length > 0 && (
                    <p className="text-xs text-destructive" data-testid="text-meta-lead-conversions-error">
                      Could not read conversions for {conversionErrors.map((a) => accountName(a.id)).join(", ")}:{" "}
                      {conversionErrors[0]!.error}. Already picked conversions stay picked.
                    </p>
                  )}
                </div>
              </div>

              {testResult && (
                <div className="rounded-md border border-border p-3 space-y-1 text-xs" data-testid="meta-test-result">
                  {testResult.error && <p className="text-destructive">{testResult.error}</p>}
                  {testResult.accounts.map((a) => (
                    <p key={a.id} className={a.ok ? "text-foreground" : "text-destructive"}>
                      {a.ok ? <IconCircleCheck className="inline h-3.5 w-3.5 mr-1 text-chart-3" /> : <IconAlertTriangle className="inline h-3.5 w-3.5 mr-1" />}
                      <span className="font-mono">{a.id}</span> {a.ok ? `— ${a.name} (${a.currency})` : `— ${a.error}`}
                    </p>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={test}
                  disabled={!canEdit || testing || accountIds.length === 0}
                  data-testid="button-meta-test"
                >
                  {testing ? <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <IconPlugConnected className="h-4 w-4 mr-1.5" />}
                  Test connection
                </Button>
              </div>

              <ReadMore testId="button-meta-connection-advanced">
                <p>
                  Key: <code className="font-mono">META_ADS_ACCESS_TOKEN</code> (env only; System User token with <code className="font-mono">ads_read</code>).
                </p>
                <p>
                  Live-ad edits (Fix via Meta) use the same key and also need <code className="font-mono">ads_management</code> on those accounts.
                  Only staff with the <code className="font-mono">ads_edit</code> permission can run them.
                </p>
                <p>
                  Non-secret config: <code className="font-mono">ads-config.yml → meta</code> (per site).
                </p>
                <p>
                  Lead conversions: <code className="font-mono">ads.meta.lead_conversions</code> (max {MAX_META_LEAD_CONVERSIONS}) —{" "}
                  <code className="font-mono">fb_pixel_lead</code> (Meta&apos;s <code className="font-mono">offsite_conversion.fb_pixel_lead</code>) or a
                  custom conversion id (<code className="font-mono">offsite_conversion.custom.&lt;id&gt;</code>). The Meta leads number is the plain
                  sum of the picks, and changing them recalculates every window from cached days. Options come live from Meta for the selected
                  accounts, or from the last sync when Meta can&apos;t be reached.
                </p>
                <p>
                  Cache: <code className="font-mono">{data.policy.cache_dir}</code> · refresh last {data.policy.refresh_days} days · keep{" "}
                  {Math.round(data.policy.retention_days / 30)} months · first connect loads {data.policy.backfill_days} days.
                </p>
                <p>
                  Marketing API {data.api_version}. Syncs automatically every day at 5 AM ET on the live site. If that run is missed, opening a
                  report refreshes data older than ~24h in the background.
                </p>
              </ReadMore>
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="card-meta-sync">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <IconRefresh className="h-4 w-4" />
            Sync
            {refreshActive && <IconLoader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <div className="grid gap-2 sm:grid-cols-3">
            <div>
              <p className="text-xs text-muted-foreground">Meta last synced</p>
              <p className="text-foreground" data-testid="text-meta-last-synced">{fmtWhen(data.sync.last_success_at)}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">History loaded</p>
              <p className="text-foreground">
                {data.sync.history_since ? `${data.sync.history_since} → ${data.sync.history_until}` : "none yet"}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">GA4 paid visits</p>
              <p className="text-foreground">
                {data.ga4.configured ? `last export ${data.ga4.last_export_date ?? "—"}` : "GA4 export not configured"}
              </p>
            </div>
          </div>
          {data.sync.last_error && (
            <p className="text-xs text-destructive" data-testid="text-meta-sync-error">
              Last sync failed{data.sync.consecutive_failures > 1 ? ` (${data.sync.consecutive_failures} times in a row)` : ""}: {data.sync.last_error}
            </p>
          )}
          <p
            className={cn("text-xs", data.sync.backup_error ? "text-destructive" : "text-muted-foreground")}
            data-testid="text-meta-history-backup"
          >
            {data.sync.backup_error
              ? `History backup failed: ${data.sync.backup_error}${data.sync.backup_pushed_at ? ` (last pushed ${fmtWhen(data.sync.backup_pushed_at)})` : ""}`
              : data.sync.backup_pushed_at
                ? `History backup: last pushed ${fmtWhen(data.sync.backup_pushed_at)}`
                : "History backup: not pushed yet. Only the live site saves a copy, after a sync."}
          </p>
          <p className="text-xs text-muted-foreground" data-testid="text-meta-daily-sync">
            The live site syncs automatically every day at 5 AM ET. Opening a report only starts a sync when that run was missed.
          </p>
          {progressPct !== null && data.refresh.progress ? (
            <div className="space-y-1.5" data-testid="meta-refresh-progress">
              <Progress value={progressPct} className="h-2" aria-label="Sync progress" />
              <p className="text-xs text-muted-foreground tabular-nums" data-testid="text-meta-refresh-progress">
                {progressPct}% · {data.refresh.progress.label}
              </p>
            </div>
          ) : refreshCopy && (
            <div className="flex flex-wrap items-center gap-2" data-testid="meta-refresh-status">
              <p
                className={`text-xs ${refreshCopy.tone === "error" ? "text-destructive" : "text-muted-foreground"}`}
                data-testid="text-meta-refresh-status"
              >
                {refreshCopy.message}
              </p>
              {data.refresh.state === "failed" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 px-2 text-xs"
                  onClick={() => sync("refresh")}
                  disabled={!canEdit || syncing !== null}
                  data-testid="button-meta-refresh-try-again"
                >
                  Try again
                </Button>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              onClick={() => sync("refresh")}
              disabled={!canEdit || syncing !== null || refreshActive}
              data-testid="button-meta-sync-now"
            >
              {syncing === "refresh" ? <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <IconRefresh className="h-4 w-4 mr-1.5" />}
              Sync now
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => sync("older")}
              disabled={!canEdit || syncing !== null || refreshActive || !data.sync.history_since}
              data-testid="button-meta-load-older"
            >
              {syncing === "older" ? <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <IconHistory className="h-4 w-4 mr-1.5" />}
              Load older history
            </Button>
            <AdsPullProductionButton variant="button" onDone={() => void refetch()} testIdPrefix="meta-sync" />
          </div>
          <ReadMore testId="button-meta-sync-advanced">
            <p>
              Background job <code className="font-mono">meta_ads_sync</code> runs in the Sidequest worker (locally:{" "}
              <code className="font-mono">npm run sidequest</code>). When the worker is down, Sync now runs the refresh in the web server
              instead; automatic refreshes never do.
            </p>
            <p>
              Daily: <code className="font-mono">ads_daily_sync</code> runs at <code className="font-mono">0 5 * * *</code> America/New_York on the
              live server only and queues <code className="font-mono">ads_sync</code> for each connected site. If the worker was down at 5 AM, it
              catches up when it starts. A failed morning run is not retried automatically; the next report open retries after the wait.
            </p>
            <p>
              A job still waiting after 5 minutes counts as failed. A started sync with no finish after 15 minutes counts as stopped.
            </p>
            <p>After a failure, automatic refreshes wait 1h, then 2h, 4h, and at most 6h. Sync now skips the wait; a successful sync resets it.</p>
            <p>
              State file: <code className="font-mono">.cache/&lt;site&gt;/ads-refresh-state.json</code>. Cached numbers stay visible in every state.
            </p>
            <p>
              History backup: after each sync in production, ad URL versions, campaign name history and the campaign change log are
              pushed to the content repo under <code className="font-mono">&lt;site&gt;/ads-history/</code> (author{" "}
              <code className="font-mono">ads-sync</code>), only when something changed. A server whose cache has no history restores
              it from there before its next sync. Local machines and production downloads never push.
            </p>
          </ReadMore>
        </CardContent>
      </Card>

      <Card data-testid="card-meta-utm-template">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">URL parameters for every ad</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Paste this into each ad under Tracking → URL parameters. It lets us match visits and leads to the exact campaign and ad.
          </p>
          <MetaTrackingParamsStatus coverage={data.tracking_params} />
          <div className="flex gap-2">
            <Input readOnly value={data.utm_template} className="font-mono text-xs" data-testid="input-meta-utm-template" />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(data.utm_template);
                toast({ title: "Copied" });
              }}
              data-testid="button-copy-utm-template"
            >
              <IconCopy className="h-4 w-4" />
            </Button>
          </div>
          {data.tracking_params && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="meta-utm-checked-at">
              <span>Checked at last sync: {fmtWhen(data.tracking_params.checked_at)}</span>
              <AdsResyncButton
                refresh={data.refresh}
                onStarted={() => void refetch()}
                testIdPrefix="meta-utm"
                snapshotPulledAt={!data.token_configured ? (data.sync.pulled_from_production_at ?? undefined) : undefined}
              />
              <AdsPullProductionButton onDone={() => void refetch()} testIdPrefix="meta-utm" />
            </div>
          )}
          <ReadMore testId="button-meta-utm-advanced">
            <p>
              Required on every ad: <code className="font-mono">utm_source</code>, <code className="font-mono">utm_medium</code>,{" "}
              <code className="font-mono">utm_id</code> (campaign id) and <code className="font-mono">utm_content</code> (ad id). They can sit in
              the ad's URL parameters field or in the website URL itself.
            </p>
            <p>
              Only ads with spend in the last 28 days are checked — the same window Diagnostics uses. Instant Form ads and ads without a website
              link are skipped. Paused or new ads are checked once they spend.
            </p>
            <p>
              Ad setups are read by the <code className="font-mono">meta_ads_sync</code> job and saved under{" "}
              <code className="font-mono">.cache/&lt;site&gt;/</code>. Caxton only reads your ads; it never edits them in Meta.
            </p>
          </ReadMore>
        </CardContent>
      </Card>

      <AdsUtmConventionCard view={data.utm_convention} platform="meta" />

      <AdsAlertThresholdsCard
        thresholds={thresholds}
        onThresholdsChange={(next) => {
          setThresholds(next);
          markDirty();
        }}
        floorText={floorText}
        onFloorTextChange={(next) => {
          setFloorText(next);
          markDirty();
        }}
        missingFloors={missingFloors}
        canEdit={canEdit}
      />

      <Card data-testid="card-known-external-campaigns">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">Known external campaigns</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Campaigns you know about that run outside your connected ad accounts, like a partner or agency. Diagnostics still lists them, but as
            info instead of a problem. Their spend is never included.
          </p>
          {knownCampaigns.length === 0 ? (
            <p className="text-xs text-muted-foreground" data-testid="text-known-campaigns-empty">
              None yet. Use Mark as known on a &quot;Campaign we can&apos;t see&quot; issue in Diagnostics, or add a campaign id below.
            </p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border" data-testid="list-known-campaigns">
              {knownCampaigns.map((c) => (
                <li key={c.key} className="flex items-center justify-between gap-3 px-3 py-2 text-sm" data-testid={`known-campaign-${c.key}`}>
                  <div className="min-w-0">
                    <p className="truncate font-mono text-xs text-foreground">{c.key}</p>
                    {c.note && <p className="truncate text-xs text-muted-foreground">{c.note}</p>}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 p-0"
                    aria-label={`Remove ${c.key}`}
                    disabled={!canEdit}
                    onClick={() => {
                      setKnownCampaigns((list) => list.filter((x) => x.key !== c.key));
                      markDirty();
                    }}
                    data-testid={`button-remove-known-campaign-${c.key}`}
                  >
                    <IconX className="h-4 w-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {canEdit && knownCampaigns.length < MAX_KNOWN_EXTERNAL_CAMPAIGNS && (
            <div className="flex flex-col gap-2 sm:flex-row" data-testid="form-add-known-campaign">
              <Input
                value={newKnownKey}
                maxLength={200}
                placeholder="Campaign id or name"
                className="text-xs sm:w-56"
                onChange={(e) => setNewKnownKey(e.target.value)}
                data-testid="input-known-campaign-key"
              />
              <Input
                value={newKnownNote}
                maxLength={200}
                placeholder="Note (optional)"
                className="text-xs"
                onChange={(e) => setNewKnownNote(e.target.value)}
                data-testid="input-known-campaign-note"
              />
              <Button
                type="button"
                size="sm"
                variant="secondary"
                className="shrink-0"
                disabled={!newKnownKey.trim() || isKnownExternalCampaign(knownCampaigns, newKnownKey)}
                onClick={() => {
                  const key = newKnownKey.trim();
                  const note = newKnownNote.trim();
                  setKnownCampaigns((list) => [...list, note ? { key, note } : { key }]);
                  setNewKnownKey("");
                  setNewKnownNote("");
                  markDirty();
                }}
                data-testid="button-add-known-campaign"
              >
                <IconPlus className="h-4 w-4 mr-1.5" />
                Add
              </Button>
            </div>
          )}
          <ReadMore testId="button-known-campaigns-advanced">
            <p>
              Stored in <code className="font-mono">ads-config.yml → meta.known_external_campaigns</code> (max {MAX_KNOWN_EXTERNAL_CAMPAIGNS}).
              Matching is by campaign id, or by campaign name ignoring case.
            </p>
            <p>Removing an entry flags the campaign again on the next Diagnostics load if it still sends visitors.</p>
          </ReadMore>
        </CardContent>
      </Card>

      <Card data-testid="card-test-leads">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <IconFlask className="h-4 w-4" />
            Test leads
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Leads from these emails (and from logged-in staff) are still sent to your CRM, but marked as tests and left out of reports.
          </p>
          <Textarea
            rows={3}
            placeholder={"*@4geeks-test.com\nqa+*@example.com"}
            value={patternsText}
            disabled={!canEdit}
            onChange={(e) => {
              setPatternsText(e.target.value);
              markDirty();
            }}
            data-testid="input-test-email-patterns"
          />
          <p className="text-xs text-muted-foreground">One pattern per line; * matches anything. Emails are never stored by us.</p>
        </CardContent>
      </Card>

      <div
        className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-lg"
        data-testid="ads-meta-save-bar"
      >
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-end gap-3">
          <p
            className={cn("text-xs min-w-0 truncate text-right", dirty ? "text-destructive" : "text-muted-foreground")}
            data-testid="text-ads-meta-save-status"
          >
            {saving ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"}
          </p>
          <Button
            size="sm"
            className="gap-1.5 shrink-0"
            onClick={save}
            disabled={!canEdit || !dirty || saving}
            data-testid="button-meta-save"
          >
            {saving ? (
              <IconLoader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <IconDeviceFloppy className="h-3.5 w-3.5" aria-hidden />
            )}
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
