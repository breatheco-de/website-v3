import { describe, expect, it } from "vitest";
import {
  CONSENT_SETTINGS_SPLIT_MIGRATION,
  DATABASES_VIEW_CONTENT_EDITORS_MIGRATION,
  ensureAdsSettingsOnSeoSettingsRoles,
  ensureDatabasesViewOnContentEditors,
  grantsAllowDatabasesBrowse,
  ensureConsentSettingsOnAdsSettingsRoles,
  getBuiltInRoleCodeDefinition,
  ensureContentViewOnEditorRoles,
  ensureDeleteVariantOnCreateVariantRoles,
  ensureDatabasesEditDataOnAllContentEditors,
  grantAllowsAnyDatabasesEditDataAccess,
  grantAllowsCap,
  grantsCanMutateMetrics,
  migrateSeoEditSplit,
  type RoleDefinition,
} from "./user-store";

describe("ensureContentViewOnEditorRoles", () => {
  it("adds content_view with unioned types on custom editor roles", () => {
    const roles: Record<string, RoleDefinition> = {
      blog_editor: {
        label: "Blog editor",
        capabilities: [
          { name: "content_edit_text", contentTypes: ["blog"] },
          { name: "content_edit_structure", contentTypes: ["blog", "landing"] },
        ],
      },
    };
    expect(ensureContentViewOnEditorRoles(roles)).toBe(true);
    const view = roles.blog_editor.capabilities.find((g) => g.name === "content_view");
    expect(view?.contentTypes).toEqual(["blog", "landing"]);
    expect(ensureContentViewOnEditorRoles(roles)).toBe(false);
  });

  it("uses * when any mutate grant is unscoped or *", () => {
    const roles: Record<string, RoleDefinition> = {
      editors: {
        label: "Editors",
        capabilities: [
          { name: "content_edit_text", contentTypes: "*" },
          { name: "content_edit_media", contentTypes: ["blog"] },
        ],
      },
    };
    ensureContentViewOnEditorRoles(roles);
    expect(roles.editors.capabilities[0]).toEqual({
      name: "content_view",
      contentTypes: "*",
    });
  });

  it("adds content_view for scoped seo_edit and edit_redirects", () => {
    const seoOnly: Record<string, RoleDefinition> = {
      seo: {
        label: "SEO",
        capabilities: [{ name: "seo_edit", contentTypes: ["blog"] }],
      },
    };
    expect(ensureContentViewOnEditorRoles(seoOnly)).toBe(true);
    expect(seoOnly.seo.capabilities[0]).toEqual({
      name: "content_view",
      contentTypes: ["blog"],
    });

    const redirectsOnly: Record<string, RoleDefinition> = {
      redirect_ops: {
        label: "Redirect ops",
        capabilities: [{ name: "edit_redirects" }],
      },
    };
    expect(ensureContentViewOnEditorRoles(redirectsOnly)).toBe(true);
    expect(redirectsOnly.redirect_ops.capabilities[0]).toEqual({
      name: "content_view",
      contentTypes: "*",
    });
  });

  it("skips built-in user_admin", () => {
    const roles: Record<string, RoleDefinition> = {
      user_admin: {
        label: "User Admin",
        capabilities: [{ name: "users_manage" }],
      },
      already: {
        label: "Already",
        capabilities: [
          { name: "content_view", contentTypes: ["page"] },
          { name: "content_edit_text", contentTypes: ["blog"] },
        ],
      },
    };
    expect(ensureContentViewOnEditorRoles(roles)).toBe(false);
    expect(roles.user_admin.capabilities.some((g) => g.name === "content_view")).toBe(false);
    expect(roles.already.capabilities.filter((g) => g.name === "content_view")).toHaveLength(1);
  });
});

describe("ensureDeleteVariantOnCreateVariantRoles", () => {
  it("adds content_delete_variant with same scope as content_create_variant", () => {
    const roles: Record<string, RoleDefinition> = {
      variant_editor: {
        label: "Variant editor",
        capabilities: [
          { name: "content_create_variant", contentTypes: ["blog", "landing"] },
          { name: "content_edit_text", contentTypes: ["blog"] },
        ],
      },
    };
    expect(ensureDeleteVariantOnCreateVariantRoles(roles)).toBe(true);
    const del = roles.variant_editor.capabilities.find((g) => g.name === "content_delete_variant");
    expect(del?.contentTypes).toEqual(["blog", "landing"]);
    expect(ensureDeleteVariantOnCreateVariantRoles(roles)).toBe(false);
  });

  it("skips built-in roles", () => {
    const roles: Record<string, RoleDefinition> = {
      platform_steward: {
        label: "Platform Steward",
        capabilities: [{ name: "content_create_variant", contentTypes: "*" }],
      },
    };
    expect(ensureDeleteVariantOnCreateVariantRoles(roles)).toBe(false);
  });
});

