/** Strip query/hash, resolve absolute URLs to pathname, trim trailing slash. */
export function normalizeIssuePath(urlOrPath: string): string {
  let raw = (urlOrPath || "").split("#")[0].split("?")[0].trim();
  if (!raw) return "";
  try {
    if (/^https?:\/\//i.test(raw)) raw = new URL(raw).pathname || "";
  } catch {
    /* keep */
  }
  if (raw.length > 1 && raw.endsWith("/")) raw = raw.slice(0, -1);
  return raw;
}

/** Fuzzy page-path match used by Global Health issue filters. */
export function issuePathMatches(wantRaw: string, gotRaw: string): boolean {
  const want = normalizeIssuePath(wantRaw);
  const got = normalizeIssuePath(gotRaw);
  if (!want) return true;
  if (!got) return false;
  return got === want || got.endsWith(want) || want.endsWith(got);
}
