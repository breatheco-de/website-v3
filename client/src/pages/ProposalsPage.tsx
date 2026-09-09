import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { IconCloudDownload, IconLoader2 } from "@tabler/icons-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { apiFetch, apiRequestWithAuth } from "@/lib/queryClient";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import { useToast } from "@/hooks/use-toast";

export const AGENTS_PROPOSALS_BASE = "/private/agents/proposals";

type EntryRow = {
  id: number;
  contentType: string;
  slug: string;
  locale: string;
  variant: string | null;
  status: string;
  last_error: string | null;
  ops: Array<{ field_path: string; value?: unknown }>;
  baseline_context: { values: Record<string, unknown>; note?: string };
};

type BlockerRow = {
  id: number;
  body: string;
  status: string;
  author: string;
  created_at: number;
  resolve_note: string | null;
  resolved_by: string | null;
};

type Proposal = {
  id: string;
  title: string;
  summary: string;
  kind: string;
  status: string;
  review_mode?: string;
  promote_on_apply?: boolean;
  open_blocker_count?: number;
  proposer_username: string;
  related_issue_ids: string[];
  entries: EntryRow[];
  blockers?: BlockerRow[];
  claim?: { by: string; expiresAt: string } | null;
  created_at: number;
};

function headers(): Record<string, string> {
  return { "Content-Type": "application/json", ...getSessionHeaders() };
}

function reviewModeBadge(p: Proposal): { label: string; variant: "default" | "secondary" | "outline" } {
  if (p.review_mode === "draft_backed" || p.promote_on_apply) {
    return { label: "Includes draft (go-live)", variant: "default" };
  }
  if (p.review_mode === "soft_variant" || p.entries?.some((e) => e.variant)) {
    return { label: "Soft on draft", variant: "secondary" };
  }
  return { label: "Soft suggestion", variant: "outline" };
}

function previewHref(entry: EntryRow): string | null {
  if (!entry.variant) return null;
  return `/private/preview/${encodeURIComponent(entry.contentType)}/${encodeURIComponent(entry.slug)}?locale=${encodeURIComponent(entry.locale)}&force_variant=${encodeURIComponent(entry.variant)}`;
}

/** @deprecated Prefer Agents org-chart shell at /private/agents/proposals */
export default function ProposalsPage() {
  const params = useParams<{ id?: string }>();
  const id = params.id;
  if (id) return <ProposalDetailPanel id={id} />;
  return <ProposalListPanel />;
}

