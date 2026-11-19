import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import CodeMirror from "@uiw/react-codemirror";
import { json as jsonLang } from "@codemirror/lang-json";
import { EditorView } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  IconDeviceFloppy,
  IconInfoCircle,
  IconLoader2,
  IconMapPin,
  IconWorld,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
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
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useSettingsDirty } from "@/components/settings/SettingsShell";
import { cn } from "@/lib/utils";

type SessionSettingsResponse = {
  location: {
    database: string | null;
    fill_from_ip: boolean;
  };
  available_databases: string[];
};

const NONE_VALUE = "__none__";

function buildExampleSession(opts: {
  paid: boolean;
  database: string | null;
  fillFromIp: boolean;
}): string {
  const location =
    opts.database && opts.fillFromIp
      ? {
          slug: "miami-usa",
          name: "Miami",
          city: "Miami",
          country: "United States",
          country_code: "US",
          region: "usa-canada",
          reliable: true,
        }
      : null;

  const base = {
    userId: "a1b2c3d4-…",
    language: "en",
    location,
    geo: {
      city: "Miami",
      country: "United States",
      country_code: "US",
      latitude: 25.76,
      longitude: -80.19,
    },
    utm: opts.paid
      ? {
          utm_source: "google",
          utm_medium: "cpc",
          utm_campaign: "spring-bootcamp",
          utm_content: "ad-1",
        }
      : {},
    landing_page: opts.paid ? "/us/coding-bootcamp" : "/",
    entry_channel: opts.paid ? { channel: "paid", at: 1_700_000_000_000 } : { channel: "direct", at: 1_700_000_000_000 },
  };

  return JSON.stringify(base, null, 2);
}

export function SessionTab() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<SessionSettingsResponse>({
    queryKey: ["/api/settings/session"],
  });

  const [database, setDatabase] = useState<string | null>(null);
  const [fillFromIp, setFillFromIp] = useState(true);
  const [scenario, setScenario] = useState<"organic" | "paid">("organic");
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);
  useSettingsDirty(dirty);

  useEffect(() => {
    if (!data) return;
    setDatabase(data.location.database);
    setFillFromIp(data.location.fill_from_ip !== false);
    setDirty(false);
  }, [data]);

  const available = data?.available_databases ?? [];

  const exampleJson = useMemo(
    () => buildExampleSession({ paid: scenario === "paid", database, fillFromIp }),
    [scenario, database, fillFromIp],
  );

  const save = async () => {
    setSaving(true);
    try {
      await apiRequest("PUT", "/api/settings/session", {
        location: {
          database,
          fill_from_ip: fillFromIp,
        },
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/settings/session"] });
      await queryClient.invalidateQueries({ queryKey: ["/api/session/location-catalog"] });
      setDirty(false);
      toast({ title: "Session settings saved" });
    } catch (err: any) {
      toast({
        title: "Could not save",
        description: err?.message || String(err),
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
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
                database source is configurable here.
              </p>
            </PopoverContent>
          </Popover>
        </div>
        <Button
          onClick={save}
          disabled={!dirty || saving}
          data-testid="button-session-save"
        >
          {saving ? (
            <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
          ) : (
            <IconDeviceFloppy className="h-4 w-4 mr-1.5" />
          )}
          Save
        </Button>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-sm text-muted-foreground">
          This site&apos;s visitor session shape. System keys are fixed. Choose which campus
          database fills <span className="text-foreground">location</span> from the visitor&apos;s
          IP — or leave it empty so location stays blank while geo still fills.
        </p>

        <div className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4 rounded-md border p-4">
            <div className="flex items-center gap-2">
              <IconMapPin className="h-4 w-4 text-muted-foreground" />
              <p className="text-sm font-medium">System fields</p>
            </div>

            <div className="space-y-2 rounded-md border bg-muted/30 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <Label className="text-sm">location</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Nearest campus from the selected database
                  </p>
                </div>
                <Switch
                  checked={fillFromIp && !!database}
                  disabled={!database}
                  onCheckedChange={(v) => {
                    setFillFromIp(v);
                    setDirty(true);
                  }}
                  data-testid="switch-session-fill-from-ip"
                />
              </div>
              <div className="space-y-1.5 pt-2">
                <Label htmlFor="session-location-db" className="text-xs text-muted-foreground">
                  Campus database
                </Label>
                <Select
                  value={database ?? NONE_VALUE}
                  onValueChange={(v) => {
                    const next = v === NONE_VALUE ? null : v;
                    setDatabase(next);
                    if (!next) setFillFromIp(true);
                    setDirty(true);
                  }}
                >
                  <SelectTrigger id="session-location-db" data-testid="select-session-location-db">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>None</SelectItem>
                    {available.map((slug) => (
                      <SelectItem key={slug} value={slug}>
                        {slug}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {available.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    No local campus databases yet. Create a private database (e.g.{" "}
                    <code className="font-mono text-[11px]">locations</code>) first.
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">
                  {database
                    ? fillFromIp
                      ? "Fill from visitor IP is on."
                      : "Database selected but IP fill is off — location stays null."
                    : "location stays null; geo still fills from IP."}
                </p>
              </div>
            </div>

            <div className="space-y-2 text-xs text-muted-foreground">
              <p className="font-medium text-foreground text-sm">Also always present</p>
              <ul className="list-disc pl-4 space-y-1">
                <li>
                  <code className="font-mono text-[11px]">geo</code> — raw IP lookup
                </li>
                <li>
                  <code className="font-mono text-[11px]">language</code> /{" "}
                  <code className="font-mono text-[11px]">userId</code>
                </li>
                <li>
                  <code className="font-mono text-[11px]">utm</code> — only when the URL carries
                  campaign tags
                </li>
              </ul>
            </div>
          </div>

          <div className="space-y-3 rounded-md border p-4 min-w-0">
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
            <div className={cn("rounded-md border overflow-hidden")}>
              <CodeMirror
                value={exampleJson}
                height="320px"
                editable={false}
                extensions={[jsonLang(), EditorView.lineWrapping, oneDark]}
                basicSetup={{ lineNumbers: false, foldGutter: false }}
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
