type DeleteResponse = {
  message?: string;
  redirects_added?: Array<{ from: string; to_slug: string }>;
  ads_on_url?: { live?: unknown[] };
};

/** Success-toast text after a delete: what was removed, where visitors go now, and live ads left behind. */
export function deleteResultDescription(data: DeleteResponse): string {
  const parts = [data.message || "Deleted"];
  const added = data.redirects_added ?? [];
  if (added.length > 0) parts.push(`Visitors of ${added.length} old address${added.length === 1 ? "" : "es"} now go to ${added[0]!.to_slug}`);
  const live = data.ads_on_url?.live?.length ?? 0;
  if (live > 0 && added.length === 0) parts.push(`${live} live ad${live === 1 ? "" : "s"} still point here; update them in Meta or Google`);
  return parts.join(". ");
}