describe("migrateSeoEditSplit", () => {
  it("expands legacy seo_edit to redirect + settings caps", () => {
    const roles: Record<string, RoleDefinition> = {
      seo_manager: {
        label: "SEO manager",
        capabilities: [{ name: "seo_edit", contentTypes: ["blog"] }],
      },
    };
    expect(migrateSeoEditSplit(roles)).toBe(true);
    const names = roles.seo_manager.capabilities.map((g) => g.name);
    expect(names).toEqual(["seo_edit", "read_redirects", "edit_redirects", "seo_settings"]);
    expect(roles.seo_manager.capabilities[0].contentTypes).toEqual(["blog"]);
    expect(migrateSeoEditSplit(roles)).toBe(false);
  });

  it("fills missing contentTypes with * and expands caps", () => {
    const roles: Record<string, RoleDefinition> = {
      seo_legacy: {
        label: "Legacy SEO",
        capabilities: [{ name: "seo_edit" }],
      },
    };
    expect(migrateSeoEditSplit(roles)).toBe(true);
    expect(roles.seo_legacy.capabilities[0]).toEqual({
      name: "seo_edit",
      contentTypes: "*",
    });
    expect(roles.seo_legacy.capabilities.map((g) => g.name)).toEqual([
      "seo_edit",
      "read_redirects",
      "edit_redirects",
      "seo_settings",
    ]);
  });

  it("skips built-in user_admin", () => {
    const roles: Record<string, RoleDefinition> = {
      user_admin: {
        label: "User Admin",
        capabilities: [{ name: "users_manage" }],
      },
    };
    expect(migrateSeoEditSplit(roles)).toBe(false);
  });
});

describe("ensureAdsSettingsOnSeoSettingsRoles", () => {
  it("adds ads_settings to custom roles that manage SEO settings", () => {
    const roles: Record<string, RoleDefinition> = {
      seo_manager: { label: "SEO", capabilities: [{ name: "seo_settings" }] },
      editor: { label: "Editor", capabilities: [{ name: "content_edit_text" }] },
    };
    expect(ensureAdsSettingsOnSeoSettingsRoles(roles)).toBe(true);
    expect(roles.seo_manager.capabilities.map((g) => g.name)).toEqual(["seo_settings", "ads_settings"]);
    expect(roles.editor.capabilities.map((g) => g.name)).toEqual(["content_edit_text"]);
    expect(ensureAdsSettingsOnSeoSettingsRoles(roles)).toBe(false);
  });
});

describe("ensureConsentSettingsOnAdsSettingsRoles", () => {
  it("grants consent_settings once to custom roles with ads_settings", () => {
    const roles: Record<string, RoleDefinition> = {
      ads_team: { label: "Ads", capabilities: [{ name: "ads_settings" }] },
      editor: { label: "Editor", capabilities: [{ name: "content_edit_text" }] },
      platform_steward: { label: "Steward", capabilities: [{ name: "ads_settings" }] },
    };
    const applied: string[] = [];
    expect(ensureConsentSettingsOnAdsSettingsRoles(roles, applied)).toBe(true);
    expect(roles.ads_team.capabilities.map((g) => g.name)).toEqual(["ads_settings", "consent_settings"]);
    expect(roles.editor.capabilities.map((g) => g.name)).toEqual(["content_edit_text"]);
    expect(roles.platform_steward.capabilities.map((g) => g.name)).toEqual(["ads_settings"]);
    expect(applied).toEqual([CONSENT_SETTINGS_SPLIT_MIGRATION]);
  });

  it("does not re-grant after staff remove it", () => {
    const roles: Record<string, RoleDefinition> = {
      ads_team: { label: "Ads", capabilities: [{ name: "ads_settings" }] },
    };
    expect(ensureConsentSettingsOnAdsSettingsRoles(roles, [CONSENT_SETTINGS_SPLIT_MIGRATION])).toBe(false);
    expect(roles.ads_team.capabilities.map((g) => g.name)).toEqual(["ads_settings"]);
  });
});

describe("built-in ads roles", () => {
  it("Ads Manager gets ads caps but not consent; Steward gets both new caps", () => {
    const ads = getBuiltInRoleCodeDefinition("ads_manager")!.capabilities.map((g) => g.name);
    expect(ads).toEqual(["metrics_view", "content_view", "ads_settings", "ads_edit", "proposals_create"]);
    expect(ads).not.toContain("consent_settings");
    const steward = getBuiltInRoleCodeDefinition("platform_steward")!.capabilities.map((g) => g.name);
    expect(steward).toEqual(expect.arrayContaining(["ads_settings", "ads_edit", "consent_settings"]));
  });

  it("only Platform Steward gets A/B testing setup", () => {
    const steward = getBuiltInRoleCodeDefinition("platform_steward")!.capabilities.map((g) => g.name);
    expect(steward).toContain("ab_testing_settings");
    for (const id of ["ads_manager", "metrics_viewer", "content_viewer", "platform_ops", "user_admin"]) {
      const caps = getBuiltInRoleCodeDefinition(id)!.capabilities.map((g) => g.name);
      expect(caps).not.toContain("ab_testing_settings");
    }
  });
});

