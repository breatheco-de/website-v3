/**
 * Field Editor Configuration for GraduatesStats Component
 *
 * Defines which fields in this component should use special editors
 * in the Props tab of the section editor panel.
 *
 * EditorType options: "font-size-picker" | "image-with-style-picker" | "rich-text-editor"
 *
 * Pattern for array image fields:
 *   "arrayName[].fieldName": "image-with-style-picker"
 *
 * The image-with-style-picker editor reads and writes:
 *   - image_id      — registry ID of the selected image
 *   - object_position — CSS object-position (e.g. "center top")
 *   - object_scale  — CSS transform scale factor (e.g. 1.2)
 *   - transform_origin — CSS transform-origin (e.g. "50% 0%")
 *
 * Asymmetric variant (tall_image, stacked_images) uses plain string IDs
 * and cannot carry sibling positioning fields without a breaking schema
 * change — those fields are intentionally excluded here.
 */

export type EditorType = "font-size-picker" | "image-with-style-picker" | "rich-text-editor";

export const fieldEditors: Record<string, EditorType> = {
  "heading": "rich-text-editor",
  "value_size": "font-size-picker",
  "collage_images[].image_id": "image-with-style-picker",
  "featured_images[].image_id": "image-with-style-picker",
};
