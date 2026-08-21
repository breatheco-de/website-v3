export type EditorType =
  | "icon-picker"
  | "color-picker"
  | "image-picker"
  | "image-picker:logo"
  | "image-with-style-picker"
  | "link-picker"
  | "cta-picker"
  | "video-picker"
  | "text-input"
  | "rich-text-editor"
  | "boolean-toggle"
  | "string-picker";

export const fieldEditors: Record<string, EditorType> = {
  "items[].image": "image-picker:logo",
};
