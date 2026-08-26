import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebugAuth } from "@/hooks/useDebugAuth";
import { getSessionHeaders } from "@/lib/sessionHeaders";

export interface GitHubUserConnection {
  connected: boolean;
  required: boolean;
  githubLogin?: string;
  expiresAt?: number;
  appConfigured: boolean;
  education?: {
    summary: string;
    advanced: string[];
  };
}

export function useGitHubUserConnection() {
  const { hasToken, isDevelopment, isValidated } = useDebugAuth();
  const queryClient = useQueryClient();
  const enabled = isDevelopment || (hasToken && isValidated !== false);

  const { data, isLoading, isFetching, refetch } = useQuery<GitHubUserConnection>({
    queryKey: ["/api/github/user-connection"],
    enabled,
    queryFn: async () => {
      const res = await fetch("/api/github/user-connection", {
        credentials: "include",
        headers: getSessionHeaders(),
      });
      if (!res.ok) {
        throw new Error(`Failed to load GitHub connection (${res.status})`);
      }
      return res.json();
    },
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const needsConnect = Boolean(data?.required && !data?.connected);
  const showCritical = needsConnect;

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["/api/github/user-connection"] });

  return {
    connection: data ?? null,
    isLoading,
    isFetching,
    refetch,
    invalidate,
    needsConnect,
    showCritical,
  };
}

/** Fetch authorize URL with staff session, then full-page redirect to GitHub. */
export async function startGitHubConnect(): Promise<void> {
  try {
    const res = await fetch("/api/github/oauth/start?format=json", {
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...getSessionHeaders(),
      },
    });
    const data = (await res.json()) as { url?: string; error?: string };
    if (!res.ok || !data.url) {
      alert(data.error || `GitHub Connect failed (${res.status})`);
      return;
    }
    window.location.href = data.url;
  } catch (err) {
    alert(
      err instanceof Error ? err.message : "Failed to start GitHub Connect",
    );
  }
}

/** Clear the stored per-user GitHub token so staff can reconnect. */
export async function disconnectGitHub(): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/github/user-connection", {
      method: "DELETE",
      credentials: "include",
      headers: getSessionHeaders(),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return {
        ok: false,
        error: data.error || `Failed to disconnect GitHub (${res.status})`,
      };
    }
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to disconnect GitHub",
    };
  }
}
