import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconAlertCircle,
  IconChevronDown,
  IconCircleCheck,
  IconDeviceFloppy,
  IconExternalLink,
  IconKey,
  IconLoader2,
  IconPlayerPause,
  IconPlugConnected,
  IconSend,
  IconToggleLeft,
  IconToggleRight,
  IconWorldUpload,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import { useSettingsDirty } from "@/components/settings/SettingsShell";
import { HeldRemovalsNotice } from "@/components/indexnow/HeldRemovalsNotice";
import {
  INDEXNOW_STATUS_KEY,
  fetchIndexNowStatus,
  indexNowResultLabel,
  postJson,
  relativeTime,
  type IndexNowStatus,
  type IndexNowTestResponse,
} from "@/lib/indexnow";

type SaveResponse = { success?: boolean; error?: string; warnings?: string[]; status?: IndexNowStatus };

export function IndexNowTab() {
  const { hasCapability } = useDebugAuth();
  const canEdit = hasCapability("seo_settings");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [enabled, setEnabled] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [submitAllOpen, setSubmitAllOpen] = useState(false);
  const [submittingAll, setSubmittingAll] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  useSettingsDirty(dirty);

  const { data: status, isLoading } = useQuery({
    queryKey: INDEXNOW_STATUS_KEY,
    queryFn: fetchIndexNowStatus,
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (!status || dirty) return;
    setEnabled(status.enabled);
  }, [status, dirty]);

  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: INDEXNOW_STATUS_KEY });
  }

  function showWarnings(warnings: string[] | undefined) {
    for (const w of warnings ?? []) {
      toast({ title: "Key file not reachable yet", description: w, variant: "destructive" });
    }
  }

  async function save(body: { enabled?: boolean; generate_key?: boolean }, successTitle: string) {
    const res = await postJson<SaveResponse>("/api/settings/indexnow", body);
    if (!res.ok) throw new Error(res.body.error || "Save failed");
    toast({ title: successTitle });
    showWarnings(res.body.warnings);
    await refresh();
  }

  async function onSave() {
    setSaving(true);
    try {
      await save({ enabled }, enabled ? "IndexNow is on" : "IndexNow is off");
      setDirty(false);
    } catch (err) {
      toast({ title: "Save failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function onGenerateKey() {
    setGenerating(true);
    try {
      await save({ generate_key: true }, "New key generated");
    } catch (err) {
      toast({ title: "Could not generate a key", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setGenerating(false);
    }
  }

  async function onTest() {
    setTesting(true);
    try {
      const res = await postJson<IndexNowTestResponse>("/api/settings/indexnow/test");
      const body = res.body;
      if (res.ok && body.ok) {
        toast({
          title: "Connection OK",
          description: body.mode === "key_file" ? "The live site serves the key. Notices are only sent from the live site." : body.detail,
        });
      } else {
        toast({
          title: "Connection failed",
          description: body.mode === "notice" && body.outcome === "rejected_key" ? "Key not verified yet. " + body.detail : body.detail,
          variant: "destructive",
        });
      }
      await refresh();
    } catch (err) {
      toast({ title: "Connection failed", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setTesting(false);
    }
  }

  async function onSubmitAll() {
    setSubmittingAll(true);
    try {
      const res = await postJson<{ error?: string; total?: number }>("/api/indexnow/submit-all");
      if (!res.ok) throw new Error(res.body.error || "Could not queue");
      toast({ title: "Sending all URLs", description: `${res.body.total ?? 0} URLs will go out in batches of 500.` });
      setSubmitAllOpen(false);
      await refresh();
    } catch (err) {
      toast({ title: "Could not send all URLs", description: err instanceof Error ? err.message : String(err), variant: "destructive" });
    } finally {
      setSubmittingAll(false);
    }
  }

  if (isLoading || !status) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <IconLoader2 className="mr-2 h-5 w-5 animate-spin" />
        Loading IndexNow…
      </div>
    );
  }

  const hasKey = Boolean(status.key);

  return (
    <div className="space-y-4" data-testid="tab-panel-indexnow">
      {status.held ? <HeldRemovalsNotice removedCount={status.held.removedCount} canEdit={canEdit} /> : null}

      <Card data-testid="card-indexnow-connection">
        <CardHeader className="flex flex-row items-center gap-2 pb-4">
          <IconWorldUpload className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">IndexNow</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground">
            When a page is published, edited, moved or removed, we tell Bing and other IndexNow search engines so they
            recheck it sooner. Google does not use IndexNow. Only the live site sends these notices. Test connection
            sends one notice for the homepage; it does not show whether pages are indexed.
          </p>

          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">Send notices</p>
              <p className="text-xs text-muted-foreground">
                {hasKey ? "Uses this site's key." : "Generate a key before turning this on."}
              </p>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={!canEdit || !hasKey}
              onClick={() => {
                setEnabled((v) => !v);
                setDirty(true);
              }}
              data-testid="button-indexnow-enabled"
            >
              {enabled ? (
                <IconToggleRight className="h-5 w-5 text-chart-3" />
              ) : (
                <IconToggleLeft className="h-5 w-5 text-muted-foreground" />
              )}
            </Button>
          </div>

          <div className="space-y-2">
            <p className="text-sm font-medium text-foreground">Key</p>
            {hasKey ? (
              <div className="flex flex-wrap items-center gap-2">
                <code className="rounded bg-muted px-2 py-1 font-mono text-xs text-foreground" data-testid="text-indexnow-key">
                  {status.key}
                </code>
                {status.keyFileUrl ? (
                  <a
                    href={status.keyFileUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                    data-testid="link-indexnow-key-file"
                  >
                    Key file
                    <IconExternalLink className="h-3 w-3" />
                  </a>
                ) : null}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No key yet.</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={onSave} disabled={!canEdit || !dirty || saving} data-testid="button-indexnow-save">
              {saving ? <IconLoader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <IconDeviceFloppy className="mr-1.5 h-4 w-4" />}
              Save
            </Button>
            <Button
              size="sm"
              variant="secondary"
              onClick={onTest}
              disabled={!canEdit || testing || !hasKey}
              data-testid="button-indexnow-test"
            >
              {testing ? <IconLoader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <IconPlugConnected className="mr-1.5 h-4 w-4" />}
              {testing ? "Testing…" : "Test connection"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={onGenerateKey}
              disabled={!canEdit || generating}
              data-testid="button-indexnow-generate-key"
            >
              {generating ? <IconLoader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <IconKey className="mr-1.5 h-4 w-4" />}
              {hasKey ? "Generate new key" : "Generate key"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card data-testid="card-indexnow-status">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
          <div className="flex items-center gap-2">
            <IconSend className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Status</CardTitle>
          </div>
          {status.verifiedAt ? (
            <Badge variant="secondary" className="gap-1 border-transparent bg-chart-3/15 text-chart-3" data-testid="badge-indexnow-verified">
              <IconCircleCheck className="h-3.5 w-3.5" />
              Key verified
            </Badge>
          ) : (
            <Badge variant="outline" className="gap-1 text-muted-foreground" data-testid="badge-indexnow-not-verified">
              Key not verified yet
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {!status.live ? (
            <p className="text-sm text-muted-foreground" data-testid="text-indexnow-off-live">
              Changes are recorded here, but notices are only sent from the live site.
            </p>
          ) : null}
          {status.paused ? (
            <div className="flex items-center gap-2 text-sm text-foreground" data-testid="text-indexnow-paused">
              <IconPlayerPause className="h-4 w-4 text-muted-foreground" />
              Paused: this site is hidden from search engines.
            </div>
          ) : null}
          {status.stuck ? (
            <div
              className="flex gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm text-foreground"
              data-testid="notice-indexnow-stuck"
            >
              <IconAlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" />
              <span>
                {status.stoppedAt
                  ? "Stopped after 24 hours of rejections; run Test connection to resume."
                  : `Notices are not going out: ${status.waiting} changes have been waiting for over an hour.`}
                {status.lastError ? ` Last error: ${status.lastError}` : ""}
              </span>
            </div>
          ) : null}

          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Last run</dt>
              <dd className="truncate text-foreground" data-testid="text-indexnow-last-run">
                {relativeTime(status.lastRunAt)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Result</dt>
              <dd className="truncate text-foreground" data-testid="text-indexnow-result">
                {indexNowResultLabel(status.lastStatus)}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Waiting to send</dt>
              <dd className="text-foreground" data-testid="text-indexnow-waiting">
                {status.waiting}
              </dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">Public pages known</dt>
              <dd className="text-foreground">{status.totalUrls}</dd>
            </div>
          </dl>
          {status.lastError && !status.stuck ? (
            <p className="text-xs text-muted-foreground" data-testid="text-indexnow-last-error">
              Last error: {status.lastError}
            </p>
          ) : null}

          <Button
            size="sm"
            variant="outline"
            disabled={!canEdit || !status.live || !status.enabled}
            onClick={() => setSubmitAllOpen(true)}
            data-testid="button-indexnow-submit-all"
          >
            <IconSend className="mr-1.5 h-4 w-4" />
            Submit all URLs
          </Button>

          <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
            <CollapsibleTrigger asChild>
              <button
                type="button"
                className="flex items-center gap-2 text-sm font-medium text-foreground"
                data-testid="button-indexnow-advanced"
              >
                Read more (advanced)
                <IconChevronDown className={`h-4 w-4 transition-transform ${advancedOpen ? "rotate-180" : ""}`} />
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-3 space-y-2 text-xs text-muted-foreground">
              <p>
                Key file: <span className="font-mono">{status.keyFileUrl ?? "https://<domain>/<key>.txt"}</span>. Proof
                that notices arrive is in{" "}
                <a
                  href="https://www.bing.com/webmasters/indexnow"
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Bing Webmaster Tools → IndexNow
                </a>
                .
              </p>
              <p>
                What counts as a change: a page's own editorial edits, new pages, moved pages and removed pages. Theme,
                menu and shared template changes do not send notices.
              </p>
              <p>The first check after setup only records a starting point and sends nothing; use Submit all URLs for a full push.</p>
              <p>
                If one check would remove at least 20% of known pages (10 or more) or more than 200 pages at once, it is
                held until staff confirm. Rejections retry after 15 min, 1 h, then every 4 h, and stop after 24 h.
              </p>
              <p className="font-mono">
                settings.yml → indexnow · data/&lt;site&gt;/app.db → public_url_changes, public_url_consumers
              </p>
            </CollapsibleContent>
          </Collapsible>
        </CardContent>
      </Card>

      <AlertDialog open={submitAllOpen} onOpenChange={setSubmitAllOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Send all {status.totalUrls} URLs?</AlertDialogTitle>
            <AlertDialogDescription>
              Every public page is sent to IndexNow in batches of 500, a couple of minutes apart. Use this once after
              setup or after a big migration; everyday changes are sent automatically.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={submittingAll}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void onSubmitAll();
              }}
              disabled={submittingAll}
              data-testid="button-indexnow-submit-all-confirm"
            >
              {submittingAll ? <IconLoader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
              Send all
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
