import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { sortParamKeysForDisplay, type RuntimeQueryAttribution } from "@shared/runtime-issues";

function badgeLabel(kind: "source" | "medium" | "campaign", values: string[]): string {
  const first = values[0] ?? "";
  if (values.length <= 1) return `${kind}: ${first}`;
  return `${kind}: ${first} (+${values.length - 1})`;
}

function QueryAttributionBadge({
  kind,
  values,
  fingerprint,
}: {
  kind: "source" | "medium" | "campaign";
  values: string[];
  fingerprint: string;
}) {
  if (values.length === 0) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="cursor-pointer max-w-[180px]"
          data-testid={`badge-runtime-query-${kind}-${fingerprint}`}
        >
          <Badge variant="outline" className="text-[10px] max-w-[180px] truncate">
            {badgeLabel(kind, values)}
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 space-y-2 text-sm"
        data-testid={`popover-runtime-query-${kind}-${fingerprint}`}
      >
        <p className="font-medium text-foreground capitalize">{kind}</p>
        <ul className="text-muted-foreground space-y-1">
          {values.map((value) => (
            <li key={value} className="font-mono text-xs break-all">
              {value}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

function ParamBadge({
  other,
  fingerprint,
}: {
  other: Record<string, string[]>;
  fingerprint: string;
}) {
  const keys = sortParamKeysForDisplay(Object.keys(other));
  if (keys.length === 0) return null;

  const lines = keys.flatMap((key) =>
    (other[key] ?? []).map((value) => `${key}=${value}`),
  );

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="cursor-pointer"
          data-testid={`badge-runtime-query-param-${fingerprint}`}
        >
          <Badge variant="outline" className="text-[10px]">
            param ({keys.length})
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 space-y-2 text-sm"
        data-testid={`popover-runtime-query-param-${fingerprint}`}
      >
        <p className="font-medium text-foreground">Other query params</p>
        <p className="text-xs text-muted-foreground">
          Other keys on the 404 request (e.g. gclid, utm_content). utm_* keys are listed first. Staff
          preview URLs (force_variant, edit, etc.) are not recorded.
        </p>
        <ul className="text-muted-foreground space-y-1 max-h-48 overflow-y-auto">
          {lines.map((line) => (
            <li key={line} className="font-mono text-xs break-all">
              {line}
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}

export function RuntimeIssueQueryBadges({
  attribution,
  fingerprint,
}: {
  attribution?: RuntimeQueryAttribution;
  fingerprint: string;
}) {
  if (!attribution) return null;
  const source = attribution.source ?? [];
  const medium = attribution.medium ?? [];
  const campaign = attribution.campaign ?? [];
  const other = attribution.other ?? {};
  if (source.length === 0 && medium.length === 0 && campaign.length === 0 && Object.keys(other).length === 0) {
    return null;
  }

  return (
    <>
      <QueryAttributionBadge kind="source" values={source} fingerprint={fingerprint} />
      <QueryAttributionBadge kind="medium" values={medium} fingerprint={fingerprint} />
      <QueryAttributionBadge kind="campaign" values={campaign} fingerprint={fingerprint} />
      <ParamBadge other={other} fingerprint={fingerprint} />
    </>
  );
}
