---
name: Server controls, soft-reload atomicity & staff-auth in dev
description: Durable rules for the admin server-control feature — how soft reload must rebuild state, how staff auth behaves per-env, and the dev consequence of hard restart.
---

# Soft reload must rebuild derived state atomically

Any in-process "soft reload" that re-hydrates global singletons (site config
cache, site context map, etc.) must **build the new state off to the side and
commit only on success**, with a snapshot/restore rollback on failure.

**Why:** the first implementation reset the live config + context map *before*
proving the rebuild succeeded. A bad `sites.yml` or a constructor error then
left the process degraded (null map / repeated rebuild failures) while still
"running". A soft reload that can brick a healthy process is worse than no
reload. Code review blocked the task on exactly this.

**How to apply:** reset/rebuild helpers that null a live global then repopulate
it are unsafe for a running server. Prefer commit-on-success variants
(construct fresh → swap references) plus a snapshot/restore wrapper around the
whole config+map step. Verify by corrupting `sites.yml`, calling soft reload,
and confirming pages still serve (old state survives) before restoring.

# Staff auth bypasses in development

`requireStaffSession` (server/routes/_helpers.ts) returns `authorized: true` for
ANY request when `NODE_ENV !== "production"`, token or not. Every `/api/admin/*`
route relies on this shared gate.

**Why it matters:** curl-testing a staff endpoint in dev returns 200 without a
token — that is NOT a missing-auth bug; production still enforces a valid token.
Do not add extra auth to "fix" it; use the shared helper and trust it.

# Hard restart takes the dev server down for good

Hard restart triggers a real graceful process exit. Local `npm run dev` **has
no supervisor that relaunches on graceful exit**, so calling it in dev kills
the server until you start it again; the client `useHardRestart` poll
will hang at "restarting". It only completes on the VPS, where pm2-runtime
relaunches the process. Don't read the resulting connection-refused as a bug.
