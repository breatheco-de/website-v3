/**
 * MCP envelope for the mandatory-consent publish gate (server code
 * `consent_no_mandatory_checkbox`, rule in shared/consent-settings.ts resolveConsentRequirement).
 */
import { CONSENT_REQUIRED_CODE, type ConsentGateForm } from "../../shared/formConsentCheck.js";
import { actionRequired, type McpTextResult, type NextAction } from "./respond.js";

function asForms(raw: unknown): ConsentGateForm[] {
  return Array.isArray(raw)
    ? raw.filter(
        (f): f is ConsentGateForm =>
          !!f && typeof f === "object" && typeof (f as ConsentGateForm).property_path === "string",
      )
    : [];
}

/** Publish blocked: a form on the page has no checkbox visitors must tick. */
export function consentRequiredResult(
  errMsg: string,
  data: Record<string, unknown>,
  ctx: { slug?: string; locale?: string; contentType?: string; variant?: string; retryTool: string },
): McpTextResult {
  const details = data.details as Record<string, unknown> | undefined;
  const forms = asForms(details?.consent_forms);
  const next_actions: NextAction[] = [
    {
      tool: "update_fields",
      priority: "required",
      reason: `Turn on General (mandatory) for each flagged form on the draft, then retry ${ctx.retryTool}. Or ask staff to turn on the site Default consent in Settings, which covers every such form.`,
      args_hint: {
        slug: ctx.slug,
        locale: ctx.locale ?? "en",
        contentType: ctx.contentType,
        ...(ctx.variant ? { variant: ctx.variant } : {}),
        updates: forms.map((f) => ({ field_path: f.fix_field_path, value: true })),
      },
    },
  ];
  return actionRequired(
    {
      success: false,
      action_required: "add_mandatory_consent",
      code: CONSENT_REQUIRED_CODE,
      message: errMsg,
      consent_forms: forms,
      property_paths: forms.map((f) => f.property_path),
      warnings: [
        {
          code: CONSENT_REQUIRED_CODE,
          message:
            "Every lead form needs one checkbox visitors must tick: General or Marketing (both mandatory when both are shown), else the first custom consent, else the site Default (Settings consent.fallback). " +
            "SMS, Email and WhatsApp are always optional and never count. Form consent = form consent + conversion event defaults; form_overrides that switch conversion_name are checked too. " +
            "Draft saves never block; publish does. Values sent to the CRM are unchanged.",
        },
      ],
    },
    next_actions,
  );
}
