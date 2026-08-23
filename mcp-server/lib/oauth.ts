import crypto from "crypto";
import fs from "fs";
import path from "path";
import { encryptedWrite, encryptedRead, isGcsAvailable } from "./gcs-store.js";

const CODE_TTL_MS = 5 * 60 * 1000;
const PENDING_TTL_MS = 10 * 60 * 1000;
const TOKEN_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year
const BC_CACHE_TTL_MS = 23 * 60 * 60 * 1000; // 23 hours
const GCS_DEBOUNCE_MS = 2_000;

const CLIENTS_FILE = path.join(process.cwd(), "mcp-server/data/oauth-clients.json");
const TOKENS_FILE = path.join(process.cwd(), "mcp-server/data/oauth-tokens.json");
const BREATHECODE_TOKENS_FILE = path.join(process.cwd(), "mcp-server/data/breathecode-tokens.json");

const GCS_CLIENTS_FILE = "clients.enc";
const GCS_TOKENS_FILE = "tokens.enc";
const GCS_BC_CACHE_FILE = "bc-cache.enc";

// ─── Registered clients (persisted to JSON + GCS) ─────────────────────────────

export interface RegisteredClient {
  clientSecret: string;
  redirectUris: string[];
  clientName: string;
  registeredAt: string;
  breathecodeUserId?: number;
  breathecodeFirstName?: string;
  breathecodeLastName?: string;
  breathecodeUsername?: string;
}

const clients = new Map<string, RegisteredClient>();

function loadClients(): void {
  try {
    if (!fs.existsSync(CLIENTS_FILE)) return;
    const raw = fs.readFileSync(CLIENTS_FILE, "utf-8");
    const obj = JSON.parse(raw) as Record<string, RegisteredClient>;
    for (const [id, client] of Object.entries(obj)) {
      clients.set(id, client);
    }
    console.log(`[MCP] OAuth: loaded ${clients.size} registered client(s) from disk`);
  } catch (err) {
    console.warn("[MCP] OAuth: could not load oauth-clients.json —", (err as Error).message);
  }
}

// Debounce handles for GCS writes
const _gcsDebounceHandles: Record<string, ReturnType<typeof setTimeout>> = {};
const _latestGcsPayloads: Record<string, () => string> = {};

function scheduleGcsWrite(filename: string, getPayload: () => string): void {
  _latestGcsPayloads[filename] = getPayload;
  if (_gcsDebounceHandles[filename]) clearTimeout(_gcsDebounceHandles[filename]);
  _gcsDebounceHandles[filename] = setTimeout(() => {
    delete _gcsDebounceHandles[filename];
    delete _latestGcsPayloads[filename];
    encryptedWrite(filename, getPayload()).catch((err) => {
      console.error(`[MCP] OAuth: GCS debounced write failed for "${filename}" —`, (err as Error).message);
    });
  }, GCS_DEBOUNCE_MS);
}

/** Flush pending debounced GCS writes (call on SIGTERM before exit). */
export async function flushGcsWrites(): Promise<void> {
  const filenames = new Set([
    ...Object.keys(_gcsDebounceHandles),
    ...Object.keys(_latestGcsPayloads),
  ]);
  const writes: Promise<void>[] = [];
  for (const filename of filenames) {
    if (_gcsDebounceHandles[filename]) {
      clearTimeout(_gcsDebounceHandles[filename]);
      delete _gcsDebounceHandles[filename];
    }
    const getPayload = _latestGcsPayloads[filename];
    delete _latestGcsPayloads[filename];
    if (getPayload) {
      writes.push(
        encryptedWrite(filename, getPayload()).catch((err) => {
          console.error(
            `[MCP] OAuth: flush GCS write failed for "${filename}" —`,
            (err as Error).message,
          );
        }),
      );
    }
  }
  await Promise.all(writes);
}

