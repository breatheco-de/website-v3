import { useState, useEffect, type MouseEvent } from "react";
import { Link } from "wouter";
import { Check, Pencil } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  STAFF_IDEA_DEMAND_SITUATION_OPTIONS,
  STAFF_REVIEW_SITUATION_LABELS,
  STAFF_REVIEW_SITUATION_OPTIONS,
  editsChecksBadge,
  filedIdeaDemand,
  ideaDemandBadge,
} from "@/lib/review-situation-summary";

export {
  STAFF_IDEA_DEMAND_SITUATION_OPTIONS,
  STAFF_REVIEW_SITUATION_LABELS,
  STAFF_REVIEW_SITUATION_OPTIONS,
};

export type ReviewContextPayload = {
  damage_class?: string;
  undo_cost?: string;
  block_apply?: boolean;
  situation_changed_since_filed?: boolean;
  filed_damage_class?: string;
  active_checklists?: string[];
  review_situations?: string[];
  filed_review_situations?: string[];
  situation_source?: string;
  summary?: string;
  staff_summary?: {
    badge_label: string;
    situation_description: string;
    risk: string;
    undo: string;
    related?: string;
  };
  agent_preview?: {
    think_items?: Array<{ id: string; title: string; why: string; look_for: string[] }>;
    warnings?: Array<{ code: string; message: string }>;
  };
  related_open_proposals?: Array<{
    id: string;
    title?: string;
    kind: string;
    shared_issue_ids: string[];
  }>;
  entries?: Array<{
    contentType: string;
    slug: string;
    locale: string;
    existence: string;
    damage_class: string;
    target_missing?: boolean;
  }>;
  figure_variables?: Array<{ name: string; category: string; default?: string | null; deprecated?: boolean }>;
};

/** Mirrors server DAMAGE_CLASS_META for snapshot-only fallbacks. */
const DAMAGE_CLASS_FALLBACK: Record<
  string,
  { badge_label: string; situation_description: string; risk: string }
> = {
  none: {
    badge_label: "Handoff",
    situation_description: "Reminder or wall — closing does not change the live site.",
    risk: "No live content change on close or accept.",
  },
  existing_metadata: {
    badge_label: "Metadata fix",
    situation_description:
      "Small change on an existing page (title, description, etc.). Easy to undo; still check the copy is accurate.",
    risk: "Low — metadata on a page that already exists.",
  },
  existing_content: {
    badge_label: "Content edit",
    situation_description:
      "Changes copy or fields on a page that already exists. Confirm the edit matches the summary before apply.",
    risk: "Medium — body or field changes on a live page.",
  },
  selling_page: {
    badge_label: "Outcome figures",
    situation_description:
      "This proposal adds or changes hire rates, salaries, tuition, or prices. Verify figures against an approved source before apply.",
    risk: "High — outcome figures; claims affect leads and trust.",
  },
  new_public_content: {
    badge_label: "New public content",
    situation_description:
      "New or proposed public page. Judge angle, facts, and funnel — not only whether apply is easy.",
    risk: "High — brand and spam risk for new public content.",
  },
};

/** Kind badge copy — situation chip that repeats this is redundant. */
function kindDisplayLabel(kind?: string): string | null {
  if (kind === "notes") return "Handoff";
  if (kind === "idea") return "Idea";
  if (kind === "edits") return "Edits";
  return null;
}

function fallbackFromDamageClass(damageClass?: string) {
  if (!damageClass) return null;
  return DAMAGE_CLASS_FALLBACK[damageClass] ?? null;
}

