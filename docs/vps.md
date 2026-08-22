# VPS (website-v3)

Canonical doc for the DigitalOcean origin: layout, atomic deploy, ephemeral site content (blocking pull pre-flip + boot hash-diff), detached Actions observer, network trust boundaries, security, and cutover status.

Related runbooks (kept separate on purpose):

- sGTM prod cutover: [`sgtm-prod-cutover.md`](sgtm-prod-cutover.md)
- sGTM migration context: [`sgtm-self-host-migration-context.md`](sgtm-self-host-migration-context.md)

---

## 1. Status

| Piece | Today |
|-------|--------|
| App on droplet | Yes (`/opt/website-v3`, atomic releases) |
| sGTM Docker on droplet | Yes (`/opt/sgtm`, tagging + preview) |
| Public marketing | Still **Replit** |
| Public metrics / sGTM | Still **Stape** (`metrics.4geeks.com`) |
| Lab TLS | Let’s Encrypt on **sslip** hostnames only |
| Prod DNS cutover | Not done — see [§9 Cutover](#9-cutover-pending) |

Security model: **origin behind Cloudflare** (orange proxy, SSL Full or Full strict), not a site meant to be browsed only by raw IP.

Verify droplet IP / hostname in DigitalOcean; do not treat IPs in older notes as source of truth.

---

## 2. What the app is

Marketing site + YAML CMS (programs, blog, landings, checkout, staff).

| Layer | Tech |
|-------|------|
| Client | React + Vite |
| Server | Express (Node), one process serves API + production statics |
| Content | YAML in a **separate** GitHub repo (`site_*`). App code repo is not the marketing source of truth. |
| Users / sessions | PostgreSQL (Drizzle). Public content is not in that DB. |
| Auth | Breathecode API + session cookies (`SESSION_SECRET`) |
| Forms | Cloudflare Turnstile |
| Media | Local and/or GCS |
| Search | Qdrant (loopback) |
| Agents | MCP via Express (`/mcp`); OAuth + Breathecode token |

**Two channels:**

1. **Code deploy** — GitHub Actions → SSH → VPS (`deploy-vps.yml` + `scripts/deploy.sh`).
2. **Content sync** — GitHub content token at runtime. An app deploy does **not** publish YAML.

---

## 3. Disk layout

```text
/opt/website-v3/
  persistent/          # mutable runtime: sites.yml, data, .cache, .local, …
  releases/<sha>/      # app tree + .env + real site_* (pulled before flip)
  current → releases/<sha>
  .deploy-state/       # per-SHA logs, .done, .abort (Actions observer)
  .git/                # fetch/archive object store (not the live cwd)

/opt/sgtm/             # Docker tagging (:8080) + preview (:8081)
```

Live process must use `current` (systemd). Runtime sidecars (`sites.yml`, caches, DB files) stay in `persistent/`.

`.env` is **per release** under `releases/<sha>/.env` (written by `deploy.sh` from packed `_WEBSITE_*` secrets, or copied from the previous release if the pack is empty). systemd `EnvironmentFile` should be `/opt/website-v3/current/.env`.

### 3.1 Site content (ephemeral per release)

`site_*` folders are **not** linked from `persistent/`. Each release gets real `site_*` directories (from `content_folder` in `persistent/sites.yml`). `deploy.sh` runs a **blocking** `npm run content:pull -- --required` after `npm ci` and before `npm run build` / flip, so cutover never points at an empty tree.

After that pull, deploy **clears** `.bootstrap-complete` on purpose. On the post-flip restart, when the flag is absent, the app **hash-diff pulls** again (GitHub wins) so content commits that landed during `npm ci`/build are picked up. Media/canonical assets live in **GCS**; YAML/registry come from those pulls.

Why not per-child symlinks into `persistent/`? Node `fs.Dirent.isDirectory()` is **false** for symlink entries, so walkers such as the commit queue treated whole trees (e.g. `blog/`) as missing and showed false `deleted` local changes.

`component-registry/` is pulled into the release as real files (same as other content), so `shared/schema.ts` relative imports resolve next to `shared/` without a whole-`site_*` symlink.

Leftover `persistent/site_*` trees from the old hybrid layout are unused by new deploys; safe to leave or delete manually after a successful bootstrap.

---

## 4. Atomic deploy

### 4.1 GitHub Actions

Workflow: [`.github/workflows/deploy-vps.yml`](../.github/workflows/deploy-vps.yml)

- Triggers: push to `main`, `workflow_dispatch`
- Concurrency group `deploy-vps` with **`cancel-in-progress: true`** — cancels the **Actions observer** (SSH poll), not necessarily the VPS work. `deploy.sh` is started with `setsid`/`nohup`; stdout goes to `.deploy-state/<sha>.log`, exit code to `.deploy-state/<sha>.done`. The job streams that log until `.done` appears.
- On cancel: a `cancelled()` step touches `.deploy-state/<sha>.abort` (soft abort **before flip** only).
- `always()` step writes a **Job Summary** from `.done` / abort (polls briefly) so a red “Cancelled” badge is not mistaken for “prod did not change”.
- Packs GitHub secrets/vars whose names start with `_WEBSITE_` → `WEBSITE_RUNTIME_B64`, then registers `::add-mask::` on that blob. Avoid `set -x` in the SSH step; do not add env-dumping steps after packing.
- Skips if the workflow SHA is no longer tip of `main`
- Fetches `DEPLOY_SHA`, extracts `scripts/deploy.sh` **from that commit**, launches it detached

Actions secrets for SSH: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_SSH_KNOWN_HOSTS`.

### 4.2 `scripts/deploy.sh`

1. Acquire deploy lock (`/tmp/website-v3-deploy.lock` with **pid + sha**; stale recovery). Order: `mkdir` → write `pid` → clear this SHA’s `.abort` → write `sha` (avoids same-SHA re-entry wiping another run’s abort, and avoids clearing an abort waiters already set after seeing `sha`). Waiters with a newer SHA `touch` abort for the running SHA. Lock is held by this process (not the Actions SSH poll). After a successful deploy, prune `.deploy-state/*.{log,done,abort}` older than 7 days.
2. `git archive` → `releases/<sha>/` (if that path is already `current`, builds into `releases/<sha>.rebuild-<pid>` — **never** `rm -rf` the live tree)
3. Symlinks for `data` / `.cache` / `sites.yml` / … (not `site_*`); create real empty `site_*` dirs
4. Write `.env`
5. Abort checkpoint (if `.deploy-state/<sha>.abort` → discard release, exit 0)
6. `npm ci` → **`content:pull --required`** → `npm run build`
7. Abort checkpoint again (last chance before cutover)
8. Clear `.bootstrap-complete` on `site_*` (boot will hash-diff again)
9. Flip `current`, restart, health-check (**rollback `current`** on failure)
10. Prune old releases (keeps active + 5 others; never deletes `readlink current`)

Post-flip, abort flags are ignored (cutover already committed). Partial dirs from aborted/cancelled pre-flip runs never become `current`.

### 4.3 Manual rollback

```bash
ln -sfn releases/<old-sha> /opt/website-v3/current
sudo systemctl restart website
```

Prefer a normal Actions deploy to an older SHA if you also need a fresh `.env` from secrets.

---

## 5. systemd

One-time (requires root/sudo). After the first successful atomic deploy:

```bash
# /etc/systemd/system/website.service
WorkingDirectory=/opt/website-v3/current
EnvironmentFile=/opt/website-v3/current/.env
ExecStart=/opt/website-v3/current/scripts/start-production.sh
```

Keep `ReadWritePaths=/opt/website-v3` so `persistent/` remains writable.

```bash
sudo systemctl daemon-reload
sudo systemctl restart website
curl -fsS http://127.0.0.1:5000/health
```

Until this flip, `deploy.sh` still builds releases and updates `current`, but the running service may keep using the legacy root tree — the script prints a WARNING if `WorkingDirectory` ≠ `…/current`.

---

## 6. Network / trust boundaries

### Target traffic

```text
Internet
  → Cloudflare (WAF, TLS to visitor)
  → Droplet Nginx :443
       → 127.0.0.1:5000  Express (pages, API, /ipn/, /mcp proxy, …)
       → sGTM Docker     (metrics host; /gtm/ → preview)
            → 127.0.0.1:8080 tagging
            → 127.0.0.1:8081 preview
```

Canonical public URL in prod: **`https://4geeks.com`** (`SITE_URL`).

### Must be public

- TCP **22** SSH (keys only)
- TCP **80 / 443** Nginx

### Must not be public (loopback / Docker bind `127.0.0.1`)

- Express `:5000`
- Qdrant `:6333`
- MCP `:3001` (public only as Nginx → Express → loopback `/mcp`)
- sGTM `:8080`, `:8081`

DigitalOcean Cloud Firewall: inbound 22/80/443 only. Outbound open for apt, git, Let’s Encrypt, APIs.

### sGTM routing rules (short)

Full runbook: [`sgtm-prod-cutover.md`](sgtm-prod-cutover.md).

- `metrics.*` → Docker only. **Never** proxy metrics to Node `:5000` (loop).
- Preview: `location ^~ /gtm/` → `8081`. Tagging: everything else → `8080`.
- `/gtm.js` is **not** under `/gtm/` (dot vs slash).
- `/ipn/` stays on Node.
- Prod `PREVIEW_SERVER_URL` = `https://metrics.4geeks.com` (**no** `/sgtm`). Change only after metrics HTTPS is on this VPS.
- Tagging compose: `extra_hosts: metrics.4geeks.com:host-gateway`.
- Do not publish lab sslip URLs in prod GTM.

---

## 7. Security

No secret values in this doc.

### 7.1 Checklist (must)

**Network**

- Only public: 22, 80, 443.
- Do not open 5000, 6333, 3001, 8080, 8081.
- sGTM Docker: bind `127.0.0.1`, never `0.0.0.0`.

**Access**

- SSH with keys, not passwords (`PermitRootLogin no`, `PasswordAuthentication no`).
- Deploy user (`website-deployer`): limited sudo (`systemctl` website/nginx, `nginx -t`) — not `NOPASSWD: ALL`.
- Runtime user without interactive login where applicable.
- Emergency access: DigitalOcean Droplet Console (not SSH), not root over port 22.

**Secrets**

- Per-release `.env` mode `600`, owned by deploy/runtime user.
- sGTM `.env`: `chmod 600`.
- Never commit tokens or paste them into chat/logs.
- Do not leave permanent `127.0.0.1 metrics.4geeks.com` in `/etc/hosts`.

**TLS / Cloudflare**

- Certbot per hostname only when that DNS already points at the droplet.
- Cloudflare SSL: Full or Full (strict) once origin has a real cert. Avoid Flexible.

### 7.2 Controls already applied (summary)

- Fail2ban jail `sshd` (journal backend on Ubuntu 24.04).
- Node / MCP / Qdrant listen on loopback on the VPS (`LISTEN_HOST=127.0.0.1` on droplet; Replit may still need `0.0.0.0`).
- Turnstile required in production start.
- Staff `/private` and edit APIs are not anonymous.
- MCP: `MCP_SERVER_SECRET` is a **loopback** credential (MCP → capability check), not a public API key for browsers.

### 7.3 SSH key diagram (do not mix)

| Pair | Direction | Role |
|------|-----------|------|
| Operator keys | Laptop → Droplet deploy user | Human ops |
| GHA deploy key | GitHub Actions → Droplet deploy user | Deploy |
| Git deploy key | Droplet → GitHub **code** repo | Fetch / archive |
| `GITHUB_TOKEN` (content) | App → GitHub **content** repo | YAML sync |

Actions deploy key must not live in root `authorized_keys`.

### 7.4 Env / secrets plan

Runtime secrets can come from **GitHub Actions** (`_WEBSITE_*` → pack → merge into release `.env`), **manual edits on the VPS**, or both. The project is not locked to Actions-only env.

**Deploy merge behavior** ([`scripts/deploy.sh`](../scripts/deploy.sh)):

- Empty pack → copy prior release `.env` unchanged.
- Non-empty pack → load prior `.env` from `current/` (or legacy app root), **overlay** packed keys, write merged file. Keys not in the pack are preserved (manual VPS vars survive partial GHA packs).
- First deploy with no prior `.env` → packed keys only.

1. Never commit `.env`.
2. Deploy materializes env with restrictive umask (`640`); rotate by changing the secret and redeploying.
3. Workflow must not print secret values.
4. Code/runtime secrets vs content-repo token stay out of git; Replit secrets stay on Replit if a parallel env still exists.
5. `sites.yml` is not an app secret but is gitignored in the code repo.

Typical names (not values): `DATABASE_URL`, `SESSION_SECRET`, `SITE_URL`, `PORT`, `LISTEN_HOST`, `TURNSTILE_*`, `MCP_*`, `MCP_TOKEN_ENCRYPTION_KEY`, `GITHUB_*` (content), `GCS_*`, `OPENROUTER_API_KEY`, `VITE_BREATHECODE_HOST`, `QDRANT_URL`, `IPN_SECRET`, …

MCP OAuth persistence across redeploys: see [`docs/runbooks/mcp-oauth-persistence.md`](runbooks/mcp-oauth-persistence.md).

### 7.5 Headers, rate limit, fail2ban nginx

Priority: **(1)** Cloudflare WAF + headers + API rate limits, **(2)** Cloudflare real IP on Nginx, **(3)** optional fail2ban nginx jail only after real IP is correct (otherwise you ban Cloudflare edges).

Suggested headers at origin and/or CF: `X-Content-Type-Options`, strict `Referrer-Policy`, frame policy / CSP as needed, HSTS only when visitors use prod HTTPS hostnames (not long HSTS on lab sslip).

Rate limit APIs/forms/`/mcp`, not a blunt global RPS on all static assets.

### 7.6 Open questions for security review

1. Is “Actions writes `.env` each deploy” acceptable vs a secret store + systemd `EnvironmentFile` only?
2. Port 22 open to the world + fail2ban vs self-hosted runner / GitHub IP allowlists (IPs change)?
3. Same user for deploy and Node vs separate runtime user that cannot SSH?
4. Extra WAF / rate limit for public `/mcp`?
5. Managed Postgres off-box with TLS and SG locked to the droplet?
6. Headers / rate limit / nginx jail — see §7.5.

### 7.7 Residual assumptions

- 2FA on DigitalOcean and GitHub org is account hygiene, not Droplet config.
- Kernel upgrades may need a maintenance reboot window.
- Compromising GitHub org secrets ≈ compromising future deploys and `.env`.
- This doc is not an app pentest (XSS/CSRF/IDOR in the CMS are separate).

---

## 8. Infra snapshot (verify live)

| Item | Expected |
|------|----------|
| OS | Ubuntu 24.04 |
| App root | `/opt/website-v3` |
| Process | `website.service` → `current/scripts/start-production.sh` |
| Reverse proxy | Nginx 80/443 |
| Health | `http://127.0.0.1:5000/health` |
| sGTM | `/opt/sgtm` Docker compose |

IP, hostname, and which DNS records already point here: check DigitalOcean + Cloudflare, not this file.

---

## 9. Cutover (pending)

**Done in lab:** app on droplet, sGTM Docker, Nginx metrics `/gtm/` → 8081, Preview on sslip.

**Public today:** Replit + Stape. Detail: [`sgtm-prod-cutover.md`](sgtm-prod-cutover.md).

### A — sGTM first (metrics only)

1. Cloudflare: `metrics.4geeks.com` → droplet A record (leave Stape until flip).
2. Cloudflare SSL: Full or Full (strict).
3. VPS: `certbot --nginx -d metrics.4geeks.com`.
4. Confirm 443 still has `location ^~ /gtm/` → 8081.
5. Tagging `.env`: `PREVIEW_SERVER_URL=https://metrics.4geeks.com`.
6. Tagging: `extra_hosts: metrics.4geeks.com:host-gateway`.
7. `cd /opt/sgtm && docker compose down && docker compose up -d`.
8. GTM: Server container URL `https://4geeks.com/sgtm` (no sslip). New preview session.
9. Check `https://metrics.4geeks.com/healthy` → `ok` (not Stape).
10. Check `https://4geeks.com/sgtm/healthy`. `/ipn/` must not 502.
11. Turn off Stape.

Do **not** advance `PREVIEW_SERVER_URL` while metrics still points at Stape.

### B — App after (4geeks + Florida)

1. Cloudflare: `4geeks.com`, `www`, `fl.4geeksacademy.com` (and anything still on Replit) → same droplet IP.
2. Certbot for those hostnames (not the sslip cert).
3. Nginx HTTPS `server_name` for those hosts.
4. Smoke: sites, `/sgtm`, `/ipn`, GitHub Actions deploy.
5. Turn off Replit.

**Order:** A first (easy rollback: metrics CNAME back to Stape). B after metrics is healthy. Same day is fine; two DNS flips.

---

## 10. Code pointers

| Path | Role |
|------|------|
| `.github/workflows/deploy-vps.yml` | Actions deploy + cancel-in-progress + lock |
| `scripts/deploy.sh` | Atomic release build / flip / prune |
| `server/component-registry-persistent.ts` | Registry mirror release → persistent |
| `docs/sgtm-prod-cutover.md` | sGTM cutover runbook |
