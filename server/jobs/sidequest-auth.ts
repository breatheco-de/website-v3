/**
 * worker_manage auth for Sidequest admin surfaces (dashboard, restart).
 */

import type { Request, Response } from "express";
import * as userManager from "../user-manager";
import * as userStore from "../user-store";
import { extractToken } from "../routes/_helpers";

export async function requireWorkerManage(
  req: Request,
  res: Response,
): Promise<{ authorized: boolean; username: string | null }> {
  const isDevelopment = process.env.NODE_ENV !== "production";
  const token = extractToken(req);

  if (isDevelopment) {
    if (token) {
      try {
        const profile = await userManager.validateToken(token);
        if (profile.valid && profile.username) {
          return { authorized: true, username: profile.username };
        }
      } catch {
        // ignore in dev
      }
    }
    return { authorized: true, username: null };
  }

  if (!token) {
    res.status(401).json({ error: "Authorization required" });
    return { authorized: false, username: null };
  }

  const profile = await userManager.validateToken(token);
  if (!profile.valid || !profile.username) {
    res.status(401).json({ error: "Your session has expired. Please log in again." });
    return { authorized: false, username: null };
  }

  if (!userStore.hasCapability(profile.username, "worker_manage")) {
    res.status(403).json({ error: "Insufficient permissions: worker_manage capability required" });
    return { authorized: false, username: profile.username };
  }

  return { authorized: true, username: profile.username };
}

/** @deprecated Use requireWorkerManage */
export const requireSidequestWebmaster = requireWorkerManage;
