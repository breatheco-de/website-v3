/**
 * Pure preview of binding-group changes when enabling shared layout with detach exceptions.
 */

export type BindingPruneMember = {
  contentType: string;
  slug: string;
  sectionId: string;
};

export type BindingPruneGroup = {
  id: string;
  name?: string;
  component: string;
  locale: string;
  members: BindingPruneMember[];
};

export function previewPruneGroupsForSharedLayoutEnable<T extends BindingPruneGroup>(
  groups: T[],
  contentType: string,
  detachSlugs: string[],
): {
  kept: T[];
  updated: Array<{ before: T; after: T }>;
  removed: T[];
} {
  const detach = new Set(detachSlugs.filter(Boolean));
  const kept: T[] = [];
  const updated: Array<{ before: T; after: T }> = [];
  const removed: T[] = [];

  for (const group of groups) {
    const touchesType = group.members.some((m) => m.contentType === contentType);
    if (!touchesType) {
      kept.push(group);
      continue;
    }
    const nextMembers = group.members.filter(
      (m) => m.contentType !== contentType || detach.has(m.slug),
    );
    if (nextMembers.length < 2) {
      removed.push(group);
      continue;
    }
    if (nextMembers.length === group.members.length) {
      kept.push(group);
      continue;
    }
    updated.push({
      before: group,
      after: { ...group, members: nextMembers },
    });
  }
  return { kept, updated, removed };
}
