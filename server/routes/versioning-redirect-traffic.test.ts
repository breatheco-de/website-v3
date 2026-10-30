import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import type { AddressInfo } from "net";
import express from "express";
import yaml from "js-yaml";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./_helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./_helpers")>()),
  requireCapability: async () => ({ authorized: true, token: "t", username: "pat", author: "pat" }),
  requireAnyCapability: async () => ({ authorized: true, token: "t", username: "pat", author: "pat" }),
}));
vi.mock("../sync-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sync-state")>()),
  markFileAsModified: vi.fn(),
}));

import { resetRegistry } from "../content-types";
import { setAbTestingDataDirForTests } from "../ab-testing/state";
import { createMemoryDraftBaseStore, setDraftBaseStore } from "../versioning/draft-base";
import { VersioningManager } from "../versioning/VersioningManager";
import { registerVersioningRoutes } from "./versioning";

let tempDir: string;
let contentRoot: string;
let entryDir: string;
let server: http.Server | null = null;
let baseUrl = "";

const page = (redirects: string[]) => yaml.dump({ slug: "promo", title: "Promo", meta: { redirects }, sections: [] });

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "versioning-redirect-traffic-"));
  contentRoot = path.join(tempDir, "site_vt");
  entryDir = path.join(contentRoot, "landings", "promo");
  fs.mkdirSync(entryDir, { recursive: true });
  fs.writeFileSync(
    path.join(contentRoot, "content-types.yml"),
    "landing:\n  directory: landings\n  url_pattern:\n    en: /en/landing/:slug\n",
    "utf-8",
  );
  resetRegistry(contentRoot);
  setAbTestingDataDirForTests(path.join(tempDir, "data"));
  setDraftBaseStore(createMemoryDraftBaseStore());
  const vm = new VersioningManager(contentRoot);

  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.locals.site = { contentRoot, contentRootName: "site_vt", versioningManager: vm } as any;
    next();
  });
  registerVersioningRoutes(app);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  setAbTestingDataDirForTests(null);
  resetRegistry(contentRoot);
  fs.rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  fs.writeFileSync(path.join(entryDir, "en.yml"), page(["/en/old-promo"]), "utf-8");
  fs.writeFileSync(path.join(entryDir, "versioning.yml"), yaml.dump({ en: { variants: [{ slug: "draft", allocation: 0 }] } }));
});

const setTraffic = (allocation: number) =>
  fetch(`${baseUrl}/api/versioning/landing/promo/en`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ variants: [{ slug: "draft", allocation }], confirm_publish_variants: true }),
  });

describe("traffic for variants that change old addresses", () => {
  it("refuses any traffic for a variant whose old addresses differ from live", async () => {
    fs.writeFileSync(path.join(entryDir, "draft.en.yml"), page(["/en/old-promo", "/en/new-alias"]), "utf-8");
    const res = await setTraffic(100);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.code).toBe("variant_has_redirect_changes");
    expect(body.variants).toEqual([{ variant: "draft", added: ["/en/new-alias"], removed: [], changed: [] }]);
  });

  it("does not block a variant whose old addresses match live (later gates may still refuse)", async () => {
    fs.writeFileSync(path.join(entryDir, "draft.en.yml"), page(["/en/old-promo"]), "utf-8");
    const res = await setTraffic(50);
    expect((await res.json()).code).not.toBe("variant_has_redirect_changes");
  });

  it("lowering to 0% is always allowed", async () => {
    fs.writeFileSync(path.join(entryDir, "draft.en.yml"), page(["/en/new-alias"]), "utf-8");
    const res = await setTraffic(0);
    expect((await res.json()).code).not.toBe("variant_has_redirect_changes");
  });
});
