/** Client mirror of scripts/validation/shared/entryKey.ts (parse only). */

export type ParsedEntryKey = {
  contentType: string;
  slug: string;
  locale: string;
  variant?: string;
};

export function parseEntryKey(entryKey: string): ParsedEntryKey | null {
  if (!entryKey) return null;
  let variant: string | undefined;
  let withoutVariant = entryKey;
  const at = entryKey.lastIndexOf("@");
  if (at >= 0) {
    variant = entryKey.slice(at + 1) || undefined;
    withoutVariant = entryKey.slice(0, at);
  }
  const parts = withoutVariant.split("/");
  if (parts.length < 3) return null;
  const locale = parts[parts.length - 1]!;
  const slug = parts[parts.length - 2]!;
  const contentType = parts.slice(0, -2).join("/");
  if (!contentType || !slug || !locale) return null;
  return { contentType, slug, locale, ...(variant ? { variant } : {}) };
}
