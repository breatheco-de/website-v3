export type EditorType =
  | "icon-picker"
  | "link-picker"
  | "image-picker"
  | "text-input"
  | "string-picker:sm,md,lg";

export const fieldEditors: Record<string, EditorType> = {
  "url": "link-picker",
  "icon": "icon-picker",
  "size": "string-picker:sm,md,lg",
  "hover_text": "text-input",
};
