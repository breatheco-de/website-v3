import { afterEach, describe, expect, it } from "vitest";
import { parseArgs } from "../src/parse-args";

describe("parseArgs", () => {
  afterEach(() => {
    delete process.env.WEBLIFY_DEBUG;
    delete process.env.DEBUG;
  });

  it("defaults all flags off", () => {
    const f = parseArgs([]);
    expect(f.production).toBe(false);
    expect(f.agenticInstallation).toBe(false);
    expect(f.command).toBeNull();
    expect(f.debug).toBe(false);
  });

  it("parses token positional command", () => {
    const f = parseArgs(["token"]);
    expect(f.command).toBe("token");
  });

  it("ignores unknown --regenerate-token flag", () => {
    const f = parseArgs(["--regenerate-token"]);
    expect(f.command).toBeNull();
  });

  it("parses production and agent", () => {
    const f = parseArgs(["--production", "--agent", "local", "--name", "Acme"]);
    expect(f.production).toBe(true);
    expect(f.agent).toBe("local");
    expect(f.name).toBe("Acme");
  });

  it("parses equals form", () => {
    const f = parseArgs(["--slug=my-site", "--agent=cloud"]);
    expect(f.slug).toBe("my-site");
    expect(f.agent).toBe("cloud");
  });

  it("parses --debug and sets WEBLIFY_DEBUG", () => {
    const f = parseArgs(["--debug"]);
    expect(f.debug).toBe(true);
    expect(process.env.WEBLIFY_DEBUG).toBe("1");
  });
});
