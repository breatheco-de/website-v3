# Runbook: MCP OAuth persistence (GCS)

Operational guide for durable MCP OAuth state across VPS redeploys. Encrypted blobs live at:

```text
gs://<GCS_BUCKET_NAME>/mcp-auth/clients.enc
gs://<GCS_BUCKET_NAME>/mcp-auth/tokens.enc
gs://<GCS_BUCKET_NAME>/mcp-auth/bc-cache.enc
```

Related: [`docs/vps.md`](../vps.md) (env merge, security), [`mcp-server/lib/oauth.ts`](../../mcp-server/lib/oauth.ts), [`mcp-server/lib/gcs-store.ts`](../../mcp-server/lib/gcs-store.ts).

---

## 1. Enable (production)

### Required environment variables

Set in release `.env` via **any** of:

- GitHub Actions `_WEBSITE_*` secrets (merged over prior `.env` on deploy), or
- Manual edits on the VPS (`current/.env` survives deploy when keys are not in the GHA pack), or
- Both (packed keys overlay manual keys)

| Variable | Notes |
|----------|--------|
| `GCS_BUCKET_NAME` | **Must match** `bucket_name` in `persistent/sites.yml` (MCP reads env only) |
| `GCS_CREDENTIALS_JSON` or `GCS_KEY_FILENAME` | Service account with read/write on `mcp-auth/*` |
| `MCP_TOKEN_ENCRYPTION_KEY` | Generate **once**: `openssl rand -hex 32` (64 hex chars) |
| `MCP_SERVER_SECRET` | Keep **stable** across deploys — do not rotate casually |

### GitHub Actions secret names (optional)

If using Actions, prefix with `_WEBSITE_`:

- `_WEBSITE_GCS_BUCKET_NAME` → `GCS_BUCKET_NAME`
- `_WEBSITE_GCS_CREDENTIALS_JSON` → `GCS_CREDENTIALS_JSON`
- `_WEBSITE_MCP_TOKEN_ENCRYPTION_KEY` → `MCP_TOKEN_ENCRYPTION_KEY`
- `_WEBSITE_MCP_SERVER_SECRET` → `MCP_SERVER_SECRET`

Partial packs are OK: deploy **merges** packed keys over the prior release `.env` (see [`scripts/deploy.sh`](../../scripts/deploy.sh)).

### GCS IAM

Grant the app service account object read/write on the bucket (minimum: `roles/storage.objectAdmin` on that bucket, or custom role scoped to `mcp-auth/*`).

### First-time enable

1. Set env vars and deploy (or restart `website.service`).
2. Connect Cursor (or another MCP client) to prod MCP URL; complete OAuth **once**.
3. Confirm blobs appear (GCS Console or **Settings → Cloud Sync → Test connection**).
4. Redeploy or restart; MCP should work **without** re-OAuth.

---

## 2. Verify after deploy

### MCP logs

```bash
journalctl -u website -n 120 --no-pager | rg '\[MCP\]'
```

**Good:**

```text
[MCP] GCS store: initialized (bucket: ..., prefix: mcp-auth/)
[MCP] OAuth: merged N registered client(s) from GCS
[MCP] GCS auth persistence: ok
```

**Bad:**

```text
token GCS persistence disabled (local JSON only)
MCP_TOKEN_ENCRYPTION_KEY not set
[MCP] WARN: GCS_BUCKET_NAME (...) != sites.yml bucket_name (...)
```

### Admin UI

- **Cloud Sync → Test connection** — checks include MCP auth encryption, bucket parity, `mcp-auth/` blobs, GitHub content API.
- **System alerts** — critical if encryption key missing or bucket mismatch in production.

### MCP loopback health (on VPS)

```bash
curl -s http://127.0.0.1:3001/health | jq .
```

Expect `"gcsAuthPersistence": "ok"` when configured (not exposed publicly through Nginx).

---

## 3. Troubleshooting

| Symptom | Likely cause | Fix |
|---------|----------------|-----|
| Re-OAuth after every deploy | `MCP_TOKEN_ENCRYPTION_KEY` missing or GCS writes failing | Set key; run Test connection; OAuth once; confirm blobs |
| MCP works until deploy only | Blobs never written to GCS | Check IAM, encryption key, logs for `GCS debounced write failed` |
| Bucket mismatch warning | `GCS_BUCKET_NAME` ≠ `sites.yml` `bucket_name` | Align both to the same bucket name |
| OAuth interrupted mid-flow | Deploy during consent (pending auth is in-memory) | Retry OAuth from Cursor |
| GCS down at restart | Fail-open startup; empty local JSON on fresh release | Restore GCS or re-OAuth |

---

## 4. Encryption key rotation (incident only)

Rotating `MCP_TOKEN_ENCRYPTION_KEY` makes existing `mcp-auth/*.enc` **undecryptable**.

1. Generate new key: `openssl rand -hex 32`
2. Update env (GHA secret and/or VPS `.env`)
3. Deploy / restart
4. Optionally delete old blobs: `gsutil rm gs://<bucket>/mcp-auth/*.enc`
5. Announce: all staff must reconnect MCP clients (OAuth once)

Do **not** rotate this key during normal deploys.

---

## 5. Staff offboarding

OAuth access tokens can remain valid for up to ~1 year once persisted. Removing CMS roles does **not** automatically revoke MCP tokens.

To revoke MCP access for a departed staff member:

1. Delete `gs://<bucket>/mcp-auth/tokens.enc` (or entire `mcp-auth/` prefix if removing all MCP sessions)
2. Restart MCP / `website.service`
3. Optionally delete `clients.enc` if you want to force client re-registration

---

## 6. Deploy verification checklist

- [ ] `MCP_TOKEN_ENCRYPTION_KEY` set in production `.env`
- [ ] `GCS_BUCKET_NAME` matches `sites.yml` `bucket_name`
- [ ] Cloud Sync **Test connection** — MCP checks pass (blobs may warn until first OAuth)
- [ ] OAuth once in Cursor; `mcp-auth/clients.enc` and `tokens.enc` exist
- [ ] Redeploy; MCP works without re-OAuth
- [ ] Deploy log shows `merged N packed key(s) over prior .env` when using partial GHA pack

---

## 7. Rollback

Remove `MCP_TOKEN_ENCRYPTION_KEY` from env and redeploy → MCP falls back to ephemeral local JSON (wiped each deploy; everyone re-OAuths). GCS blobs remain but are unused until the key is restored.
