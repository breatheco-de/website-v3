/**
 * Field Editor Configuration for Lead Form Component
 *
 * Lead form settings (conversion_name, is_signup, tags, consent, …) live at the
 * section root — the section IS the form. Use "." as the form-settings sentinel
 * so the Conversion tab resolves paths at the root (not under a nested `form` key).
 *
 * "form-appearance:<role>" keys render together in the Props tab Form box
 * (roles: shared/form-appearance.ts). Root `variant` (stacked / inline) is the
 * section variant, switched by the variant picker, so it gets no layout role.
 */

export type EditorType = string;

export const fieldEditors: Record<string, EditorType> = {
  ".": "form-settings",
  "title": "form-appearance:title",
  "subtitle": "form-appearance:subtitle",
  "submit_label": "form-appearance:submit-label",
  "button_variant": "form-appearance:button-style",
};
