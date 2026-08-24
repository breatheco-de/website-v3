import { useState } from "react";
import { ArrowRight, Calendar, ChevronLeft, ChevronRight, Loader2, Search, User } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { IS_SERVER } from "@/lib/initialData";
import { useLocation, useSearch } from "wouter";
import { apiFetch } from "@/lib/queryClient";
import { usePageMeta } from "@/hooks/usePageMeta";
import Header from "@/components/Header";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useInternalNav } from "@/hooks/useInternalNav";

interface BlogResponse {
  count: number;
  total: number;
  page?: number;
  totalPages?: number;
  hasNext?: boolean;
  hasPrev?: boolean;
  categories?: string[];
  results: Record<string, any>[];
}

interface BlogConfig {
  url_pattern: Record<string, string>;
}

const POSTS_PER_PAGE = 12;

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

function formatCategoryLabel(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function resolveFieldValue(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.join(",");
  if (typeof value === "object" && value !== null && "slug" in value) {
    return String((value as Record<string, unknown>).slug || "");
  }
  return String(value);
}

function buildPostUrl(pattern: string, post: Record<string, any>, locale: string): string {
  let result = pattern.replaceAll(":locale", locale);
  const paramMatches = result.match(/:([a-zA-Z_]+)/g) || [];
  for (const param of paramMatches) {
    const key = param.slice(1);
    let value = resolveFieldValue(post[key]);
    // Keep multi-param blog URLs well-formed when category is absent.
    if (!value && key === "category") value = "uncategorized";
    result = result.replaceAll(param, value);
  }
  result = result.replace(/\/\/+/g, "/");
  return result;
}

export default function BlogListingPage() {
  const [location, setLocation] = useLocation();
  const searchString = useSearch();
  const locale = location.startsWith("/es") ? "es" : "en";
  const handleLinkClick = useInternalNav();

  const params = new URLSearchParams(searchString);
  const currentPage = Math.max(1, parseInt(params.get("page") || "1", 10));
  const activeCategory = params.get("category") || "";
  const [searchQuery, setSearchQuery] = useState("");

  const { data: org } = useQuery<Record<string, any>>({
    queryKey: ["/api/schema/organization"],
    staleTime: 300000,
  });
  const siteName = org?.name || "";

  const apiParams = new URLSearchParams();
  apiParams.set("locale", locale);
  apiParams.set("page", String(currentPage));
  apiParams.set("limit", String(POSTS_PER_PAGE));
  if (activeCategory) apiParams.set("category", activeCategory);

  const { data, isLoading, error } = useQuery<BlogResponse>({
    queryKey: ["/api/blog/posts", locale, currentPage, activeCategory],
    queryFn: async () => {
      const response = await apiFetch(`/api/blog/posts?${apiParams.toString()}`);
      if (!response.ok) throw new Error("Failed to load blog posts");
      return response.json();
    },
  });

  const baseUrl = `/${locale}/blog`;
  const canonicalUrl = currentPage > 1 ? `${baseUrl}?page=${currentPage}` : baseUrl;
  const prevUrl = currentPage > 1 ? (currentPage === 2 ? baseUrl : `${baseUrl}?page=${currentPage - 1}`) : undefined;
  const nextUrl = data?.hasNext ? `${baseUrl}?page=${currentPage + 1}` : undefined;

  usePageMeta({
    page_title: locale === "es"
      ? `Blog${currentPage > 1 ? ` - Página ${currentPage}` : ""}${siteName ? ` | ${siteName}` : ""}`
      : `Blog${currentPage > 1 ? ` - Page ${currentPage}` : ""}${siteName ? ` | ${siteName}` : ""}`,
    description: locale === "es"
      ? "Lee las últimas noticias, tutoriales y artículos sobre programación, tecnología y educación en 4Geeks Academy."
      : "Read the latest news, tutorials and articles about coding, technology and education at 4Geeks Academy.",
    canonical_url: canonicalUrl,
    pagination_prev: prevUrl,
    pagination_next: nextUrl,
    robots: currentPage > 5 ? "noindex, follow" : undefined,
  }, locale);

  const { data: blogConfig } = useQuery<BlogConfig>({
    queryKey: ["/api/blog/config"],
    staleTime: 300000,
  });

  const urlPattern = blogConfig?.url_pattern?.[locale] || `/${locale}/blog/:slug`;

  const filteredPosts = (() => {
    if (!data?.results) return [];
    if (!searchQuery.trim()) return data.results;
    const query = searchQuery.toLowerCase();
    return data.results.filter(
      (post) =>
        post.title?.toLowerCase().includes(query) ||
        post.description?.toLowerCase().includes(query) ||
        (typeof post.category === "string" ? post.category : "").toLowerCase().includes(query)
    );
  })();

  const categories = data?.categories || [];
  const totalPages = data?.totalPages || 1;

  const buildPageUrl = (page: number, category?: string) => {
    const p = new URLSearchParams();
    if (page > 1) p.set("page", String(page));
    if (category) p.set("category", category);
    const qs = p.toString();
    return `/${locale}/blog${qs ? `?${qs}` : ""}`;
  };

  const handleCategoryClick = (cat: string) => {
    const next = activeCategory === cat ? "" : cat;
    setLocation(buildPageUrl(1, next || undefined));
  };

  const handlePageChange = (page: number) => {
    setLocation(buildPageUrl(page, activeCategory || undefined));
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const pageNumbers = (() => {
    const pages: (number | "...")[] = [];
    if (totalPages <= 7) {
      for (let i = 1; i <= totalPages; i++) pages.push(i);
    } else {
      pages.push(1);
      if (currentPage > 3) pages.push("...");
      const start = Math.max(2, currentPage - 1);
      const end = Math.min(totalPages - 1, currentPage + 1);
      for (let i = start; i <= end; i++) pages.push(i);
      if (currentPage < totalPages - 2) pages.push("...");
      pages.push(totalPages);
    }
    return pages;
  })();

  if (isLoading && !IS_SERVER) {
    return (
      <div className="min-h-screen flex items-center justify-center" data-testid="loading-blog">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center" data-testid="error-blog">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-foreground mb-2">
            {locale === "es" ? "Error al cargar el blog" : "Error loading blog"}
          </h1>
          <p className="text-muted-foreground">
            {locale === "es" ? "Intenta de nuevo más tarde." : "Please try again later."}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div data-testid="page-blog-listing">
      <Header />
      <div className="max-w-6xl mx-auto px-6 py-12">
        <div className="mb-10">
          <h1 className="text-4xl font-bold text-foreground mb-3" data-testid="text-blog-title">
            Blog
          </h1>
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
            <p className="text-lg text-muted-foreground" data-testid="text-blog-subtitle">
              {locale === "es"
                ? "Artículos, tutoriales y noticias sobre programación y tecnología"
                : "Articles, tutorials and news about coding and technology"}
            </p>
            <div className="relative max-w-md md:w-72 shrink-0">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder={locale === "es" ? "Buscar artículos..." : "Search articles..."}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10"
                data-testid="input-blog-search"
              />
            </div>
          </div>
          {categories.length > 0 && (
            <div className="flex items-center gap-2 flex-wrap" data-testid="section-category-cloud">
              <Badge
                variant={activeCategory === "" ? "default" : "outline"}
                className="cursor-pointer"
                onClick={() => handleCategoryClick("")}
                data-testid="chip-category-all"
              >
                {locale === "es" ? "Todos" : "All"}
              </Badge>
              {categories.map((cat) => (
                <Badge
                  key={cat}
                  variant={activeCategory === cat ? "default" : "outline"}
                  className="cursor-pointer"
                  onClick={() => handleCategoryClick(cat)}
                  data-testid={`chip-category-${cat}`}
                >
                  {formatCategoryLabel(cat)}
                </Badge>
              ))}
            </div>
          )}
        </div>

        {filteredPosts.length === 0 ? (
          <div className="text-center py-16" data-testid="text-blog-empty">
            <p className="text-muted-foreground text-lg">
              {searchQuery
                ? locale === "es"
                  ? "No se encontraron artículos."
                  : "No articles found."
                : locale === "es"
                  ? "No hay artículos disponibles."
                  : "No articles available."}
            </p>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" data-testid="grid-blog-posts">
              {filteredPosts.map((post) => {
                const postUrl = buildPostUrl(urlPattern, post, locale);
                const catSlug = typeof post.category === "string" ? post.category : "";
                return (
                  <a
                    key={post.id}
                    href={postUrl}
                    onClick={handleLinkClick}
                    className="block group"
                    data-testid={`link-blog-post-${post.slug}`}
                  >
                    <Card className="h-full overflow-visible hover-elevate transition-all">
                      {post.preview && (
                        <div className="aspect-video w-full overflow-hidden rounded-t-md">
                          <img
                            src={post.preview}
                            alt={post.title}
                            className="w-full h-full object-cover"
                            loading="lazy"
                            data-testid={`img-blog-post-${post.slug}`}
                          />
                        </div>
                      )}
                      <div className="p-5">
                        {catSlug && (
                          <Badge variant="secondary" className="mb-3" data-testid={`badge-category-${post.slug}`}>
                            {formatCategoryLabel(catSlug)}
                          </Badge>
                        )}
                        <h2
                          className="text-lg font-bold text-foreground mb-2 line-clamp-2 group-hover:text-primary transition-colors"
                          data-testid={`text-blog-post-title-${post.slug}`}
                        >
                          {post.title}
                        </h2>
                        <p
                          className="text-sm text-muted-foreground mb-4 line-clamp-3"
                          data-testid={`text-blog-post-desc-${post.slug}`}
                        >
                          {post.description}
                        </p>
                        <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                          <span className="flex items-center gap-1">
                            <User className="w-3 h-3" />
                            {getAuthorName(post.author, siteName)}
                          </span>
                          <span className="flex items-center gap-1">
                            <Calendar className="w-3 h-3" />
                            {formatDate(post.published_at || post.created_at, locale)}
                          </span>
                        </div>
                        <div className="mt-4 flex items-center gap-1 text-sm text-primary font-medium">
                          {locale === "es" ? "Leer más" : "Read more"}
                          <ArrowRight className="w-4 h-4" />
                        </div>
                      </div>
                    </Card>
                  </a>
                );
              })}
            </div>

            {totalPages > 1 && (
              <nav className="flex items-center justify-center gap-1 mt-10" aria-label="Pagination" data-testid="nav-pagination">
                <a
                  href={data?.hasPrev ? buildPageUrl(currentPage - 1, activeCategory || undefined) : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    if (data?.hasPrev) handlePageChange(currentPage - 1);
                  }}
                  aria-disabled={!data?.hasPrev}
                >
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={!data?.hasPrev}
                    data-testid="button-page-prev"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </Button>
                </a>
                {pageNumbers.map((p, i) =>
                  p === "..." ? (
                    <span key={`ellipsis-${i}`} className="px-2 text-muted-foreground select-none">
                      ...
                    </span>
                  ) : (
                    <a
                      key={p}
                      href={buildPageUrl(p as number, activeCategory || undefined)}
                      onClick={(e) => {
                        e.preventDefault();
                        handlePageChange(p as number);
                      }}
                    >
                      <Button
                        variant={p === currentPage ? "default" : "outline"}
                        size="icon"
                        data-testid={`button-page-${p}`}
                      >
                        {p}
                      </Button>
                    </a>
                  )
                )}
                <a
                  href={data?.hasNext ? buildPageUrl(currentPage + 1, activeCategory || undefined) : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    if (data?.hasNext) handlePageChange(currentPage + 1);
                  }}
                  aria-disabled={!data?.hasNext}
                >
                  <Button
                    variant="outline"
                    size="icon"
                    disabled={!data?.hasNext}
                    data-testid="button-page-next"
                  >
                    <ChevronRight className="w-4 h-4" />
                  </Button>
                </a>
              </nav>
            )}

            <div className="text-center mt-4 text-sm text-muted-foreground" data-testid="text-page-info">
              {locale === "es"
                ? `Página ${currentPage} de ${totalPages} · ${data?.total || 0} artículos`
                : `Page ${currentPage} of ${totalPages} · ${data?.total || 0} articles`}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
