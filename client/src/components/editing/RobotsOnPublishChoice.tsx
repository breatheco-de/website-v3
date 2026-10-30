import { Search } from "lucide-react";

export const ROBOTS_CHANGE_ON_PUBLISH_CODE = "robots_change_on_publish";

export type RobotsOnPublishChoice = "keep_live" | "use_draft";

export type RobotsChangeRow = { locale: string; live_robots: string; draft_robots: string };

/** Rows from a `robots_change_on_publish` response (single locale or `details.locales[]`). */
export function robotsChangeRows(
  details: { locale?: string; live_robots?: string; draft_robots?: string; locales?: RobotsChangeRow[] } | undefined,
  fallbackLocale: string,
): RobotsChangeRow[] {
  if (Array.isArray(details?.locales) && details.locales.length > 0) return details.locales;
  return [
    {
      locale: details?.locale ?? fallbackLocale,
      live_robots: details?.live_robots ?? "index, follow",
      draft_robots: details?.draft_robots ?? "index, follow",
    },
  ];
}

function languageList(rows: RobotsChangeRow[]): string {
  return rows.map((r) => r.locale.toUpperCase()).join(", ");
}

export function RobotsOnPublishChoiceField({
  rows,
  value,
  onChange,
  agentChoice,
  name,
  testIdPrefix = "robots-on-publish",
}: {
  rows: RobotsChangeRow[];
  value: RobotsOnPublishChoice | null;
  onChange: (v: RobotsOnPublishChoice) => void;
  /** Proposal author's declared intent, shown next to the matching option. */
  agentChoice?: RobotsOnPublishChoice | null;
  name: string;
  testIdPrefix?: string;
}) {
  const single = rows.length === 1 ? rows[0] : null;
  const options: Array<{ value: RobotsOnPublishChoice; label: string; detail: string }> = [
    {
      value: "keep_live",
      label: single ? `Keep live: ${single.live_robots}` : "Keep what's live now",
      detail: "Everything else in the draft is published; search engines keep seeing the page as they do today.",
    },
    {
      value: "use_draft",
      label: single ? `Use draft: ${single.draft_robots}` : "Use the draft's setting",
      detail: "The draft's crawl setting goes live with the rest of the draft.",
    },
  ];
  return (
    <div
      className="space-y-2 rounded-md border bg-muted/40 px-3 py-2"
      data-testid={`${testIdPrefix}-notice`}
    >
      <p className="flex items-start gap-1.5 text-sm text-foreground">
        <Search className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" aria-hidden />
        <span>
          This draft changes whether search engines can see this page in {languageList(rows)}. Keep what&apos;s live
          now, or use the draft&apos;s setting?
        </span>
      </p>
      {rows.length > 1 ? (
        <ul className="space-y-0.5 pl-6 text-xs text-muted-foreground">
          {rows.map((r) => (
            <li key={r.locale}>
              <span className="font-mono uppercase">{r.locale}</span>: live{" "}
              <span className="font-mono text-foreground">{r.live_robots}</span>, draft{" "}
              <span className="font-mono text-foreground">{r.draft_robots}</span>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="space-y-1.5">
        {options.map((o) => (
          <label
            key={o.value}
            className={`flex items-start gap-2 rounded-md border px-3 py-2 cursor-pointer hover-elevate ${value === o.value ? "border-ring bg-background" : ""}`}
            data-testid={`${testIdPrefix}-option-${o.value}`}
          >
            <input
              type="radio"
              name={name}
              checked={value === o.value}
              onChange={() => onChange(o.value)}
              className="mt-0.5 shrink-0"
            />
            <span className="space-y-0.5">
              <span className="block text-xs font-medium text-foreground">
                {o.label}
                {agentChoice === o.value ? (
                  <span className="ml-1.5 font-normal text-muted-foreground">(agent&apos;s choice)</span>
                ) : null}
              </span>
              <span className="block text-xs text-muted-foreground">{o.detail}</span>
            </span>
          </label>
        ))}
      </div>
      {rows.length > 1 ? (
        <p className="text-xs text-muted-foreground">This choice applies to every language listed above.</p>
      ) : null}
    </div>
  );
}
