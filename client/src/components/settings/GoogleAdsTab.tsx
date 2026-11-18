import { useEffect, useMemo, useState } from "react";
import {
  IconAlertTriangle,
  IconBrandGoogle,
  IconChevronDown,
  IconCircleCheck,
  IconCopy,
  IconDeviceFloppy,
  IconInfoCircle,
  IconLoader2,
  IconPlugConnected,
  IconRefresh,
  IconTarget,
  IconToggleLeft,
  IconToggleRight,
} from "@tabler/icons-react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import { SearchableMultiCombobox, type SearchableMultiComboboxOption } from "@/components/ui/searchable-multi-combobox";
import { useSettingsDirty } from "@/components/settings/SettingsShell";
import {
  AccountLocationsCard,
  AccountLocationsConfirmDialog,
  type AccountLocationsAffected,
} from "@/components/settings/AccountLocationsCard";
import { GoogleAdsSetupGuide } from "@/components/settings/GoogleAdsSetupGuide";
import { useToast } from "@/hooks/use-toast";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import { apiFetch, apiRequest } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import type { AccountLocationsMap } from "@shared/adsAccountLocations";
import { formatGoogleCustomerId, normalizeGoogleCustomerId, type GoogleAdsSettings } from "@shared/ads-settings";
import type { AdsUtmConventionView } from "@/components/ads/ads-types";
import { AdsUtmConventionCard } from "@/components/ads/AdsUtmConvention";
import { isRefreshActive, refreshProgressPercent, refreshStatusCopy, type AdsRefreshStatus } from "@shared/ads-refresh-status";

type CustomerSync = {
  name?: string | null;
  currency?: string | null;
  auto_tagging?: boolean | null;
  data_through?: string | null;
  history_loaded_at?: string;
  missing_tables?: string[];
  sync_error?: string;
};

type ConversionAction = { customer_id: string; id: string | null; name: string; category: string | null; conversions_30d: number; counted_as_lead: boolean };

type GoogleSettingsResponse = {
  google: GoogleAdsSettings;
  configured: boolean;
  credentials_source: "gcs_json" | "gcs_key_file" | "adc" | "none";
  url_suffix_template: string;
  utm_convention?: AdsUtmConventionView;
  refreshing: boolean;
  refresh: AdsRefreshStatus;
  sync: {
    last_success_at: string | null;
    last_attempt_at: string | null;
    last_error: string | null;
    consecutive_failures: number;
    data_through: string | null;
    expected_through: string;
    history_since: string | null;
    history_until: string | null;
    customers: Record<string, CustomerSync>;
    available_customers: string[];
    unticked_customers: string[];
    manager_customers?: Record<string, string[]>;
  };
  conversion_actions: ConversionAction[];
  policy: { refresh_days: number; conversion_refresh_days: number; backfill_days: number; retention_days: number; transfer_lag_days: number; cache_dir: string };
};

type TransferCustomer = {
  id: string;
  name: string | null;
  currency: string | null;
  data_through: string | null;
  missing_tables: string[];
  manager_id?: string | null;
};
type TestResponse = {
  ok: boolean;
  error?: string;
  customers: TransferCustomer[];
  managers?: Record<string, string[]>;
  missing_customers?: string[];
  ticked_managers?: string[];
};
type AccountsResponse = { configured: boolean; accounts: TransferCustomer[]; managers?: Record<string, string[]>; error?: string };

