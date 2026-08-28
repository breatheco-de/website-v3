import { describe, expect, it } from "vitest";
import {
  ensureContentViewOnEditorRoles,
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

  it("skips built-in roles and roles that already have content_view", () => {
    const roles: Record<string, RoleDefinition> = {
      webmaster: {
        label: "Webmaster",
        capabilities: [{ name: "content_edit_text", contentTypes: "*" }],
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
    expect(roles.webmaster.capabilities.some((g) => g.name === "content_view")).toBe(false);
    expect(roles.already.capabilities.filter((g) => g.name === "content_view")).toHaveLength(1);
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

  it("skips built-in webmaster", () => {
    const roles: Record<string, RoleDefinition> = {
      webmaster: {
        label: "Webmaster",
        capabilities: [{ name: "seo_edit", contentTypes: "*" }],
      },
    };
    expect(migrateSeoEditSplit(roles)).toBe(false);
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
