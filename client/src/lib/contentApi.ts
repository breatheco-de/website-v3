import { getDebugToken, resolveAuthorName } from "@/hooks/useDebugAuth";
import type { EditOperation } from "@shared/schema";
import { encodeHtmlValues } from "@shared/htmlEncoding";

export interface ContentEditRequest {
  contentType: string;
  slug: string;
  locale: string;
  operations: EditOperation[];
  variant?: string;
  version?: number;
  /** "type_single" routes the save to single.{locale}.yml (or single-{variant}.{locale}.yml when variant is set) */
  layoutTarget?: string;
}

export interface ContentEditResponse {
  success: boolean;
  updatedSections?: unknown[];
  warning?: string;
  error?: string;
  /** Education: shared-template save HTML cache / async flush note (not a failure). */
  shared_template_html_cache?: string;
  boundUpdates?: string[];
}

export interface CommonEditRequest {
  contentType: string;
  slug: string;
  operations: { action: "update_field"; path: string; value: unknown }[];
}

export async function editCommonContent(request: CommonEditRequest): Promise<{ success: boolean; error?: string }> {
  const token = getDebugToken();
  const author = await resolveAuthorName();

  const response = await fetch("/api/content/edit-common", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Token ${token}` } : {}),
    },
    body: JSON.stringify(encodeHtmlValues({ ...request, author })),
  });

  if (response.ok) {
    return await response.json();
  } else {
    const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
    return { success: false, error: errorData.error || `Request failed with status ${response.status}` };
  }
}

export async function editContent(request: ContentEditRequest): Promise<ContentEditResponse> {
  const token = getDebugToken();
  const author = await resolveAuthorName();

  const doRequest = async (): Promise<Response> =>
    fetch("/api/content/edit-sections", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Token ${token}` } : {}),
      },
      body: JSON.stringify(encodeHtmlValues({
        ...request,
        author,
      })),
    });

  let response = await doRequest();

  if (response.status === 409) {
    const conflict = await response.clone().json().catch(() => null) as {
      code?: string;
      retryAfterMs?: number;
    } | null;
    if (conflict?.code === "binding_lease_active") {
      const waitMs = Math.min(3000, Math.max(500, conflict.retryAfterMs ?? 1500));
      await new Promise((r) => setTimeout(r, waitMs));
      response = await doRequest();
    }
  }

  if (response.ok) {
    return await response.json();
  } else {
    const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
    if (errorData.code === "binding_lease_active") {
      return {
        success: false,
        error: "This bound section is syncing to other pages. Please try again in a moment.",
      };
    }
    return {
      success: false,
      error: errorData.error || `Request failed with status ${response.status}`,
    };
  }
}
