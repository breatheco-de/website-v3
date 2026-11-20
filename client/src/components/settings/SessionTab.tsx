import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconArrowRight,
  IconCheck,
  IconInfoCircle,
  IconLoader2,
  IconWorld,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ToggleButtonBar, ToggleButtonBarTrigger } from "@/components/ui/toggle-button-bar";
import { SessionExampleJson } from "@/components/settings/SessionExampleJson";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type SessionSettingsResponse = {
  location: {
    database: string | null;
    fill_from_ip: boolean;
  };
  available_databases: string[];
  /** Slugs that have latitude/longitude (or lat/lon) and can be used for matching. */
  location_geo_ok_databases?: string[];
  /** Slug → error when the DB lacks latitude/longitude (or lat/lon) fields. */
  location_database_errors?: Record<string, string>;
};

const LOCATION_GEO_ERROR_FALLBACK =
  "This database cannot be used for location matching — it needs latitude and longitude fields (or lat / lon).";

const NONE_VALUE = "__none__";

type SystemFieldRow = {
  key: string;
  editable?: boolean;
  sourceLabel?: string;
  /** Short help under the source control (non-editable rows). */
  helpText?: ReactNode;
};

const SYSTEM_FIELD_ROWS: SystemFieldRow[] = [
  { key: "location", editable: true },
  {
    key: "geo",
    sourceLabel: "Always from visitor IP",
    helpText: (
      <>
        Calculated via ip-api.com. Paid key env:{" "}
        <code className="font-mono text-[11px]">IPAPI_PRO_KEY</code>
      </>
    ),
  },
  { key: "language", sourceLabel: "URL → browser → campus default" },
  { key: "userId", sourceLabel: "Session cookie / new visitor id" },
  { key: "utm", sourceLabel: "From URL when campaign tags are present" },
];

