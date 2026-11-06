import { IconGitBranch } from "@tabler/icons-react";

/** Warning chip linking to form rules — place left of the card edit control. */
export function OverrideRulesBadge({
  count,
  onClick,
  testId,
}: {
  count: number;
  onClick: () => void;
  testId: string;
}) {
  if (count <= 0) return null;
  const label = `${count} override rule${count === 1 ? "" : "s"}`;
  return (
    <button
      type="button"
      className="inline-flex max-w-[10rem] shrink items-center gap-1 truncate rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0 text-[10px] font-medium text-amber-800 hover:bg-amber-500/15 dark:text-amber-200"
      data-testid={testId}
      onClick={onClick}
      title={label}
    >
      <IconGitBranch className="h-3 w-3 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}
