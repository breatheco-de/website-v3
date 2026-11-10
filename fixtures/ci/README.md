# CI content fixture

GitHub Actions does not have gitignored `site_*` folders. Before `vitest`, `.github/workflows/ci.yml` installs:

- `fixtures/ci/sites.fixture.yml` → `sites.yml`
- `fixtures/ci/content-4geeks-com/` → `site_4geeks-com/`

This is a **trimmed** seed for unit tests (`shared/schema.ts` imports + a few CT/settings stubs), not production content. It does not follow live content: refresh the registry and content types after pulling content, whenever Zod exports that `shared/schema.ts` re-exports change or a content type's settings (such as Optimize for ads) change:

```bash
npm run fixtures:refresh-ci
```

The script copies `site_4geeks-com/component-registry/` and `content-types.yml`, leaves fixture pages alone, and lists each ads-optimized content type with its fixture pages.

## SSR smoke pages

`server/ssr-smoke.test.ts` renders one fixture page for `landing` and for every ads-optimized content type with the real `client/src/entry-server.tsx`, and fails on an empty body. Each such type needs a page here (today `landings/ci-ssr-smoke/`, Spanish only, `noindex`). These pages are never served or pushed to the content repo.