export function SessionTab() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<SessionSettingsResponse>({
    queryKey: ["/api/settings/session"],
  });

  const [database, setDatabase] = useState<string | null>(null);
  const [fillFromIp, setFillFromIp] = useState(true);
  const [scenario, setScenario] = useState<"organic" | "paid">("organic");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!data) return;
    setDatabase(data.location.database);
    setFillFromIp(data.location.fill_from_ip !== false);
  }, [data]);

  const available = data?.available_databases ?? [];
  const locationGeoOkList = data?.location_geo_ok_databases;
  const locationDbErrors = data?.location_database_errors ?? {};
  /** Affirmative allow-list only — never treat a missing map as “valid”. */
  const locationGeoOk =
    !!database &&
    Array.isArray(locationGeoOkList) &&
    locationGeoOkList.includes(database);
  const locationGeoError = (() => {
    if (!database || !available.includes(database)) return null;
    if (locationGeoOk) return null;
    if (Array.isArray(locationGeoOkList)) {
      return locationDbErrors[database] ?? LOCATION_GEO_ERROR_FALLBACK;
    }
    return locationDbErrors[database] ?? null;
  })();

  /** Select value: None, fill:{slug}, or bound:{slug} when fill-from-IP is off. */
  const locationSelectValue = (() => {
    if (!database) return NONE_VALUE;
    return fillFromIp ? `fill:${database}` : `bound:${database}`;
  })();

  const persistLocation = async (nextDatabase: string | null, nextFillFromIp: boolean) => {
    setSaving(true);
    try {
      await apiRequest("PUT", "/api/settings/session", {
        location: {
          database: nextDatabase,
          fill_from_ip: nextFillFromIp,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/settings/session"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/session/location-catalog"] });
    } catch (err: any) {
      toast({
        title: "Could not save",
        description: err?.message || String(err),
        variant: "destructive",
      });
      // Revert to last saved values from the query cache / server.
      if (data) {
        setDatabase(data.location.database);
        setFillFromIp(data.location.fill_from_ip !== false);
      }
    } finally {
      setSaving(false);
    }
  };

  const applyLocationSelect = (v: string) => {
    let nextDatabase: string | null = null;
    let nextFillFromIp = true;

    if (v === NONE_VALUE) {
      nextDatabase = null;
      nextFillFromIp = true;
    } else if (v.startsWith("fill:")) {
      nextDatabase = v.slice("fill:".length);
      nextFillFromIp = true;
    } else if (v.startsWith("bound:")) {
      nextDatabase = v.slice("bound:".length);
      nextFillFromIp = false;
    } else {
      return;
    }

    setDatabase(nextDatabase);
    setFillFromIp(nextFillFromIp);

    const nextKnownInvalid =
      !!nextDatabase &&
      (Array.isArray(locationGeoOkList)
        ? !locationGeoOkList.includes(nextDatabase)
        : !!locationDbErrors[nextDatabase]);
    if (nextKnownInvalid) {
      // Keep the invalid pick visible with help text; do not persist.
      return;
    }

    void persistLocation(nextDatabase, nextFillFromIp);
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <Card data-testid="panel-session-settings">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
        <div className="flex items-center gap-2 min-w-0">
          <IconWorld className="h-5 w-5 text-muted-foreground shrink-0" />
          <CardTitle className="text-base">Visitor session</CardTitle>
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 shrink-0"
                aria-label="Read more (advanced)"
                data-testid="button-session-advanced-info"
              >
                <IconInfoCircle className="h-4 w-4 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent
              align="start"
              className="w-80 space-y-2 text-xs text-muted-foreground leading-relaxed"
            >
              <p className="font-medium text-foreground text-sm">Read more (advanced)</p>
              <p>
                Stored in <code className="font-mono text-[11px]">settings.yml</code> under{" "}
                <code className="font-mono text-[11px]">session</code>. The worker loads{" "}
                <code className="font-mono text-[11px]">GET /api/session/location-catalog</code> in
                parallel with geo and matches nearest listed campus (country → region → world).
              </p>
              <p>
                System keys (<code className="font-mono text-[11px]">location</code>,{" "}
                <code className="font-mono text-[11px]">geo</code>,{" "}
                <code className="font-mono text-[11px]">utm</code>, …) are fixed — only the campus
                database source for <code className="font-mono text-[11px]">location</code> is
                configurable here (
                <code className="font-mono text-[11px]">session.location.database</code> +{" "}
                <code className="font-mono text-[11px]">fill_from_ip</code>).
              </p>
            </PopoverContent>
          </Popover>
          {saving ? (
            <span
              className="flex items-center gap-1 text-xs text-muted-foreground"
              data-testid="text-session-saving"
            >
              <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
              Saving…
            </span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          This site&apos;s visitor session shape. System keys are fixed; only{" "}
          <span className="text-foreground">location</span> can pick a campus database. Changes save
          automatically.
        </p>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-3 rounded-md border p-4">
            <p className="text-sm font-medium">System fields</p>
            <div className="space-y-1" data-testid="session-system-field-map">
              {SYSTEM_FIELD_ROWS.map((row) => (
                <div key={row.key} className="space-y-1" data-testid={`session-field-row-${row.key}`}>
                  <div className="flex items-center gap-2">
                    <span className="w-[5.5rem] shrink-0 flex items-center justify-end gap-0.5 text-xs font-mono font-medium text-muted-foreground">
                      {row.key}
                      {row.key === "location" ? (
                        <Popover>
                          <PopoverTrigger asChild>
                            <button
                              type="button"
                              className="inline-flex h-4 w-4 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
                              aria-label="How location is filled"
                              data-testid="button-session-location-info"
                            >
                              <IconInfoCircle className="h-3.5 w-3.5" />
                            </button>
                          </PopoverTrigger>
                          <PopoverContent
                            align="start"
                            className="w-80 space-y-2 text-xs text-muted-foreground leading-relaxed"
                          >
                            <p className="font-medium text-foreground text-sm">location</p>
                            <p>
                              Uses the database you pick here as a catalog of places with latitude and
                              longitude. From the visitor&apos;s IP we find the nearest listed row and
                              set <code className="font-mono text-[11px]">session.location</code> to
                              that entry.
                            </p>
                            <p>
                              For example, if the database is{" "}
                              <code className="font-mono text-[11px]">campus</code>, the visitor gets
                              the nearest campus. Leave as None to keep location empty (geo still
                              fills from IP).
                            </p>
                          </PopoverContent>
                        </Popover>
                      ) : null}
                    </span>
                    <IconArrowRight className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                    {row.editable ? (
                      <Select
                        value={locationSelectValue}
                        onValueChange={applyLocationSelect}
                        disabled={saving}
                      >
                        <SelectTrigger
                          className="h-7 flex-1 min-w-0 text-xs font-mono"
                          id="session-location-db"
                          data-testid="select-session-location-db"
                        >
                          <SelectValue placeholder="None" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NONE_VALUE}>None</SelectItem>
                          {available.map((slug) => (
                            <SelectItem key={`fill:${slug}`} value={`fill:${slug}`}>
                              {slug}
                            </SelectItem>
                          ))}
                          {/* Preserve legacy fill_from_ip: false without advertising it for every DB */}
                          {database && !fillFromIp ? (
                            <SelectItem
                              value={`bound:${database}`}
                              className={
                                available.includes(database) ? undefined : "text-destructive font-mono"
                              }
                            >
                              {database}
                              {available.includes(database) ? " (no IP fill)" : " (missing)"}
                            </SelectItem>
                          ) : null}
                          {database && !available.includes(database) && fillFromIp ? (
                            <SelectItem
                              value={`fill:${database}`}
                              className="text-destructive font-mono"
                            >
                              {database} (missing)
                            </SelectItem>
                          ) : null}
                        </SelectContent>
                      </Select>
                    ) : (
                      <span
                        className={cn(
                          "h-7 flex-1 min-w-0 flex items-center rounded-md border border-input bg-muted/40 px-2 text-xs text-muted-foreground",
                        )}
                        data-testid={`text-session-field-source-${row.key}`}
                      >
                        {row.sourceLabel}
                      </span>
                    )}
                  </div>
                  {row.key === "location" && locationGeoError ? (
                    <p
                      className="pl-[calc(5.5rem+1.75rem)] text-[11px] text-destructive leading-snug"
                      data-testid="text-session-location-geo-error"
                    >
                      {locationGeoError}
                    </p>
                  ) : null}
                  {row.key === "location" && locationGeoOk ? (
                    <p
                      className="pl-[calc(5.5rem+1.75rem)] flex items-start gap-1.5 text-[11px] text-status-online leading-snug"
                      data-testid="text-session-location-geo-ok"
                    >
                      <IconCheck className="h-3.5 w-3.5 shrink-0 mt-0.5" aria-hidden />
                      <span>
                        This database has latitude and longitude fields and can be used for location
                        matching.
                      </span>
                    </p>
                  ) : null}
                  {row.helpText ? (
                    <p
                      className="pl-[calc(5.5rem+1.75rem)] text-[11px] text-muted-foreground leading-snug"
                      data-testid={`text-session-field-help-${row.key}`}
                    >
                      {row.helpText}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
            {available.length === 0 ? (
              <p className="text-xs text-muted-foreground" data-testid="text-session-no-campus-dbs">
                No local campus databases yet. Create a private database (e.g.{" "}
                <code className="font-mono text-[11px]">locations</code>) first.
              </p>
            ) : null}
          </div>

          <div className="space-y-3 min-w-0">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium">Example session JSON</p>
              <ToggleButtonBar
                value={scenario}
                onValueChange={(v) => setScenario(v as "organic" | "paid")}
                listClassName="flex"
              >
                <ToggleButtonBarTrigger value="organic" data-testid="tab-session-organic">
                  Organic
                </ToggleButtonBarTrigger>
                <ToggleButtonBarTrigger value="paid" data-testid="tab-session-paid">
                  Paid URL
                </ToggleButtonBarTrigger>
              </ToggleButtonBar>
            </div>
            <p className="text-xs text-muted-foreground">
              Paid shows optional <code className="font-mono text-[11px]">utm.*</code> keys that
              appear only when the visit URL includes them.
            </p>
            <SessionExampleJson
              paid={scenario === "paid"}
              database={database}
              fillFromIp={fillFromIp}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
