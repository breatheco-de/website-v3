import { describe, expect, it } from "vitest";
import { safeLoad } from "./content.js";

describe("mcp safeLoad template vars", () => {
  it("parses nested-brace liquid defaults (detach-baked shell)", () => {
    const raw = `
title: Casos de uso
content: body
sections:
  - type: form
    data:
      success: {{ entry.call_to_action.success | {"message": "¡Gracias! Nos pondremos en contacto pronto."} }}
`;
    const parsed = safeLoad(raw);
    expect(parsed).not.toBeNull();
    expect(parsed?.title).toBe("Casos de uso");
    expect(parsed?.content).toBe("body");
    const sections = parsed?.sections as Array<Record<string, unknown>>;
    expect(sections).toHaveLength(1);
    const success = (sections[0]?.data as Record<string, unknown>)?.success;
    expect(success).toBe(
      '{{ entry.call_to_action.success | {"message": "¡Gracias! Nos pondremos en contacto pronto."} }}',
    );
  });

  it("still parses simple {{ path | default }} expressions", () => {
    const raw = `
title: {{ entry.title | blog title }}
ratio: {{ ratio | 7:1 }}
`;
    const parsed = safeLoad(raw);
    expect(parsed?.title).toBe("{{ entry.title | blog title }}");
    expect(parsed?.ratio).toBe("{{ ratio | 7:1 }}");
  });
});
