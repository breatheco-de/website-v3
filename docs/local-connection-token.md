# Local connection token (dev bootstrap)

The Caxton **connection token** (`npx caxton-cms token`) is a **local shared secret** for staff Debug-bubble sign-in and MCP auth when GitHub staff login is not available (typical: `localhost`).

It is **not** production staff identity. Never mint or enable it on a live server.

## What it creates

1. `.local/connection-token` — the secret (`wfy_…`)
2. `.local/connection-owner` — the **chosen** local username you will sign in as
3. A staff user with `connectionTokenOwner: true` (Security badge: **Local bootstrap**)

Anyone who knows the token **is** that local user (owner role pack). Grant capabilities (e.g. Database Manager / Edit database data) on **that** Security card — not on your Gmail / GitHub staff user.

## Mint / rotate

```bash
# Interactive: asks for a local username
npx caxton-cms token

# Non-interactive
npx caxton-cms token --user my-local-dev
```

Username rules: `^[a-z][a-z0-9_-]*$` — not an email. This does **not** bind the token to a real person.

Stop Caxton before re-minting if it is running. Re-running `token` defaults the prompt to the current owner; a new name migrates the flagged bootstrap user when possible.

Agentic local/cloud start also requires an owner (same prompt or `--user`).

## Production bans

| Action | Production behavior |
|---|---|
| `caxton-cms token` | Refused |
| Connection-token staff paste | Always denied |
| `WEBLIFY_ALLOW_CONNECTION_TOKEN_STAFF` | **Ignored**; if set in production mode → **process refuses to start** |
| GCS user-store sync | `connectionTokenOwner` users are **never** uploaded; stripped on download |

Stale `.local/connection-token` alone does **not** take the public site down — only the insecure allow-flag fails boot.

Use **GitHub staff login** on any public `SITE_URL`. See INSTALL.md staff auth section.

## Legacy `weblify-local`

Older installs used a hardcoded username `weblify-local`. On the next interactive `token` run, Caxton offers to reuse that name or pick a new one (and migrate the store key). Prefer a name that is unique on your machine.

## Files (gitignored)

- `.local/connection-token`
- `.local/connection-owner`
- Local `.multisite-user-store.json` may contain the flagged user — still **not** pushed to GCS

Optional env (same meaning as the owner file): `WEBLIFY_CONNECTION_OWNER`.

## Related

- [cli/README.md](../cli/README.md) — token / agentic overview
- [INSTALL.md](../INSTALL.md) — env table (`WEBLIFY_ALLOW_CONNECTION_TOKEN_STAFF`)
