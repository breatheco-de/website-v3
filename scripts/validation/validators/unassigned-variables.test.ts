import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as yaml from "js-yaml";
import { unassignedVariablesValidator } from "./unassigned-variables";
import type { ValidationContext } from "../shared/types";
import { resetRegistry } from "../../../server/content-types";
import { resetVariableManagerCache } from "../../../server/variable-manager";

function makeContext(contentRoot: string): ValidationContext {
  return {
    contentFiles: [],
    redirectMap: new Map(),
    availableSchemas: new Set(),
    sitemapEntries: [],
    contentRoot,
  };
}

describe("unassignedVariablesValidator", () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "unassigned-vars-"));
    resetRegistry();
    resetVariableManagerCache();
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
    resetRegistry();
    resetVariableManagerCache();
  });

  it("flags YAML global without pipe when default is empty", async () => {
    fs.writeFileSync(
      path.join(tmp, "variables.yml"),
      yaml.dump({
        "global.empty_one": { default: "" },
        "global.filled": { default: "ok" },
      }),
    );
    fs.mkdirSync(path.join(tmp, "pages", "home"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "pages", "home", "en.yml"),
      "title: \"{{ global.empty_one }}\"\nother: \"{{ global.filled }}\"\n",
    );

    const result = await unassignedVariablesValidator.run(makeContext(tmp));
    expect(result.status).toBe("failed");
    expect(result.errors.some((e) => e.message.includes("global.empty_one"))).toBe(true);
    expect(result.errors.some((e) => e.message.includes("global.filled"))).toBe(false);
  });

  it("skips YAML globals when every usage has a non-empty pipe fallback", async () => {
    fs.writeFileSync(
      path.join(tmp, "variables.yml"),
      yaml.dump({
        "global.empty_one": { default: "" },
      }),
    );
    fs.mkdirSync(path.join(tmp, "pages", "home"), { recursive: true });
    fs.writeFileSync(
      path.join(tmp, "pages", "home", "en.yml"),
      "title: \"{{ global.empty_one | 84% }}\"\n",
    );

    const result = await unassignedVariablesValidator.run(makeContext(tmp));
    expect(result.errors.some((e) => e.message.includes("global.empty_one"))).toBe(false);
  });

  it("flags empty brand.logo used in preview.props", async () => {
    fs.writeFileSync(
      path.join(tmp, "variables.yml"),
      yaml.dump({
        "brand.logo": { default: "" },
        "brand.title": { default: "Site" },
      }),
    );
    fs.writeFileSync(
      path.join(tmp, "content-types.yml"),
      yaml.dump({
        page: {
          directory: "pages",
          url_pattern: { en: "/en/:slug" },
          preview: {
            component: "og_image_preview",
            props: {
              logo: "brand.logo",
              title: "brand.title",
            },
          },
        },
      }),
    );

    const result = await unassignedVariablesValidator.run(makeContext(tmp));
    expect(result.errors.some((e) => e.message.includes("brand.logo"))).toBe(true);
    expect(result.errors.some((e) => e.message.includes("brand.title"))).toBe(false);
  });

  it("flags signup field_map global when unassigned", async () => {
    fs.writeFileSync(
      path.join(tmp, "variables.yml"),
      yaml.dump({
        "global.default_free_signup_plan": { default: "" },
      }),
    );
    fs.writeFileSync(
      path.join(tmp, "settings.yml"),
      yaml.dump({
        auth: {
          host: "https://example.com",
          signup: {
            path: "/v1/auth/subscribe/",
            method: "POST",
            field_map: [
              { key: "email", from: "form.email" },
              { key: "plan", global: "global.default_free_signup_plan" },
            ],
          },
        },
      }),
    );

    const result = await unassignedVariablesValidator.run(makeContext(tmp));
    expect(
      result.errors.some(
        (e) =>
          e.message.includes("global.default_free_signup_plan") &&
          e.message.includes("auth.signup.field_map"),
      ),
    ).toBe(true);
  });
});
