/**
 * Edit-mode hidden fields notice: which hidden values get a badge first.
 * Ranking reads names and settings only — no value is resolved here, so the
 * notice can resolve just the top badges on render and the rest on demand.
 */
import type { AuthSignupFieldMapEntry } from "@shared/authSignupFieldMap";

/** Why a lead form field is not rendered (staff copy keys). */
export type LeadFormHiddenReason =
  /** Built-in field hidden unless the form YAML turns it on. */
  | "builtin_default"
  /** `fields.<name>.visible: false` in the form YAML. */
  | "yaml"
  /** Signup form: value already known from the signed-in account. */
  | "signed_in_profile"
  /** `source` returned exactly one option: auto-selected. */
  | "single_source_option"
  /** `source` returned no options. */
  | "source_no_options"
  /** Page lists a single campus/region. */
  | "landing_location"
  /** Signup form, signed in, required fields filled: optional fields collapse. */
  | "collapsed_after_login"
  /** Extra `fields.*` key with no input on screen (e.g. event_id). */
  | "extra_key";

export const MAX_TOP_HIDDEN_BADGES = 4;

/**
 * Badge order: these groups first, then other extra keys (YAML order), then the
 * late groups, then signup keys (field map order).
 */
export const HIDDEN_FIELD_PRIORITY_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [
  ["program", "plan", "location", "region"],
  ["product", "persona"],
  ["coupon", "referral_key"],
];
export const HIDDEN_FIELD_LATE_GROUPS: ReadonlyArray<ReadonlyArray<string>> = [
  ["first_name", "last_name", "phone", "email"],
  ["client_comments", "current_download"],
];
const PRIORITY_GROUPS = HIDDEN_FIELD_PRIORITY_GROUPS;
const LATE_GROUPS = HIDDEN_FIELD_LATE_GROUPS;

export type HiddenBadgeRef =
  | { kind: "field"; name: string; hiddenReason: LeadFormHiddenReason }
  | { kind: "signup"; key: string; entry: AuthSignupFieldMapEntry };

export function hiddenBadgeId(ref: HiddenBadgeRef): string {
  return ref.kind === "field" ? `field:${ref.name}` : `signup:${ref.key}`;
}

export function rankHiddenBadges(input: {
  /** Hidden fields in YAML/slot order (built-in and extra keys). */
  fields: Array<{ name: string; hiddenReason: LeadFormHiddenReason }>;
  /** Signup field map entries to show, in map order. */
  signupEntries?: AuthSignupFieldMapEntry[];
  max?: number;
}): { top: HiddenBadgeRef[]; rest: HiddenBadgeRef[] } {
  const max = input.max ?? MAX_TOP_HIDDEN_BADGES;
  const byName = new Map(input.fields.map((f) => [f.name, f]));
  const placed = new Set<string>();
  const ordered: HiddenBadgeRef[] = [];

  const placeGroup = (names: ReadonlyArray<string>) => {
    for (const name of names) {
      const f = byName.get(name);
      if (!f || placed.has(name)) continue;
      placed.add(name);
      ordered.push({ kind: "field", name, hiddenReason: f.hiddenReason });
    }
  };

  for (const group of PRIORITY_GROUPS) placeGroup(group);
  const lateNames = new Set(LATE_GROUPS.flat());
  placeGroup(input.fields.map((f) => f.name).filter((n) => !lateNames.has(n)));
  for (const group of LATE_GROUPS) placeGroup(group);

  for (const entry of input.signupEntries ?? []) {
    ordered.push({ kind: "signup", key: entry.key, entry });
  }

  return { top: ordered.slice(0, max), rest: ordered.slice(max) };
}
