import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveDynamicTags } from "./explain";

const tmpDirs: string[] = [];

function makeSiteDir(name = "site_example-com"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveDynamicTags", () => {
  it("injects conversion_events from the site settings.yml", () => {
    const contentPath = makeSiteDir();
    fs.writeFileSync(
      path.join(contentPath, "settings.yml"),
      [
        "tracking:",
        "  conversion_events:",
        "    - name: student_application",
        "      description: Apply / enroll lead",
        "      when_to_use: Visitor is applying or enrolling in a program via Apply or Enroll.",
        "      when_not_to_use: Soft info, downloads, newsletter — use dedicated events instead.",
        "      tags:",
        "        - website-lead",
        "    - name: newsletter_signup",
        "      description: Email list signup",
        "      when_to_use: Visitor is joining an email newsletter or updates list only.",
        "      when_not_to_use: Apply/enroll, downloads, contact, jobs, or partner forms.",
        "  leads_expected_tags:",
        "    - website-lead",
        "    - contact-us",
        "",
      ].join("\n"),
      "utf-8",
    );

    const md = [
      "Catalog:",
      "",
      "<!-- @dynamic:conversion_events -->",
      "<!-- /dynamic -->",
      "",
      "Tags:",
      "",
      "<!-- @dynamic:crm_tags -->",
      "<!-- /dynamic -->",
      "",
    ].join("\n");

    const resolved = resolveDynamicTags(md, contentPath);
    expect(resolved).toContain("| Name | Default tags |");
    expect(resolved).not.toContain("| Name | Description | Default tags |");
    expect(resolved).toContain("### Intent");
    expect(resolved).toContain("#### `student_application`");
    expect(resolved).toContain("**when_to_use:** Visitor is applying or enrolling");
    expect(resolved).toContain("**when_not_to_use:** Soft info, downloads");
    expect(resolved).toContain("`student_application`");
    expect(resolved).toContain("`newsletter_signup`");
    expect(resolved).toContain("`website-lead`");
    expect(resolved).toContain("`contact-us`");
    expect(resolved).not.toContain("_settings.yml tracking not found_");
    expect(resolved).not.toContain("<!-- @dynamic:conversion_events -->");
  });

  it("returns tracking-not-found when settings.yml is missing", () => {
    const contentPath = makeSiteDir();
    const md = "<!-- @dynamic:conversion_events -->\n<!-- /dynamic -->";
    expect(resolveDynamicTags(md, contentPath)).toBe("_settings.yml tracking not found_");
  });

  it("returns empty-catalog when conversion_events is missing", () => {
    const contentPath = makeSiteDir();
    fs.writeFileSync(path.join(contentPath, "settings.yml"), "tracking: {}\n", "utf-8");
    const md = "<!-- @dynamic:conversion_events -->\n<!-- /dynamic -->";
    expect(resolveDynamicTags(md, contentPath)).toBe(
      "_No tracking.conversion_events defined in settings.yml_",
    );
  });

  it("injects locales, content types, and image presets from the same folder", () => {
    const contentPath = makeSiteDir("site_4geeks-com");
    fs.writeFileSync(
      path.join(contentPath, "settings.yml"),
      [
        "i18n:",
        "  default_locale: en",
        "  supported_locales:",
        "    - code: en",
        "      label: English",
        "    - code: es",
        "      label: Spanish",
        "",
      ].join("\n"),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(contentPath, "content-types.yml"),
      ["blog:", "  directory: blog", "  single_template: true", "page:", "  directory: pages", ""].join(
        "\n",
      ),
      "utf-8",
    );
    fs.writeFileSync(
      path.join(contentPath, "image-registry.json"),
      JSON.stringify({ presets: { card: {}, "hero-wide": {} } }),
      "utf-8",
    );

    const md = [
      "<!-- @dynamic:active_locales -->",
      "<!-- /dynamic -->",
      "",
      "<!-- @dynamic:content_types -->",
      "<!-- /dynamic -->",
      "",
      "<!-- @dynamic:image_storage -->",
      "<!-- /dynamic -->",
      "",
    ].join("\n");

    const resolved = resolveDynamicTags(md, contentPath);
    expect(resolved).toContain("`en`");
    expect(resolved).toContain("`es`");
    expect(resolved).toContain("`blog`");
    expect(resolved).toContain("`page`");
    expect(resolved).toContain("`card`");
    expect(resolved).toContain("`hero-wide`");
    expect(resolved).toContain(`${path.basename(contentPath)}/images/`);
    expect(resolved).not.toContain("4geeks-com/images/");
  });

  it("leaves unknown dynamic tags as a placeholder", () => {
    const contentPath = makeSiteDir();
    const md = "<!-- @dynamic:not_a_real_tag -->\n<!-- /dynamic -->";
    expect(resolveDynamicTags(md, contentPath)).toBe("_unknown dynamic tag: not_a_real_tag_");
  });
});
