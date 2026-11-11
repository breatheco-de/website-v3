/**
 * Field editors for Modal — twoColumn mirrors two_column / hero credibility editors.
 */
export type EditorType = string;

export const fieldEditors: Record<string, EditorType> = {
  form: "form-settings",
  // Form box (Props tab), roles: shared/form-appearance.ts
  "form.submit_label": "form-appearance:submit-label",
  "form.button_variant": "form-appearance:button-style",
  "form.variant": "form-appearance:layout",
  "twoColumn:left.image": "image-with-style-picker",
  "twoColumn:right.image": "image-with-style-picker",
  "twoColumn:left.heading":
    "rich-text-editor:custom-font-size,custom-letter-spacing,custom-line-height,custom-font-weight",
  "twoColumn:right.heading":
    "rich-text-editor:custom-font-size,custom-letter-spacing,custom-line-height,custom-font-weight",
  "twoColumn:left.description": "rich-text-editor",
  "twoColumn:right.description": "rich-text-editor",
  "twoColumn:left.bullets[].icon": "icon-picker",
  "twoColumn:right.bullets[].icon": "icon-picker",
  "twoColumn:left.bullet_icon": "icon-picker",
  "twoColumn:right.bullet_icon": "icon-picker",
  "twoColumn:left.buttons[].text": "text-input",
  "twoColumn:left.buttons[].url": "link-picker",
  "twoColumn:left.buttons[].variant": "string-picker:primary,secondary,outline,accent",
  "twoColumn:left.buttons[].icon": "icon-picker",
  "twoColumn:left.buttons[].items[].url": "link-picker",
  "twoColumn:right.buttons[].text": "text-input",
  "twoColumn:right.buttons[].url": "link-picker",
  "twoColumn:right.buttons[].variant": "string-picker:primary,secondary,outline,accent",
  "twoColumn:right.buttons[].icon": "icon-picker",
  "twoColumn:right.buttons[].items[].url": "link-picker",
};
