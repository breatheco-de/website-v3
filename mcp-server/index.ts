import "dotenv/config";
import express from "express";
import cors from "cors";
import fs from "fs";
import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { registerPageTools } from "./tools/pages.js";
import { registerSeoClusterTools } from "./tools/seo-clusters.js";
import { registerComponentTools } from "./tools/components.js";
import { registerUserTools } from "./tools/user.js";
import { registerExplainTools } from "./tools/explain.js";
import { registerEcommerceTools } from "./tools/ecommerce.js";
import { registerDatabaseTools } from "./tools/databases.js";
import { registerRedirectTools } from "./tools/redirects.js";
import { registerMediaTools } from "./tools/media.js";
import { registerProposalTools } from "./tools/proposals.js";
import { registerValidationIssuesTools } from "./tools/validation-issues.js";
import { registerOrganicTrafficTools } from "./tools/organic-traffic.js";
import {
  registerClient,
  lookupClient,
  generateCode,
  exchangeCode,
  validateToken,
  getTokenUsername,
  createPendingAuth,
  consumePendingAuth,
  peekPendingAuth,
  validateStaffSessionToken,
  updateClientStaffUser,
  registerStaffSessionToken,
  getCachedBreathecodeUsername,
  initGcsStore,
  flushGcsWrites,
  getGcsAuthPersistenceHealth,
  TOKEN_EXPIRES_IN,
} from "./lib/oauth.js";
import { warnMcpBucketParity } from "./lib/bucket-parity.js";
import {
  fetchCallerGrants,
  fetchMcpAccess,
  fetchRoleContext,
  fetchRoleInfo,
  runInMcpSession,
} from "./lib/auth.js";
import {
  IDENTITY_TOOLS,
  allowedToolNames,
  applyToolCatalogFilter,
  type CatalogGrant,
} from "./lib/tool-catalog.js";

const PORT = parseInt(process.env.MCP_PORT || "3001", 10);
// MCP_SERVER_SECRET (formerly MCP_API_KEY) is used exclusively as an internal
// server-to-server credential for the MCP server's own loopback requests to the
// main app's /api/auth/check-capability endpoint. It is never accepted as an
// inbound caller credential — callers must use OAuth or a Breathecode token.
const SERVER_SECRET = process.env.MCP_SERVER_SECRET || process.env.MCP_API_KEY || "";
const STATIC_CLIENT_ID = process.env.OAUTH_CLIENT_ID || "";
const STATIC_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET || "";

if (!SERVER_SECRET) {
  console.error(
    "[MCP] FATAL: MCP_SERVER_SECRET is not set. Set MCP_SERVER_SECRET in your environment (Secrets tab on Replit, or .env locally) before starting the server.",
  );
  process.exit(1);
}

