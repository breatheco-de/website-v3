import { useState, useEffect, type MouseEvent } from "react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
    badge_label: "Selling page",
    situation_description:
      "This proposal changes a page that sells a program or offer. Wrong outcome claims (hire rate, salary, price) can cost real leads — verify figures before apply.",
    risk: "High — selling page; outcome claims affect leads.",
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
}: {
  reviewContext?: ReviewContextPayload | null;
  snapshot?: Record<string, unknown> | null;
  kind?: string;
  className?: string;
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
        {(resolved.review_situations?.length ?? 0) > 0 ? (
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

/** Labels for live situation chips (includes idea-only ids not in the edits editor). */
export const STAFF_REVIEW_SITUATION_LABELS: Record<string, string> = {
  internal_links: "Hub / internal links",
  serp_title_description: "Search title / description",
  funnel_classification: "Funnel stage / products",
  body_copy_edit: "Body / field edit",
  selling_figures: "Selling-page figures",
  new_public_content: "New public content",
  promote_draft: "Promote draft",
  locale_translation: "Locale translation",
  idea_opportunity_harm: "Idea opportunity vs harm",
};

/** Catalog labels for staff multi-select on edits only (keep in sync with server review-situations). */
export const STAFF_REVIEW_SITUATION_OPTIONS: Array<{
  id: string;
  label: string;
  when_to_use: string;
}> = [
  {
    id: "internal_links",
    label: "Hub / internal links",
    when_to_use: "Body adds same-locale hub or cluster links without rewriting facts or SERP.",
  },
  {
    id: "serp_title_description",
    label: "Search title / description",
    when_to_use: "Changes to search title or meta description — honest vs live.",
  },
  {
    id: "funnel_classification",
    label: "Funnel stage / products",
    when_to_use:
      "Funnel stage or products — who the buyer is, which product owns them, then how ready they are.",
  },
  {
    id: "body_copy_edit",
    label: "Body / field edit",
    when_to_use: "General copy or field updates that are not link-only, SERP-only, or funnel-only.",
  },
  {
    id: "selling_figures",
    label: "Selling-page figures",
    when_to_use: "Program or landing where hire rates, salaries, or prices may move.",
  },
  {
    id: "new_public_content",
    label: "New public content",
    when_to_use: "New or draft-backed public page — angle, facts, and funnel.",
  },
  {
    id: "promote_draft",
    label: "Promote draft",
    when_to_use: "Go-live a named draft with empty or minimal field updates.",
  },
  {
    id: "locale_translation",
    label: "Locale translation",
    when_to_use:
      "Promote a translated locale variant — fidelity to source before go-live (not soft-only polish).",
  },
];

/**
 * Staff editor for author-declared review situations on open/partial edits.
 * Empty selection = clear declaration (server will infer from edits).
 */
export function ReviewSituationsEditor({
  filedSituations,
  liveSituations,
  situationSource,
  disabled,
  saving,
  onSave,
  className,
}: {
  filedSituations: string[];
  liveSituations?: string[];
  situationSource?: string;
  disabled?: boolean;
  saving?: boolean;
  onSave: (ids: string[]) => void;
  className?: string;
}) {
  const [selected, setSelected] = useState<string[]>(() => [...filedSituations]);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const filedKey = filedSituations.join(",");

  useEffect(() => {
    setSelected([...filedSituations]);
  }, [filedKey]);

  const dirty =
    selected.length !== filedSituations.length ||
    selected.some((id) => !filedSituations.includes(id));

  function toggle(id: string) {
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  return (
    <div
      className={cn(
        "rounded-md border border-card-border bg-muted/20 px-3 py-2.5 space-y-2",
        className,
      )}
      data-testid="panel-review-situations-editor"
    >
      <p className="text-sm text-foreground/90" data-testid="text-review-situations-edu">
        Pick what kind of change this is so review uses the right checklist. You can leave empty —
        we&apos;ll infer from the edits. Multiple packs each get their own checklist; apply only
        after failing slices are removed or fixed.
      </p>
      {(liveSituations?.length ?? 0) > 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="text-review-situations-live">
          Live for review: {(liveSituations ?? []).join(", ")}
          {situationSource ? ` (${situationSource})` : ""}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-1.5">
        {STAFF_REVIEW_SITUATION_OPTIONS.map((opt) => {
          const on = selected.includes(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              disabled={disabled || saving}
              title={opt.when_to_use}
              onClick={() => toggle(opt.id)}
              className={cn(
                "rounded-md border px-2 py-1 text-xs transition-colors",
                on
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-muted-foreground/20 bg-background text-foreground hover-elevate",
              )}
              data-testid={`toggle-review-situation-${opt.id}`}
              aria-pressed={on}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          size="sm"
          disabled={disabled || saving || !dirty}
          onClick={() => onSave(selected)}
          data-testid="button-save-review-situations"
        >
          {saving ? "Saving…" : "Save situations"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={disabled || saving || selected.length === 0}
          onClick={() => setSelected([])}
          data-testid="button-clear-review-situations"
        >
          Clear (infer)
        </Button>
      </div>
      <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <CollapsibleTrigger
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
          data-testid="button-review-situations-advanced"
        >
          Read more (advanced)
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-1 space-y-1 text-xs text-muted-foreground">
          <p>
            Filed tags are author-declared. Live review may add inferred packs when the edits need
            more checklists (soft mismatch — create still succeeds).
          </p>
          <p>
            On revise, tags that no longer match remaining edits drop. Per-situation ship: drop or
            fix failing packs&apos; fields, then apply the rest in one go.
          </p>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
