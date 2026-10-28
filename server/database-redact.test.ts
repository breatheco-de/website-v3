import { describe, expect, it } from "vitest";
import { redactDatabaseSourceConnection, type DatabaseConfig } from "./database";

describe("redactDatabaseSourceConnection (GET /api/databases/:name for non-managers)", () => {
  it("strips api endpoint, params, headers, and auth but keeps results_path", () => {
    const config: DatabaseConfig = {
      name: "Programs",
      source: {
        type: "api",
        api: {
          endpoint: "https://api.example.com/v1/programs",
          params: { academy: "4" },
          results_path: "results",
          auth: { token_env_var: "PROGRAMS_TOKEN", prefix: "Token" },
          headers: { "X-Api-Key": "secret-value" },
        },
      },
      editor: { title: { type: "text" } },
      vector_search: { enabled: true, fields: ["title"] },
    };

    const redacted = redactDatabaseSourceConnection(config);
    expect(redacted.source).toEqual({ type: "api", api: { endpoint: "", results_path: "results" } });
    expect(JSON.stringify(redacted)).not.toContain("secret-value");
    expect(JSON.stringify(redacted)).not.toContain("api.example.com");
    expect(JSON.stringify(redacted)).not.toContain("PROGRAMS_TOKEN");
    expect(redacted.editor).toEqual(config.editor);
    expect(redacted.vector_search).toEqual(config.vector_search);
    expect(config.source.api?.headers).toEqual({ "X-Api-Key": "secret-value" });
  });

  it("strips the remote url", () => {
    const redacted = redactDatabaseSourceConnection({
      name: "Remote",
      source: { type: "remote", remote: { url: "https://cdn.example.com/data.json" } },
    });
    expect(redacted.source).toEqual({ type: "remote", remote: { url: "" } });
  });

  it("keeps local sources unchanged", () => {
    const config: DatabaseConfig = {
      name: "FAQ",
      source: { type: "local", local: { filename: "items.yml", results_path: "items" } },
    };
    expect(redactDatabaseSourceConnection(config)).toEqual(config);
  });
});
