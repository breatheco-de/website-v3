import { useMemo } from "react";
import type { BreadcrumbSection } from "@shared/schema";
import { normalizeTags } from "@shared/normalize-tags";
import { Badge } from "@/components/ui/badge";
import { BreadcrumbTrail } from "./breadcrumbTrail";

type BreadcrumbBlogWithTagsData = BreadcrumbSection & {
  variant?: "blogWithTags";
  tags?: unknown;
};

export default function BreadcrumbBlogWithTags({ data }: { data: BreadcrumbBlogWithTagsData }) {
  const items = data.items ?? [];
  const tags = useMemo(() => normalizeTags(data.tags), [data.tags]);

  if (!items.length) return null;

  return (
    <div className="flex flex-col gap-3">
      <BreadcrumbTrail items={items} />
      {tags.length > 0 && (
        <div
          className="flex flex-wrap items-center gap-2"
          data-testid="breadcrumb-blog-tags"
        >
          {tags.map((tag) => (
            <Badge
              key={tag}
              variant="secondary"
              className="rounded-full font-medium"
              data-testid={`breadcrumb-tag-${tag}`}
            >
              {tag}
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}
