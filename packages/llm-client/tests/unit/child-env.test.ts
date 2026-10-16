import { afterEach, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveVendorCliEnv } from "../../src/child-env.js";
import type { LLMConfig } from "../../src/llm-types.js";

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

/** The subset of `names` a real child spawned with `env` can read. */
function childSees(env: NodeJS.ProcessEnv, names: readonly string[]): string[] {
  const script = `process.stdout.write(JSON.stringify(${JSON.stringify(names)}.filter(k => process.env[k] !== undefined)))`;
  return JSON.parse(execFileSync(process.execPath, ["-e", script], { env, encoding: "utf8" }));
}

describe("vendor modes", () => {
  const dirs: string[] = [];
  const tempDir = () => {
    const dir = mkdtempSync(join(tmpdir(), "child-env-"));
    dirs.push(dir);
    return dir;
  };
  /** A Codex home whose config.toml holds `toml`. */
  const codexHome = (toml: string) => {
    const dir = tempDir();
    writeFileSync(join(dir, "config.toml"), toml);
    return dir;
  };
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  // Codex's documented Azure OpenAI provider block.
  const AZURE_CONFIG = [
    'model_provider = "azure"',
    "",
    "[model_providers.azure]",
    'name = "Azure"',
    'base_url = "https://fixture.openai.azure.com/openai"',
    'env_key = "AZURE_OPENAI_API_KEY"',
    'query_params = { api-version = "2025-04-01-preview" }',
    'wire_api = "responses"',
  ].join("\n");

  interface ModeCase {
    mode: string;
    vendor: "claude" | "codex" | "google";
    /** Environment that switches the mode on, and the same without it. */
    on: () => NodeJS.ProcessEnv;
    off: () => NodeJS.ProcessEnv;
    names: readonly string[];
  }
  const cases: ModeCase[] = [
    {
      mode: "Claude on Bedrock", vendor: "claude",
      on: () => ({ CLAUDE_CODE_USE_BEDROCK: "1" }), off: () => ({}),
      names: ["AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_BEARER_TOKEN_BEDROCK", "AWS_REGION"],
    },
    {
      mode: "Claude on Vertex", vendor: "claude",
      on: () => ({ CLAUDE_CODE_USE_VERTEX: "1" }), off: () => ({}),
      names: ["GOOGLE_APPLICATION_CREDENTIALS", "CLOUD_ML_REGION"],
    },
    {
      mode: "Codex on Azure OpenAI", vendor: "codex",
      on: () => ({ CODEX_HOME: codexHome(AZURE_CONFIG) }), off: () => ({ CODEX_HOME: tempDir() }),
      names: ["AZURE_OPENAI_API_KEY"],
    },
    {
      mode: "Gemini on Vertex", vendor: "google",
      on: () => ({ GOOGLE_GENAI_USE_VERTEXAI: "true" }), off: () => ({}),
      names: ["GOOGLE_API_KEY", "GOOGLE_APPLICATION_CREDENTIALS", "GOOGLE_CLOUD_PROJECT", "GOOGLE_CLOUD_LOCATION"],
    },
  ];
  const sentinels = (names: readonly string[]) => Object.fromEntries(names.map((name) => [name, `sentinel-${name}`]));
  // Denying every name proves plumbing is re-added by the mode, not merely missed by the default filter.
  const denyAll = (names: readonly string[]) => ({ deny: [...names] });

  it.each(cases)("$mode: its names reach the child only while the mode is active", ({ vendor, on, off, names }) => {
    const active = resolveVendorCliEnv({ vendor }, denyAll(names), { PATH: process.env.PATH, ...on(), ...sentinels(names) });
    expect(childSees(active, names)).toEqual(names);
    for (const name of names) expect(active[name]).toBe(`sentinel-${name}`);
    const inactive = resolveVendorCliEnv({ vendor }, denyAll(names), { PATH: process.env.PATH, ...off(), ...sentinels(names) });
    expect(childSees(inactive, names)).toEqual([]);
  });

  it.each(cases)("$mode: another vendor never gets its names", ({ vendor, on, names }) => {
    for (const other of (["claude", "codex", "google", "local"] as const).filter((v) => v !== vendor)) {
      const env = resolveVendorCliEnv({ vendor: other }, denyAll(names), {
        CODEX_HOME: tempDir(), ...on(), ...sentinels(names),
      });
      for (const name of names) expect(env[name]).toBeUndefined();
    }
  });

  it.each(cases)("$mode: reports its credential names, never values, when none arrived", ({ vendor, on, names }) => {
    const report = vi.fn();
    resolveVendorCliEnv({ vendor }, undefined, { ...on(), GITHUB_TOKEN: "sentinel-unrelated" }, report);
    const missing = report.mock.calls.filter(([, kind]) => kind === "missing-credentials");
    expect(missing).toHaveLength(1);
    expect(missing[0][0]).toContain(names[0]);
    expect(JSON.stringify(report.mock.calls)).not.toContain("sentinel");
  });

  it("Gemini on Vertex is not reported missing when one of its credentials is present", () => {
    const report = vi.fn();
    resolveVendorCliEnv({ vendor: "google" }, undefined, { GOOGLE_GENAI_USE_VERTEXAI: "true", GOOGLE_API_KEY: "sentinel" }, report);
    expect(report.mock.calls.filter(([, kind]) => kind === "missing-credentials")).toEqual([]);
  });

  describe("Codex env_key", () => {
    const keyFor = (toml: string) => {
      const env = resolveVendorCliEnv({ vendor: "codex" }, undefined, {
        CODEX_HOME: codexHome(toml), AZURE_OPENAI_API_KEY: "sentinel-azure", WORK_API_KEY: "sentinel-work",
      });
      return ["AZURE_OPENAI_API_KEY", "WORK_API_KEY"].filter((name) => env[name] !== undefined);
    };

    it("follows the selected profile's provider over the top-level one", () => {
      expect(keyFor([
        'model_provider = "azure"', 'profile = "work"',
        "[profiles.work]", 'model_provider = "work"',
        "[model_providers.azure]", 'env_key = "AZURE_OPENAI_API_KEY"',
        '[model_providers."work"]', "env_key = 'WORK_API_KEY' # quoted table, literal string",
      ].join("\n"))).toEqual(["WORK_API_KEY"]);
    });

    it("keeps nothing when no provider is selected, or the provider has no env_key", () => {
      expect(keyFor('[model_providers.azure]\nenv_key = "AZURE_OPENAI_API_KEY"')).toEqual([]);
      expect(keyFor('model_provider = "azure"\n[model_providers.azure]\nname = "Azure"')).toEqual([]);
    });

    it("takes env_key as an exact name, never a glob", () => {
      expect(keyFor('model_provider = "azure"\n[model_providers.azure]\nenv_key = "*_API_KEY"')).toEqual([]);
    });

    it("ignores lines inside a multi-line string and in a commented-out line", () => {
      expect(keyFor([
        'model_provider = "azure"',
        "[model_providers.azure]", 'env_key = "AZURE_OPENAI_API_KEY"',
        'notes = """', 'env_key = "WORK_API_KEY"', '"""',
        '# env_key = "WORK_API_KEY"',
      ].join("\n"))).toEqual(["AZURE_OPENAI_API_KEY"]);
    });

    it("reads ~/.codex/config.toml when CODEX_HOME is unset", () => {
      const home = tempDir();
      mkdirSync(join(home, ".codex"));
      writeFileSync(join(home, ".codex", "config.toml"), AZURE_CONFIG);
      vi.stubEnv("HOME", home);
      vi.stubEnv("USERPROFILE", home);
      const env = resolveVendorCliEnv({ vendor: "codex" }, undefined, { AZURE_OPENAI_API_KEY: "sentinel-azure" });
      expect(env.AZURE_OPENAI_API_KEY).toBe("sentinel-azure");
    });

    it("never takes env_key from the repository's .codex/config.toml or its n-dx config", () => {
      const repo = tempDir();
      mkdirSync(join(repo, ".codex"));
      writeFileSync(join(repo, ".codex", "config.toml"), AZURE_CONFIG.replace("AZURE_OPENAI_API_KEY", "REPO_PICKED_SECRET"));
      const home = tempDir();
      vi.stubEnv("HOME", home);
      vi.stubEnv("USERPROFILE", home);
      const cwd = process.cwd();
      process.chdir(repo);
      try {
        const config = {
          vendor: "codex", codex: { model_provider: "azure", env_key: "REPO_PICKED_SECRET" },
        } as unknown as LLMConfig;
        for (const codexHomeEnv of [{}, { CODEX_HOME: tempDir() }]) {
          const env = resolveVendorCliEnv(config, undefined, { ...codexHomeEnv, REPO_PICKED_SECRET: "sentinel-repo" });
          expect(childSees(env, ["REPO_PICKED_SECRET"])).toEqual([]);
        }
      } finally {
        process.chdir(cwd);
      }
    });
  });
});