describe("grantsCanMutateMetrics", () => {
  it("excludes view-only caps", () => {
    expect(grantsCanMutateMetrics([{ name: "metrics_view" }])).toBe(false);
    expect(grantsCanMutateMetrics([{ name: "content_view", contentTypes: "*" }])).toBe(false);
    expect(grantsCanMutateMetrics([{ name: "read_redirects" }])).toBe(false);
    expect(
      grantsCanMutateMetrics([
        { name: "metrics_view" },
        { name: "content_view", contentTypes: "*" },
      ]),
    ).toBe(false);
    expect(grantsCanMutateMetrics([{ name: "seo_edit", contentTypes: "*" }])).toBe(true);
  });
});

describe("ensureDatabasesEditDataOnAllContentEditors", () => {
  it("adds databases_edit_data:* when content_edit_text is *", () => {
    const roles: Record<string, RoleDefinition> = {
      all_editors: {
        label: "All editors",
        capabilities: [
          { name: "content_view", contentTypes: "*" },
          { name: "content_edit_text", contentTypes: "*" },
        ],
      },
    };
    expect(ensureDatabasesEditDataOnAllContentEditors(roles)).toBe(true);
    expect(roles.all_editors.capabilities).toContainEqual({
      name: "databases_edit_data",
      databases: "*",
    });
    expect(ensureDatabasesEditDataOnAllContentEditors(roles)).toBe(false);
  });

  it("does not grant when content_edit_text is type-scoped", () => {
    const roles: Record<string, RoleDefinition> = {
      blog_editor: {
        label: "Blog editor",
        capabilities: [
          { name: "content_view", contentTypes: ["blog"] },
          { name: "content_edit_text", contentTypes: ["blog"] },
        ],
      },
    };
    expect(ensureDatabasesEditDataOnAllContentEditors(roles)).toBe(false);
    expect(roles.blog_editor.capabilities.some((g) => g.name === "databases_edit_data")).toBe(
      false,
    );
  });

  it("does not grant when content_edit_text omits contentTypes (not *)", () => {
    const roles: Record<string, RoleDefinition> = {
      legacy_editor: {
        label: "Legacy",
        capabilities: [{ name: "content_edit_text" }],
      },
    };
    expect(ensureDatabasesEditDataOnAllContentEditors(roles)).toBe(false);
    expect(roles.legacy_editor.capabilities.some((g) => g.name === "databases_edit_data")).toBe(
      false,
    );
  });

  it("skips built-in platform_steward (no databases_edit_data)", () => {
    const roles: Record<string, RoleDefinition> = {
      platform_steward: {
        label: "Platform Steward",
        capabilities: [
          { name: "databases_manage" },
          { name: "content_edit_text", contentTypes: "*" },
        ],
      },
    };
    expect(ensureDatabasesEditDataOnAllContentEditors(roles)).toBe(false);
    expect(
      roles.platform_steward.capabilities.some((g) => g.name === "databases_edit_data"),
    ).toBe(false);
  });
});

