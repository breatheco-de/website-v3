/**
 * Field Editor Configuration for Apply Form Component
 *
 * Defines which fields in this component should use special editors
 * in the Props tab of the section editor panel.
 *
 * "form-appearance:<role>" keys render together in the Props tab Form box
 * (roles: shared/form-appearance.ts).
 */

export type EditorType = string;

export const fieldEditors: Record<string, EditorType> = {
  "form": "form-settings",
  "form.submit_label": "form-appearance:submit-label",
  "form.button_variant": "form-appearance:button-style",
  "form.variant": "form-appearance:layout",
};
