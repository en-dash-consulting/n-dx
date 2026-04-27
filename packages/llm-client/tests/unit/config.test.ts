import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadClaudeConfig, resolveApiKey, resolveCliPath, resolveVendorModel, NEWEST_MODELS, TIER_MODELS } from "../../src/config.js";

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

  it("extracts lightModel field when present", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({
        claude: {
          model: "claude-sonnet-4-6",
          lightModel: "claude-haiku-4-20250414",
        },
      }),
    );

    const config = await loadClaudeConfig(tmpDir);
    expect(config.lightModel).toBe("claude-haiku-4-20250414");
    expect(config.model).toBe("claude-sonnet-4-6");
  });

  it("ignores non-string lightModel field", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({
        claude: {
          lightModel: 42,
          model: "sonnet",
        },
      }),
    );

    const config = await loadClaudeConfig(tmpDir);
    expect(config.lightModel).toBeUndefined();
    expect(config.model).toBe("sonnet");
  });

  it("ignores empty string lightModel field", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({
        claude: {
          lightModel: "",
          model: "sonnet",
        },
      }),
    );

    const config = await loadClaudeConfig(tmpDir);
    expect(config.lightModel).toBeUndefined();
    expect(config.model).toBe("sonnet");
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

  it("merges .n-dx.local.json over .n-dx.json (local wins)", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ claude: { model: "claude-sonnet-4-6", api_key: "sk-ant-shared" } }),
    );
    await writeFile(
      join(tmpDir, ".n-dx.local.json"),
      JSON.stringify({ claude: { cli_path: "/my/local/claude" } }),
    );

    const config = await loadClaudeConfig(tmpDir);
    expect(config.cli_path).toBe("/my/local/claude");
    expect(config.api_key).toBe("sk-ant-shared");
    expect(config.model).toBe("claude-sonnet-4-6");
  });

  it("uses .n-dx.local.json when .n-dx.json does not exist", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.local.json"),
      JSON.stringify({ claude: { cli_path: "/local/claude" } }),
    );

    const config = await loadClaudeConfig(tmpDir);
    expect(config.cli_path).toBe("/local/claude");
  });

  it("local values override shared values", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ claude: { model: "claude-sonnet-4-6" } }),
    );
    await writeFile(
      join(tmpDir, ".n-dx.local.json"),
      JSON.stringify({ claude: { model: "claude-opus-4-20250514" } }),
    );

    const config = await loadClaudeConfig(tmpDir);
    expect(config.model).toBe("claude-opus-4-20250514");
  });

  it("silently ignores invalid .n-dx.local.json", async () => {
    await writeFile(
      join(tmpDir, ".n-dx.json"),
      JSON.stringify({ claude: { model: "claude-sonnet-4-6" } }),
    );
    await writeFile(join(tmpDir, ".n-dx.local.json"), "not json");

    const config = await loadClaudeConfig(tmpDir);
    expect(config.model).toBe("claude-sonnet-4-6");
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

describe("NEWEST_MODELS", () => {
  it("defines a newest model for claude vendor", () => {
    expect(typeof NEWEST_MODELS.claude).toBe("string");
    expect(NEWEST_MODELS.claude.length).toBeGreaterThan(0);
  });

  it("defines a newest model for codex vendor", () => {
    expect(typeof NEWEST_MODELS.codex).toBe("string");
    expect(NEWEST_MODELS.codex.length).toBeGreaterThan(0);
  });
});

describe("TIER_MODELS", () => {
  it("claude.standard equals NEWEST_MODELS.claude", () => {
    expect(TIER_MODELS.claude.standard).toBe(NEWEST_MODELS.claude);
  });

  it("codex.standard equals NEWEST_MODELS.codex", () => {
    expect(TIER_MODELS.codex.standard).toBe(NEWEST_MODELS.codex);
  });

  it("claude.light maps to haiku", () => {
    expect(TIER_MODELS.claude.light).toBe("claude-haiku-4-20250414");
  });

  it("codex.light maps to gpt-5.4-mini", () => {
    expect(TIER_MODELS.codex.light).toBe("gpt-5.4-mini");
  });

  it("defines both tiers for both vendors", () => {
    expect(TIER_MODELS.claude.light).toBeDefined();
    expect(TIER_MODELS.claude.standard).toBeDefined();
    expect(TIER_MODELS.codex.light).toBeDefined();
    expect(TIER_MODELS.codex.standard).toBeDefined();
  });
});

describe("resolveVendorModel", () => {
  it("returns NEWEST_MODELS.claude for claude vendor with no config", () => {
    expect(resolveVendorModel("claude")).toBe(NEWEST_MODELS.claude);
  });

  it("returns NEWEST_MODELS.claude for claude vendor with empty config", () => {
    expect(resolveVendorModel("claude", {})).toBe(NEWEST_MODELS.claude);
  });

  it("returns configured claude model from config", () => {
    expect(
      resolveVendorModel("claude", { claude: { model: "claude-opus-4-20250514" } }),
    ).toBe("claude-opus-4-20250514");
  });

  it("expands claude model aliases from config", () => {
    expect(
      resolveVendorModel("claude", { claude: { model: "opus" } }),
    ).toBe("claude-opus-4-7");
  });

  it("expands 'sonnet' alias to full claude model ID", () => {
    expect(
      resolveVendorModel("claude", { claude: { model: "sonnet" } }),
    ).toBe(NEWEST_MODELS.claude);
  });

  it("returns NEWEST_MODELS.codex for codex vendor with no config", () => {
    expect(resolveVendorModel("codex")).toBe(NEWEST_MODELS.codex);
  });

  it("returns NEWEST_MODELS.codex for codex vendor with empty config", () => {
    expect(resolveVendorModel("codex", {})).toBe(NEWEST_MODELS.codex);
  });

  it("returns configured codex model from config", () => {
    expect(
      resolveVendorModel("codex", { codex: { model: "gpt-4o" } }),
    ).toBe("gpt-4o");
  });

  it("returns empty string for unknown vendor", () => {
    // TypeScript prevents this at compile time; we test runtime safety.
    expect(resolveVendorModel("unknown" as "claude", {})).toBe("");
  });

  // TaskWeight parameter tests
  describe("with TaskWeight parameter", () => {
    it("returns light tier model for claude when weight is 'light'", () => {
      expect(resolveVendorModel("claude", {}, "light")).toBe(TIER_MODELS.claude.light);
    });

    it("returns light tier model for codex when weight is 'light'", () => {
      expect(resolveVendorModel("codex", {}, "light")).toBe(TIER_MODELS.codex.light);
    });

    it("returns standard tier model for claude when weight is 'standard'", () => {
      expect(resolveVendorModel("claude", {}, "standard")).toBe(NEWEST_MODELS.claude);
    });

    it("returns standard tier model for codex when weight is 'standard'", () => {
      expect(resolveVendorModel("codex", {}, "standard")).toBe(NEWEST_MODELS.codex);
    });

    it("defaults to standard when weight is omitted", () => {
      // Verify backward compatibility: omitting weight uses standard tier
      expect(resolveVendorModel("claude")).toBe(resolveVendorModel("claude", {}, "standard"));
      expect(resolveVendorModel("codex")).toBe(resolveVendorModel("codex", {}, "standard"));
    });

    it("model config does NOT override light weight for claude - use lightModel instead", () => {
      // model only applies to standard tier; light tier needs lightModel
      const config = { claude: { model: "claude-opus-4-20250514" } };
      expect(resolveVendorModel("claude", config, "light")).toBe(TIER_MODELS.claude.light);
    });

    it("model config does NOT override light weight for codex - use lightModel instead", () => {
      // model only applies to standard tier; light tier needs lightModel
      const config = { codex: { model: "gpt-4o" } };
      expect(resolveVendorModel("codex", config, "light")).toBe(TIER_MODELS.codex.light);
    });

    it("expands claude alias when using light tier", () => {
      // Light tier for Claude should not need alias expansion (it's a full model ID)
      // but verify the resolver path still works correctly
      expect(resolveVendorModel("claude", {}, "light")).toBe("claude-haiku-4-20250414");
    });
  });

  // Per-tier config override tests (lightModel)
  describe("with lightModel config override", () => {
    it("uses lightModel for claude when weight is 'light' and lightModel is set", () => {
      const config = { claude: { lightModel: "claude-haiku-4-20250414" } };
      expect(resolveVendorModel("claude", config, "light")).toBe("claude-haiku-4-20250414");
    });

    it("uses lightModel for codex when weight is 'light' and lightModel is set", () => {
      const config = { codex: { lightModel: "gpt-4o-mini" } };
      expect(resolveVendorModel("codex", config, "light")).toBe("gpt-4o-mini");
    });

    it("falls back to TIER_MODELS.light when lightModel is absent for claude", () => {
      expect(resolveVendorModel("claude", {}, "light")).toBe(TIER_MODELS.claude.light);
    });

    it("falls back to TIER_MODELS.light when lightModel is absent for codex", () => {
      expect(resolveVendorModel("codex", {}, "light")).toBe(TIER_MODELS.codex.light);
    });

    it("lightModel is ignored when weight is 'standard' for claude", () => {
      const config = { claude: { lightModel: "claude-haiku-4-20250414" } };
      expect(resolveVendorModel("claude", config, "standard")).toBe(NEWEST_MODELS.claude);
    });

    it("lightModel is ignored when weight is 'standard' for codex", () => {
      const config = { codex: { lightModel: "gpt-4o-mini" } };
      expect(resolveVendorModel("codex", config, "standard")).toBe(NEWEST_MODELS.codex);
    });

    it("expands claude alias in lightModel config", () => {
      const config = { claude: { lightModel: "haiku" } };
      expect(resolveVendorModel("claude", config, "light")).toBe("claude-haiku-4-20250414");
    });

    it("lightModel takes precedence over TIER_MODELS.light for claude", () => {
      const config = { claude: { lightModel: "claude-sonnet-4-6" } };
      // Using a non-standard model for light tier
      expect(resolveVendorModel("claude", config, "light")).toBe("claude-sonnet-4-6");
    });

    it("lightModel takes precedence over TIER_MODELS.light for codex", () => {
      const config = { codex: { lightModel: "gpt-5" } };
      // Using a non-standard model for light tier
      expect(resolveVendorModel("codex", config, "light")).toBe("gpt-5");
    });
  });
});
