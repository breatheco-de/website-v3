export type EditorType = "icon-picker" | "color-picker" | "image-picker" | "image-with-style-picker" | "link-picker";

export const fieldEditors: Record<string, EditorType> = {
  "cards[].icon": "icon-picker",
  "images[].image_id": "image-with-style-picker",
  "background": "color-picker",
  "cta.url": "link-picker",
};
