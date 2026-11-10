import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import type { AddressInfo } from "net";
import express from "express";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("../live-server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../live-server")>();
  return { ...actual, isLiveServer: () => false };
});

vi.mock("../sync-state", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sync-state")>();
  return { ...actual, markFileAsModified: () => undefined };
});

vi.mock("./_helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./_helpers")>();
  const allow = { authorized: true, token: "t", username: "alice", author: "alice" };
  return {
    ...actual,
    requireCapability: async () => allow,
    requireAnyCapability: async () => allow,
    requireDatabasesBrowseAccess: async () => ({ ...allow, canManage: true }),
    markContentFileModified: () => undefined,
  };
});

import { DatabaseManager } from "../database";
import { registerDatabasesRoutes } from "./databases";
import { REJECTED_KEY, SIMILAR_TO_KEY, isRowRejected } from "@shared/evidence-kinds";
import { buildEvidenceIndex, findEvidenceRow } from "../content-proposals/evidence-match";

const ARTICLE = "https://www.entnerd.com/bahamas-ai";
const WAYBACK = `https://web.archive.org/web/20261008134545/${ARTICLE}`;

let tempDir: string;
let contentRoot: string;
let dbName: string;
let db: DatabaseManager;
let server: http.Server | null = null;
let baseUrl = "";

function rowsOnDisk(): Record<string, unknown>[] {
  const raw = yaml.load(fs.readFileSync(path.join(contentRoot, "db", dbName, "rows.yml"), "utf-8")) as {
    press: Record<string, unknown>[];
  };
  return raw.press;
}

function writeRows(rows: Record<string, unknown>[]) {
  fs.writeFileSync(path.join(contentRoot, "db", dbName, "rows.yml"), yaml.dump({ press: rows }));
  db.clearCache(dbName);
}

const SEED: Record<string, unknown>[] = [
  { title: "Bahamas picks 4Geeks for AI education", organization: "Government of the Bahamas", locale: "en", kind: "press", link_url: WAYBACK, translation_key: "bahamas" },
  { title: "Bahamas elige a 4Geeks", organization: "Government of the Bahamas", locale: "es", kind: "press", link_url: WAYBACK, translation_key: "bahamas" },
  { title: "Twin copy of the Bahamas story", organization: "Bahamas", locale: "en", kind: "press", link_url: ARTICLE },
  { title: "Miami Dade College curriculum partner", organization: "Miami Dade College", locale: "en", kind: "press", link_url: "https://example.com/mdc" },
];

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "db-dupes-"));
  contentRoot = path.join(tempDir, "site_dupes");
  dbName = `press-${Math.random().toString(36).slice(2, 8)}`;
  const dir = path.join(contentRoot, "db", dbName);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "config.yml"),
    yaml.dump({
      name: "Press Mentions",
      source: { type: "local", local: { filename: "rows.yml", results_path: "press" } },
      evidence: { enabled: true, proves: ["press_coverage"], proof_field: "link_url", match_fields: ["organization"] },
    }),
  );
  fs.writeFileSync(path.join(dir, "rows.yml"), yaml.dump({ press: SEED }));
  db = new DatabaseManager(contentRoot);
  db.reload();

  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.site = { contentRoot, contentRootName: "site_dupes", database: db, config: { domain: "4geeks.com" } } as any;
    next();
  });
  registerDatabasesRoutes(app);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  db.clearCache(dbName);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

