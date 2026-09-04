import type { RedirectTraceHop } from "@shared/redirect-trace";
import { redirectTraceOriginalUrl } from "@shared/redirect-trace";
import { TEMPLATE_VERSIONING_SLUG } from "@/lib/sharedLayoutEntry";

export type Staff404ActionId =
  | "goBack"
  | "dashboard"
  | "editTemplates"
  | "openDraft"
  | "rebuild"
  | "editYaml"
  | "openRedirects";

export type Staff404Surface = "privatePreview" | "databaseSingle" | "public";

export interface Staff404Facts {
  surface: Staff404Surface;
  typeLabel: string;
  slug?: string;
  contentType?: string;
  isValidType: boolean;
  listingSharedTemplate: boolean;
  isDraftOnly: boolean;
  hasEntryVariants: boolean;
  variantsLoading: boolean;
  hasTemplateVariants: boolean;
  requestedVariantMissing: boolean;
  requestedVariant?: string | null;
  locale?: string;
  yamlExists: boolean;
  /** Variant YAML exists but could not be parsed/loaded. */
  yamlLoadFailed?: boolean;
  yamlLoadDetails?: string | null;
  yamlLoadFile?: string | null;
  hops: RedirectTraceHop[];
  rebuilt: boolean;
  historyLength: number;
  staffOrEditMode: boolean;
}

export interface Staff404Model {
  title: string;
  happened: string[];
  actions: Staff404ActionId[];
}

export const STAFF_404_UNKNOWN_PUBLIC_PAGE =
  "This URL is not a known page on our Content URLs.";

export function hasRebuiltQueryParam(search: string): boolean {
  const raw = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(raw).get("rebuilt") === "1";
}

export function applyRebuiltQueryToUrl(href: string): string {
  const url = new URL(href);
  url.searchParams.set("rebuilt", "1");
  return url.toString();
}

export function staff404RedirectsHref(hops: RedirectTraceHop[]): string {
  const original = redirectTraceOriginalUrl(hops);
  return original
    ? `/private/redirects?url=${encodeURIComponent(original)}`
    : "/private/redirects";
}

export function staff404DashboardHref(contentType: string): string {
  return `/private/type/${contentType}`;
}

/** Preview URL for a 404 variant pick. Shared-template rows open `single`, not the missing slug. */
export function staff404PreviewHref(opts: {
  contentType: string;
  slug: string;
  listingSharedTemplate: boolean;
  option: {
    locale: string;
    isPromoted: boolean;
    variantSlug: string;
    version: number | null;
  };
}): string {
  const previewSlug = opts.listingSharedTemplate ? TEMPLATE_VERSIONING_SLUG : opts.slug;
  const qs = new URLSearchParams();
  qs.set("locale", opts.option.locale);
  if (!opts.option.isPromoted && opts.option.variantSlug && opts.option.variantSlug !== "promoted") {
    qs.set("variant", opts.option.variantSlug);
    if (opts.option.version != null) qs.set("version", String(opts.option.version));
  }
  return `/private/preview/${opts.contentType}/${previewSlug}?${qs.toString()}`;
}

export function buildStaff404Model(facts: Staff404Facts): Staff404Model {
  const happened: string[] = [];

  if (facts.hops.length > 0) {
    const from = facts.hops[0]?.from ?? "";
    const to = facts.hops[facts.hops.length - 1]?.to ?? "";
    happened.push(`You opened ${from}. A redirect sent you here (${to}).`);
  }

  if (facts.rebuilt) {
    happened.push(
      "Rebuild finished. This URL is still unknown. Refetch the database from the type dashboard.",
    );
  }

  if (!facts.isValidType && facts.surface === "privatePreview") {
    happened.push(`\`${facts.contentType ?? ""}\` is not a valid content type.`);
  } else if (facts.yamlLoadFailed) {
    happened.push(
      "This draft’s YAML file could not be read, so the preview cannot build. Use Edit YAML to fix it.",
    );
  } else if (facts.surface === "public") {
    happened.push(STAFF_404_UNKNOWN_PUBLIC_PAGE);
  } else if (facts.listingSharedTemplate) {
    if (facts.requestedVariantMissing && facts.requestedVariant) {
      happened.push(
        `Variant \`${facts.requestedVariant}\` for \`${facts.locale ?? "en"}\` could not be loaded for \`${facts.slug}\`.`,
      );
    }
    happened.push(
      `The ${facts.typeLabel} entry \`${facts.slug}\` was not found. ${facts.typeLabel}s share a common template you can edit if you like.`,
    );
  } else if (facts.requestedVariantMissing && facts.requestedVariant) {
    happened.push(
      `Variant \`${facts.requestedVariant}\` for \`${facts.locale ?? "en"}\` could not be loaded for \`${facts.slug}\`.`,
    );
  } else if (facts.isDraftOnly) {
    happened.push(`\`${facts.slug}\` has no published (live) version yet.`);
  } else if (facts.slug) {
    happened.push(`The ${facts.typeLabel} entry \`${facts.slug}\` was not found.`);
  } else {
    happened.push(`Could not load this ${facts.typeLabel}.`);
  }

  let title: string;
  if (!facts.isValidType && facts.surface === "privatePreview") {
    title = "Invalid Content Type";
  } else if (facts.yamlLoadFailed) {
    title = "This draft’s YAML couldn’t be loaded";
  } else if (facts.listingSharedTemplate) {
    title = `${facts.typeLabel} not found`;
  } else if (facts.isDraftOnly && facts.surface === "privatePreview") {
    title = `No published ${facts.typeLabel.toLowerCase()} yet`;
  } else if (facts.surface === "public") {
    title = "Page not found";
  } else {
    title = `${facts.typeLabel} not found`;
  }

  const actions: Staff404ActionId[] = [];

  if (facts.historyLength > 1) {
    actions.push("goBack");
  }

  const showDashboard =
    facts.isValidType &&
    !!facts.contentType &&
    (facts.surface === "privatePreview" || facts.surface === "databaseSingle");
  if (showDashboard) {
    actions.push("dashboard");
  }

  if (facts.surface === "privatePreview" && facts.isValidType && facts.listingSharedTemplate) {
    if (facts.variantsLoading || facts.hasTemplateVariants) {
      actions.push("editTemplates");
    }
  }

  if (
    facts.surface === "privatePreview" &&
    facts.isValidType &&
    !facts.listingSharedTemplate &&
    facts.hasEntryVariants
  ) {
    actions.push("openDraft");
  }

  if (facts.staffOrEditMode) {
    actions.push("rebuild");
  }

  if (facts.yamlExists || facts.yamlLoadFailed) {
    actions.push("editYaml");
  }

  if (facts.hops.length > 0) {
    actions.push("openRedirects");
  }

  return { title, happened, actions };
}

