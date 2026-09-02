import type { Express, Request, Response } from "express";
import { getDefaultContentRoot } from "../site-config";
import * as fs from "fs";
import * as path from "path";
import { safeYamlLoad, safeYamlDump, requireCapability } from "./_helpers";
import { markFileAsModified } from "../sync-state";
import {
  asOverlaysList,
  mergeOverlayConfig,
  mergeOverlayContent,
  normalizeNewOverlay,
  overlayBlockingSaveError,
  validateOverlaysConfig,
  type OverlayContentSlice,
  type OverlaySaveCheck,
} from "@shared/overlays";

function getOverlaysFile(contentRoot: string): string {
  return path.join(contentRoot, "overlays.yml");
}

function getContentRoot(res: Response): string {
  return (res.locals.site as any)?.contentRoot ?? getDefaultContentRoot();
}

function readOverlaysFile(contentRoot: string): { overlays: OverlaySaveCheck[] } {
  const overlaysFile = getOverlaysFile(contentRoot);
  if (!fs.existsSync(overlaysFile)) {
    return { overlays: [] };
  }
  const parsed = safeYamlLoad(fs.readFileSync(overlaysFile, "utf-8"));
  return { overlays: asOverlaysList(parsed ?? { overlays: [] }) };
}

function writeOverlaysFile(
  contentRoot: string,
  data: { overlays: OverlaySaveCheck[] },
  author?: string | null,
): string | null {
  const validationError = validateOverlaysConfig(data);
  if (validationError) return validationError;
  const contentFolder = path.basename(contentRoot);
  const overlaysFile = getOverlaysFile(contentRoot);
  fs.writeFileSync(overlaysFile, safeYamlDump(data), "utf-8");
  markFileAsModified(`${contentFolder}/overlays.yml`, author || undefined);
  return null;
}

function findOverlayIndex(overlays: OverlaySaveCheck[], id: string): number {
  return overlays.findIndex((o) => o.id === id);
}

export function registerOverlaysRoutes(app: Express): void {
  app.get("/api/overlays", (_req: Request, res: Response) => {
    try {
      res.json(readOverlaysFile(getContentRoot(res)));
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
    const { authorized, author } = await requireCapability(req, res, "overlays_configure");
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

  app.post("/api/overlays", async (req: Request, res: Response) => {
    const { authorized, author } = await requireCapability(req, res, "overlays_configure");
    if (!authorized) return;

    try {
      const body = req.body as OverlaySaveCheck;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        res.status(400).json({ error: "Invalid body" });
        return;
      }
      const normalized = normalizeNewOverlay(body, { forceDisabled: true });
      if (!normalized.id) {
        res.status(400).json({ error: "Overlay ID is required" });
        return;
      }

      const contentRoot = getContentRoot(res);
      const data = readOverlaysFile(contentRoot);
      if (findOverlayIndex(data.overlays, normalized.id) >= 0) {
        res.status(409).json({ error: `Overlay "${normalized.id}" already exists` });
        return;
      }

      const blocking = overlayBlockingSaveError(normalized);
      if (blocking) {
        res.status(400).json({ error: blocking });
        return;
      }

      data.overlays.push(normalized);
      const writeErr = writeOverlaysFile(contentRoot, data, author);
      if (writeErr) {
        res.status(400).json({ error: writeErr });
        return;
      }
      res.json({ ok: true, overlay: normalized });
    } catch {
      res.status(500).json({ error: "Failed to create overlay" });
    }
  });

  app.delete("/api/overlays/:id", async (req: Request, res: Response) => {
    const { authorized, author } = await requireCapability(req, res, "overlays_configure");
    if (!authorized) return;

    try {
      const id = String(req.params.id || "");
      if (!id) {
        res.status(400).json({ error: "Overlay ID is required" });
        return;
      }

      const contentRoot = getContentRoot(res);
      const data = readOverlaysFile(contentRoot);
      const idx = findOverlayIndex(data.overlays, id);
      if (idx < 0) {
        res.status(404).json({ error: `Overlay "${id}" not found` });
        return;
      }

      data.overlays.splice(idx, 1);
      const writeErr = writeOverlaysFile(contentRoot, data, author);
      if (writeErr) {
        res.status(400).json({ error: writeErr });
        return;
      }
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: "Failed to delete overlay" });
    }
  });

  app.put("/api/overlays/:id/content", async (req: Request, res: Response) => {
    const { authorized, author } = await requireCapability(req, res, "overlays_edit_content");
    if (!authorized) return;

    try {
      const id = String(req.params.id || "");
      if (!id) {
        res.status(400).json({ error: "Overlay ID is required" });
        return;
      }

      const body = req.body as { content?: OverlayContentSlice } | OverlayContentSlice;
      const contentPayload: OverlayContentSlice =
        body && typeof body === "object" && "content" in body && body.content
          ? (body.content as OverlayContentSlice)
          : (body as OverlayContentSlice);

      if (!contentPayload || typeof contentPayload !== "object" || Array.isArray(contentPayload)) {
        res.status(400).json({ error: "content object is required" });
        return;
      }

      const contentRoot = getContentRoot(res);
      const data = readOverlaysFile(contentRoot);
      const idx = findOverlayIndex(data.overlays, id);
      if (idx < 0) {
        res.status(404).json({ error: `Overlay "${id}" not found` });
        return;
      }

      const merged = mergeOverlayContent(data.overlays[idx], contentPayload);
      const blocking = overlayBlockingSaveError(merged);
      if (blocking) {
        res.status(400).json({ error: blocking });
        return;
      }

      data.overlays[idx] = merged;
      const writeErr = writeOverlaysFile(contentRoot, data, author);
      if (writeErr) {
        res.status(400).json({ error: writeErr });
        return;
      }
      res.json({ ok: true, overlay: merged });
    } catch {
      res.status(500).json({ error: "Failed to update overlay content" });
    }
  });

  app.put("/api/overlays/:id/config", async (req: Request, res: Response) => {
    const { authorized, author } = await requireCapability(req, res, "overlays_configure");
    if (!authorized) return;

    try {
      const id = String(req.params.id || "");
      if (!id) {
        res.status(400).json({ error: "Overlay ID is required" });
        return;
      }

      const body = req.body;
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        res.status(400).json({ error: "Invalid body" });
        return;
      }

      const contentRoot = getContentRoot(res);
      const data = readOverlaysFile(contentRoot);
      const idx = findOverlayIndex(data.overlays, id);
      if (idx < 0) {
        res.status(404).json({ error: `Overlay "${id}" not found` });
        return;
      }

      const merged = mergeOverlayConfig(data.overlays[idx], body);
      if (!merged.ok) {
        res.status(400).json({ error: merged.error });
        return;
      }

      const blocking = overlayBlockingSaveError(merged.overlay);
      if (blocking) {
        res.status(400).json({ error: blocking });
        return;
      }

      data.overlays[idx] = merged.overlay;
      const writeErr = writeOverlaysFile(contentRoot, data, author);
      if (writeErr) {
        res.status(400).json({ error: writeErr });
        return;
      }
      res.json({ ok: true, overlay: merged.overlay });
    } catch {
      res.status(500).json({ error: "Failed to update overlay config" });
    }
  });
}
