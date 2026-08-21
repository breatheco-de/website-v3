import { z } from "zod";

export const componentMeta = {
  displayName: "Course Selector",
  description: "Tabbed card with selectable courses on the left and detailed course content on the right, with color-changing gradient background per tab",
};

export const courseBadgeSchema = z.object({
  icon: z.string().describe("Tabler icon name (e.g., 'Bolt', 'Code', 'Brain')"),
  text: z.string().describe("Badge text"),
});

export const courseTagSchema = z.object({
  icon: z.string().describe("Tabler icon name (e.g., 'Plus', 'Star')"),
  text: z.string().describe("Tag text displayed in muted-foreground color"),
});

export const courseItemSchema = z.object({
  name: z.string().describe("Tab label shown in the left panel"),
  icon: z.string().optional().describe("Optional Tabler icon name shown left of the course title (e.g., 'Bolt', 'Brain', 'Code')"),
  duration: z.string().describe("Duration text (e.g., '4 months part-time')"),
  label: z.string().optional().describe("Optional small badge shown next to duration (e.g., 'Updated in 2025')"),
  title: z.string().describe("Course title displayed prominently"),
  subtitle: z.string().optional().describe("Plain subtitle text (alternative to badges/tags)"),
  badges: z.array(courseBadgeSchema).optional().describe("Colored badges with icons (background matches course_background)"),
  tags: z.array(courseTagSchema).optional().describe("Muted inline tags with configurable icons"),
  description: z.string().describe("Course description paragraph"),
  price: z.string().optional().describe("Monthly price (e.g., '$328')"),
  price_period: z.string().optional().describe("Price period label shown after the price (e.g., '/mo', '/year'). Defaults to '/mo' when price is provided"),
  original_price: z.string().optional().describe("Original price shown crossed out (e.g., '$442')"),
  price_info: z.string().optional().describe("Additional pricing info, supports HTML (e.g., 'with <strong>TripleTen</strong> Installments')"),
  cta_text: z.string().describe("CTA button text"),
  cta_url: z.string().describe("CTA button URL"),
  course_background: z.string().optional().describe("Background color for course cards and badges (uses courses color picker)"),
});

export const courseSelectorSectionSchema = z.object({
  type: z.literal("course_selector"),
  version: z.string().optional().default("1.0"),
  variant: z.enum(["default", "solid", "spotlight"]).optional().default("default").describe("Visual variant: 'default' uses gradient background, 'solid' uses flat fill with edge-to-edge tabs, 'spotlight' shows all courses as cards in a spotlight layout (large card left + stacked cards right)"),
  heading: z.string().optional().describe("Optional section heading above the card"),
  subheading: z.string().optional().describe("Optional section subheading"),
  courses: z.array(courseItemSchema).min(1).describe("Array of course items, each rendered as a selectable tab"),
  background: z.string().optional().describe("Section background CSS class"),
});

export type CourseBadge = z.infer<typeof courseBadgeSchema>;
export type CourseTag = z.infer<typeof courseTagSchema>;
export type CourseItem = z.infer<typeof courseItemSchema>;
export type CourseSelectorSection = z.infer<typeof courseSelectorSectionSchema>;