if (!process.env.MCP_SERVER_SECRET && process.env.MCP_API_KEY) {
  console.warn(
    "[MCP] DEPRECATION WARNING: MCP_API_KEY is a legacy alias. Rename it to MCP_SERVER_SECRET — MCP_API_KEY support will be removed in a future release.",
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#x27;");
}

function isValidClient(clientId: string): boolean {
  if (lookupClient(clientId)) return true;
  return !!(STATIC_CLIENT_ID && clientId === STATIC_CLIENT_ID);
}

function isAllowedRedirectUri(clientId: string, redirectUri: string): boolean {
  const registered = lookupClient(clientId);
  if (registered) {
    return registered.redirectUris.includes(redirectUri);
  }
  return true;
}

function getBase(): string {
  const replitDomain = process.env.REPLIT_DEV_DOMAIN;
  return (
    process.env.SITE_URL ||
    (replitDomain ? `https://${replitDomain}` : `http://localhost:${PORT}`)
  );
}

function parseRoleIdFromResource(resource: string | undefined): string | undefined {
  if (!resource) return undefined;
  try {
    const u = new URL(resource);
    const m = u.pathname.match(/\/mcp\/role\/([a-z0-9_-]+)/i);
    return m?.[1]?.toLowerCase();
  } catch {
    const m = resource.match(/\/mcp\/role\/([a-z0-9_-]+)/i);
    return m?.[1]?.toLowerCase();
  }
}

function isValidRoleId(roleId: string): boolean {
  return /^[a-z][a-z0-9_-]*$/.test(roleId);
}

/** Deprecated connector ids — resolves before role lookup (one-release window). */
const DEPRECATED_MCP_ROLE_ALIASES: Readonly<Record<string, string>> = {
  webmaster: "user_admin",
};

function resolveMcpRoleId(roleId: string): string {
  const resolved = DEPRECATED_MCP_ROLE_ALIASES[roleId] ?? roleId;
  if (resolved !== roleId) {
    console.warn(`[MCP] Deprecated role id '${roleId}' — use '/mcp/role/${resolved}' instead`);
  }
  return resolved;
}

function getMcpPublicBase(): string {
  return (
    process.env.MCP_PUBLIC_URL ||
    `http://127.0.0.1:${PORT}`
  ).replace(/\/$/, "");
}

function getCmsBase(): string {
  return (
    process.env.SITE_URL ||
    `http://127.0.0.1:${process.env.PORT || "5000"}`
  ).replace(/\/$/, "");
}

/** Empty installs have no staff roster yet — GitHub sign-in is not useful until setup finishes. */
async function hasStaffUsersConfigured(): Promise<boolean> {
  const mainAppPort = process.env.PORT || "5000";
  try {
    const res = await fetch(`http://127.0.0.1:${mainAppPort}/api/staff/auth/connectors`);
    if (!res.ok) return true;
    const data = (await res.json()) as { hasStaffUsers?: boolean };
    return data.hasStaffUsers !== false;
  } catch {
    // Prefer showing both methods if CMS is unreachable (production-safe default).
    return true;
  }
}

function renderAuthorizePage(opts: {
  nonce: string;
  clientId: string;
  redirectUri: string;
  error?: string;
  roleId?: string;
  roleLabel?: string;
  roleDescription?: string;
  allowedTools?: string[];
  /** When set, only that auth method step is shown. */
  authStep?: "choose" | "token" | "login";
  /** No staff users yet — token-only bootstrap (hide GitHub / choose). */
  tokenOnly?: boolean;
}): string {
  const mcpBase = getMcpPublicBase();
  const cmsBase = getCmsBase();
  const githubStartUrl = `${cmsBase}/api/staff/oauth/github/start?return_to=${encodeURIComponent(
    `${mcpBase}/oauth/staff-return?nonce=${opts.nonce}`,
  )}`;
  const tokenOnly = Boolean(opts.tokenOnly);
  let step = opts.authStep || "choose";
  if (tokenOnly && step !== "token") {
    step = "token";
  }

  const errorHtml = opts.error
    ? `<div class="error">${escapeHtml(opts.error)}</div>`
    : "";

  let roleHtml = "";
  if (opts.roleId) {
    const tools = opts.allowedTools ?? [];
    const toolList =
      tools.length > 0
        ? `<ul class="tools">${tools.map((t) => `<li><code>${escapeHtml(t)}</code></li>`).join("")}</ul>`
        : `<p class="muted">Only identity tools (or none beyond auth) for this role.</p>`;
    roleHtml = `
  <div class="card role-card">
    <h2>Role connector: ${escapeHtml(opts.roleLabel || opts.roleId)}</h2>
    <p class="muted"><code>/mcp/role/${escapeHtml(opts.roleId)}</code></p>
    ${
      opts.roleDescription
        ? `<p class="desc">${escapeHtml(opts.roleDescription)}</p>`
        : ""
    }
    <p class="tools-heading">Tools this connector exposes (${tools.length})</p>
    ${toolList}
  </div>`;
  }

  const chooseHtml = `
  <div class="card">
    <h2>How do you want to verify?</h2>
    <p class="muted">Staff sign-in uses GitHub (or a pasted staff session). Only pre-registered people can get in.</p>
    <form method="GET" action="/oauth/authorize/step" class="stack">
      <input type="hidden" name="nonce" value="${escapeHtml(opts.nonce)}">
      <button type="submit" name="method" value="login">Log in with GitHub</button>
      <button type="submit" name="method" value="token" class="secondary">Paste staff session token</button>
    </form>
  </div>`;

  const backLink = tokenOnly
    ? ""
    : `<a class="back" href="/oauth/authorize/step?nonce=${encodeURIComponent(opts.nonce)}&amp;method=choose">← Choose a different method</a>`;

  const tokenHtml = `
  <div class="card">
    <h2>${tokenOnly ? "Paste your connection token" : "Paste your staff session token"}</h2>
    <p class="muted">${
      tokenOnly
        ? "No staff users are set up yet. Paste the connection token from your Weblify terminal to authorize this connector."
        : "Use the connection token from Weblify, or a session from a signed-in CMS browser — not a GitHub or Breathecode token."
    }</p>
    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="nonce" value="${escapeHtml(opts.nonce)}">
      <label for="token">${tokenOnly ? "Connection token" : "Staff / connection token"}</label>
      <input type="text" id="token" name="token" placeholder="Paste your token" autocomplete="off" required>
      <button type="submit">Verify &amp; Authorize</button>
    </form>
    ${backLink}
  </div>`;

  const loginHtml = `
  <div class="card">
    <h2>Log in with GitHub</h2>
    <p class="muted">You need a verified email on GitHub. Only pre-registered staff can sign in.</p>
    <a class="login-link" href="${escapeHtml(githubStartUrl)}">Continue to GitHub</a>
    ${backLink}
  </div>`;

  const bodyCard =
    step === "token" ? tokenHtml : step === "login" ? loginHtml : chooseHtml;

  const subtitle = tokenOnly
    ? "Authorize with the connection token from Weblify to finish connecting."
    : "Verify your staff identity (GitHub or staff session) to grant MCP server access.";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize MCP Access</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; max-width: 520px; margin: 80px auto; padding: 0 1rem; color: #1a1a1a; }
    h1 { font-size: 1.4rem; margin-bottom: 0.4rem; }
    .subtitle { color: #555; margin-bottom: 1.5rem; font-size: 0.95rem; }
    .card { border: 1px solid #e0e0e0; border-radius: 8px; padding: 1.5rem; background: #fafafa; margin-bottom: 1rem; }
    .card h2 { font-size: 1rem; margin: 0 0 0.75rem; }
    .muted { color: #666; font-size: 0.9rem; margin: 0.35rem 0; }
    .desc { font-size: 0.95rem; line-height: 1.45; margin: 0.75rem 0; }
    .tools-heading { font-size: 0.85rem; font-weight: 600; margin: 0.75rem 0 0.35rem; }
    ul.tools { margin: 0; padding-left: 1.1rem; max-height: 180px; overflow: auto; font-size: 0.8rem; }
    ul.tools code { font-size: 0.75rem; }
    label { display: block; font-size: 0.9rem; color: #444; margin-bottom: 0.3rem; }
    input[type="text"] {
      width: 100%; padding: 0.5rem 0.7rem; border: 1px solid #ccc; border-radius: 6px;
      font-size: 0.95rem; margin-bottom: 0.75rem; font-family: monospace;
    }
    input[type="text"]:focus { outline: none; border-color: #5046e5; box-shadow: 0 0 0 2px rgba(80,70,229,0.15); }
    button, .login-link {
      display: block; width: 100%; text-align: center; background: #5046e5; color: #fff; border: none; border-radius: 6px;
      padding: 0.65rem 1.4rem; font-size: 1rem; cursor: pointer; text-decoration: none; font-weight: 500; margin-top: 0.5rem;
    }
    button:hover, .login-link:hover { background: #3d35c4; }
    button.secondary { background: #f0f0f0; color: #1a1a1a; border: 1px solid #ddd; }
    button.secondary:hover { background: #e4e4e4; }
    .stack { display: flex; flex-direction: column; gap: 0.5rem; }
    .error { background: #fff0f0; border: 1px solid #f5c6c6; color: #c0392b; border-radius: 6px; padding: 0.65rem 1rem; margin-bottom: 1rem; font-size: 0.9rem; }
    .cancel, .back { display: block; text-align: center; margin-top: 0.75rem; color: #888; font-size: 0.85rem; text-decoration: none; }
    .cancel:hover, .back:hover { color: #555; }
  </style>
</head>
<body>
  <h1>Authorize MCP Access</h1>
  <p class="subtitle">${escapeHtml(subtitle)}</p>
  ${errorHtml}
  ${roleHtml}
  ${bodyCard}
  <a class="cancel" href="${escapeHtml(opts.redirectUri)}?error=access_denied">Cancel</a>
</body>
</html>`;
}

// ─── MCP server factory ───────────────────────────────────────────────────────

async function createMcpServer(
  mcpAuthor?: string,
  mcpToken?: string,
  opts?: {
    filterCatalog?: boolean;
    activeRoleId?: string;
    roleLabel?: string;
    roleDescription?: string;
    roleGrants?: CatalogGrant[];
  },
): Promise<McpServer> {
  const serverName = opts?.activeRoleId
    ? `content-pages-${opts.activeRoleId}`
    : "content-pages";
  const instructions = opts?.roleDescription?.trim()
    ? opts.roleDescription.trim()
    : undefined;
  const mcp = new McpServer(
    { name: serverName, version: "1.0.0" },
    instructions ? { instructions } : undefined,
  );
  let grants: CatalogGrant[] | undefined;
  let allowed: Set<string> | null = null;

  if (opts?.activeRoleId && opts.roleGrants) {
    grants = opts.roleGrants;
    allowed = new Set(allowedToolNames(opts.roleGrants));
  } else if (opts?.filterCatalog && mcpToken) {
    const fetched = await fetchCallerGrants(mcpToken);
    if (!fetched) {
      grants = [];
      allowed = new Set(IDENTITY_TOOLS);
    } else {
      grants = fetched;
      allowed = new Set(allowedToolNames(fetched));
    }
  }

  applyToolCatalogFilter(mcp, allowed);
  registerPageTools(mcp, mcpAuthor, mcpToken, grants);
  registerSeoClusterTools(mcp, mcpToken, grants);
  registerComponentTools(mcp, mcpToken, grants);
  registerUserTools(mcp, mcpToken, grants, {
    activeRoleId: opts?.activeRoleId,
    roleDescription: opts?.roleDescription,
    roleLabel: opts?.roleLabel,
  });
  registerExplainTools(mcp, mcpToken, grants);
  registerEcommerceTools(mcp, mcpToken, grants);
  registerDatabaseTools(mcp, mcpToken);
  registerRedirectTools(mcp, mcpToken);
  registerMediaTools(mcp, mcpToken, grants);
  registerProposalTools(mcp, mcpToken, grants);
  registerValidationIssuesTools(mcp, mcpToken, grants);
  registerOrganicTrafficTools(mcp, mcpToken, grants);
  return mcp;
}

// ─── Express server ───────────────────────────────────────────────────────────

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

async function authMiddleware(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction,
): Promise<void> {
  const apiKeyHeader = req.headers["x-api-key"] as string | undefined;
  const authHeader = req.headers["authorization"] || "";
  const bearerToken =
    typeof authHeader === "string" ? authHeader.replace(/^Bearer\s+/i, "").trim() : "";

  const denyMcpReadDisabled = () => {
    res.status(403).json({
      error:
        "MCP access is disabled for this user. Ask an administrator to enable MCP read on Security → Users.",
    });
  };

  const ensureMcpRead = async (username: string): Promise<boolean> => {
    const access = await fetchMcpAccess(username);
    if (!access.mcpReadEnabled) {
      denyMcpReadDisabled();
      return false;
    }
    return true;
  };

  // Path 0: Weblify localhost connection token (CLI agentic local / regenerate)
  let connectionToken = process.env.WEBLIFY_CONNECTION_TOKEN?.trim() || "";
  if (!connectionToken) {
    try {
      const root = process.env.WEBLIFY_PROJECT_ROOT || process.cwd();
      const p = path.join(root, ".local", "connection-token");
      if (fs.existsSync(p)) connectionToken = fs.readFileSync(p, "utf-8").trim();
    } catch {
      /* ignore */
    }
  }
  if (connectionToken && (bearerToken === connectionToken || apiKeyHeader === connectionToken)) {
    next();
    return;
  }

  // Path 1: valid OAuth access token (issued by this server's /oauth/token endpoint)
  if (bearerToken && validateToken(bearerToken)) {
    const username = getTokenUsername(bearerToken);
    // Weblify empty-install bootstrap identity (connection-token OAuth) is not a CMS user.
    if (
      username &&
      username !== "weblify-local" &&
      !(await ensureMcpRead(username))
    ) {
      return;
    }
    next();
    return;
  }

  // Path 2: CMS staff session presented via Authorization: Bearer or X-Api-Key.
  const candidate = bearerToken || apiKeyHeader || "";
  if (candidate) {
    const cachedUsername = getCachedBreathecodeUsername(candidate);
    if (cachedUsername) {
      console.log(`[MCP] OAuth: using cached staff session for ${cachedUsername}`);
      if (!(await ensureMcpRead(cachedUsername))) return;
      next();
      return;
    }

    const validation = await validateStaffSessionToken(candidate);
    if (validation.valid && validation.username) {
      registerStaffSessionToken(candidate, validation.username);
      if (!(await ensureMcpRead(validation.username))) return;
      next();
      return;
    }
    const errMsg = validation.error || "Staff session validation failed.";
    res.status(401).json({ error: `Unauthorized. ${errMsg}` });
    return;
  }

  const roleMatch = req.path.match(/^\/mcp\/role\/([a-z0-9_-]+)$/i);
  const mcpRole = roleMatch?.[1]?.toLowerCase();
  res.status(401).json({
    error:
      "Unauthorized. This is an MCP endpoint — connect via an MCP client (Cursor, Claude, etc.) that completes the OAuth flow. Do not open /mcp directly in a browser.",
    auth: "oauth",
    authorize_hint: mcpRole
      ? `/oauth/authorize?mcp_role=${encodeURIComponent(mcpRole)}`
      : "/oauth/authorize",
    ...(mcpRole ? { mcp_role: mcpRole } : {}),
  });
}

// ─── Health ───────────────────────────────────────────────────────────────────

app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    server: "content-pages-mcp",
    version: "1.0.0",
    gcsAuthPersistence: getGcsAuthPersistenceHealth(),
  });
});

// ─── Tool catalog (no auth — metadata only) ───────────────────────────────────

app.get("/tools", async (_req, res) => {
  try {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const mcp = await createMcpServer();
    const client = new Client({ name: "internal-introspect", version: "1.0.0" });
    await Promise.all([mcp.connect(serverTransport), client.connect(clientTransport)]);
    const result = await client.listTools();
    await Promise.all([client.close(), mcp.close()]);
    res.json({ tools: result.tools });
  } catch (err) {
    console.error("[MCP] /tools introspection error:", err);
    res.status(500).json({ tools: [], error: "Failed to list tools" });
  }
});

// ─── OAuth 2.0 endpoints ──────────────────────────────────────────────────────

app.get("/.well-known/oauth-authorization-server", (_req, res) => {
  const base = getBase();
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code"],
    token_endpoint_auth_methods_supported: ["client_secret_post"],
  });
});

app.post("/oauth/register", (req, res) => {
  const body = req.body as {
    client_name?: string;
    redirect_uris?: string[];
    [key: string]: unknown;
  };

  const redirectUris: string[] = Array.isArray(body.redirect_uris)
    ? body.redirect_uris
    : [];
  if (redirectUris.length === 0) {
    res.status(400).json({
      error: "invalid_client_metadata",
      error_description: "redirect_uris is required",
    });
    return;
  }

  for (const uri of redirectUris) {
    try {
      new URL(uri);
    } catch {
      res.status(400).json({
        error: "invalid_client_metadata",
        error_description: `Invalid redirect_uri: ${uri}`,
      });
      return;
    }
  }

  const { clientId, clientSecret } = registerClient(
    body.client_name || "Claude.ai",
    redirectUris,
  );

  const base = getBase();
  res.status(201).json({
    client_id: clientId,
    client_secret: clientSecret,
    client_name: body.client_name || "Claude.ai",
    redirect_uris: redirectUris,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: "client_secret_post",
    registration_client_uri: `${base}/oauth/register/${clientId}`,
  });
});

app.get("/oauth/authorize", async (req, res) => {
  const { client_id, redirect_uri, response_type, state, mcp_role, resource } = req.query as Record<
    string,
    string
  >;

  if (response_type !== "code") {
    res.status(400).json({ error: "unsupported_response_type" });
    return;
  }
  if (!client_id || !isValidClient(client_id)) {
    res.status(400).json({ error: `invalid_client: ${client_id}` });
    return;
  }
  if (!redirect_uri) {
    res.status(400).json({
      error: "invalid_request",
      error_description: "redirect_uri is required",
    });
    return;
  }
  if (!isAllowedRedirectUri(client_id, redirect_uri)) {
    res.status(400).json({
      error: "invalid_request",
      error_description: "redirect_uri not registered for this client",
    });
    return;
  }

  const roleIdRaw = (mcp_role || parseRoleIdFromResource(resource) || "").toLowerCase();
  const roleIdResolved = roleIdRaw && isValidRoleId(roleIdRaw) ? resolveMcpRoleId(roleIdRaw) : undefined;
  const roleId = roleIdResolved;
  let roleMeta: Awaited<ReturnType<typeof fetchRoleInfo>> = null;
  if (roleId) {
    roleMeta = await fetchRoleInfo(roleId);
    if (!roleMeta) {
      res.status(404).json({
        error: "invalid_request",
        error_description: `Unknown MCP role '${roleId}'`,
      });
      return;
    }
  }

  const nonce = createPendingAuth(client_id, redirect_uri, state, roleId);
  const tokenOnly = !(await hasStaffUsersConfigured());

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(
    renderAuthorizePage({
      nonce,
      clientId: client_id,
      redirectUri: redirect_uri,
      authStep: tokenOnly ? "token" : "choose",
      tokenOnly,
      roleId: roleMeta?.roleId,
      roleLabel: roleMeta?.label,
      roleDescription: roleMeta?.description,
      allowedTools: roleMeta?.allowedTools,
    }),
  );
});

app.get("/oauth/authorize/step", async (req, res) => {
  const { nonce, method } = req.query as Record<string, string>;
  if (!nonce) {
    res.status(400).json({ error: "invalid_request", error_description: "nonce is required" });
    return;
  }
  const pending = peekPendingAuth(nonce);
  if (!pending) {
    res.status(400).json({
      error: "invalid_request",
      error_description: "Invalid or expired session. Please start the authorization flow again.",
    });
    return;
  }

  let roleMeta: Awaited<ReturnType<typeof fetchRoleInfo>> = null;
  if (pending.roleId) {
    roleMeta = await fetchRoleInfo(pending.roleId);
  }

  const tokenOnly = !(await hasStaffUsersConfigured());
  let authStep: "choose" | "token" | "login" =
    method === "token" || method === "login" || method === "choose" ? method : "choose";
  if (tokenOnly) authStep = "token";

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(
    renderAuthorizePage({
      nonce,
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      authStep,
      tokenOnly,
      roleId: roleMeta?.roleId ?? pending.roleId,
      roleLabel: roleMeta?.label,
      roleDescription: roleMeta?.description,
      allowedTools: roleMeta?.allowedTools,
    }),
  );
});

app.post("/oauth/authorize", async (req, res) => {
  const { token, nonce } = req.body as Record<string, string>;

  if (!nonce) {
    res.status(400).json({ error: "invalid_request", error_description: "nonce is required" });
    return;
  }

  const pending = consumePendingAuth(nonce);
  if (!pending) {
    res.status(400).json({ error: "invalid_request", error_description: "Invalid or expired session. Please start the authorization flow again." });
    return;
  }

  const roleMeta = pending.roleId ? await fetchRoleInfo(pending.roleId) : null;
  const tokenOnly = !(await hasStaffUsersConfigured());

  async function reRender(error: string, authStep: "choose" | "token" | "login" = "token") {
    const freshNonce = createPendingAuth(
      pending!.clientId,
      pending!.redirectUri,
      pending!.state,
      pending!.roleId,
    );
    const step = tokenOnly ? "token" : authStep;
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(
      renderAuthorizePage({
        nonce: freshNonce,
        clientId: pending!.clientId,
        redirectUri: pending!.redirectUri,
        error,
        authStep: step,
        tokenOnly,
        roleId: roleMeta?.roleId ?? pending!.roleId,
        roleLabel: roleMeta?.label,
        roleDescription: roleMeta?.description,
        allowedTools: roleMeta?.allowedTools,
      }),
    );
  }

  if (!token || !token.trim()) {
    await reRender(
      tokenOnly ? "Please paste your connection token." : "Please paste your staff session token.",
      "token",
    );
    return;
  }

  const pasted = token.trim();

  // Weblify agentic connection token (printed by CLI for Claude.ai wizard)
  let connectionToken = process.env.WEBLIFY_CONNECTION_TOKEN?.trim() || "";
  if (!connectionToken) {
    try {
      const root = process.env.WEBLIFY_PROJECT_ROOT || process.cwd();
      const p = path.join(root, ".local", "connection-token");
      if (fs.existsSync(p)) connectionToken = fs.readFileSync(p, "utf-8").trim();
    } catch {
      /* ignore */
    }
  }
  if (connectionToken && pasted === connectionToken) {
    if (pending.roleId) {
      await reRender(
        "Role connectors need a CMS staff identity. Use GitHub sign-in or a staff session token.",
        "choose",
      );
      return;
    }
    updateClientStaffUser(pending.clientId, "Weblify", "Admin", "weblify-local");
    let redirectUrl: URL;
    try {
      redirectUrl = new URL(pending.redirectUri);
    } catch {
      res.status(400).json({
        error: "invalid_request",
        error_description: "redirect_uri is not a valid URL",
      });
      return;
    }
    const code = generateCode(pending.clientId, pending.redirectUri);
    redirectUrl.searchParams.set("code", code);
    if (pending.state) redirectUrl.searchParams.set("state", pending.state);
    res.redirect(redirectUrl.toString());
    return;
  }

  const validation = await validateStaffSessionToken(pasted);
  if (!validation.valid) {
    await reRender(
      validation.error || "Token validation failed. Please check your token and try again.",
      "token",
    );
    return;
  }

  if (pending.roleId && validation.username) {
    const ctx = await fetchRoleContext(validation.username, pending.roleId);
    if (!ctx.ok) {
      await reRender(
        ctx.error ||
          `You are not assigned the role '${pending.roleId}'. Ask an administrator to assign it before using this connector.`,
        "choose",
      );
      return;
    }
  }

  updateClientStaffUser(
    pending.clientId,
    validation.firstName ?? "",
    validation.lastName ?? "",
    validation.username,
  );

  let redirectUrl: URL;
  try {
    redirectUrl = new URL(pending.redirectUri);
  } catch {
    res.status(400).json({ error: "invalid_request", error_description: "redirect_uri is not a valid URL" });
    return;
  }

  const code = generateCode(pending.clientId, pending.redirectUri);
  redirectUrl.searchParams.set("code", code);
  if (pending.state) redirectUrl.searchParams.set("state", pending.state);

  res.redirect(redirectUrl.toString());
});

app.get("/oauth/staff-return", async (req, res) => {
  const { nonce, staff_session_code, staff_auth, message } = req.query as Record<
    string,
    string
  >;

  if (!nonce) {
    res.status(400).json({ error: "invalid_request", error_description: "nonce is required" });
    return;
  }

  const pending = peekPendingAuth(nonce);
  if (!pending) {
    res.status(400).json({
      error: "invalid_request",
      error_description: "Invalid or expired session. Please start the authorization flow again.",
    });
    return;
  }

  const roleMeta = pending.roleId ? await fetchRoleInfo(pending.roleId) : null;
  const tokenOnly = !(await hasStaffUsersConfigured());

  async function reRender(error: string) {
    const freshNonce = createPendingAuth(
      pending!.clientId,
      pending!.redirectUri,
      pending!.state,
      pending!.roleId,
    );
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(
      renderAuthorizePage({
        nonce: freshNonce,
        clientId: pending!.clientId,
        redirectUri: pending!.redirectUri,
        error,
        authStep: tokenOnly ? "token" : "choose",
        tokenOnly,
        roleId: roleMeta?.roleId ?? pending!.roleId,
        roleLabel: roleMeta?.label,
        roleDescription: roleMeta?.description,
        allowedTools: roleMeta?.allowedTools,
      }),
    );
  }

  if (staff_auth === "error") {
    await reRender(message || "GitHub sign-in failed");
    return;
  }

  if (!staff_session_code) {
    await reRender("Missing staff session after GitHub login");
    return;
  }

  const cmsBase = getCmsBase();
  let exchange: {
    valid?: boolean;
    token?: string;
    username?: string;
    userName?: string;
    error?: string;
  };
  try {
    const exchangeRes = await fetch(`${cmsBase}/api/staff/session/exchange`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: staff_session_code }),
    });
    exchange = (await exchangeRes.json()) as typeof exchange;
  } catch (err) {
    await reRender(`Could not reach CMS to finish login: ${(err as Error).message}`);
    return;
  }

  if (!exchange.valid || !exchange.token) {
    await reRender(exchange.error || "Staff session exchange failed");
    return;
  }

  const consumed = consumePendingAuth(nonce);
  if (!consumed) {
    await reRender("Invalid or expired session. Please start again.");
    return;
  }

  const validation = await validateStaffSessionToken(exchange.token);
  if (!validation.valid || !validation.username) {
    await reRender(validation.error || "Staff session invalid");
    return;
  }

  if (consumed.roleId) {
    const ctx = await fetchRoleContext(validation.username, consumed.roleId);
    if (!ctx.ok) {
      await reRender(
        ctx.error ||
          `You are not assigned the role '${consumed.roleId}'. Ask an administrator to assign it.`,
      );
      return;
    }
  }

  updateClientStaffUser(
    consumed.clientId,
    validation.firstName ?? "",
    validation.lastName ?? "",
    validation.username,
  );
  registerStaffSessionToken(exchange.token, validation.username);

  let redirectUrl: URL;
  try {
    redirectUrl = new URL(consumed.redirectUri);
  } catch {
    res.status(400).json({ error: "invalid_request", error_description: "redirect_uri is not a valid URL" });
    return;
  }

  const code = generateCode(consumed.clientId, consumed.redirectUri);
  redirectUrl.searchParams.set("code", code);
  if (consumed.state) redirectUrl.searchParams.set("state", consumed.state);
  res.redirect(redirectUrl.toString());
});

app.get("/oauth/callback", async (req, res) => {
  const { token, nonce } = req.query as Record<string, string>;

  if (!nonce) {
    res.status(400).json({ error: "invalid_request", error_description: "nonce is required" });
    return;
  }

  const pending = consumePendingAuth(nonce);
  if (!pending) {
    res.status(400).json({ error: "invalid_request", error_description: "Invalid or expired session" });
    return;
  }

  let redirectUrl: URL;
  try {
    redirectUrl = new URL(pending.redirectUri);
  } catch {
    res.status(400).json({ error: "invalid_request", error_description: "redirect_uri is not a valid URL" });
    return;
  }

  if (!token || !token.trim()) {
    redirectUrl.searchParams.set("error", "access_denied");
    res.redirect(redirectUrl.toString());
    return;
  }

  const validation = await validateStaffSessionToken(token.trim());
  if (!validation.valid) {
    console.warn("[MCP] OAuth callback: token validation failed —", validation.error);
    redirectUrl.searchParams.set("error", "access_denied");
    res.redirect(redirectUrl.toString());
    return;
  }

  if (pending.roleId && validation.username) {
    const ctx = await fetchRoleContext(validation.username, pending.roleId);
    if (!ctx.ok) {
      console.warn("[MCP] OAuth callback: role membership failed —", ctx.error);
      redirectUrl.searchParams.set("error", "access_denied");
      res.redirect(redirectUrl.toString());
      return;
    }
  }

  updateClientStaffUser(
    pending.clientId,
    validation.firstName ?? "",
    validation.lastName ?? "",
    validation.username,
  );

  const code = generateCode(pending.clientId, pending.redirectUri);
  redirectUrl.searchParams.set("code", code);
  if (pending.state) redirectUrl.searchParams.set("state", pending.state);

  res.redirect(redirectUrl.toString());
});

app.post("/oauth/token", (req, res) => {
  const { grant_type, client_id, client_secret, code, redirect_uri } =
    req.body as Record<string, string>;

  if (grant_type !== "authorization_code") {
    res.status(400).json({ error: "unsupported_grant_type" });
    return;
  }
  if (!client_id || !client_secret || !code || !redirect_uri) {
    res.status(400).json({ error: "invalid_request" });
    return;
  }

  const token = exchangeCode(
    code,
    client_id,
    client_secret,
    redirect_uri,
    STATIC_CLIENT_ID,
    STATIC_CLIENT_SECRET,
  );
  if (!token) {
    res.status(400).json({ error: "invalid_grant" });
    return;
  }

  const expiresAt = Date.now() + TOKEN_EXPIRES_IN * 1000;
  res.json({
    access_token: token,
    token_type: "bearer",
    expires_in: TOKEN_EXPIRES_IN,
    expires_at: Math.floor(expiresAt / 1000),
  });
});

// ─── MCP endpoint ─────────────────────────────────────────────────────────────

/** Machine line for Weblify CLI — first successful authenticated `initialize`. */
const WEBLIFY_MCP_CONNECTED_MARKER = "WEBLIFY_MCP_CONNECTED";
let connectedAnnounced = false;

function isInitializeRpcBody(body: unknown): boolean {
  if (body == null || typeof body !== "object") return false;
  if (Array.isArray(body)) {
    return body.some(
      (item) =>
        item != null &&
        typeof item === "object" &&
        (item as { method?: string }).method === "initialize",
    );
  }
  return (body as { method?: string }).method === "initialize";
}

/** Emit once when an authenticated initialize completes with 2xx (CLI watches stdout). */
function maybeAnnounceMcpConnected(res: express.Response, body: unknown): void {
  if (connectedAnnounced || !isInitializeRpcBody(body)) return;
  res.on("finish", () => {
    if (connectedAnnounced) return;
    const code = res.statusCode || 0;
    if (code >= 200 && code < 300) {
      connectedAnnounced = true;
      process.stdout.write(`${WEBLIFY_MCP_CONNECTED_MARKER}\n`);
    }
  });
}

async function handleMcpRequest(
  req: express.Request,
  res: express.Response,
  activeRoleId?: string,
): Promise<void> {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  const authHeader = (req.headers["authorization"] as string | undefined) || "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  const apiKeyToken = (req.headers["x-api-key"] as string | undefined) || "";
  const credentialToken = bearerToken || apiKeyToken;
  const resolvedUsername = credentialToken
    ? getTokenUsername(credentialToken) ?? undefined
    : undefined;

  if (activeRoleId) {
    if (!resolvedUsername) {
      res.status(401).json({
        error: "Unauthorized. Complete OAuth before using a role-scoped MCP connector.",
        auth: "oauth",
        authorize_hint: `/oauth/authorize?mcp_role=${encodeURIComponent(activeRoleId)}`,
        mcp_role: activeRoleId,
      });
      return;
    }
    const ctx = await fetchRoleContext(resolvedUsername, activeRoleId);
    if (!ctx.ok) {
      res.status(ctx.status === 404 ? 404 : 403).json({
        error: ctx.error,
        mcp_role: activeRoleId,
      });
      return;
    }

    await runInMcpSession({ roleId: activeRoleId }, async () => {
      const mcp = await createMcpServer(resolvedUsername, credentialToken || undefined, {
        filterCatalog: true,
        activeRoleId,
        roleLabel: ctx.data.label,
        roleDescription: ctx.data.description,
        roleGrants: ctx.data.capabilities,
      });
      try {
        maybeAnnounceMcpConnected(res, req.body);
        await mcp.connect(transport);
        await transport.handleRequest(req, res, req.body);
        res.on("finish", () => mcp.close());
      } catch (err) {
        console.error("[MCP] Request error:", err);
        if (!res.headersSent) {
          res.status(500).json({ error: "Internal server error" });
        }
      }
    });
    return;
  }

  const mcp = await createMcpServer(resolvedUsername, credentialToken || undefined, {
    filterCatalog: process.env.NODE_ENV === "production",
  });
  try {
    maybeAnnounceMcpConnected(res, req.body);
    await mcp.connect(transport);
    await transport.handleRequest(req, res, req.body);
    res.on("finish", () => mcp.close());
  } catch (err) {
    console.error("[MCP] Request error:", err);
    if (!res.headersSent) {
      res.status(500).json({ error: "Internal server error" });
    }
  }
}

app.all("/mcp", authMiddleware, async (req, res) => {
  await handleMcpRequest(req, res);
});

app.all("/mcp/role/:roleId", authMiddleware, async (req, res) => {
  const roleId = resolveMcpRoleId(String(req.params.roleId || "").toLowerCase());
  if (!isValidRoleId(roleId)) {
    res.status(404).json({ error: `Invalid or unknown role id '${req.params.roleId}'` });
    return;
  }
  await handleMcpRequest(req, res, roleId);
});

// ─── Start ────────────────────────────────────────────────────────────────────

let shuttingDown = false;

async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[MCP] ${signal} received — flushing GCS auth writes…`);
  await flushGcsWrites();
  process.exit(0);
}

process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});
process.on("SIGINT", () => {
  void shutdown("SIGINT");
});

async function startServer(): Promise<void> {
  try {
    await initGcsStore();
  } catch (err) {
    console.error("[MCP] GCS store init failed —", (err as Error).message);
  }
  warnMcpBucketParity();

  app.listen(PORT, "127.0.0.1", () => {
    console.log(`[MCP] Content-pages MCP server running on port ${PORT}`);
    console.log(`[MCP] Endpoint: http://127.0.0.1:${PORT}/mcp`);
    console.log(`[MCP] Auth: OAuth 2.0 via CMS staff session (GitHub login or paste)`);
    console.log(`[MCP] OAuth: http://127.0.0.1:${PORT}/oauth/authorize`);
    console.log(
      `[MCP] OAuth registration: http://127.0.0.1:${PORT}/oauth/register`,
    );
    console.log(`[MCP] Health: http://0.0.0.0:${PORT}/health`);
    console.log(
      `[MCP] GCS auth persistence: ${getGcsAuthPersistenceHealth()}`,
    );
  });
}

void startServer();
