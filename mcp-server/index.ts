import "dotenv/config";
import express from "express";
import cors from "cors";
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
import {
  registerClient,
  lookupClient,
  generateCode,
  exchangeCode,
  validateToken,
  getTokenUsername,
  createPendingAuth,
  consumePendingAuth,
  validateBreathecodeToken,
  updateClientBreathecodeUser,
  registerBreathecodeToken,
  getCachedBreathecodeUsername,
  initGcsStore,
  flushGcsWrites,
  getGcsAuthPersistenceHealth,
  TOKEN_EXPIRES_IN,
} from "./lib/oauth.js";
import { warnMcpBucketParity } from "./lib/bucket-parity.js";
import { fetchCallerGrants } from "./lib/auth.js";
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

function renderAuthorizePage(opts: {
  nonce: string;
  clientId: string;
  redirectUri: string;
  error?: string;
}): string {
  const base = getBase();
  const breathecodeLoginUrl = `https://breathecode.herokuapp.com/v1/auth/view/login?url=${encodeURIComponent(
    `${base}/oauth/callback?nonce=${opts.nonce}`,
  )}`;

  const errorHtml = opts.error
    ? `<div class="error">${escapeHtml(opts.error)}</div>`
    : "";

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Authorize MCP Access</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { font-family: system-ui, sans-serif; max-width: 480px; margin: 80px auto; padding: 0 1rem; color: #1a1a1a; }
    h1 { font-size: 1.4rem; margin-bottom: 0.4rem; }
    .subtitle { color: #555; margin-bottom: 1.5rem; font-size: 0.95rem; }
    .card { border: 1px solid #e0e0e0; border-radius: 8px; padding: 1.5rem; background: #fafafa; margin-bottom: 1rem; }
    .card h2 { font-size: 1rem; margin: 0 0 0.75rem; }
    label { display: block; font-size: 0.9rem; color: #444; margin-bottom: 0.3rem; }
    input[type="text"] {
      width: 100%; padding: 0.5rem 0.7rem; border: 1px solid #ccc; border-radius: 6px;
      font-size: 0.95rem; margin-bottom: 0.75rem; font-family: monospace;
    }
    input[type="text"]:focus { outline: none; border-color: #5046e5; box-shadow: 0 0 0 2px rgba(80,70,229,0.15); }
    button {
      background: #5046e5; color: #fff; border: none; border-radius: 6px;
      padding: 0.6rem 1.4rem; font-size: 1rem; cursor: pointer;
    }
    button:hover { background: #3d35c4; }
    .divider { text-align: center; color: #aaa; font-size: 0.85rem; margin: 0.25rem 0; }
    .login-link {
      display: block; text-align: center; background: #f0f0f0; border: 1px solid #ddd;
      border-radius: 6px; padding: 0.65rem 1.4rem; font-size: 0.95rem; color: #1a1a1a;
      text-decoration: none; font-weight: 500;
    }
    .login-link:hover { background: #e4e4e4; }
    .error { background: #fff0f0; border: 1px solid #f5c6c6; color: #c0392b; border-radius: 6px; padding: 0.65rem 1rem; margin-bottom: 1rem; font-size: 0.9rem; }
    .cancel { display: block; text-align: center; margin-top: 0.75rem; color: #888; font-size: 0.85rem; text-decoration: none; }
    .cancel:hover { color: #555; }
  </style>
</head>
<body>
  <h1>Authorize MCP Access</h1>
  <p class="subtitle">Verify your Breathecode identity to grant MCP server access.</p>
  ${errorHtml}
  <div class="card">
    <h2>Option 1 — Paste your Breathecode token</h2>
    <form method="POST" action="/oauth/authorize">
      <input type="hidden" name="nonce" value="${escapeHtml(opts.nonce)}">
      <label for="token">Breathecode API token</label>
      <input type="text" id="token" name="token" placeholder="Paste your token here" autocomplete="off" required>
      <button type="submit">Verify &amp; Authorize</button>
    </form>
  </div>
  <div class="divider">or</div>
  <div class="card">
    <h2>Option 2 — Log in with Breathecode</h2>
    <a class="login-link" href="${escapeHtml(breathecodeLoginUrl)}">Log in on Breathecode</a>
  </div>
  <a class="cancel" href="${escapeHtml(opts.redirectUri)}?error=access_denied">Cancel</a>
</body>
</html>`;
}

// ─── MCP server factory ───────────────────────────────────────────────────────

async function createMcpServer(
  mcpAuthor?: string,
  mcpToken?: string,
  opts?: { filterCatalog?: boolean },
): Promise<McpServer> {
  const mcp = new McpServer({ name: "content-pages", version: "1.0.0" });
  let grants: CatalogGrant[] | undefined;
  let allowed: Set<string> | null = null;

  if (opts?.filterCatalog && mcpToken) {
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
  registerUserTools(mcp, mcpToken, grants);
  registerExplainTools(mcp, mcpToken, grants);
  registerEcommerceTools(mcp, mcpToken, grants);
  registerDatabaseTools(mcp, mcpToken);
  registerRedirectTools(mcp, mcpToken);
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

  // Path 1: valid OAuth access token (issued by this server's /oauth/token endpoint)
  if (bearerToken && validateToken(bearerToken)) {
    next();
    return;
  }

  // Path 2: Breathecode token presented via Authorization: Bearer or X-Api-Key.
  // Validate it against the main app's /api/debug/validate-token endpoint (which
  // proxies Breathecode and enforces that the user has at least one CMS capability).
  // The static SERVER_SECRET is intentionally NOT accepted here — it is an internal
  // credential for outbound loopback calls only, never for inbound callers.
  const candidate = bearerToken || apiKeyHeader || "";
  if (candidate) {
    // Fast path: check the 23hr in-memory/GCS-backed cache before hitting the network.
    const cachedUsername = getCachedBreathecodeUsername(candidate);
    if (cachedUsername) {
      console.log(`[MCP] OAuth: using cached Breathecode token for ${cachedUsername}`);
      next();
      return;
    }

    const validation = await validateBreathecodeToken(candidate);
    if (validation.valid && validation.username) {
      // Register this token in the in-memory lookup (with 23hr TTL) so
      // getTokenUsername() works in checkCap() and the /mcp handler, and
      // so subsequent requests hit the cache instead of the network.
      registerBreathecodeToken(candidate, validation.username);
      next();
      return;
    }
    const errMsg = validation.error || "Breathecode token validation failed.";
    res.status(401).json({ error: `Unauthorized. ${errMsg}` });
    return;
  }

  res.status(401).json({
    error:
      "Unauthorized. This is an MCP endpoint — connect via an MCP client (Cursor, Claude, etc.) that completes the OAuth flow. Do not open /mcp directly in a browser.",
    auth: "oauth",
    authorize_hint: "/oauth/authorize",
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

app.get("/oauth/authorize", (req, res) => {
  const { client_id, redirect_uri, response_type, state } = req.query as Record<
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

  const nonce = createPendingAuth(client_id, redirect_uri, state);

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.send(renderAuthorizePage({ nonce, clientId: client_id, redirectUri: redirect_uri }));
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

  if (!token || !token.trim()) {
    const freshNonce = createPendingAuth(pending.clientId, pending.redirectUri, pending.state);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderAuthorizePage({
      nonce: freshNonce,
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      error: "Please paste your Breathecode token.",
    }));
    return;
  }

  const validation = await validateBreathecodeToken(token.trim());
  if (!validation.valid) {
    const freshNonce = createPendingAuth(pending.clientId, pending.redirectUri, pending.state);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(renderAuthorizePage({
      nonce: freshNonce,
      clientId: pending.clientId,
      redirectUri: pending.redirectUri,
      error: validation.error || "Token validation failed. Please check your token and try again.",
    }));
    return;
  }

  updateClientBreathecodeUser(
    pending.clientId,
    validation.userId ?? 0,
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

  const validation = await validateBreathecodeToken(token.trim());
  if (!validation.valid) {
    console.warn("[MCP] OAuth callback: token validation failed —", validation.error);
    redirectUrl.searchParams.set("error", "access_denied");
    res.redirect(redirectUrl.toString());
    return;
  }

  updateClientBreathecodeUser(
    pending.clientId,
    validation.userId ?? 0,
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

app.all("/mcp", authMiddleware, async (req, res) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
  });
  // Derive the authenticated Breathecode username from the bearer token or x-api-key.
  // authMiddleware has already validated the credential and registered Breathecode
  // direct tokens via registerBreathecodeToken(), so getTokenUsername() works for both
  // OAuth access tokens and Breathecode tokens regardless of which header was used.
  // Falls back to undefined (tools will label commits as "mcp-agent [MCP]").
  const authHeader = (req.headers["authorization"] as string | undefined) || "";
  const bearerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  const apiKeyToken = (req.headers["x-api-key"] as string | undefined) || "";
  const credentialToken = bearerToken || apiKeyToken;
  const resolvedUsername = credentialToken ? getTokenUsername(credentialToken) ?? undefined : undefined;
  const mcp = await createMcpServer(resolvedUsername, credentialToken || undefined, {
    filterCatalog: process.env.NODE_ENV === "production",
  });
  try {
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
    console.log(`[MCP] Auth: OAuth 2.0 (primary); legacy Breathecode token header still accepted`);
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
