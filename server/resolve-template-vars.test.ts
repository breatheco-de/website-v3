import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { resolveAllTemplateVars, resolveBagVars, buildParamBag } from "./resolve-template-vars";
import { resetVariableManagerCache, getVariableManager } from "./variable-manager";

describe("resolveBagVars", () => {
  it("resolves exact {{ meta.page_title }} to the bag value", () => {
    const result = resolveBagVars(
      { title: "{{ meta.page_title }}" },
      "meta",
      { page_title: "Hello SEO" },
    );
    expect(result).toEqual({ title: "Hello SEO" });
  });

  it("resolves inline meta tokens in strings", () => {
    const result = resolveBagVars(
      "Read {{ meta.description }}",
      "meta",
      { description: "About us" },
    );
    expect(result).toBe("Read About us");
  });
});

describe("buildParamBag", () => {
  it("merges query then path, with path winning on conflict", () => {
    const bag = buildParamBag(
      { slug: "from-path", category: "eng" },
      { utm: "x", slug: "from-query", category: "query-cat" },
    );
    expect(bag).toEqual({
      utm: "x",
      slug: "from-path",
      category: "eng",
    });
  });

  it("flattens array query values to the first entry", () => {
    expect(buildParamBag(null, { tag: ["a", "b"] })).toEqual({ tag: "a" });
  });

  it("excludes internal query keys including cache", () => {
    expect(
      buildParamBag(null, { cache: "false", force_variant: "draft", utm: "x" }),
    ).toEqual({ utm: "x" });
  });
});

