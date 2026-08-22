import { describe, expect, it } from "vitest";
import os from "os";
import path from "path";
import fs from "fs";
import {
  getLinkIndexOutbound,
  invalidateLinkIndexCache,
  patchLinkIndexOutbound,
  rebuildLinkIndex,
  LINK_INDEX_FILENAME,
} from "./link-index";

describe("link-index", () => {
  it("patches and reads outbound paths", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "link-index-"));
    invalidateLinkIndexCache();
    patchLinkIndexOutbound("blog/a/en", ["/en/hub", "/en/other"], dir);
    expect(getLinkIndexOutbound("blog/a/en", dir)).toEqual(["/en/hub", "/en/other"]);
    expect(fs.existsSync(path.join(dir, LINK_INDEX_FILENAME))).toBe(true);
    rebuildLinkIndex({ "blog/b/en": ["/en/x"] }, dir);
    expect(getLinkIndexOutbound("blog/a/en", dir)).toBeNull();
    expect(getLinkIndexOutbound("blog/b/en", dir)).toEqual(["/en/x"]);
  });
});
