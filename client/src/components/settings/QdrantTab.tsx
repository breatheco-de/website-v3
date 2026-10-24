import { useState } from "react";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  IconAlertCircle,
  IconChevronDown,
  IconCircleCheck,
  IconDatabase,
  IconInfoCircle,
  IconLoader2,
  IconPlugConnected,
  IconSparkles,
} from "@tabler/icons-react";
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
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import { queryClient } from "@/lib/queryClient";
import { cn } from "@/lib/utils";

interface JobState {
  status: "idle" | "queued" | "waiting_worker" | "running" | "done" | "error";
  fetched?: number;
  total?: number | null;
  startedAt?: string;
  finishedAt?: string;
  error?: string;
  embedded?: number;
  unchanged?: number;
  deleted?: number;
}

interface QdrantStatusResponse {
  worker_running: boolean;
  unused_collections: string[];
  available: boolean;
  url: string;
  host: string;
  port: number;
  embedding_model: string;
  vector_size: number;
  distance: string;
  error: string | null;
  embedder_loaded: boolean;
  collections: Array<{ name: string; points_count: number }>;
  databases: Array<{
    name: string;
    label: string;
    semantic_enabled: boolean;
    fields: string[];
    collection: string;
    ready: boolean;
    served_collection: string | null;
    collection_points: number | null;
    index: JobState;
  }>;
}

const ACTIVE_STATUSES: JobState["status"][] = ["queued", "waiting_worker", "running"];

