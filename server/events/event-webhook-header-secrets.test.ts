import { afterEach, describe, expect, it, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  deliverEventWebhookHttp,
  loadEventWebhookConfig,
  redactEventWebhookConfigForStaff,
  saveEventWebhookConfig,
  type EventWebhookConfig,
} from "./event-webhooks";
import {
  decryptWebhookHeaderValue,
  EventWebhookHeaderSecretError,
  encryptWebhookHeaderValue,
} from "./event-webhook-header-secrets";

const KEY = "ab".repeat(32);
const ORIGINAL_KEY = process.env.EVENT_WEBHOOK_ENCRYPTION_KEY;

function config(headers: Record<string, string> | undefined): EventWebhookConfig {
  return {
    version: 1,
    subscriptions: {
      proposal_created: [
        {
          id: "slack",
          enabled: true,
          url: "https://example.com/hook",
          method: "POST",
          debounce_ms: 30_000,
          max_wait_ms: 60_000,
          max_events_per_call: 50,
          ...(headers ? { headers } : {}),
        },
      ],
    },
  };
}

function savedHeaders(root: string): Record<string, string> | undefined {
  return loadEventWebhookConfig(root).subscriptions.proposal_created?.[0]?.headers;
}

describe("event webhook header secrets", () => {
  let root: string;

  afterEach(() => {
    vi.unstubAllGlobals();
    if (ORIGINAL_KEY === undefined) delete process.env.EVENT_WEBHOOK_ENCRYPTION_KEY;
    else process.env.EVENT_WEBHOOK_ENCRYPTION_KEY = ORIGINAL_KEY;
    if (root && fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
  });

  it("round-trips a header value", () => {
    process.env.EVENT_WEBHOOK_ENCRYPTION_KEY = KEY;
    const stored = encryptWebhookHeaderValue("Bearer sk_live_abc123");
    expect(stored.startsWith("enc:v1:")).toBe(true);
    expect(stored).not.toContain("sk_live_abc123");
    expect(decryptWebhookHeaderValue(stored)).toBe("Bearer sk_live_abc123");
  });

  it("stores ciphertext in the yaml and keeps a plain header", () => {
    process.env.EVENT_WEBHOOK_ENCRYPTION_KEY = KEY;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "event-webhook-secrets-"));
    saveEventWebhookConfig(
      root,
      config({ Authorization: "Bearer sk_live_abc123", "X-Workshop": "workshops" }),
    );
    const headers = savedHeaders(root);
    expect(headers?.Authorization.startsWith("enc:v1:")).toBe(true);
    expect(headers?.Authorization).not.toContain("sk_live");
    expect(headers?.["X-Workshop"]).toBe("workshops");
    expect(decryptWebhookHeaderValue(headers!.Authorization)).toBe("Bearer sk_live_abc123");
    const raw = fs.readFileSync(path.join(root, "event-webhooks.yml"), "utf8");
    expect(raw).not.toContain("sk_live");
  });

  it("keeps the saved secret when staff send the masked tail", () => {
    process.env.EVENT_WEBHOOK_ENCRYPTION_KEY = KEY;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "event-webhook-secrets-"));
    saveEventWebhookConfig(root, config({ Authorization: "Bearer sk_live_abc123" }));
    const first = savedHeaders(root)!.Authorization;
    const staff = redactEventWebhookConfigForStaff(loadEventWebhookConfig(root));
    expect(staff.subscriptions.proposal_created?.[0]?.headers?.Authorization).toBe("••••c123");
    expect(JSON.stringify(staff)).not.toContain("sk_live");
    expect(JSON.stringify(staff)).not.toContain("enc:v1:");
    saveEventWebhookConfig(root, staff);
    expect(savedHeaders(root)?.Authorization).toBe(first);
  });

  it("replaces the secret when staff paste a new value", () => {
    process.env.EVENT_WEBHOOK_ENCRYPTION_KEY = KEY;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "event-webhook-secrets-"));
    saveEventWebhookConfig(root, config({ Authorization: "Bearer sk_live_abc123" }));
    saveEventWebhookConfig(root, config({ Authorization: "Bearer sk_live_new999" }));
    expect(decryptWebhookHeaderValue(savedHeaders(root)!.Authorization)).toBe("Bearer sk_live_new999");
  });

  it("drops a secret header when the line is removed", () => {
    process.env.EVENT_WEBHOOK_ENCRYPTION_KEY = KEY;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "event-webhook-secrets-"));
    saveEventWebhookConfig(
      root,
      config({ Authorization: "Bearer sk_live_abc123", "X-Workshop": "workshops" }),
    );
    saveEventWebhookConfig(root, config({ "X-Workshop": "workshops" }));
    expect(savedHeaders(root)).toEqual({ "X-Workshop": "workshops" });
  });

  it("refuses to store a new secret when the key is missing", () => {
    delete process.env.EVENT_WEBHOOK_ENCRYPTION_KEY;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "event-webhook-secrets-"));
    expect(() => saveEventWebhookConfig(root, config({ Authorization: "Bearer sk_live_abc123" }))).toThrow(
      EventWebhookHeaderSecretError,
    );
    expect(fs.existsSync(path.join(root, "event-webhooks.yml"))).toBe(false);
  });

  it("encrypts a legacy plaintext header when staff save the masked tail", () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "event-webhook-secrets-"));
    fs.writeFileSync(
      path.join(root, "event-webhooks.yml"),
      [
        "version: 1",
        "subscriptions:",
        "  proposal_created:",
        "    - id: slack",
        "      enabled: true",
        "      url: https://example.com/hook",
        "      headers:",
        "        Authorization: Bearer sk_live_legacy",
        "",
      ].join("\n"),
      "utf8",
    );
    process.env.EVENT_WEBHOOK_ENCRYPTION_KEY = KEY;
    const staff = redactEventWebhookConfigForStaff(loadEventWebhookConfig(root));
    saveEventWebhookConfig(root, staff);
    const stored = savedHeaders(root)?.Authorization ?? "";
    expect(stored.startsWith("enc:v1:")).toBe(true);
    expect(decryptWebhookHeaderValue(stored)).toBe("Bearer sk_live_legacy");
    expect(fs.readFileSync(path.join(root, "event-webhooks.yml"), "utf8")).not.toContain("sk_live");
  });

  it("leaves a legacy plaintext header in place when the key is missing", () => {
    delete process.env.EVENT_WEBHOOK_ENCRYPTION_KEY;
    root = fs.mkdtempSync(path.join(os.tmpdir(), "event-webhook-secrets-"));
    fs.writeFileSync(
      path.join(root, "event-webhooks.yml"),
      [
        "version: 1",
        "subscriptions:",
        "  proposal_created:",
        "    - id: slack",
        "      enabled: true",
        "      url: https://example.com/hook",
        "      headers:",
        "        Authorization: Bearer sk_live_legacy",
        "",
      ].join("\n"),
      "utf8",
    );
    saveEventWebhookConfig(root, config({ Authorization: "Bearer sk_live_legacy" }));
    expect(savedHeaders(root)?.Authorization).toBe("Bearer sk_live_legacy");
  });

  it("decrypts the header only when posting", async () => {
    process.env.EVENT_WEBHOOK_ENCRYPTION_KEY = KEY;
    const stored = encryptWebhookHeaderValue("Bearer sk_live_abc123");
    const fetchMock = vi.fn(async () => ({ ok: true, status: 204, text: async () => "" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await deliverEventWebhookHttp({
      url: "https://example.com/hook",
      headers: { Authorization: stored, "X-Workshop": "workshops" },
      body: { ok: true },
    });
    expect(result.ok).toBe(true);
    const init = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe("Bearer sk_live_abc123");
    expect(init.headers["X-Workshop"]).toBe("workshops");
    expect(JSON.stringify(result)).not.toContain("sk_live");
  });

  it("fails the post when an encrypted header cannot be opened", async () => {
    delete process.env.EVENT_WEBHOOK_ENCRYPTION_KEY;
    const fetchMock = vi.fn(async () => ({ ok: true, status: 204, text: async () => "" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await deliverEventWebhookHttp({
      url: "https://example.com/hook",
      headers: { Authorization: "enc:v1:aaaa" },
      body: { ok: true },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/EVENT_WEBHOOK_ENCRYPTION_KEY/);
      expect(result.error).not.toContain("enc:v1");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still sends a legacy plaintext header", async () => {
    delete process.env.EVENT_WEBHOOK_ENCRYPTION_KEY;
    const fetchMock = vi.fn(async () => ({ ok: true, status: 204, text: async () => "" }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await deliverEventWebhookHttp({
      url: "https://example.com/hook",
      headers: { Authorization: "Bearer sk_live_legacy" },
      body: { ok: true },
    });
    expect(result.ok).toBe(true);
    const init = fetchMock.mock.calls[0]?.[1] as { headers: Record<string, string> };
    expect(init.headers.Authorization).toBe("Bearer sk_live_legacy");
  });
});