function persistClients(): void {
  try {
    const dir = path.dirname(CLIENTS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const obj: Record<string, RegisteredClient> = {};
    for (const [id, client] of clients.entries()) {
      obj[id] = client;
    }
    const payload = JSON.stringify(obj, null, 2);
    fs.writeFileSync(CLIENTS_FILE, payload, "utf-8");
    scheduleGcsWrite(GCS_CLIENTS_FILE, () => payload);
  } catch (err) {
    console.error("[MCP] OAuth: failed to persist oauth-clients.json —", (err as Error).message);
  }
}

function ensureDataDir(): void {
  try {
    const dir = path.dirname(CLIENTS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    if (!fs.existsSync(CLIENTS_FILE)) {
      fs.writeFileSync(CLIENTS_FILE, "{}\n", "utf-8");
    }
    if (!fs.existsSync(TOKENS_FILE)) {
      fs.writeFileSync(TOKENS_FILE, "{}\n", "utf-8");
    }
    if (!fs.existsSync(BREATHECODE_TOKENS_FILE)) {
      fs.writeFileSync(BREATHECODE_TOKENS_FILE, "{}\n", "utf-8");
    }
  } catch (err) {
    console.warn("[MCP] OAuth: could not create data files —", (err as Error).message);
  }
}

ensureDataDir();
loadClients();

export function registerClient(
  clientName: string,
  redirectUris: string[],
): { clientId: string; clientSecret: string } {
  const clientId = crypto.randomBytes(16).toString("hex");
  const clientSecret = crypto.randomBytes(32).toString("hex");
  clients.set(clientId, {
    clientSecret,
    redirectUris,
    clientName: clientName || "Unknown client",
    registeredAt: new Date().toISOString(),
  });
  persistClients();
  return { clientId, clientSecret };
}

export function lookupClient(clientId: string): RegisteredClient | null {
  return clients.get(clientId) ?? null;
}

export function updateClientBreathecodeUser(
  clientId: string,
  userId: number,
  firstName: string,
  lastName: string,
  username?: string,
): void {
  const client = clients.get(clientId);
  if (!client) return;
  client.breathecodeUserId = userId;
  client.breathecodeFirstName = firstName;
  client.breathecodeLastName = lastName;
  if (username) client.breathecodeUsername = username;
  persistClients();
}

// ─── Pending auth store (in-memory, nonce-keyed) ──────────────────────────────

interface PendingAuth {
  clientId: string;
  redirectUri: string;
  state?: string;
  expiresAt: number;
}

const pendingAuths = new Map<string, PendingAuth>();

function purgeExpiredPendingAuths(): void {
  const now = Date.now();
  for (const [nonce, entry] of pendingAuths.entries()) {
    if (entry.expiresAt < now) pendingAuths.delete(nonce);
  }
}

export function createPendingAuth(
  clientId: string,
  redirectUri: string,
  state?: string,
): string {
  purgeExpiredPendingAuths();
  const nonce = crypto.randomBytes(24).toString("hex");
  pendingAuths.set(nonce, {
    clientId,
    redirectUri,
    state,
    expiresAt: Date.now() + PENDING_TTL_MS,
  });
  return nonce;
}

export function consumePendingAuth(nonce: string): PendingAuth | null {
  const entry = pendingAuths.get(nonce);
  if (!entry) return null;
  pendingAuths.delete(nonce);
  if (entry.expiresAt < Date.now()) return null;
  return entry;
}

// ─── Breathecode token validation (via main app's centralized UserManager) ─────

export interface BreathecodeValidationResult {
  valid: boolean;
  userId?: number;
  firstName?: string;
  lastName?: string;
  username?: string;
  error?: string;
}

/**
 * Validate a Breathecode token by calling the main CMS app's validate-token endpoint.
 * This ensures MCP OAuth uses the same UserManager/UserStore as the CMS,
 * including first-user-webmaster bootstrap and role assignment.
 */
export async function validateBreathecodeToken(
  token: string,
): Promise<BreathecodeValidationResult> {
  const mainAppPort = process.env.PORT || "5000";
  const mainAppUrl = `http://localhost:${mainAppPort}/api/debug/validate-token`;

  try {
    const res = await fetch(mainAppUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    });

    if (!res.ok) {
      return { valid: false, error: `Main app validation error (HTTP ${res.status})` };
    }

    const data = (await res.json()) as {
      valid: boolean;
      userName?: string;
      username?: string;
      expiresAt?: string;
      capabilities?: unknown[];
      error?: string;
    };

    if (!data.valid) {
      return { valid: false, error: data.error || "Token is not valid or lacks required permissions" };
    }

    // Enforce that the user has at least one internal platform capability.
    // A valid Breathecode identity alone is not sufficient — the user must be
    // assigned a role in the CMS before MCP OAuth grants them an access token.
    if (!Array.isArray(data.capabilities) || data.capabilities.length === 0) {
      return {
        valid: false,
        error: "Your account does not have platform write access. Contact an administrator to be assigned a role.",
      };
    }

    // The main app returns userName (display) and username (breathecode slug)
    const username = data.username || data.userName || "";
    return {
      valid: true,
      username,
      // Attempt to split userName for backward-compat fields (firstName.lastName format)
      firstName: username.split(".")[0] || "",
      lastName: username.split(".").slice(1).join(".") || "",
    };
  } catch (err) {
    // Main app is unreachable — fail closed to keep authorization internal-only.
    // Do not fall back to direct Breathecode capability checks; instead deny access.
    console.warn("[MCP] Main app unreachable for token validation, denying MCP access —", (err as Error).message);
    return { valid: false, error: "Authorization service unavailable; cannot verify credentials" };
  }
}

// ─── Breathecode direct-token registry ───────────────────────────────────────
// Maps a raw Breathecode token → { username, expiresAt } with 23hr TTL.
// Populated by authMiddleware after a successful validateBreathecodeToken call so
// that getTokenUsername() works transparently for both OAuth and direct callers.
// Expired entries are skipped on load and evicted on access.

interface BreathecodeTokenEntry {
  username: string;
  expiresAt: number;
}

const breathecodeTokenUsernames = new Map<string, BreathecodeTokenEntry>();
loadBreathecodeTokens();

function loadBreathecodeTokens(): void {
  try {
    if (!fs.existsSync(BREATHECODE_TOKENS_FILE)) return;
    const raw = fs.readFileSync(BREATHECODE_TOKENS_FILE, "utf-8");
    const now = Date.now();
    let loaded = 0;
    let expired = 0;

    // Support both old shape (Record<string, string>) and new shape (Record<string, BreathecodeTokenEntry>)
    const obj = JSON.parse(raw) as Record<string, string | BreathecodeTokenEntry>;
    for (const [token, value] of Object.entries(obj)) {
      if (typeof value === "string") {
        // Migrate legacy format: treat as already-expired so re-validation happens once
        expired++;
        continue;
      }
      if (value.expiresAt < now) {
        expired++;
        continue;
      }
      breathecodeTokenUsernames.set(token, value);
      loaded++;
    }
    console.log(`[MCP] OAuth: loaded ${loaded} Breathecode token(s) from disk (${expired} expired/legacy, skipped)`);
  } catch (err) {
    console.warn("[MCP] OAuth: could not load breathecode-tokens.json —", (err as Error).message);
  }
}

function buildBcCachePayload(): string {
  const obj: Record<string, BreathecodeTokenEntry> = {};
  for (const [token, entry] of breathecodeTokenUsernames.entries()) {
    obj[token] = entry;
  }
  return JSON.stringify(obj, null, 2);
}

function persistBreathecodeTokens(): void {
  try {
    const payload = buildBcCachePayload();
    fs.writeFileSync(BREATHECODE_TOKENS_FILE, payload, "utf-8");
    scheduleGcsWrite(GCS_BC_CACHE_FILE, buildBcCachePayload);
  } catch (err) {
    console.error("[MCP] OAuth: failed to persist breathecode-tokens.json —", (err as Error).message);
  }
}

export function registerBreathecodeToken(token: string, username: string): void {
  const expiresAt = Date.now() + BC_CACHE_TTL_MS;
  breathecodeTokenUsernames.set(token, { username, expiresAt });
  persistBreathecodeTokens();
}

/**
 * Return the cached Breathecode username for a token if the cache entry is still valid.
 * Returns null on a cache miss or if the entry has expired (expired entries are evicted).
 */
export function getCachedBreathecodeUsername(token: string): string | null {
  const entry = breathecodeTokenUsernames.get(token);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    breathecodeTokenUsernames.delete(token);
    return null;
  }
  return entry.username;
}

