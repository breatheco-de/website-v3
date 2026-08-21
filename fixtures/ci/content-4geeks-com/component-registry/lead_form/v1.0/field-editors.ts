/**
 * Field Editor Configuration for Lead Form Component
 *
 * Lead form settings (conversion_name, is_signup, tags, consent, …) live at the
 * section root — the section IS the form. Use "." as the form-settings sentinel
 * so the Conversion tab resolves paths at the root (not under a nested `form` key).
 *
 * EditorType options: "icon-picker" | "color-picker" | "image-picker" | "link-picker" | "form-settings"
 */

export type EditorType =
  | "icon-picker"
  | "color-picker"
  | "image-picker"
  | "link-picker"
  | "form-settings";

export const fieldEditors: Record<string, EditorType> = {
  ".": "form-settings",
};
