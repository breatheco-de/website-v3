import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { IconClockExclamation, IconInfoCircle } from "@tabler/icons-react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useToast } from "@/hooks/use-toast";
import { getDebugToken } from "@/hooks/useDebugAuth";
import { apiFetch } from "@/lib/queryClient";
import { cn } from "@/lib/utils";
import {
  DRAFT_CLEANUP_DELETE_DAYS,
  DRAFT_CLEANUP_FLAG_DAYS,
  DRAFT_CLEANUP_MIN_WARNING_DAYS,
  DRAFT_CLEANUP_SAFE_DAYS,
  VARIANT_STALE_DAYS,
  formatVariantDay,
  relativeVariantDays,
  type VariantFacts,
  type VariantHealth,
  type VariantVerdict,
} from "@shared/variant-health";

/** Response of GET /api/versioning/:type/:slug/:locale/:variant/info (server/versioning/variant-info.ts). */
export interface VariantInfoResponse {
  locale: string;
  slug: string;
  file: string;
  allocation: number;
  facts: VariantFacts;
  health: VariantHealth;
  proposal: { id: string; title?: string; status?: string; proposer_username?: string } | null;
  siblings: Array<{ locale: string; updated_at: string | null; verdict: VariantVerdict }>;
  details?: {
    changed_fields: string[];
    live_changed_fields?: string[];
    based_on: { locale: string | null; common: string | null; at: string } | null;
    stale_days: number;
  };
}

const LOCALE_NAMES: Record<string, string> = { en: "English", es: "Spanish", pt: "Portuguese", it: "Italian", de: "German", fr: "French" };

const localeName = (code: string) => LOCALE_NAMES[code] ?? code.toUpperCase();

export function useVariantInfo(opts: {
  contentType: string | null | undefined;
  versioningSlug: string;
  locale: string;
  variantSlug: string;
  enabled: boolean;
}) {
  const { contentType, versioningSlug, locale, variantSlug, enabled } = opts;
  return useQuery({
    queryKey: ["/api/versioning/variant-info", contentType, versioningSlug, locale, variantSlug],
    enabled: enabled && Boolean(contentType && versioningSlug),
    staleTime: 30_000,
    retry: false,
    queryFn: async () => {
      const token = getDebugToken();
      const res = await apiFetch(
        `/api/versioning/${encodeURIComponent(contentType!)}/${encodeURIComponent(versioningSlug)}/${encodeURIComponent(locale)}/${encodeURIComponent(variantSlug)}/info`,
        token ? { headers: { Authorization: `Token ${token}` } } : undefined,
      );
      if (!res.ok) throw new Error("Failed to load version details");
      return (await res.json()) as VariantInfoResponse;
    },
  });
}

const VERDICT_LABEL: Record<VariantVerdict, string> = {
  cannot_delete: "Can't delete yet",
  check_first: "Check before deleting",
  probably_safe: "Probably safe to delete",
};

const VERDICT_CLASS: Record<VariantVerdict, string> = {
  cannot_delete: "border-destructive/40 bg-destructive/10 text-destructive",
  check_first: "border-status-away/40 bg-status-away/10 text-foreground",
  probably_safe: "border-status-online/40 bg-status-online/10 text-foreground",
};

function dateLine(label: string, iso: string | null | undefined, now: number): string | null {
  const rel = relativeVariantDays(iso, now);
  const day = formatVariantDay(iso);
  return rel && day ? `${label} ${rel} (${day})` : null;
}