// ─── Auth codes (in-memory only) ─────────────────────────────────────────────

interface AuthCode {
  clientId: string;
  redirectUri: string;
  expiresAt: number;
}

interface StoredAccessToken {
  clientId: string;
  expiresAt: number;
}

const authCodes = new Map<string, AuthCode>();
// Maps access token → { clientId, expiresAt } so we can look up Breathecode user info
// and enforce expiry after restart.
const accessTokens = new Map<string, StoredAccessToken>();
loadTokens();

function loadTokens(): void {
  try {
    if (!fs.existsSync(TOKENS_FILE)) return;
    const raw = fs.readFileSync(TOKENS_FILE, "utf-8");
    const obj = JSON.parse(raw) as Record<string, StoredAccessToken>;
    const now = Date.now();
    let loaded = 0;
    let expired = 0;
    for (const [token, data] of Object.entries(obj)) {
      if (data.expiresAt && data.expiresAt < now) {
        expired++;
        continue;
      }
      accessTokens.set(token, data);
      loaded++;
    }
    console.log(`[MCP] OAuth: loaded ${loaded} access token(s) from disk (${expired} expired, skipped)`);
  } catch (err) {
    console.warn("[MCP] OAuth: could not load oauth-tokens.json —", (err as Error).message);
  }
}

