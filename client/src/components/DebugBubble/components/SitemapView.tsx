import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ArrowRight, ChevronDown, ChevronRight, Clipboard, Copy, Download, ExternalLink, FileText, Folder, History, Home, Info, MoreVertical, Pencil, Plus, RefreshCw, Search, Trash2, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { staff404DashboardHref } from "@/lib/staff404";
import type { MenuView, SitemapUrl } from "../types";
import { StatusCountBadge } from "./StatusCountBadge";
import type { RobotsSettingsResponse } from "@/components/settings/RobotsTab";
import { lookupValidationSummary } from "../validationSummaryLookup";

export interface SitemapFolder {
  name: string;
  path: string;
  urls: SitemapUrl[];
  subfolders: SitemapFolder[];
  contentType?: string;
}

interface SitemapViewProps {
  setMenuView: (v: MenuView) => void;
  sitemapUrls: SitemapUrl[];
  sitemapLoading: boolean;
  sitemapSearch: string;
  setSitemapSearch: (v: string) => void;
  showSitemapSearch: boolean;
  setShowSitemapSearch: (v: boolean) => void;
  sitemapPresenceFilter: "all" | "in-sitemap" | "not-in-sitemap";
  setSitemapPresenceFilter: (v: "all" | "in-sitemap" | "not-in-sitemap") => void;
  filteredSitemapUrls: SitemapUrl[];
  folders: SitemapFolder[];
  rootUrls: SitemapUrl[];
  expandedFolders: Set<string>;
  toggleFolder: (name: string) => void;
  setCreateContentModalOpen: (v: boolean) => void;
  handleDuplicatePage: (url: SitemapUrl) => void;
  handleDeletePage: (url: SitemapUrl) => void;
  handleDownloadYml: (url: SitemapUrl) => void;
  handleEditPageMeta: (url: SitemapUrl) => void;
  handleRefreshCache: (url: SitemapUrl) => void;
  validationSummary: Record<string, { errorCount: number; warningCount: number }>;
  onOpenDiagnosticsForUrl: (urlPath: string) => void;
}

function FolderContentTypeHint({ contentType }: { contentType: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="p-0.5 rounded-md text-muted-foreground hover-elevate flex-shrink-0"
          onClick={(e) => e.stopPropagation()}
          data-testid={`button-folder-content-type-${contentType}`}
        >
          <FileText className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        className="w-72 space-y-3"
        align="end"
        onClick={(e) => e.stopPropagation()}
        data-testid={`popover-folder-content-type-${contentType}`}
      >
        <p className="text-xs text-muted-foreground leading-snug">
          This is a content type. You can manage all the{" "}
          <span className="font-medium text-foreground">{contentType}</span>
          {" "}on the content type dashboard.
        </p>
        <Button size="sm" variant="secondary" className="w-full" asChild>
          <a
            href={staff404DashboardHref(contentType)}
            data-testid={`link-folder-dashboard-${contentType}`}
          >
            Take me to the {contentType} dashboard
            <ArrowRight className="h-3.5 w-3.5" />
          </a>
        </Button>
      </PopoverContent>
    </Popover>
  );
}

function ValidationBadge({
  url,
  path,
  pathOnly,
  validationSummary,
  onOpenDiagnosticsForUrl,
}: {
  url: SitemapUrl;
  path: string;
  pathOnly: string;
  validationSummary: Record<string, { errorCount: number; warningCount: number }>;
  onOpenDiagnosticsForUrl: (urlPath: string) => void;
}) {
  const entry = lookupValidationSummary(validationSummary, {
    contentType: url.content_type,
    slug: url.slug,
    locale: url.locale,
    path,
    pathOnly,
  });
  if (!entry) return null;

  return (
    <StatusCountBadge
      errorCount={entry.errorCount}
      warningCount={entry.warningCount}
      onClick={() => onOpenDiagnosticsForUrl(path)}
      testId={`badge-validation-${url.slug ?? pathOnly.replace(/\//g, "-")}`}
    />
  );
}