export function staff404ActionCopy(
  id: Staff404ActionId,
  facts: Pick<Staff404Facts, "typeLabel" | "slug" | "variantsLoading" | "hasTemplateVariants">,
): { title: string; description: string; buttonLabel: string } {
  switch (id) {
    case "goBack":
      return {
        title: "Go back",
        description: "Return to the previous page",
        buttonLabel: "Go back",
      };
    case "dashboard":
      return {
        title: `Visit all ${facts.typeLabel}s`,
        description: `Open the ${facts.typeLabel} dashboard to find or create the entry`,
        buttonLabel: `Visit all ${facts.typeLabel}s`,
      };
    case "editTemplates": {
      const looking = facts.variantsLoading && !facts.hasTemplateVariants;
      return {
        title: `Edit the ${facts.typeLabel} templates`,
        description: looking
          ? "Looking for variants…"
          : `Shared layout (template.*.yml) for every attached ${facts.typeLabel}`,
        buttonLabel: "Edit templates",
      };
    }
    case "openDraft":
      return {
        title: "Open a draft of this entry",
        description: `Drafts/variants that belong to \`${facts.slug ?? ""}\``,
        buttonLabel: "Open a draft",
      };
    case "rebuild":
      return {
        title: "If you think this is a mistake",
        description: "Rescan local snapshot + clear sitemap; does not fetch remote DB",
        buttonLabel: "Rebuild URLs",
      };
    case "editYaml":
      return {
        title: "Edit YAML",
        description: "Open the YAML file on disk and fix it",
        buttonLabel: "Edit YAML",
      };
    case "openRedirects":
      return {
        title: "Open in Redirects",
        description: "Inspect the redirect that landed you here",
        buttonLabel: "Open in Redirects",
      };
  }
}

export type Staff404VariantSortable = {
  isPromoted: boolean;
  locale: string;
  allocation: number | null;
  variantSlug: string;
};

export function sortVariantsForModal<T extends Staff404VariantSortable>(
  list: T[],
  liveLast: boolean,
): T[] {
  return [...list].sort((a, b) => {
    if (a.isPromoted !== b.isPromoted) {
      if (liveLast) return a.isPromoted ? 1 : -1;
      return a.isPromoted ? -1 : 1;
    }
    if (a.locale !== b.locale) return a.locale.localeCompare(b.locale);
    const allocA = a.allocation ?? -1;
    const allocB = b.allocation ?? -1;
    if (allocA !== allocB) return allocB - allocA;
    return a.variantSlug.localeCompare(b.variantSlug);
  });
}

export function defaultStaff404Facts(overrides: Partial<Staff404Facts> = {}): Staff404Facts {
  return {
    surface: "privatePreview",
    typeLabel: "Blog",
    slug: "foo",
    contentType: "blog",
    isValidType: true,
    listingSharedTemplate: false,
    isDraftOnly: false,
    hasEntryVariants: false,
    variantsLoading: false,
    hasTemplateVariants: false,
    requestedVariantMissing: false,
    yamlExists: false,
    yamlLoadFailed: false,
    yamlLoadDetails: null,
    yamlLoadFile: null,
    hops: [],
    rebuilt: false,
    historyLength: 2,
    staffOrEditMode: true,
    ...overrides,
  };
}
