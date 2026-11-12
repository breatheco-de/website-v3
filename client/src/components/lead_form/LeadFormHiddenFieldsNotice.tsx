// Edit-mode only (lazy): staff summary of hidden values a LeadForm sends.
import { useState, type SyntheticEvent } from "react";
import { ChevronRight, EyeOff, Loader2, User, X } from "lucide-react";
import { badgeVariants } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { HiddenBadgeRef } from "@/components/lead_form/hiddenFieldPriority";
import type {
  HiddenBadgeDetail,
  HiddenFieldsNoticeLocale,
} from "@/components/lead_form/hiddenFieldsNoticeTypes";
import {
  NOTICE_COPY,
  hiddenReasonText,
  noticeText,
  signupSourceText,
  sourceText,
} from "@/components/lead_form/hiddenFieldsNoticeCopy";
import {
  isNonEmptyLeadFormWireScalar,
  type ResolvedLeadFormField,
} from "@/components/lead_form/resolveLeadFormFieldValues";

export interface LeadFormHiddenFieldsNoticeProps {
  locale: HiddenFieldsNoticeLocale;
  top: HiddenBadgeRef[];
  rest: HiddenBadgeRef[];
  /** Resolves one badge with the same code the submit uses (called lazily). */
  resolveBadge: (ref: HiddenBadgeRef) => HiddenBadgeDetail;
  /** X: close for this form until reload. */
  onClose: () => void;
  /** Close on every lead form for the rest of the browser session. */
  onHideForSession: () => void;
}

/** Badge clicks and portalled content must not reach EditableSection's select handlers. */
const stop = (e: SyntheticEvent) => e.stopPropagation();

function formatValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function badgeLabel(detail: HiddenBadgeDetail, locale: HiddenFieldsNoticeLocale): string {
  return detail.kind === "field" ? detail.name : noticeText(locale, NOTICE_COPY.signupKeyLabel(detail.key));
}

function detailState(detail: HiddenBadgeDetail) {
  const value = detail.kind === "field" ? detail.resolved.value : detail.value;
  const pending = detail.kind === "field" ? detail.resolved.pending : detail.pending;
  const viewerDependent =
    detail.kind === "field" ? detail.resolved.viewerDependent : detail.viewerDependent;
  return { value, pending, viewerDependent, empty: !isNonEmptyLeadFormWireScalar(value) };
}

function ValueLine({
  locale,
  value,
  pending,
}: {
  locale: HiddenFieldsNoticeLocale;
  value: unknown;
  pending: boolean;
}) {
  const empty = !isNonEmptyLeadFormWireScalar(value);
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {noticeText(locale, NOTICE_COPY.valueLabel)}
      </p>
      {pending && empty ? (
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
          {noticeText(locale, NOTICE_COPY.stillLoading)}
        </p>
      ) : empty ? (
        <p className="text-sm italic text-muted-foreground">{noticeText(locale, NOTICE_COPY.nothingSent)}</p>
      ) : (
        <code className="block break-all rounded bg-muted px-1.5 py-1 text-xs text-foreground">
          {formatValue(value)}
        </code>
      )}
    </div>
  );
}

function CandidatesList({
  locale,
  resolved,
}: {
  locale: HiddenFieldsNoticeLocale;
  resolved: ResolvedLeadFormField;
}) {
  if (resolved.candidates.length < 2) return null;
  const winnerIdx = resolved.candidates.findIndex(
    (c) => c.value === resolved.value && isNonEmptyLeadFormWireScalar(c.value),
  );
  return (
    <Collapsible>
      <CollapsibleTrigger className="group flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronRight className="h-3 w-3 transition-transform group-data-[state=open]:rotate-90" aria-hidden />
        {noticeText(locale, NOTICE_COPY.otherSources)}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <ol className="mt-1.5 space-y-1 border-l border-border pl-2.5">
          {resolved.candidates.map((c, i) => {
            const filled = isNonEmptyLeadFormWireScalar(c.value);
            return (
              <li
                key={`${c.source}-${i}`}
                className={cn("text-xs", i === winnerIdx ? "text-foreground" : "text-muted-foreground")}
              >
                <span>{sourceText(locale, c.source, c.auto)}</span>
                {": "}
                {filled ? (
                  <code className="break-all">{formatValue(c.value)}</code>
                ) : (
                  <span className="italic">{noticeText(locale, NOTICE_COPY.emptyCandidate)}</span>
                )}
                {i === winnerIdx ? (
                  <span className="ml-1 font-medium text-primary">({noticeText(locale, NOTICE_COPY.winner)})</span>
                ) : null}
              </li>
            );
          })}
        </ol>
      </CollapsibleContent>
    </Collapsible>
  );
}