describe("resolveAllTemplateVars", () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "brand-vars-"));
    fs.writeFileSync(
      path.join(tmpRoot, "variables.yml"),
      [
        "brand.title:",
        '  default: "Acme Corp"',
        "brand.logo:",
        '  default: "logo-light-id"',
        "brand.logo_dark:",
        '  default: "logo-dark-id"',
        "global.greeting:",
        '  default: "Hi"',
      ].join("\n"),
      "utf-8",
    );
    resetVariableManagerCache();
  });

  afterEach(() => {
    resetVariableManagerCache();
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("resolves {{ seo.main_keyword }} from the nested seo bag", () => {
    const result = resolveAllTemplateVars(
      { heading: "Learn {{ seo.main_keyword }}" },
      { seo: { main_keyword: "javascript" } },
    );
    expect(result).toEqual({ heading: "Learn javascript" });
  });

  it("resolves single → meta → param; leaves site vars for the client by default", () => {
    const data = {
      meta: {
        page_title: "{{ single.title }}",
        description: "Static desc",
      },
      sections: [
        {
          type: "hero",
          data: {
            headline: "{{ meta.page_title }}",
            cat: "{{ param.category }}",
            brand: "{{ brand.title }}",
            hello: "{{ global.greeting }}",
          },
        },
      ],
    };

    const result = resolveAllTemplateVars(data, {
      singleEntry: { title: "Entry Title" },
      param: { category: "engineering" },
      contentRoot: tmpRoot,
      context: { locale: "en" },
    }) as {
      meta: { page_title: string };
      sections: Array<{ data: { headline: string; cat: string; brand: string; hello: string } }>;
    };

    expect(result.meta.page_title).toBe("Entry Title");
    expect(result.sections[0].data.headline).toBe("Entry Title");
    expect(result.sections[0].data.cat).toBe("engineering");
    expect(result.sections[0].data.brand).toBe("{{ brand.title }}");
    expect(result.sections[0].data.hello).toBe("{{ global.greeting }}");
  });

  it("resolves site vars when skipSiteVars is false", () => {
    const data = {
      sections: [
        {
          type: "hero",
          data: {
            brand: "{{ brand.title }}",
            hello: "{{ global.greeting }}",
          },
        },
      ],
    };

    const result = resolveAllTemplateVars(data, {
      contentRoot: tmpRoot,
      context: { locale: "en" },
      skipSiteVars: false,
    }) as {
      sections: Array<{ data: { brand: string; hello: string } }>;
    };

    expect(result.sections[0].data.brand).toBe("Acme Corp");
    expect(result.sections[0].data.hello).toBe("Hi");
  });

  it("preserves _variableFields expressions while resolving section fields", () => {
    const data = {
      sections: [
        {
          type: "hero",
          data: { headline: "{{ single.title }}" },
          _variableFields: { "data.headline": "{{ single.title }}" },
        },
      ],
    };

    const result = resolveAllTemplateVars(data, {
      singleEntry: { title: "Course Name" },
    }) as {
      sections: Array<{
        data: { headline: string };
        _variableFields: Record<string, string>;
      }>;
    };

    expect(result.sections[0].data.headline).toBe("Course Name");
    expect(result.sections[0]._variableFields["data.headline"]).toBe("{{ single.title }}");
  });

  it("does not bake page single.* into listing item_template", () => {
    const data = {
      title: "Blog",
      sections: [
        {
          type: "list_cards",
          title: "{{ single.title }}",
          dynamic_entries: {
            content_type: "blog",
            item_template: {
              image: "{{ single.image }}",
              title: "{{ single.title }}",
              description: "{{ single.description }}",
              meta_right: "{{ single.updated_at | }}",
              cta_text: "Read more",
            },
          },
        },
      ],
    };

    const result = resolveAllTemplateVars(data, {
      singleEntry: { title: "Blog", slug: "blog" },
    }) as {
      sections: Array<{
        title: string;
        dynamic_entries: {
          item_template: Record<string, string>;
        };
      }>;
    };

    expect(result.sections[0].title).toBe("Blog");
    expect(result.sections[0].dynamic_entries.item_template).toEqual({
      image: "{{ single.image }}",
      title: "{{ single.title }}",
      description: "{{ single.description }}",
      meta_right: "{{ single.updated_at | }}",
      cta_text: "Read more",
    });
  });

  it("preserves root-level item_template the same way", () => {
    const data = {
      item_template: {
        title: "{{ single.title }}",
        cta_text: "Read more",
      },
      heading: "{{ single.title }}",
    };

    const result = resolveAllTemplateVars(data, {
      singleEntry: { title: "Page Title" },
    }) as {
      item_template: Record<string, string>;
      heading: string;
    };

    expect(result.heading).toBe("Page Title");
    expect(result.item_template).toEqual({
      title: "{{ single.title }}",
      cta_text: "Read more",
    });
  });

  it("exposes slug/locale/image under plain and underscore keys", () => {
    const result = resolveAllTemplateVars(
      {
        a: "{{ single.slug }}",
        b: "{{ single._slug }}",
        c: "{{ single.locale }}",
        d: "{{ single._locale }}",
        e: "{{ single.image }}",
        f: "{{ single._image }}",
      },
      {
        singleEntry: { slug: "hello", locale: "en", image: "https://x/y.png" },
      },
    ) as Record<string, string>;

    expect(result).toEqual({
      a: "hello",
      b: "hello",
      c: "en",
      d: "en",
      e: "https://x/y.png",
      f: "https://x/y.png",
    });
  });

  it("does not expose _hreflangs on the single bag", () => {
    const result = resolveAllTemplateVars(
      { x: "{{ single._hreflangs }}" },
      {
        singleEntry: { slug: "a", _hreflangs: { en: "a", es: "b" } },
      },
    ) as { x: unknown };
    // Exact missing single.* resolves to null (not the stripped routing map).
    expect(result.x).toBeNull();
  });

  it("resolves brand vars in menu-shaped data when skipSiteVars is false", () => {
    const menu = {
      navbar: {
        items: [
          {
            component: "Logo",
            imageId: "{{ brand.logo }}",
            imageIdDark: "{{ brand.logo_dark }}",
          },
        ],
      },
    };

    const result = resolveAllTemplateVars(menu, {
      contentRoot: tmpRoot,
      context: { locale: "en" },
      skipSiteVars: false,
    }) as { navbar: { items: Array<{ imageId: string; imageIdDark: string }> } };

    expect(result.navbar.items[0].imageId).toBe("logo-light-id");
    expect(result.navbar.items[0].imageIdDark).toBe("logo-dark-id");
  });

  it("seeds brand.* on VariableManager load when missing", () => {
    const emptyRoot = fs.mkdtempSync(path.join(os.tmpdir(), "brand-seed-"));
    fs.writeFileSync(path.join(emptyRoot, "variables.yml"), "global.x:\n  default: \"1\"\n", "utf-8");
    resetVariableManagerCache();
    const vm = getVariableManager(emptyRoot);
    const brand = vm.getBrandSettings();
    expect(brand.title).toBeTruthy();
    expect(brand.logo).toBeTruthy();
    expect(vm.getDefinition("brand.title")?.isReserved).toBe(true);
    fs.rmSync(emptyRoot, { recursive: true, force: true });
    resetVariableManagerCache();
  });
});
