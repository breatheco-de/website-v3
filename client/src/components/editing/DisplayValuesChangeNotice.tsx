import { IconAlertTriangle } from "@tabler/icons-react";
import { cn } from "@/lib/utils";

export const DISPLAY_VALUES_CHANGE_CODE = "display_values_change";

export type DisplayValueChange = { field_path: string; before: unknown; after: unknown };

const FIELD_LABELS: Record<string, string> = {
  funnel: "funnel",
  authors: "authors",
  published_at: "publish date",
  detached: "template detach",
};

function fieldLabel(fieldPath: string): string {
  return FIELD_LABELS[fieldPath] ?? fieldPath;
}

function languageName(locale: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(locale) ?? locale;
  } catch {
    return locale;
  }
}

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === "") return "(empty — uses the content type default)";
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function DisplayValuesChangeNotice({
  locale,
  fields,
  paths,
  className,
}: {
  locale: string;
  fields: DisplayValueChange[];
  paths?: { common?: string; locale?: string };
  className?: string;
}) {
  if (fields.length === 0) return null;
  const names = fields.map((f) => fieldLabel(f.field_path)).join(", ");
  return (
    <div
      role="alert"
      className={cn("rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground", className)}
      data-testid="notice-display-values-change"
    >
      <div className="flex items-start gap-2">
        <IconAlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p>
          Publishing changes what {languageName(locale)} visitors see for: <strong>{names}</strong>. These now come
          from the page-wide settings shared by every language.
        </p>
      </div>
      <details className="mt-2 pl-6 text-xs text-muted-foreground">
        <summary className="cursor-pointer hover:text-foreground">Read more (advanced)</summary>
        <p className="mt-2">
          This language file still holds its own copy of page-wide fields. Publishing never writes those to a
          language file, so the copy is dropped and the page shows the shared value instead.
        </p>
        <ul className="mt-2 space-y-1.5">
          {fields.map((f) => (
            <li key={f.field_path} className="leading-snug">
              <code className="rounded bg-muted px-1 py-0.5 text-foreground">{f.field_path}</code>
              <div className="mt-0.5 break-all">Now: {formatValue(f.before)}</div>
              <div className="break-all">After publish: {formatValue(f.after)}</div>
            </li>
          ))}
        </ul>
        {paths?.common || paths?.locale ? (
          <p className="mt-2 break-all">
            Shared value: <code>{paths.common}</code> · Language copy dropped from <code>{paths.locale}</code>
          </p>
        ) : null}
      </details>
    </div>
  );
}
