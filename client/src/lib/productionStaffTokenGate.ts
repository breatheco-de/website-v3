/**
 * Dev-only bridge: non-React fetch helpers ask React to collect a production
 * staff token when the local API returns production_staff_token_required.
 */

export const PRODUCTION_STAFF_TOKEN_REQUIRED = "production_staff_token_required" as const;

export type ProductionStaffTokenPromptOpts = {
  productionOrigin: string;
  envVar: string;
  /** True when a previous paste in this flow was rejected by production. */
  rejected: boolean;
};

export type ProductionStaffTokenRequiredBody = {
  code: typeof PRODUCTION_STAFF_TOKEN_REQUIRED;
  productionOrigin?: string;
  envVar?: string;
  error?: string;
};

type PromptHandler = (opts: ProductionStaffTokenPromptOpts) => Promise<boolean>;

let handler: PromptHandler | null = null;
let inflight: Promise<boolean> | null = null;

export function registerProductionStaffTokenPrompt(next: PromptHandler | null): void {
  handler = next;
}

/** Returns true if a token was saved; false if the user cancelled. */
export function requestProductionStaffToken(
  opts: ProductionStaffTokenPromptOpts,
): Promise<boolean> {
  if (!import.meta.env.DEV) return Promise.resolve(false);
  if (inflight) return inflight;

  inflight = (async () => {
    if (!handler) return false;
    return handler(opts);
  })().finally(() => {
    inflight = null;
  });

  return inflight;
}

export function isProductionStaffTokenRequiredBody(
  body: unknown,
): body is ProductionStaffTokenRequiredBody {
  return (
    !!body &&
    typeof body === "object" &&
    (body as ProductionStaffTokenRequiredBody).code === PRODUCTION_STAFF_TOKEN_REQUIRED
  );
}

/**
 * On typed production-token 401, open one shared modal, POST the token, retry.
 * Cancel rejects. After a paste, further 401s reopen with rejected=true.
 */
export async function maybeRetryWithProductionStaffToken(
  res: Response,
  retry: () => Promise<Response>,
): Promise<Response> {
  if (!import.meta.env.DEV) return res;

  let current = res;
  let rejected = false;

  while (current.status === 401) {
    let body: unknown = null;
    try {
      body = await current.clone().json();
    } catch {
      return current;
    }
    if (!isProductionStaffTokenRequiredBody(body)) return current;

    const ok = await requestProductionStaffToken({
      productionOrigin: body.productionOrigin ?? "",
      envVar: body.envVar ?? "PRODUCTION_STAFF_TOKEN",
      rejected,
    });
    if (!ok) {
      throw new Error("Cancelled — production staff token was not provided.");
    }
    rejected = true;
    current = await retry();
  }

  return current;
}
