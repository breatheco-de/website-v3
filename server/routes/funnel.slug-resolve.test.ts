import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Express, Request, Response } from "express";
import { ContentIndex } from "../content-index";
import { readFunnelBlockFromFile } from "../funnel-fields";

vi.mock("./_helpers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./_helpers")>()),
  requireCapability: vi.fn(async () => ({ authorized: true, author: "test" })),
}));
vi.mock("../sync-state", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../sync-state")>()),
  markFileAsModified: vi.fn(),
}));

const { registerFunnelRoutes } = await import("./funnel");

type Handler = (req: Request, res: Response) => Promise<void>;
const routes = new Map<string, Handler>();
registerFunnelRoutes({
  get(routePath: string, handler: Handler) {
    routes.set(`GET ${routePath}`, handler);
  },
  put(routePath: string, handler: Handler) {
    routes.set(`PUT ${routePath}`, handler);
  },
} as unknown as Express);

const tmpDirs: string[] = [];

function write(root: string, rel: string, body: string): void {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, body, "utf-8");
}

/** Page ID `ai-engineering-devs`, English address `ai-engineering-for-devs`. */
function makeSite(): ContentIndex {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "funnel-slug-"));
  tmpDirs.push(root);
  write(
    root,
    "content-types.yml",
    ["program:", "  directory: programs", "  url_pattern:", "    en: /en/career-programs/:slug", ""].join("\n"),
  );
  write(root, "programs/ai-engineering-devs/_common.yml", "slug: ai-engineering-devs\njob_role: AI Engineer\n");
  write(root, "programs/ai-engineering-devs/en.yml", "slug: ai-engineering-for-devs\ntitle: AI Engineering for Developers\n");
  const ci = new ContentIndex(root);
  ci.scanFast();
  ci.scanSlow();
  return ci;
}

async function call(method: "GET" | "PUT", ci: ContentIndex, slug: string, body?: unknown) {
  const handler = routes.get(`${method} /api/content-types/:type/funnel/:slug`);
  if (!handler) throw new Error(`funnel ${method} not registered`);
  const res = {
    statusCode: 200,
    body: undefined as unknown,
    locals: { site: { contentRoot: ci.contentRoot, contentIndex: ci } },
    status(code: number) {
      res.statusCode = code;
      return res;
    },
    json(payload: unknown) {
      res.body = payload;
      return res;
    },
  };
  await handler({ params: { type: "program", slug }, body } as unknown as Request, res as unknown as Response);
  return res;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("funnel routes resolve URL slugs to the page folder", () => {
  it("PUT with the language slug writes the page's _common.yml and creates no stray folder", async () => {
    const ci = makeSite();
    const res = await call("PUT", ci, "ai-engineering-for-devs", { stage: "consideration" });

    expect(res.statusCode).toBe(200);
    expect((res.body as { relativePath?: string }).relativePath).toBe("programs/ai-engineering-devs/_common.yml");
    expect(fs.existsSync(path.join(ci.contentRoot, "programs", "ai-engineering-for-devs"))).toBe(false);
    const common = path.join(ci.contentRoot, "programs", "ai-engineering-devs", "_common.yml");
    expect(readFunnelBlockFromFile(common)).toEqual({ stage: "consideration" });
    expect(fs.readFileSync(common, "utf-8")).toContain("job_role: AI Engineer");
  });

  it("GET with the language slug reads the page's funnel", async () => {
    const ci = makeSite();
    write(ci.contentRoot, "programs/ai-engineering-devs/_common.yml", "slug: ai-engineering-devs\nfunnel:\n  stage: decision\n");
    const res = await call("GET", ci, "ai-engineering-for-devs");

    expect(res.statusCode).toBe(200);
    expect((res.body as { funnel: unknown }).funnel).toEqual({ stage: "decision" });
  });

  it("PUT for an unknown page returns 404 and writes nothing", async () => {
    const ci = makeSite();
    const res = await call("PUT", ci, "does-not-exist", { stage: "consideration" });

    expect(res.statusCode).toBe(404);
    expect((res.body as { code: string }).code).toBe("entry_not_found");
    expect(fs.existsSync(path.join(ci.contentRoot, "programs", "does-not-exist"))).toBe(false);
  });
});
