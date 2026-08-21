export type EditorType =
  | "icon-picker"
  | "color-picker"
  | "color-picker:background"
  | "image-picker"
  | "image-picker:logo"
  | "link-picker"
  | "boolean-toggle"
  | "select";

export const fieldEditors: Record<string, EditorType> = {
  "item_background_color": "color-picker:background",
  "item_badge_shape": "boolean-toggle",
  "colored_logos": "boolean-toggle",
  "cta": "link-picker",
  "items[].logos[].image_id": "image-picker:logo",
};
