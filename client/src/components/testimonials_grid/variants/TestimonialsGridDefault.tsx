import { Linkedin, Star } from "lucide-react";
import type { TestimonialsGridSection as TestimonialsGridSectionType } from "@shared/schema";
import { UniversalVideo } from "@/components/UniversalVideo";
import UniversalImage from "@/components/UniversalImage";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  isValidForGrid,
  testimonialText,
  type TestimonialBankRow,
} from "@shared/testimonials-listing";

interface GridItem {
  name: string;
  role: string;
  company?: string;
  comment: string;
  rating?: number;
  avatar?: string;
  linkedin_url?: string;
  /** Bank `featured` flag — picks the section's featured colors over the defaults. */
  featured?: boolean;
  media?: {
    url: string;
    type?: "image" | "video";
    ratio?: string;
  };
}

interface TestimonialsGridProps {
  data: TestimonialsGridSectionType;
}

function getInitials(name: string): string {
  return name
    .split(" ")
    .map(n => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function isVideoUrl(url: string): boolean {
  const videoExtensions = [".mp4", ".webm", ".mov", ".ogg", ".m4v"];
  const videoHosts = ["youtube.com", "youtu.be", "vimeo.com"];
  const lowerUrl = url.toLowerCase();
  return videoExtensions.some(ext => lowerUrl.endsWith(ext)) ||
    videoHosts.some(host => lowerUrl.includes(host));
}

function mapBankRowToGridItem(row: TestimonialBankRow): GridItem {
  const media = row.student_video
    ? { url: row.student_video, type: "video" as const, ratio: "16:9" }
    : row.media;

  return {
    name: row.student_name || "",
    role: row.role || "",
    company: row.company,
    comment: testimonialText(row),
    rating: row.rating,
    avatar: row.student_thumb,
    linkedin_url: row.linkedin_url,
    featured: row.featured === true,
    media,
  };
}

function distributeVideosAcrossColumns(items: GridItem[], columns: number): GridItem[] {
  if (columns <= 1 || items.length === 0) return items;

  const videoItems: GridItem[] = [];
  const nonVideoItems: GridItem[] = [];

  for (const item of items) {
    if (item.media?.type === "video" || (item.media?.url && isVideoUrl(item.media.url))) {
      videoItems.push(item);
    } else {
      nonVideoItems.push(item);
    }
  }

  if (videoItems.length === 0 || videoItems.length >= items.length) return items;

  const totalItems = items.length;
  const itemsPerColumn = Math.ceil(totalItems / columns);

  const columnBuckets: GridItem[][] = Array.from({ length: columns }, () => []);

  let videoIdx = 0;
  for (let col = 0; col < columns && videoIdx < videoItems.length; col++) {
    columnBuckets[col].push(videoItems[videoIdx]);
    videoIdx++;
  }
  for (let col = 0; col < columns && videoIdx < videoItems.length; col++) {
    columnBuckets[col].push(videoItems[videoIdx]);
    videoIdx++;
  }

  let nonVideoIdx = 0;
  for (let col = 0; col < columns; col++) {
    const targetSize = col < columns - 1 ? itemsPerColumn : totalItems - itemsPerColumn * (columns - 1);
    const remaining = Math.max(0, targetSize - columnBuckets[col].length);
    for (let i = 0; i < remaining && nonVideoIdx < nonVideoItems.length; i++) {
      columnBuckets[col].push(nonVideoItems[nonVideoIdx]);
      nonVideoIdx++;
    }
  }

  while (nonVideoIdx < nonVideoItems.length) {
    const minBucket = columnBuckets.reduce((minIdx, bucket, idx) =>
      bucket.length < columnBuckets[minIdx].length ? idx : minIdx, 0);
    columnBuckets[minBucket].push(nonVideoItems[nonVideoIdx]);
    nonVideoIdx++;
  }

  return columnBuckets.flat();
}

export function TestimonialsGrid({ data }: TestimonialsGridProps) {
  const columns = data.columns || 3;

  // `items` is resolved server-side from dynamic_entries (grid is bank-only).
  const items: GridItem[] = (() => {
    const rows = (data.items ?? []) as TestimonialBankRow[];
    const gridItems = rows.filter(isValidForGrid).map(mapBankRowToGridItem);
    return distributeVideosAcrossColumns(gridItems, columns);
  })();

  const title = data.title;
  const subtitle = data.subtitle;
  const defaultBoxColor = data.default_box_color || "hsl(var(--muted))";
  const defaultNameColor = data.default_name_color;
  const defaultRoleColor = data.default_role_color;
  const defaultCommentColor = data.default_comment_color;
  const defaultStarColor = data.default_star_color;
  const defaultLinkedinColor = data.default_linkedin_color;
  const background = data.background;

  if (items.length === 0) return null;

  const bgStyle: React.CSSProperties = {};
  if (background) {
    if (background.startsWith("linear-gradient") || background.startsWith("radial-gradient")) {
      bgStyle.backgroundImage = background;
    } else {
      bgStyle.backgroundColor = background;
    }
  }

  return (
    <section
      className="py-12 md:py-16"
      style={bgStyle}
      data-testid="section-testimonials-grid"
    >
      <div className="max-w-7xl mx-auto px-4 md:px-6">
        {(title || subtitle) && (
          <div className="text-center mb-10">
            {title && (
              <h2
                className="text-h2 mb-3 text-foreground"
                style={data.title_color ? { color: data.title_color } : undefined}
                data-testid="text-testimonials-grid-title"
              >
                {title}
              </h2>
            )}
            {subtitle && (
              <p
                className="text-body text-muted-foreground max-w-2xl mx-auto"
                style={data.subtitle_color ? { color: data.subtitle_color } : undefined}
                data-testid="text-testimonials-grid-subtitle"
              >
                {subtitle}
              </p>
            )}
          </div>
        )}

        <div
          className="gap-4 md:gap-5"
          style={{
            columnCount: 1,
            columnGap: "1.25rem",
          }}
          data-testid="testimonials-grid-container"
        >
          <style>{`
            @media (min-width: 768px) {
              [data-testid="testimonials-grid-container"] {
                column-count: ${Math.min(columns, 2)} !important;
              }
            }
            @media (min-width: 1024px) {
              [data-testid="testimonials-grid-container"] {
                column-count: ${columns} !important;
              }
            }
          `}</style>
          {items.map((item, index) => (
            <TestimonialGridCard
              key={index}
              item={item}
              boxColor={
                (item.featured ? data.featured_box_color : undefined) || defaultBoxColor
              }
              nameColor={
                (item.featured ? data.featured_name_color : undefined) ?? defaultNameColor
              }
              roleColor={
                (item.featured ? data.featured_role_color : undefined) ?? defaultRoleColor
              }
              commentColor={
                (item.featured ? data.featured_comment_color : undefined) ??
                defaultCommentColor
              }
              starColor={
                (item.featured ? data.featured_star_color : undefined) ?? defaultStarColor
              }
              linkedinColor={
                (item.featured ? data.featured_linkedin_color : undefined) ??
                defaultLinkedinColor
              }
              index={index}
            />
          ))}
        </div>
      </div>
    </section>
  );
}

interface TestimonialGridCardProps {
  item: GridItem;
  boxColor: string;
  nameColor?: string;
  roleColor?: string;
  commentColor?: string;
  starColor?: string;
  linkedinColor?: string;
  index: number;
}

function TestimonialGridCard({
  item,
  boxColor,
  nameColor,
  roleColor,
  commentColor,
  starColor,
  linkedinColor,
  index,
}: TestimonialGridCardProps) {
  const hasMedia = !!item.media?.url;
  const mediaType = item.media?.type || (item.media?.url && isVideoUrl(item.media.url) ? "video" : "image");

  return (
    <div
      className="break-inside-avoid mb-4 md:mb-5 rounded-[0.8rem] overflow-hidden"
      style={{ backgroundColor: boxColor }}
      data-testid={`card-testimonial-grid-${index}`}
    >
      {hasMedia && item.media && (
        <div className="w-full" data-testid={mediaType === "video" ? `video-media-${index}` : undefined}>
          {mediaType === "video" ? (
            <UniversalVideo
              url={item.media.url}
              ratio={item.media.ratio || "16:9"}
              className="w-full"
            />
          ) : (
            <div className="w-full aspect-video">
              <UniversalImage
                id={item.media.url}
                alt={`${item.name} testimonial`}
                className="w-full h-full"
                style={{ objectFit: "cover" }}
                data-testid={`img-media-${index}`}
              />
            </div>
          )}
        </div>
      )}

      <div className="p-5">
        <div className="flex items-center gap-3 mb-3">
          <Avatar className="w-10 h-10 flex-shrink-0 overflow-hidden" data-testid={`img-avatar-${index}`}>
            {item.avatar ? (
              <UniversalImage
                id={item.avatar}
                alt={item.name}
                className="w-full h-full"
                style={{ objectFit: "cover" }}
              />
            ) : (
              <AvatarFallback className="bg-foreground/10 text-foreground/70 text-sm font-semibold">
                {getInitials(item.name)}
              </AvatarFallback>
            )}
          </Avatar>
          <div className="flex-1 min-w-0">
            <p
              className="font-semibold text-foreground text-sm truncate"
              style={nameColor ? { color: nameColor } : undefined}
              data-testid={`text-name-${index}`}
            >
              {item.name}
            </p>
            <p
              className="text-xs text-muted-foreground truncate"
              style={roleColor ? { color: roleColor } : undefined}
              data-testid={`text-role-${index}`}
            >
              {item.role}
              {item.company && ` en ${item.company}`}
            </p>
          </div>
          {item.linkedin_url && (
            <a
              href={item.linkedin_url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex-shrink-0 text-muted-foreground"
              style={linkedinColor ? { color: linkedinColor } : undefined}
              data-testid={`link-linkedin-${index}`}
            >
              <Linkedin size={20} />
            </a>
          )}
        </div>

        <p
          className="text-muted-foreground text-sm leading-relaxed mb-3"
          style={commentColor ? { color: commentColor } : undefined}
          data-testid={`text-comment-${index}`}
        >
          {item.comment}
        </p>

        {item.rating && (
          <div className="flex items-center gap-0.5">
            {Array.from({ length: 5 }).map((_, i) =>
              i < item.rating! ? (
                <Star
                  key={i}
                  className="fill-current w-4 h-4 text-yellow-500"
                  style={starColor ? { color: starColor } : undefined}
                  data-testid={`icon-star-filled-${index}-${i}`}
                />
              ) : (
                <Star key={i} className="w-4 h-4 text-foreground/20" />
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export default TestimonialsGrid;