const json = (method: string, p: string, body?: unknown, headers: Record<string, string> = {}) =>
  fetch(`${baseUrl}${p}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

const AGENT = { "x-mcp-author": "mcp" };
const items = `/api/databases/${encodeURIComponent("PLACEHOLDER")}`;
const url = (suffix: string) => items.replace("PLACEHOLDER", dbName) + suffix;

type Refusal = { code: string; existing_index?: number; similar?: Array<{ index: number }>; input_index?: number };

describe("save-time duplicate checks", () => {
  it("refuses the same link in the same locale, even as a non-Wayback URL with tracking params", async () => {
    const res = await json("POST", url("/items"), {
      item: { title: "Anything", locale: "en", kind: "press", link_url: `${ARTICLE}?utm_source=news` },
    }, AGENT);
    expect(res.status).toBe(409);
    const body = (await res.json()) as Refusal;
    expect(body).toMatchObject({ code: "duplicate_link", existing_index: 0 });
    expect(rowsOnDisk()).toHaveLength(4);
  });

  it("refuses redirect links for everyone, including staff Save anyway", async () => {
    const res = await json("POST", url("/items?allow_duplicate=1"), {
      item: { title: "x", locale: "en", link_url: "https://news.google.com/rss/articles/abc" },
    });
    expect(res.status).toBe(409);
    expect(((await res.json()) as Refusal).code).toBe("redirect_link");
  });

  it("agents cannot send allow_duplicate", async () => {
    const res = await json("POST", url("/items?allow_duplicate=1"), { item: { title: "x", link_url: ARTICLE } }, AGENT);
    expect(res.status).toBe(403);
  });

  it("staff Save anyway writes the duplicate", async () => {
    const res = await json("POST", url("/items?allow_duplicate=1"), {
      item: { title: "Deliberate copy", locale: "en", kind: "press", link_url: ARTICLE },
    });
    expect(res.status).toBe(200);
    expect(rowsOnDisk()).toHaveLength(5);
    writeRows(SEED);
  });

  it("a similar title needs acknowledgement, then records what it looked like", async () => {
    const item = { title: "Miami Dade College names curriculum partner", organization: "MDC", locale: "en", kind: "press", link_url: "https://news.example/mdc" };
    const first = await json("POST", url("/items"), { item }, AGENT);
    expect(first.status).toBe(409);
    const body = (await first.json()) as Refusal;
    expect(body.code).toBe("similar_rows");
    expect(body.similar?.map((s) => s.index)).toEqual([3]);

    const ok = await json("POST", url("/items?acknowledged_similar=3"), { item }, AGENT);
    expect(ok.status).toBe(200);
    const saved = rowsOnDisk()[4]!;
    expect(saved[SIMILAR_TO_KEY]).toEqual([expect.objectContaining({ title: "Miami Dade College curriculum partner" })]);

    const list = (await (await json("GET", url("/items"))).json()) as {
      items: Record<string, unknown>[];
      evidence_similar_to: unknown[][];
    };
    expect(SIMILAR_TO_KEY in list.items[4]!).toBe(false);
    expect(list.evidence_similar_to[4]).toHaveLength(1);

    expect((await json("POST", url("/items/4/verify"), {})).status).toBe(200);
    expect(SIMILAR_TO_KEY in rowsOnDisk()[4]!).toBe(false);
    writeRows(SEED);
  });

  it("an existing duplicate keeps saving when the link is unchanged", async () => {
    const res = await json("PATCH", url("/items/2"), { title: "Twin copy, typo fixed" }, AGENT);
    expect(res.status).toBe(200);
    expect(rowsOnDisk()[2]!.title).toBe("Twin copy, typo fixed");
    writeRows(SEED);
  });

  it("changing a link to one another row has is refused", async () => {
    const res = await json("PATCH", url("/items/3"), { link_url: ARTICLE }, AGENT);
    expect(res.status).toBe(409);
    expect(((await res.json()) as Refusal).code).toBe("duplicate_link");
  });

  it("a whole-file save can reorder existing duplicates", async () => {
    const reordered = [SEED[2], SEED[0], SEED[1], SEED[3]];
    const res = await json("PUT", url("/items"), { items: reordered });
    expect(res.status).toBe(200);
    expect(rowsOnDisk()[0]!.title).toBe(SEED[2]!.title);
    writeRows(SEED);
  });

  it("a whole-file save that introduces a duplicate link is refused", async () => {
    const res = await json("PUT", url("/items"), {
      items: [...SEED, { title: "New", locale: "en", link_url: "https://new.example/a" }, { title: "New 2", locale: "en", link_url: "https://new.example/a/" }],
    });
    expect(res.status).toBe(409);
    expect((await res.json()) as Refusal).toMatchObject({ code: "duplicate_link" });
  });
});

describe("reject and restore", () => {
  it("agents cannot reject", async () => {
    expect((await json("POST", url("/items/0/reject"), {}, AGENT)).status).toBe(403);
  });

  it("preview names translations and twins without writing", async () => {
    const res = await json("POST", url("/items/0/reject?preview=1"), {});
    const body = (await res.json()) as { translations: Array<{ index: number }>; same_link: Array<{ index: number }>; indices: number[] };
    expect(body.translations.map((r) => r.index)).toEqual([1]);
    expect(body.same_link.map((r) => r.index)).toEqual([2]);
    expect(body.indices).toEqual([0, 1, 2]);
    expect(rowsOnDisk().some(isRowRejected)).toBe(false);
  });

  it("rejects the row, its translation and its twin under one group", async () => {
    const res = await json("POST", url("/items/0/reject"), { include_same_link: true });
    expect(res.status).toBe(200);
    const rows = rowsOnDisk();
    expect(rows.map(isRowRejected)).toEqual([true, true, true, false]);
    const groups = new Set(rows.slice(0, 3).map((r) => (r[REJECTED_KEY] as { group: string }).group));
    expect(groups.size).toBe(1);
  });

  it("keeps stored positions: the staff list shows every row, pages do not", async () => {
    const body = (await (await json("GET", url("/items"))).json()) as {
      items: Record<string, unknown>[];
      indices: number[];
      evidence_trust: string[];
    };
    expect(body.indices).toEqual([0, 1, 2, 3]);
    expect(body.evidence_trust).toEqual(["rejected", "rejected", "rejected", "trusted"]);
    expect(body.items.some((i) => REJECTED_KEY in i)).toBe(false);

    const pageRows = (await db.fetchItems(dbName)).items;
    expect(pageRows.map((r) => r.title)).toEqual([SEED[3]!.title]);
    expect(db.getMappedItems(dbName)?.map((r) => r.title)).toEqual([SEED[3]!.title]);
    expect(db.getMappedItems(dbName, { includeRejected: true })).toHaveLength(4);
  });

  it("an edit by stored position lands on the intended row and keeps the rejection", async () => {
    const res = await json("PATCH", url("/items/3"), { image: "x.png" });
    expect(res.status).toBe(200);
    expect(rowsOnDisk()[3]!.image).toBe("x.png");
    const fix = await json("PATCH", url("/items/0"), { title: "Bahamas picks 4Geeks for AI education (fixed)" });
    expect(fix.status).toBe(200);
    expect(isRowRejected(rowsOnDisk()[0])).toBe(true);
  });

  it("proposal evidence skips rejected rows but keeps true positions", async () => {
    await db.fetchItems(dbName);
    const rows = db.getMappedItems(dbName, { includeRejected: true })!.map((m, i) => ({
      ...m,
      ...(rowsOnDisk()[i]![REJECTED_KEY] ? { [REJECTED_KEY]: rowsOnDisk()[i]![REJECTED_KEY] } : {}),
    }));
    const index = buildEvidenceIndex(
      [{ site: "s", domain: "d", database: dbName, label: "Press", config: { enabled: true, proves: ["press_coverage"], proof_field: "link_url", match_fields: ["organization"] }, rows }],
      [],
    );
    expect(findEvidenceRow(index, "Government of the Bahamas")).toBeNull();
    expect(findEvidenceRow(index, "Miami Dade College")?.ref.index).toBe(3);
  });

  it("re-adding a rejected link is refused in any locale, even with a matching translation", async () => {
    const res = await json("POST", url("/items"), {
      item: { title: "Bahamas otra vez", locale: "es", kind: "press", link_url: ARTICLE, translation_key: "bahamas" },
    }, AGENT);
    expect(res.status).toBe(409);
    expect(((await res.json()) as Refusal).code).toBe("rejected_link");
  });

  it("agents cannot delete a rejected row; staff can", async () => {
    const agent = await json("DELETE", url("/items/2"), undefined, AGENT);
    expect(agent.status).toBe(403);
    expect(((await agent.json()) as { code: string }).code).toBe("rejected_row");
    expect(rowsOnDisk()).toHaveLength(4);
  });

  it("restore brings back the whole group", async () => {
    const preview = (await (await json("POST", url("/items/1/restore?preview=1"), {})).json()) as { indices: number[] };
    expect(preview.indices).toEqual([0, 1, 2]);
    const res = await json("POST", url("/items/1/restore"), {});
    expect(res.status).toBe(200);
    expect(rowsOnDisk().some(isRowRejected)).toBe(false);
    expect((await db.fetchItems(dbName)).items).toHaveLength(4);
  });

  it("restore on a row that is not rejected is refused", async () => {
    expect((await json("POST", url("/items/3/restore"), {})).status).toBe(400);
  });
});
