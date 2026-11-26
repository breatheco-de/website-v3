import { describe, expect, it } from "vitest";
import {
  ensureLocalFilenameExtension,
  isEmptyCreateableFilename,
  sanitizeLocalFilenameInput,
} from "./local-db-filename";

describe("sanitizeLocalFilenameInput", () => {
  it("turns spaces into hyphens and lowercases", () => {
    expect(sanitizeLocalFilenameInput("Hello World")).toBe("hello-world");
  });

  it("preserves known extensions and normalizes them", () => {
    expect(sanitizeLocalFilenameInput("Hello World.JSON")).toBe("hello-world.json");
    expect(sanitizeLocalFilenameInput("data.CSV")).toBe("data.csv");
    expect(sanitizeLocalFilenameInput("Items.YML")).toBe("items.yml");
    expect(sanitizeLocalFilenameInput("Items.YAML")).toBe("items.yaml");
  });

  it("keeps a trailing hyphen while typing", () => {
    expect(sanitizeLocalFilenameInput("hello ")).toBe("hello-");
    expect(sanitizeLocalFilenameInput("hello-")).toBe("hello-");
  });

  it("preserves extension prefixes while typing so .json is not turned into -json", () => {
    expect(sanitizeLocalFilenameInput("hello.")).toBe("hello.");
    expect(sanitizeLocalFilenameInput("hello.j")).toBe("hello.j");
    expect(sanitizeLocalFilenameInput("hello.js")).toBe("hello.js");
    expect(sanitizeLocalFilenameInput("hello.jso")).toBe("hello.jso");
    expect(sanitizeLocalFilenameInput("hello.json")).toBe("hello.json");
    expect(sanitizeLocalFilenameInput("hello.y")).toBe("hello.y");
    expect(sanitizeLocalFilenameInput("hello.ym")).toBe("hello.ym");
    expect(sanitizeLocalFilenameInput("hello.yml")).toBe("hello.yml");
    expect(sanitizeLocalFilenameInput("hello.ya")).toBe("hello.ya");
    expect(sanitizeLocalFilenameInput("hello.yam")).toBe("hello.yam");
    expect(sanitizeLocalFilenameInput("hello.yaml")).toBe("hello.yaml");
  });

  it("strips junk characters from the basename", () => {
    expect(sanitizeLocalFilenameInput("foo@bar#.json")).toBe("foo-bar.json");
  });
});

describe("ensureLocalFilenameExtension", () => {
  it("appends .json when missing", () => {
    expect(ensureLocalFilenameExtension("Hello World")).toBe("hello-world.json");
    expect(ensureLocalFilenameExtension("hello-world")).toBe("hello-world.json");
  });

  it("does not double-append when extension exists", () => {
    expect(ensureLocalFilenameExtension("data.csv")).toBe("data.csv");
    expect(ensureLocalFilenameExtension("items.yaml")).toBe("items.yaml");
    expect(ensureLocalFilenameExtension("items.json")).toBe("items.json");
    expect(ensureLocalFilenameExtension("items.yml")).toBe("items.yml");
  });

  it("does not produce .json.json after typing a full extension", () => {
    let value = "";
    for (const ch of "hello.json") {
      value = sanitizeLocalFilenameInput(value + ch);
    }
    expect(value).toBe("hello.json");
    expect(ensureLocalFilenameExtension(value)).toBe("hello.json");
  });

  it("returns empty for empty input", () => {
    expect(ensureLocalFilenameExtension("")).toBe("");
    expect(ensureLocalFilenameExtension("   ")).toBe("");
  });
});

describe("isEmptyCreateableFilename", () => {
  it("allows json and yaml", () => {
    expect(isEmptyCreateableFilename("items.json")).toBe(true);
    expect(isEmptyCreateableFilename("items.yml")).toBe(true);
    expect(isEmptyCreateableFilename("items.yaml")).toBe(true);
    expect(isEmptyCreateableFilename("items")).toBe(true); // becomes .json
  });

  it("rejects csv", () => {
    expect(isEmptyCreateableFilename("data.csv")).toBe(false);
  });
});
