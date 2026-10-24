import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconActivityHeartbeat,
  IconAlertTriangle,
  IconBrandGoogleAnalytics,
  IconCircleCheck,
  IconCircleX,
  IconListCheck,
  IconLoader2,
  IconPlayerPlay,
  IconPlugConnected,
  IconTool,
} from "@tabler/icons-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import { AB_TESTING_CARD_IDS } from "@/lib/settings-tab";
import { cn } from "@/lib/utils";
import { AbTestingSetupDialog } from "./AbTestingSetupDialog";

type CheckItem = { ok: boolean; detail?: string };
type CheckRun = {
  at: string;
  trigger: "setup" | "deploy" | "manual" | "recovery";
  deploy_sha: string | null;
  status: "passed" | "failed" | "inconclusive";
  url: string | null;
  requests: number;
  observed: Record<string, number>;
  expected: Record<string, number>;
  p_value: number | null;
  checks: Record<string, CheckItem>;
  error?: string;
};

type AbStatus = {
  set_up: boolean;
  latest_check_ok: boolean;
  first_passed_at: string | null;
  can_set_up: boolean;
  check_page: { contentType: string; slug: string; locale: string; url: string | null } | null;
  has_token: boolean;
  running: boolean;
  running_tests: number;
  latest_run: CheckRun | null;
  latest_summary: string | null;
  latest_conclusive_status: "passed" | "failed" | null;
  runs: CheckRun[];
};

type SetupResult = {
  ok: boolean;
  error?: string;
  warning?: string;
  commitSha: string | null;
  created: string[];
};

type Ga4Status = {
  ok: boolean;
  property_id: string | null;
  service_account: string | null;
  existing: string[];
  missing: string[];
  created?: string[];
  error?: string;
  step?: string;
  fix?: string;
};

const STATUS_KEY = ["/api/settings/ab-testing"];

const STEWARD_HINT = "Only a Platform Steward can do this (permission: Manage A/B testing setup).";

function StewardHint({ testId }: { testId: string }) {
  return (
    <span className="text-xs text-muted-foreground" data-testid={testId}>
      {STEWARD_HINT}
    </span>
  );
}

const CHECK_LABELS: Record<string, string> = {
  split: "Split matches the setting",
  content: "Visitors get the version they are counted under",
  cache: "Pages are never shared between visitors",
  cookie: "Visitors are remembered",
  sticky: "Returning visitors keep their version",
  reachable: "The check could reach the site",
};

function useAbStatus() {
  return useQuery<AbStatus>({
    queryKey: STATUS_KEY,
    queryFn: async () => {
      const res = await apiFetch("/api/settings/ab-testing");
      if (!res.ok) throw new Error("Failed to load A/B testing status");
      return res.json();
    },
    refetchInterval: (q) => (q.state.data?.running ? 3000 : false),
  });
}

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString();
}

function sharesLine(counts: Record<string, number>): string {
  const total = Object.values(counts).reduce((n, v) => n + v, 0) || 1;
  return Object.entries(counts)
    .map(([k, v]) => `${k === "default" ? "Default" : k} ${Math.round((v / total) * 100)}%`)
    .join(" / ");
}

function targetLine(expected: Record<string, number>): string {
  return Object.entries(expected)
    .map(([k, v]) => `${k === "default" ? "Default" : k} ${v}%`)
    .join(" / ");
}

function StatusBadge({ status }: { status: CheckRun["status"] | "not_set_up" | "waiting" | "ready" }) {
  const map: Record<string, { label: string; className: string }> = {
    passed: { label: "Passed", className: "border-status-online/40 text-status-online" },
    ready: { label: "Ready", className: "border-status-online/40 text-status-online" },
    failed: { label: "Failed", className: "border-destructive/40 text-destructive" },
    inconclusive: { label: "Couldn't run", className: "border-status-away/40 text-status-away" },
    waiting: { label: "Waiting for first check", className: "border-status-away/40 text-status-away" },
    not_set_up: { label: "Not set up", className: "text-muted-foreground" },
  };
  const m = map[status] ?? map.not_set_up;
  return (
    <Badge variant="outline" className={cn("text-xs font-normal", m.className)} data-testid={`badge-ab-status-${status}`}>
      {m.label}
    </Badge>
  );
}

