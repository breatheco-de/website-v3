// Edit-mode only (lazy): floating staff chrome for a LeadForm — Signup Gated / Override
// badges above the card, and the hidden fields panel over the form's top edge.
import { useEffect, useMemo, useState, type RefObject, type SyntheticEvent } from "react";
import { CircleAlert, EyeOff, GitBranch, Loader2, Lock, User } from "lucide-react";
import { badgeVariants } from "@/components/ui/badge";
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { SignupGateStatus } from "@/components/lead_form/signupGateStatus";
import type { HiddenBadgeRef } from "@/components/lead_form/hiddenFieldPriority";
import type {
  HiddenBadgeDetail,
  HiddenFieldsNoticeLocale,
  LeadFormOverrideBadge,
} from "@/components/lead_form/hiddenFieldsNoticeTypes";
import {
  GATE_COPY,
  NOTICE_COPY,
  OVERRIDE_COPY,
  gateErrorText,
  noticeText,
} from "@/components/lead_form/hiddenFieldsNoticeCopy";
import LeadFormHiddenFieldsNotice from "@/components/lead_form/LeadFormHiddenFieldsNotice";
import {
  hideHiddenFieldsNoticeThisSession,
  useHiddenFieldsNoticeOff,
} from "@/components/lead_form/hiddenFieldsNoticeSession";

export interface LeadFormStatusBadgesProps {
  locale: HiddenFieldsNoticeLocale;
  /** Form root; the cluster floats above its nearest clipping card, the panel over its top edge. */
  anchorRef: RefObject<HTMLElement | null>;
  gate: SignupGateStatus;
  override: LeadFormOverrideBadge | null;
  /** Ranked hidden values (null/empty top when the form hides nothing). */
  hiddenFields: {
    top: HiddenBadgeRef[];
    rest: HiddenBadgeRef[];
    resolveBadge: (ref: HiddenBadgeRef) => HiddenBadgeDetail;
  } | null;
}

const stop = (e: SyntheticEvent) => e.stopPropagation();

/** Max ancestors to climb looking for the host card that clips the form. */
const MAX_CARD_HOPS = 4;

/** The host card (nearest clipping ancestor), so badges sit above the card, not inside it. */
function findCardElement(formRoot: HTMLElement): HTMLElement {
  let el: HTMLElement | null = formRoot.parentElement;
  for (let i = 0; el && i < MAX_CARD_HOPS; i++, el = el.parentElement) {
    if (el.tagName === "SECTION") break;
    const style = window.getComputedStyle(el);
    if (style.overflow !== "visible" || style.overflowY !== "visible") return el;
  }
  return formRoot;
}

function useVisibleCard(anchorRef: RefObject<HTMLElement | null>) {
  const [card, setCard] = useState<HTMLElement | null>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const formRoot = anchorRef.current;
    if (!formRoot) return;
    const target = findCardElement(formRoot);
    setCard(target);
    setRoot(formRoot);
    const measure = () => {
      const cardRect = target.getBoundingClientRect();
      const rootRect = formRoot.getBoundingClientRect();
      setVisible(cardRect.width > 0 && cardRect.height > 0 && rootRect.width > 0);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(target);
    ro.observe(formRoot);
    return () => ro.disconnect();
  }, [anchorRef]);

  return { card, root, visible };
}

/** Zero-height line along the form's top edge: a bottom-side popover then overlays the form top. */
function formTopEdgeAnchor(root: HTMLElement) {
  return {
    current: {
      contextElement: root,
      getBoundingClientRect: () => {
        const r = root.getBoundingClientRect();
        return DOMRect.fromRect({ x: r.left, y: r.top, width: r.width, height: 0 });
      },
    },
  };
}

/** Always-open, non-dismissable floating layer (staff chrome, never steals focus). */
const floatingLayerProps = {
  avoidCollisions: false,
  hideWhenDetached: true,
  onOpenAutoFocus: (e: Event) => e.preventDefault(),
  onCloseAutoFocus: (e: Event) => e.preventDefault(),
  onInteractOutside: (e: Event) => e.preventDefault(),
  onEscapeKeyDown: (e: KeyboardEvent) => e.preventDefault(),
  onClick: stop,
  onPointerDown: stop,
} as const;

