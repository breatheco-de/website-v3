/**
 * Typed Express route helper — every new /api route must declare a rate policy.
 */
import type { Express, RequestHandler } from "express";
import { createRateLimitMiddleware } from "./limiter.js";
import type { RatePolicyId } from "./types.js";

type ExemptOpts = { rate: "exempt"; reason: string };
type PolicyOpts = { rate: Exclude<RatePolicyId, "exempt"> };
export type ApiRateOpts = ExemptOpts | PolicyOpts;

function assertExemptReason(opts: ApiRateOpts): void {
  if (opts.rate === "exempt" && !opts.reason?.trim()) {
    throw new Error("api route with rate:exempt requires a non-empty reason");
  }
}

function rateMiddleware(opts: ApiRateOpts): RequestHandler {
  assertExemptReason(opts);
  if (opts.rate === "exempt") {
    return (_req, _res, next) => next();
  }
  return createRateLimitMiddleware(opts.rate);
}

type RouteMethod = "get" | "post" | "put" | "patch" | "delete";

function register(
  app: Express,
  method: RouteMethod,
  path: string,
  opts: ApiRateOpts,
  ...handlers: RequestHandler[]
): void {
  app[method](path, rateMiddleware(opts), ...handlers);
}

export const api = {
  get(app: Express, path: string, opts: ApiRateOpts, ...handlers: RequestHandler[]) {
    register(app, "get", path, opts, ...handlers);
  },
  post(app: Express, path: string, opts: ApiRateOpts, ...handlers: RequestHandler[]) {
    register(app, "post", path, opts, ...handlers);
  },
  put(app: Express, path: string, opts: ApiRateOpts, ...handlers: RequestHandler[]) {
    register(app, "put", path, opts, ...handlers);
  },
  patch(app: Express, path: string, opts: ApiRateOpts, ...handlers: RequestHandler[]) {
    register(app, "patch", path, opts, ...handlers);
  },
  delete(app: Express, path: string, opts: ApiRateOpts, ...handlers: RequestHandler[]) {
    register(app, "delete", path, opts, ...handlers);
  },
};
