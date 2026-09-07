/**
 * Manifest of component types that declare server-side hooks. This is the
 * one place in the registry that names components; platform code resolves
 * hooks through it and stays component-agnostic. Loaders are dynamic imports
 * so a heavy component renderer is only loaded when its hook actually runs.
 */
import type { ComponentServerHooks } from "./_common/server-hooks";

const LOADERS: Record<string, () => Promise<{ hooks: ComponentServerHooks }>> = {
  geekchart: () => import("./geekchart/v1.0/server"),
};

const cache = new Map<string, Promise<ComponentServerHooks>>();

function load(type: string): Promise<ComponentServerHooks> | null {
  const loader = LOADERS[type];
  if (!loader) return null;
  let p = cache.get(type);
  if (!p) {
    p = loader().then((m) => m.hooks);
    cache.set(type, p);
  }
  return p;
}

/** Hooks for one component type, or null when it declares none. */
export function getComponentServerHooks(
  type: string,
): Promise<ComponentServerHooks> | null {
  return load(type);
}

/** Every registered hook set, for checks that must fan out (field updates). */
export function allComponentServerHooks(): Array<Promise<ComponentServerHooks>> {
  return Object.keys(LOADERS).map((type) => load(type)!);
}