function FieldSource({ locale, resolved }: { locale: HiddenFieldsNoticeLocale; resolved: ResolvedLeadFormField }) {
  if (!resolved.source) return null;
  return (
    <div className="space-y-0.5">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {noticeText(locale, NOTICE_COPY.sourceLabel)}
      </p>
      <p className="text-sm text-foreground">{sourceText(locale, resolved.source, resolved.auto)}</p>
      {resolved.viaFormState ? (
        <p className="text-xs text-muted-foreground">{noticeText(locale, NOTICE_COPY.viaFormState)}</p>
      ) : null}
      {resolved.programRawValue && resolved.programRawValue !== resolved.value ? (
        <p className="text-xs text-muted-foreground">
          {noticeText(locale, NOTICE_COPY.programMapped(resolved.programRawValue))}
        </p>
      ) : null}
    </div>
  );
}

export function HiddenBadgeDetailBody({
  locale,
  detail,
}: {
  locale: HiddenFieldsNoticeLocale;
  detail: HiddenBadgeDetail;
}) {
  const { value, pending, viewerDependent } = detailState(detail);
  return (
    <div className="space-y-3">
      <ValueLine locale={locale} value={value} pending={pending} />
      {detail.kind === "field" ? (
        <>
          <FieldSource locale={locale} resolved={detail.resolved} />
          <div className="space-y-0.5">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {noticeText(locale, NOTICE_COPY.whyHidden)}
            </p>
            <p className="text-sm text-foreground">{hiddenReasonText(locale, detail.hiddenReason)}</p>
          </div>
        </>
      ) : (
        <div className="space-y-0.5">
          <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
            {noticeText(locale, NOTICE_COPY.sourceLabel)}
          </p>
          <p className="text-sm text-foreground">{signupSourceText(locale, detail.source, detail.sourcePath)}</p>
          <p className="text-xs text-muted-foreground">{noticeText(locale, NOTICE_COPY.signupGroup)}</p>
          {detail.formField?.source ? (
            <p className="text-xs text-muted-foreground">
              {sourceText(locale, detail.formField.source, detail.formField.auto)}
            </p>
          ) : null}
        </div>
      )}
      {viewerDependent ? (
        <p className="flex items-start gap-1.5 rounded bg-muted px-2 py-1.5 text-xs text-foreground">
          <User className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />
          {noticeText(locale, NOTICE_COPY.viewerNote)}
        </p>
      ) : null}
      {detail.kind === "field" ? <CandidatesList locale={locale} resolved={detail.resolved} /> : null}
      {detail.kind === "signup" && detail.formField ? (
        <CandidatesList locale={locale} resolved={detail.formField} />
      ) : null}
    </div>
  );
}

// The panel carries the warning tint; chips stay neutral so names read easily.
function badgeClassName(empty: boolean) {
  return cn(
    badgeVariants({ variant: "secondary" }),
    "cursor-pointer gap-1 px-2 py-0.5 font-medium",
    "border-amber-500/40 bg-background text-foreground hover:bg-amber-500/10",
    empty && "text-muted-foreground line-through decoration-muted-foreground/70",
  );
}

function HiddenBadge({ locale, detail }: { locale: HiddenFieldsNoticeLocale; detail: HiddenBadgeDetail }) {
  const { pending, viewerDependent, empty } = detailState(detail);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={badgeClassName(empty && !pending)}
          onClick={stop}
          data-testid={`hidden-field-badge-${detail.id}`}
          title={empty && !pending ? noticeText(locale, NOTICE_COPY.nothingSent) : undefined}
        >
          {pending && empty ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden /> : null}
          {viewerDependent ? <User className="h-3 w-3" aria-hidden /> : null}
          {badgeLabel(detail, locale)}
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80" onClick={stop} onPointerDown={stop}>
        <p className="mb-2 text-sm font-semibold text-foreground">{badgeLabel(detail, locale)}</p>
        <HiddenBadgeDetailBody locale={locale} detail={detail} />
      </PopoverContent>
    </Popover>
  );
}

function OtherFieldsDialog({
  locale,
  rest,
  resolveBadge,
}: Pick<LeadFormHiddenFieldsNoticeProps, "locale" | "rest" | "resolveBadge">) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={badgeClassName(false)}
        onClick={(e) => {
          stop(e);
          setOpen(true);
        }}
        data-testid="hidden-fields-other"
      >
        {noticeText(locale, NOTICE_COPY.otherFields(rest.length))}
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        {open ? (
          <OtherFieldsDialogContent locale={locale} rest={rest} resolveBadge={resolveBadge} />
        ) : null}
      </Dialog>
    </>
  );
}

