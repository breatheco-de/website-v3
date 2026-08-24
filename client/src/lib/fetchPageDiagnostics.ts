import type { PageDiagnostics } from "@/components/DebugBubble/types";
import { getDebugToken } from "@/hooks/useDebugAuth";
import { getSessionHeaders } from "@/lib/sessionHeaders";

export async function fetchPageDiagnostics(
  url: string,
  variant?: string | null,
): Promise<PageDiagnostics> {
  const token = getDebugToken();
  const params = new URLSearchParams({ url });
  if (variant) params.set("variant", variant);
  const res = await fetch(`/api/diagnostics/page?${params.toString()}`, {
    headers: {
      ...getSessionHeaders(),
      ...(token ? { Authorization: `Token ${token}` } : {}),
    },
  });
  if (!res.ok) {
    let message = `Failed to load diagnostics (${res.status})`;
    try {
      const body = await res.json();
      if (typeof body?.error === "string" && body.error) message = body.error;
    } catch {}
    throw new Error(message);
  }
  return res.json();
}
