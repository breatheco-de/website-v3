import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  IconAlertTriangle,
  IconDeviceFloppy,
  IconLoader2,
  IconScale,
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, getQueryFn } from "@/lib/queryClient";
import { getSessionHeaders } from "@/lib/sessionHeaders";

export type ProposalWithdrawMcpMode = "proposer_only" | "any_create_author" | "disabled";
export type ProposalWithdrawStaffMode = "any_editor" | "proposer_only" | "steward_only";

export interface ProposalRulesSettings {
  withdraw: {
    mcp: ProposalWithdrawMcpMode;
    staff: ProposalWithdrawStaffMode;
  };
  four_eyes: {
    enabled: boolean;
    staff_ui_exempt: boolean;
    same_model_blocked: boolean;
  };
  hold: {
    stewards_only: boolean;
  };
  claim: {
    staff_ui_takeover: boolean;
  };
}

interface ProposalsSettingsResponse {
  settings: ProposalRulesSettings;
  revision: string;
  site_label: string;
  can_edit: boolean;
}

const MCP_WITHDRAW_LABELS: Record<ProposalWithdrawMcpMode, string> = {
  proposer_only: "Own filings only",
  any_create_author: "Any agent author",
  disabled: "Nobody via agents",
};

const STAFF_WITHDRAW_LABELS: Record<ProposalWithdrawStaffMode, string> = {
  any_editor: "Any editor",
  proposer_only: "Proposer only",
  steward_only: "Platform Steward only",
};

function cloneSettings(s: ProposalRulesSettings): ProposalRulesSettings {
  return {
    withdraw: { ...s.withdraw },
    four_eyes: { ...s.four_eyes },
    hold: { ...s.hold },
    claim: { ...s.claim },
  };
}