/** Mounted only while the dialog is open, so the rest resolve on open. */
function OtherFieldsDialogContent({
  locale,
  rest,
  resolveBadge,
}: Pick<LeadFormHiddenFieldsNoticeProps, "locale" | "rest" | "resolveBadge">) {
  const details = rest.map(resolveBadge);
  return (
    <DialogContent className="max-h-[85vh] max-w-lg overflow-y-auto" onClick={stop} onPointerDown={stop}>
      <DialogHeader>
        <DialogTitle>{noticeText(locale, NOTICE_COPY.otherFieldsTitle)}</DialogTitle>
        <DialogDescription>{noticeText(locale, NOTICE_COPY.otherFieldsDescription)}</DialogDescription>
      </DialogHeader>
      <ul className="divide-y divide-border">
        {details.map((detail) => (
          <li key={detail.id} className="py-3" data-testid={`hidden-field-row-${detail.id}`}>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-foreground">
              {detailState(detail).viewerDependent ? <User className="h-3.5 w-3.5" aria-hidden /> : null}
              {badgeLabel(detail, locale)}
            </p>
            <HiddenBadgeDetailBody locale={locale} detail={detail} />
          </li>
        ))}
      </ul>
    </DialogContent>
  );
}

export default function LeadFormHiddenFieldsNotice({
  locale,
  top,
  rest,
  resolveBadge,
  onClose,
  onHideForSession,
}: LeadFormHiddenFieldsNoticeProps) {
  if (top.length === 0) return null;
  const topDetails = top.map(resolveBadge);

  return (
    // Solid base so the panel stays readable while it floats over the form fields.
    <div
      className="overflow-hidden rounded-md border border-amber-500/40 bg-background shadow-lg"
      onClick={stop}
      onPointerDown={stop}
      data-testid="hidden-fields-notice"
    >
      <div className="bg-amber-500/10 px-2.5 py-2">
        <div className="mb-1.5 flex items-start justify-between gap-2">
          <p className="flex items-center gap-1.5 text-xs font-medium text-amber-800 dark:text-amber-400">
            <EyeOff className="h-3.5 w-3.5 shrink-0" aria-hidden />
            {noticeText(locale, NOTICE_COPY.title)}
          </p>
          <CloseConfirm locale={locale} onClose={onClose} onHideForSession={onHideForSession} />
        </div>
        <div className="flex flex-wrap gap-1.5">
          {topDetails.map((detail) => (
            <HiddenBadge key={detail.id} locale={locale} detail={detail} />
          ))}
          {rest.length > 0 ? <OtherFieldsDialog locale={locale} rest={rest} resolveBadge={resolveBadge} /> : null}
        </div>
      </div>
    </div>
  );
}

/** X opens a small confirm: close this form's notice, optionally for the whole session. */
function CloseConfirm({
  locale,
  onClose,
  onHideForSession,
}: Pick<LeadFormHiddenFieldsNoticeProps, "locale" | "onClose" | "onHideForSession">) {
  const [open, setOpen] = useState(false);
  const [forSession, setForSession] = useState(false);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setForSession(false);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          onClick={stop}
          className="-mr-1 -mt-0.5 rounded p-0.5 text-amber-800 hover:bg-amber-500/20 dark:text-amber-400"
          aria-label={noticeText(locale, NOTICE_COPY.close)}
          data-testid="hidden-fields-notice-close"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-64 space-y-3 p-3"
        onClick={stop}
        onPointerDown={stop}
        data-testid="hidden-fields-close-confirm"
      >
        <div className="space-y-1">
          <p className="text-sm font-semibold text-foreground">
            {noticeText(locale, NOTICE_COPY.closeConfirmTitle)}
          </p>
          <p className="text-xs text-muted-foreground">{noticeText(locale, NOTICE_COPY.closeConfirmBody)}</p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-foreground">
          <Checkbox
            checked={forSession}
            onCheckedChange={(checked) => setForSession(checked === true)}
            data-testid="hidden-fields-close-confirm-session"
          />
          {noticeText(locale, NOTICE_COPY.hideForSession)}
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
            {noticeText(locale, NOTICE_COPY.cancel)}
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={() => {
              setOpen(false);
              if (forSession) onHideForSession();
              else onClose();
            }}
            data-testid="hidden-fields-close-confirm-ok"
          >
            {noticeText(locale, NOTICE_COPY.close)}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