function fmtWhen(iso: string | null): string {
  if (!iso) return "never";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
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

export function GoogleAdsTab() {
  const { hasCapability } = useDebugAuth();
  const canEdit = hasCapability("ads_settings");
  const { toast } = useToast();

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/settings/ads/google"],
    queryFn: async () => {
      const res = await apiFetch("/api/settings/ads/google");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to load Google Ads settings");
      return res.json() as Promise<GoogleSettingsResponse>;
    },
    refetchInterval: (q) => {
      const state = (q.state.data as GoogleSettingsResponse | undefined)?.refresh?.state;
      return state === "running" ? 3000 : state === "queued" ? 5000 : false;
    },
  });

  const savedDataset = data?.google.bigquery;
  const { data: accountList, isLoading: accountsLoading } = useQuery({
    queryKey: ["/api/settings/ads/google/accounts", savedDataset?.project, savedDataset?.dataset],
    queryFn: async () => {
      const res = await apiFetch("/api/settings/ads/google/accounts");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Failed to list accounts");
      return res.json() as Promise<AccountsResponse>;
    },
    enabled: !!savedDataset?.project && !!savedDataset?.dataset,
    staleTime: 5 * 60 * 1000,
  });

  const [enabled, setEnabled] = useState(false);
  const [project, setProject] = useState("");
  const [dataset, setDataset] = useState("");
  const [customerIds, setCustomerIds] = useState<string[]>([]);
  const [accountLocations, setAccountLocations] = useState<AccountLocationsMap>({});
  const [leadActions, setLeadActions] = useState<string[]>([]);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [testResult, setTestResult] = useState<TestResponse | null>(null);
  const [confirmAffected, setConfirmAffected] = useState<AccountLocationsAffected[] | null>(null);
  useSettingsDirty(dirty);

  useEffect(() => {
    if (!data || dirty) return;
    setEnabled(data.google.enabled);
    setProject(data.google.bigquery.project ?? "");
    setDataset(data.google.bigquery.dataset ?? "");
    setCustomerIds(data.google.customer_ids);
    setAccountLocations(data.google.account_locations ?? {});
    setLeadActions(data.google.lead_conversion_actions);
  }, [data, dirty]);

  const managers = useMemo<Record<string, string[]>>(
    () => (testResult?.ok ? testResult.managers : accountList?.managers) ?? data?.sync.manager_customers ?? {},
    [accountList, testResult, data],
  );

  const customerOptions = useMemo<SearchableMultiComboboxOption[]>(() => {
    const listed = testResult?.ok ? testResult.customers : (accountList?.accounts ?? []);
    const options: SearchableMultiComboboxOption[] = listed.map((c) => ({
      value: c.id,
      label: [c.name || formatGoogleCustomerId(c.id), c.currency, c.data_through ? `data through ${c.data_through}` : "no data yet"].filter(Boolean).join(" · "),
    }));
    const listedIds = new Set(listed.map((c) => c.id));
    for (const id of customerIds) {
      if (listedIds.has(id)) continue;
      options.push({
        value: id,
        label: managers[id]
          ? `${formatGoogleCustomerId(id)} · manager account, no spend of its own`
          : `${data?.sync.customers[id]?.name || formatGoogleCustomerId(id)} · not in the transfer dataset`,
      });
    }
    return options;
  }, [accountList, testResult, customerIds, data, managers]);

  const accountName = (id: string) =>
    (testResult?.ok ? testResult.customers : (accountList?.accounts ?? [])).find((c) => c.id === id)?.name || formatGoogleCustomerId(id);
  const tickedManagers = customerIds.filter((id) => !!managers[id]);

  const actionOptions = useMemo<SearchableMultiComboboxOption[]>(() => {
    const seen = new Set<string>();
    const options: SearchableMultiComboboxOption[] = [];
    for (const a of data?.conversion_actions ?? []) {
      if ((a.category ?? "").toUpperCase() === "SUBMIT_LEAD_FORM" || seen.has(a.name.toLowerCase())) continue;
      seen.add(a.name.toLowerCase());
      options.push({ value: a.name, label: `${a.name} · ${(a.category ?? "other").toLowerCase().replace(/_/g, " ")} · ${a.conversions_30d} in 30 days` });
    }
    for (const name of leadActions) if (!seen.has(name.toLowerCase())) options.push({ value: name, label: `${name} · not seen in the last 30 days` });
    return options;
  }, [data, leadActions]);

  async function save(opts?: { confirmAccountLocations?: boolean }) {
    setSaving(true);
    try {
      const payload = {
        enabled,
        customer_ids: customerIds,
        account_locations: accountLocations,
        confirm_account_locations: opts?.confirmAccountLocations === true,
        bigquery: { project: project.trim() || null, dataset: dataset.trim() || null },
        lead_conversion_actions: leadActions,
      };
      const res = await apiFetch("/api/settings/ads/google", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = (await res.json().catch(() => ({}))) as GoogleSettingsResponse & {
        sync_requested?: boolean;
        error?: string;
        message?: string;
        affected?: AccountLocationsAffected[];
      };
      if (res.status === 409 && body.error === "confirm_account_locations_required") {
        setConfirmAffected(body.affected ?? []);
        return;
      }
      if (!res.ok) throw new Error(body.message || body.error || "Failed to save Google Ads settings");
      setConfirmAffected(null);
      setDirty(false);
      toast({
        title: "Google Ads settings saved",
        description: body.sync_requested ? `Loading the last ${body.policy.backfill_days} days from the BigQuery transfer in the background.` : undefined,
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
      const res = await apiRequest("POST", "/api/settings/ads/google/test", { project: project.trim(), dataset: dataset.trim(), customer_ids: customerIds });
      const body = (await res.json()) as TestResponse;
      setTestResult(body);
      const missing = body.missing_customers ?? [];
      const tickedMgrs = body.ticked_managers ?? [];
      const problems = missing.length + tickedMgrs.length;
      toast({
        title: body.ok ? (problems > 0 ? "Transfer found, some ticked accounts can't be read" : "Transfer found") : "Test failed",
        description: body.ok
          ? `${body.customers.length} account(s) in the dataset.${missing.length > 0 ? ` Not in the transfer: ${missing.map(formatGoogleCustomerId).join(", ")}.` : ""}${
              tickedMgrs.length > 0 ? ` Manager account (tick the accounts under it): ${tickedMgrs.map(formatGoogleCustomerId).join(", ")}.` : ""
            }`
          : body.error,
        variant: body.ok && problems === 0 ? undefined : "destructive",
      });
    } catch (err) {
      toast({ title: "Test failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setTesting(false);
    }
  }

  async function sync() {
    setSyncing(true);
    try {
      const res = await apiRequest("POST", "/api/ads/sync", {});
      const body = (await res.json()) as { refresh?: AdsRefreshStatus };
      const state = body.refresh?.state;
      if (state === "failed" || state === "worker_down") {
        toast({ title: "Sync didn't start", description: refreshStatusCopy(body.refresh, "settings")?.message, variant: "destructive" });
      } else {
        toast({ title: "Sync started", description: state === "queued" ? "Queued for the background worker." : "This runs in the background." });
      }
      await refetch();
    } catch (err) {
      toast({ title: "Sync failed to start", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setSyncing(false);
    }
  }

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <IconLoader2 className="h-5 w-5 animate-spin mr-2" />
        Loading Google Ads settings…
      </div>
    );
  }

  const markDirty = () => setDirty(true);
  const refreshActive = isRefreshActive(data.refresh);
  const refreshCopy = refreshStatusCopy(data.refresh, "settings");
  const progressPct = data.refresh.state === "running" ? refreshProgressPercent(data.refresh.progress) : null;
  const datasetSet = !!project.trim() && !!dataset.trim();
  const through = data.sync.data_through;
  const overdue = !!through && through < data.sync.expected_through;
  const autoTaggingOff = customerIds.filter((id) => data.sync.customers[id]?.auto_tagging === false);

  return (
    <div className="space-y-4" data-testid="tab-panel-ads-google">
      <Card data-testid="card-google-connection">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <IconBrandGoogle className="h-4 w-4" />
            Google Ads connection
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Google Ads spend and leads reach us through a daily copy Google makes into BigQuery. Connecting only reads that copy — nothing changes in
            Google Ads.
          </p>

          <div className="flex items-center justify-between gap-3" data-testid="google-connection-status">
            <div>
              <p className="text-sm font-medium text-foreground">Use Google Ads data</p>
              <p className="text-xs text-muted-foreground">
                {data.configured ? (
                  <span className="text-chart-3">Connected</span>
                ) : (
                  "Not connected yet — set the dataset, pick accounts and save."
                )}
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
              data-testid="button-google-enabled"
            >
              {enabled ? <IconToggleRight className="h-5 w-5 text-chart-3" /> : <IconToggleLeft className="h-5 w-5 text-muted-foreground" />}
            </Button>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">Google Cloud project</p>
              <Input
                value={project}
                placeholder="my-gcp-project"
                disabled={!canEdit}
                onChange={(e) => {
                  setProject(e.target.value);
                  markDirty();
                }}
                className="font-mono text-xs"
                data-testid="input-google-bq-project"
              />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-foreground">BigQuery dataset</p>
              <Input
                value={dataset}
                placeholder="google_ads"
                disabled={!canEdit}
                onChange={(e) => {
                  setDataset(e.target.value);
                  markDirty();
                }}
                className="font-mono text-xs"
                data-testid="input-google-bq-dataset"
              />
            </div>
          </div>

          <GoogleAdsSetupGuide
            project={project}
            dataset={dataset}
            canEdit={canEdit}
            defaultOpen={!data.configured}
            onUse={(v) => {
              setProject(v.project);
              setDataset(v.dataset);
              setCustomerIds((prev) => Array.from(new Set([...prev, ...v.customerIds])));
              setEnabled(true);
              markDirty();
            }}
          />

          <div className="space-y-1.5" data-testid="field-google-customer-ids">
            <p className="text-sm font-medium text-foreground">Accounts</p>
            <p className="text-xs text-muted-foreground">Pick the Google Ads accounts this site reports on. The list shows accounts found in the dataset.</p>
            <SearchableMultiCombobox
              values={customerIds}
              onChange={(next) => {
                setCustomerIds(Array.from(new Set(next.map((v) => normalizeGoogleCustomerId(v)).filter((v): v is string => !!v))));
                markDirty();
              }}
              options={customerOptions}
              placeholder={datasetSet ? "Select accounts…" : "Set the dataset first"}
              searchPlaceholder="Search by name or id…"
              emptyMessage={datasetSet ? "No accounts found — press Test connection" : "Set the dataset first"}
              isLoading={accountsLoading}
              disabled={!canEdit}
              testId="google-customer-ids"
            />
            {accountList?.error && (
              <p className="text-xs text-destructive" data-testid="text-google-accounts-error">
                Could not read the dataset: {accountList.error}
              </p>
            )}
          </div>

          {tickedManagers.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 p-3 text-xs text-foreground" data-testid="google-manager-ticked-banner">
              <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <div className="space-y-1">
                {tickedManagers.map((id) => (
                  <p key={id}>
                    {formatGoogleCustomerId(id)} is the manager account the transfer runs on, so it has no spend of its own. Untick it and tick the
                    accounts this site reports on: {managers[id]!.map(accountName).join(", ")}.
                  </p>
                ))}
              </div>
            </div>
          )}

          {data.sync.unticked_customers.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-border p-3 text-xs text-muted-foreground" data-testid="google-unticked-banner">
              <IconInfoCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                The transfer also copies {data.sync.unticked_customers.map(formatGoogleCustomerId).join(", ")}. Their spend isn&apos;t counted here
                until you tick them above.
              </p>
            </div>
          )}

          {autoTaggingOff.length > 0 && (
            <div className="flex items-start gap-2 rounded-md border border-destructive/40 p-3 text-xs text-foreground" data-testid="google-auto-tagging-banner">
              <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <p>
                Auto-tagging is off in {autoTaggingOff.map(formatGoogleCustomerId).join(", ")}, so visits can&apos;t be tied to campaigns. Turn it on in
                Google Ads → Admin → Account settings → Auto-tagging, or add the URL suffix below.
              </p>
            </div>
          )}

          {testResult && (
            <div className="rounded-md border border-border p-3 space-y-1 text-xs" data-testid="google-test-result">
              {testResult.error && <p className="text-destructive">{testResult.error}</p>}
              {testResult.customers.map((c) => (
                <p key={c.id} className={c.missing_tables.length === 0 ? "text-foreground" : "text-destructive"}>
                  {c.missing_tables.length === 0 ? (
                    <IconCircleCheck className="inline h-3.5 w-3.5 mr-1 text-chart-3" />
                  ) : (
                    <IconAlertTriangle className="inline h-3.5 w-3.5 mr-1" />
                  )}
                  <span className="font-mono">{formatGoogleCustomerId(c.id)}</span> — {c.name ?? "unnamed"}
                  {c.currency ? ` (${c.currency})` : ""} · {c.data_through ? `data through ${c.data_through}` : "no data yet"}
                  {c.missing_tables.length > 0 ? ` · missing ${c.missing_tables.join(", ")}` : ""}
                </p>
              ))}
              {(testResult.ticked_managers ?? []).map((id) => (
                <p key={id} className="text-destructive">
                  <IconAlertTriangle className="inline h-3.5 w-3.5 mr-1" />
                  <span className="font-mono">{formatGoogleCustomerId(id)}</span> — manager account. Tick the accounts under it instead.
                </p>
              ))}
              {(testResult.missing_customers ?? []).map((id) => (
                <p key={id} className="text-destructive">
                  <IconAlertTriangle className="inline h-3.5 w-3.5 mr-1" />
                  <span className="font-mono">{formatGoogleCustomerId(id)}</span> — not in this transfer. Add it to the transfer in Google Cloud.
                </p>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={test} disabled={!canEdit || testing || !datasetSet} data-testid="button-google-test">
              {testing ? <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <IconPlugConnected className="h-4 w-4 mr-1.5" />}
              Test connection
            </Button>
          </div>

          <ReadMore testId="button-google-connection-advanced">
            <p>
              Reads the Google Ads → BigQuery Data Transfer tables (<code className="font-mono">ads_CampaignBasicStats_&lt;id&gt;</code>,{" "}
              <code className="font-mono">ads_LandingPageStats_&lt;id&gt;</code>, <code className="font-mono">ads_CampaignConversionStats_&lt;id&gt;</code>,{" "}
              <code className="font-mono">ads_Campaign_&lt;id&gt;</code>, <code className="font-mono">ads_Customer_&lt;id&gt;</code>,{" "}
              <code className="font-mono">ads_ClickStats_&lt;id&gt;</code>). Table and column names are detected each sync.
            </p>
            <p>
              A transfer on a manager account names every table after the manager but stores each account&apos;s rows inside them. Accounts are
              listed from the <code className="font-mono">customer_id</code> column and every query filters by it, so ticked accounts never mix.
            </p>
            <p>
              Credentials: the same service account as GA4 BigQuery (<code className="font-mono">GCS_CREDENTIALS_JSON</code> /{" "}
              <code className="font-mono">GCS_KEY_FILENAME</code>, else Application Default Credentials; now:{" "}
              <code className="font-mono">{data.credentials_source}</code>). It needs BigQuery Data Viewer on the dataset and Job User on the project.
            </p>
            <p>
              Non-secret config: <code className="font-mono">ads-config.yml → google</code>. Cache: <code className="font-mono">{data.policy.cache_dir}</code>.
            </p>
            <p>
              Matching visits: GA4&apos;s Google Ads link first, then the visit&apos;s gclid joined to <code className="font-mono">ClickStats</code> inside
              BigQuery (the GA4 and Ads datasets must share a location), then the URL suffix below. Click ids are never stored here.
            </p>
          </ReadMore>
        </CardContent>
      </Card>

      <AccountLocationsCard
        platform="google"
        accounts={customerIds.map((id) => ({
          id,
          label:
            (testResult?.ok ? testResult.customers : (accountList?.accounts ?? [])).find((c) => c.id === id)?.name ||
            data.sync.customers[id]?.name ||
            formatGoogleCustomerId(id),
        }))}
        value={accountLocations}
        onChange={(next) => {
          setAccountLocations(next);
          markDirty();
        }}
        disabled={!canEdit}
      />
      <AccountLocationsConfirmDialog
        open={confirmAffected !== null}
        affected={confirmAffected ?? []}
        confirming={saving}
        onCancel={() => setConfirmAffected(null)}
        onConfirm={() => void save({ confirmAccountLocations: true })}
      />

      <Card data-testid="card-google-sync">
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
              <p className="text-xs text-muted-foreground">Last synced</p>
              <p className="text-foreground" data-testid="text-google-last-synced">
                {fmtWhen(data.sync.last_success_at)}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Google data through</p>
              <p className={cn("text-foreground", overdue && "text-destructive")} data-testid="text-google-data-through">
                {through ?? "no data yet"}
                {overdue ? " (transfer is late)" : ""}
              </p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">History loaded</p>
              <p className="text-foreground">{data.sync.history_since ? `${data.sync.history_since} → ${data.sync.history_until}` : "none yet"}</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Google copies each day into BigQuery with a delay, so the newest 1–2 days show up later. They aren&apos;t counted as missing until overdue.
          </p>
          {customerIds.map((id) => data.sync.customers[id]?.sync_error).some(Boolean) && (
            <div className="space-y-1" data-testid="google-account-errors">
              {customerIds
                .filter((id) => data.sync.customers[id]?.sync_error)
                .map((id) => (
                  <p key={id} className="text-xs text-destructive">
                    <span className="font-mono">{formatGoogleCustomerId(id)}</span>: {data.sync.customers[id]!.sync_error}
                  </p>
                ))}
            </div>
          )}
          {data.sync.last_error && (
            <p className="text-xs text-destructive" data-testid="text-google-sync-error">
              Last sync failed{data.sync.consecutive_failures > 1 ? ` (${data.sync.consecutive_failures} times in a row)` : ""}: {data.sync.last_error}
            </p>
          )}
          {progressPct !== null && data.refresh.progress ? (
            <div className="space-y-1.5" data-testid="google-refresh-progress">
              <Progress value={progressPct} className="h-2" aria-label="Sync progress" />
              <p className="text-xs text-muted-foreground tabular-nums">
                {progressPct}% · {data.refresh.progress.label}
              </p>
            </div>
          ) : (
            refreshCopy && (
              <p className={`text-xs ${refreshCopy.tone === "error" ? "text-destructive" : "text-muted-foreground"}`} data-testid="text-google-refresh-status">
                {refreshCopy.message}
              </p>
            )
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={sync} disabled={!canEdit || syncing || refreshActive || !data.configured} data-testid="button-google-sync-now">
              {syncing ? <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <IconRefresh className="h-4 w-4 mr-1.5" />}
              Sync now
            </Button>
          </div>
          <ReadMore testId="button-google-sync-advanced">
            <p>
              One background job (<code className="font-mono">ads_sync</code>) refreshes Meta, then Google Ads, then GA4 paid visits. Sync now here and
              on the Meta tab start the same job.
            </p>
            <p>
              Each sync re-reads spend and clicks for the last {data.policy.refresh_days} loaded days and conversions for the last{" "}
              {data.policy.conversion_refresh_days} (Google keeps updating them), plus any day BigQuery reloaded (backfills). First connect loads{" "}
              {data.policy.backfill_days} days; history is kept about {Math.round(data.policy.retention_days / 30)} months.
            </p>
          </ReadMore>
        </CardContent>
      </Card>

      <Card data-testid="card-google-leads">
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <IconTarget className="h-4 w-4" />
            Google-reported leads
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Which Google conversions count as leads in reports. They&apos;re shown next to our own lead count, never added to it or to Meta leads.
          </p>
          <p className="text-xs text-muted-foreground">
            Conversions in the <span className="text-foreground">Submit lead form</span> category always count. Add others here (for example a
            &quot;Book a call&quot; action).
          </p>
          <SearchableMultiCombobox
            values={leadActions}
            onChange={(next) => {
              setLeadActions(next);
              markDirty();
            }}
            options={actionOptions}
            placeholder={actionOptions.length > 0 ? "Add conversion actions…" : "No other conversion actions seen yet"}
            searchPlaceholder="Search conversion actions…"
            emptyMessage="No conversion actions match"
            disabled={!canEdit}
            testId="google-lead-actions"
          />
          <ReadMore testId="button-google-leads-advanced">
            <p>
              Stored in <code className="font-mono">ads-config.yml → google.lead_conversion_actions</code> (names or numeric ids). The list comes from{" "}
              <code className="font-mono">CampaignConversionStats</code> over the last 30 loaded days.
            </p>
            <p>Google reports conversions per campaign per day; they&apos;re spread over that campaign&apos;s landing pages by clicks.</p>
          </ReadMore>
        </CardContent>
      </Card>

      <Card data-testid="card-google-url-suffix">
        <CardHeader className="pb-3">
          <CardTitle className="text-base">URL suffix (fallback)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Only needed when GA4 isn&apos;t linked to Google Ads. Paste it in Google Ads → Admin → Account settings → Tracking → Final URL suffix.
          </p>
          <div className="flex gap-2">
            <Input readOnly value={data.url_suffix_template} className="font-mono text-xs" data-testid="input-google-url-suffix" />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(data.url_suffix_template);
                toast({ title: "Copied" });
              }}
              data-testid="button-copy-google-url-suffix"
            >
              <IconCopy className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">Alert thresholds are shared with Meta; edit them on the Meta tab.</p>
        </CardContent>
      </Card>

      <AdsUtmConventionCard view={data.utm_convention} platform="google" />

      <div
        className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-lg"
        data-testid="ads-google-save-bar"
      >
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-end gap-3">
          <p className={cn("text-xs min-w-0 truncate text-right", dirty ? "text-destructive" : "text-muted-foreground")} data-testid="text-ads-google-save-status">
            {saving ? "Saving…" : dirty ? "Unsaved changes" : "All changes saved"}
          </p>
          <Button size="sm" className="gap-1.5 shrink-0" onClick={() => void save()} disabled={!canEdit || !dirty || saving} data-testid="button-google-save">
            {saving ? <IconLoader2 className="h-3.5 w-3.5 animate-spin" aria-hidden /> : <IconDeviceFloppy className="h-3.5 w-3.5" aria-hidden />}
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