function CheckList({ run }: { run: CheckRun }) {
  const entries = Object.entries(run.checks);
  if (entries.length === 0) return null;
  return (
    <ul className="space-y-1.5 text-sm">
      {entries.map(([name, c]) => (
        <li key={name} className="flex items-start gap-2" data-testid={`ab-check-item-${name}`}>
          {c.ok ? (
            <IconCircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-status-online" />
          ) : (
            <IconCircleX className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
          )}
          <span>
            {CHECK_LABELS[name] ?? name}
            {!c.ok && c.detail && <span className="block text-xs text-muted-foreground">{c.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function SetupCard({ canManage }: { canManage: boolean }) {
  const { data, isLoading } = useAbStatus();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const setup = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/settings/ab-testing/setup", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Setup failed");
      return body;
    },
    onSuccess: () => {
      toast({ title: "Setting up A/B testing", description: "Creating the check page and running the first check (about a minute)." });
      void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    },
    onError: (err) => toast({ title: "Setup failed", description: String((err as Error).message), variant: "destructive" }),
  });

  const { data: setupResult } = useQuery<{ result: SetupResult | null; running: boolean }>({
    queryKey: ["/api/settings/ab-testing/setup-result"],
    queryFn: async () => (await apiFetch("/api/settings/ab-testing/setup-result")).json(),
    refetchInterval: data?.running ? 3000 : false,
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const state = data.set_up ? "ready" : data.check_page ? "waiting" : "not_set_up";
  const lastSetup = setupResult?.result;

  return (
    <div className="space-y-4">
      <Card id="ab-setup" className="scroll-mt-6" data-testid="panel-ab-setup">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
          <div className="flex items-center gap-2">
            <IconTool className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Setup</CardTitle>
          </div>
          <StatusBadge status={state} />
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Creates a hidden page used only to check that splitting works. Visitors never see it. Until setup passes,
            every visitor sees Default and versions can't get traffic.
          </p>

          {data.check_page && (
            <div className="rounded-md border bg-muted/30 px-3 py-2 text-sm" data-testid="text-ab-check-page">
              <span className="text-muted-foreground">Check page: </span>
              <span className="font-mono text-xs">{data.check_page.url ?? `${data.check_page.contentType}/${data.check_page.slug}`}</span>
            </div>
          )}

          {!data.set_up && data.running_tests > 0 && (
            <p className="flex items-start gap-2 text-sm text-status-away" data-testid="text-ab-paused-tests">
              <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              {data.running_tests} test{data.running_tests === 1 ? " still has" : "s still have"} traffic set but are paused
              until setup is done. Run the pause migration (Settings → General → Migrations) before setting up, so they don't
              restart on their own.
            </p>
          )}

          {lastSetup && !lastSetup.ok && (
            <p className="text-sm text-destructive" data-testid="text-ab-setup-error">{lastSetup.error}</p>
          )}
          {lastSetup?.warning && (
            <p className="text-sm text-status-away" data-testid="text-ab-setup-warning">{lastSetup.warning}</p>
          )}
          {data.latest_run && !data.set_up && data.latest_run.status !== "passed" && !data.running && (
            <p className="text-sm text-destructive" data-testid="text-ab-setup-check-failed">
              The first check did not pass: {data.latest_summary}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              onClick={() => setup.mutate()}
              disabled={!canManage || !data.can_set_up || data.running || setup.isPending}
              data-testid="button-ab-setup"
            >
              {data.running ? (
                <>
                  <IconLoader2 className="mr-1.5 h-4 w-4 animate-spin" /> Checking…
                </>
              ) : data.check_page ? (
                "Set up again"
              ) : (
                "Set up A/B testing"
              )}
            </Button>
            {!canManage ? (
              <StewardHint testId="text-ab-setup-steward-only" />
            ) : (
              !data.can_set_up && (
                <span className="text-xs text-muted-foreground">This site has no landing or page content type to host the check page.</span>
              )
            )}
          </div>

          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">Read more (advanced)</summary>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>
                The check page is <span className="font-mono">landing/ab-check</span> (or <span className="font-mono">page/ab-check</span>),
                marked <span className="font-mono">system: ab_check</span> in <span className="font-mono">_common.yml</span>, noindex,
                with a version <span className="font-mono">b</span> at 30%. It is pushed to the content repo and locked: it can't be
                edited, deleted, or given other variants.
              </li>
              <li>
                Setup records live in <span className="font-mono">data/&lt;site&gt;/ab-testing.json</span> on this server (check token
                and the last 20 checks). If that file is lost, the server rebuilds it and re-checks on its own.
              </li>
              <li>Setup is per site and per environment: local and production each run their own check.</li>
            </ul>
          </details>
        </CardContent>
      </Card>
    </div>
  );
}

function HealthCard({ canManage }: { canManage: boolean }) {
  const { data, isLoading } = useAbStatus();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const run = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/settings/ab-testing/check", { method: "POST" });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Check failed to start");
      return body;
    },
    onSuccess: () => {
      toast({ title: "Checking", description: "Sending test visits through the live site (about a minute)." });
      void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    },
    onError: (err) => toast({ title: "Check failed to start", description: String((err as Error).message), variant: "destructive" }),
  });

  if (isLoading || !data) {
    return (
      <div className="flex items-center justify-center py-12">
        <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const latest = data.latest_run;

  return (
    <div className="space-y-4">
      <Card id="ab-health" className="scroll-mt-6" data-testid="panel-ab-health">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
          <div className="flex items-center gap-2">
            <IconActivityHeartbeat className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Last check</CardTitle>
          </div>
          <Button
            variant="secondary"
            onClick={() => run.mutate()}
            disabled={!canManage || !data.check_page || data.running || run.isPending}
            title={canManage ? undefined : STEWARD_HINT}
            data-testid="button-ab-run-check"
          >
            {data.running ? (
              <IconLoader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : (
              <IconPlayerPlay className="mr-1.5 h-4 w-4" />
            )}
            {data.running ? "Checking…" : "Run check now"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground leading-relaxed">
            After every deploy we send test visits through the live site and check that visitors get the right version.
            A failed check never changes what visitors see: running tests continue, but starting or raising tests waits
            until a check passes.
          </p>

          {!data.check_page ? (
            <p className="text-sm text-muted-foreground" data-testid="text-ab-health-not-setup">
              A/B testing is not set up yet. Start with Setup above.
            </p>
          ) : !latest ? (
            <p className="text-sm text-muted-foreground">No checks yet.</p>
          ) : (
            <div className="space-y-3" data-testid="ab-health-latest">
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <StatusBadge status={latest.status} />
                <span className="text-muted-foreground">
                  {formatWhen(latest.at)} · {latest.trigger}
                  {latest.deploy_sha ? ` · deploy ${latest.deploy_sha.slice(0, 7)}` : ""}
                </span>
              </div>
              <p className="text-sm" data-testid="text-ab-latest-summary">{data.latest_summary}</p>
              {Object.keys(latest.observed).length > 0 && (
                <p className="text-xs text-muted-foreground">
                  Visitors saw {sharesLine(latest.observed)} · target {targetLine(latest.expected)} · {latest.requests} test visits
                </p>
              )}
              <CheckList run={latest} />
            </div>
          )}

          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer select-none">Read more (advanced)</summary>
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>
                About 300 visits with fresh cookies, ~5 at a time over ~60 seconds, to the check page's public URL (through
                Cloudflare). Requests carry an <span className="font-mono">X-AB-Check</span> header with a secret token, so they are
                served like visitors but never counted.
              </li>
              <li>The split passes when a chi-square test gives p ≥ 0.001 against the 30 / 70 setting.</li>
              <li>
                More than 10% blocked, challenged, or timed-out requests make the run "couldn't run": a warning, and the last real
                result still applies. Fix: a Cloudflare WAF custom rule that skips bot and rate-limit checks when the
                <span className="font-mono"> X-AB-Check</span> header is present.
              </li>
              <li>
                Deploys call the loopback hook <span className="font-mono">POST /api/internal/ab-testing/check-all</span>; results also
                appear as <span className="font-mono">AB_CHECK</span> lines in the GitHub deploy summary.
              </li>
            </ul>
          </details>
        </CardContent>
      </Card>

      {data.runs.length > 1 && (
        <Card data-testid="panel-ab-history">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Recent checks</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y text-sm">
              {data.runs.map((r) => (
                <li key={r.at} className="flex flex-wrap items-center gap-2 py-2">
                  <StatusBadge status={r.status} />
                  <span className="text-muted-foreground">{formatWhen(r.at)}</span>
                  <span className="text-muted-foreground">· {r.trigger}</span>
                  {Object.keys(r.observed).length > 0 && (
                    <span className="text-xs text-muted-foreground">· {sharesLine(r.observed)}</span>
                  )}
                </li>
              ))}
            </ul>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function AnalyticsCard({ canManage }: { canManage: boolean }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [setupOpen, setSetupOpen] = useState(false);
  const { data, isLoading, refetch, isFetching } = useQuery<Ga4Status>({
    queryKey: ["/api/settings/ab-testing/ga4-dimensions"],
    queryFn: async () => (await apiFetch("/api/settings/ab-testing/ga4-dimensions")).json(),
  });

  const create = useMutation({
    mutationFn: async () => {
      const res = await apiFetch("/api/settings/ab-testing/ga4-dimensions", { method: "POST" });
      return (await res.json()) as Ga4Status;
    },
    onSuccess: (result) => {
      queryClient.setQueryData(["/api/settings/ab-testing/ga4-dimensions"], result);
      if (result.ok) {
        toast({
          title: "Dimensions ready",
          description: result.created?.length ? `Created ${result.created.join(" and ")}.` : "Both dimensions already existed.",
        });
      } else {
        toast({ title: "Couldn't create dimensions", description: result.fix ?? result.error, variant: "destructive" });
      }
    },
  });

  const testConnection = async () => {
    const { data: result, error } = await refetch();
    if (!result || error) {
      toast({
        title: "Couldn't reach Google Analytics",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      });
    } else if (result.ok) {
      toast({ title: "Connected", description: "Both dimensions are registered in Google Analytics." });
    } else if (result.step || result.error) {
      toast({
        title: "Couldn't reach Google Analytics",
        description: result.fix ?? result.error,
        variant: "destructive",
      });
    } else {
      const n = result.missing.length;
      toast({
        title: `Connected, ${n} dimension${n === 1 ? "" : "s"} missing`,
        description: canManage ? "Use Create them to add them." : "A steward can add them with Create them.",
      });
    }
  };

  return (
    <Card id="ab-analytics" className="scroll-mt-6" data-testid="panel-ab-analytics">
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
        <div className="flex items-center gap-2">
          <IconBrandGoogleAnalytics className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">Variant reporting</CardTitle>
        </div>
        <Button variant="secondary" onClick={() => void testConnection()} disabled={isFetching} data-testid="button-ab-ga4-test">
          {isFetching ? <IconLoader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <IconPlugConnected className="mr-1.5 h-4 w-4" />}
          {isFetching ? "Testing…" : "Test connection"}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground leading-relaxed">
          Lets Google Analytics reports split visitors by page version. Recommended, not required: tests run and the
          leads and ads reports work without it. Create them adds two custom dimensions to your GA4 property; it does not
          change Tag Manager or tracking on the site.
        </p>

        {isLoading || !data ? (
          <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        ) : (
          <div className="space-y-3">
            <ul className="space-y-1.5 text-sm">
              {["experiment_id", "variant"].map((name) => {
                const ok = data.existing.includes(name);
                return (
                  <li key={name} className="flex items-center gap-2" data-testid={`ga4-dimension-${name}`}>
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

            {!data.ok && data.missing.length > 0 && !data.step && (
              <p className="flex items-start gap-2 text-sm text-status-away" data-testid="text-ab-ga4-missing">
                <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                Until these exist, Google Analytics reports can't split visitors by version.
              </p>
            )}
            {data.fix && (
              <p className="text-sm text-destructive" data-testid="text-ab-ga4-fix">{data.fix}</p>
            )}

            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => create.mutate()}
                disabled={!canManage || create.isPending || data.ok || data.step === "configure_bigquery"}
                data-testid="button-ab-ga4-create"
              >
                {create.isPending && <IconLoader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                {data.ok ? "Both dimensions exist" : "Create them"}
              </Button>
              <Button variant="outline" onClick={() => setSetupOpen(true)} data-testid="button-ab-testing-setup">
                <IconListCheck className="mr-1.5 h-4 w-4" />
                Setup instructions
              </Button>
              {!canManage && !data.ok && <StewardHint testId="text-ab-ga4-steward-only" />}
            </div>
          </div>
        )}

        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">Read more (advanced)</summary>
          <ul className="mt-2 list-disc space-y-1 pl-4">
            <li>
              Event-scoped custom dimensions <span className="font-mono">experiment_id</span> and <span className="font-mono">variant</span>,
              created with the Google Analytics Admin API (<span className="font-mono">v1beta/properties/&#123;id&#125;/customDimensions</span>).
            </li>
            <li>
              Property {data?.property_id ?? "(not found)"} — read from the BigQuery export dataset name
              (<span className="font-mono">analytics_&lt;property id&gt;</span>) or <span className="font-mono">tracking.bigquery.ga4_property_id</span>.
            </li>
            <li>
              Uses the BigQuery service account{data?.service_account ? ` (${data.service_account})` : ""}. It needs the Google Analytics
              Admin API enabled in its Google Cloud project, and Editor in GA4 → Admin → Property access management (Viewer is enough to
              check).
            </li>
            <li>Tag Manager variables and tags are set up by hand: see Setup instructions.</li>
          </ul>
        </details>
      </CardContent>
      <AbTestingSetupDialog open={setupOpen} onOpenChange={setSetupOpen} dimensionsReady={data?.ok} />
    </Card>
  );
}

export function AbTestingPanel() {
  const { hasCapability } = useDebugAuth();
  const canManage = hasCapability("ab_testing_settings");
  const canViewMetrics = hasCapability("metrics_view") || canManage;

  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!(AB_TESTING_CARD_IDS as readonly string[]).includes(id)) return;
    const timer = window.setTimeout(() => document.getElementById(id)?.scrollIntoView({ block: "start" }), 300);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div className="space-y-2" data-testid="panel-ab-testing">
      <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">A/B testing</h2>
      <p className="text-sm text-muted-foreground">
        Page tests split visitors between versions of a page. Set up once per site; after every deploy we re-check that
        visitors get the right version.
      </p>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer text-foreground font-medium">Read more (advanced)</summary>
        <ul className="mt-2 list-disc pl-5 space-y-1">
          <li>
            Visitors are split per page and language, and keep their version (cookie{" "}
            <span className="font-mono">4g_versioning_v2</span>).
          </li>
          <li>
            Staff, bots, and forced previews are never put in a test. Leads credit the first test seen in the visit (cookie{" "}
            <span className="font-mono">4g_visit_exp</span>, 30 minutes).
          </li>
          <li>
            Each test run has its own id: <span className="font-mono">contentType:slug:locale@start-date</span>.
          </li>
        </ul>
      </details>
      <div className="space-y-4 pt-2">
        <SetupCard canManage={canManage} />
        <HealthCard canManage={canManage} />
        {canViewMetrics && <AnalyticsCard canManage={canManage} />}
      </div>
    </div>
  );
}