function buildTokensPayload(): string {
  const obj: Record<string, StoredAccessToken> = {};
  for (const [token, data] of accessTokens.entries()) {
    obj[token] = data;
  }
  return JSON.stringify(obj, null, 2);
}

function persistTokens(): void {
  try {
    const payload = buildTokensPayload();
    fs.writeFileSync(TOKENS_FILE, payload, "utf-8");
    scheduleGcsWrite(GCS_TOKENS_FILE, buildTokensPayload);
  } catch (err) {
    console.error("[MCP] OAuth: failed to persist oauth-tokens.json —", (err as Error).message);
  }
}

function purgeExpiredCodes(): void {
  const now = Date.now();
  for (const [code, entry] of authCodes.entries()) {
    if (entry.expiresAt < now) authCodes.delete(code);
  }
}

export function generateCode(clientId: string, redirectUri: string): string {
  purgeExpiredCodes();
  const code = crypto.randomBytes(32).toString("hex");
  authCodes.set(code, { clientId, redirectUri, expiresAt: Date.now() + CODE_TTL_MS });
  return code;
}

export function exchangeCode(
  code: string,
  clientId: string,
  clientSecret: string,
  redirectUri: string,
  staticClientId?: string,
  staticClientSecret?: string,
): string | null {
  const entry = authCodes.get(code);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    authCodes.delete(code);
    return null;
  }
  if (entry.clientId !== clientId || entry.redirectUri !== redirectUri) return null;

  const registered = clients.get(clientId);
  if (registered) {
    if (registered.clientSecret !== clientSecret) return null;
  } else if (staticClientId && staticClientSecret) {
    if (clientId !== staticClientId || clientSecret !== staticClientSecret) return null;
  } else {
    return null;
  }

  authCodes.delete(code);
  const token = crypto.randomBytes(48).toString("hex");
  const expiresAt = Date.now() + TOKEN_TTL_MS;
  accessTokens.set(token, { clientId, expiresAt });
  persistTokens();
  return token;
}

export const TOKEN_EXPIRES_IN = Math.floor(TOKEN_TTL_MS / 1000); // seconds

export function validateToken(token: string): boolean {
  const entry = accessTokens.get(token);
  if (!entry) return false;
  if (entry.expiresAt < Date.now()) {
    accessTokens.delete(token);
    persistTokens();
    return false;
  }
  return true;
}

/**
 * Look up which client issued the given access token.
 * Returns the client's Breathecode username (slug), falling back to
 * "firstname.lastname" if the slug is not stored.
 * Returns null if the token is unknown or no user is attached.
 */
