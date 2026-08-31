/**
 * Unit tests for server/url-param-peers.ts
 */
import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  observeParamValues,
  observeParamValuesByLocale,
  validateUrlParamPeerValues,
} from "./url-param-peers";
import type { ContentTypeConfig } from "./content-types";
import yaml from "js-yaml";

const blogConfig: ContentTypeConfig = {
  directory: "blog",
  url_pattern: { en: "/en/blog/:category/:slug", es: "/es/blog/:category/:slug" },
};

describe("observeParamValues locale scoping", () => {
  let tmp = "";

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "url-peers-"));
    const blogDir = path.join(tmp, "blog");
    fs.mkdirSync(path.join(blogDir, "post-a"), { recursive: true });
    fs.mkdirSync(path.join(blogDir, "post-b"), { recursive: true });
    fs.writeFileSync(
      path.join(blogDir, "post-a", "_common.yml"),
      yaml.dump({ slug: "post-a", category: "ai-tools" }),
    );
    fs.writeFileSync(
      path.join(blogDir, "post-a", "en.yml"),
      yaml.dump({ slug: "post-a", category: "ai-tools" }),
    );
    fs.writeFileSync(
      path.join(blogDir, "post-b", "es.yml"),
      yaml.dump({ slug: "post-b", category: "herramientas-ia" }),
    );
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("ignores _common URL params when locale is set", () => {
    const en = observeParamValues(tmp, "blog", blogConfig, "category", "en");
    const es = observeParamValues(tmp, "blog", blogConfig, "category", "es");
    expect(en).toEqual(["ai-tools"]);
    expect(es).toEqual(["herramientas-ia"]);
  });

  it("observeParamValuesByLocale splits en and es", () => {
    const byLoc = observeParamValuesByLocale(tmp, "blog", blogConfig, "category");
    expect(byLoc.en).toEqual(["ai-tools"]);
    expect(byLoc.es).toEqual(["herramientas-ia"]);
  });

  it("validateUrlParamPeerValues rejects cross-locale slug", () => {
    const fail = validateUrlParamPeerValues(tmp, "blog", blogConfig, {
      es: { category: "ai-tools" },
    });
    expect(fail?.locale).toBe("es");
    expect(fail?.proposed_value).toBe("ai-tools");
  });
});
