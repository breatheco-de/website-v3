import { useEffect, useState } from "react";
import {
  IconChevronDown,
  IconDatabase,
  IconDeviceFloppy,
  IconLoader2,
  IconPlugConnected,
  IconToggleLeft,
  IconToggleRight,
} from "@tabler/icons-react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { apiFetch, apiRequest } from "@/lib/queryClient";

type GscBigQueryConfigResponse = {
  configured: boolean;
  enabled: boolean;
  settings: {
    enabled: boolean;
    project_id: string;
    dataset_id: string;
    location: string;
    url_impression_table: string;
    export_log_table: string;
  };
  credentials_hint: string;
  credentials_source?: string;
  warnings: string[];
};

export function SearchConsoleBigQueryCard({ canEdit }: { canEdit: boolean }) {
  const { toast } = useToast();
  const [enabled, setEnabled] = useState(false);
  const [projectId, setProjectId] = useState("");
  const [datasetId, setDatasetId] = useState("");
  const [location, setLocation] = useState("US");
  const [urlImpressionTable, setUrlImpressionTable] = useState("searchdata_url_impression");
  const [exportLogTable, setExportLogTable] = useState("ExportLog");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [credentialsHint, setCredentialsHint] = useState("");
  const [credentialsSource, setCredentialsSource] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ["/api/settings/search-console/bigquery"],
    queryFn: async () => {
      const res = await apiFetch("/api/settings/search-console/bigquery");
      if (!res.ok) throw new Error("Failed to load Search Console BigQuery settings");
      return res.json() as Promise<GscBigQueryConfigResponse>;
    },
  });

  useEffect(() => {
    if (!data?.settings || dirty) return;
    setEnabled(data.settings.enabled);
    setProjectId(data.settings.project_id || "");
    setDatasetId(data.settings.dataset_id || "");
    setLocation(data.settings.location || "US");
    setUrlImpressionTable(data.settings.url_impression_table || "searchdata_url_impression");
    setExportLogTable(data.settings.export_log_table || "ExportLog");
    setCredentialsHint(data.credentials_hint || "");
    setCredentialsSource(data.credentials_source || "");
    setWarnings(data.warnings || []);
  }, [data, dirty]);

  async function save() {
    setSaving(true);
    try {
      await apiRequest("PUT", "/api/settings/search-console/bigquery", {
        enabled,
        project_id: projectId.trim(),
        dataset_id: datasetId.trim(),
        location: location.trim() || "US",
        url_impression_table: urlImpressionTable.trim() || "searchdata_url_impression",
        export_log_table: exportLogTable.trim() || "ExportLog",
      });
      setDirty(false);
      await refetch();
      toast({ title: "Search Console BigQuery settings saved" });
    } catch (err: unknown) {
      toast({
        title: "Failed to save",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    try {
      const res = await apiFetch("/api/settings/search-console/bigquery/test", { method: "POST" });
      const body = await res.json();
      const sourceLabel = body.credentials_source ? ` · creds: ${body.credentials_source}` : "";
      if (!res.ok || !body.ok) {
        toast({
          title: "Connection failed",
          description: `${body.error || `HTTP ${res.status}`}${sourceLabel}`,
          variant: "destructive",
        });
      } else {
        toast({
          title: "Connection OK",
          description: body.latest_data_date
            ? `Latest data date: ${body.latest_data_date} (${body.table_count} tables)${sourceLabel}`
            : `Dataset reachable${sourceLabel}`,
        });
      }
    } catch (err: unknown) {
      toast({
        title: "Connection failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <Card data-testid="card-gsc-bigquery-settings">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
        <div className="flex items-center gap-2">
          <IconDatabase className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">Search Console BigQuery export</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <p className="text-sm font-medium">What this does</p>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Tell the platform where Google drops daily Search Console performance data in BigQuery.
                Turning this on here does not start the Google export — you still enable bulk data export
                in Search Console. Saving only updates{" "}
                <code className="font-mono text-xs">settings.yml</code>. Test connection confirms this
                app can read that dataset for upcoming keyword reports; it does not affect URL Inspection.
              </p>
            </div>

            <div className="flex items-center justify-between gap-3 pt-2 border-t">
              <div className="space-y-0.5">
                <p className="text-sm font-medium">Enable BigQuery read access</p>
                <p className="text-xs text-muted-foreground">
                  When off, the app will not query the Search Console export dataset.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setEnabled((v) => !v);
                  setDirty(true);
                }}
                disabled={!canEdit}
                className="shrink-0 text-muted-foreground disabled:opacity-50"
                data-testid="toggle-gsc-bq-enabled"
                aria-label={enabled ? "Disable Search Console BigQuery" : "Enable Search Console BigQuery"}
              >
                {enabled ? (
                  <IconToggleRight className="h-8 w-8 text-primary" />
                ) : (
                  <IconToggleLeft className="h-8 w-8" />
                )}
              </button>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="gsc-bq-project">
                  Project ID
                </label>
                <Input
                  id="gsc-bq-project"
                  value={projectId}
                  onChange={(e) => {
                    setProjectId(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="my-gcp-project"
                  disabled={!canEdit}
                  data-testid="input-gsc-bq-project"
                />
              </div>
              <div className="space-y-1.5">
                <label className="text-sm font-medium" htmlFor="gsc-bq-dataset">
                  Dataset ID
                </label>
                <Input
                  id="gsc-bq-dataset"
                  value={datasetId}
                  onChange={(e) => {
                    setDatasetId(e.target.value);
                    setDirty(true);
                  }}
                  placeholder="searchconsole"
                  disabled={!canEdit}
                  data-testid="input-gsc-bq-dataset"
                />
              </div>
            </div>

            {warnings.length > 0 && (
              <ul className="text-xs text-amber-600 dark:text-amber-400 space-y-1 list-disc pl-4">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            )}

            <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex items-center gap-2 text-sm font-medium text-foreground"
                  data-testid="button-gsc-bq-advanced"
                >
                  Read more (advanced)
                  <IconChevronDown
                    className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`}
                  />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent className="mt-3 space-y-3 text-sm text-muted-foreground">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground" htmlFor="gsc-bq-location">
                      Location
                    </label>
                    <Input
                      id="gsc-bq-location"
                      value={location}
                      onChange={(e) => {
                        setLocation(e.target.value);
                        setDirty(true);
                      }}
                      placeholder="US"
                      disabled={!canEdit}
                      data-testid="input-gsc-bq-location"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground" htmlFor="gsc-bq-url-table">
                      URL impression table
                    </label>
                    <Input
                      id="gsc-bq-url-table"
                      value={urlImpressionTable}
                      onChange={(e) => {
                        setUrlImpressionTable(e.target.value);
                        setDirty(true);
                      }}
                      placeholder="searchdata_url_impression"
                      disabled={!canEdit}
                      data-testid="input-gsc-bq-url-table"
                    />
                  </div>
                  <div className="space-y-1.5 sm:col-span-2">
                    <label className="text-sm font-medium text-foreground" htmlFor="gsc-bq-export-log">
                      Export log table
                    </label>
                    <Input
                      id="gsc-bq-export-log"
                      value={exportLogTable}
                      onChange={(e) => {
                        setExportLogTable(e.target.value);
                        setDirty(true);
                      }}
                      placeholder="ExportLog"
                      disabled={!canEdit}
                      data-testid="input-gsc-bq-export-log"
                    />
                  </div>
                </div>
                <p>{credentialsHint}</p>
                {credentialsSource ? (
                  <p className="text-xs">
                    Active credentials source:{" "}
                    <span className="font-mono text-foreground">{credentialsSource}</span>
                  </p>
                ) : null}
                <p>
                  Bulk export is configured in Search Console → Settings → Bulk data export. Grant{" "}
                  <code className="font-mono text-xs">search-console-data-export@system.gserviceaccount.com</code>{" "}
                  BigQuery Job User + Data Editor on your GCP project. Your app service account (from env)
                  needs read access on the dataset.
                </p>
                <p className="font-mono text-xs">settings.yml → search_console.bigquery</p>
                <p className="text-xs">
                  GA4 export is separate — configure at{" "}
                  <Link href="/private/tracking/ga4" className="underline underline-offset-2 text-foreground">
                    Tracking → GA4
                  </Link>
                  . Data lag is typically 2–3 days; export is daily grain only.
                </p>
              </CollapsibleContent>
            </Collapsible>

            <div className="flex flex-wrap items-center gap-2 pt-2 border-t">
              <Button
                type="button"
                onClick={() => void save()}
                disabled={!canEdit || !dirty || saving}
                data-testid="button-gsc-bq-save"
              >
                {saving ? (
                  <IconLoader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <IconDeviceFloppy className="h-4 w-4 mr-1.5" />
                )}
                Save
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void testConnection()}
                disabled={testing || !enabled || !projectId.trim() || !datasetId.trim()}
                data-testid="button-gsc-bq-test"
              >
                {testing ? (
                  <IconLoader2 className="h-4 w-4 animate-spin mr-1.5" />
                ) : (
                  <IconPlugConnected className="h-4 w-4 mr-1.5" />
                )}
                Test connection
              </Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
