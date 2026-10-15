/**
 * worker_manage auth for Sidequest admin surfaces (dashboard, restart).
 * Uses the staff session token the browser already sends. Does not call BreatheCode.
 */

import type { Request, Response } from "express";
import * as userStore from "../user-store";
import { extractToken } from "../routes/_helpers";
import { resolveOwnedStaffSession } from "../staff-session-resolve";

export async function requireWorkerManage(
  req: Request,
  res: Response,
): Promise<{ authorized: boolean; username: string | null }> {
  const isDevelopment = process.env.NODE_ENV !== "production";
  const token = extractToken(req);

  if (isDevelopment) {
    if (token) {
      try {
        const session = await resolveOwnedStaffSession(token);
        if (session) {
          return { authorized: true, username: session.username };
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

  const session = await resolveOwnedStaffSession(token);
  if (!session) {
    res.status(401).json({ error: "Your session has expired. Please log in again." });
    return { authorized: false, username: null };
  }

  if (!userStore.hasCapability(session.username, "worker_manage")) {
    res.status(403).json({ error: "Insufficient permissions: worker_manage capability required" });
    return { authorized: false, username: session.username };
  }

  return { authorized: true, username: session.username };
}

/** @deprecated Use requireWorkerManage */
export const requireSidequestWebmaster = requireWorkerManage;
