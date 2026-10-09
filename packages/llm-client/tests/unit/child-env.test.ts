import { describe, expect, it, vi } from "vitest";
import { resolveVendorCliEnv } from "../../src/child-env.js";

const source: NodeJS.ProcessEnv = Object.freeze({
  HOME: "/home/operator", PATH: "/bin", HTTPS_PROXY: "http://proxy", NODE_EXTRA_CA_CERTS: "/ca.pem",
  ANTHROPIC_API_KEY: "claude-api", ANTHROPIC_AUTH_TOKEN: "gateway-token",
  CLAUDE_CODE_OAUTH_TOKEN: "claude-oauth", CLAUDE_CONFIG_DIR: "/claude",
  OPENAI_API_KEY: "codex-api", CODEX_API_KEY: "codex-key", CODEX_ACCESS_TOKEN: "codex-token", CODEX_HOME: "/codex",
  GEMINI_API_KEY: "google-api", CUSTOM_API_KEY: "custom-google",
  FAKE_SERVICE_API_KEY: "fake-secret", GITHUB_TOKEN: "github-secret", TYPESAFE_API_KEY: "jev-secret",
  AWS_SECRET_ACCESS_KEY: "aws-secret", EXTRA_SETTING: "setting", CLAUDECODE: "nested", UNDEFINED: undefined,
});

describe("resolveVendorCliEnv", () => {
  it("keeps only Claude authentication plus plumbing by default without mutation", () => {
    const env = resolveVendorCliEnv({}, undefined, source);
    for (const name of ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN", "CLAUDE_CONFIG_DIR", "HOME", "PATH", "HTTPS_PROXY", "NODE_EXTRA_CA_CERTS"]) {
      expect(env[name]).toBe(source[name]);
    }
    for (const name of ["FAKE_SERVICE_API_KEY", "GITHUB_TOKEN", "TYPESAFE_API_KEY", "AWS_SECRET_ACCESS_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "CLAUDECODE", "UNDEFINED"]) {
      expect(env[name]).toBeUndefined();
    }
    expect(source.CLAUDECODE).toBe("nested");
    expect(source.GITHUB_TOKEN).toBe("github-secret");
  });

  it("retains Codex login and key authentication, not another vendor's credentials", () => {
    const env = resolveVendorCliEnv({ vendor: "codex" }, undefined, source);
    expect(env.OPENAI_API_KEY).toBe("codex-api");
    expect(env.CODEX_API_KEY).toBe("codex-key");
    expect(env.CODEX_ACCESS_TOKEN).toBe("codex-token");
    expect(env.CODEX_HOME).toBe("/codex");
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.CLAUDE_CODE_OAUTH_TOKEN).toBeUndefined();
  });

  it("honors custom deny and allow globs, including deliberate MCP Jev opt-in", () => {
    const env = resolveVendorCliEnv({}, { deny: ["EXTRA_*", "HOME"], allow: ["GITHUB_TOKEN", "TYPESAFE_API_KEY", "EXTRA_SETTING"] }, source);
    expect(env.EXTRA_SETTING).toBe("setting");
    expect(env.HOME).toBeUndefined();
    expect(env.GITHUB_TOKEN).toBe("github-secret");
    expect(env.TYPESAFE_API_KEY).toBe("jev-secret");
    expect(env.FAKE_SERVICE_API_KEY).toBeUndefined();
  });

  it.each([
    { vendor: "claude" as const, claude: { api_key: "configured" } },
    { vendor: "codex" as const, codex: { api_key: "configured" } },
    { vendor: "google" as const, google: { api_key: "configured" } },
  ])("configured $vendor keys override exported keys", (config) => {
    const env = resolveVendorCliEnv(config, undefined, source);
    const name = config.vendor === "claude" ? "ANTHROPIC_API_KEY" : config.vendor === "codex" ? "OPENAI_API_KEY" : "GEMINI_API_KEY";
    expect(env[name]).toBe("configured");
  });

  it("honors Google's configured apiKeyEnv exactly, not as a glob", () => {
    expect(resolveVendorCliEnv({ vendor: "google", google: { apiKeyEnv: "CUSTOM_API_KEY" } }, undefined, source).CUSTOM_API_KEY).toBe("custom-google");
    const env = resolveVendorCliEnv({ vendor: "google", google: { apiKeyEnv: "*_API_KEY" } }, undefined, source);
    expect(env.FAKE_SERVICE_API_KEY).toBeUndefined();
    expect(env.CUSTOM_API_KEY).toBeUndefined();
  });

  it("does not retain vendor credentials for a local provider", () => {
    const env = resolveVendorCliEnv({ vendor: "local" }, undefined, source);
    expect(env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.GEMINI_API_KEY).toBeUndefined();
  });

  it("reports stripped names once, without values or retained credentials", () => {
    const report = vi.fn();
    resolveVendorCliEnv({}, { allow: ["TYPESAFE_API_KEY"] }, source, report);
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toContain("FAKE_SERVICE_API_KEY");
    expect(report.mock.calls[0][0]).not.toContain("ANTHROPIC_API_KEY");
    expect(report.mock.calls[0][0]).not.toContain("TYPESAFE_API_KEY");
    expect(JSON.stringify(report.mock.calls)).not.toContain("fake-secret");
    expect(JSON.stringify(report.mock.calls)).not.toContain("github-secret");
    report.mockClear();
    resolveVendorCliEnv({}, undefined, { PATH: "/bin" }, report);
    expect(report).not.toHaveBeenCalled();
  });

  it("handles case-insensitive names without duplicate configured keys", () => {
    const env = resolveVendorCliEnv({ claude: { api_key: "configured" } }, undefined, {
      anthropic_api_key: "old", github_token: "secret", claudecode: "nested",
    });
    expect(env).toEqual({ ANTHROPIC_API_KEY: "configured" });
  });
});
