import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadClaudeConfig, resolveApiKey, resolveCliPath } from "../../src/config.js";

describe("loadClaudeConfig", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "claude-client-config-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty config when .n-dx.json does not exist", async () => {
    const config = await loadClaudeConfig(tmpDir);
    expect(config).toEqual({});
  });

  it("returns empty config when .n-dx.json is invalid JSON", async () => {
    await writeFile(join(tmpDir, ".n-dx.json"), "not json");
    const config = await loadClaudeConfig(tmpDir);
    expect(config).toEqual({});
  });

  it("returns empty config when .n-dx.json has no claude section", async () => {
    await writeFile(join(tmpDir, ".n-dx.json"), JSON.stringify({ hench: {} }));
    const config = await loadClaudeConfig(tmpDir);
    expect(config).toEqual({});
  });

  it("extracts all claude fields", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({
        claude: {
          cli_path: "/usr/local/bin/claude",
          api_key: "sk-ant-test-key",
          api_endpoint: "https://custom.api.example.com",
          model: "claude-opus-4-20250514",
        },
      }),
    );

    const config = await loadClaudeConfig(tmpDir);
    expect(config).toEqual({
      cli_path: "/usr/local/bin/claude",
      api_key: "sk-ant-test-key",
      api_endpoint: "https://custom.api.example.com",
      model: "claude-opus-4-20250514",
    });
  });

  it("ignores non-string fields", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({
        claude: {
          cli_path: 42,
          api_key: true,
          model: "claude-sonnet-4-6",
        },
      }),
    );

    const config = await loadClaudeConfig(tmpDir);
    expect(config).toEqual({ model: "claude-sonnet-4-6" });
    expect(config.cli_path).toBeUndefined();
    expect(config.api_key).toBeUndefined();
  });

  it("ignores empty string fields", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({
        claude: {
          cli_path: "",
          api_key: "",
          model: "sonnet",
        },
      }),
    );

    const config = await loadClaudeConfig(tmpDir);
    expect(config).toEqual({ model: "sonnet" });
  });
});

describe("resolveApiKey", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("returns config api_key when set", () => {
    const key = resolveApiKey({ api_key: "sk-ant-config" }, "ANTHROPIC_API_KEY");
    expect(key).toBe("sk-ant-config");
  });

  it("falls back to environment variable", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-env";
    const key = resolveApiKey({}, "ANTHROPIC_API_KEY");
    expect(key).toBe("sk-ant-env");
  });

  it("config takes precedence over env", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-env";
    const key = resolveApiKey({ api_key: "sk-ant-config" }, "ANTHROPIC_API_KEY");
    expect(key).toBe("sk-ant-config");
  });

  it("supports custom env var name", () => {
    process.env.MY_API_KEY = "sk-ant-custom";
    const key = resolveApiKey({}, "MY_API_KEY");
    expect(key).toBe("sk-ant-custom");
  });

  it("returns undefined when no key available", () => {
    delete process.env.ANTHROPIC_API_KEY;
    const key = resolveApiKey({}, "ANTHROPIC_API_KEY");
    expect(key).toBeUndefined();
  });

  it("uses default env var name when not specified", () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-default";
    const key = resolveApiKey({});
    expect(key).toBe("sk-ant-default");
  });
});

describe("resolveCliPath", () => {
  it("returns config cli_path when set", () => {
    expect(resolveCliPath({ cli_path: "/opt/claude" })).toBe("/opt/claude");
  });

  it("defaults to 'claude' when not set", () => {
    expect(resolveCliPath({})).toBe("claude");
  });
});
