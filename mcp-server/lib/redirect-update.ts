/**
 * Shared validation for update_redirect (MCP). Pure helpers — unit-tested without loopback.
 * Without `variant`: live redirects (edit_redirects). With `variant`: the page's own old
 * addresses on its draft (seo_edit for the page's type).
 */

export type RedirectUpdateAction = "add" | "delete" | "move";

export type RedirectUpdateInput = {
  action?: string;
  from?: string;
  to?: string;
  source?: string;
  before_from?: string;
  variant?: string;
  content_type?: string;
  slug?: string;
  confirm_overwrite_content?: boolean;
  confirm_live_edit?: boolean;
  locale?: string;
  site?: string;
  status?: number;
  priority?: string;
  removed_entry?: unknown;
};

type ValidationResult =
  | { ok: true; action: RedirectUpdateAction; draft: boolean }
  | { ok: false; message: string; details: Record<string, unknown> };

/**
 * Draft mode (`variant`): one of the page's own old addresses on its draft.
 * The page is named by content_type + slug + locale; `to` is never passed.
 */
function validateDraftRedirectInput(input: RedirectUpdateInput): ValidationResult {
  const action = input.action;
  if (action === "move") {
    return {
      ok: false,
      message:
        "action: move is not available on drafts. Page old addresses have no order; only custom-redirects.yml rules (live, edit_redirects) can be moved.",
      details: { code: "draft_move_not_allowed" },
    };
  }
  if (action !== "add" && action !== "delete") {
    return {
      ok: false,
      message: "With variant, action is add | delete.",
      details: { required: ["action"], allowed_actions: ["add", "delete"] },
    };
  }
  const extras: string[] = [];
  if (input.to) extras.push("to");
  if (input.before_from) extras.push("before_from");
  if (input.removed_entry) extras.push("removed_entry");
  if (input.priority) extras.push("priority");
  if (input.confirm_overwrite_content === true) extras.push("confirm_overwrite_content");
  if (input.confirm_live_edit === true) extras.push("confirm_live_edit");
  if (action === "add" && input.source) extras.push("source");
  if (extras.length) {
    return {
      ok: false,
      message:
        `Draft redirects take from + content_type + slug + locale + variant only. Do not pass ${extras.join(", ")}. ` +
        "The old address always points to this page; drafts never hide a live page, so overwrite/live confirms do not apply.",
      details: { code: "draft_extras_rejected", required: ["from", "content_type", "slug", "locale", "variant"], extras_rejected: extras },
    };
  }
  const missing: string[] = [];
  if (!input.from?.trim()) missing.push("from");
  if (!input.content_type?.trim()) missing.push("content_type");
  if (!input.slug?.trim()) missing.push("slug");
  if (!input.locale?.trim()) missing.push("locale");
  if (missing.length) {
    return {
      ok: false,
      message: `Draft redirects (variant) require ${missing.join(", ")}.`,
      details: { code: "draft_missing_args", required: ["from", "content_type", "slug", "locale", "variant"], missing },
    };
  }
  if (isRegexFrom(input.from!)) {
    return {
      ok: false,
      message:
        "Pattern (regex) redirects cannot live on a page or its draft. Add them to custom-redirects.yml with update_redirect without variant (edit_redirects).",
      details: { code: "draft_regex_not_allowed" },
    };
  }
  if (action === "delete" && input.source) {
    const expected = `${input.variant}.${input.locale}.yml`;
    if (!input.source.replace(/\\/g, "/").endsWith(`/${expected}`)) {
      return {
        ok: false,
        message: `With variant, source must be the draft file (…/${input.slug}/${expected}) or omitted.`,
        details: { code: "draft_source_mismatch", source: input.source, expected_file: expected },
      };
    }
  }
  return { ok: true, action, draft: true };
}

export function isCustomRedirectSource(source: string | undefined): boolean {
  return /(?:^|\/)custom-redirects\.yml$/.test(source || "");
}

export function isRegexFrom(from: string): boolean {
  return /\(.*\)|\[.*\]|\.\*|\.\+|\\d|\\w|\\s|\{\d+[,}]/.test(from);
}

export function isExternalDest(to: string): boolean {
  return /^https?:\/\//i.test(to.trim());
}

