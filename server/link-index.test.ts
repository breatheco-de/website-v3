import { describe, expect, it } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";
import {
  _resetLinkIndexStateForTests,
  entryKeysFromDeletedPaths,
  flushLinkIndexPendingSync,
  getLinkIndexOutbound,
  invertLinkIndex,
  LINK_INDEX_FILENAME,
  patchLinkIndexOutbound,
  queueLinkIndexRemove,
  queueLinkIndexSet,
  rebuildLinkIndex,
} from "./link-index";

describe("link-index", () => {
  it("patches and reads outbound paths", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "link-index-"));
    _resetLinkIndexStateForTests();
    patchLinkIndexOutbound("blog/a/en", ["/en/hub", "/en/other"], dir);
    expect(getLinkIndexOutbound("blog/a/en", dir)).toEqual(["/en/hub", "/en/other"]);
    expect(fs.existsSync(path.join(dir, LINK_INDEX_FILENAME))).toBe(true);
    rebuildLinkIndex({ "blog/b/en": ["/en/x"] }, dir);
    expect(getLinkIndexOutbound("blog/a/en", dir)).toBeNull();
    expect(getLinkIndexOutbound("blog/b/en", dir)).toEqual(["/en/x"]);
  });

  it("coalesced flush merges set ops and remove beats set for same key", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "link-index-coalesce-"));
    _resetLinkIndexStateForTests();
    queueLinkIndexSet("blog/a/en", ["/en/one"], dir);
    queueLinkIndexSet("blog/b/en", ["/en/two"], dir);
    queueLinkIndexSet("blog/a/en", ["/en/updated"], dir);
    queueLinkIndexRemove("blog/a/en", dir);
    flushLinkIndexPendingSync(dir);
    expect(getLinkIndexOutbound("blog/a/en", dir)).toBeNull();
    expect(getLinkIndexOutbound("blog/b/en", dir)).toEqual(["/en/two"]);
  });

  it("set with empty paths clears outbound row", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "link-index-empty-"));
    _resetLinkIndexStateForTests();
    patchLinkIndexOutbound("page/x/en", ["/en/foo"], dir);
    queueLinkIndexSet("page/x/en", [], dir);
    flushLinkIndexPendingSync(dir);
    expect(getLinkIndexOutbound("page/x/en", dir)).toBeNull();
  });

  it("invertLinkIndex maps targets to referrer entry keys", () => {
    const inverted = invertLinkIndex({
      "blog/a/en": ["/en/hub", "/en/other"],
      "page/b/en": ["/en/hub"],
    });
    expect(inverted.get("/en/hub")?.sort()).toEqual(["blog/a/en", "page/b/en"]);
    expect(inverted.get("/en/other")).toEqual(["blog/a/en"]);
  });

  it("entryKeysFromDeletedPaths parses locale YAML paths", () => {
    const keys = entryKeysFromDeletedPaths([
      "site_4geeks-com/blog/my-post/en.yml",
      "site_4geeks-com/blog/my-post/_common.yml",
    ]);
    expect(keys).toEqual(["blog/my-post/en"]);
  });
});
