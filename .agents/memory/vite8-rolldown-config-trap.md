---
name: Vite 8 / Rolldown config bundling trap
description: Rolldown statically inlines server code when pre-bundling vite.config.ts; how to prevent it and handle the runtime fallout.
---

## The rule

When any file dynamically imported inside a Vite plugin hook uses **static top-level imports** of server-side TypeScript modules, Rolldown (Vite 8's bundler) follows the entire transitive import graph and tries to bundle it into the `.vite-temp/` config artifact. Relative imports that cross into `shared/` (e.g. `../shared/api-paths`) fail as `UNRESOLVED_IMPORT` during that bundling step.

**Why:** Rolldown treats all imports — static AND dynamic with literal string paths — as bundleable candidates when pre-bundling `vite.config.ts`.

## Two-layer fix

### Layer 1 — Prevent static bundling (Rolldown analysis time)

Replace literal dynamic import strings with **concatenated expressions**. Rolldown cannot statically analyze computed paths:

```ts
// BAD — Rolldown follows this:
const mod = await import("./content-index");

// GOOD — Rolldown cannot statically follow this:
const mod = await import("./content" + "-index" as string);
```

### Layer 2 — Handle runtime failure (execution time)

Even with concatenated paths, when the bundled config runs from `.vite-temp/*.mjs`, Node.js resolves relative `import()` paths relative to the **bundle file's location** (`.vite-temp/`), not the original source directory. The import fails at runtime.

Wrap the import in **try/catch** and fall back to a **tsx subprocess** that runs from the original source location:

```ts
try {
  const mod = await import("./content" + "-index" as string);
  // use mod
} catch {
  // Running from .vite-temp — spawn a subprocess with full TS resolution
  const { spawnSync } = await import("child_process");
  spawnSync(
    path.join(process.cwd(), "node_modules/.bin/tsx"),
    [path.join(process.cwd(), "server/navigation-eager-manifest-run.ts"), contentRoot || ""],
    { stdio: "inherit", cwd: process.cwd(), env: { ...process.env } },
  );
}
```

The subprocess runner (`navigation-eager-manifest-run.ts`) uses normal static imports and runs in a fresh tsx process where TypeScript module resolution works correctly.

## Key observations

- `import.meta.url` inside a Rolldown bundle still reports the **original source file path**, not the `.vite-temp/` bundle path — do NOT rely on it for "am I bundled?" detection.
- The `node_modules/@shared` symlink (`ln -sfn $(pwd)/shared node_modules/@shared`) fixes `@shared/*` alias resolution during Vite config pre-bundling. It must be created before `vite build` runs in the deployment build command.
- The VPS deploy (`scripts/deploy.sh`) handles both layers:
  1. `ln -sfn $(pwd)/shared node_modules/@shared` (after `npm ci`) — symlink for `@shared` alias
  2. `npm run build` — config pre-bundling succeeds (concatenated paths + symlink); server bundles alias `@shared` to `./shared`

## Files involved

- `server/navigation-eager-manifest.ts` — the vite plugin entry; has try/catch + subprocess fallback
- `server/navigation-eager-manifest-run.ts` — the subprocess runner with real static imports
- `scripts/deploy.sh` — the deployment build with symlink step
