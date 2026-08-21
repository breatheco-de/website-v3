export type EditorType = string;

export const fieldEditors: Record<string, EditorType> = {
  "default:icon": "icon-picker",
  "default:tools_marquee": "boolean-toggle",
  "default:cta.banner": "boolean-toggle",
  "default:cta.buttons[]": "cta-picker",

  "drag_and_drop:icon": "icon-picker",
  "drag_and_drop:image_id": "image-picker",
  "drag_and_drop:tools_marquee": "boolean-toggle",
  "drag_and_drop:cta.banner": "boolean-toggle",
  "drag_and_drop:cta.buttons[]": "cta-picker",
  "drag_and_drop:courses[].color": "color-picker:courses",
  "drag_and_drop:courses[].icon": "icon-picker",

  "course_color_selector:icon": "icon-picker",
  "course_color_selector:image_id": "image-picker",
  "course_color_selector:tools_marquee": "boolean-toggle",
  "course_color_selector:cta.banner": "boolean-toggle",
  "course_color_selector:cta.buttons[]": "cta-picker",
  "course_color_selector:slot_colors[].color": "color-picker:courses",
  "course_color_selector:courses[].icon": "icon-picker",
  "course_color_selector:swap_icon": "icon-picker",
  "course_color_selector:draggable": "boolean-toggle",

  "simplified:icon": "icon-picker",
  "simplified:image_id": "image-picker",
  "simplified:show_details": "boolean-toggle",
  "simplified:show_markers": "boolean-toggle",
  "simplified:slot_colors[].color": "color-picker:courses",
  "simplified:courses[].cta_buttons[]": "cta-picker",
  "simplified:cta.banner": "boolean-toggle",
  "simplified:cta.buttons[]": "cta-picker",
};
