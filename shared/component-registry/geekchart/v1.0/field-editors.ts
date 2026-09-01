/**
 * Field Editor Configuration for Chart Component
 *
 * source, caption, and duration are plain scalar fields with no special
 * picker — the generated Props UI (text area / number input) is enough.
 */

export type EditorType = "icon-picker" | "color-picker" | "image-picker" | "image-picker:logo" | "link-picker" | "text-input" | "rich-text-editor" | "markdown";

export const fieldEditors: Record<string, EditorType> = {};
