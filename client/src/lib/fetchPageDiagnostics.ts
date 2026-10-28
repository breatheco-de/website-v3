import type { PageDiagnostics } from "@/components/DebugBubble/types";
import { getDebugToken } from "@/hooks/useDebugAuth";
import { getSessionHeaders } from "@/lib/sessionHeaders";

const LANGUAGE_NAMES: Record<string, string> = { en: "English", es: "Spanish" };

const languageName = (locale: unknown) =>
  typeof locale === "string" ? LANGUAGE_NAMES[locale] ?? locale : "this language";

function staffMessage(status: number, body: Record<string, unknown> | null): string {
  switch (body?.code) {
    case "missing_language_version": {
      const available = Array.isArray(body.available_locales) ? body.available_locales : [];
      const others = available.map(languageName).join(" and ");
      return others
        ? `This page has no ${languageName(body.locale)} version, only ${others}. Open the ${others} address of this page to see its details.`
        : `This page has no ${languageName(body.locale)} version on this server. It may have been deleted, or content needs to sync.`;
    }
    case "content_file_unreadable":
      return "This page's content file has a formatting error, so its details can't be read. Fix the file in the content editor, then reload.";
    case "no_matching_page":
      return "No page in the content files matches this address. It may have been deleted or renamed, it may come from a redirect or a custom route, or this server's content may need to sync.";
  }
  if (status === 401 || status === 403) {
    return "Your session doesn't allow viewing page details. Sign in again, or ask an admin for the Metrics Viewer role.";
  }
  if (status >= 500) return "The server hit an error while loading this page's details. Try again in a moment.";
  return typeof body?.error === "string" && body.error
    ? body.error
    : `Failed to load page details (${status})`;
}

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
    const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    throw new Error(staffMessage(res.status, body));
  }
  return res.json();
}
