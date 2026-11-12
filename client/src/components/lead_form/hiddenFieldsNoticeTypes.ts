import type { AuthSignupFieldMapEntry } from "@shared/authSignupFieldMap";
import type { LeadFormOverrideOutcome } from "@shared/resolveLeadFormOverride";
import type { LeadFormHiddenReason } from "@/components/lead_form/hiddenFieldPriority";
import type {
  LeadFormFieldDefault,
  ResolvedLeadFormField,
} from "@/components/lead_form/resolveLeadFormFieldValues";

export type HiddenFieldsNoticeLocale = "en" | "es";

export type SignupValueSource = "form" | "session" | "constant" | "global";

/** One badge's resolved detail (computed on demand by LeadFormDefault). */
export type HiddenBadgeDetail =
  | {
      kind: "field";
      id: string;
      name: string;
      hiddenReason: LeadFormHiddenReason;
      resolved: ResolvedLeadFormField;
    }
  | {
      kind: "signup";
      id: string;
      key: string;
      entry: AuthSignupFieldMapEntry;
      source: SignupValueSource;
      /** form field name, session path, or global variable name. */
      sourcePath?: string;
      value: LeadFormFieldDefault | undefined;
      /** Hidden form field behind a `form.*` entry. */
      formField?: ResolvedLeadFormField;
      pending: boolean;
      viewerDependent: boolean;
    };

export interface LeadFormOverrideBadge {
  /** 1-based position in form_overrides. */
  number: number;
  outcome: LeadFormOverrideOutcome;
  /** Conditions read visitor data ({{ visitor.* }}). */
  viewerDependent: boolean;
}
