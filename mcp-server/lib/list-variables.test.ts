import { describe, expect, it } from "vitest";
import { TOOL_GATES } from "../../shared/mcp-tool-catalog.js";
import { isMcpMutatingTool } from "../../shared/agent-identity.js";
import { LIST_VARIABLES_STANDING_WARNINGS, buildVariablesQuery } from "../tools/variables.js";

describe("list_variables", () => {
  it("is a content_view read tool", () => {
    expect(TOOL_GATES.list_variables).toEqual({ kind: "anyCap", caps: ["content_view"] });
    expect(isMcpMutatingTool("list_variables")).toBe(false);
  });

  it("builds catalog and detail query strings", () => {
    expect(buildVariablesQuery({ figures_only: true, category: ["price", "contact"] })).toBe(
      "?category=price%2Ccontact&figures_only=true",
    );
    const q = new URLSearchParams(
      buildVariablesQuery({
        domain: "4geeks.com",
        names: ["global.a", "b"],
        context: { entry: { contentType: "landing", slug: "x", locale: "es" } },
      }).slice(1),
    );
    expect(q.has("__site")).toBe(false);
    expect(q.get("names")).toBe("global.a,b");
    expect(q.get("entry_type")).toBe("landing");
    expect(q.get("entry_locale")).toBe("es");
  });

  it("standing warnings keep every non-effect", () => {
    const codes = LIST_VARIABLES_STANDING_WARNINGS.map((w) => w.code);
    expect(codes).toEqual(["do_not_hardcode_figures", "read_only", "per_site_file", "system_managed_in_settings"]);
    expect(LIST_VARIABLES_STANDING_WARNINGS[1].message).toContain("/private/variables");
  });
});
