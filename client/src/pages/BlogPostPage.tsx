import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Calendar, Clock, Loader2, User } from "lucide-react";
import { useLocation, useParams } from "wouter";
import { apiFetch } from "@/lib/queryClient";
import { usePageMeta } from "@/hooks/usePageMeta";
import Header from "@/components/Header";
import { useInternalNav } from "@/hooks/useInternalNav";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { UniversalImage } from "@/components/UniversalImage";
import { SectionContextProvider } from "@/contexts/SectionContext";
import LocaleUnavailable, {
  type LocaleUnavailableInfo,
} from "@/components/LocaleUnavailable";


function formatDate(dateStr: string, locale: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString(locale === "es" ? "es-ES" : "en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

function getAuthorName(author: Record<string, any> | null, siteName: string): string {
  if (!author) return siteName;
  return `${author.first_name || ""} ${author.last_name || ""}`.trim() || siteName;
}

export default function BlogPostPage() {
  const [location] = useLocation();
  const locale = location.startsWith("/es") ? "es" : "en";
  const params = useParams();
  const wildcard = (params as Record<string, string>)["*"] || params.slug || "";
  const segments = wildcard.split("/").filter(Boolean);
  const slug = segments[segments.length - 1] || "";
  const handleLinkClick = useInternalNav();

  const { data: org } = useQuery<Record<string, any>>({
    queryKey: ["/api/schema/organization"],
    staleTime: 300000,
  });
  const siteName = org?.name || "";

  const { data: post, isLoading, error, failureReason } = useQuery<Record<string, any>>({
    queryKey: ["/api/blog/posts", slug, locale],
    queryFn: async () => {
      const response = await apiFetch(`/api/blog/posts/${slug}?locale=${locale}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        if (body?.error === "locale_unavailable" || body?.code === "EMPTY_LOCALE") {
          const err = new Error("locale_unavailable") as Error & {
            localeUnavailable?: LocaleUnavailableInfo;
          };
          err.localeUnavailable = body;
          throw err;
        }
        throw new Error("Blog post not found");
      }
      return response.json();
    },
    enabled: !!slug,
  });

  const localeUnavailable = (
    failureReason as (Error & { localeUnavailable?: LocaleUnavailableInfo }) | null
  )?.localeUnavailable;

  const markdownContent = post?.content || "";

  usePageMeta(
    post
      ? {
          page_title: `${post.title}${siteName ? ` | ${siteName}` : ""}`,
          description: post.description || "",
          og_image: post.preview || undefined,
        }
      : undefined,
    locale
  );

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center" data-testid="loading-blog-post">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (localeUnavailable) {
    return <LocaleUnavailable info={localeUnavailable} pageLocale={locale} />;
  }

  if (error || !post) {
    return (
      <div data-testid="error-blog-post">
        <Header />
        <div className="min-h-screen flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-foreground mb-2">
              {locale === "es" ? "Artículo no encontrado" : "Article not found"}
            </h1>
            <p className="text-muted-foreground mb-6">
              {locale === "es"
                ? "El artículo que buscas no existe."
                : "The article you're looking for doesn't exist."}
            </p>
            <a
              href={`/${locale}/blog`}
              onClick={handleLinkClick}
              className="text-primary hover:underline flex items-center justify-center gap-1"
              data-testid="link-back-to-blog"
            >
              <ArrowLeft className="w-4 h-4" />
              {locale === "es" ? "Volver al blog" : "Back to blog"}
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div data-testid={`page-blog-post-${post.slug}`}>
      <Header />
      <article className="max-w-3xl mx-auto px-6 py-12">
        <div className="flex items-center justify-between gap-4 mb-8">
          <a
            href={`/${locale}/blog`}
            onClick={handleLinkClick}
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
            data-testid="link-back-to-blog"
          >
            <ArrowLeft className="w-4 h-4" />
            {locale === "es" ? "Volver al blog" : "Back to blog"}
          </a>

          {typeof post.category === "string" && post.category && (
            <span className="text-xs font-medium text-primary uppercase tracking-wider" data-testid="text-blog-category">
              {post.category}
            </span>
          )}
        </div>

        <h1
          className="text-3xl md:text-4xl font-bold text-foreground mb-4 leading-tight"
          data-testid="text-blog-post-title"
        >
          {post.title}
        </h1>

        {post.description && (
          <p className="text-lg text-muted-foreground mb-6" data-testid="text-blog-post-description">
            {post.description}
          </p>
        )}

        <div className="flex items-center gap-4 text-sm text-muted-foreground mb-8 flex-wrap">
          <span className="flex items-center gap-1" data-testid="text-blog-author">
            <User className="w-4 h-4" />
            {getAuthorName(post.author, siteName)}
          </span>
          <span className="flex items-center gap-1" data-testid="text-blog-date">
            <Calendar className="w-4 h-4" />
            {formatDate(post.published_at || post.created_at, locale)}
          </span>
          {post.duration > 0 && (
            <span className="flex items-center gap-1" data-testid="text-blog-duration">
              <Clock className="w-4 h-4" />
              {post.duration} min
            </span>
          )}
        </div>

        {post.preview && (
          <SectionContextProvider
            value={{
              isPriority: true,
              sectionIndex: 0,
              contentType: "blog",
              slug: post.slug ?? "",
              locale: locale ?? "",
              imageSizes: {},
            }}
          >
            <div className="mb-10 rounded-md overflow-hidden" data-testid="img-blog-post-hero">
              <UniversalImage
                id={post.preview}
                preset="hero-wide"
                alt={post.title}
                className="w-full object-cover"
                fieldContext={{ templateKey: "image" }}
              />
            </div>
          </SectionContextProvider>
        )}

        <div className="prose prose-neutral dark:prose-invert max-w-none" data-testid="content-blog-post-body">
          {markdownContent ? (
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                a: ({ href, children, ...props }) => (
                  <a href={href} target="_blank" rel="noopener noreferrer" {...props}>
                    {children}
                  </a>
                ),
                img: ({ src, alt, ...props }) => (
                  <img src={src} alt={alt || ""} className="rounded-md" loading="lazy" {...props} />
                ),
              }}
            >
              {markdownContent}
            </ReactMarkdown>
          ) : (
            <p className="text-muted-foreground text-center py-12" data-testid="text-no-content">
              {locale === "es" ? "El contenido de este artículo no está disponible." : "This article's content is not available."}
            </p>
          )}
        </div>

        {post.tags && post.tags.length > 0 && (
          <div className="mt-10 pt-6 border-t" data-testid="section-blog-tags">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm text-muted-foreground font-medium">
                {locale === "es" ? "Etiquetas:" : "Tags:"}
              </span>
              {post.tags.map((tag: string) => (
                <span
                  key={tag}
                  className="text-xs px-2 py-1 rounded-md bg-muted text-muted-foreground"
                  data-testid={`badge-tag-${tag}`}
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}
      </article>
    </div>
  );
}