/** Verdict box + reasons; also used inside the delete confirmation dialog. */
export function VariantVerdictSummary({ info }: { info: VariantInfoResponse }) {
  const { health } = info;
  const extra = health.reasons.slice(1);
  return (
    <div
      className={cn("rounded-md border px-2.5 py-2 space-y-1", VERDICT_CLASS[health.verdict])}
      data-testid={`variant-verdict-${info.locale}-${info.slug}`}
    >
      <p className="text-xs font-medium">{VERDICT_LABEL[health.verdict]}</p>
      <p className="text-xs text-muted-foreground leading-snug">{health.summary}</p>
      {extra.length > 0 && (
        <ul className="list-disc pl-4 text-xs text-muted-foreground space-y-0.5">
          {extra.map((r) => (
            <li key={r.code}>{r.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Scheduled deletion by the daily cleanup, with "Keep for now". */
function CleanupNotice({ info, keepUrl, onKept }: { info: VariantInfoResponse; keepUrl: string | null; onKept?: () => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const cleanup = info.health.cleanup;
  if (!cleanup) return null;
  const since = formatVariantDay(info.health.last_activity_at);
  const deletes = formatVariantDay(cleanup.deletes_at) ?? "soon";

  const keep = async () => {
    if (!keepUrl) return;
    setBusy(true);
    try {
      const token = getDebugToken();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Token ${token}`;
      const res = await fetch(keepUrl, { method: "POST", headers });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        toast({ title: data.error || "Could not keep this draft", variant: "destructive" });
        return;
      }
      toast({ title: "Draft kept", description: "It won't be deleted. The cleanup clock starts again today." });
      await queryClient.invalidateQueries({ queryKey: ["/api/versioning/variant-info"] });
      onKept?.();
    } catch {
      toast({ title: "Could not keep this draft", variant: "destructive" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="rounded-md border border-destructive/40 bg-destructive/10 px-2.5 py-2 space-y-1.5"
      data-testid={`variant-cleanup-notice-${info.locale}-${info.slug}`}
    >
      <p className="text-xs text-foreground leading-snug">
        {since ? `Not edited since ${since}. ` : ""}It will be deleted on {deletes} unless someone edits it.
      </p>
      {keepUrl && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          disabled={busy}
          onClick={keep}
          data-testid={`button-variant-keep-${info.locale}-${info.slug}`}
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Keep for now"}
        </Button>
      )}
    </div>
  );
}

function VariantInfoBody({
  info,
  keepUrl,
  onKept,
}: {
  info: VariantInfoResponse;
  keepUrl: string | null;
  onKept?: () => void;
}) {
  const now = Date.now();
  const { health, facts, details } = info;
  const created =
    health.created_source === "first_seen"
      ? health.created_at
        ? `Date unknown; tracked since ${formatVariantDay(health.created_at)}`
        : null
      : dateLine(health.created_source === "based_on" ? "Created around" : "Created", health.created_at, now);
  const edited = dateLine("Last edited", health.updated_at, now);
  const behind = health.notes.find((n) => n.code === "behind_live");
  const otherNotes = health.notes.filter((n) => n.code !== "behind_live");

  return (
    <div className="space-y-2.5">
      <CleanupNotice info={info} keepUrl={keepUrl} onKept={onKept} />
      <VariantVerdictSummary info={info} />

      <div className="space-y-0.5 text-xs text-muted-foreground">
        <p>{created ?? "Age unknown"}</p>
        {edited && <p>{edited}</p>}
      </div>

      <div className="space-y-0.5">
        <p className="text-xs font-medium text-foreground">Why it exists</p>
        <p className="text-xs text-muted-foreground leading-snug">{health.purpose.text}</p>
      </div>

      {behind && (
        <p className="rounded-md border border-status-away/40 bg-status-away/10 px-2.5 py-1.5 text-xs text-foreground leading-snug">
          {behind.message}
        </p>
      )}

      {info.siblings.length > 0 && (
        <div className="space-y-0.5 text-xs text-muted-foreground">
          {info.siblings.map((s) => {
            const rel = relativeVariantDays(s.updated_at, now);
            return (
              <p key={s.locale}>
                Also exists in {localeName(s.locale)}
                {rel ? `, edited ${rel}` : ""}. Deleting here doesn't delete that copy.
              </p>
            );
          })}
        </div>
      )}

      {otherNotes.map((n) => (
        <p key={n.code} className="text-xs text-muted-foreground leading-snug">
          {n.message}
        </p>
      ))}

      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer hover:text-foreground">Read more (advanced)</summary>
        <ul className="mt-1 list-disc pl-4 space-y-0.5 break-words">
          <li>
            File: <code className="bg-muted px-1 rounded">{info.file}</code>
          </li>
          <li>
            Changed vs live:{" "}
            {facts.changes_vs_live === null
              ? "no live version to compare"
              : details?.changed_fields.length
                ? details.changed_fields.join(", ")
                : "nothing"}
          </li>
          {details?.live_changed_fields?.length ? (
            <li>Live changed since it was made: {details.live_changed_fields.join(", ")}</li>
          ) : null}
          {details?.based_on ? (
            <li>
              Based on live {formatVariantDay(details.based_on.at) ?? "?"} · hashes{" "}
              <code className="bg-muted px-1 rounded">{details.based_on.locale?.slice(0, 8) ?? "none"}</code> /{" "}
              <code className="bg-muted px-1 rounded">{details.based_on.common?.slice(0, 8) ?? "none"}</code>
            </li>
          ) : null}
          <li>
            Test:{" "}
            {facts.test.experiment_id
              ? `${facts.test.experiment_id} (${facts.test.started_at ?? "?"} → ${facts.test.ended_at ?? "running"})`
              : facts.test.state === "unknown"
                ? "history unavailable"
                : "never in a test"}
          </li>
          <li>
            Stale after {details?.stale_days ?? VARIANT_STALE_DAYS} days without creation or edits. Dates from{" "}
            <code className="bg-muted px-1 rounded">_draft.created_at</code> (or{" "}
            <code className="bg-muted px-1 rounded">_draft.based_on.at</code>) and the file's{" "}
            <code className="bg-muted px-1 rounded">updated_at</code>.
          </li>
          <li>
            Automatic cleanup (drafts not linked to a proposal, live server only): a draft identical to live is deleted
            after {DRAFT_CLEANUP_SAFE_DAYS} days without edits. A draft with unpublished changes, or a language that
            isn't live yet, is flagged after {DRAFT_CLEANUP_FLAG_DAYS} days and deleted at {DRAFT_CLEANUP_DELETE_DAYS},
            never sooner than {DRAFT_CLEANUP_MIN_WARNING_DAYS} days after the flag. Any edit or Keep for now resets
            the clock.
          </li>
          <li>
            Never deleted automatically: versions with traffic, versions in a running test or one that ended in the
            last {VARIANT_STALE_DAYS} days, the only draft of an unpublished page, and proposal drafts.
          </li>
          <li>
            A deleted draft can be recovered by hand from this page folder's history in the content repo on GitHub.
          </li>
        </ul>
      </details>
    </div>
  );
}

/**
 * Info icon on a variant row: what this version is, how old, and whether it can be deleted.
 * A draft flagged by the daily cleanup shows a "Deletes {date}" badge instead.
 */
export function VariantInfoPopover({
  contentType,
  versioningSlug,
  locale,
  variantSlug,
  cleanup,
  onKept,
}: {
  contentType: string | null | undefined;
  versioningSlug: string;
  locale: string;
  variantSlug: string;
  cleanup?: { deletes_at: string } | null;
  onKept?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const query = useVariantInfo({ contentType, versioningSlug, locale, variantSlug, enabled: open });
  const keepUrl =
    contentType && versioningSlug
      ? `/api/versioning/${encodeURIComponent(contentType)}/${encodeURIComponent(versioningSlug)}/${encodeURIComponent(locale)}/${encodeURIComponent(variantSlug)}/keep`
      : null;
  const deletesDay = cleanup ? formatVariantDay(cleanup.deletes_at) : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {deletesDay ? (
          <button
            type="button"
            className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-destructive/40 bg-destructive/10 px-1.5 text-[10px] leading-4 text-destructive hover:bg-destructive/20"
            aria-label={`Version ${variantSlug} will be deleted on ${deletesDay}`}
            title="Scheduled for automatic deletion. Click for details."
            data-testid={`badge-variant-cleanup-${locale}-${variantSlug}`}
          >
            <IconClockExclamation className="h-3 w-3" />
            Deletes {deletesDay}
          </button>
        ) : (
          <button
            type="button"
            className="inline-flex shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground"
            aria-label={`About version ${variantSlug}`}
            title="About this version"
            data-testid={`button-variant-info-${locale}-${variantSlug}`}
          >
            <IconInfoCircle className="h-3.5 w-3.5" />
          </button>
        )}
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-80 text-sm z-[10001]"
        data-testid={`popover-variant-info-${locale}-${variantSlug}`}
      >
        <p className="mb-2 text-xs text-muted-foreground">
          About this version: how old it is, whether anyone is working on it, and whether it can be deleted.
        </p>
        {query.isLoading ? (
          <div className="flex items-center justify-center py-4">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
          </div>
        ) : query.isError || !query.data ? (
          <p className="text-xs text-destructive">Couldn't load details for this version.</p>
        ) : (
          <VariantInfoBody
            info={query.data}
            keepUrl={keepUrl}
            onKept={() => {
              setOpen(false);
              onKept?.();
            }}
          />
        )}
      </PopoverContent>
    </Popover>
  );
}
