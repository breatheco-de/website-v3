/**
 * MCP JSON-RPC client for stress: OAuth (connection-token bootstrap owner) + tools/call timing.
 */

export type ToolCallResult = {
  ok: boolean;
  duration_ms: number;
  response_bytes: number;
  est_tokens: number;
  text: string;
  isError: boolean;
  error?: string;
};

function estTokensFromText(text: string): number {
  return Math.ceil(text.length / 4);
}

function extractTextPayload(body: unknown): { text: string; isError: boolean } {
  // JSON-RPC success: result.content[0].text
  if (body && typeof body === "object") {
    const o = body as Record<string, unknown>;
    if (o.error && typeof o.error === "object") {
      const err = o.error as { message?: string };
      return { text: JSON.stringify(o.error), isError: true };
    }
    const result = o.result as Record<string, unknown> | undefined;
    if (result) {
      const isError = result.isError === true;
      const content = result.content;
      if (Array.isArray(content)) {
        const parts: string[] = [];
        for (const c of content) {
          if (c && typeof c === "object" && (c as { type?: string }).type === "text") {
            parts.push(String((c as { text?: string }).text ?? ""));
          }
        }
        if (parts.length) return { text: parts.join("\n"), isError };
      }
      return { text: JSON.stringify(result), isError };
    }
  }
  return { text: typeof body === "string" ? body : JSON.stringify(body), isError: true };
}

export class McpStressClient {
  private rpcId = 1;
  private accessToken: string | null = null;

  constructor(
    private mcpBase: string,
    private connectionToken: string,
  ) {}

  private headers(extra?: Record<string, string>): Record<string, string> {
    const token = this.accessToken || this.connectionToken;
    return {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "X-Api-Key": token,
      Authorization: `Bearer ${token}`,
      ...(extra ?? {}),
    };
  }

  /**
   * Obtain an OAuth access token bound to the connection-token bootstrap owner so checkCap resolves a username.
   * Raw connection token opens the gate but does not set getTokenUsername.
   */
  async bootstrapOAuth(): Promise<void> {
    const redirectUri = "http://127.0.0.1:9/stress-callback";

    const regRes = await fetch(`${this.mcpBase}/oauth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_name: "mcp-stress-harness",
        redirect_uris: [redirectUri],
      }),
    });
    if (!regRes.ok) {
      throw new Error(`OAuth register failed (${regRes.status}): ${await regRes.text()}`);
    }
    const reg = (await regRes.json()) as {
      client_id: string;
      client_secret: string;
    };

    const authUrl = new URL(`${this.mcpBase}/oauth/authorize`);
    authUrl.searchParams.set("client_id", reg.client_id);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("state", "stress");

    const authPage = await fetch(authUrl.toString());
    if (!authPage.ok) {
      throw new Error(`OAuth authorize page failed (${authPage.status})`);
    }
    const html = await authPage.text();
    const nonceMatch = html.match(/name="nonce"\s+value="([^"]+)"/);
    if (!nonceMatch?.[1]) {
      throw new Error("Could not parse OAuth nonce from authorize page");
    }
    const nonce = nonceMatch[1];

    const form = new URLSearchParams();
    form.set("nonce", nonce);
    form.set("token", this.connectionToken);

    const consent = await fetch(`${this.mcpBase}/oauth/authorize`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      redirect: "manual",
    });

    const location = consent.headers.get("location");
    if (!location) {
      const body = await consent.text();
      throw new Error(
        `OAuth consent did not redirect (${consent.status}). Is WEBLIFY_ALLOW_CONNECTION_TOKEN_STAFF set? Body: ${body.slice(0, 200)}`,
      );
    }
    const locUrl = new URL(location);
    const code = locUrl.searchParams.get("code");
    if (!code) {
      throw new Error(`OAuth redirect missing code: ${location}`);
    }

    const tokenRes = await fetch(`${this.mcpBase}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: reg.client_id,
        client_secret: reg.client_secret,
        code,
        redirect_uri: redirectUri,
      }).toString(),
    });
    if (!tokenRes.ok) {
      throw new Error(`OAuth token exchange failed (${tokenRes.status}): ${await tokenRes.text()}`);
    }
    const tokenJson = (await tokenRes.json()) as { access_token?: string };
    if (!tokenJson.access_token) {
      throw new Error("OAuth token response missing access_token");
    }
    this.accessToken = tokenJson.access_token;
  }

  async initialize(): Promise<void> {
    const id = this.rpcId++;
    const res = await fetch(`${this.mcpBase}/mcp`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "initialize",
        id,
        params: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          clientInfo: { name: "mcp-stress", version: "1.0.0" },
        },
      }),
    });
    if (!res.ok) {
      throw new Error(`MCP initialize HTTP ${res.status}: ${await res.text()}`);
    }
    // Some transports want initialized notification
    await fetch(`${this.mcpBase}/mcp`, {
      method: "POST",
      headers: this.headers(),
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      }),
    }).catch(() => null);
  }

  async callTool(
    name: string,
    args: Record<string, unknown>,
  ): Promise<ToolCallResult> {
    const id = this.rpcId++;
    const started = Date.now();
    try {
      const res = await fetch(`${this.mcpBase}/mcp`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({
          jsonrpc: "2.0",
          method: "tools/call",
          id,
          params: { name, arguments: args },
        }),
      });
      const duration_ms = Date.now() - started;
      const rawText = await res.text();
      let parsed: unknown;
      const ctype = res.headers.get("content-type") || "";
      if (ctype.includes("text/event-stream") || rawText.includes("data:")) {
        const dataLines: string[] = [];
        for (const line of rawText.split(/\r?\n/)) {
          if (line.startsWith("data:")) dataLines.push(line.slice(5).trim());
        }
        const last = dataLines.filter(Boolean).pop();
        parsed = last ? JSON.parse(last) : { raw: rawText };
      } else {
        try {
          parsed = JSON.parse(rawText);
        } catch {
          parsed = { raw: rawText };
        }
      }

      if (!res.ok) {
        return {
          ok: false,
          duration_ms,
          response_bytes: Buffer.byteLength(rawText, "utf8"),
          est_tokens: estTokensFromText(rawText),
          text: rawText,
          isError: true,
          error: `HTTP ${res.status}`,
        };
      }

      const { text, isError } = extractTextPayload(parsed);
      const response_bytes = Buffer.byteLength(text, "utf8");
      return {
        ok: !isError,
        duration_ms,
        response_bytes,
        est_tokens: estTokensFromText(text),
        text,
        isError,
        error: isError ? text.slice(0, 500) : undefined,
      };
    } catch (err) {
      const duration_ms = Date.now() - started;
      const msg = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        duration_ms,
        response_bytes: 0,
        est_tokens: 0,
        text: "",
        isError: true,
        error: msg,
      };
    }
  }

  /** Parse JSON tool payload from last call text when success. */
  parseJson(text: string): Record<string, unknown> | null {
    try {
      return JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }
  }
}

export { estTokensFromText };
