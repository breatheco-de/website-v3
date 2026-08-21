export type EditorType =
  | "icon-picker"
  | "image-picker"
  | "image-with-style-picker"
  | "link-picker"
  | "text-input"
  | "string-picker"
  | "rich-text-editor"
  | "markdown";

export const fieldEditors: Record<string, EditorType> = {
  "left.image": "image-with-style-picker",
  "right.image": "image-with-style-picker",
  "left.heading": "rich-text-editor",
  "right.heading": "rich-text-editor",
  "left.description": "rich-text-editor",
  "right.description": "rich-text-editor",
  "left.description_extended_md": "markdown",
  "right.description_extended_md": "markdown",
  "left.bullets[].icon": "icon-picker",
  "right.bullets[].icon": "icon-picker",
  "left.bullet_icon": "icon-picker",
  "right.bullet_icon": "icon-picker",
  "benefit_items[].icon": "icon-picker",
  "cta_button.text": "text-input",
  "cta_button.url": "link-picker",
  "cta_button.variant": "string-picker:primary,secondary,outline",
  "cta_button.icon": "icon-picker",
};
