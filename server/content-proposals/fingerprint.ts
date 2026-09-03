import { createHash } from "crypto";

export function stableJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableJson(v)).join(",")}]`;
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableJson(obj[k])}`).join(",")}}`;
}

export function normalizeSummary(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

export function hashFingerprint(raw: string): string {
  return createHash("sha256").update(raw).digest("hex").slice(0, 16);
}

export type FingerprintEntry = {
  contentType: string;
  slug: string;
  locale: string;
  variant?: string | null;
  updates: Array<{ field_path: string; value?: unknown; reset?: boolean }>;
};

export function fingerprintEdits(opts: {
  site: string;
  category: string;
  entries: FingerprintEntry[];
}): string {
  const sorted = [...opts.entries]
    .map((e) => ({
      contentType: e.contentType,
      slug: e.slug,
      locale: e.locale,
      variant: e.variant || "",
      updates: [...e.updates]
        .map((u) => ({
          field_path: u.field_path,
          reset: u.reset === true,
          value: u.reset ? undefined : u.value,
        }))
        .sort((a, b) => a.field_path.localeCompare(b.field_path)),
    }))
    .sort((a, b) =>
      `${a.contentType}/${a.slug}/${a.locale}/${a.variant}`.localeCompare(
        `${b.contentType}/${b.slug}/${b.locale}/${b.variant}`,
      ),
    );
  return hashFingerprint(`${opts.site}|${opts.category}|${stableJson(sorted)}`);
}

export function fingerprintNotes(opts: {
  site: string;
  category: string;
  relatedIssueIds: string[];
  summary: string;
}): string {
  const ids = [...opts.relatedIssueIds].sort();
  return hashFingerprint(
    `${opts.site}|${opts.category}|${ids.join(",")}|${normalizeSummary(opts.summary)}`,
  );
}
