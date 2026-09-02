/**
 * Suppress pipeline event emission during batched file marks (hub SEO members, binding apply).
 */
import { AsyncLocalStorage } from "async_hooks";

export type SaveBatchContext = {
  suppressPipelineEmit: boolean;
  reason?: "hub_seo_rewrite" | "binding_propagation";
};

const storage = new AsyncLocalStorage<SaveBatchContext>();

export function runInSaveBatch<T>(ctx: SaveBatchContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

export function getSaveBatchContext(): SaveBatchContext | undefined {
  return storage.getStore();
}

export function shouldSuppressPipelineEmit(): boolean {
  return storage.getStore()?.suppressPipelineEmit === true;
}