describe("ensureDatabasesViewOnContentEditors (one-time)", () => {
  it("adds databases_view to custom roles that can edit text at any scope", () => {
    const roles: Record<string, RoleDefinition> = {
      blog_editor: {
        label: "Blog editor",
        capabilities: [
          { name: "content_view", contentTypes: ["blog"] },
          { name: "content_edit_text", contentTypes: ["blog"] },
        ],
      },
      seo_only: {
        label: "SEO only",
        capabilities: [{ name: "seo_edit", contentTypes: "*" }],
      },
    };
    const applied: string[] = [];
    expect(ensureDatabasesViewOnContentEditors(roles, applied)).toBe(true);
    expect(roles.blog_editor.capabilities).toContainEqual({ name: "databases_view" });
    expect(roles.seo_only.capabilities.some((g) => g.name === "databases_view")).toBe(false);
    expect(applied).toContain(DATABASES_VIEW_CONTENT_EDITORS_MIGRATION);
  });

  it("skips roles that already browse databases, built-ins, and agentic roles", () => {
    const roles: Record<string, RoleDefinition> = {
      row_editor: {
        label: "Row editor",
        capabilities: [
          { name: "content_edit_text", contentTypes: "*" },
          { name: "databases_edit_data", databases: "*" },
        ],
      },
      manager: {
        label: "Manager",
        capabilities: [
          { name: "content_edit_text", contentTypes: ["blog"] },
          { name: "databases_manage" },
        ],
      },
      content_viewer: {
        label: "Content Viewer",
        capabilities: [{ name: "content_edit_text", contentTypes: "*" }],
      },
      copy_editor: {
        label: "Copy Editor",
        agentic: true,
        capabilities: [{ name: "content_edit_text", contentTypes: "*" }],
      },
    };
    ensureDatabasesViewOnContentEditors(roles, []);
    for (const id of Object.keys(roles)) {
      expect(roles[id].capabilities.some((g) => g.name === "databases_view"), id).toBe(false);
    }
  });

  it("does not re-add after staff removal once recorded", () => {
    const roles: Record<string, RoleDefinition> = {
      editor: {
        label: "Editor",
        capabilities: [{ name: "content_edit_text", contentTypes: ["blog"] }],
      },
    };
    const applied: string[] = [];
    ensureDatabasesViewOnContentEditors(roles, applied);
    roles.editor.capabilities = roles.editor.capabilities.filter((g) => g.name !== "databases_view");
    expect(ensureDatabasesViewOnContentEditors(roles, applied)).toBe(false);
    expect(roles.editor.capabilities.some((g) => g.name === "databases_view")).toBe(false);
  });
});

describe("grantsAllowDatabasesBrowse", () => {
  it("allows databases_view, databases_manage, or edit-data with a scope", () => {
    expect(grantsAllowDatabasesBrowse([{ name: "databases_view" }])).toBe(true);
    expect(grantsAllowDatabasesBrowse([{ name: "databases_manage" }])).toBe(true);
    expect(
      grantsAllowDatabasesBrowse([{ name: "databases_edit_data", databases: ["faq"] }]),
    ).toBe(true);
  });

  it("fails closed otherwise", () => {
    expect(grantsAllowDatabasesBrowse([])).toBe(false);
    expect(grantsAllowDatabasesBrowse([{ name: "content_view", contentTypes: "*" }])).toBe(false);
    expect(grantsAllowDatabasesBrowse([{ name: "databases_edit_data", databases: [] }])).toBe(
      false,
    );
  });

  it("databases_view stays view-only (does not unlock metrics jobs)", () => {
    expect(
      grantsCanMutateMetrics([{ name: "content_view", contentTypes: "*" }, { name: "databases_view" }]),
    ).toBe(false);
  });
});

describe("grantAllowsCap database scope", () => {
  it("fail-closed without scope unless databases is *", () => {
    expect(
      grantAllowsCap({ name: "databases_edit_data", databases: ["testimonials"] }, "databases_edit_data"),
    ).toBe(false);
    expect(
      grantAllowsCap({ name: "databases_edit_data", databases: "*" }, "databases_edit_data"),
    ).toBe(true);
  });

  it("allows listed slug and *", () => {
    const listed = grantAllowsCap(
      { name: "databases_edit_data", databases: ["testimonials", "faq"] },
      "databases_edit_data",
      "faq",
    );
    expect(listed).toBe(true);
    expect(
      grantAllowsCap(
        { name: "databases_edit_data", databases: ["testimonials"] },
        "databases_edit_data",
        "faq",
      ),
    ).toBe(false);
    expect(
      grantAllowsCap({ name: "databases_edit_data", databases: "*" }, "databases_edit_data", "faq"),
    ).toBe(true);
  });

  it("does not treat contentTypes as database scope", () => {
    expect(
      grantAllowsCap(
        { name: "databases_edit_data", contentTypes: "*" },
        "databases_edit_data",
        "testimonials",
      ),
    ).toBe(false);
  });
});

describe("grantAllowsAnyDatabasesEditDataAccess (browse / requireDatabasesBrowseAccess)", () => {
  it("allows * or non-empty slug list", () => {
    expect(
      grantAllowsAnyDatabasesEditDataAccess({ name: "databases_edit_data", databases: "*" }),
    ).toBe(true);
    expect(
      grantAllowsAnyDatabasesEditDataAccess({
        name: "databases_edit_data",
        databases: ["faq"],
      }),
    ).toBe(true);
  });

  it("fail-closed for missing grant, empty list, or wrong cap name", () => {
    expect(grantAllowsAnyDatabasesEditDataAccess(undefined)).toBe(false);
    expect(
      grantAllowsAnyDatabasesEditDataAccess({ name: "databases_edit_data", databases: [] }),
    ).toBe(false);
    expect(grantAllowsAnyDatabasesEditDataAccess({ name: "databases_edit_data" })).toBe(false);
    expect(grantAllowsAnyDatabasesEditDataAccess({ name: "databases_manage" })).toBe(false);
  });
});