function excludeReasonCopy(reason?: string): { title: string; body: string } {
  switch (reason) {
    case "noindex":
      return {
        title: "Excluded by robots",
        body: "This page’s robots meta includes noindex, so it is left out of /sitemap.xml. It still exists and can be opened. Change robots under SEO → Visibility to index it.",
      };
    case "site_blocked":
      return {
        title: "Site indexing blocked",
        body: "The whole site is disallowed for search indexing, so every URL is excluded from /sitemap.xml until block indexing is turned off in settings.",
      };
    case "empty_detached":
      return {
        title: "Empty detached locale",
        body: "This locale is detached but empty, so it is not included in the sitemap.",
      };
    case "unresolved_url":
    case "unresolved_slug":
      return {
        title: "URL could not be resolved",
        body: "The page is missing a usable slug or URL pattern values, so it cannot be listed in the sitemap until those fields are fixed.",
      };
    default:
      return {
        title: "No sitemap",
        body: "This page exists but is excluded from /sitemap.xml. Indexing is controlled by robots (and site-wide indexing settings), not by whether the content folder exists.",
      };
  }
}

function RowStatusBadges({ url }: { url: SitemapUrl }) {
  const testIdBase = url.label.toLowerCase().replace(/\s+/g, "-");
  const showNotInSitemap = url.inSitemap === false && !url.isDraft;
  const { title, body } = excludeReasonCopy(url.excludeReason);

  return (
    <>
      {url.isDraft && (
        <Badge
          variant="secondary"
          className="shrink-0 text-[10px] px-1.5 py-0"
          data-testid={`badge-draft-${testIdBase}`}
        >
          Draft
        </Badge>
      )}
      {showNotInSitemap && (
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              className="inline-flex shrink-0"
              onClick={(e) => e.stopPropagation()}
              data-testid={`badge-not-in-sitemap-${testIdBase}`}
            >
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 cursor-pointer">
                no sitemap
              </Badge>
            </button>
          </PopoverTrigger>
          <PopoverContent
            className="w-72 space-y-1.5"
            align="end"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm font-medium">{title}</p>
            <p className="text-xs text-muted-foreground">{body}</p>
          </PopoverContent>
        </Popover>
      )}
    </>
  );
}