function settingsEqual(a: ProposalRulesSettings, b: ProposalRulesSettings): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export function AgentsRulesPanel() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data, isLoading, error, refetch } = useQuery<ProposalsSettingsResponse>({
    queryKey: ["/api/settings/proposals"],
    queryFn: getQueryFn({ on401: "throw" }),
  });

  const openStats = useQuery({
    queryKey: ["/api/admin/proposals", { limit: 1, for: "rules-open-count" }],
    queryFn: async () => {
      const res = await apiRequest("GET", "/api/admin/proposals?limit=1");
      return (await res.json()) as {
        stats?: { by_status?: { open?: number; partial?: number } };
      };
    },
  });

  const openCount =
    (openStats.data?.stats?.by_status?.open ?? 0) +
    (openStats.data?.stats?.by_status?.partial ?? 0);

  const [draft, setDraft] = useState<ProposalRulesSettings | null>(null);
  const [revision, setRevision] = useState<string>("");
  const [conflictBanner, setConflictBanner] = useState(false);
  const [fourEyesConfirmOpen, setFourEyesConfirmOpen] = useState(false);

  useEffect(() => {
    if (!data?.settings) return;
    setDraft(cloneSettings(data.settings));
    setRevision(data.revision);
    setConflictBanner(false);
  }, [data?.settings, data?.revision]);

  const canEdit = Boolean(data?.can_edit);
  const dirty = Boolean(
    draft && data?.settings && !settingsEqual(draft, data.settings),
  );

  const fourEyesDirty = Boolean(
    draft &&
      data?.settings &&
      (draft.four_eyes.enabled !== data.settings.four_eyes.enabled ||
        draft.four_eyes.staff_ui_exempt !== data.settings.four_eyes.staff_ui_exempt ||
        draft.four_eyes.same_model_blocked !== data.settings.four_eyes.same_model_blocked),
  );

  const saveMut = useMutation({
    mutationFn: async (payload: ProposalRulesSettings) => {
      const res = await fetch("/api/settings/proposals", {
        method: "PUT",
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...getSessionHeaders(),
        },
        body: JSON.stringify({
          settings: payload,
          expected_revision: revision,
        }),
      });
      const body = (await res.json()) as {
        settings?: ProposalRulesSettings;
        revision?: string;
        error?: string;
        code?: string;
      };
      if (!res.ok) {
        const err = new Error(body.error || "Failed to save") as Error & {
          code?: string;
          revision?: string;
          status?: number;
        };
        err.code = body.code;
        err.revision = body.revision;
        err.status = res.status;
        throw err;
      }
      return body;
    },
    onSuccess: (body) => {
      setConflictBanner(false);
      if (body.settings) setDraft(cloneSettings(body.settings));
      if (body.revision) setRevision(body.revision);
      void qc.invalidateQueries({ queryKey: ["/api/settings/proposals"] });
      toast({ title: "Rules saved", description: "New actions will use these rules." });
    },
    onError: (err: Error & { code?: string; status?: number }) => {
      if (err.status === 409 || err.code === "conflict") {
        setConflictBanner(true);
        toast({
          title: "Rules changed elsewhere",
          description: "Reload and try again. Your edits are kept until you reload.",
          variant: "destructive",
        });
        return;
      }
      toast({
        title: "Could not save",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const rolesSummary = useQuery({
    queryKey: ["/api/admin/roles"],
    queryFn: getQueryFn({ on401: "returnNull" }),
    retry: false,
  });

  const roleHint = useMemo(() => {
    const roles = (rolesSummary.data as { roles?: Record<string, { label?: string; capabilities?: Array<{ name: string }> }> } | null)
      ?.roles;
    if (!roles) return null;
    let create = 0;
    let review = 0;
    for (const r of Object.values(roles)) {
      const caps = r.capabilities ?? [];
      if (caps.some((c) => c.name === "proposals_create")) create += 1;
      if (caps.some((c) => c.name === "proposals_review")) review += 1;
    }
    return { create, review };
  }, [rolesSummary.data]);

  function requestSave() {
    if (!draft || !canEdit) return;
    if (fourEyesDirty) {
      setFourEyesConfirmOpen(true);
      return;
    }
    saveMut.mutate(draft);
  }

  if (isLoading || !draft) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground">
        <IconLoader2 className="h-6 w-6 animate-spin" aria-hidden />
      </div>
    );
  }

  if (error) {
    return (
      <Card data-testid="panel-agents-rules-error">
        <CardContent className="py-8 text-sm text-destructive">
          Could not load proposal rules. Refresh and try again.
        </CardContent>
      </Card>
    );
  }

  const disabled = !canEdit || saveMut.isPending;

  return (
    <div className="space-y-4" data-testid="panel-agents-rules">
      {!canEdit ? (
        <div
          className="flex items-start gap-2 rounded-md border border-muted-foreground/20 bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground"
          data-testid="banner-rules-readonly"
        >
          <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>Only a Platform Steward can change these rules. You can still view them.</p>
        </div>
      ) : null}

      {conflictBanner ? (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2.5 text-sm"
          data-testid="banner-rules-conflict"
        >
          <p className="text-destructive">
            Rules changed elsewhere — reload and try again. Your edits are kept until you reload.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              void refetch().then(() => setConflictBanner(false));
            }}
            data-testid="button-rules-reload"
          >
            Reload
          </Button>
        </div>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center gap-2 pb-4">
          <IconScale className="h-5 w-5 text-muted-foreground shrink-0" aria-hidden />
          <CardTitle className="text-base">Proposal rules</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <p className="text-sm text-muted-foreground leading-relaxed">
            These rules control how proposals may be withdrawn, approved, and held on{" "}
            <span className="font-medium text-foreground" data-testid="text-rules-site-label">
              {data?.site_label ?? "this site"}
            </span>
            . Changing a rule affects the next action only—not past decisions.
          </p>

          <section className="space-y-3" data-testid="section-rules-withdraw">
            <h3 className="text-sm font-medium">Filing & withdraw</h3>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="rules-withdraw-mcp">Agents (MCP) may withdraw</Label>
                <Select
                  value={draft.withdraw.mcp}
                  disabled={disabled}
                  onValueChange={(v) =>
                    setDraft((d) =>
                      d
                        ? {
                            ...d,
                            withdraw: { ...d.withdraw, mcp: v as ProposalWithdrawMcpMode },
                          }
                        : d,
                    )
                  }
                >
                  <SelectTrigger id="rules-withdraw-mcp" data-testid="select-withdraw-mcp">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(MCP_WITHDRAW_LABELS) as ProposalWithdrawMcpMode[]).map((k) => (
                      <SelectItem key={k} value={k}>
                        {MCP_WITHDRAW_LABELS[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="rules-withdraw-staff">Staff UI may withdraw</Label>
                <Select
                  value={draft.withdraw.staff}
                  disabled={disabled}
                  onValueChange={(v) =>
                    setDraft((d) =>
                      d
                        ? {
                            ...d,
                            withdraw: {
                              ...d.withdraw,
                              staff: v as ProposalWithdrawStaffMode,
                            },
                          }
                        : d,
                    )
                  }
                >
                  <SelectTrigger id="rules-withdraw-staff" data-testid="select-withdraw-staff">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(STAFF_WITHDRAW_LABELS) as ProposalWithdrawStaffMode[]).map(
                      (k) => (
                        <SelectItem key={k} value={k}>
                          {STAFF_WITHDRAW_LABELS[k]}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </section>

          <section className="space-y-3" data-testid="section-rules-four-eyes">
            <h3 className="text-sm font-medium">Review & decide</h3>
            <div className="flex items-center justify-between gap-3 rounded-md border border-muted-foreground/20 px-3 py-2.5">
              <div className="min-w-0 space-y-0.5">
                <Label htmlFor="rules-four-eyes">Four-eyes on Approve / Reject / Accept</Label>
                <p className="text-xs text-muted-foreground">
                  When on, a different person, or a different AI agent, must approve. The chat that
                  wrote a proposal can never approve it.
                </p>
              </div>
              <Switch
                id="rules-four-eyes"
                checked={draft.four_eyes.enabled}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  setDraft((d) =>
                    d ? { ...d, four_eyes: { ...d.four_eyes, enabled: checked } } : d,
                  )
                }
                data-testid="switch-four-eyes"
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-muted-foreground/20 px-3 py-2.5">
              <div className="min-w-0 space-y-0.5">
                <Label htmlFor="rules-staff-exempt">Staff UI exempt from four-eyes</Label>
                <p className="text-xs text-muted-foreground">
                  When on, a staff click in the UI can decide even if they filed the proposal.
                </p>
              </div>
              <Switch
                id="rules-staff-exempt"
                checked={draft.four_eyes.staff_ui_exempt}
                disabled={disabled || !draft.four_eyes.enabled}
                onCheckedChange={(checked) =>
                  setDraft((d) =>
                    d
                      ? { ...d, four_eyes: { ...d.four_eyes, staff_ui_exempt: checked } }
                      : d,
                  )
                }
                data-testid="switch-staff-ui-exempt"
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-muted-foreground/20 px-3 py-2.5">
              <div className="min-w-0 space-y-0.5">
                <Label htmlFor="rules-same-model">Same AI model can't approve its own work</Label>
                <p className="text-xs text-muted-foreground">
                  When on, an agent running the same AI model under your account can't approve what
                  another role on that model filed. Turn off if proposals pile up with no reviewer on a
                  different model.
                </p>
              </div>
              <Switch
                id="rules-same-model"
                checked={draft.four_eyes.same_model_blocked}
                disabled={disabled || !draft.four_eyes.enabled}
                onCheckedChange={(checked) =>
                  setDraft((d) =>
                    d
                      ? { ...d, four_eyes: { ...d.four_eyes, same_model_blocked: checked } }
                      : d,
                  )
                }
                data-testid="switch-same-model-blocked"
              />
            </div>
          </section>

          <section className="space-y-3" data-testid="section-rules-holds">
            <h3 className="text-sm font-medium">Holds & claims</h3>
            <div className="flex items-center justify-between gap-3 rounded-md border border-muted-foreground/20 px-3 py-2.5">
              <div className="min-w-0 space-y-0.5">
                <Label htmlFor="rules-hold-steward">Hold / release is steward-only</Label>
                <p className="text-xs text-muted-foreground">
                  Off: any staff with proposal review can hold or release in the UI. Agents never can.
                </p>
              </div>
              <Switch
                id="rules-hold-steward"
                checked={draft.hold.stewards_only}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  setDraft((d) =>
                    d ? { ...d, hold: { ...d.hold, stewards_only: checked } } : d,
                  )
                }
                data-testid="switch-hold-stewards-only"
              />
            </div>
            <div className="flex items-center justify-between gap-3 rounded-md border border-muted-foreground/20 px-3 py-2.5">
              <div className="min-w-0 space-y-0.5">
                <Label htmlFor="rules-claim-takeover">Staff may take over an active claim</Label>
                <p className="text-xs text-muted-foreground">
                  When off, staff must wait for release or claim expiry before picking up another agent’s claim.
                </p>
              </div>
              <Switch
                id="rules-claim-takeover"
                checked={draft.claim.staff_ui_takeover}
                disabled={disabled}
                onCheckedChange={(checked) =>
                  setDraft((d) =>
                    d ? { ...d, claim: { ...d.claim, staff_ui_takeover: checked } } : d,
                  )
                }
                data-testid="switch-claim-takeover"
              />
            </div>
          </section>

          <details className="text-xs text-muted-foreground leading-relaxed">
            <summary className="cursor-pointer font-medium text-foreground">
              Read more (advanced)
            </summary>
            <div className="mt-2 space-y-2">
              <p>
                Stored in this site’s{" "}
                <code className="font-mono bg-muted px-1 rounded">settings.yml</code> under{" "}
                <code className="font-mono bg-muted px-1 rounded">proposals:</code>. Capabilities
                (who may file or decide) live in Security → Roles — not here.
              </p>
              {roleHint ? (
                <p data-testid="text-rules-role-summary">
                  {roleHint.create} role{roleHint.create === 1 ? "" : "s"} can file proposals;{" "}
                  {roleHint.review} can decide.{" "}
                  <Link href="/private/security" className="text-primary underline-offset-2 hover:underline">
                    Open Security
                  </Link>
                </p>
              ) : (
                <p>
                  Assign who can file or decide under{" "}
                  <Link href="/private/security" className="text-primary underline-offset-2 hover:underline">
                    Security
                  </Link>
                  .
                </p>
              )}
            </div>
          </details>
        </CardContent>
      </Card>

      <div
        className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 shadow-lg"
        data-testid="rules-save-bar"
      >
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-end gap-3">
          {dirty ? (
            <p
              className="text-xs text-destructive min-w-0 truncate text-right"
              data-testid="text-rules-unsaved"
            >
              Unsaved changes
            </p>
          ) : null}
          <Button
            size="sm"
            className="gap-1.5 shrink-0"
            disabled={disabled || !dirty}
            onClick={requestSave}
            data-testid="button-rules-save"
          >
            {saveMut.isPending ? (
              <IconLoader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <IconDeviceFloppy className="h-3.5 w-3.5" aria-hidden />
            )}
            Save
          </Button>
        </div>
      </div>

      <Dialog open={fourEyesConfirmOpen} onOpenChange={setFourEyesConfirmOpen}>
        <DialogContent data-testid="dialog-four-eyes-confirm">
          <DialogHeader>
            <DialogTitle>Change four-eyes rules?</DialogTitle>
            <DialogDescription>
              {openCount === 1
                ? "1 open proposal will use the new rule on the next Approve / Reject / Accept."
                : `${openCount} open proposals will use the new rule on the next Approve / Reject / Accept.`}{" "}
              Past decisions stay as they are.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => setFourEyesConfirmOpen(false)}
              data-testid="button-cancel-four-eyes-confirm"
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                setFourEyesConfirmOpen(false);
                if (draft) saveMut.mutate(draft);
              }}
              data-testid="button-confirm-four-eyes-save"
            >
              Save rules
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
