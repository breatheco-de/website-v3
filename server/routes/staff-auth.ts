import type { Express } from "express";
import { child } from "../logger";
import { getAuthConnector, getAuthConnectors } from "../staff-auth/registry";
import { extractToken, requireStaffSession } from "./_helpers";
import {
  consumeSessionExchangeCode,
  createStaffSession,
  revokeAllStaffSessions,
  revokeStaffSession,
} from "../staff-session";
import {
  resolveOwnedStaffSession,
  staffSessionJson,
} from "../staff-session-resolve";

const log = child({ module: "routes/staff-auth" });

export function sanitizeReturnTo(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) return "/";
  const value = raw.trim();
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "/";
    const allowedOrigins = new Set<string>();
    const site = process.env.SITE_URL?.replace(/\/$/, "");
    if (site) {
      try {
        allowedOrigins.add(new URL(site).origin);
      } catch {
        /* ignore */
      }
    }
    const mcpPort = process.env.MCP_PORT || "3001";
    allowedOrigins.add(`http://127.0.0.1:${mcpPort}`);
    allowedOrigins.add(`http://localhost:${mcpPort}`);
    const mcpPublic = process.env.MCP_PUBLIC_URL?.replace(/\/$/, "");
    if (mcpPublic) {
      try {
        allowedOrigins.add(new URL(mcpPublic).origin);
      } catch {
        /* ignore */
      }
    }
    if (allowedOrigins.has(url.origin)) {
      return url.toString();
    }
  } catch {
    /* ignore */
  }
  return "/";
}

export function registerStaffAuthRoutes(app: Express): void {
  app.get("/api/staff/auth/connectors", (_req, res) => {
    res.json({
      connectors: getAuthConnectors(),
      education: {
        summary:
          "Staff sign-in uses an allowed login provider (GitHub today). Only pre-registered people (or the first admin on an empty install) get access. You need a verified email on that provider.",
        advanced: [
          "GitHub Connect on the sync chip is for content commits, not for signing in.",
          "Paste a staff session token from another signed-in browser — not a GitHub or Breathecode token.",
        ],
      },
    });
  });

  app.get("/api/staff/oauth/:provider/start", async (req, res) => {
    try {
      const provider = String(req.params.provider || "");
      const connector = getAuthConnector(provider);
      if (!connector) {
        res.status(404).json({ error: `Unknown auth provider '${provider}'` });
        return;
      }
      if (!connector.isConfigured()) {
        res.status(503).json({
          error: "This login provider is not configured.",
          code: "auth_provider_not_configured",
        });
        return;
      }
      if (provider !== "github") {
        res.status(404).json({ error: `Unknown auth provider '${provider}'` });
        return;
      }

      const { createOAuthState, getOAuthAuthorizeUrl } = await import(
        "../github-user-tokens"
      );
      const returnTo = sanitizeReturnTo(req.query.return_to);
      const state = createOAuthState({ purpose: "login", returnTo });
      const url = getOAuthAuthorizeUrl(state);

      const wantsJson =
        req.query.format === "json" ||
        (typeof req.headers.accept === "string" &&
          req.headers.accept.includes("application/json"));
      if (wantsJson) {
        res.json({ url });
        return;
      }
      res.redirect(url);
    } catch (error) {
      log.error({ err: error }, "Staff OAuth start failed");
      res.status(500).json({ error: "Failed to start login" });
    }
  });

  app.post("/api/staff/session/exchange", async (req, res) => {
    const code = typeof req.body?.code === "string" ? req.body.code : "";
    if (!code) {
      res.status(400).json({ valid: false, error: "code is required" });
      return;
    }
    const token = consumeSessionExchangeCode(code);
    if (!token) {
      res.status(401).json({
        valid: false,
        code: "session_invalid",
        error: "This sign-in code expired. Try logging in again.",
      });
      return;
    }
    const resolved = await resolveOwnedStaffSession(token);
    if (!resolved) {
      res.status(401).json({
        valid: false,
        code: "session_invalid",
        error: "Your session is no longer valid. Please log in again.",
      });
      return;
    }
    res.json({ ...staffSessionJson(resolved), token: resolved.token });
  });

  app.post("/api/staff/session/validate", async (req, res) => {
    const token = typeof req.body?.token === "string" ? req.body.token.trim() : "";
    if (!token) {
      res.status(400).json({ valid: false, error: "Token required" });
      return;
    }
    const resolved = await resolveOwnedStaffSession(token);
    if (!resolved) {
      res.json({
        valid: false,
        capabilities: [],
        code: "session_invalid",
        error: "That is not a valid staff session. Log in with GitHub first, then paste the session token.",
      });
      return;
    }
    res.json(staffSessionJson(resolved));
  });

  app.get("/api/staff/session/me", async (req, res) => {
    const token = extractToken(req);
    const resolved = await resolveOwnedStaffSession(token);
    if (!resolved) {
      res.status(401).json({
        valid: false,
        code: "session_invalid",
        error: "Your session has expired. Please log in again.",
      });
      return;
    }
    res.json(staffSessionJson(resolved));
  });

  app.post("/api/staff/session/logout", async (req, res) => {
    const token = extractToken(req) || (typeof req.body?.token === "string" ? req.body.token : "");
    if (token) await revokeStaffSession(token);
    res.json({ ok: true });
  });

  app.post("/api/staff/session/logout-all", async (req, res) => {
    const auth = await requireStaffSession(req, res);
    if (!auth.authorized) return;
    if (!auth.username) {
      res.status(400).json({ error: "No username on session" });
      return;
    }
    await revokeAllStaffSessions(auth.username);
    res.json({ ok: true });
  });
}

export async function completeGitHubLogin(opts: {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  identity: import("../staff-auth/types").AuthIdentity;
}): Promise<
  | { ok: true; username: string; sessionToken: string; writeWarning?: string }
  | { ok: false; code: string; error: string }
> {
  const { admitStaff } = await import("../staff-admission");
  const admitted = admitStaff(opts.identity);
  if (!admitted.ok) return admitted;

  const session = await createStaffSession(admitted.username);
  const { setUserGitHubToken, verifyContentRepoWriteAccess } = await import(
    "../github-user-tokens"
  );
  await setUserGitHubToken(admitted.username, {
    accessToken: opts.accessToken,
    refreshToken: opts.refreshToken,
    githubLogin: opts.identity.handle || admitted.username,
    githubName: opts.identity.displayName,
    githubEmail: opts.identity.primaryEmail,
    expiresAt: Date.now() + opts.expiresIn * 1000,
    connectedAt: new Date().toISOString(),
  });

  let writeWarning: string | undefined;
  const writeCheck = await verifyContentRepoWriteAccess(opts.accessToken);
  if (!writeCheck.ok) {
    writeWarning = writeCheck.error;
  }

  return {
    ok: true,
    username: admitted.username,
    sessionToken: session.token,
    writeWarning,
  };
}
