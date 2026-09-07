/**
 * Reject URLs that point to private/internal network destinations (SSRF guard).
 * Blocks: localhost, loopback, RFC-1918 private ranges, link-local, IPv6 loopback,
 * and AWS/GCP/Azure instance metadata endpoints.
 */
export function isPrivateDestination(urlStr: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    return true; // unparsable → block
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return true;

  const host = parsed.hostname.toLowerCase();

  if (host === "::1" || host === "[::1]") return true;
  if (host.startsWith("fe80")) return true;

  const blockedHostnames = [
    "metadata.google.internal",
    "metadata.internal",
    "169.254.169.254",
  ];
  if (blockedHostnames.includes(host)) return true;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [, a, b] = ipv4.map(Number);
    if (
      a === 127 ||
      a === 10 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254) ||
      (a === 100 && b >= 64 && b <= 127)
    ) {
      return true;
    }
  }

  if (host === "localhost" || host.endsWith(".localhost")) return true;

  return false;
}