export function QdrantTab() {
  const { toast } = useToast();
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [testing, setTesting] = useState(false);
  const [reindexing, setReindexing] = useState<string | null>(null);
  const [advancedDb, setAdvancedDb] = useState<string | null>(null);
  const [rebuildTarget, setRebuildTarget] = useState<string | null>(null);

  const statusQuery = useQuery<QdrantStatusResponse>({
    queryKey: ["/api/admin/qdrant/status"],
    queryFn: async () => {
      const res = await fetch("/api/admin/qdrant/status", { headers: getSessionHeaders() });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `Failed to load Qdrant status (${res.status})`);
      }
      return body as QdrantStatusResponse;
    },
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.databases.some((db) => db.semantic_enabled && ACTIVE_STATUSES.includes(db.index.status))
        ? 5000
        : false,
  });

  const data = statusQuery.data;
  const semanticDatabases = data?.databases.filter((db) => db.semantic_enabled) ?? [];
  const unusedCollections = new Set(data?.unused_collections ?? []);

  async function handleRebuild(dbName: string) {
    setRebuildTarget(null);
    setReindexing(dbName);
    try {
      const res = await fetch(`/api/admin/qdrant/rebuild/${encodeURIComponent(dbName)}`, {
        method: "POST",
        headers: getSessionHeaders(),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `Rebuild failed (${res.status})`);
      }
      toast({
        title: body.already_queued ? "Rebuild already queued" : "Rebuild queued",
        description: `${dbName} will be rebuilt from scratch in the background.`,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/qdrant/status"] });
    } catch (err) {
      toast({
        title: "Rebuild failed",
        description: err instanceof Error ? err.message : "Could not queue rebuild.",
        variant: "destructive",
      });
    } finally {
      setReindexing(null);
    }
  }

  async function handleTestConnection() {
    setTesting(true);
    try {
      const res = await fetch("/api/admin/qdrant/test", {
        method: "POST",
        headers: getSessionHeaders(),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok || !body.ok) {
        throw new Error(body.error || `Connection failed (${res.status})`);
      }
      toast({
        title: "Connection OK",
        description:
          typeof body.collections_count === "number"
            ? `${body.host}:${body.port} reachable · ${body.collections_count} collection${
                body.collections_count === 1 ? "" : "s"
              }.`
            : `${body.host}:${body.port} reachable.`,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/qdrant/status"] });
    } catch (err) {
      toast({
        title: "Connection failed",
        description: err instanceof Error ? err.message : "Could not reach Qdrant.",
        variant: "destructive",
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/qdrant/status"] });
    } finally {
      setTesting(false);
    }
  }

  async function handleReindex(dbName: string) {
    setReindexing(dbName);
    try {
      const res = await fetch(`/api/databases/${encodeURIComponent(dbName)}/reindex`, {
        method: "POST",
        headers: getSessionHeaders(),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(body.error || `Re-index failed (${res.status})`);
      }
      toast({
        title: body.already_queued ? "Re-index already queued" : "Re-index queued",
        description: `Checking ${body.count ?? "all"} items in ${dbName}; only changed ones are updated.`,
      });
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/qdrant/status"] });
    } catch (err) {
      toast({
        title: "Re-index failed",
        description: err instanceof Error ? err.message : "Could not start re-index.",
        variant: "destructive",
      });
    } finally {
      setReindexing(null);
    }
  }

  return (
    <div className="space-y-6">
      <Card data-testid="panel-qdrant-connection">
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-4">
          <div className="flex items-center gap-2">
            <IconPlugConnected className="h-5 w-5 text-muted-foreground" />
            <CardTitle className="text-base">Connection</CardTitle>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={handleTestConnection}
            disabled={testing || statusQuery.isLoading}
            data-testid="button-qdrant-test-connection"
          >
            {testing ? (
              <IconLoader2 className="h-4 w-4 animate-spin mr-1.5" />
            ) : (
              <IconPlugConnected className="h-4 w-4 mr-1.5" />
            )}
            {testing ? "Testing…" : "Test connection"}
          </Button>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Live check against the configured vector store used for semantic search. Test connection
            does not re-index databases or change settings.
          </p>

          {statusQuery.isLoading && !data ? (
            <div className="flex items-center gap-2 text-muted-foreground py-4">
              <IconLoader2 className="h-4 w-4 animate-spin" />
              <span className="text-sm">Checking Qdrant…</span>
            </div>
          ) : statusQuery.isError && !data ? (
            <div className="flex items-start gap-3 text-destructive">
              <IconAlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
              <p className="text-sm">
                {statusQuery.error instanceof Error
                  ? statusQuery.error.message
                  : "Failed to load Qdrant status."}
              </p>
            </div>
          ) : data ? (
            <>
              <div className="flex flex-wrap items-center gap-2">
                {data.available ? (
                  <Badge
                    variant="secondary"
                    className="gap-1 border-transparent bg-green-600/15 text-green-700 dark:bg-green-500/20 dark:text-green-400"
                    data-testid="badge-qdrant-reachable"
                  >
                    <IconCircleCheck className="h-3.5 w-3.5" />
                    Reachable
                  </Badge>
                ) : (
                  <Badge variant="destructive" className="gap-1" data-testid="badge-qdrant-unreachable">
                    <IconAlertCircle className="h-3.5 w-3.5" />
                    Unreachable
                  </Badge>
                )}
                <Badge variant="outline" className="font-mono text-xs" data-testid="badge-qdrant-host-port">
                  {data.host}:{data.port}
                </Badge>
                {data.embedder_loaded ? (
                  <Badge variant="secondary" className="text-xs">
                    Embedder warm
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-xs text-muted-foreground">
                    Embedder cold
                  </Badge>
                )}
              </div>

              <dl className="grid gap-2 text-sm">
                <div className="flex flex-col sm:flex-row sm:gap-3">
                  <dt className="text-muted-foreground sm:w-36 shrink-0">Address</dt>
                  <dd className="font-mono text-xs sm:text-sm" data-testid="text-qdrant-host">
                    {data.host}
                  </dd>
                </div>
                <div className="flex flex-col sm:flex-row sm:gap-3">
                  <dt className="text-muted-foreground sm:w-36 shrink-0">Port</dt>
                  <dd className="font-mono text-xs sm:text-sm" data-testid="text-qdrant-port">
                    {data.port}
                  </dd>
                </div>
                <div className="flex flex-col sm:flex-row sm:gap-3">
                  <dt className="text-muted-foreground sm:w-36 shrink-0">URL</dt>
                  <dd className="font-mono text-xs sm:text-sm break-all" data-testid="text-qdrant-url">
                    {data.url}
                  </dd>
                </div>
                <div className="flex flex-col sm:flex-row sm:gap-3">
                  <dt className="text-muted-foreground sm:w-36 shrink-0">Embedding model</dt>
                  <dd className="font-mono text-xs sm:text-sm break-all">{data.embedding_model}</dd>
                </div>
                <div className="flex flex-col sm:flex-row sm:gap-3">
                  <dt className="text-muted-foreground sm:w-36 shrink-0">Vectors</dt>
                  <dd className="text-xs sm:text-sm">
                    {data.vector_size}-d · {data.distance}
                  </dd>
                </div>
              </dl>

              {!data.available && (
                <div
                  className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-3 space-y-2"
                  data-testid="panel-qdrant-error"
                >
                  <p className="text-sm font-medium text-destructive">Why this failed</p>
                  <p className="text-sm text-destructive/90 font-mono break-all">
                    {data.error || "Could not reach Qdrant."}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    On the live server Qdrant starts with the website; locally, start it on port 6333.
                    Confirm the configured URL matches, then click Test connection. Until it is
                    reachable, semantic search falls back to exact keyword matching, and queued index
                    updates retry on their own.
                  </p>
                </div>
              )}
            </>
          ) : null}
        </CardContent>
      </Card>

      <Card data-testid="panel-qdrant-collections">
        <CardHeader className="flex flex-row items-center gap-2 pb-4">
          <IconDatabase className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">Collections</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Vector collections in Qdrant. Each database with semantic search gets its own collection
            for this site.
          </p>
          {!data?.available ? (
            <p className="text-sm text-muted-foreground">Collections unavailable while Qdrant is unreachable.</p>
          ) : data.collections.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-qdrant-collections-empty">
              No collections yet. Enable semantic search on a database and re-index to create one.
            </p>
          ) : (
            <div className="rounded-md border border-border overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-muted-foreground text-xs">
                  <tr>
                    <th className="text-left font-medium px-3 py-2">Name</th>
                    <th className="text-right font-medium px-3 py-2">Points</th>
                  </tr>
                </thead>
                <tbody>
                  {data.collections.map((col) => (
                    <tr key={col.name} className="border-t border-border" data-testid={`row-collection-${col.name}`}>
                      <td className="px-3 py-2 font-mono text-xs">
                        <span className="inline-flex flex-wrap items-center gap-2">
                          {col.name}
                          {unusedCollections.has(col.name) && (
                            <Badge
                              variant="outline"
                              className="font-sans text-[11px] text-muted-foreground"
                              title="No database uses this index. Turning semantic search back on reuses it."
                              data-testid={`badge-collection-unused-${col.name}`}
                            >
                              Not in use
                            </Badge>
                          )}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{col.points_count.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card data-testid="panel-qdrant-semantic-dbs">
        <CardHeader className="flex flex-row items-center gap-2 pb-4">
          <IconSparkles className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">Semantic databases</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Databases with semantic search turned on. Indexes update in the background when data
            changes; Re-index checks every item and updates only the ones that changed. Search keeps
            working meanwhile.
          </p>
          {data && !data.worker_running && (
            <p
              className="text-xs rounded-md border border-border bg-muted/40 px-3 py-2 text-muted-foreground"
              data-testid="text-qdrant-worker-down"
            >
              The background worker is not running, so index updates wait in line until it starts.
            </p>
          )}
          {semanticDatabases.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="text-semantic-dbs-empty">
              No databases have semantic search enabled. Open a database → Settings → Field Mappings and
              enable the vector index on one or more fields.
            </p>
          ) : (
            <div className="space-y-3">
              {semanticDatabases.map((db) => (
                <div
                  key={db.name}
                  className="rounded-md border border-border p-3 space-y-2"
                  data-testid={`card-semantic-db-${db.name}`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/private/databases/${encodeURIComponent(db.name)}`}
                          className="font-medium text-sm hover:underline"
                        >
                          {db.label}
                        </Link>
                        <span className="font-mono text-xs text-muted-foreground">{db.name}</span>
                        <IndexStatusBadge index={db.index} />
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Fields:{" "}
                        <code className="font-mono text-[11px]">{db.fields.join(", ") || "—"}</code>
                        {" · "}
                        Points:{" "}
                        {db.collection_points == null
                          ? "no collection"
                          : db.collection_points.toLocaleString()}
                      </p>
                      <IndexStatusLine db={db} />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!data?.available || reindexing === db.name || db.index.status === "running"}
                      onClick={() => handleReindex(db.name)}
                      title="Checks every item and updates only the ones that changed. Runs in the background; search keeps working meanwhile."
                      data-testid={`button-reindex-${db.name}`}
                    >
                      {reindexing === db.name || db.index.status === "running" ? (
                        <IconLoader2 className="h-3.5 w-3.5 animate-spin mr-1" />
                      ) : null}
                      Re-index
                    </Button>
                  </div>
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
                    onClick={() => setAdvancedDb((cur) => (cur === db.name ? null : db.name))}
                    data-testid={`button-toggle-db-advanced-${db.name}`}
                  >
                    {advancedDb === db.name ? "Hide advanced" : "Read more (advanced)"}
                    <IconChevronDown
                      className={cn("h-3.5 w-3.5 transition-transform", advancedDb === db.name && "rotate-180")}
                    />
                  </button>
                  {advancedDb === db.name && (
                    <div className="rounded-md border border-border bg-muted/40 p-3 space-y-2 text-xs text-muted-foreground">
                      <p>
                        Collection: <code className="font-mono text-[11px]">{db.collection}</code>
                        {db.served_collection && db.served_collection !== db.collection && (
                          <>
                            {" "}
                            (searches use{" "}
                            <code className="font-mono text-[11px]">{db.served_collection}</code> until
                            the first build finishes)
                          </>
                        )}
                        . Naming: <code className="font-mono text-[11px]">&lt;site folder&gt;__&lt;database&gt;</code>.
                      </p>
                      <p>
                        Rebuild from scratch deletes this index and builds it again. Use it only if
                        search results look wrong and Re-index does not fix them.
                      </p>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={!data?.available || reindexing === db.name || db.index.status === "running"}
                        onClick={() => setRebuildTarget(db.name)}
                        data-testid={`button-rebuild-${db.name}`}
                      >
                        Rebuild from scratch
                      </Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={rebuildTarget != null} onOpenChange={(open) => !open && setRebuildTarget(null)}>
        <AlertDialogContent data-testid="dialog-qdrant-rebuild">
          <AlertDialogHeader>
            <AlertDialogTitle>Rebuild {rebuildTarget} from scratch?</AlertDialogTitle>
            <AlertDialogDescription>
              Deletes this index and builds it again. Search uses keyword matching until it finishes
              (several minutes for large databases).
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => rebuildTarget && handleRebuild(rebuildTarget)}
              data-testid="button-confirm-qdrant-rebuild"
            >
              Rebuild
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Card data-testid="panel-qdrant-how-it-works">
        <CardHeader className="flex flex-row items-center gap-2 pb-4">
          <IconInfoCircle className="h-5 w-5 text-muted-foreground" />
          <CardTitle className="text-base">How semantic search works</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Semantic search needs three things: a reachable Qdrant instance, the local Xenova embedding
            model, and at least one database with vector fields indexed. When Qdrant is down, search falls
            back to exact keyword matching.
          </p>
          <ul className="list-disc pl-5 space-y-1 text-xs">
            <li>
              <span className="text-green-700 dark:text-green-400 font-medium">Green / Reachable</span> —
              Qdrant answered; semantic queries can run once indexes exist.
            </li>
            <li>
              <span className="text-destructive font-medium">Red / Unreachable</span> — connection failed;
              see the error above and fix host/port or Docker.
            </li>
            <li>
              “No collection” — the first index is being built (or waiting for the background worker).
              Search uses keyword matching until it finishes.
            </li>
          </ul>

          <button
            type="button"
            className="inline-flex items-center gap-1 text-xs font-medium text-foreground hover:underline"
            onClick={() => setShowAdvanced((v) => !v)}
            data-testid="button-toggle-qdrant-advanced"
          >
            {showAdvanced ? "Hide advanced details" : "Read more (advanced)"}
            <IconChevronDown
              className={cn("h-3.5 w-3.5 transition-transform", showAdvanced && "rotate-180")}
            />
          </button>

          {showAdvanced && (
            <div className="rounded-md border border-border bg-muted/40 p-3 space-y-3 text-xs">
              <div>
                <p className="font-medium text-foreground mb-1">Code &amp; config</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>
                    Runtime: <code className="font-mono text-[11px]">server/vector-search.ts</code>
                  </li>
                  <li>
                    Env: <code className="font-mono text-[11px]">QDRANT_URL</code> (default{" "}
                    <code className="font-mono text-[11px]">http://localhost:6333</code>)
                  </li>
                  <li>
                    Index jobs: Sidequest queue <code className="font-mono text-[11px]">vector_index</code>{" "}
                    (<code className="font-mono text-[11px]">server/jobs/definitions/vector-index-sync.ts</code>),
                    state in <code className="font-mono text-[11px]">.db-job-state.json</code>. Only rows whose
                    embedded text changed are re-embedded; rows without a slug are keyed by locale + text.
                  </li>
                  <li>
                    Status API: <code className="font-mono text-[11px]">GET /api/admin/qdrant/status</code>
                  </li>
                  <li>
                    Probe: <code className="font-mono text-[11px]">POST /api/admin/qdrant/test</code>
                  </li>
                </ul>
              </div>
              <div>
                <p className="font-medium text-foreground mb-1">Local Qdrant</p>
                <p>
                  Dashboard:{" "}
                  <a
                    href="http://localhost:6333/dashboard"
                    target="_blank"
                    rel="noreferrer"
                    className="underline text-foreground"
                  >
                    http://localhost:6333/dashboard
                  </a>

                  . Local only, example Docker:{" "}
                  <code className="font-mono text-[11px]">
                    docker run -d --name qdrant -p 6333:6333 qdrant/qdrant:v1.13.4
                  </code>
                  . On the VPS, pm2 runs the Qdrant binary with storage in{" "}
                  <code className="font-mono text-[11px]">.cache/qdrant-storage</code>.
                </p>
              </div>
              <div>
                <p className="font-medium text-foreground mb-1">Enable on a database</p>
                <p>
                  Private Databases → select DB → Settings → Field Mappings → include fields in the
                  semantic/vector index, then re-index.
                </p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function IndexStatusLine({ db }: { db: QdrantStatusResponse["databases"][number] }) {
  const { index } = db;
  let text: string | null = null;
  let destructive = false;
  if (index.status === "waiting_worker") {
    text = db.served_collection
      ? "Waiting for the background worker. Search keeps using the current index."
      : "Waiting for the background worker. Search uses keyword matching until this finishes.";
  } else if (index.status === "queued") {
    text = index.error ? index.error : "Queued.";
  } else if (index.status === "done") {
    text = `Up to date. ${(index.embedded ?? 0).toLocaleString()} updated, ${(index.unchanged ?? 0).toLocaleString()} unchanged${
      index.deleted ? `, ${index.deleted.toLocaleString()} removed` : ""
    }.`;
  } else if (index.status === "error") {
    destructive = true;
    text = "Could not reach the search index service after several tries. Try Re-index again once it is back.";
  }
  if (!text) return null;
  return (
    <div className="space-y-1">
      <p
        className={cn("text-xs", destructive ? "text-destructive" : "text-muted-foreground")}
        data-testid={`text-index-status-${db.name}`}
      >
        {text}
      </p>
      {index.status === "error" && index.error && (
        <p className="text-xs text-destructive font-mono break-all">{index.error}</p>
      )}
    </div>
  );
}

function IndexStatusBadge({ index }: { index: JobState }) {
  if (index.status === "queued" || index.status === "waiting_worker") {
    return (
      <Badge variant="outline" className="text-xs text-muted-foreground">
        {index.status === "waiting_worker" ? "Waiting for worker" : "Queued"}
      </Badge>
    );
  }
  if (index.status === "running") {
    return (
      <Badge variant="secondary" className="gap-1 text-xs">
        <IconLoader2 className="h-3 w-3 animate-spin" />
        Indexing
        {typeof index.fetched === "number" && typeof index.total === "number"
          ? ` ${index.fetched}/${index.total}`
          : ""}
      </Badge>
    );
  }
  if (index.status === "error") {
    return (
      <Badge variant="destructive" className="text-xs">
        Index error
      </Badge>
    );
  }
  if (index.status === "done") {
    return (
      <Badge
        variant="secondary"
        className="text-xs border-transparent bg-green-600/15 text-green-700 dark:bg-green-500/20 dark:text-green-400"
      >
        Indexed
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="text-xs text-muted-foreground">
      Never indexed
    </Badge>
  );
}