export function ProposalListPanel() {
  const [q, setQ] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [pullProductionOpen, setPullProductionOpen] = useState(false);
  const [pullingProduction, setPullingProduction] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ["/api/admin/proposals", q],
    queryFn: async () => {
      const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
      const res = await apiFetch(`/api/admin/proposals${qs}`, { headers: headers() });
      if (!res.ok) throw new Error("Failed to load proposals");
      return res.json() as Promise<{ proposals: Proposal[] }>;
    },
  });

  const pullProduction = async () => {
    if (!import.meta.env.DEV) return;
    // Close confirm first so the production-token Dialog is not trapped under AlertDialog.
    setPullProductionOpen(false);
    setPullingProduction(true);
    try {
      const res = await apiRequestWithAuth("POST", "/api/admin/proposals/pull-production", {});
      const body = (await res.json()) as {
        imported?: number;
        productionOrigin?: string;
        reason?: string;
        error?: string;
      };
      await queryClient.invalidateQueries({ queryKey: ["/api/admin/proposals"] });
      toast({
        title: "Production proposals loaded",
        description: `Imported ${body.imported ?? 0} proposals from ${body.productionOrigin ?? "production"}.`,
      });
    } catch (err) {
      toast({
        title: "Could not load production proposals",
        description: err instanceof Error ? err.message : "Download failed.",
        variant: "destructive",
      });
    } finally {
      setPullingProduction(false);
    }
  };

  return (
    <div className="space-y-6" data-testid="panel-agents-proposals">
      <div>
        <p className="text-sm text-muted-foreground">
          Proposals are suggested entry changes or handoff notes. They do not change the live site until
          someone else applies edits or acknowledges a notes handoff. Soft suggestions patch fields;
          proposals that include a draft must be previewed before approve — go-live proposals promote that
          draft. Open blockers mean not ready to approve (you can still reject).
        </p>
        <Collapsible open={advanced} onOpenChange={setAdvanced}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-auto px-0 mt-1 text-xs text-muted-foreground">
              {advanced ? "Hide advanced" : "Read more (advanced)"}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="text-xs text-muted-foreground space-y-1 mt-1">
            <p>Stored in per-site SQLite (data/&lt;site&gt;/app.db). Exact fingerprint blocks clones; similar open proposals need confirm_distinct. One open proposal per draft variant.</p>
            <p>MCP: propose_change and list_proposals need content_view or seo_edit. update_proposal needs content_edit_text or seo_edit. Apply is four-eyes. Claimant-only resolve for blockers.</p>
            <p>Issue panels only list proposals linked to that issue. This page lists everything.</p>
          </CollapsibleContent>
        </Collapsible>
      </div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input
          className="flex-1"
          placeholder="Search proposals"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          data-testid="input-proposal-search"
        />
        {import.meta.env.DEV ? (
          <Button
            type="button"
            variant="outline"
            disabled={pullingProduction}
            onClick={() => setPullProductionOpen(true)}
            data-testid="button-pull-production-proposals"
          >
            {pullingProduction ? (
              <IconLoader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <IconCloudDownload className="h-4 w-4 mr-2" />
            )}
            {pullingProduction ? "Downloading…" : "Download from production"}
          </Button>
        ) : null}
      </div>
      <AlertDialog open={pullProductionOpen} onOpenChange={setPullProductionOpen}>
        <AlertDialogContent data-testid="dialog-pull-production-proposals">
          <AlertDialogHeader>
            <AlertDialogTitle>Download production proposals?</AlertDialogTitle>
            <AlertDialogDescription>
              This replaces your local proposal list with production&apos;s. You may be asked for a
              production staff token (not your localhost login). Draft YAML and live content are not
              downloaded — only proposal records. Nothing is uploaded back to production.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              disabled={pullingProduction}
              onClick={() => void pullProduction()}
              data-testid="button-confirm-pull-production-proposals"
            >
              <IconCloudDownload className="h-4 w-4 mr-2" />
              Download from production
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      <div className="space-y-2">
        {(data?.proposals ?? []).map((p) => {
          const mode = reviewModeBadge(p);
          return (
            <Link key={p.id} href={`${AGENTS_PROPOSALS_BASE}/${p.id}`}>
              <Card className="hover-elevate cursor-pointer" data-testid={`card-proposal-${p.id}`}>
                <CardHeader className="py-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <CardTitle className="text-sm font-medium">{p.title}</CardTitle>
                    <Badge variant="secondary">{p.status}</Badge>
                    <Badge variant="outline">{p.kind}</Badge>
                    <Badge variant={mode.variant}>{mode.label}</Badge>
                    {(p.open_blocker_count ?? 0) > 0 && (
                      <Badge variant="destructive">{p.open_blocker_count} blockers</Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2">{p.summary}</p>
                </CardHeader>
              </Card>
            </Link>
          );
        })}
        {!isLoading && (data?.proposals ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">No proposals yet.</p>
        )}
      </div>
    </div>
  );
}

export function ProposalDetailPanel({ id }: { id: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [blockerBody, setBlockerBody] = useState("");
  const [resolveNotes, setResolveNotes] = useState<Record<number, string>>({});
  const [confirmExperiment, setConfirmExperiment] = useState(false);
  const [advanced, setAdvanced] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["/api/admin/proposals", id],
    queryFn: async () => {
      const res = await apiFetch(`/api/admin/proposals/${id}`, { headers: headers() });
      if (!res.ok) throw new Error("Not found");
      return res.json() as Promise<{ proposal: Proposal }>;
    },
  });

  const mut = useMutation({
    mutationFn: async (payload: { action: string; body?: Record<string, unknown> }) => {
      const res = await apiFetch(`/api/admin/proposals/${id}/${payload.action}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(payload.body ?? {}),
      });
      const json = await res.json();
      if (!res.ok) throw Object.assign(new Error(json.error || "Action failed"), { data: json });
      return json;
    },
    onSuccess: (json) => {
      qc.invalidateQueries({ queryKey: ["/api/admin/proposals"] });
      toast({ title: "Updated" });
      if (json.warnings?.length) {
        toast({
          title: json.warnings[0].message,
          variant: "default",
        });
      }
    },
    onError: (e: Error & { data?: { code?: string; traffic_siblings?: unknown } }) => {
      toast({ title: e.message, variant: "destructive" });
      if (e.data?.code === "confirm_end_experiment") {
        setConfirmExperiment(true);
      }
    },
  });

  const p = data?.proposal;
  const mode = p ? reviewModeBadge(p) : null;
  const claimActive =
    p?.claim && new Date(p.claim.expiresAt).getTime() > Date.now() ? p.claim : null;
  const sessionUser =
    typeof window !== "undefined"
      ? (window as unknown as { __debugUsername?: string }).__debugUsername
      : undefined;
  // Resolve enabled when any staff holds claim — server enforces claimant match via session author.
  const canResolveUi = Boolean(claimActive);

  return (
    <div className="space-y-6" data-testid="panel-agents-proposal-detail">
      <Button variant="ghost" size="sm" asChild>
        <Link href={AGENTS_PROPOSALS_BASE}>Back</Link>
      </Button>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {p && mode && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-semibold">{p.title}</h2>
            <Badge>{p.status}</Badge>
            <Badge variant="outline">{p.kind}</Badge>
            <Badge variant={mode.variant}>{mode.label}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">Proposed by {p.proposer_username}</p>
          {p.review_mode === "draft_backed" || p.promote_on_apply ? (
            <p className="text-sm">
              This proposal includes a prepared draft. Preview that version before you approve or reject.
              Approving makes that draft the live page for this locale. Open blockers block approve;
              clearing them still requires a fresh preview — resolving means the acceptance criteria were
              met, not “I disagree.”
            </p>
          ) : p.review_mode === "soft_variant" || p.entries.some((e) => e.variant) ? (
            <p className="text-sm">
              Soft suggestion on a draft. Approving writes the proposed field changes into that draft —
              it does not go live. Preview the draft before deciding.
            </p>
          ) : (
            <p className="text-sm">
              Soft suggestion only. Nothing is live until you apply. There is no separate draft page to
              preview unless an entry lists a variant.
            </p>
          )}
          <p className="text-sm">{p.summary}</p>
          {p.related_issue_ids.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Linked issues: {p.related_issue_ids.join(", ")}
            </p>
          )}
          {claimActive && (
            <p className="text-xs text-muted-foreground">
              Claimed by {claimActive.by} until {new Date(claimActive.expiresAt).toLocaleString()}
            </p>
          )}

          {p.kind === "edits" && (
            <div className="space-y-3">
              {p.entries.map((e) => {
                const href = previewHref(e);
                return (
                  <Card key={e.id}>
                    <CardHeader className="py-3">
                      <CardTitle className="text-sm">
                        {e.contentType}/{e.slug} ({e.locale})
                        {e.variant ? ` · draft ${e.variant}` : ""} — {e.status}
                      </CardTitle>
                      {href && (
                        <Button variant="outline" size="sm" asChild className="w-fit mt-2">
                          <a href={href} target="_blank" rel="noreferrer">
                            Preview draft
                          </a>
                        </Button>
                      )}
                    </CardHeader>
                    <CardContent className="text-xs space-y-2">
                      {e.last_error && <p className="text-destructive">{e.last_error}</p>}
                      {e.ops.length === 0 && (p.promote_on_apply || p.review_mode === "draft_backed") && (
                        <p className="text-muted-foreground">
                          No field-diff list — the attached draft is the change. Preview it before approve.
                        </p>
                      )}
                      {e.ops.map((op) => (
                        <div key={op.field_path} className="border rounded p-2">
                          <p className="font-mono">{op.field_path}</p>
                          <p className="text-muted-foreground">
                            Then: {JSON.stringify(e.baseline_context.values[op.field_path])}
                          </p>
                          <p>Proposed: {JSON.stringify(op.value)}</p>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}

          <Card>
            <CardHeader className="py-3">
              <CardTitle className="text-sm">
                Blockers {(p.open_blocker_count ?? 0) > 0 ? `(${p.open_blocker_count} open)` : ""}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {(p.blockers ?? []).length === 0 && (
                <p className="text-xs text-muted-foreground">No blockers yet.</p>
              )}
              {(p.blockers ?? []).map((b) => (
                <div key={b.id} className="border rounded p-3 space-y-2 text-sm">
                  <div className="flex gap-2 items-center">
                    <Badge variant={b.status === "open" ? "destructive" : "secondary"}>{b.status}</Badge>
                    <span className="text-xs text-muted-foreground">by {b.author}</span>
                  </div>
                  <p className="whitespace-pre-wrap">{b.body}</p>
                  {b.resolve_note && (
                    <p className="text-xs text-muted-foreground">
                      Resolved by {b.resolved_by}: {b.resolve_note}
                    </p>
                  )}
                  {b.status === "open" && canResolveUi && (
                    <div className="space-y-2">
                      <Textarea
                        placeholder="What changed (min 20 chars)"
                        value={resolveNotes[b.id] ?? ""}
                        onChange={(ev) =>
                          setResolveNotes((prev) => ({ ...prev, [b.id]: ev.target.value }))
                        }
                        data-testid={`input-resolve-blocker-${b.id}`}
                      />
                      <Button
                        size="sm"
                        disabled={mut.isPending}
                        onClick={() =>
                          mut.mutate({
                            action: "resolve_blocker",
                            body: { blocker_id: b.id, resolve_note: resolveNotes[b.id] },
                          })
                        }
                        data-testid={`button-resolve-blocker-${b.id}`}
                      >
                        Resolve (claimant)
                      </Button>
                    </div>
                  )}
                  {b.status === "resolved" && (
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={mut.isPending}
                      onClick={() => mut.mutate({ action: "reopen_blocker", body: { blocker_id: b.id } })}
                    >
                      Reopen
                    </Button>
                  )}
                </div>
              ))}
              <div className="space-y-2 pt-2 border-t">
                <p className="text-xs text-muted-foreground">
                  Add blocker: what’s wrong, what fixed looks like, and why (min 80 characters). No tool lists.
                </p>
                <Textarea
                  placeholder="On draft …, X is wrong. It must be Y because …"
                  value={blockerBody}
                  onChange={(e) => setBlockerBody(e.target.value)}
                  data-testid="input-add-blocker"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={mut.isPending || blockerBody.trim().length < 80}
                  onClick={() => {
                    mut.mutate({ action: "add_blocker", body: { body: blockerBody } });
                    setBlockerBody("");
                  }}
                  data-testid="button-add-blocker"
                >
                  Add blocker
                </Button>
              </div>
            </CardContent>
          </Card>

          <Collapsible open={advanced} onOpenChange={setAdvanced}>
            <CollapsibleTrigger asChild>
              <Button variant="ghost" size="sm" className="h-auto px-0 text-xs text-muted-foreground">
                {advanced ? "Hide advanced" : "Read more (advanced)"}
              </Button>
            </CollapsibleTrigger>
            <CollapsibleContent className="text-xs text-muted-foreground space-y-1">
              <p>Promote copies the draft over live for one locale; SEO cluster on live is preserved when promoting over an existing live file.</p>
              <p>Ending an experiment deletes other traffic-bearing variants after confirm. Claim TTL is 30 minutes; only the claimant resolves blockers.</p>
              <p>Variant attachment is write-once in the creating agent session.</p>
            </CollapsibleContent>
          </Collapsible>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() => mut.mutate({ action: "claim" })}
              disabled={mut.isPending}
              data-testid="button-claim-proposal"
            >
              Claim
            </Button>
            <Button
              variant="ghost"
              onClick={() => mut.mutate({ action: "release", body: { report: "Released after review work. ".repeat(4) } })}
              disabled={mut.isPending}
            >
              Release
            </Button>
            {p.kind === "edits" && p.status !== "finished" && p.status !== "rejected" && p.status !== "withdrawn" && (
              <Button
                onClick={() =>
                  mut.mutate({
                    action: "apply",
                    body: confirmExperiment ? { confirm_end_experiment: true } : {},
                  })
                }
                disabled={mut.isPending || (p.open_blocker_count ?? 0) > 0}
                data-testid="button-apply-proposal"
              >
                {p.promote_on_apply || p.review_mode === "draft_backed"
                  ? confirmExperiment
                    ? "Confirm end experiment & make draft live"
                    : "Approve and make draft live"
                  : "Apply remaining"}
              </Button>
            )}
            {p.kind === "notes" && p.status === "open" && (
              <Button onClick={() => mut.mutate({ action: "acknowledge" })} disabled={mut.isPending} data-testid="button-acknowledge-proposal">
                Acknowledge
              </Button>
            )}
            {p.status !== "finished" && p.status !== "rejected" && p.status !== "withdrawn" && (
              <>
                <Button variant="outline" onClick={() => mut.mutate({ action: "reject" })} disabled={mut.isPending}>
                  Reject
                </Button>
                <Button variant="ghost" onClick={() => mut.mutate({ action: "withdraw" })} disabled={mut.isPending}>
                  Withdraw
                </Button>
              </>
            )}
          </div>
          {confirmExperiment && (
            <p className="text-sm text-destructive">
              Other versions still have traffic. Confirming will remove those traffic-bearing variants when
              this draft goes live.
            </p>
          )}
          {(p.open_blocker_count ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground">
              Apply is disabled while blockers are open. Reject and withdraw remain available.
            </p>
          )}
          {sessionUser ? null : null}
        </>
      )}
    </div>
  );
}
