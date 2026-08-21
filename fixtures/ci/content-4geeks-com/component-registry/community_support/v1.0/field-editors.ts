/**
 * Field Editor Configuration for CommunitySupport Component
 *
 * Defines which fields in this component should use special editors
 * in the Props tab of the section editor panel.
 *
 * Do not use a "default:" variant prefix — sections often omit `variant`
 * when using CommunitySupportDefault, and prefixed keys would not match.
 */

export type EditorType =
  | "icon-picker"
  | "color-picker"
  | "image-picker"
  | "image-with-style-picker"
  | "link-picker";

export const fieldEditors: Record<string, EditorType> = {
  "bullet_groups[].icon": "icon-picker",
  "bullet_groups[].bullets[].icon": "icon-picker",
  "bullet_groups[].accent_color": "color-picker",
  "bullet_groups[].image": "image-picker",
  "bullet_groups[].button.url": "link-picker",
  image: "image-picker",
};
