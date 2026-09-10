import { describe, expect, it } from "vitest";
import {
  FUNCTION_PREFIX,
  decodeFunctionMapping,
  decodeUtf8Base64,
  encodeFunctionMapping,
  encodeUtf8Base64,
} from "./functionEncoding";
import { extractFunctionBody } from "../server/transform";

describe("functionEncoding", () => {
  it("round-trips ASCII and accents through UTF-8 base64", () => {
    const source = '(value, item) => "Inicia en " + 2 + " días"';
    const encoded = encodeUtf8Base64(source);
    expect(decodeUtf8Base64(encoded)).toBe(source);
    expect(decodeUtf8Base64(encoded)).toContain("días");
  });

  it("encodeFunctionMapping adds function: prefix", () => {
    const source = "(value, item) => item.slug";
    const mapped = encodeFunctionMapping(source);
    expect(mapped.startsWith(FUNCTION_PREFIX)).toBe(true);
    expect(decodeFunctionMapping(mapped)).toBe(source);
  });

  it("decodes legacy Latin-1 btoa payloads with accents", () => {
    // Simulates old client: btoa("días") → Latin-1 bytes in base64
    const legacy = Buffer.from("días", "latin1").toString("base64");
    expect(decodeUtf8Base64(legacy)).toBe("días");
  });

  it("extractFunctionBody matches shared decode (incl. accents)", () => {
    const source = '(v, item) => "d\u00edas"';
    const prefixed = encodeFunctionMapping('(v, item) => "días"');
    expect(extractFunctionBody(prefixed)).toBe('(v, item) => "días"');
    expect(extractFunctionBody(FUNCTION_PREFIX + encodeUtf8Base64(source))).toBe(source);
  });
});
