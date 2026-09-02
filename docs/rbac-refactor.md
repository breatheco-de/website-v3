# RBAC refactor: webmaster → user_admin

## Post-deploy checklist

Anyone who previously held the **webmaster** role is migrated automatically to **user_admin** only.

1. Log in — **Security** (`/private/security`) still works via `user_admin`.
2. Assign yourself (and other operators):
   - **platform_steward** — diagnostics, SEO health, redirects, architecture reads
   - **platform_ops** — sites.yml, new sites, Sidequest restart/dashboard
3. Update MCP connectors:
   - `/mcp/role/user_admin`
   - `/mcp/role/platform_steward`
   - `/mcp/role/platform_ops`
4. Reconnect MCP hosts after role changes (tool list does not refresh mid-session).

**Temporary:** `/mcp/role/webmaster` aliases to `user_admin` with a deprecation warning.

## Built-in roles

| Role | Purpose |
|---|---|
| `user_admin` | Staff access management (`users_manage`) |
| `platform_steward` | Site health and SEO operations |
| `platform_ops` | Multi-site registry and background worker |
| `metrics_viewer` | Read-only metrics (unchanged) |
| `content_viewer` | Read-only content/MCP reads (unchanged) |
