/**
 * What a reader of the tracked project config drops while the repository is
 * not trusted, and the endpoint helper the API providers share.
 */
import { describe, expect, it } from "vitest";
import { stripTrackedExecutionConfig } from "../../src/tracked-config-clamp.js";
import { resolveApiEndpoint } from "../../src/config.js";

describe("stripTrackedExecutionConfig", () => {
  it("drops binary, endpoint, key-variable and local host keys and names each one", () => {
    const root = {
      claude: { cli_path: "/legacy/claude", api_endpoint: "https://legacy.example", model: "m" },
      llm: {
        vendor: "codex",
        model: "shared",
        claude: { cli_path: "/c", api_endpoint: "https://c.example", apiKeyEnv: "X", model: "cm" },
        codex: { cli_path: "/x", api_endpoint: "https://x.example", model: "xm" },
        google: { apiKeyEnv: "G", api_endpoint: "https://g.example", model: "gm" },
        local: { host: "h", port: 1, model: "lm", verifier: { host: "vh", port: 2, model: "vm" } },
        tiers: { claude: { light: "l" } },
      },
      web: { auth: false },
    };
    const { root: out, stripped } = stripTrackedExecutionConfig(root);

    expect(out).toEqual({
      claude: { model: "m" },
      llm: {
        vendor: "codex",
        model: "shared",
        claude: { model: "cm" },
        codex: { model: "xm" },
        google: { model: "gm" },
        local: { model: "lm", verifier: { model: "vm" } },
        tiers: { claude: { light: "l" } },
      },
      web: { auth: false },
    });
    expect(stripped).toEqual([
      "claude.cli_path",
      "claude.api_endpoint",
      "llm.claude.cli_path",
      "llm.claude.api_endpoint",
      "llm.claude.apiKeyEnv",
      "llm.codex.cli_path",
      "llm.codex.api_endpoint",
      "llm.google.api_endpoint",
      "llm.google.apiKeyEnv",
      "llm.local.host",
      "llm.local.port",
      "llm.local.verifier.host",
      "llm.local.verifier.port",
    ]);
  });

  it("leaves the input untouched and a config without those keys unchanged", () => {
    const root = { llm: { vendor: "claude", claude: { model: "m", cli_path: "/c" } } };
    const { root: out, stripped } = stripTrackedExecutionConfig(root);
    expect(root.llm.claude.cli_path).toBe("/c");
    expect(out).toEqual({ llm: { vendor: "claude", claude: { model: "m" } } });
    expect(stripped).toEqual(["llm.claude.cli_path"]);

    const plain = { llm: { vendor: "claude" }, hench: { maxTurns: 3 } };
    expect(stripTrackedExecutionConfig(plain)).toEqual({ root: plain, stripped: [] });
  });

  it("tolerates non-object blocks", () => {
    expect(stripTrackedExecutionConfig({ llm: "nonsense", claude: null }).stripped).toEqual([]);
  });
});

describe("resolveApiEndpoint", () => {
  it("returns the configured endpoint, else the vendor default", () => {
    expect(resolveApiEndpoint({ api_endpoint: "https://x.example/v1" }, "https://default.example")).toBe("https://x.example/v1");
    expect(resolveApiEndpoint({ api_endpoint: "" }, "https://default.example")).toBe("https://default.example");
    expect(resolveApiEndpoint(undefined, "https://default.example")).toBe("https://default.example");
    expect(resolveApiEndpoint({}, undefined)).toBeUndefined();
  });
});
