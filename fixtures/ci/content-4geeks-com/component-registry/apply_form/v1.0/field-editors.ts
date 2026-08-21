/**
 * Field Editor Configuration for Apply Form Component
 *
 * Defines which fields in this component should use special editors
 * in the Props tab of the section editor panel.
 *
 * EditorType options: "icon-picker" | "color-picker" | "image-picker" | "link-picker" | "form-settings"
 */

export type EditorType = "icon-picker" | "color-picker" | "image-picker" | "link-picker" | "form-settings";

export const fieldEditors: Record<string, EditorType> = {
  "form": "form-settings",
};
