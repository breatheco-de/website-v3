import { IconAlertTriangle } from "@tabler/icons-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { minLengthHint } from "@/lib/minLengthHint";

export const BLOCKER_OVERRIDE_REASON_MIN = 20;

type OpenBlocker = { id: number; body: string; staff_summary?: string | null };

type BlockerOverrideFieldProps = {
  blockers: OpenBlocker[];
  reason: string;
  onReasonChange: (value: string) => void;
  /** "approve" for edits, "accept" for ideas. */
  verb: "approve" | "accept";
  testIdPrefix: string;
};

export function blockerOverrideReasonOk(reason: string): boolean {
  return reason.trim().length >= BLOCKER_OVERRIDE_REASON_MIN;
}

export function BlockerOverrideField({
  blockers,
  reason,
  onReasonChange,
  verb,
  testIdPrefix,
}: BlockerOverrideFieldProps) {
  const count = blockers.length;
  const hint = reason.trim().length > 0 ? minLengthHint(reason, BLOCKER_OVERRIDE_REASON_MIN) : null;
  const action = verb === "accept" ? "Accepting" : "Approving";
  return (
    <div
      className="space-y-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm"
      data-testid={`${testIdPrefix}-override`}
    >
      <p className="flex items-start gap-2 font-medium text-destructive">
        <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        {count === 1
          ? "This proposal still has 1 open change request."
          : `This proposal still has ${count} open change requests.`}
      </p>
      <p className="text-muted-foreground">
        {action} anyway goes ahead now and marks {count === 1 ? "it" : "them"} resolved with your
        reason, which the people who asked for changes can see.
      </p>
      <ul className="list-disc space-y-1 pl-5 text-foreground" data-testid={`${testIdPrefix}-override-list`}>
        {blockers.map((b) => (
          <li key={b.id} className="line-clamp-3">
            {(b.staff_summary || b.body).trim()}
          </li>
        ))}
      </ul>
      <div className="space-y-1">
        <Label htmlFor={`${testIdPrefix}-override-reason`} className="text-foreground">
          Why {verb} anyway?
        </Label>
        <Textarea
          id={`${testIdPrefix}-override-reason`}
          value={reason}
          onChange={(e) => onReasonChange(e.target.value)}
          placeholder={`Why this is OK to ${verb} with these requests still open (min ${BLOCKER_OVERRIDE_REASON_MIN} characters)`}
          data-testid={`${testIdPrefix}-override-reason`}
        />
        {hint ? <p className={hint.className}>{hint.text}</p> : null}
      </div>
    </div>
  );
}
