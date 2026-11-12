import { ToggleButtonBar, ToggleButtonBarTrigger } from "@/components/ui/toggle-button-bar";
import { TEST_DEFAULT_VERSION, TEST_GOALS, TEST_GOAL_LABELS, isTestGoal, type TestGoal } from "@shared/page-stats";

function versionName(v: string): string {
  return v === TEST_DEFAULT_VERSION ? "Default (live page)" : v;
}

/**
 * Goal for a test this save starts (0% to traffic). Warns, without blocking, when the
 * versions in the test have no button whose tracking reports enrollment clicks.
 */
export function TestGoalStartPicker({
  locale,
  goal,
  onChange,
  versions,
  enrollButtons,
}: {
  locale: string;
  goal: TestGoal;
  onChange: (goal: TestGoal) => void;
  /** Versions that will get traffic (`default` = live page). */
  versions: string[];
  enrollButtons: Record<string, number> | null | undefined;
}) {
  const usesClicks = goal !== "leads";
  const without = enrollButtons ? versions.filter((v) => (enrollButtons[v] ?? 0) === 0) : [];
  return (
    <div className="mb-2 space-y-1 rounded-md border border-border bg-muted/30 p-2" data-testid={`test-goal-start-${locale}`}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-medium text-foreground">Test goal</span>
        <ToggleButtonBar
          value={goal}
          onValueChange={(next) => {
            if (isTestGoal(next)) onChange(next);
          }}
          listTestId={`toggle-test-goal-start-${locale}`}
        >
          {TEST_GOALS.map((g) => (
            <ToggleButtonBarTrigger key={g} value={g} data-testid={`toggle-test-goal-start-${locale}-${g}`}>
              {TEST_GOAL_LABELS[g]}
            </ToggleButtonBarTrigger>
          ))}
        </ToggleButtonBar>
      </div>
      <p className="text-[11px] text-muted-foreground">
        Choose what decides the winner. Enrollment clicks count visits that clicked a button set to add to cart or checkout.
        Clicks are intent, not purchases. You can change the goal while the test runs.
      </p>
      {usesClicks && enrollButtons && without.length === versions.length && versions.length > 0 && (
        <p className="text-[11px] text-status-away" data-testid={`test-goal-start-no-buttons-${locale}`}>
          No button in these versions reports enrollment clicks, so this goal will stay at zero. Set the button&apos;s tracking in the
          section editor&apos;s Ecommerce tab.
        </p>
      )}
      {usesClicks && enrollButtons && without.length > 0 && without.length < versions.length && (
        <p className="text-[11px] text-status-away" data-testid={`test-goal-start-partial-buttons-${locale}`}>
          {without.map(versionName).join(", ")} {without.length === 1 ? "has" : "have"} no button that reports enrollment clicks.
        </p>
      )}
    </div>
  );
}
