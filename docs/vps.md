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
| Public marketing | **Droplet** (Replit retired) |
| Public metrics / sGTM | Still **Stape** (`metrics.4geeks.com`) |
| Lab TLS | Let’s Encrypt on **sslip** hostnames only |
| Prod DNS cutover | App done; metrics / sGTM — see [§9 Cutover](#9-cutover-pending) |

Security model: **no CDN or proxy in front**. DNS points straight at the droplet; Nginx terminates TLS (Let’s Encrypt) and sees real visitor IPs. Not a site meant to be browsed only by raw IP.

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

`site_*` folders are **not** linked from `persistent/`. Each release gets real `site_*` directories (from `content_folder` in `persistent/sites.yml`). `deploy.sh` runs a **blocking** `npm run content:pull -- --required` after `npm ci` and before `npm run build` / flip, so cutover never points at an empty tree. After the pull it sets group `website-runtime` + setgid on those trees so runtime can write `site_*/.cache` and deploy can still delete old releases.

After that pull, deploy **clears** `.bootstrap-complete` on purpose. On the post-flip restart, when the flag is absent, the app **hash-diff pulls** again (GitHub wins) so content commits that landed during `npm ci`/build are picked up. Media/canonical assets live in **GCS**; YAML/registry come from those pulls.

Why not per-child symlinks into `persistent/`? Node `fs.Dirent.isDirectory()` is **false** for symlink entries, so walkers such as the commit queue treated whole trees (e.g. `blog/`) as missing and showed false `deleted` local changes.

`component-registry/` is pulled into the release as real files (same as other content), so `shared/schema.ts` relative imports resolve next to `shared/` without a whole-`site_*` symlink.

Leftover `persistent/site_*` trees from the old hybrid layout are unused by new deploys; safe to leave or delete manually after a successful bootstrap.

---

## 4. Atomic deploy

### 4.1 GitHub Actions

Workflow: [`.github/workflows/deploy-vps.yml`](../.github/workflows/deploy-vps.yml)

- Triggers: push to `main`, `workflow_dispatch` (manual runs offer **Skip content check**, input `skip_content_flush`; see 4.2.1)
- Concurrency group `deploy-vps` with **`cancel-in-progress: true`** — cancels the **Actions observer** (SSH poll), not necessarily the VPS work. `deploy.sh` is started with `setsid`/`nohup`; stdout goes to `.deploy-state/<sha>.log`, exit code to `.deploy-state/<sha>.done`. The job streams that log until `.done` appears.
- On cancel: a `cancelled()` step touches `.deploy-state/<sha>.abort` (soft abort **before flip** only).
- `always()` step writes a **Job Summary** from `.done` / abort (polls briefly) so a red “Cancelled” badge is not mistaken for “prod did not change”.
- Packs GitHub secrets/vars whose names start with `_WEBSITE_` → `WEBSITE_RUNTIME_B64`, then registers `::add-mask::` on that blob. Avoid `set -x` in the SSH step; do not add env-dumping steps after packing.
- Skips if the workflow SHA is no longer tip of `main`
- Fetches `DEPLOY_SHA`, extracts `scripts/deploy.sh` **from that commit**, launches it detached

Actions secrets for SSH: `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`, `DEPLOY_SSH_KNOWN_HOSTS`.

### 4.2 `scripts/deploy.sh`

1. Acquire deploy lock, then refuse unpatched Node (see 4.4) before any release work. Lock (`/tmp/website-v3-deploy.lock` with **pid + sha**; stale recovery). Order: `mkdir` → write `pid` → clear this SHA’s `.abort` → write `sha` (avoids same-SHA re-entry wiping another run’s abort, and avoids clearing an abort waiters already set after seeing `sha`). Waiters with a newer SHA `touch` abort for the running SHA. Lock is held by this process (not the Actions SSH poll). After a successful deploy, prune `.deploy-state/*.{log,done,abort}` older than 7 days.
2. `git archive` → `releases/<sha>/` (if that path is already `current`, builds into `releases/<sha>.rebuild-<pid>` — **never** `rm -rf` the live tree)
3. Symlinks for `data` / `.cache` / `sites.yml` / … (not `site_*`); create real empty `site_*` dirs
4. Write `.env`
5. Abort checkpoint (if `.deploy-state/<sha>.abort` → discard release, exit 0)
6. **Content check 1** (see 4.2.1): the live site pushes its unpushed content
7. `npm ci` → (disk check if the live site did not answer) → **`content:pull --required`** → `npm run build` → **`ensure:pipeline-db --dry-run`** (validates pipeline SQLite migrations on DB copies; aborts before flip on failure) → **`node dist/prebuild-html-cache.js`** (writes this release's public HTML into `data/html-page-cache` while the previous process is still serving; boot loads it)
8. Abort checkpoint again (last chance before cutover)
9. Clear `.bootstrap-complete` on `site_*` (boot will hash-diff again)
10. **Content check 2**: pause staff/agent saves, push what is left
11. Flip `current`, restart, health-check (**rollback `current`** on failure)
12. Prune old releases (keeps active + 5 others; never deletes `readlink current`)

**Deploy observability:** Staff use GitHub Actions → **Deploy to VPS** (streams `.deploy-state/<sha>.log`). Look for `[deploy] validating pipeline SQLite migrations (dry-run)` and `[pipeline-db] dry-run ok`. There is no in-app deploy-progress UI. After restart, Settings → Server tab shows a new Boot ID. Live apply of pipeline migrations runs once at boot ([`server/pipeline-db/runner.ts`](../server/pipeline-db/runner.ts)).

Post-flip, abort flags are ignored (cutover already committed). Partial dirs from aborted/cancelled pre-flip runs never become `current`.

### 4.2.1 Content check (unpushed content)

Each release gets a fresh content pull, so anything saved on the live server but not yet on GitHub would be left behind in the old release. Before that can happen, `deploy.sh` asks the live site to push it:

- **Check 1** (before `npm ci`) and **check 2** (right before the flip) call `POST /api/internal/content/flush` on `127.0.0.1` with `Bearer $SESSION_SECRET` from the live `.env`. The server lists local edits from each site's `.sync-state.json`, requeues them for auto-sync and pushes them. Edits whose author has no GitHub connection are pushed with the service account; the commit message still names the author and ends with `(pushed by deploy check: no GitHub connection)`.
- **Check 2 pauses saves**: staff and agent writes (`POST/PUT/PATCH/DELETE` on `/api/*` with a staff or MCP token) answer `503 site_updating` with `Retry-After` until the new release runs (the new process starts unpaused; the pause also expires after 3 minutes). Public visitors (lead forms, events) and reads are never paused. Saves already in progress finish before the push.
- **Live site not answering**: `scripts/content-pending.ts` reads the live tree's sync state from disk. Nothing pending → continue; something pending → stop.

**Reading a stop.** The log lists `CONTENT_UNPUSHED site=… file=… author=… reason=…` and what to do:

| reason | Fix |
|---|---|
| `conflict` | GitHub also changed that file. Resolve it in Sync, then redeploy. |
| author `migration:*` | Re-run that migration from Settings → General → Migrations; it pushes its own leftovers. |
| `push_failed` | Read `error=`; fix it or push from Sync, then redeploy. |
| `auto_commit_disabled` | Auto-sync is off on the server (`GITHUB_AUTO_COMMIT_ENABLED`). |
| `live_server_down` | The site did not answer; start it and redeploy, or push from Sync. |

**Emergency.** Actions → Deploy to VPS → Run workflow → tick **Skip content check** (or `gh workflow run deploy-vps.yml -f skip_content_flush=true`). The deploy copies the unpushed files to `persistent/unpushed-content/<release>/` (with `manifest.json`) and continues. Restore them by hand afterwards; until the old release is pruned, the originals also stay in `releases/<old-sha>/`.

Code: [`server/content-flush.ts`](../server/content-flush.ts), [`server/content-write-pause.ts`](../server/content-write-pause.ts), [`server/routes/internal-content.ts`](../server/routes/internal-content.ts), [`scripts/content-pending.ts`](../scripts/content-pending.ts).

### 4.3 Manual rollback

```bash
ln -sfn releases/<old-sha> /opt/website-v3/current
sudo systemctl restart website
```

Prefer a normal Actions deploy to an older SHA if you also need a fresh `.env` from secrets.

### 4.4 Node runtime

The droplet runs the system Node (`/usr/bin/node`). `deploy.sh` checks it first and stops (before touching the live release) when it is older than the last Node security release: **24.22.1** (or 22.23.4 / 26.12.1). The failed Actions run says `Node <version> on this server is unpatched`. The live site keeps serving the previous release.

To upgrade (as root, Node 24 from NodeSource):

```bash
node -v && apt-cache policy nodejs        # confirm current version and source
curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
apt-get install -y nodejs
node -v                                    # expect v24.22.1 or newer
```

Then run **Deploy to VPS** again (Actions → Run workflow). Do not just `systemctl restart website`: when the major version changes, the live release's native modules (`better-sqlite3`, `sharp`) were compiled for the old Node and will not load. A fresh deploy runs `npm ci` on the new Node. Also `systemctl restart cpu-capture` (it runs `/usr/bin/node` directly).

When Node ships the next security release, raise the floors in `require_patched_node` in [`scripts/deploy.sh`](../scripts/deploy.sh). CI ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) uses `node-version: "24"`, which already picks up the latest 24.x.

---

## 5. systemd

One-time (requires root/sudo). After the first successful atomic deploy:

```bash
# /etc/systemd/system/website.service
WorkingDirectory=/opt/website-v3/current
EnvironmentFile=/opt/website-v3/current/.env
ExecStart=/opt/website-v3/current/scripts/start-production.sh
UMask=0002
```

Keep `ReadWritePaths=/opt/website-v3` so `persistent/` remains writable.
`UMask=0002` lets `website-runtime` create group-writable `site_*/.cache` so
`website-deployer` (in group `website-runtime`) can prune old releases.

### Process supervisor (pm2-runtime)

`scripts/start-production.sh` ends with `exec npx pm2-runtime start ecosystem.config.cjs`.
pm2 supervises **web**, **MCP**, **Sidequest**, and **Qdrant** (MCP/Qdrant only if their binaries exist). One `systemctl restart website` relaunches all of them.

Recommended drop-in (root, once):

```ini
# /etc/systemd/system/website.service.d/supervisor.conf
[Service]
Restart=always
RestartSec=5
OOMPolicy=continue
TimeoutStopSec=60
MemoryMax=6G
```

```bash
sudo systemctl daemon-reload
sudo systemctl restart website
curl -fsS http://127.0.0.1:5000/health
# Sidequest PID (web probes this):
cat /opt/website-v3/current/data/sidequest.pid
```

MCP memory guards (per process, not the unit cage):

- pm2 `max_memory_restart: 1G` on the mcp app
- `--max-old-space-size=1024` (fixed in `ecosystem.config.cjs`)
- In-process heap watchdog (~85% of heap limit → clean `shutdown("MEMORY")`)

`MemoryMax=6G` is a hard ceiling for the **whole** website cgroup (web+mcp+sidequest+qdrant). It does not reserve RAM. Leaves headroom on an ~8G droplet for nginx, OS, and sGTM Docker.

### Cutover from legacy Sidequest systemd units

**Before** deploying a SHA that uses pm2 Sidequest, disable and remove the old units (otherwise two workers can fight):

```bash
sudo systemctl disable --now website-sidequest website-sidequest-restart.path 2>/dev/null || true
sudo rm -f /etc/systemd/system/website-sidequest.service \
           /etc/systemd/system/website-sidequest-restart.path \
           /etc/systemd/system/website-sidequest-restart.service
sudo rm -rf /etc/systemd/system/website-sidequest.service.d
sudo systemctl daemon-reload
```

Install `supervisor.conf` (above), then deploy. `deploy.sh` only restarts `website` (Sidequest rides with pm2).

**Rollback note:** reverting to a pre-pm2 SHA leaves Sidequest off unless you reinstall the old units — prefer revert-forward on `main`.

### Remote Sidequest restart (staff UI → signal)

The web process runs as `website-runtime` (no sudo). Webmasters restart Sidequest from **Background pipeline** or system alerts: the API sends **SIGTERM** to the PID in `data/sidequest.pid`; pm2 relaunches the worker. The flag file `data/sidequest.restart-requested` is audit/debounce only (not a systemd path-unit bridge).

Staff diagnostics: `GET /api/admin/sidequest/diagnostics`, log tail `GET /api/admin/sidequest/logs` (from `data/logs/sidequest.log`). Worker also writes `data/sidequest.heartbeat` (stale threshold `SIDEQUEST_HEARTBEAT_STALE_MS`, default 120000).

Until the web service flip, `deploy.sh` still builds releases and updates `current`, but the running service may keep using the legacy root tree — the script prints a WARNING if `WorkingDirectory` ≠ `…/current`.

---

## 6. Network / trust boundaries

### Target traffic

```text
Internet
  → Droplet Nginx :443 (TLS, Let’s Encrypt)
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
- Sidequest dashboard `:8678` (staff proxy via Express `/admin/sidequest`)
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
- `website-deployer` ∈ group `website-runtime` so deploy can prune `site_*/.cache` written by the app.
- Runtime user without interactive login where applicable.
- Emergency access: DigitalOcean Droplet Console (not SSH), not root over port 22.

**Secrets**

- Per-release `.env` mode `600`, owned by deploy/runtime user.
- sGTM `.env`: `chmod 600`.
- Never commit tokens or paste them into chat/logs.
- Do not leave permanent `127.0.0.1 metrics.4geeks.com` in `/etc/hosts`.

**TLS**

- Certbot per hostname only when that DNS already points at the droplet.
- Nginx serves the certificate directly to visitors (no proxy in between), so renewals must keep working: `certbot renew --dry-run` after changes.

### 7.2 Controls already applied (summary)

- Fail2ban jail `sshd` (journal backend on Ubuntu 24.04).
- Node / MCP / Qdrant listen on loopback on the VPS (`LISTEN_HOST=127.0.0.1` on droplet).
- Turnstile required in production start.
- Staff `/private` and edit APIs are not anonymous.
- MCP: `MCP_SERVER_SECRET` is a **loopback** credential (MCP → capability check), not a public API key for browsers.

### 7.3 SSH key diagram (do not mix)

| Pair | Direction | Role |
|------|-----------|------|
| Operator keys | Laptop → Droplet deploy user | Human ops |
| GHA deploy key | GitHub Actions → Droplet deploy user | Deploy |
| Git deploy key | Droplet → GitHub **code** repo | Fetch / archive |
| `GITHUB_TOKEN` (content) | App → GitHub **content** repo | YAML **pulls** / system / local commits |
| GitHub App Connect | Staff → content repo as themselves | Production **push** identity (`GITHUB_APP_*`) |

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
4. Code/runtime secrets vs content-repo token stay out of git.
5. `sites.yml` is not an app secret but is gitignored in the code repo.

Typical names (not values): `DATABASE_URL`, `SESSION_SECRET`, `SITE_URL`, `PORT`, `LISTEN_HOST`, `TURNSTILE_*`, `MCP_*`, `MCP_TOKEN_ENCRYPTION_KEY`, `EVENT_WEBHOOK_ENCRYPTION_KEY`, `LEAD_OUTBOX_ENCRYPTION_KEY`, `GITHUB_*` (content + App Connect), `GCS_*`, `OPENROUTER_API_KEY`, `VITE_BREATHECODE_HOST`, `QDRANT_URL`, `IPN_SECRET`, …

**Lead recovery key.** `LEAD_OUTBOX_ENCRYPTION_KEY` (64 hex, `openssl rand -hex 32`) encrypts the saved copy of each lead and the CRM's replies (pipeline tables `lead_outbox`, `lead_delivery_attempts`). Without it, leads still go to the CRM, but failed deliveries cannot be retried and the Leads page shows "Recovery is off". Only the web process needs it; automatic retries run only on the live server. Rotation:

1. Copy the current value into `LEAD_OUTBOX_ENCRYPTION_KEY_PREVIOUS` (only used to read leads saved before the change).
2. Set a new `LEAD_OUTBOX_ENCRYPTION_KEY` and redeploy.
3. After 30 days (saved copies expire by then), remove `LEAD_OUTBOX_ENCRYPTION_KEY_PREVIOUS`.

Losing both keys makes waiting leads unreadable: they move to Needs attention ("Saved copy unreadable") and their copy is erased.


MCP OAuth persistence across redeploys: see [`docs/runbooks/mcp-oauth-persistence.md`](runbooks/mcp-oauth-persistence.md).

### 7.5 Headers, rate limit, fail2ban nginx

Priority: **(1)** Nginx headers + API rate limits, **(2)** optional fail2ban nginx jail. With nothing in front of Nginx, the connecting IP is the visitor’s, so the jail bans real clients (no proxy edges to protect).

Suggested headers at origin (Nginx): `X-Content-Type-Options`, strict `Referrer-Policy`, frame policy / CSP as needed, HSTS only when visitors use prod HTTPS hostnames (not long HSTS on lab sslip).

There is no CDN country header: code that needs the visitor’s country uses the IP lookup in `server/ads/visitor-country.ts` (cached per IP).

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
| Node | 24.22.1+ system install (`/usr/bin/node`); deploy refuses older, see 4.4 |
| App root | `/opt/website-v3` |
| Process | `website.service` → `start-production.sh` → pm2-runtime (`web`, `mcp`, `sidequest`, `qdrant`) |
| Reverse proxy | Nginx 80/443 |
| Health | web `:5000/health`; MCP `:3001/health`; Sidequest liveness `data/sidequest.pid` |
| sGTM | `/opt/sgtm` Docker compose |

IP, hostname, and which DNS records already point here: check DigitalOcean and the domain’s DNS provider, not this file.

---

## 9. Cutover (pending)

**Done in lab:** app on droplet, sGTM Docker, Nginx metrics `/gtm/` → 8081, Preview on sslip.

**Public today:** app on the droplet; metrics on Stape until step A is done. Detail: [`sgtm-prod-cutover.md`](sgtm-prod-cutover.md).

### A — sGTM first (metrics only)

1. DNS: `metrics.4geeks.com` → droplet A record (leave Stape until flip).
2. VPS: `certbot --nginx -d metrics.4geeks.com`.
3. Confirm 443 still has `location ^~ /gtm/` → 8081.
4. Tagging `.env`: `PREVIEW_SERVER_URL=https://metrics.4geeks.com`.
5. Tagging: `extra_hosts: metrics.4geeks.com:host-gateway`.
6. `cd /opt/sgtm && docker compose down && docker compose up -d`.
7. GTM: Server container URL `https://4geeks.com/sgtm` (no sslip). New preview session.
8. Check `https://metrics.4geeks.com/healthy` → `ok` (not Stape).
9. Check `https://4geeks.com/sgtm/healthy`. `/ipn/` must not 502.
10. Turn off Stape.

Do **not** advance `PREVIEW_SERVER_URL` while metrics still points at Stape.

### B — App (4geeks + Florida) — done

The public sites run on the droplet and Replit is retired. For a new hostname: DNS A record → droplet IP, Certbot for that hostname, add it to the Nginx HTTPS `server_name`, then smoke-test the site, `/sgtm`, `/ipn` and a GitHub Actions deploy.

Rollback for A: point the metrics CNAME back to Stape.

---

## 10. Code pointers

| Path | Role |
|------|------|
| `.github/workflows/deploy-vps.yml` | Actions deploy + cancel-in-progress + lock |
| `scripts/deploy.sh` | Atomic release build / flip / prune |
| `server/component-registry-persistent.ts` | Registry mirror release → persistent |
| `docs/sgtm-prod-cutover.md` | sGTM cutover runbook |

---

## 11. CPU stack samples (perf)

The performance page stores a 20-second stack sample the first time the **web** process goes above 120% of one core. One sample per streak. The list is kept for 7 days. Staff with `metrics_view` see it. The names are rendered as text.

`kernel.perf_event_paranoid` stays at **4**. Do not set it to 2, 1, or 0. Do not `setcap` the `perf` binary. Do not run the recorder under PM2: every PM2 app runs as `website-runtime`, and this process must be a different user with capabilities the web app does not have.

### What runs where

| Piece | Where | Who |
|---|---|---|
| Recorder program | `scripts/cpu-capture/recorder.mjs`, copied to `/opt/cpu-capture/recorder.mjs` | root, mode `0755`. Not started from the release |
| Unit | `/etc/systemd/system/cpu-capture.service` on the droplet | not in this repo |
| Recordings | `/var/lib/cpu-capture/raw/<id>/` | owner `perf-capture`, group `website-runtime`, directory mode `2750` |
| Heartbeat | `/run/cpu-capture/heartbeat` | mode `0644`, rewritten every 30s |
| Last result | `/run/cpu-capture/status.json` | mode `0644` |
| Name map | `/tmp/perf-<pid>.map` | `website-runtime`, written by Node |
| Saved list | `data/process-stats.db` table `cpu_stacks` | web, on its 30s tick |

The recorder finds the web pid itself (`website-runtime` and `dist/index.js` in `/proc`). If two processes match, it records nothing and says so in `status.json`. It samples CPU from `/proc/<pid>/stat` about every 5 seconds. The command is fixed: `perf record -q -B -N -e cpu-clock:u -p <pid> -F 99 -g --max-size=32M`. It does not read the name map and it does not parse the recording.

The web process, on its tick, reads a finished directory, runs `perf script --force` as `website-runtime` (so it can read its own map), inserts the list, and deletes only its JSON. It does not delete `raw/`. The recorder deletes a recording after 15 minutes. Inserting again is ignored.

The heartbeat is not a lock. The page reads it when someone opens the detail. If it is missing or older than 2 minutes, the page says **Capture inactive**. `status.json` carries the last recording's error and a notice (two web processes, or the daily cap of 48).

The web app never launches `perf record`, including on a dev machine. Outside production the page does not look for the heartbeat.

Web keeps `--perf-basic-prof-only-functions` in `ecosystem.config.cjs`. That flag only writes the name map. Without it the page shows addresses instead of JavaScript function names. The diagnostics worker passes the same flag when it forks; the recorder does not sample that worker.

### Install (once, as root)

Do this after the app deploy that contains `scripts/cpu-capture/` is live. `website-deployer` must not own `/opt/cpu-capture`. Updating the script later is another root copy, not a normal deploy.

```bash
uname -r
sysctl kernel.perf_event_paranoid   # leave this at 4
apt-get install -y linux-tools-common linux-tools-generic linux-tools-$(uname -r)

# If an earlier experiment left a capability on a perf binary, remove it.
# getcap prints nothing when the file is clean. /usr/bin/perf is a script;
# the real binaries are under /usr/lib/linux-tools-*/perf.
getcap /usr/lib/linux-tools-*/perf || true
# setcap -r /usr/lib/linux-tools-<version>/perf

id perf-capture >/dev/null 2>&1 || useradd --system --no-create-home --shell /usr/sbin/nologin perf-capture
install -d -o perf-capture -g website-runtime -m 2750 /var/lib/cpu-capture/raw
install -d -o root -g root -m 0755 /opt/cpu-capture
install -o root -g root -m 0755 /opt/website-v3/current/scripts/cpu-capture/recorder.mjs /opt/cpu-capture/recorder.mjs
```

The unit is not in the repo. Write it on the droplet, the same way as `website.service`:

```ini
# /etc/systemd/system/cpu-capture.service
[Unit]
Description=Record CPU stacks for the website process
After=network.target

[Service]
User=perf-capture
Group=perf-capture
ExecStart=/usr/bin/node /opt/cpu-capture/recorder.mjs
Restart=on-failure
RestartSec=5
UMask=0027
AmbientCapabilities=CAP_PERFMON CAP_SYS_PTRACE
CapabilityBoundingSet=CAP_PERFMON CAP_SYS_PTRACE
NoNewPrivileges=yes
ProtectSystem=strict
ReadWritePaths=/var/lib/cpu-capture/raw
RuntimeDirectory=cpu-capture
RuntimeDirectoryMode=0755
ProtectHome=yes
PrivateTmp=yes
PrivateNetwork=yes
ProtectKernelModules=yes
RestrictNamespaces=yes
LockPersonality=yes
SystemCallArchitectures=native
SystemCallFilter=@system-service perf_event_open
LimitCORE=0
MemoryMax=256M
CPUQuota=20%
TasksMax=64

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now cpu-capture.service
```

The unit gives `CAP_PERFMON` and `CAP_SYS_PTRACE` as ambient capabilities, so only this service has them. `/usr/bin/perf` stays a normal file. The script writes the heartbeat and the status file as mode `0644` on purpose: the service umask is `0027`, and without that chmod `website-runtime` could not read them. `perf record` creates `perf.data` as mode `0600`. The recorder then chmods it to `0640` so the web user can run `perf script`. Without that chmod the page stores "Permission denied".

The running program is `/opt/cpu-capture/recorder.mjs`, not the file in the release. A deploy does not replace it. After this script changes, copy it again as root and restart the unit.

`PrivateTmp=yes` is set because the recorder never opens the name map. The web app reads `/tmp/perf-<pid>.map` in its own mount namespace. If the web service is later given `PrivateTmp`, the map will not be the host `/tmp` and JavaScript names will disappear; do not do that without moving the map.

`SystemCallFilter` and `ProtectKernelModules` are the settings most likely to make `perf` fail. If the journal shows the recording failing immediately, remove `SystemCallFilter` first, reload, and try one capture. Do not fix that by lowering the sysctl or by `setcap`.

### Check before leaving it on

```bash
# No file capabilities on perf.
getcap /usr/lib/linux-tools-*/perf || true

# The service holds only the two capabilities. CapEff is a bitmask:
# CAP_PERFMON is bit 38, CAP_SYS_PTRACE is bit 19.
pid=$(systemctl show -p MainPID --value cpu-capture.service)
grep ^Cap /proc/$pid/status
systemctl is-active cpu-capture.service

# The web user cannot record, and cannot write a recording.
sudo -u website-runtime /usr/bin/perf record -e cpu-clock:u -p $$ -o /tmp/cpu-capture-denied.data -- sleep 1
sudo -u website-runtime touch /var/lib/cpu-capture/raw/denied

# The web user can see the heartbeat.
sudo -u website-runtime cat /run/cpu-capture/heartbeat
```

Then cause one real spike (or wait for one) and confirm the performance page shows a stack, not "Capture inactive". A capture from a `setcap` experiment does not count. The recording has to come from this unit.

### When it looks idle

- **Capture inactive** on the page: the service is stopped or stuck. `systemctl status cpu-capture.service` and `journalctl -u cpu-capture.service -n 50`.
- Heartbeat is fresh and the list is empty: the web process has not gone above 120% since the service started. That is a quiet machine, not a failure.
- **Last recording failed** on the page: read `status.json`. After a kernel upgrade, install `linux-tools-$(uname -r)` for the running kernel (`uname -r`, not the login banner). `/usr/bin/perf` picks the tool that matches the running kernel. A new kernel package does nothing until reboot, and after reboot the matching tools package has to be installed or every recording fails with the service still "active".

### Name map

Node rewrites `/tmp/perf-<pid>.map` for the life of the process. Restarting web starts a new file. Do not truncate the map while the process is running. On startup the app deletes maps whose pid is already gone.

If `/tmp` is tmpfs, the live map is RAM. A few megabytes that then stop growing is expected. If it keeps growing, remove `--perf-basic-prof-only-functions` from the web app in `ecosystem.config.cjs` and from the diagnostics worker fork. Stacks still record; JavaScript names become addresses.

```bash
ls -lh /tmp/perf-*.map
findmnt -T /tmp
```
