import { useMemo } from "react";
import { useLocation } from "wouter";
import UniversalImage from "@/components/UniversalImage";
import { RichTextContent } from "@/components/ui/rich-text-content";
import type { HeroBlogHero } from "@shared/schema";
import { normalizeFlexibleDate } from "@shared/normalizeFlexibleDate";
import { estimateReadingMinutes } from "@/lib/readingTime";
import { coerceToHtml } from "@/lib/variable-manager";

interface HeroBlogHeroProps {
  data: HeroBlogHero;
}

type BlogAuthor = {
  name: string;
  url?: string;
  imageId?: string;
};

function authorInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase();
}

function resolveAuthorImageId(o: Record<string, unknown>): string | undefined {
  for (const key of ["image", "_image"] as const) {
    const v = o[key];
    if (typeof v === "string" && v.trim() && !v.includes("{{")) return v.trim();
    if (v && typeof v === "object" && !Array.isArray(v)) {
      const rec = v as Record<string, unknown>;
      const src = rec.src ?? rec.id ?? rec.url;
      if (typeof src === "string" && src.trim() && !src.includes("{{")) return src.trim();
    }
  }
  return undefined;
}

function normalizeAuthors(raw: unknown): BlogAuthor[] {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  const out: BlogAuthor[] = [];
  for (const item of list) {
    if (typeof item === "string") {
      const t = item.trim();
      if (t && !t.includes("{{")) out.push({ name: t });
      continue;
    }
    if (item && typeof item === "object") {
      const o = item as Record<string, unknown>;
      const name =
        (typeof o.name === "string" && o.name.trim()) ||
        `${o.first_name || ""} ${o.last_name || ""}`.trim() ||
        (typeof o.slug === "string" ? o.slug : "");
      if (!name || name.includes("{{")) continue;
      const url = typeof o.url === "string" && o.url ? o.url : undefined;
      out.push({ name, url, imageId: resolveAuthorImageId(o) });
    }
  }
  return out;
}

function formatUpdatedAtLabel(iso: string, locale: string): string {
  try {
    return new Date(iso).toLocaleDateString(locale === "es" ? "es-ES" : "en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}

function resolveBlogHeroReadingMinutes(
  readingTime: HeroBlogHero["reading_time"],
): number | undefined {
  if (!readingTime) return undefined;

  const fixed = readingTime.value_in_minutes;
  if (typeof fixed === "number" && Number.isFinite(fixed) && fixed > 0) {
    return Math.max(1, Math.ceil(fixed));
  }

  const source = readingTime.from_content;
  if (typeof source !== "string" || !source.trim() || source.includes("{{")) {
    return undefined;
  }

  return estimateReadingMinutes(source);
}

export default function HeroBlogHero({ data }: HeroBlogHeroProps) {
  const [location] = useLocation();
  const locale = location.startsWith("/es") ? "es" : "en";

  const authors = useMemo(() => normalizeAuthors(data.authors), [data.authors]);

  const updatedIso =
    data.updated_at && !String(data.updated_at).includes("{{")
      ? normalizeFlexibleDate(data.updated_at)
      : null;

  const readingMinutes = useMemo(
    () => resolveBlogHeroReadingMinutes(data.reading_time),
    [data.reading_time],
  );

  const hasMeta = Boolean(updatedIso) || (typeof readingMinutes === "number" && readingMinutes > 0);
  const subtitleHtml = coerceToHtml(data.subtitle);

  return (
    <section data-testid="section-hero-blog" className="text-left">
      {hasMeta && (
        <div
          className="mb-4 flex flex-wrap items-center gap-2 text-sm text-muted-foreground"
          data-testid="hero-blog-meta"
        >
          {updatedIso && (
            <time dateTime={updatedIso} data-testid="hero-blog-updated-at">
              {formatUpdatedAtLabel(updatedIso, locale)}
            </time>
          )}
          {updatedIso && typeof readingMinutes === "number" && readingMinutes > 0 && (
            <span aria-hidden className="text-muted-foreground/60">
              ·
            </span>
          )}
          {typeof readingMinutes === "number" && readingMinutes > 0 && (
            <span data-testid="hero-blog-reading-time">{readingMinutes} min read</span>
          )}
        </div>
      )}

      <h1
        className="text-4xl md:text-h1 mb-4 text-foreground"
        data-testid="text-hero-title"
        dangerouslySetInnerHTML={{ __html: coerceToHtml(data.title) }}
      />

      {subtitleHtml && (
        <RichTextContent
          html={subtitleHtml}
          className="text-body text-muted-foreground max-w-3xl mb-6 leading-relaxed [&_p]:mb-0"
          data-testid="text-hero-subtitle"
        />
      )}

      {authors.length > 0 && (
        <ul
          className="flex flex-wrap items-center gap-4"
          data-testid="hero-blog-authors"
        >
          {authors.map((author, index) => {
            const initials = authorInitials(author.name);
            return (
              <li
                key={`${author.name}-${index}`}
                className="inline-flex items-center gap-2"
                data-testid={`hero-blog-author-${index}`}
              >
                {(() => {
                  const avatarInner = author.imageId ? (
                    <div
                      className="h-9 w-9 rounded-full overflow-hidden shrink-0"
                      data-testid={`hero-blog-author-avatar-${index}`}
                    >
                      <UniversalImage
                        id={author.imageId}
                        alt={author.name}
                        className="h-full w-full"
                        style={{ objectFit: "cover" }}
                        sizes="36px"
                        fieldContext={{ arrayPath: "authors", index }}
                      />
                    </div>
                  ) : (
                    <div
                      className="h-9 w-9 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0"
                      data-testid={`hero-blog-author-avatar-${index}`}
                      aria-hidden
                    >
                      {initials}
                    </div>
                  );

                  return author.url ? (
                    <a
                      href={author.url}
                      className="inline-flex items-center gap-2 text-foreground underline-offset-4 hover:underline"
                    >
                      {avatarInner}
                      <span className="text-sm font-medium">{author.name}</span>
                    </a>
                  ) : (
                    <>
                      {avatarInner}
                      <span className="text-sm font-medium text-foreground">{author.name}</span>
                    </>
                  );
                })()}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
