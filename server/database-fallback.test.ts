import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sites = vi.hoisted(() => ({ configs: [] as Record<string, unknown>[] }));

vi.mock("./site-config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./site-config")>()),
  getSiteConfigs: () => sites.configs,
}));

import { DatabaseManager } from "./database";

let tempDir: string;
let parentRoot: string;
let childRoot: string;
let dbName: string;
let child: DatabaseManager;

function writeDb(contentRoot: string, name: string, rows: Record<string, unknown>[]) {
  const dir = path.join(contentRoot, "db", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "config.yml"),
    yaml.dump({ name, source: { type: "local", local: { filename: "rows.yml" } } }),
  );
  fs.writeFileSync(path.join(dir, "rows.yml"), yaml.dump(rows));
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "db-fallback-"));
  parentRoot = path.join(tempDir, "site_parent-fb");
  childRoot = path.join(tempDir, "site_child-fb");
  dbName = `fb-${Math.random().toString(36).slice(2, 10)}`;
  writeDb(parentRoot, dbName, [{ slug: "a", title: "From parent" }]);
  fs.mkdirSync(childRoot, { recursive: true });
  sites.configs = [
    { domain: "parent.test", contentFolder: parentRoot },
    { domain: "child.test", contentFolder: "site_child-fb", fallbackContentFolder: parentRoot },
  ];
  child = new DatabaseManager(childRoot);
});

afterEach(() => {
  child.clearCache(dbName);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("fallback_content_folder databases", () => {
  it("reads a database the site lacks from its fallback site", async () => {
    expect(child.exists(dbName)).toBe(true);
    expect(child.isInherited(dbName)).toBe(true);
    expect(child.getSourceContentRoot(dbName)).toBe(parentRoot);
    const { items } = await child.fetchItems(dbName, true);
    expect(items).toEqual([{ slug: "a", title: "From parent" }]);
  });

  it("keeps inherited databases out of list() and refuses writes", () => {
    expect(child.list().map((d) => d.name)).not.toContain(dbName);
    expect(() => child.delete(dbName)).toThrow(/not found on this site.*site_parent-fb/);
    expect(() => child.update(dbName, child.get(dbName))).toThrow(/not found on this site/);
    expect(child.patchDbEntry(dbName, "slug", "a", { title: "x" })).toBe(false);
    expect(fs.existsSync(path.join(childRoot, "db", dbName))).toBe(false);
  });

  it("prefers the site's own copy over the fallback", async () => {
    writeDb(childRoot, dbName, [{ slug: "b", title: "Own copy" }]);
    child.reload();
    expect(child.isInherited(dbName)).toBe(false);
    const { items } = await child.fetchItems(dbName, true);
    expect(items).toEqual([{ slug: "b", title: "Own copy" }]);
  });

  it("has no fallback when sites.yml names none", () => {
    sites.configs = [{ domain: "child.test", contentFolder: "site_child-fb" }];
    child.reload();
    expect(child.exists(dbName)).toBe(false);
    expect(() => child.get(dbName)).toThrow(`Database "${dbName}" not found`);
  });
});