export function getTokenUsername(token: string): string | null {
  // Check OAuth access-token registry first
  const entry = accessTokens.get(token);
  if (entry) {
    const client = clients.get(entry.clientId);
    if (client) {
      if (client.breathecodeUsername) return client.breathecodeUsername;
      const first = client.breathecodeFirstName?.trim() || "";
      const last = client.breathecodeLastName?.trim() || "";
      if (first || last) return [first, last].filter(Boolean).join(".").toLowerCase();
    }
  }
  // Fall back to Breathecode direct-token cache
  return getCachedBreathecodeUsername(token);
}

/**
 * OAuth client display name for the token (e.g. "Cursor").
 * Returns null when the token is unknown or not from a registered OAuth client.
 */
export function getTokenClientName(token: string): string | null {
  const entry = accessTokens.get(token);
  if (!entry) return null;
  const client = clients.get(entry.clientId);
  if (!client?.clientName) return null;
  const name = client.clientName.trim();
  return name || null;
}

// ─── GCS bootstrap (called once at startup) ───────────────────────────────────

export type GcsAuthPersistenceHealth = "ok" | "warn" | "error" | "disabled";

let gcsInitCompleted = false;
let gcsInitError: string | null = null;

/**
 * Download and merge GCS-backed token data into the in-memory maps.
 * Called once after the local files have already been loaded so GCS data
 * (written by the previous container) overrides stale local state.
 * Safe to call even if GCS is unavailable — logs a warning and returns.
 */
export async function initGcsStore(): Promise<void> {
  gcsInitError = null;
  try {
    const [clientsJson, tokensJson, bcJson] = await Promise.all([
      encryptedRead(GCS_CLIENTS_FILE),
      encryptedRead(GCS_TOKENS_FILE),
      encryptedRead(GCS_BC_CACHE_FILE),
    ]);

    // --- clients ---
    if (clientsJson) {
      try {
        const obj = JSON.parse(clientsJson) as Record<string, RegisteredClient>;
        let merged = 0;
        for (const [id, client] of Object.entries(obj)) {
          clients.set(id, client);
          merged++;
        }
        console.log(`[MCP] OAuth: merged ${merged} registered client(s) from GCS`);
      } catch (err) {
        console.warn("[MCP] OAuth: could not parse GCS clients blob —", (err as Error).message);
      }
    }

    // --- access tokens ---
    if (tokensJson) {
      try {
        const obj = JSON.parse(tokensJson) as Record<string, StoredAccessToken>;
        const now = Date.now();
        let loaded = 0;
        let expired = 0;
        for (const [token, data] of Object.entries(obj)) {
          if (data.expiresAt && data.expiresAt < now) {
            expired++;
            continue;
          }
          accessTokens.set(token, data);
          loaded++;
        }
        console.log(`[MCP] OAuth: merged ${loaded} access token(s) from GCS (${expired} expired, skipped)`);
      } catch (err) {
        console.warn("[MCP] OAuth: could not parse GCS tokens blob —", (err as Error).message);
      }
    }

    // --- breathecode cache ---
    if (bcJson) {
      try {
        const obj = JSON.parse(bcJson) as Record<string, BreathecodeTokenEntry>;
        const now = Date.now();
        let loaded = 0;
        let expired = 0;
        for (const [token, entry] of Object.entries(obj)) {
          if (entry.expiresAt < now) {
            expired++;
            continue;
          }
          breathecodeTokenUsernames.set(token, entry);
          loaded++;
        }
        console.log(`[MCP] OAuth: merged ${loaded} Breathecode token(s) from GCS (${expired} expired, skipped)`);
      } catch (err) {
        console.warn("[MCP] OAuth: could not parse GCS Breathecode cache blob —", (err as Error).message);
      }
    }
    gcsInitCompleted = true;
  } catch (err) {
    gcsInitError = (err as Error).message;
    throw err;
  }
}

export function getGcsAuthPersistenceHealth(): GcsAuthPersistenceHealth {
  const envBucket = process.env.GCS_BUCKET_NAME?.trim();
  if (!envBucket) return "disabled";
  if (!isGcsAvailable()) return "error";
  if (gcsInitError) return "warn";
  return gcsInitCompleted ? "ok" : "warn";
}
