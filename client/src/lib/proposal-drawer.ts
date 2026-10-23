/** The draft the reviewer is previewing when a proposal renders inside the review drawer. */
export type ProposalPreviewEntry = {
  contentType: string;
  slug: string;
  locale: string;
  variant: string;
};

type EntryRef = { contentType: string; slug: string; locale: string; variant: string | null };

export function sameDraft(e: EntryRef, preview: ProposalPreviewEntry): boolean {
  return (
    e.contentType === preview.contentType &&
    e.slug === preview.slug &&
    e.locale === preview.locale &&
    e.variant === preview.variant
  );
}

/** Approve inline only when the proposal is exactly the draft on screen and not a shared-template change. */
export function canApproveInDrawer(
  p: { entries: EntryRef[]; affected_entries?: { count: number } | null },
  preview: ProposalPreviewEntry | undefined,
): boolean {
  return Boolean(
    preview && p.entries.length === 1 && sameDraft(p.entries[0]!, preview) && !p.affected_entries,
  );
}

export const PROPOSAL_DRAWER_QUERY_PARAM = "proposal";

export function proposalDraftPreviewHref(
  e: { contentType: string; slug: string; locale: string; variant: string },
  proposalId: string,
): string {
  const params = new URLSearchParams({
    variant: e.variant,
    locale: e.locale,
    [PROPOSAL_DRAWER_QUERY_PARAM]: proposalId,
  });
  return `/private/preview/${encodeURIComponent(e.contentType)}/${encodeURIComponent(e.slug)}?${params.toString()}`;
}