function UrlRowActions({
  url,
  menuTestIdPrefix,
  copyUrl,
  extractSlug,
  isBlogUrl,
  handleDuplicatePage,
  handleDeletePage,
  handleDownloadYml,
  handleEditPageMeta,
  handleRefreshCache,
}: {
  url: SitemapUrl;
  menuTestIdPrefix: string;
  copyUrl: (loc: string) => void;
  extractSlug: (loc: string) => string;
  isBlogUrl: (loc: string) => boolean;
  handleDuplicatePage: (url: SitemapUrl) => void;
  handleDeletePage: (url: SitemapUrl) => void;
  handleDownloadYml: (url: SitemapUrl) => void;
  handleEditPageMeta: (url: SitemapUrl) => void;
  handleRefreshCache: (url: SitemapUrl) => void;
}) {
  const id = url.label.toLowerCase().replace(/\s+/g, "-");
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className="flex-shrink-0 p-1 rounded bg-muted hover:bg-muted-foreground/20 transition-colors"
          onClick={(e) => e.stopPropagation()}
          data-testid={`button-url-menu-${menuTestIdPrefix}${id}`}
        >
          <MoreVertical className="h-3 w-3 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={() => copyUrl(url.loc)} className="text-[13px]" data-testid={`menu-copy-url-${menuTestIdPrefix}${id}`}>
          <Clipboard className="h-3.5 w-3.5 mr-2" />
          Copy URL
        </DropdownMenuItem>
        {isBlogUrl(url.loc) ? (
          <DropdownMenuItem onClick={() => { window.location.href = "/private/type/blog"; }} className="text-[13px]" data-testid={`menu-blog-manager-${menuTestIdPrefix}${id}`}>
            <ExternalLink className="h-3.5 w-3.5 mr-2" />
            Open Blog Manager
          </DropdownMenuItem>
        ) : (
          <>
            <DropdownMenuItem onClick={() => handleDuplicatePage(url)} className="text-[13px]" data-testid={`menu-duplicate-${menuTestIdPrefix}${id}`}>
              <Copy className="h-3.5 w-3.5 mr-2" />
              Duplicate
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleDownloadYml(url)} className="text-[13px]" data-testid={`menu-download-${menuTestIdPrefix}${id}`}>
              <Download className="h-3.5 w-3.5 mr-2" />
              Download YAML
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => { window.location.href = `/private/repository-sync?search=${encodeURIComponent(extractSlug(url.loc))}`; }}
              className="text-[13px]"
              data-testid={`menu-changelog-${menuTestIdPrefix}${id}`}
            >
              <History className="h-3.5 w-3.5 mr-2" />
              View Change Log
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => handleDeletePage(url)} className="text-[13px] text-destructive" data-testid={`menu-delete-${menuTestIdPrefix}${id}`}>
              <Trash2 className="h-3.5 w-3.5 mr-2" />
              Delete
            </DropdownMenuItem>
          </>
        )}
        <DropdownMenuItem onClick={() => handleEditPageMeta(url)} className="text-[13px]" data-testid={`menu-edit-page-meta-${menuTestIdPrefix}${id}`}>
          <Pencil className="h-3.5 w-3.5 mr-2" />
          Edit Page Meta
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleRefreshCache(url)} className="text-[13px]" data-testid={`menu-refresh-cache-${menuTestIdPrefix}${id}`}>
          <RefreshCw className="h-3.5 w-3.5 mr-2" />
          Refresh Cache
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function SitemapView({
  setMenuView,
  sitemapUrls,
  sitemapLoading,
  sitemapSearch,
  setSitemapSearch,
  showSitemapSearch,
  setShowSitemapSearch,
  sitemapPresenceFilter,
  setSitemapPresenceFilter,
  filteredSitemapUrls,
  folders,
  rootUrls,
  expandedFolders,
  toggleFolder,
  setCreateContentModalOpen,
  handleDuplicatePage,
  handleDeletePage,
  handleDownloadYml,
  handleEditPageMeta,
  handleRefreshCache,
  validationSummary,
  onOpenDiagnosticsForUrl,
}: SitemapViewProps) {
  const { toast } = useToast();
  const { data: robotsSettings } = useQuery<RobotsSettingsResponse>({
    queryKey: ["/api/settings/robots"],
  });
  const siteDisallowed = !!robotsSettings?.block_indexing;

  let inCount = 0;
  let notInCount = 0;
  for (const u of sitemapUrls) {
    if (u.inSitemap === false) notInCount += 1;
    else inCount += 1;
  }

  const copyUrl = async (loc: string) => {
    await navigator.clipboard.writeText(loc);
    toast({ title: "Copied", description: loc, duration: 2000 });
  };

  const LOCALE_PREFIXES = new Set(["en", "es", "us"]);

  const extractSlug = (loc: string): string => {
    try {
      const parts = new URL(loc).pathname.split("/").filter(Boolean);
      const contentParts = parts.length > 0 && LOCALE_PREFIXES.has(parts[0]) ? parts.slice(1) : parts;
      return contentParts[contentParts.length - 1] || "";
    } catch {
      return "";
    }
  };

  const isBlogUrl = (loc: string): boolean => {
    try {
      const parts = new URL(loc).pathname.split("/").filter(Boolean);
      const hasLocale = parts[0] === "en" || parts[0] === "es" || parts[0] === "us";
      const contentParts = hasLocale ? parts.slice(1) : parts;
      return contentParts[0] === "blog";
    } catch {
      return false;
    }
  };

  const safePath = (loc: string): string => {
    try {
      return new URL(loc).pathname + new URL(loc).search;
    } catch {
      return loc;
    }
  };

  return (
    <>
      <div className="px-3 py-2 border-b">
        <div className="flex items-center justify-between gap-2">
          {showSitemapSearch ? (
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="relative flex-1 min-w-0">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search URLs..."
                  value={sitemapSearch}
                  onChange={(e) => setSitemapSearch(e.target.value)}
                  className="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border bg-background focus:outline-none focus:ring-1 focus:ring-ring"
                  data-testid="input-sitemap-search"
                  autoFocus
                />
              </div>
              <button
                onClick={() => { setShowSitemapSearch(false); setSitemapSearch(""); }}
                className="p-1.5 rounded hover-elevate flex-shrink-0"
                title="Cancel search"
                data-testid="button-cancel-sitemap-search"
              >
                <X className="h-4 w-4 text-muted-foreground" />
              </button>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3 min-w-0">
                <button
                  onClick={() => setMenuView("main")}
                  className="p-1 rounded-md hover-elevate flex-shrink-0"
                  data-testid="button-back-to-main-sitemap"
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <Popover>
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          className="p-0.5 rounded hover-elevate flex-shrink-0 text-muted-foreground"
                          title="About Content URLs"
                          data-testid="button-sitemap-info"
                        >
                          <Info className="h-3.5 w-3.5" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent className="w-72" align="start" data-testid="sitemap-education">
                        <p className="text-xs text-muted-foreground leading-snug">
                          This list includes known content URLs.{" "}
                          <span className="text-foreground/80">no sitemap</span> means the page exists but is
                          excluded from /sitemap.xml (usually robots: noindex).{" "}
                          <span className="text-foreground/80">Draft</span> means unpublished (preview only).
                          Drafts still show error/warning badges after diagnostics have run — same store as live pages.
                          Folders that match a content type (public URL prefix, regional locale prefix, or{" "}
                          <span className="text-foreground/80">/private/preview/{"{type}"}</span>) show a dashboard
                          control to <span className="text-foreground/80">/private/type/{"{type}"}</span>.
                        </p>
                      </PopoverContent>
                    </Popover>
                    <h3 className="font-semibold text-sm truncate">Content URLs</h3>
                  </div>
                  <p className="text-xs text-muted-foreground truncate" data-testid="text-sitemap-counts">
                    <button
                      type="button"
                      className={`hover:text-foreground transition-colors ${
                        sitemapPresenceFilter === "in-sitemap" ? "text-foreground font-medium underline underline-offset-2" : ""
                      }`}
                      onClick={() =>
                        setSitemapPresenceFilter(
                          sitemapPresenceFilter === "in-sitemap" ? "all" : "in-sitemap"
                        )
                      }
                      title={sitemapPresenceFilter === "in-sitemap" ? "Clear filter" : "Show only URLs in sitemap"}
                      data-testid="button-filter-in-sitemap"
                    >
                      {inCount} in sitemap
                    </button>
                    {" · "}
                    <button
                      type="button"
                      className={`hover:text-foreground transition-colors ${
                        sitemapPresenceFilter === "not-in-sitemap" ? "text-foreground font-medium underline underline-offset-2" : ""
                      }`}
                      onClick={() =>
                        setSitemapPresenceFilter(
                          sitemapPresenceFilter === "not-in-sitemap" ? "all" : "not-in-sitemap"
                        )
                      }
                      title={sitemapPresenceFilter === "not-in-sitemap" ? "Clear filter" : "Show only URLs not in sitemap"}
                      data-testid="button-filter-not-in-sitemap"
                    >
                      {notInCount} no sitemap
                    </button>
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button
                  onClick={() => setCreateContentModalOpen(true)}
                  className="p-1.5 rounded hover-elevate"
                  title="Create new content"
                  data-testid="button-create-content"
                >
                  <Plus className="h-4 w-4 text-muted-foreground" />
                </button>
                <button
                  onClick={() => setShowSitemapSearch(true)}
                  className="p-1.5 rounded hover-elevate"
                  title="Search"
                  data-testid="button-toggle-sitemap-search"
                >
                  <Search className="h-4 w-4 text-muted-foreground" />
                </button>
                <a
                  href="/sitemap.xml"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded hover-elevate"
                  title="Open sitemap.xml"
                  data-testid="link-sitemap-xml"
                >
                  <ExternalLink className="h-4 w-4 text-muted-foreground" />
                </a>
              </div>
            </>
          )}
        </div>
      </div>
      
      <div className="overflow-y-auto overflow-x-hidden max-h-[360px]">
        <div className="p-2 space-y-1">
          {sitemapLoading ? (
            <div className="flex items-center justify-center py-8">
              <RefreshCw className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <>
              <a
                href="/en"
                className="flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm text-left hover-elevate cursor-pointer mb-1"
                data-testid="link-sitemap-home"
              >
                <Home className="h-4 w-4 text-primary flex-shrink-0" />
                <span className="font-medium flex-1 min-w-0 truncate">Home</span>
                {siteDisallowed && (
                  <Badge
                    variant="destructive"
                    className="shrink-0 cursor-pointer"
                    data-testid="badge-sitemap-home-disallowed"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      window.location.href = "/private/settings?tab=robots";
                    }}
                  >
                    Site disallowed
                  </Badge>
                )}
              </a>
              {filteredSitemapUrls.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  No URLs found
                </div>
              ) : (
                <>
              {folders.map((folder) => (
                <div key={folder.name} className="mb-1">
                  <div className="flex items-center gap-2 w-full px-3 py-2 rounded-md hover-elevate">
                    <button
                      type="button"
                      onClick={() => toggleFolder(folder.name)}
                      className="flex items-center gap-2 flex-1 min-w-0 text-sm text-left cursor-pointer"
                      data-testid={`button-folder-${folder.name.toLowerCase()}`}
                    >
                      {expandedFolders.has(folder.name) ? (
                        <ChevronDown className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      ) : (
                        <ChevronRight className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                      )}
                      <Folder className="h-4 w-4 text-primary flex-shrink-0" />
                      <span className="font-medium min-w-0 truncate">{folder.name}</span>
                    </button>
                    {folder.contentType && (
                      <FolderContentTypeHint contentType={folder.contentType} />
                    )}
                    <span className="text-xs text-muted-foreground flex-shrink-0">
                      {folder.urls.length}
                    </span>
                  </div>
                  {expandedFolders.has(folder.name) && (
                    <div className="ml-4 border-l pl-2 space-y-1 mt-1">
                      {folder.urls.map((url, urlIndex) => {
                        const path = safePath(url.loc);
                        const pathOnly = path.split("?")[0];
                        return (
                          <div
                            key={`${folder.name}-${urlIndex}-${url.loc}`}
                            className="group flex items-center gap-1 px-3 py-1 rounded-md hover-elevate"
                          >
                            <a
                              href={path}
                              className="flex-1 min-w-0 text-xs text-muted-foreground cursor-pointer truncate"
                              data-testid={`link-sitemap-url-${url.label.toLowerCase().replace(/\s+/g, "-")}`}
                            >
                              {pathOnly.slice(folder.path.length + 1) || path}
                            </a>
                            <RowStatusBadges url={url} />
                            <ValidationBadge
                              url={url}
                              path={path}
                              pathOnly={pathOnly}
                              validationSummary={validationSummary}
                              onOpenDiagnosticsForUrl={onOpenDiagnosticsForUrl}
                            />
                            <UrlRowActions
                              url={url}
                              menuTestIdPrefix=""
                              copyUrl={copyUrl}
                              extractSlug={extractSlug}
                              isBlogUrl={isBlogUrl}
                              handleDuplicatePage={handleDuplicatePage}
                              handleDeletePage={handleDeletePage}
                              handleDownloadYml={handleDownloadYml}
                              handleEditPageMeta={handleEditPageMeta}
                              handleRefreshCache={handleRefreshCache}
                            />
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
              {rootUrls.map((url, urlIndex) => {
                const path = safePath(url.loc);
                const pathOnly = path.split("?")[0];
                return (
                  <div
                    key={`root-${urlIndex}-${url.loc}`}
                    className="group flex items-center gap-1 px-3 py-1.5 rounded-md hover-elevate"
                  >
                    <a
                      href={path}
                      className="flex-1 min-w-0 text-xs text-muted-foreground cursor-pointer truncate"
                      data-testid={`link-sitemap-url-${url.label.toLowerCase().replace(/\s+/g, "-")}`}
                    >
                      {path}
                    </a>
                    <RowStatusBadges url={url} />
                    <ValidationBadge
                      url={url}
                      path={path}
                      pathOnly={pathOnly}
                      validationSummary={validationSummary}
                      onOpenDiagnosticsForUrl={onOpenDiagnosticsForUrl}
                    />
                    <UrlRowActions
                      url={url}
                      menuTestIdPrefix="root-"
                      copyUrl={copyUrl}
                      extractSlug={extractSlug}
                      isBlogUrl={isBlogUrl}
                      handleDuplicatePage={handleDuplicatePage}
                      handleDeletePage={handleDeletePage}
                      handleDownloadYml={handleDownloadYml}
                      handleEditPageMeta={handleEditPageMeta}
                      handleRefreshCache={handleRefreshCache}
                    />
                  </div>
                );
              })}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}
