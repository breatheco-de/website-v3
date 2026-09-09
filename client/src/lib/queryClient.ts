import { QueryClient, QueryFunction, hashKey } from "@tanstack/react-query";
import { getSessionHeaders } from "./sessionHeaders";
import { getDebugToken } from "@/hooks/useDebugAuth";
import { getDevSiteOverride } from "./devSite";
import { maybeRetryWithProductionStaffToken } from "./productionStaffTokenGate";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export function apiFetch(url: string, init?: RequestInit): Promise<Response> {
  const doFetch = () =>
    fetch(url, {
      ...init,
      headers: {
        ...(init?.headers || {}),
        ...getSessionHeaders(),
      },
    });

  return doFetch().then((res) => maybeRetryWithProductionStaffToken(res, doFetch));
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const doFetch = () =>
    fetch(url, {
      method,
      headers: {
        ...(data ? { "Content-Type": "application/json" } : {}),
        ...getSessionHeaders(),
      },
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
    });

  const res = await maybeRetryWithProductionStaffToken(await doFetch(), doFetch);
  await throwIfResNotOk(res);
  return res;
}

export async function apiRequestWithAuth(
  method: string,
  url: string,
  data?: unknown,
): Promise<Response> {
  const doFetch = () => {
    const token = getDebugToken();
    return fetch(url, {
      method,
      headers: {
        ...(data ? { "Content-Type": "application/json" } : {}),
        ...getSessionHeaders(),
        ...(token ? { Authorization: `Token ${token}` } : {}),
      },
      body: data ? JSON.stringify(data) : undefined,
      credentials: "include",
    });
  };

  const res = await maybeRetryWithProductionStaffToken(await doFetch(), doFetch);
  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = Array.isArray(queryKey) ? (queryKey as string[]).join("/") : (queryKey as string);
    const doFetch = () =>
      fetch(url, {
        credentials: "include",
        headers: getSessionHeaders(),
      });

    const res = await maybeRetryWithProductionStaffToken(await doFetch(), doFetch);

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        queryFn: getQueryFn({ on401: "throw" }),
        queryKeyHashFn: (queryKey) => {
          const site = getDevSiteOverride();
          if (site) return hashKey([`__site:${site}`, ...queryKey]);
          return hashKey(queryKey);
        },
        refetchInterval: false,
        refetchOnWindowFocus: false,
        staleTime: Infinity,
        retry: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

// Preserve the QueryClient singleton across Vite HMR hot reloads.
// Without this guard, every HMR cycle re-evaluates this module and creates a
// fresh QueryClient — dropping the queryKeyHashFn and the in-memory cache,
// which can cause cross-site data leaks or unnecessary re-fetches in dev.
// import.meta.hot.data persists across module re-evaluations for the same module.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const hotData = (import.meta as any).hot?.data as { queryClient?: QueryClient } | undefined;

export const queryClient: QueryClient =
  (hotData?.queryClient) ?? makeQueryClient();

if ((import.meta as any).hot) {
  (import.meta as any).hot.data.queryClient = queryClient;
}
