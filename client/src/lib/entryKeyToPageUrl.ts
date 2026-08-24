import { buildContentUrlFromPattern } from "@/lib/locale";
import { parseEntryKey } from "@/lib/parseEntryKey";

type ContentTypesMap = Record<string, { url_pattern?: Record<string, string> }> | null | undefined;

export type EntryKeyParts = {
  contentType: string;
  slug: string;
  locale: string;
  variant?: string | null;
};

export function buildEntryKey(parts: EntryKeyParts): string {
  const base = `${parts.contentType}/${parts.slug}/${parts.locale}`;
  return parts.variant ? `${base}@${parts.variant}` : base;
}

/** Resolve parsed entry parts to the canonical page URL used by diagnostics APIs. */
export function entryPartsToPageUrl(
  parts: EntryKeyParts,
  contentTypes?: ContentTypesMap,
): string | null {
  return entryKeyToPageUrl(buildEntryKey(parts), contentTypes);
}

/** Resolve a validation entry key to the canonical page URL used by diagnostics APIs. */
export function entryKeyToPageUrl(entryKey: string, contentTypes?: ContentTypesMap): string | null {
  const parsed = parseEntryKey(entryKey);
  if (!parsed) return null;

  const pattern = contentTypes?.[parsed.contentType]?.url_pattern;
  let url = buildContentUrlFromPattern(pattern, parsed.slug, parsed.locale);

  if (parsed.variant) {
    const sep = url.includes("?") ? "&" : "?";
    url = `${url}${sep}variant=${encodeURIComponent(parsed.variant)}`;
  }

  return url;
}
