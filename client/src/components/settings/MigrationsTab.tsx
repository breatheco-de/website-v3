import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  IconAlertCircle,
  IconAlertTriangle,
  IconCheck,
  IconCode,
  IconCopy,
  IconDots,
  IconEye,
  IconInfoCircle,
  IconLoader2,
  IconPlayerPlay,
  IconRefresh,
} from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import { apiFetch, queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

type RunMode = "run" | "dry_run" | "mark_done";
type RunStatus = "running" | "succeeded" | "failed" | "timed_out" | "interrupted";

export interface MigrationItem {
  filename: string;
  name: string;
  description: string;
  scope: "site" | "all";
  scope_missing: boolean;
  supports_dry_run: boolean;
  timeout_seconds: number;
  production_only: boolean;
  blocked_here: boolean;
  recorded_in: string;
  completed: { by: string | null; at: number | null; mode: "run" | "mark_done"; note: string | null } | null;
  changed_since_completed: boolean;
  running: boolean;
  last_run: {
    id: string;
    mode: RunMode;
    status: RunStatus;
    actor: string | null;
    started_at: number;
    finished_at: number | null;
    exit_code: number | null;
    output: string | null;
    note: string | null;
  } | null;
}

const QUERY_KEY = ["/api/migrations"];
const PRODUCTION_ONLY_HINT = "Only runs in production. Use Dry run here to test.";

const STATUS_LABEL: Record<RunStatus, string> = {
  running: "Running",
  succeeded: "Succeeded",
  failed: "Failed",
  timed_out: "Timed out",
  interrupted: "Interrupted",
};

function formatWhen(ms: number | null | undefined): string {
  return ms ? new Date(ms).toLocaleString() : "an unknown date";
}

async function postJson(url: string, body: unknown): Promise<{ ok: boolean; status: number; data: any }> {
  const res = await apiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    credentials: "include",
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

export function MigrationsTab() {
  const { toast } = useToast();
  const { isValidated } = useDebugAuth();
  const [starting, setStarting] = useState<string | null>(null);
  const [rerunTarget, setRerunTarget] = useState<MigrationItem | null>(null);
  const [markDoneTarget, setMarkDoneTarget] = useState<MigrationItem | null>(null);
  const [markDoneNote, setMarkDoneNote] = useState("");
  const [markingDone, setMarkingDone] = useState(false);

  const { data: migrations, isLoading, error } = useQuery<MigrationItem[]>({
    queryKey: QUERY_KEY,
    enabled: isValidated === true,
    refetchInterval: (query) => (query.state.data?.some((m) => m.running) ? 3000 : false),
  });

  async function start(migration: MigrationItem, mode: "run" | "dry_run", confirmRerun = false) {
    setStarting(`${migration.filename}:${mode}`);
    try {
      const { ok, data } = await postJson("/api/migrations/run", {
        filename: migration.filename,
        mode,
        confirm_rerun: confirmRerun,
      });
      if (!ok) {
        if (data.code === "already_completed") {
          setRerunTarget(migration);
          return;
        }
        toast({ title: "Could not start", description: data.error || "Unknown error", variant: "destructive" });
        return;
      }
      toast({ title: mode === "dry_run" ? "Dry run started" : "Migration started" });
    } catch (err) {
      toast({ title: "Could not start", description: String(err), variant: "destructive" });
    } finally {
      setStarting(null);
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    }
  }

  async function confirmMarkDone() {
    if (!markDoneTarget) return;
    setMarkingDone(true);
    try {
      const { ok, data } = await postJson("/api/migrations/mark-done", {
        filename: markDoneTarget.filename,
        note: markDoneNote.trim() || undefined,
      });
      if (!ok) {
        toast({ title: "Could not mark as done", description: data.error || "Unknown error", variant: "destructive" });
        return;
      }
      toast({ title: "Marked as done" });
      setMarkDoneTarget(null);
      setMarkDoneNote("");
    } finally {
      setMarkingDone(false);
      queryClient.invalidateQueries({ queryKey: QUERY_KEY });
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center gap-2 pb-4">
        <IconCode className="h-5 w-5 text-muted-foreground" />
        <CardTitle className="text-base">Migrations</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <IconLoader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <p className="text-sm text-destructive py-4 text-center" data-testid="text-migrations-error">
            {String((error as Error).message || error)}
          </p>
        ) : !migrations || migrations.length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">No migration scripts found.</p>
        ) : (
          <div className="space-y-3">
            <div className="flex items-start gap-2">
              <p className="text-xs text-muted-foreground flex-1">
                One-time fixes for this site's data. Each one is recorded when it finishes, so it isn't run twice by
                accident. Use Dry run to see what would change first.
              </p>
              <AdvancedPopover />
            </div>
            <div className="space-y-2">
              {migrations.map((migration) => (
                <MigrationRow
                  key={migration.filename}
                  migration={migration}
                  starting={starting}
                  onStart={(mode) =>
                    mode === "run" && migration.completed ? setRerunTarget(migration) : start(migration, mode)
                  }
                  onMarkDone={() => {
                    setMarkDoneNote("");
                    setMarkDoneTarget(migration);
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </CardContent>

      <AlertDialog open={!!rerunTarget} onOpenChange={(open) => !open && setRerunTarget(null)}>
        <AlertDialogContent data-testid="dialog-migration-rerun">
          <AlertDialogHeader>
            <AlertDialogTitle>Run this migration again?</AlertDialogTitle>
            <AlertDialogDescription>
              This already finished on {formatWhen(rerunTarget?.completed?.at)}. Running it again is usually safe but
              should be deliberate.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-migration-rerun-cancel">Cancel</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-migration-rerun-confirm"
              onClick={() => {
                const target = rerunTarget;
                setRerunTarget(null);
                if (target) void start(target, "run", true);
              }}
            >
              Run again
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!markDoneTarget} onOpenChange={(open) => !open && !markingDone && setMarkDoneTarget(null)}>
        <AlertDialogContent data-testid="dialog-migration-mark-done">
          <AlertDialogHeader>
            <AlertDialogTitle>Mark as done?</AlertDialogTitle>
            <AlertDialogDescription>
              Use this only when the migration was already run outside this page. Nothing runs; it is just recorded as
              done.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="migration-mark-done-note" className="text-xs">
              Note (optional)
            </Label>
            <Textarea
              id="migration-mark-done-note"
              value={markDoneNote}
              onChange={(e) => setMarkDoneNote(e.target.value)}
              placeholder="e.g. Ran from the terminal last week"
              rows={2}
              data-testid="input-migration-mark-done-note"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={markingDone}>Cancel</AlertDialogCancel>
            <Button onClick={confirmMarkDone} disabled={markingDone} data-testid="button-migration-mark-done-confirm">
              {markingDone && <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />}
              Mark as done
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function AdvancedPopover() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="link" size="sm" className="h-auto p-0 text-xs shrink-0" data-testid="button-migrations-advanced">
          Read more (advanced)
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 text-xs space-y-2 leading-relaxed" align="end">
        <p>
          Runs are recorded in each site's <code className="font-mono">data/&lt;site&gt;/app.db</code>, table{" "}
          <code className="font-mono">data_migration_runs</code>. Production and local computers keep separate
          records.
        </p>
        <p>
          <span className="font-medium">All sites</span> migrations are recorded once, in the first site in{" "}
          <code className="font-mono">sites.yml</code>, so every site shows the same status.{" "}
          <span className="font-medium">This site</span> migrations run and record per site and receive{" "}
          <code className="font-mono">MIGRATION_SITE</code>.
        </p>
        <p>
          Header tags in <code className="font-mono">scripts/migrations/NNN_name.ts</code>:{" "}
          <code className="font-mono">@scope site|all</code>, <code className="font-mono">@dry-run</code>,{" "}
          <code className="font-mono">@timeout &lt;seconds&gt;</code> (default 120, max 1800),{" "}
          <code className="font-mono">@production-only</code>.
        </p>
        <p>
          Production means <code className="font-mono">NODE_ENV=production</code> and{" "}
          <code className="font-mono">SITE_URL</code> points at a domain listed in{" "}
          <code className="font-mono">sites.yml</code>.
        </p>
      </PopoverContent>
    </Popover>
  );
}

function MigrationRow({
  migration,
  starting,
  onStart,
  onMarkDone,
}: {
  migration: MigrationItem;
  starting: string | null;
  onStart: (mode: "run" | "dry_run") => void;
  onMarkDone: () => void;
}) {
  const { filename, completed, running, blocked_here: blocked } = migration;
  const busy = running || (starting?.startsWith(`${filename}:`) ?? false);
  const last = migration.last_run;
  const showOutput = last && last.mode !== "mark_done" && (last.output || last.status !== "running");
  const lastOk = last?.status === "succeeded";

  return (
    <div className="space-y-2" data-testid={`row-migration-${filename}`}>
      <div className="px-3 py-2.5 rounded-md border space-y-1.5">
        <div className="flex items-center gap-2">
          <code
            className="text-xs font-mono text-muted-foreground flex-1 truncate"
            data-testid={`text-migration-name-${filename}`}
          >
            {filename}
          </code>
          <Badge variant="outline" className="text-[10px] font-normal shrink-0" data-testid={`badge-migration-scope-${filename}`}>
            {migration.scope === "site" ? "This site" : "All sites"}
          </Badge>
          {migration.scope_missing && (
            <Badge
              variant="outline"
              className="text-[10px] font-normal shrink-0 border-amber-500/40 text-amber-600 dark:text-amber-400"
              title="This file does not say whether it is for this site or all sites, so it is treated as All sites."
            >
              Reach not declared
            </Badge>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                title="About this migration"
                data-testid={`button-info-migration-${filename}`}
              >
                <IconInfoCircle className="h-4 w-4 text-muted-foreground" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-72 text-sm" side="left" align="start">
              <p className="font-medium mb-1">{migration.name}</p>
              <p className="text-muted-foreground text-xs leading-relaxed">{migration.description}</p>
              {migration.scope === "all" && (
                <p className="text-muted-foreground text-xs leading-relaxed mt-2">
                  All sites: its status is shared across every site.
                </p>
              )}
            </PopoverContent>
          </Popover>
          {migration.supports_dry_run && (
            <Button
              variant="outline"
              size="sm"
              className="h-8"
              onClick={() => onStart("dry_run")}
              disabled={busy}
              data-testid={`button-dry-run-migration-${filename}`}
            >
              <IconEye className="h-4 w-4 mr-1.5" />
              Dry run
            </Button>
          )}
          <Button
            variant={completed ? "ghost" : "default"}
            size="sm"
            className="h-8"
            onClick={() => onStart("run")}
            disabled={busy || blocked}
            title={blocked ? PRODUCTION_ONLY_HINT : undefined}
            data-testid={`button-run-migration-${filename}`}
          >
            {busy ? (
              <IconLoader2 className="h-4 w-4 mr-1.5 animate-spin" />
            ) : completed ? (
              <IconRefresh className="h-4 w-4 mr-1.5" />
            ) : (
              <IconPlayerPlay className="h-4 w-4 mr-1.5" />
            )}
            {running ? "Running…" : completed ? "Run again" : "Run"}
          </Button>
          {!completed && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  title="More actions"
                  disabled={busy}
                  data-testid={`button-more-migration-${filename}`}
                >
                  <IconDots className="h-4 w-4 text-muted-foreground" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem
                  onSelect={onMarkDone}
                  disabled={blocked}
                  data-testid={`menu-mark-done-migration-${filename}`}
                >
                  Mark as done
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        {(completed || blocked || migration.changed_since_completed) && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {completed && (
              <span className="flex items-center gap-1 text-muted-foreground" data-testid={`text-migration-completed-${filename}`}>
                <IconCheck className="h-3.5 w-3.5 text-green-600 dark:text-green-500" />
                {completed.mode === "mark_done" ? "Marked as done" : "Completed"} on {formatWhen(completed.at)}
                {completed.by ? ` by ${completed.by}` : ""}
                {completed.note ? ` · ${completed.note}` : ""}
              </span>
            )}
            {migration.changed_since_completed && (
              <span
                className="flex items-center gap-1 text-amber-600 dark:text-amber-400"
                title="The script changed after it finished. Check what changed before running it again."
                data-testid={`badge-migration-changed-${filename}`}
              >
                <IconAlertTriangle className="h-3.5 w-3.5" />
                Changed since it was completed
              </span>
            )}
            {blocked && (
              <span className="text-muted-foreground" data-testid={`text-migration-production-only-${filename}`}>
                {PRODUCTION_ONLY_HINT}
              </span>
            )}
          </div>
        )}
      </div>

      {showOutput && last && (
        <div
          className={cn(
            "rounded-md border text-xs",
            last.status === "running"
              ? "border-border bg-muted/30"
              : lastOk
                ? "border-green-500/30 bg-green-500/5"
                : "border-destructive/30 bg-destructive/5",
          )}
          data-testid={`text-migration-output-${filename}`}
        >
          <div className="flex items-center gap-1.5 px-3 pt-2 text-muted-foreground">
            {last.status === "running" ? (
              <IconLoader2 className="h-3.5 w-3.5 animate-spin" />
            ) : lastOk ? (
              <IconCheck className="h-3.5 w-3.5 text-green-600 dark:text-green-500" />
            ) : (
              <IconAlertCircle className="h-3.5 w-3.5 text-destructive" />
            )}
            <span className="flex-1">
              {last.mode === "dry_run" ? "Last dry run" : "Last run"} · {STATUS_LABEL[last.status]} ·{" "}
              {formatWhen(last.finished_at ?? last.started_at)}
              {last.actor ? ` · ${last.actor}` : ""}
            </span>
            {last.output && <CopyOutputButton text={last.output} filename={filename} />}
          </div>
          <pre
            className={cn(
              "font-mono px-3 py-2 overflow-auto max-h-48 whitespace-pre-wrap",
              !lastOk && last.status !== "running" ? "text-destructive" : "text-foreground",
            )}
          >
            {last.output || (last.status === "running" ? "Waiting for output…" : lastOk ? "Done." : "No output.")}
          </pre>
        </div>
      )}
    </div>
  );
}

function CopyOutputButton({ text, filename }: { text: string; filename: string }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      toast({
        title: "Could not copy output",
        description: "Allow clipboard access and try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <Button
      variant="ghost"
      size="sm"
      className="h-6 px-2 text-xs"
      onClick={copy}
      title="Copy output"
      data-testid={`button-copy-migration-output-${filename}`}
    >
      {copied ? (
        <IconCheck className="h-3.5 w-3.5 mr-1 text-green-600 dark:text-green-500" />
      ) : (
        <IconCopy className="h-3.5 w-3.5 mr-1" />
      )}
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}