/** Build a display payload from live review_context, else persisted snapshot. */
export function resolveSituationDisplay(opts: {
  reviewContext?: ReviewContextPayload | null;
  snapshot?: Record<string, unknown> | null;
  /** Used when neither live nor snapshot has situation (e.g. open handoff). */
  kind?: string;
}): ReviewContextPayload | null {
  const live = opts.reviewContext;
  if (live?.staff_summary?.badge_label && live.staff_summary.situation_description) {
    return live;
  }
  if (live?.staff_summary?.badge_label) {
    const fb = fallbackFromDamageClass(live.damage_class);
    if (fb || live.staff_summary.situation_description) {
      return {
        ...live,
        staff_summary: {
          ...live.staff_summary,
          situation_description:
            live.staff_summary.situation_description ||
            fb?.situation_description ||
            "Open Details for risk and undo guidance.",
          risk: live.staff_summary.risk || fb?.risk || "—",
          undo: live.staff_summary.undo || "—",
        },
      };
    }
  }

  const snap = opts.snapshot;
  if (snap && typeof snap === "object") {
    const damage_class =
      typeof snap.damage_class === "string" ? snap.damage_class : live?.damage_class;
    const fb = fallbackFromDamageClass(damage_class);
    const badge_label =
      typeof snap.badge_label === "string"
        ? snap.badge_label
        : fb?.badge_label ?? (typeof damage_class === "string" ? damage_class : null);
    const situation_description =
      typeof snap.situation_description === "string"
        ? snap.situation_description
        : fb?.situation_description ?? null;
    if (badge_label || situation_description) {
      return {
        ...live,
        damage_class,
        undo_cost: typeof snap.undo_cost === "string" ? snap.undo_cost : live?.undo_cost,
        block_apply:
          typeof snap.block_apply === "boolean" ? snap.block_apply : live?.block_apply,
        active_checklists: Array.isArray(snap.active_checklists)
          ? (snap.active_checklists as string[])
          : live?.active_checklists,
        staff_summary: {
          badge_label: badge_label || fb?.badge_label || "Situation",
          situation_description:
            situation_description ||
            live?.staff_summary?.situation_description ||
            fb?.situation_description ||
            "Open Details for risk and undo guidance.",
          risk: live?.staff_summary?.risk || fb?.risk || "—",
          undo: live?.staff_summary?.undo || "—",
          ...(live?.staff_summary?.related ? { related: live.staff_summary.related } : {}),
        },
      };
    }
  }

  if (live?.damage_class) {
    const fb = fallbackFromDamageClass(live.damage_class);
    if (fb) {
      return {
        ...live,
        staff_summary: {
          badge_label: fb.badge_label,
          situation_description: fb.situation_description,
          risk: fb.risk,
          undo: "—",
        },
      };
    }
  }

  // Open handoffs / ideas with no snapshot yet still get a plain-English situation.
  if (opts.kind === "notes" || opts.kind === "idea") {
    const fb = DAMAGE_CLASS_FALLBACK.none;
    return {
      damage_class: "none",
      undo_cost: "none",
      staff_summary: {
        badge_label: opts.kind === "idea" ? "Idea brief" : fb.badge_label,
        situation_description:
          opts.kind === "idea"
            ? "Brief to greenlight or decline — accepting does not publish. Score whether the opportunity is real and whether accepting would harm the site."
            : fb.situation_description,
        risk:
          opts.kind === "idea"
            ? "Accept locks a brief only — no live YAML until a later edits proposal."
            : fb.risk,
        undo: "No live change.",
      },
    };
  }

  return live ?? null;
}