export function validateRedirectUpdateInput(input: RedirectUpdateInput): ValidationResult {
  if (input.variant?.trim()) return validateDraftRedirectInput(input);

  const action = input.action;
  if (action !== "add" && action !== "delete" && action !== "move") {
    return {
      ok: false,
      message: "action is required: add | delete | move",
      details: { required: ["action"], allowed_actions: ["add", "delete", "move"] },
    };
  }

  if (action === "add") {
    const missing: string[] = [];
    if (!input.from?.trim()) missing.push("from");
    if (!input.to?.trim()) missing.push("to");
    if (input.source) {
      return {
        ok: false,
        message:
          "action: add infers the store (dest-locale meta.redirects or custom-redirects.yml). Do not pass source. Required: from, to. Optional: before_from (custom file only), confirm_overwrite_content, confirm_live_edit.",
        details: { required: ["from", "to"], extras_rejected: ["source"] },
      };
    }
    if (missing.length) {
      return {
        ok: false,
        message: `action: add requires ${missing.join(" and ")}. Optional: before_from (custom-redirects.yml only), confirm_overwrite_content, confirm_live_edit.`,
        details: { required: ["from", "to"], missing },
      };
    }
  }

  if (action === "delete") {
    const extras: string[] = [];
    if (input.to) extras.push("to");
    if (input.before_from) extras.push("before_from");
    if (extras.length) {
      return {
        ok: false,
        message: `action: delete requires from and source. Do not pass ${extras.join(" or ")}.`,
        details: { required: ["from", "source"], extras_rejected: extras },
      };
    }
    const missing: string[] = [];
    if (!input.from?.trim()) missing.push("from");
    if (!input.source?.trim()) missing.push("source");
    if (missing.length) {
      return {
        ok: false,
        message: `action: delete requires ${missing.join(" and ")}. Optional: confirm_overwrite_content, confirm_live_edit.`,
        details: { required: ["from", "source"], missing },
      };
    }
  }

  if (action === "move") {
    const extras: string[] = [];
    if (input.to) extras.push("to");
    if (extras.length) {
      return {
        ok: false,
        message: "action: move requires from and before_from (custom-redirects.yml only). Do not pass to.",
        details: { required: ["from", "before_from"], extras_rejected: extras },
      };
    }
    const missing: string[] = [];
    if (!input.from?.trim()) missing.push("from");
    if (!input.before_from?.trim()) missing.push("before_from");
    if (missing.length) {
      return {
        ok: false,
        message: `action: move requires ${missing.join(" and ")}. Only custom-redirects.yml rules can be reordered.`,
        details: { required: ["from", "before_from"], missing },
      };
    }
    if (input.source && !isCustomRedirectSource(input.source)) {
      return {
        ok: false,
        message:
          "action: move fails on page meta.redirects. Only custom-redirects.yml rules can be reordered with before_from. Do not convert page aliases into the custom file.",
        details: { code: "move_page_yaml", source: input.source },
      };
    }
  }

  return { ok: true, action, draft: false };
}

/** field_path that writes a page's old addresses (`meta.redirects`), directly or via a whole `meta` value. */
export function touchesMetaRedirects(update: { field_path: string; value?: unknown }): boolean {
  const p = update.field_path.trim();
  if (/^meta\.redirects(?:$|[.[])/.test(p)) return true;
  return (
    p === "meta" &&
    !!update.value &&
    typeof update.value === "object" &&
    !Array.isArray(update.value) &&
    "redirects" in (update.value as Record<string, unknown>)
  );
}

export function failBeforeFromOnPageYaml(beforeFrom: string | undefined, writingCustom: boolean): {
  ok: false;
  message: string;
  details: Record<string, unknown>;
} | null {
  if (!beforeFrom?.trim() || writingCustom) return null;
  return {
    ok: false,
    message:
      "before_from is only valid when writing custom-redirects.yml. Page meta.redirects cannot be reordered. Omit before_from for page aliases, or add a custom-file rule instead.",
    details: { code: "before_from_page_yaml" },
  };
}

export type MissingConfirm = "confirm_overwrite_content" | "confirm_live_edit";

export function collectMissingConfirms(opts: {
  needsOverwrite: boolean;
  needsLiveEdit: boolean;
  confirm_overwrite_content?: boolean;
  confirm_live_edit?: boolean;
}): MissingConfirm[] {
  const missing: MissingConfirm[] = [];
  if (opts.needsOverwrite && !opts.confirm_overwrite_content) {
    missing.push("confirm_overwrite_content");
  }
  if (opts.needsLiveEdit && !opts.confirm_live_edit) {
    missing.push("confirm_live_edit");
  }
  return missing;
}

export function stackedConfirmPayload(
  missing: MissingConfirm[],
): {
  action_required: string;
  missing_confirms: MissingConfirm[];
  message: string;
  options: string[];
} {
  const parts: string[] = [];
  if (missing.includes("confirm_overwrite_content")) {
    parts.push(
      "This hides or unhides a live content URL (contentIndex.isKnownUrl). Locale-home aliases (/ , /en, /es, /us) are not live. Ask the user first, then re-call with confirm_overwrite_content: true.",
    );
  }
  if (missing.includes("confirm_live_edit")) {
    parts.push(
      "The dest-locale YAML has versioning.yml. Ask before live edit, then re-call with confirm_live_edit: true. Overwrite confirm does not imply live confirm.",
    );
  }
  return {
    action_required: "confirm_flags",
    missing_confirms: missing,
    message: `Ask the user, then re-call update_redirect with every listed flag: ${missing.join(", ")}. ${parts.join(" ")}`,
    options: missing.map((flag) => `Pass ${flag}: true`),
  };
}
