/**
 * UTF-8-safe base64 for `function:` transformers.
 *
 * Legacy client code used bare `btoa`/`atob` (Latin-1). Accents like `í` were
 * stored as Latin-1 bytes then decoded as UTF-8 on the server → ``.
 * New encodes are UTF-8; decode falls back to Latin-1 when UTF-8 is invalid.
 */

export const FUNCTION_PREFIX = "function:";

function bytesToBinaryString(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return binary;
}

function binaryStringToBytes(binary: string): Uint8Array {
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i) & 0xff;
  }
  return bytes;
}

/** Encode a JS function source string to base64 (UTF-8 bytes). */
export function encodeUtf8Base64(source: string): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(source, "utf-8").toString("base64");
  }
  return btoa(bytesToBinaryString(new TextEncoder().encode(source)));
}

/**
 * Decode base64 function source. Prefers UTF-8; if the payload was stored with
 * legacy Latin-1 `btoa`, falls back so accents still round-trip.
 */
export function decodeUtf8Base64(b64: string): string {
  const cleaned = b64.replace(/\s/g, "");
  if (typeof Buffer !== "undefined") {
    const buf = Buffer.from(cleaned, "base64");
    const utf8 = buf.toString("utf-8");
    if (utf8.includes("\uFFFD")) return buf.toString("latin1");
    return utf8;
  }
  const binary = atob(cleaned);
  const utf8 = new TextDecoder().decode(binaryStringToBytes(binary));
  if (utf8.includes("\uFFFD")) return binary;
  return utf8;
}

/** `function:` + UTF-8 base64 body. */
export function encodeFunctionMapping(source: string): string {
  return FUNCTION_PREFIX + encodeUtf8Base64(source);
}

/**
 * Decode a `function:…` mapping value to source. If the string is not prefixed,
 * returns it unchanged (callers that already sliced should use decodeUtf8Base64).
 */
export function decodeFunctionMapping(prefixedOrBody: string): string {
  if (prefixedOrBody.startsWith(FUNCTION_PREFIX)) {
    return decodeUtf8Base64(prefixedOrBody.slice(FUNCTION_PREFIX.length));
  }
  return decodeUtf8Base64(prefixedOrBody);
}
