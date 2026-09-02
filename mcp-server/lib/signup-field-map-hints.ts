/**
 * MCP recovery when section identity fails for is_signup / auth.signup.field_map.
 */

import { actionRequired, type McpTextResult } from "./respond.js";

const SIGNUP_ERR_RE =
  /auth\.signup\.field_map|is_signup is true but|fields\.\w+\.required must be true|FORM_SIGNUP|when is_signup is true/i;

export function isSignupFieldMapError(errMsg: string): boolean {
  return SIGNUP_ERR_RE.test(errMsg);
}

function extractPropertyPath(errMsg: string): string {
  const sectionForm = errMsg.match(/sections\[\d+\][^\s,]*/);
  if (sectionForm) return sectionForm[0];
  const fields = errMsg.match(/fields\.\w+(?:\.required)?/);
  if (fields) return fields[0];
  if (/field_map/i.test(errMsg)) return "auth.signup.field_map";
  return "form.is_signup";
}

export function signupFieldMapActionRequired(
  errMsg: string,
  ctx?: { slug?: string; locale?: string; contentType?: string },
): McpTextResult {
  return actionRequired(
    {
      success: false,
      action_required: "fix_signup_field_map",
      message: errMsg,
      property_path: extractPropertyPath(errMsg),
      details: {
        slug: ctx?.slug,
        locale: ctx?.locale,
        contentType: ctx?.contentType,
      },
      warnings: [
        {
          code: "SIGNUP_FIELD_MAP",
          message:
            "Account gate (is_signup) must satisfy site auth.signup.field_map when allow_signup is not false. " +
            "conversion_info is always appended by runtime. Signup/login GTM names come from tracking.signup_event_name / login_event_name (aliases supported). " +
            "conversion_name is always required (catalog name or null/Off) — gate does not waive it. Prefer the site signup/login event as conversion_name when that is the form’s goal; if it equals the auth event, tracking fires once from auth.",
        },
      ],
    },
    [
      {
        tool: "explain_site",
        reason: "Read Require Signup / account gate + field_map contract",
        args_hint: { topic: "lead-forms" },
        priority: "required",
      },
      {
        tool: "update_fields",
        reason:
          "Set missing required form fields for field_map (typical plan: fields.plan.default \"{{ global.default_free_signup_plan | 4geeks-basic-subscription }}\") or set allow_signup:false for login-only",
        priority: "required",
      },
      {
        tool: "get_entry_fields",
        reason: "Re-read section after fix",
        priority: "optional",
        args_hint: {
          ...(ctx?.slug ? { slug: ctx.slug } : {}),
          ...(ctx?.locale ? { locale: ctx.locale } : {}),
          ...(ctx?.contentType ? { contentType: ctx.contentType } : {}),
        },
      },
    ],
  );
}
