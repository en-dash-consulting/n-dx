import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
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
  const cloud = Object.freeze({
    AWS_ACCESS_KEY_ID: "fixture-access", AWS_SECRET_ACCESS_KEY: "fixture-secret",
    AWS_SESSION_TOKEN: "fixture-session", AWS_PROFILE: "fixture-profile", AWS_REGION: "us-east-1",
    AWS_DEFAULT_REGION: "us-west-2", AWS_SHARED_CREDENTIALS_FILE: "/fixture/credentials",
    AWS_CONFIG_FILE: "/fixture/config", AWS_BEARER_TOKEN_BEDROCK: "fixture-bedrock",
    GOOGLE_APPLICATION_CREDENTIALS: "/fixture/google.json", CLOUD_ML_REGION: "global",
    ANTHROPIC_VERTEX_PROJECT_ID: "fixture-project", AWS_UNRELATED_SECRET: "unrelated",
    GITHUB_TOKEN: "fixture-github",
  });
  const awsNames = Object.keys(cloud).filter((name) => name.startsWith("AWS_") && name !== "AWS_UNRELATED_SECRET");

  it.each(["CLAUDE_CODE_USE_BEDROCK", "CLAUDE_CODE_USE_VERTEX"])("retains %s authentication in a real child", (mode) => {
    const input = Object.freeze({ ...cloud, [mode]: "1" });
    const report = vi.fn();
    const env = resolveVendorCliEnv({}, { deny: ["CLOUD_ML_REGION"] }, input, report);
    const expected = Object.fromEntries(Object.entries(input).filter(([name]) =>
      name === mode || name === "ANTHROPIC_VERTEX_PROJECT_ID" ||
      (mode === "CLAUDE_CODE_USE_BEDROCK" ? awsNames.includes(name) : ["GOOGLE_APPLICATION_CREDENTIALS", "CLOUD_ML_REGION"].includes(name))));
    const keys = Object.keys(input);
    const script = `process.stdout.write(JSON.stringify(Object.fromEntries(${JSON.stringify(keys)}.filter(k => process.env[k] !== undefined).map(k => [k, process.env[k]]))))`;
    const child = JSON.parse(execFileSync(process.execPath, ["-e", script], { env, encoding: "utf8" }));
    expect(child).toEqual(expected);
    expect(input.AWS_SECRET_ACCESS_KEY).toBe("fixture-secret");
    const kept = mode === "CLAUDE_CODE_USE_BEDROCK" ? awsNames : ["GOOGLE_APPLICATION_CREDENTIALS", "CLOUD_ML_REGION"];
    for (const name of kept) expect(report.mock.calls[0][0]).not.toContain(name);
    expect(report.mock.calls[0][0]).toContain("AWS_UNRELATED_SECRET");
  });

  it.each([undefined, "", "0", "false", "off", "no"])("does not enable cloud exceptions for inactive flags (%s)", (value) => {
    const env = resolveVendorCliEnv({}, undefined, { ...cloud, CLAUDE_CODE_USE_BEDROCK: value, CLAUDE_CODE_USE_VERTEX: value });
    for (const name of [...awsNames, "GOOGLE_APPLICATION_CREDENTIALS"]) expect(env[name]).toBeUndefined();
  });

  it.each(["1", "true", "TRUE", "yes", "on"])("recognizes enabled mode flags (%s) case-insensitively", (value) => {
    const env = resolveVendorCliEnv({}, undefined, {
      claude_code_use_bedrock: value, aws_secret_access_key: "fixture-aws",
      claude_code_use_vertex: value, google_application_credentials: "/fixture/google.json",
    });
    expect(env.aws_secret_access_key).toBe("fixture-aws");
    expect(env.google_application_credentials).toBe("/fixture/google.json");
  });

  it.each(["codex", "google", "local"] as const)("never grants Claude cloud exceptions to %s", (vendor) => {
    const env = resolveVendorCliEnv({ vendor }, undefined, { ...cloud, CLAUDE_CODE_USE_BEDROCK: "1", CLAUDE_CODE_USE_VERTEX: "1" });
    for (const name of [...awsNames, "GOOGLE_APPLICATION_CREDENTIALS"]) expect(env[name]).toBeUndefined();
  });

  it("keeps operator allows and does not enable a mode stripped by the policy", () => {
    const env = resolveVendorCliEnv({}, {
      deny: ["CLAUDE_CODE_USE_BEDROCK"], allow: ["AWS_PROFILE", "GOOGLE_APPLICATION_CREDENTIALS"],
    }, { ...cloud, CLAUDE_CODE_USE_BEDROCK: "1" });
    expect(env.CLAUDE_CODE_USE_BEDROCK).toBeUndefined();
    expect(env.AWS_PROFILE).toBe("fixture-profile");
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBe("/fixture/google.json");
    expect(env.AWS_SECRET_ACCESS_KEY).toBeUndefined();
  });

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
