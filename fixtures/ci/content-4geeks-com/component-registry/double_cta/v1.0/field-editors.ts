export type EditorType = "icon-picker" | "color-picker:courses" | "color-picker:accent" | "image-picker" | "link-picker" | "image-with-style-picker" | "boolean-toggle";

export const fieldEditors: Record<string, EditorType> = {
  "left.image_id": "image-with-style-picker",
  "right.image_id": "image-with-style-picker",
  "left.image_beside_bullets": "boolean-toggle",
  "right.image_beside_bullets": "boolean-toggle",
  "left.cta_url": "link-picker",
  "right.cta_url": "link-picker",
};
