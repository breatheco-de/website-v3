import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DatabaseManager } from "./database";

let tempDir: string;
let contentRoot: string;
let dbName: string;
let db: DatabaseManager;

function writeConfig(fieldMapping: Record<string, string>, mtimeOffsetMs = 0) {
  const configPath = path.join(contentRoot, "db", dbName, "config.yml");
  fs.writeFileSync(
    configPath,
    yaml.dump({
      name: "Config sync test",
      source: { type: "local", local: { filename: "rows.yml" } },
      field_mapping: fieldMapping,
    }),
    "utf-8",
  );
  if (mtimeOffsetMs) {
    const t = new Date(Date.now() + mtimeOffsetMs);
    fs.utimesSync(configPath, t, t);
  }
}

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "db-config-sync-"));
  contentRoot = path.join(tempDir, "site_test");
  dbName = `config-sync-${Math.random().toString(36).slice(2, 10)}`;
  const dbDir = path.join(contentRoot, "db", dbName);
  fs.mkdirSync(dbDir, { recursive: true });
  fs.writeFileSync(path.join(dbDir, "rows.yml"), yaml.dump([{ slug: "a", title: "A", extra: "x" }]), "utf-8");
  writeConfig({ slug: "slug", title: "title" });
  db = new DatabaseManager(contentRoot);
});

afterEach(() => {
  db.clearCache(dbName);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

describe("config.yml changed by another process", () => {
  it("is re-read before the next source fetch", async () => {
    const first = await db.fetchItems(dbName, true);
    expect(first.items[0]).not.toHaveProperty("extra");

    writeConfig({ slug: "slug", title: "title", extra: "extra" }, 5_000);

    const second = await db.fetchItems(dbName, true);
    expect(second.items[0]).toHaveProperty("extra", "x");
    expect(db.get(dbName).field_mapping).toHaveProperty("extra", "extra");
  });

  it("keeps the in-memory config when the file did not change", async () => {
    await db.fetchItems(dbName, true);
    const before = db.get(dbName);
    await db.fetchItems(dbName, true);
    expect(db.get(dbName)).toBe(before);
  });

  it("does not re-read its own writes", async () => {
    const config = { ...db.get(dbName), field_mapping: { slug: "slug" } };
    db.update(dbName, config, "test");
    await db.fetchItems(dbName, true);
    expect(db.get(dbName)).toBe(config);
  });
});
