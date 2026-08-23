import { bindingManager } from "./bindings";

export type BindingLeaseConflict = {
  code: "binding_lease_active";
  groupId: string;
  holder: string;
  expiresAt: number;
  retryAfterMs: number;
};

export function bindingHolderId(author: string, contentType: string, slug: string): string {
  return `${author}:${contentType}/${slug}`;
}

/**
 * Section-scoped lease check: returns conflict if another holder holds the lease
 * for any bound section touched by the given indexes.
 */
export function checkBindingLeaseConflicts(
  site: string,
  holder: string,
  contentType: string,
  baseSlug: string,
  locale: string,
  sectionIndexes: number[],
): BindingLeaseConflict | null {
  for (const idx of sectionIndexes) {
    const group = bindingManager.findGroupForSectionByIndex(contentType, baseSlug, idx, locale);
    if (!group) continue;
    const lease = bindingManager.getActivePropagationLease(site, group.id, group.locale);
    if (!lease) continue;
    if (lease.holder === holder) continue;
    const retryAfterMs = Math.max(500, lease.expiresAt - Date.now());
    return {
      code: "binding_lease_active",
      groupId: group.id,
      holder: lease.holder,
      expiresAt: lease.expiresAt,
      retryAfterMs,
    };
  }
  return null;
}
