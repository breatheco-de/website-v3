import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import zlib from "zlib";
import compression from "compression";
import express from "express";
import type { AddressInfo } from "net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { precompressedStatic, scanPrecompressed } from "./static-precompressed";

const JS = `export const x = "${"a".repeat(4000)}";\n`;
let root: string;
let server: http.Server;
let port: number;

function get(urlPath: string, acceptEncoding?: string) {
  return new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }>((resolve, reject) => {
    const req = http.get(
      { host: "127.0.0.1", port, path: urlPath, headers: acceptEncoding ? { "accept-encoding": acceptEncoding } : {} },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
      },
    );
    req.on("error", reject);
  });
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "precompressed-"));
  fs.mkdirSync(path.join(root, "assets"));
  fs.writeFileSync(path.join(root, "assets", "app.js"), JS);
  fs.writeFileSync(path.join(root, "assets", "app.js.br"), zlib.brotliCompressSync(JS));
  fs.writeFileSync(path.join(root, "assets", "app.js.gz"), zlib.gzipSync(JS));
  fs.writeFileSync(path.join(root, "assets", "plain.css"), `body{color:red}${" ".repeat(3000)}`);
  fs.writeFileSync(path.join(root, "secret.js"), JS);

  const app = express();
  app.use(compression({ filter: (req, res) => !res.getHeader("Content-Encoding") && compression.filter(req, res) }));
  app.use(precompressedStatic(root));
  app.use(express.static(root, { index: false }));
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once("listening", () => resolve()));
  port = (server.address() as AddressInfo).port;
});

afterAll(() => {
  server?.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("scanPrecompressed", () => {
  it("lists only files with a compressed copy, by URL path", () => {
    const found = scanPrecompressed(root);
    expect(found.get("/assets/app.js")).toEqual({ br: true, gzip: true });
    expect(found.has("/assets/plain.css")).toBe(false);
    expect(found.has("/secret.js")).toBe(false);
  });
});

describe("precompressedStatic", () => {
  it("sends the .br copy with the original content type", async () => {
    const res = await get("/assets/app.js", "gzip, deflate, br");
    expect(res.status).toBe(200);
    expect(res.headers["content-encoding"]).toBe("br");
    expect(res.headers["content-type"]).toMatch(/javascript/);
    expect(res.headers.vary).toMatch(/Accept-Encoding/i);
    expect(res.body.equals(fs.readFileSync(path.join(root, "assets", "app.js.br")))).toBe(true);
  });

  it("sends the .gz copy when brotli is not accepted", async () => {
    const res = await get("/assets/app.js", "gzip");
    expect(res.headers["content-encoding"]).toBe("gzip");
    expect(zlib.gunzipSync(res.body).toString("utf8")).toBe(JS);
  });

  it("falls through to the plain file for identity", async () => {
    const res = await get("/assets/app.js");
    expect(res.headers["content-encoding"]).toBeUndefined();
    expect(res.body.toString("utf8")).toBe(JS);
  });

  it("falls back to on-the-fly compression when there is no copy", async () => {
    const res = await get("/assets/plain.css", "br");
    expect(res.headers["content-encoding"]).toBe("br");
    expect(zlib.brotliDecompressSync(res.body).toString("utf8")).toMatch(/^body\{color:red\}/);
  });

  it("only serves paths found at startup (no traversal, no unknown files)", () => {
    const mw = precompressedStatic(path.join(root, "assets"));
    for (const p of ["/%2e%2e/secret.js", "/../secret.js", "/nope.js", "/app.js%00"]) {
      let nextCalls = 0;
      let sent = false;
      const res = { vary() {}, type() {}, setHeader() {}, sendFile() { sent = true; } };
      mw({ method: "GET", path: p, headers: { "accept-encoding": "br" } } as never, res as never, () => { nextCalls += 1; });
      expect(sent).toBe(false);
      expect(nextCalls).toBe(1);
    }
  });

  it("returns 404 for unknown files", async () => {
    expect((await get("/assets/nope.js", "br")).status).toBe(404);
  });
});
