import fs from "fs";
import os from "os";
import path from "path";
import yaml from "js-yaml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Express, Request, Response } from "express";
import { invalidateTrackingKeyIndex } from "../product/tracking-key-index";
import { resetTrackingReadinessMemo } from "../product/tracking-readiness";
import { registerFunnelRoutes } from "./funnel";

type Handler = (req: Request, res: Response) => Promise<void>;
const routes = new Map<string, Handler>();
registerFunnelRoutes({
  get(routePath: string, handler: Handler) {
    routes.set(`GET ${routePath}`, handler);
  },
  put() {},
} as unknown as Express);

const persona = (id: string, short_key?: string) => ({
  id,
  ...(short_key ? { short_key } : {}),
  role: id,
  avatar: { fears: ["f"], internal_dialogue: "d", objections: ["o"] },
});

describe("GET /api/content-types/:type/funnel/:slug tracking", () => {
  let tmp = "";

  const write = (rel: string, doc: unknown) => {
    const p = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, yaml.dump(doc));
  };

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "funnel-route-tracking-"));
    invalidateTrackingKeyIndex();
    resetTrackingReadinessMemo();
    write("content-types.yml", {
      program: { directory: "programs" },
      landing: { directory: "landings" },
    });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    invalidateTrackingKeyIndex();
    resetTrackingReadinessMemo();
  });

  async function getFunnel(contentType: string, slug: string) {
    const handler = routes.get("GET /api/content-types/:type/funnel/:slug");
    if (!handler) throw new Error("funnel GET not registered");
    const res = {
      statusCode: 200,
      body: undefined as unknown,
      locals: { site: { contentRoot: tmp } },
      status(code: number) {
        res.statusCode = code;
        return res;
      },
      json(body: unknown) {
        res.body = body;
        return res;
      },
    };
    await handler(
      { params: { type: contentType, slug } } as unknown as Request,
      res as unknown as Response,
    );
    return res;
  }

  it("returns short codes when the site tracking switch is on", async () => {
    write("programs/ai-flex/_product.yml", {
      purchasable: true,
      name: "AI Flex",
      short_key: "afx",
      personas: [persona("the-explorer", "exp")],
    });
    write("landings/apply/_common.yml", {
      funnel: {
        stage: "decision",
        products: [{ product: "ai-flex", persona: "the-explorer" }],
      },
    });
    const commonPath = path.join(tmp, "landings", "apply", "_common.yml");
    const before = fs.readFileSync(commonPath, "utf-8");

    const res = await getFunnel("landing", "apply");
    expect(res.statusCode).toBe(200);
    expect((res.body as { tracking: unknown }).tracking).toEqual({
      funnel_stage: "decision",
      content_key: "landing:apply",
      product: "afx",
      persona: "exp",
      product_persona: "afx:exp",
    });
    expect(fs.readFileSync(commonPath, "utf-8")).toBe(before);
  });

  it("returns tracking null when the site tracking switch is off", async () => {
    write("programs/ai-flex/_product.yml", {
      purchasable: true,
      name: "AI Flex",
      short_key: "afx",
      personas: [persona("the-explorer")],
    });
    write("landings/apply/_common.yml", {
      funnel: {
        stage: "decision",
        products: [{ product: "ai-flex", persona: "the-explorer" }],
      },
    });

    const res = await getFunnel("landing", "apply");
    expect(res.statusCode).toBe(200);
    expect((res.body as { tracking: unknown }).tracking).toBeNull();
  });
});