function statusBadgeClass(tone: "neutral" | "error") {
  return cn(
    badgeVariants({ variant: tone === "error" ? "destructive" : "outline" }),
    "cursor-pointer gap-1 px-2 py-0.5 font-medium shadow-md",
    tone === "neutral" && "bg-background text-foreground",
  );
}

function GateBadge({ locale, gate }: { locale: HiddenFieldsNoticeLocale; gate: SignupGateStatus }) {
  if (gate.kind === "off") return null;
  const isError = gate.kind === "error";
  const label = noticeText(locale, gate.kind === "login_only" ? GATE_COPY.loginGated : GATE_COPY.gated);
  const Icon = isError ? CircleAlert : gate.kind === "loading" ? Loader2 : Lock;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={statusBadgeClass(isError ? "error" : "neutral")}
          onClick={stop}
          data-testid="lead-form-signup-gate-badge"
          data-state-kind={gate.kind}
        >
          <Icon className={cn("h-3 w-3", gate.kind === "loading" && "animate-spin")} aria-hidden />
          {label}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-2" onClick={stop} onPointerDown={stop}>
        {gate.kind === "error" ? (
          <>
            <p className="flex items-center gap-1.5 text-sm font-semibold text-destructive">
              <CircleAlert className="h-4 w-4" aria-hidden />
              {noticeText(locale, GATE_COPY.errorTitle)}
            </p>
            <ul className="list-disc space-y-1 pl-4 text-sm text-foreground">
              {gate.errors.map((err) => (
                <li key={err.code}>{gateErrorText(locale, err.code)}</li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">
              {noticeText(locale, gate.runtimeActive ? GATE_COPY.errorStillRuns : GATE_COPY.errorNotRunning)}
            </p>
            {gate.errors.some((e) => e.detail) ? (
              <details className="text-xs text-muted-foreground">
                <summary className="cursor-pointer">{noticeText(locale, GATE_COPY.technical)}</summary>
                {gate.errors
                  .filter((e) => e.detail)
                  .map((e) => (
                    <p key={e.code} className="mt-1 break-words font-mono text-[11px]">
                      {e.detail}
                    </p>
                  ))}
              </details>
            ) : null}
          </>
        ) : (
          <>
            <p className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
              <Lock className="h-4 w-4" aria-hidden />
              {label}
            </p>
            <p className="text-sm text-foreground">
              {noticeText(
                locale,
                gate.kind === "login_only"
                  ? GATE_COPY.loginOnlyBody
                  : gate.kind === "loading"
                    ? GATE_COPY.loadingBody
                    : GATE_COPY.activeBody,
              )}
            </p>
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}

function formatOverrideValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(String).join(", ");
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.url === "string") return o.url;
    if (typeof o.message === "string") return o.message;
    return Object.keys(o).join(", ");
  }
  return String(value);
}

function OverrideBadge({ locale, override }: { locale: HiddenFieldsNoticeLocale; override: LeadFormOverrideBadge }) {
  const known = ["conversion_name", "tags", "automations", "webhook", "success", "messages"] as const;
  const rows = Object.entries(override.outcome).filter(([, v]) => v !== undefined);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={statusBadgeClass("neutral")}
          onClick={stop}
          data-testid="lead-form-override-badge"
        >
          {override.viewerDependent ? <User className="h-3 w-3" aria-hidden /> : <GitBranch className="h-3 w-3" aria-hidden />}
          {noticeText(locale, OVERRIDE_COPY.badge(override.number))}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-2" onClick={stop} onPointerDown={stop}>
        <p className="text-sm text-foreground">{noticeText(locale, OVERRIDE_COPY.body(override.number))}</p>
        <dl className="space-y-1 text-xs">
          {rows.map(([key, value]) => {
            const labelCopy = (known as readonly string[]).includes(key)
              ? OVERRIDE_COPY[key as (typeof known)[number]]
              : OVERRIDE_COPY.other;
            return (
              <div key={key} className="grid grid-cols-[7rem_1fr] gap-2">
                <dt className="text-muted-foreground">{noticeText(locale, labelCopy)}</dt>
                <dd className="break-all text-foreground">
                  {key === "messages" ? "" : formatOverrideValue(value)}
                  {!(known as readonly string[]).includes(key) ? <code className="ml-1">{key}</code> : null}
                </dd>
              </div>
            );
          })}
        </dl>
        {override.viewerDependent ? (
          <p className="flex items-start gap-1.5 rounded bg-muted px-2 py-1.5 text-xs text-foreground">
            <User className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
            {noticeText(locale, OVERRIDE_COPY.viewerNote)}
          </p>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

export default function LeadFormStatusBadges({
  locale,
  anchorRef,
  gate,
  override,
  hiddenFields,
}: LeadFormStatusBadgesProps) {
  const { card, root, visible } = useVisibleCard(anchorRef);
  const cardRef = useMemo(() => ({ current: card }), [card]);
  const topEdgeRef = useMemo(() => (root ? formTopEdgeAnchor(root) : null), [root]);
  const sessionOff = useHiddenFieldsNoticeOff();
  /** X: closed for this form until reload. */
  const [closed, setClosed] = useState(false);
  /** Eye-off chip: reopened for this form (wins over X and the session flag). */
  const [reopened, setReopened] = useState(false);

  if (!card || !root || !visible) return null;

  const hiddenCount = hiddenFields ? hiddenFields.top.length + hiddenFields.rest.length : 0;
  const hasHidden = !!hiddenFields && hiddenFields.top.length > 0;
  const panelOpen = hasHidden && (reopened || (!closed && !sessionOff));
  const showChip = hasHidden && !panelOpen;
  const hasGate = gate.kind !== "off";
  const showCluster = hasGate || !!override || showChip;

  return (
    <>
      {showCluster ? (
        <Popover open modal={false}>
          <PopoverAnchor virtualRef={cardRef as RefObject<HTMLElement>} />
          <PopoverContent
            side="top"
            align="end"
            sideOffset={6}
            {...floatingLayerProps}
            className="z-20 flex w-auto items-center gap-1.5 border-0 bg-transparent p-0 shadow-none data-[state=open]:animate-none"
            data-testid="lead-form-status-badges"
          >
            <GateBadge locale={locale} gate={gate} />
            {override ? <OverrideBadge locale={locale} override={override} /> : null}
            {showChip ? (
              <button
                type="button"
                className={cn(
                  statusBadgeClass("neutral"),
                  "border-amber-500/60 text-amber-800 dark:text-amber-400",
                )}
                onClick={(e) => {
                  stop(e);
                  setReopened(true);
                }}
                data-testid="hidden-fields-notice-reopen"
              >
                <EyeOff className="h-3 w-3" aria-hidden />
                {noticeText(locale, NOTICE_COPY.reopenChip(hiddenCount))}
              </button>
            ) : null}
          </PopoverContent>
        </Popover>
      ) : null}
      {panelOpen && hiddenFields && topEdgeRef ? (
        <Popover open modal={false}>
          <PopoverAnchor virtualRef={topEdgeRef as unknown as RefObject<HTMLElement>} />
          <PopoverContent
            side="bottom"
            align="start"
            sideOffset={0}
            {...floatingLayerProps}
            className="z-20 w-[var(--radix-popover-trigger-width)] border-0 bg-transparent p-0 shadow-none data-[state=open]:animate-none"
            data-testid="lead-form-hidden-fields-overlay"
          >
            <LeadFormHiddenFieldsNotice
              locale={locale}
              top={hiddenFields.top}
              rest={hiddenFields.rest}
              resolveBadge={hiddenFields.resolveBadge}
              onClose={() => {
                setClosed(true);
                setReopened(false);
              }}
              onHideForSession={() => {
                hideHiddenFieldsNoticeThisSession();
                setReopened(false);
              }}
            />
          </PopoverContent>
        </Popover>
      ) : null}
    </>
  );
}
