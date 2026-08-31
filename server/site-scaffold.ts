import fs from "fs";
import path from "path";

export interface SiteScaffoldOptions {
  /** Folder under project root, e.g. site_4geeks-florida */
  contentFolder: string;
  /** Used in page copy and menus */
  displayName: string;
  includeSampleContent?: boolean;
}

function writeIfMissing(filePath: string, content: string): void {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content);
  }
}

function mkdirIfMissing(dirPath: string): void {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
}

/**
 * Create the minimum site folder structure required by check-sites / Site Manager.
 * Skips files and directories that already exist.
 * Pages use folder layout: pages/{slug}/en.yml (ContentIndex indexes directories only).
 * Does not create component-registry/ (new sites inherit via inherit_components_from).
 */
export function ensureSiteScaffold(options: SiteScaffoldOptions): void {
  const { contentFolder, displayName, includeSampleContent = true } = options;
  const folderPath = path.join(process.cwd(), contentFolder);

  mkdirIfMissing(folderPath);
  mkdirIfMissing(path.join(folderPath, "images"));
  mkdirIfMissing(path.join(folderPath, "menus"));
  mkdirIfMissing(path.join(folderPath, "pages"));

  writeIfMissing(path.join(folderPath, "images", ".gitkeep"), "");

  writeIfMissing(
    path.join(folderPath, "settings.yml"),
    `# Site settings for ${contentFolder}
i18n:
  defaultLocale: en
  locales:
    - en
home_page:
  type: page
  slug: home
`,
  );

  const pageTypeBlock = `page:
  directory: pages
  field_mapping:
    title: title
    _slug: slug
    _locale: locale
    _hreflangs: ''
    _updated_at: ''
    _image: ''
    published_at: published_at
  url_pattern:
    en: /en/:slug
  layout:
    menu:
      top: main-navbar
      bottom: main-footer
`;

  const blogTypeBlock = includeSampleContent
    ? `
blog:
  directory: blog
  single_template: true
  field_mapping:
    title: title
    excerpt: excerpt
    body: body
    published_at: published_at
    _slug: slug
    _locale: locale
    _hreflangs: ''
    _updated_at: ''
    _image: ''
  url_pattern:
    en: /en/blog/:slug
  layout:
    menu:
      top: main-navbar
      bottom: main-footer
`
    : "";

  writeIfMissing(
    path.join(folderPath, "content-types.yml"),
    `# Content types for ${contentFolder}\n${pageTypeBlock}${blogTypeBlock}`,
  );

  writeIfMissing(
    path.join(folderPath, "image-registry.json"),
    JSON.stringify({ images: [], presets: [] }, null, 2),
  );

  writeIfMissing(path.join(folderPath, "custom-redirects.yml"), "redirects: []\n");

  writeIfMissing(
    path.join(folderPath, "variables.yml"),
    `brand.title:\n  default: "${displayName}"\nbrand.logo:\n  default: ""\nbrand.logo_dark:\n  default: ""\n`,
  );

  const navbarExtra = includeSampleContent
    ? `    - label: Blog\n      href: /en/blog/sample-post\n`
    : "";

  writeIfMissing(
    path.join(folderPath, "menus", "main-navbar.yml"),
    `navbar:\n  items:\n    - label: Logo\n      href: /en\n      component: Logo\n      imageId: "{{ brand.logo }}"\n      imageIdDark: "{{ brand.logo_dark }}"\n    - label: Home\n      href: /en\n    - label: About\n      href: /en/about\n${navbarExtra}    - label: Language\n      component: LanguageSwitcher\n`,
  );

  writeIfMissing(
    path.join(folderPath, "menus", "main-footer.yml"),
    `footer:\n  columns: []\n  socials: []\n  copyright_text: "${displayName}. All rights reserved."\n`,
  );

  // Home page (always)
  const homeDir = path.join(folderPath, "pages", "home");
  mkdirIfMissing(homeDir);
  writeIfMissing(
    path.join(homeDir, "_common.yml"),
    `slug: home\ntitle: "Welcome to ${displayName}"\npublished_at: ${new Date().toISOString()}\n`,
  );
  writeIfMissing(
    path.join(homeDir, "en.yml"),
    `slug: home
meta:
  page_title: "Welcome to ${displayName}"
  description: "Home page for ${displayName}"
  redirects:
    - /en/home
sections:
  - type: hero
    version: "1.0"
    variant: singleColumn
    title: "Welcome to ${displayName}"
    subtitle: "Your new site is ready. Start editing this page to get started."
    cta_buttons:
      - text: Get Started
        url: /en/about
        variant: primary
`,
  );

  if (includeSampleContent) {
    const aboutDir = path.join(folderPath, "pages", "about");
    mkdirIfMissing(aboutDir);
    writeIfMissing(
      path.join(aboutDir, "_common.yml"),
      `slug: about\ntitle: "About - ${displayName}"\npublished_at: ${new Date().toISOString()}\n`,
    );
    writeIfMissing(
      path.join(aboutDir, "en.yml"),
      `slug: about
meta:
  page_title: "About - ${displayName}"
  description: "Learn more about ${displayName}"
sections:
  - type: text_block
    version: "1.0"
    heading: "About Us"
    body: |
      We are a team passionate about building great products.
      This is the about page for **${displayName}**.

      Feel free to edit this page with your own content.
`,
    );

    mkdirIfMissing(path.join(folderPath, "blog"));

    writeIfMissing(
      path.join(folderPath, "blog", "_common.template.yml"),
      `slug: "{{ entry.slug }}"\ntitle: "{{ entry.title }}"\nmeta:\n  robots: index, follow\n`,
    );

    writeIfMissing(
      path.join(folderPath, "blog", "template.en.yml"),
      `meta:
  page_title: "{{ entry.title }}"
  description: "{{ entry.excerpt }}"
sections:
  - type: text_block
    version: "1.0"
    heading: "{{ entry.title }}"
    body: "{{ entry.excerpt }}"
  - type: article
    version: "1.0"
    content: "{{ entry.body }}"
`,
    );

    const postDir = path.join(folderPath, "blog", "sample-post");
    mkdirIfMissing(postDir);
    writeIfMissing(
      path.join(postDir, "_common.yml"),
      `slug: sample-post\ntitle: "Sample Blog Post"\nexcerpt: "This is a sample blog post to get you started."\nbody: |\n  ## Hello World\n\n  This is a sample blog post for **${displayName}**. You can edit or delete this entry\n  and create your own posts.\npublished_at: ${new Date().toISOString()}\n`,
    );
    writeIfMissing(
      path.join(postDir, "en.yml"),
      `slug: sample-post\nmeta:\n  page_title: "Sample Blog Post"\n  description: "This is a sample blog post to get you started."\nsections: []\n`,
    );
  }
}
