import { IconWorld } from "@tabler/icons-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { assessSlugLocaleMatch, slugLocaleMismatchHint } from "@shared/slug-locale-heuristic";

export const LOCALE_URL_SLUG_REQUIRED_CODE = "locale_url_slug_required";

const SLUG_FORMAT = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function isValidLocaleUrlSlug(value: string): boolean {
  return SLUG_FORMAT.test(value.trim());
}

function languageName(locale: string): string {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(locale) ?? locale;
  } catch {
    return locale;
  }
}

export function LocaleUrlSlugPrompt({
  locale,
  currentSlug,
  value,
  onChange,
  className,
}: {
  locale: string;
  currentSlug: string;
  value: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  const trimmed = value.trim();
  const formatOk = trimmed === "" || isValidLocaleUrlSlug(trimmed);
  const match = trimmed && formatOk ? assessSlugLocaleMatch(trimmed, locale) : null;
  const hint = match && !match.ok ? slugLocaleMismatchHint(match) : null;
  return (
    <div
      role="alert"
      className={cn("rounded-md border border-border bg-muted/40 p-3 text-sm text-foreground space-y-2", className)}
      data-testid="prompt-locale-url-slug"
    >
      <div className="flex items-start gap-2">
        <IconWorld className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <p>
          Pick the web address for the {languageName(locale)} page. Right now it would reuse{" "}
          <code className="rounded bg-muted px-1 py-0.5">{currentSlug}</code>, the same address word as the other
          language. Use a word in {languageName(locale)}, or keep it if it&apos;s a name that works everywhere.
        </p>
      </div>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={currentSlug}
        aria-label={`Web address for ${languageName(locale)}`}
        data-testid="input-locale-url-slug"
      />
      {!formatOk ? (
        <p className="text-xs text-destructive">Use lowercase letters, numbers, and hyphens only.</p>
      ) : hint ? (
        <p className="text-xs text-status-away">{hint} Fine if it is a name.</p>
      ) : null}
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer hover:text-foreground">Read more (advanced)</summary>
        <p className="mt-2">
          Publishing writes <code>slug:</code> into <code>{locale}.yml</code>. The folder name{" "}
          <code>{currentSlug}</code> stays the page&apos;s ID, and the other languages keep their addresses. The address is
          checked against other pages before anything is written.
        </p>
      </details>
    </div>
  );
}
