export type EditorType = "icon-picker" | "color-picker" | "image-picker:logo" | "image-with-style-picker" | "link-picker" | "boolean-toggle";

export const fieldEditors: Record<string, EditorType> = {
  "slides[].image_id": "image-with-style-picker",
  "slides[].institution_logos[].image_id": "image-picker:logo",
  "slides[].cta.icon": "icon-picker",
  "slides[].cta.url": "link-picker",
  "vertical_cards": "boolean-toggle"
};
