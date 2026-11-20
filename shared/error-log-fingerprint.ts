/**
 * Normalize error_log messages so repeated warn/error lines with varying
 * ids, numbers, or kebab slugs collapse to one fingerprint for triage.
 */
export function normalizeErrorLogMessage(message: string): string {
  let s = message.trim();

  // UUIDs
  s = s.replace(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
    "<uuid>",
  );

  // ISO-ish timestamps
  s = s.replace(
    /\b\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)?\b/g,
    "<ts>",
  );

  // Long hex strings (hashes, object ids)
  s = s.replace(/\b[0-9a-f]{16,}\b/gi, "<hex>");

  // Multi-segment kebab / snake slugs (content slugs, path-like tokens)
  s = s.replace(/\b[a-z][a-z0-9]*(?:-[a-z0-9]+){1,}\b/gi, "<slug>");
  s = s.replace(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+){1,}\b/gi, "<slug>");

  // Standalone numbers (ids, counts, ports)
  s = s.replace(/\b\d+\b/g, "<n>");

  // Collapse runs of whitespace
  s = s.replace(/\s+/g, " ").trim();

  return s;
}

/** Fingerprint key for rate-limit and unique-issue grouping. */
export function errorLogFingerprint(module: string, message: string): string {
  return `${module}|${normalizeErrorLogMessage(message)}`;
}