/** List chip from persisted snapshot — popover explains the review situation in plain English. */
export function SituationSnapshotBadge({
  snapshot,
  kind,
  className,
  stopLinkNavigation = false,
  testIdSuffix = "",
}: {
  snapshot?: Record<string, unknown> | null;
  /** When set, hide chip if label duplicates the kind badge. */
  kind?: string;
  className?: string;
  /** When true, stop click from bubbling (e.g. badge inside a list card Link). */
  stopLinkNavigation?: boolean;
  /** Suffix for test ids — list uses `-${id}`. */
  testIdSuffix?: string;
}) {
  const [advanced, setAdvanced] = useState(false);
  const resolved = resolveSituationDisplay({ snapshot, kind });
  const staff = resolved?.staff_summary;
  const label = staff?.badge_label ?? null;
  if (!label || !staff) return null;
  const kindLabel = kindDisplayLabel(kind);
  if (kindLabel && label === kindLabel) return null;

  const onTriggerClick = stopLinkNavigation
    ? (e: MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
      }
    : undefined;

  const description =
    staff.situation_description ||
    "Open the proposal for the full review situation.";

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0"
          data-testid={`badge-proposal-situation-snapshot${testIdSuffix}`}
          aria-label={`${label} — what this situation means`}
          onClick={onTriggerClick}
        >
          <Badge
            variant="outline"
            className={cn("cursor-pointer font-normal hover-elevate", className)}
          >
            {label}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 space-y-3 text-sm"
        align="start"
        data-testid={`popover-proposal-situation-snapshot${testIdSuffix}`}
        onClick={onTriggerClick}
      >
        <p className="font-medium text-foreground">{label}</p>
        <p className="text-muted-foreground leading-5">
          This chip is the proposal&apos;s review situation — a short label for the kind of change
          you are deciding on, not a status or a blocker.
        </p>
        <p className="text-muted-foreground leading-5">{description}</p>
        <button
          type="button"
          className="text-xs text-primary hover:underline"
          data-testid={`button-situation-snapshot-advanced${testIdSuffix}`}
          onClick={() => setAdvanced((v) => !v)}
        >
          {advanced ? "Hide advanced" : "Read more (advanced)"}
        </button>
        {advanced ? (
          <div className="space-y-1 border-t pt-2 text-xs text-muted-foreground leading-5">
            {staff.risk && staff.risk !== "—" ? <p>Risk: {staff.risk}</p> : null}
            {staff.undo && staff.undo !== "—" ? <p>Undo: {staff.undo}</p> : null}
            {resolved?.damage_class ? (
              <p>
                Snapshot damage class: <span className="font-mono">{resolved.damage_class}</span>
              </p>
            ) : null}
            <p>Open the proposal for the live audit (checklists, related proposals, apply gates).</p>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function SituationDialogBody({
  reviewContext,
  staff,
}: {
  reviewContext: ReviewContextPayload;
  staff: NonNullable<ReviewContextPayload["staff_summary"]>;
}) {
  const [advanced, setAdvanced] = useState(false);

  return (
    <div className="space-y-3 text-sm">
      {reviewContext.situation_changed_since_filed ? (
        <p
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-amber-100"
          data-testid="banner-situation-changed"
        >
          Situation changed since this was filed
          {reviewContext.filed_damage_class
            ? ` (was ${reviewContext.filed_damage_class}, now ${reviewContext.damage_class}).`
            : "."}
        </p>
      ) : null}

      {reviewContext.block_apply ? (
        <p
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-destructive"
          data-testid="banner-target-missing"
        >
          The page this proposal edits no longer exists — apply is blocked; reject or withdraw, or
          restore the page and file fresh.
        </p>
      ) : null}

      <div className="space-y-1">
        <p className="font-medium text-foreground">Risk</p>
        <p className="text-muted-foreground leading-5">{staff.risk}</p>
      </div>
      <div className="space-y-1">
        <p className="font-medium text-foreground">Undo</p>
        <p className="text-muted-foreground leading-5">{staff.undo}</p>
      </div>
      {staff.related ? (
        <div className="space-y-1">
          <p className="font-medium text-foreground">Related proposals</p>
          <p className="text-muted-foreground leading-5">{staff.related}</p>
          {reviewContext.related_open_proposals?.length ? (
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              {reviewContext.related_open_proposals.map((r) => (
                <li key={r.id}>
                  <Link
                    href={`/private/agents/proposals/${r.id}`}
                    className="text-primary hover:underline"
                  >
                    {r.title || r.id}
                  </Link>{" "}
                  ({r.kind})
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      {reviewContext.agent_preview?.think_items?.length ? (
        <div className="space-y-1">
          <p className="font-medium text-foreground">Checklist</p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {reviewContext.agent_preview.think_items.map((t) => (
              <li key={t.id}>{t.title}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {reviewContext.figure_variables?.length ? (
        <div className="space-y-1" data-testid="list-figure-variables">
          <p className="font-medium text-foreground">Outcome figures turned on by these variables</p>
          <p className="text-xs text-muted-foreground">
            The edit uses these price, outcome or social-proof values. Check each is the right one
            for the claim.
          </p>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {reviewContext.figure_variables.map((f) => (
              <li key={f.name}>
                <span className="font-mono text-xs text-foreground">{f.name}</span>
                {f.default ? ` · ${f.default}` : ""}
                {f.deprecated ? " · deprecated" : ""}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-auto px-0 text-xs text-primary"
        data-testid="button-proposal-situation-advanced"
        onClick={() => setAdvanced((v) => !v)}
      >
        {advanced ? "Hide advanced" : "Read more (advanced)"}
      </Button>

      {advanced ? (
        <div
          className="space-y-3 border-t pt-3 text-xs text-muted-foreground"
          data-testid="panel-proposal-situation-advanced"
        >
          <p>
            <span className="font-medium text-foreground">damage_class:</span>{" "}
            {reviewContext.damage_class ?? "—"}
          </p>
          <p>
            <span className="font-medium text-foreground">undo_cost:</span>{" "}
            {reviewContext.undo_cost ?? "—"}
          </p>
          <p>
            <span className="font-medium text-foreground">active_checklists:</span>{" "}
            {(reviewContext.active_checklists ?? []).join(", ") || "—"}
          </p>
          {reviewContext.entries?.length ? (
            <div>
              <p className="font-medium text-foreground">entries</p>
              <ul className="mt-1 space-y-1 font-mono">
                {reviewContext.entries.map((e) => (
                  <li key={`${e.contentType}/${e.slug}/${e.locale}`}>
                    {e.contentType}/{e.slug} ({e.locale}) · {e.existence} · {e.damage_class}
                    {e.target_missing ? " · target_missing" : ""}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {reviewContext.agent_preview?.think_items?.map((t) => (
            <div key={t.id} className="space-y-1 rounded-md border p-2">
              <p className="font-mono text-foreground">{t.id}</p>
              <p className="font-medium text-foreground">{t.title}</p>
              <p>{t.why}</p>
              <ul className="list-disc pl-4">
                {t.look_for.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          ))}
          {reviewContext.agent_preview?.warnings?.length ? (
            <div>
              <p className="font-medium text-foreground">warnings</p>
              <ul className="mt-1 space-y-1">
                {reviewContext.agent_preview.warnings.map((w) => (
                  <li key={w.code}>
                    <span className="font-mono">{w.code}</span>: {w.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <pre className="max-h-48 overflow-auto rounded-md bg-muted/40 p-2 font-mono text-[10px] leading-4">
            {JSON.stringify(reviewContext, null, 2)}
          </pre>
        </div>
      ) : null}
    </div>
  );
}

/** Clickable situation badge → audit dialog (live review_context). */
export function SituationReviewBadge({
  reviewContext,
  kind,
  className,
}: {
  reviewContext: ReviewContextPayload | null | undefined;
  /** When set, hide chip if label duplicates the kind badge. */
  kind?: string;
  className?: string;
}) {
  if (!reviewContext?.staff_summary?.badge_label) return null;

  const staff = reviewContext.staff_summary;
  const kindLabel = kindDisplayLabel(kind);
  if (kindLabel && staff.badge_label === kindLabel) return null;

  const destructive = Boolean(reviewContext.block_apply);

  return (
    <Dialog>
      <DialogTrigger asChild>
        <button
          type="button"
          className={cn("inline-flex shrink-0", className)}
          data-testid="badge-proposal-situation"
          aria-label={`${staff.badge_label} — what this situation means`}
        >
          <Badge
            variant={destructive ? "destructive" : "outline"}
            className="cursor-pointer font-normal hover-elevate"
          >
            {staff.badge_label}
          </Badge>
        </button>
      </DialogTrigger>
      <DialogContent
        className="max-h-[85vh] max-w-lg overflow-y-auto"
        data-testid="dialog-proposal-situation"
      >
        <DialogHeader>
          <DialogTitle>{staff.badge_label}</DialogTitle>
          <DialogDescription className="text-left text-sm leading-5 text-muted-foreground">
            {staff.situation_description}
          </DialogDescription>
        </DialogHeader>
        <SituationDialogBody reviewContext={reviewContext} staff={staff} />
      </DialogContent>
    </Dialog>
  );
}

/**
 * Always-visible situation on proposal detail: short description + optional chip.
 * Falls back to review_context_snapshot when live review_context is missing.
 */
export function ProposalSituationCallout({
  reviewContext,
  snapshot,
  kind,
  className,
  filedSituations,
  onSaveSituations,
  saving,
}: {
  reviewContext?: ReviewContextPayload | null;
  snapshot?: Record<string, unknown> | null;
  kind?: string;
  className?: string;
  /** Author/staff-filed situation ids; falls back to the live review context. */
  filedSituations?: string[];
  /** When set (ideas/edits), the Demand or Checks badge gets a pencil to edit. */
  onSaveSituations?: (ids: string[]) => void;
  saving?: boolean;
}) {
  const resolved = resolveSituationDisplay({ reviewContext, snapshot, kind });
  const staff = resolved?.staff_summary;
  if (!resolved || !staff?.situation_description) return null;

  const kindLabel = kindDisplayLabel(kind);
  const showChip = Boolean(staff.badge_label && (!kindLabel || staff.badge_label !== kindLabel));
  const destructive = Boolean(resolved.block_apply);

  return (
    <Dialog>
      <div
        className={cn(
          "rounded-md border border-card-border bg-muted/30 px-3 py-2.5 space-y-1.5",
          className,
        )}
        data-testid="callout-proposal-situation"
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            Situation
          </span>
          {showChip ? (
            <DialogTrigger asChild>
              <button
                type="button"
                className="inline-flex shrink-0"
                data-testid="badge-proposal-situation"
                aria-label={`${staff.badge_label} — what this situation means`}
              >
                <Badge
                  variant={destructive ? "destructive" : "outline"}
                  className="cursor-pointer font-normal hover-elevate"
                >
                  {staff.badge_label}
                </Badge>
              </button>
            </DialogTrigger>
          ) : (
            <DialogTrigger asChild>
              <button
                type="button"
                className="text-[11px] text-primary hover:underline"
                data-testid="button-proposal-situation-details"
              >
                Details
              </button>
            </DialogTrigger>
          )}
          {resolved.situation_changed_since_filed ? (
            <Badge
              variant="outline"
              className="font-normal border-amber-500/40 text-amber-200"
              data-testid="badge-situation-changed"
            >
              Changed since filed
            </Badge>
          ) : null}
        </div>
        <p
          className="text-sm leading-5 text-foreground/90"
          data-testid="text-proposal-situation-description"
        >
          {staff.situation_description}
        </p>
        {kind === "idea" ? (
          <IdeaDemandRow
            filed={filedSituations ?? resolved.filed_review_situations ?? []}
            warnings={resolved.agent_preview?.warnings}
            saving={saving}
            onSave={onSaveSituations}
          />
        ) : kind === "edits" ? (
          <EditsChecksRow
            filed={filedSituations ?? resolved.filed_review_situations ?? []}
            live={resolved.review_situations ?? []}
            saving={saving}
            onSave={onSaveSituations}
          />
        ) : (resolved.review_situations?.length ?? 0) > 0 ? (
          <div className="flex flex-wrap gap-1 pt-0.5" data-testid="chips-review-situations-live">
            {(resolved.review_situations ?? []).map((id) => (
              <Badge
                key={id}
                variant="secondary"
                className="text-[10px] font-normal"
                data-testid={`chip-review-situation-${id}`}
                title={STAFF_REVIEW_SITUATION_LABELS[id] ?? id}
              >
                {STAFF_REVIEW_SITUATION_LABELS[id] ?? id}
              </Badge>
            ))}
            {resolved.situation_source ? (
              <span className="text-[10px] text-muted-foreground self-center">
                ({resolved.situation_source})
              </span>
            ) : null}
          </div>
        ) : null}
      </div>
      <DialogContent
        className="max-h-[85vh] max-w-lg overflow-y-auto"
        data-testid="dialog-proposal-situation"
      >
        <DialogHeader>
          <DialogTitle>{staff.badge_label}</DialogTitle>
          <DialogDescription className="text-left text-sm leading-5 text-muted-foreground">
            {staff.situation_description}
          </DialogDescription>
        </DialogHeader>
        <SituationDialogBody reviewContext={resolved} staff={staff} />
      </DialogContent>
    </Dialog>
  );
}

function SituationLabelAdvanced({ mode }: { mode: "idea" | "edits" }) {
  return (
    <Collapsible>
      <CollapsibleTrigger
        className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        data-testid="button-review-situations-advanced"
      >
        Read more (advanced)
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 space-y-1 text-xs leading-5 text-muted-foreground">
        {mode === "idea" ? (
          <>
            <p>
              Anticipated demand and fast-decay news change how search evidence is judged. Broken URL
              needs hit counts from the 404 log.
            </p>
            <p>
              Accepting only greenlights the brief. A later edit&apos;s approval writes the redirect or
              creates the post.
            </p>
            <p>
              The opportunity vs harm check (<span className="font-mono">idea_opportunity_harm</span>)
              always runs and is not selectable here.
            </p>
          </>
        ) : (
          <>
            <p>
              Ticked checks are filed by the author. Review may add more checklists on top when the
              edits need them; filing still succeeds.
            </p>
            <p>
              On revise, checks that no longer match the remaining edits drop. To ship, drop or fix
              the fields failing a check, then apply the rest in one go.
            </p>
          </>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

function SituationLabelTrigger({
  label,
  nudge,
  editable,
}: {
  label: string;
  nudge?: boolean;
  editable: boolean;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "gap-1 font-normal",
        editable && "cursor-pointer hover-elevate",
        nudge && "border-primary/60 text-primary",
      )}
    >
      {label}
      {editable ? <Pencil className="h-3 w-3 opacity-70" aria-hidden /> : null}
    </Badge>
  );
}

/** Ideas: single demand label, saved on pick. "None" clears it. */
function IdeaDemandRow({
  filed,
  warnings,
  saving,
  onSave,
}: {
  filed: string[];
  warnings?: Array<{ code: string }>;
  saving?: boolean;
  onSave?: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = filedIdeaDemand(filed)[0] ?? null;
  const badge = ideaDemandBadge({ filed, warnings });

  if (!onSave) {
    return (
      <div data-testid="row-idea-demand">
        <SituationLabelTrigger label={badge.label} nudge={badge.nudge} editable={false} />
      </div>
    );
  }

  const choices: Array<{ id: string | null; label: string; when_to_use: string }> = [
    {
      id: null,
      label: "None (standard review)",
      when_to_use: "Most ideas. Evidence is judged the usual way.",
    },
    ...STAFF_IDEA_DEMAND_SITUATION_OPTIONS,
  ];

  return (
    <div data-testid="row-idea-demand">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex shrink-0"
            disabled={saving}
            data-testid="button-edit-idea-demand"
            aria-label={`${badge.label} — change demand label`}
          >
            <SituationLabelTrigger label={badge.label} nudge={badge.nudge} editable />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-80 space-y-2 p-2"
          align="start"
          data-testid="popover-idea-demand"
        >
          <div className="space-y-0.5" role="radiogroup" aria-label="Demand label">
            {choices.map((c) => {
              const on = c.id === current;
              return (
                <button
                  key={c.id ?? "none"}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  disabled={saving}
                  onClick={() => {
                    setOpen(false);
                    if (!on) onSave(c.id ? [c.id] : []);
                  }}
                  className={cn(
                    "flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover-elevate",
                    on && "bg-muted",
                  )}
                  data-testid={`option-idea-demand-${c.id ?? "none"}`}
                >
                  <Check
                    className={cn("mt-0.5 h-4 w-4 shrink-0", on ? "text-primary" : "invisible")}
                    aria-hidden
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-foreground">{c.label}</span>
                    <span className="block text-xs leading-4 text-muted-foreground">
                      {c.when_to_use}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>
          <div className="border-t px-2 pt-2">
            <SituationLabelAdvanced mode="idea" />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/** Edits: several checks, applied together. Nothing ticked lets review pick. */
function EditsChecksRow({
  filed,
  live,
  saving,
  onSave,
}: {
  filed: string[];
  live: string[];
  saving?: boolean;
  onSave?: (ids: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<string[]>(filed);
  const badge = editsChecksBadge({ filed, live });

  useEffect(() => {
    if (open) setSelected([...filed]);
  }, [open, filed.join(",")]);

  if (!onSave) {
    return (
      <div data-testid="row-edits-checks">
        <SituationLabelTrigger label={badge.label} editable={false} />
      </div>
    );
  }

  const dirty =
    selected.length !== filed.length || selected.some((id) => !filed.includes(id));

  return (
    <div data-testid="row-edits-checks">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="inline-flex shrink-0"
            disabled={saving}
            data-testid="button-edit-edits-checks"
            aria-label={`${badge.label} — change review checks`}
          >
            <SituationLabelTrigger label={badge.label} editable />
          </button>
        </PopoverTrigger>
        <PopoverContent
          className="w-80 space-y-2 p-2"
          align="start"
          data-testid="popover-edits-checks"
        >
          <p className="px-2 pt-1 text-xs text-muted-foreground">
            Leave all unticked to let review pick.
          </p>
          <div className="max-h-72 space-y-0.5 overflow-y-auto">
            {STAFF_REVIEW_SITUATION_OPTIONS.map((opt) => {
              const on = selected.includes(opt.id);
              return (
                <label
                  key={opt.id}
                  className="flex cursor-pointer items-start gap-2 rounded-md px-2 py-1.5 hover-elevate"
                  data-testid={`option-edits-check-${opt.id}`}
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={on}
                    disabled={saving}
                    onCheckedChange={() =>
                      setSelected((prev) =>
                        prev.includes(opt.id) ? prev.filter((x) => x !== opt.id) : [...prev, opt.id],
                      )
                    }
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-foreground">{opt.label}</span>
                    <span className="block text-xs leading-4 text-muted-foreground">
                      {opt.when_to_use}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
          <div className="flex items-center gap-2 border-t px-2 pt-2">
            <Button
              type="button"
              size="sm"
              disabled={saving || !dirty}
              onClick={() => {
                onSave(selected);
                setOpen(false);
              }}
              data-testid="button-apply-edits-checks"
            >
              {saving ? "Saving…" : "Apply"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={saving || selected.length === 0}
              onClick={() => setSelected([])}
              data-testid="button-clear-edits-checks"
            >
              Clear
            </Button>
          </div>
          <div className="px-2">
            <SituationLabelAdvanced mode="edits" />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
