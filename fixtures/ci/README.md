# CI content fixture

GitHub Actions does not have gitignored `site_*` folders. Before `vitest`, `.github/workflows/ci.yml` installs:

- `fixtures/ci/sites.fixture.yml` → `sites.yml`
- `fixtures/ci/content-4geeks-com/` → `site_4geeks-com/`

This is a **trimmed** seed for unit tests (`shared/schema.ts` imports + a few CT/settings stubs), not production content. Refresh the registry copy when Zod exports that `shared/schema.ts` re-exports change:

```bash
rsync -a --delete site_4geeks-com/component-registry/ fixtures/ci/content-4geeks-com/component-registry/
cp site_4geeks-com/content-types.yml fixtures/ci/content-4geeks-com/content-types.yml
```
