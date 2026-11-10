import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import {
  readDraftMeta,
  readVariantData,
  withDraftMeta,
  writeDraftMeta,
  writeVariantData,
  writeVariantFile,
  type DraftMeta,
} from "./draft-meta";

const META: DraftMeta = {
  based_on: { locale: null, common: "abc123", at: "2026-09-25T00:00:00.000Z" },
};

describe("withDraftMeta", () => {
  it.each(["{}\n", "{}", "{ }\n", "null\n", "~\n", "", "\n"])(
    "drops an empty document body %j so the result stays valid YAML",
    (body) => {
      const out = withDraftMeta(body, META);
      expect(out.startsWith("_draft:")).toBe(true);
      expect(yaml.load(out)).toEqual({ _draft: META });
    },
  );

  it("keeps real content above the block", () => {
    const out = withDraftMeta("title: Hello\n", META);
    expect(yaml.load(out)).toEqual({ title: "Hello", _draft: META });
  });

  it("keeps an empty document when the only content was _draft", () => {
    expect(withDraftMeta(withDraftMeta("{}\n", META), null)).toBe("{}\n");
  });
});

describe("new draft for an unpublished locale", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "draft-meta-"));
    file = path.join(dir, "draft.en.yml");
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("seeds {}, records the base, then accepts field writes", () => {
    writeVariantFile(file, "{}\n", { meta: null, skipMark: true });
    writeDraftMeta(file, META, { skipMark: true });

    const raw = fs.readFileSync(file, "utf-8");
    expect(() => yaml.load(raw)).not.toThrow();
    expect(readDraftMeta(file)).toEqual(META);
    expect(readVariantData(file)).toEqual({});

    writeVariantData(file, { meta: { page_title: "AI engineer interview questions" } }, { skipMark: true });
    expect(readVariantData(file)).toEqual({ meta: { page_title: "AI engineer interview questions" } });
    expect(readDraftMeta(file)).toEqual(META);
  });

  it("writing an empty object keeps _draft and valid YAML", () => {
    writeVariantFile(file, "{}\n", { meta: META, skipMark: true });
    writeVariantData(file, {}, { skipMark: true });
    expect(() => yaml.load(fs.readFileSync(file, "utf-8"))).not.toThrow();
    expect(readDraftMeta(file)).toEqual(META);
  });

  it("reads created_at back, and keeps it out of variant content", () => {
    writeVariantFile(file, "title: Hi\n", { meta: null, skipMark: true });
    writeDraftMeta(file, { created_at: "2026-10-01T12:00:00.000Z" }, { skipMark: true });
    expect(readDraftMeta(file)).toEqual({ created_at: "2026-10-01T12:00:00.000Z" });
    expect(readVariantData(file)).toEqual({ title: "Hi" });
  });

  it("reads an unquoted YAML timestamp created_at as an ISO string", () => {
    fs.writeFileSync(file, "title: Hi\n_draft:\n  created_at: 2026-10-01T12:00:00.000Z\n", "utf-8");
    expect(readDraftMeta(file)?.created_at).toBe("2026-10-01T12:00:00.000Z");
  });

  it("reads kept_at and the cleanup flag back; an incomplete flag is dropped", () => {
    fs.writeFileSync(
      file,
      "title: Hi\n_draft:\n  kept_at: 2026-11-01T00:00:00.000Z\n  cleanup:\n    flagged_at: 2026-10-01T00:00:00.000Z\n    deletes_at: '2026-10-31T00:00:00.000Z'\n",
      "utf-8",
    );
    expect(readDraftMeta(file)).toEqual({
      kept_at: "2026-11-01T00:00:00.000Z",
      cleanup: { flagged_at: "2026-10-01T00:00:00.000Z", deletes_at: "2026-10-31T00:00:00.000Z" },
    });
    fs.writeFileSync(file, "_draft:\n  cleanup:\n    flagged_at: '2026-10-01T00:00:00.000Z'\n", "utf-8");
    expect(readDraftMeta(file)).toBeNull();
  });

  it("removing _draft from a metadata-only draft leaves a readable empty draft", () => {
    writeVariantFile(file, "{}\n", { meta: META, skipMark: true });
    writeDraftMeta(file, { based_on: null }, { skipMark: true });
    expect(fs.readFileSync(file, "utf-8")).toBe("{}\n");
    expect(readVariantData(file)).toEqual({});
  });
});
