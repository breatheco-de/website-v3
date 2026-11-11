/**
 * Form appearance roles — how a form looks and what it says (Props tab box).
 *
 * Components opt in from `field-editors.ts` by tagging their own YAML keys:
 *   "productShowcase:form_card_background": "form-appearance:background"
 *   "form_background": "form-appearance:background"
 *
 * Conversion settings (conversion name, fields, consent, success, webhook, rules,
 * step messages) belong to `form-settings` / the Forms tab and never get a role here.
 */

export const FORM_APPEARANCE_EDITOR = "form-appearance";

export type FormAppearanceGroup = "content" | "style";

export type FormAppearanceControl =
  | "rich-text"
  | "text"
  | "textarea"
  | "image"
  | "link"
  | "icon"
  | "color"
  | "choice";

export interface FormAppearanceChoice {
  value: string;
  label: string;
}

export interface FormAppearanceRoleDef {
  label: string;
  group: FormAppearanceGroup;
  control: FormAppearanceControl;
  colorType?: "background" | "text";
  choices?: FormAppearanceChoice[];
}

const BUTTON_STYLES: FormAppearanceChoice[] = [
  { value: "primary", label: "Primary" },
  { value: "secondary", label: "Secondary" },
  { value: "outline", label: "Outline" },
  { value: "accent", label: "Accent" },
];

/**
 * Catalog order is render order inside each group.
 * Title / subtitle / disclaimer are plain text: form cards render them as text, not HTML.
 */
export const FORM_APPEARANCE_ROLES = {
  title: { label: "Title", group: "content", control: "text" },
  subtitle: { label: "Subtitle", group: "content", control: "textarea" },
  disclaimer: { label: "Disclaimer", group: "content", control: "textarea" },
  image: { label: "Image", group: "content", control: "image" },
  "submit-label": { label: "Submit button text", group: "content", control: "text" },
  "login-link": { label: "Login link", group: "content", control: "rich-text" },
  "cta-text": { label: "Link button text", group: "content", control: "text" },
  "cta-url": { label: "Link button URL", group: "content", control: "link" },
  "cta-style": {
    label: "Link button style",
    group: "content",
    control: "choice",
    choices: BUTTON_STYLES,
  },
  "cta-icon": { label: "Link button icon", group: "content", control: "icon" },
  background: {
    label: "Background",
    group: "style",
    control: "color",
    colorType: "background",
  },
  "text-color": { label: "Text color", group: "style", control: "color", colorType: "text" },
  "terms-color": {
    label: "Terms and consent color",
    group: "style",
    control: "color",
    colorType: "text",
  },
  "button-style": {
    label: "Button style",
    group: "style",
    control: "choice",
    choices: BUTTON_STYLES,
  },
  layout: {
    label: "Layout",
    group: "style",
    control: "choice",
    choices: [
      { value: "stacked", label: "Stacked" },
      { value: "inline", label: "Side by side" },
    ],
  },
  "vertical-align": {
    label: "Vertical position",
    group: "style",
    control: "choice",
    choices: [
      { value: "top", label: "Top" },
      { value: "center", label: "Center" },
      { value: "bottom", label: "Bottom" },
    ],
  },
} as const satisfies Record<string, FormAppearanceRoleDef>;

export type FormAppearanceRole = keyof typeof FORM_APPEARANCE_ROLES;

const ROLE_ORDER = Object.keys(FORM_APPEARANCE_ROLES) as FormAppearanceRole[];

export interface FormAppearanceEntry {
  /** YAML path relative to the section (e.g. "form_card_background", "form.button_variant"). */
  path: string;
  role: FormAppearanceRole;
}

export function isFormAppearanceRole(value: string): value is FormAppearanceRole {
  return Object.prototype.hasOwnProperty.call(FORM_APPEARANCE_ROLES, value);
}

/**
 * "form-appearance:background" → "background".
 * Returns null for other editor types and for unknown roles.
 */
export function parseFormAppearanceRole(editorType: string): FormAppearanceRole | null {
  const [base, role] = editorType.split(":");
  if (base !== FORM_APPEARANCE_EDITOR || !role) return null;
  return isFormAppearanceRole(role) ? role : null;
}

export function isFormAppearanceEditor(editorType: string): boolean {
  return editorType.split(":")[0] === FORM_APPEARANCE_EDITOR;
}

/**
 * Split variant-resolved field editors into form appearance entries (catalog order)
 * and everything else. Unknown `form-appearance:*` roles land in `unknown` and are
 * left out of both, so they never render as loose rows.
 */
export function splitFormAppearanceEntries(fields: Record<string, string>): {
  entries: FormAppearanceEntry[];
  rest: Record<string, string>;
  unknown: string[];
} {
  const entries: FormAppearanceEntry[] = [];
  const rest: Record<string, string> = {};
  const unknown: string[] = [];
  for (const [path, editorType] of Object.entries(fields)) {
    if (!isFormAppearanceEditor(editorType)) {
      rest[path] = editorType;
      continue;
    }
    const role = parseFormAppearanceRole(editorType);
    if (role) entries.push({ path, role });
    else unknown.push(`${path}: ${editorType}`);
  }
  entries.sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role));
  return { entries, rest, unknown };
}

function parentPath(path: string): string {
  const idx = path.lastIndexOf(".");
  return idx === -1 ? "" : path.slice(0, idx);
}

/**
 * Object whose presence means the form/card renders.
 * Shared parent of the tagged keys (e.g. "signup_card"), otherwise the bound form
 * path. "" means the section root (always present).
 */
export function resolveFormAppearanceAnchor(
  paths: string[],
  formPath: string | null,
): string {
  if (paths.length === 0) return formPath ?? "";
  const parents = paths.map((p) => parentPath(p).split(".").filter(Boolean));
  const common: string[] = [];
  for (let i = 0; i < parents[0].length; i++) {
    const seg = parents[0][i];
    if (parents.every((p) => p[i] === seg)) common.push(seg);
    else break;
  }
  if (common.length > 0) return common.join(".");
  return formPath ?? "";
}

/** Sibling keys an image role writes next to its src (e.g. form_card_image_alt). */
export function imageSiblingPaths(path: string): {
  alt: string;
  objectFit: string;
  objectPosition: string;
} {
  return {
    alt: `${path}_alt`,
    objectFit: `${path}_object_fit`,
    objectPosition: `${path}_object_position`,
  };
}

/** Updates that clear a role: the key is removed, never written as an empty value. */
export function buildFormAppearanceClearUpdates(
  entry: FormAppearanceEntry,
): Record<string, undefined> {
  const updates: Record<string, undefined> = { [entry.path]: undefined };
  if (entry.role === "image") {
    const s = imageSiblingPaths(entry.path);
    updates[s.alt] = undefined;
    updates[s.objectFit] = undefined;
    updates[s.objectPosition] = undefined;
  }
  return updates;
}
