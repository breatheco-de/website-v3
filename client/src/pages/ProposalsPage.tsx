import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { apiFetch } from "@/lib/queryClient";
import { getSessionHeaders } from "@/lib/sessionHeaders";
import { useToast } from "@/hooks/use-toast";

export const AGENTS_PROPOSALS_BASE = "/private/agents/proposals";

type EntryRow = {
  id: number;
  contentType: string;
  slug: string;
  locale: string;
  status: string;
  last_error: string | null;
  ops: Array<{ field_path: string; value?: unknown }>;
  baseline_context: { values: Record<string, unknown>; note?: string };
};

type Proposal = {
  id: string;
  title: string;
  summary: string;
  kind: string;
  status: string;
  proposer_username: string;
  related_issue_ids: string[];
  entries: EntryRow[];
  created_at: number;
};

function headers(): Record<string, string> {
  return { "Content-Type": "application/json", ...getSessionHeaders() };
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
  const { data, isLoading } = useQuery({
    queryKey: ["/api/admin/proposals", q],
    queryFn: async () => {
      const qs = q.trim() ? `?q=${encodeURIComponent(q.trim())}` : "";
      const res = await apiFetch(`/api/admin/proposals${qs}`, { headers: headers() });
      if (!res.ok) throw new Error("Failed to load proposals");
      return res.json() as Promise<{ proposals: Proposal[] }>;
    },
  });

  return (
    <div className="space-y-6" data-testid="panel-agents-proposals">
      <div>
        <p className="text-sm text-muted-foreground">
          Proposals are suggested entry changes or handoff notes. They do not change the live site until
          someone else applies edits or acknowledges a notes handoff. A proposal can cover several entries
          and can be linked to a validation issue. It stays partially finished until every entry is updated,
          or until a notes handoff is acknowledged or the proposal is rejected.
        </p>
        <Collapsible open={advanced} onOpenChange={setAdvanced}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="h-auto px-0 mt-1 text-xs text-muted-foreground">
              {advanced ? "Hide advanced" : "Read more (advanced)"}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="text-xs text-muted-foreground space-y-1 mt-1">
            <p>Stored in per-site SQLite (data/&lt;site&gt;/app.db). Exact fingerprint blocks clones; similar open proposals need confirm_distinct.</p>
            <p>MCP: propose_change and list_proposals need content_view or seo_edit. update_proposal needs content_edit_text or seo_edit. Apply is four-eyes.</p>
            <p>Issue panels only list proposals linked to that issue. This page lists everything.</p>
          </CollapsibleContent>
        </Collapsible>
      </div>
      <Input
        placeholder="Search proposals"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        data-testid="input-proposal-search"
      />
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      <div className="space-y-2">
        {(data?.proposals ?? []).map((p) => (
          <Link key={p.id} href={`${AGENTS_PROPOSALS_BASE}/${p.id}`}>
            <Card className="hover-elevate cursor-pointer" data-testid={`card-proposal-${p.id}`}>
              <CardHeader className="py-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <CardTitle className="text-sm font-medium">{p.title}</CardTitle>
                  <Badge variant="secondary">{p.status}</Badge>
                  <Badge variant="outline">{p.kind}</Badge>
                </div>
                <p className="text-xs text-muted-foreground line-clamp-2">{p.summary}</p>
              </CardHeader>
            </Card>
          </Link>
        ))}
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
  const { data, isLoading } = useQuery({
    queryKey: ["/api/admin/proposals", id],
    queryFn: async () => {
      const res = await apiFetch(`/api/admin/proposals/${id}`, { headers: headers() });
      if (!res.ok) throw new Error("Not found");
      return res.json() as Promise<{ proposal: Proposal }>;
    },
  });
  const mut = useMutation({
    mutationFn: async (action: string) => {
      const res = await apiFetch(`/api/admin/proposals/${id}/${action}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({}),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Action failed");
      return json;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["/api/admin/proposals"] });
      toast({ title: "Updated" });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });
  const p = data?.proposal;
  return (
    <div className="space-y-6" data-testid="panel-agents-proposal-detail">
      <Button variant="ghost" size="sm" asChild>
        <Link href={AGENTS_PROPOSALS_BASE}>Back</Link>
      </Button>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {p && (
        <>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-xl font-semibold">{p.title}</h2>
            <Badge>{p.status}</Badge>
            <Badge variant="outline">{p.kind}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">Proposed by {p.proposer_username}</p>
          <p className="text-sm">{p.summary}</p>
          {p.related_issue_ids.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Linked issues: {p.related_issue_ids.join(", ")}
            </p>
          )}
          {p.kind === "edits" && (
            <div className="space-y-3">
              {p.entries.map((e) => (
                <Card key={e.id}>
                  <CardHeader className="py-3">
                    <CardTitle className="text-sm">
                      {e.contentType}/{e.slug} ({e.locale}) — {e.status}
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="text-xs space-y-2">
                    {e.last_error && <p className="text-destructive">{e.last_error}</p>}
                    {e.ops.map((op) => (
                      <div key={op.field_path} className="border rounded p-2">
                        <p className="font-mono">{op.field_path}</p>
                        <p className="text-muted-foreground">Then: {JSON.stringify(e.baseline_context.values[op.field_path])}</p>
                        <p>Proposed: {JSON.stringify(op.value)}</p>
                      </div>
                    ))}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {p.kind === "edits" && p.status !== "finished" && p.status !== "rejected" && p.status !== "withdrawn" && (
              <Button onClick={() => mut.mutate("apply")} disabled={mut.isPending} data-testid="button-apply-proposal">
                Apply remaining
              </Button>
            )}
            {p.kind === "notes" && p.status === "open" && (
              <Button onClick={() => mut.mutate("acknowledge")} disabled={mut.isPending} data-testid="button-acknowledge-proposal">
                Acknowledge
              </Button>
            )}
            {p.status !== "finished" && p.status !== "rejected" && p.status !== "withdrawn" && (
              <>
                <Button variant="outline" onClick={() => mut.mutate("reject")} disabled={mut.isPending}>
                  Reject
                </Button>
                <Button variant="ghost" onClick={() => mut.mutate("withdraw")} disabled={mut.isPending}>
                  Withdraw
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
