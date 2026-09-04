export type SeoModalSaveArea =
  | "meta"
  | "keywords"
  | "fields"
  | "funnel"
  | "slug"
  | "locations";

export type SeoModalSavedDetail = {
  contentType: string;
  slug: string;
  locale: string;
  variant?: string;
  areas: SeoModalSaveArea[];
};

export function buildSeoModalSavedDetail(
  identity: {
    contentType: string;
    slug: string;
    locale: string;
    variant?: string;
  },
  areas: SeoModalSaveArea[],
): SeoModalSavedDetail {
  return {
    contentType: identity.contentType,
    slug: identity.slug,
    locale: identity.locale,
    ...(identity.variant ? { variant: identity.variant } : {}),
    areas,
  };
}

/** Invoke parent refresh callback when present (keywords/fields/funnel nested saves). */
export function notifySeoModalSaved(
  onSaved: ((detail: SeoModalSavedDetail) => void) | undefined,
  identity: {
    contentType: string;
    slug: string;
    locale: string;
    variant?: string;
  },
  areas: SeoModalSaveArea[],
): void {
  if (!onSaved) return;
  onSaved(buildSeoModalSavedDetail(identity, areas));
}
