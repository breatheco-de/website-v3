import {
  LEGACY_TEMPLATE_VERSIONING_SLUG,
  TEMPLATE_VERSIONING_SLUG,
  isEntryDetached,
  isSharedLayoutType,
  isTemplateVersioningSlug,
  listAttachedEntries,
} from "../shared-layout-entry";
import { listOpenProposalsForEntry, type OpenProposalForEntry } from "./service";

/** One open proposal touching a page (or the shared layout it is attached to), for the robot button. */
export type PendingProposalForPage = {
  id: string;
  title: string;
  status: string;
  proposer_username: string;
  proposer_kind: "agent" | "staff";
  updated_at: number;
  open_blocker_count: number;
  entries: Array<{ locale: string; variant: string | null }>;
  /** True when the proposal changes the shared template, not this page's own files. */
  shared_layout: boolean;
  /** Attached pages the template change reaches; null for page-level proposals. */
  affected_count: number | null;
};

/** Collapse per-entry rows into one item per proposal (a proposal can touch several locales/variants). */
export function groupOpenProposals(
  rows: OpenProposalForEntry[],
  opts: { sharedLayout?: boolean; affectedCount?: (locales: string[]) => number } = {},
): PendingProposalForPage[] {
  const byId = new Map<string, PendingProposalForPage>();
  for (const r of rows) {
    let item = byId.get(r.id);
    if (!item) {
      item = {
        id: r.id,
        title: r.title,
        status: r.status,
        proposer_username: r.proposer_username,
        proposer_kind: r.proposer_kind,
        updated_at: r.updated_at,
        open_blocker_count: r.open_blocker_count,
        entries: [],
        shared_layout: Boolean(opts.sharedLayout),
        affected_count: null,
      };
      byId.set(r.id, item);
    }
    if (!item.entries.some((e) => e.locale === r.locale && e.variant === r.variant)) {
      item.entries.push({ locale: r.locale, variant: r.variant });
    }
  }
  const out = [...byId.values()];
  if (opts.sharedLayout && opts.affectedCount) {
    for (const item of out) {
      item.affected_count = opts.affectedCount([...new Set(item.entries.map((e) => e.locale))]);
    }
  }
  return out;
}

/**
 * Open proposals on this page plus, when the page is attached to a shared layout, open
 * proposals on that layout's template. Newest activity first.
 */
export function listPendingProposalsForPage(
  site: string,
  contentType: string,
  slug: string,
  contentRoot?: string,
): PendingProposalForPage[] {
  const own = groupOpenProposals(listOpenProposalsForEntry(site, contentType, slug));
  const attached =
    !isTemplateVersioningSlug(slug) &&
    isSharedLayoutType(contentType, contentRoot) &&
    !isEntryDetached(contentType, slug, contentRoot);
  if (!attached) return own.sort((a, b) => b.updated_at - a.updated_at);

  const templateRows = [TEMPLATE_VERSIONING_SLUG, LEGACY_TEMPLATE_VERSIONING_SLUG].flatMap((s) =>
    listOpenProposalsForEntry(site, contentType, s),
  );
  const ownIds = new Set(own.map((p) => p.id));
  const template = groupOpenProposals(
    templateRows.filter((r) => !ownIds.has(r.id)),
    {
      sharedLayout: true,
      affectedCount: (locales) =>
        locales.reduce((n, locale) => n + listAttachedEntries(contentType, locale, contentRoot).length, 0),
    },
  );
  return [...own, ...template].sort((a, b) => b.updated_at - a.updated_at);
}
