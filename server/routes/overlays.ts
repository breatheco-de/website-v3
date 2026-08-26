import type { Express, Request, Response } from "express";
import { getDefaultContentRoot } from "../site-config";
import * as fs from "fs";
import * as path from "path";
import { safeYamlLoad, safeYamlDump, requireCapability } from "./_helpers";
import { markFileAsModified } from "../sync-state";
import { validateOverlaysConfig } from "@shared/overlays";

function getOverlaysFile(contentRoot: string): string {
  return path.join(contentRoot, "overlays.yml");
}

function getContentRoot(res: Response): string {
  return (res.locals.site as any)?.contentRoot ?? getDefaultContentRoot();
}

function readOverlays(contentRoot: string): unknown {
  const overlaysFile = getOverlaysFile(contentRoot);
  if (!fs.existsSync(overlaysFile)) {
    return { overlays: [] };
  }
  return safeYamlLoad(fs.readFileSync(overlaysFile, "utf-8")) ?? {
    overlays: [],
  };
}

export function registerOverlaysRoutes(app: Express): void {
  app.get("/api/overlays", (_req: Request, res: Response) => {
    try {
      const data = readOverlays(getContentRoot(res));
      res.json(data);
    } catch {
      res.status(500).json({ error: "Failed to read overlays" });
    }
  });

  app.get("/api/overlays/yml", (_req: Request, res: Response) => {
    try {
      const contentRoot = getContentRoot(res);
      const overlaysFile = getOverlaysFile(contentRoot);
      const contentFolder = path.basename(contentRoot);
      const relativePath = `${contentFolder}/overlays.yml`;
      if (!fs.existsSync(overlaysFile)) {
        res.json({
          exists: true,
          path: relativePath,
          content: "overlays: []\n",
        });
        return;
      }
      res.json({
        exists: true,
        path: relativePath,
        content: fs.readFileSync(overlaysFile, "utf-8"),
      });
    } catch {
      res.status(500).json({ error: "Failed to read overlays.yml" });
    }
  });

  app.put("/api/overlays/yml", async (req: Request, res: Response) => {
    const { authorized, author } = await requireCapability(req, res, "content_editor");
    if (!authorized) return;

    try {
      const { content, author: requestAuthor } = req.body as {
        content?: string;
        author?: string;
      };
      if (typeof content !== "string") {
        res.status(400).json({ error: "content is required" });
        return;
      }

      const parsed = safeYamlLoad(content);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        res.status(400).json({ error: "overlays.yml must be a YAML object (e.g. overlays: [])" });
        return;
      }

      const validationError = validateOverlaysConfig(parsed);
      if (validationError) {
        res.status(400).json({ error: validationError });
        return;
      }

      const contentRoot = getContentRoot(res);
      const contentFolder = path.basename(contentRoot);
      const overlaysFile = getOverlaysFile(contentRoot);
      fs.writeFileSync(overlaysFile, content, "utf-8");
      const authorName =
        author || (requestAuthor && typeof requestAuthor === "string" ? requestAuthor : undefined);
      markFileAsModified(`${contentFolder}/overlays.yml`, authorName);
      res.json({ success: true, path: `${contentFolder}/overlays.yml` });
    } catch (err) {
      res.status(500).json({ error: err instanceof Error ? err.message : "Failed to save overlays.yml" });
    }
  });

  app.put("/api/overlays", async (req: Request, res: Response) => {
    const { authorized } = await requireCapability(req, res, "content_editor");
    if (!authorized) return;

    try {
      const body = req.body;
      if (!body || typeof body !== "object") {
        res.status(400).json({ error: "Invalid body" });
        return;
      }

      const validationError = validateOverlaysConfig(body);
      if (validationError) {
        res.status(400).json({ error: validationError });
        return;
      }

      const contentRoot = getContentRoot(res);
      const contentFolder = path.basename(contentRoot);
      const overlaysFile = getOverlaysFile(contentRoot);
      const yaml = safeYamlDump(body);
      fs.writeFileSync(overlaysFile, yaml, "utf-8");
      markFileAsModified(`${contentFolder}/overlays.yml`);
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "Failed to save overlays" });
    }
  });
}
