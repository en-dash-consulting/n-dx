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

/** Names in `source` that pass the default filter for every vendor (config dirs are paths, not credentials). */
const PLUMBING = ["CLAUDE_CONFIG_DIR", "CODEX_HOME", "EXTRA_SETTING", "HOME", "HTTPS_PROXY", "NODE_EXTRA_CA_CERTS", "PATH"];

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

  const roleNames = [
    "AWS_WEB_IDENTITY_TOKEN_FILE", "AWS_ROLE_ARN", "AWS_ROLE_SESSION_NAME",
    "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", "AWS_CONTAINER_CREDENTIALS_FULL_URI",
    "AWS_CONTAINER_AUTHORIZATION_TOKEN", "AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE", "AWS_CA_BUNDLE",
  ];
  const roleEnv = Object.fromEntries(roleNames.map((name) => [name, `fixture-${name}`]));

  it("keeps IRSA, ECS and CA names in Bedrock mode and strips them otherwise", () => {
    const on = resolveVendorCliEnv({}, undefined, { ...roleEnv, CLAUDE_CODE_USE_BEDROCK: "1" });
    for (const name of roleNames) expect(on[name]).toBe(roleEnv[name]);
    const off = resolveVendorCliEnv({}, undefined, roleEnv);
    for (const name of roleNames) expect(off[name]).toBeUndefined();
  });

  it.each([
    ["CLAUDE_CODE_USE_BEDROCK", { AWS_REGION: "us-east-1", AWS_CA_BUNDLE: "/ca" }, "AWS_ACCESS_KEY_ID"],
    ["CLAUDE_CODE_USE_VERTEX", { CLOUD_ML_REGION: "global" }, "GOOGLE_APPLICATION_CREDENTIALS"],
  ])("reports once, names only, when %s is on without credentials", (mode, plumbing, sample) => {
    const report = vi.fn();
    resolveVendorCliEnv({}, undefined, { [mode]: "1", ...plumbing, GITHUB_TOKEN: "do-not-print" }, report);
    const missing = report.mock.calls.filter(([, kind]) => kind === "missing-credentials");
    expect(missing).toHaveLength(1);
    expect(missing[0][0]).toContain(sample);
    expect(JSON.stringify(report.mock.calls)).not.toMatch(/do-not-print|us-east-1|global/);
  });

  it("does not report missing credentials when one is present, or the mode is off", () => {
    const report = vi.fn();
    resolveVendorCliEnv({}, undefined, { CLAUDE_CODE_USE_BEDROCK: "1", AWS_WEB_IDENTITY_TOKEN_FILE: "/t" }, report);
    resolveVendorCliEnv({}, undefined, { AWS_REGION: "us-east-1" }, report);
    expect(report.mock.calls.filter(([, kind]) => kind === "missing-credentials")).toEqual([]);
  });

  it.each([undefined, "", "0", "false", "off", "no"])("does not enable cloud exceptions for inactive flags (%s)", (value) => {
    const env = resolveVendorCliEnv({}, undefined, { ...cloud, CLAUDE_CODE_USE_BEDROCK: value, CLAUDE_CODE_USE_VERTEX: value });
    for (const name of [...awsNames, "GOOGLE_APPLICATION_CREDENTIALS"]) expect(env[name]).toBeUndefined();
  });

  it.each(["1", "true", "TRUE", "yes", "on"])("recognizes enabled mode flag values (%s) case-insensitively", (value) => {
    const env = resolveVendorCliEnv({}, undefined, {
      CLAUDE_CODE_USE_BEDROCK: value, AWS_SECRET_ACCESS_KEY: "fixture-aws",
      CLAUDE_CODE_USE_VERTEX: value, GOOGLE_APPLICATION_CREDENTIALS: "/fixture/google.json",
    });
    expect(env.AWS_SECRET_ACCESS_KEY).toBe("fixture-aws");
    expect(env.GOOGLE_APPLICATION_CREDENTIALS).toBe("/fixture/google.json");
  });

  // The vendor CLI reads CLAUDE_CODE_USE_* by exact name, except where the OS folds case.
  it.each([
    ["linux", false],
    ["darwin", false],
    ["win32", true],
  ] as const)("matches mode flag names exactly on %s (case folded: %s)", (platform, folded) => {
    const original = Object.getOwnPropertyDescriptor(process, "platform")!;
    Object.defineProperty(process, "platform", { value: platform });
    try {
      const env = resolveVendorCliEnv({}, undefined, {
        claude_code_use_bedrock: "1", aws_secret_access_key: "fixture-aws",
        claude_code_use_vertex: "1", google_application_credentials: "/fixture/google.json",
      });
      expect(env.aws_secret_access_key).toBe(folded ? "fixture-aws" : undefined);
      expect(env.google_application_credentials).toBe(folded ? "/fixture/google.json" : undefined);
    } finally {
      Object.defineProperty(process, "platform", original);
    }
  });

  it.each([
    ["claude", ["ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN", "CLAUDE_CODE_OAUTH_TOKEN"]],
    ["codex", ["CODEX_ACCESS_TOKEN", "CODEX_API_KEY", "OPENAI_API_KEY"]],
    ["google", ["GEMINI_API_KEY"]],
    ["local", []],
  ] as const)("retains exactly %s's authentication names plus plumbing", (vendor, auth) => {
    const env = resolveVendorCliEnv({ vendor }, undefined, source);
    expect(Object.keys(env).sort()).toEqual([...auth, ...PLUMBING].sort());
  });

  it("treats an unrecognised vendor as needing no credentials", () => {
    const env = resolveVendorCliEnv({ vendor: "other" as never }, undefined, source);
    expect(Object.keys(env).sort()).toEqual(PLUMBING);
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
