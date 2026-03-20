import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadClaudeConfig, resolveApiKey, resolveCliPath } from "../../../src/store/project-config.js";
import type { ClaudeConfig } from "../../../src/store/project-config.js";

describe("Claude config inheritance (hench)", () => {
  let tmpDir: string;
  let henchDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "hench-claude-cfg-"));
    henchDir = join(tmpDir, ".n-dx/hench");
    await mkdir(henchDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  describe("loadClaudeConfig", () => {
    it("returns empty config when config.json does not exist", async () => {
      const config = await loadClaudeConfig(henchDir);
      expect(config).toEqual({});
    });

    it("returns empty config when config.json has no claude section", async () => {
      await writeFile(
        join(tmpDir, ".n-dx", "config.json"),
        JSON.stringify({ hench: { model: "opus" } }),
      );
      const config = await loadClaudeConfig(henchDir);
      expect(config).toEqual({});
    });

    it("returns empty config when config.json is invalid JSON", async () => {
      await writeFile(join(tmpDir, ".n-dx", "config.json"), "not valid json");
      const config = await loadClaudeConfig(henchDir);
      expect(config).toEqual({});
    });

    it("loads cli_path from config.json claude section", async () => {
      await writeFile(
        join(tmpDir, ".n-dx", "config.json"),
        JSON.stringify({ claude: { cli_path: "/usr/local/bin/claude" } }),
      );
      const config = await loadClaudeConfig(henchDir);
      expect(config.cli_path).toBe("/usr/local/bin/claude");
      expect(config.api_key).toBeUndefined();
    });

    it("loads api_key from config.json claude section", async () => {
      await writeFile(
        join(tmpDir, ".n-dx", "config.json"),
        JSON.stringify({ claude: { api_key: "sk-ant-test-key" } }),
      );
      const config = await loadClaudeConfig(henchDir);
      expect(config.api_key).toBe("sk-ant-test-key");
      expect(config.cli_path).toBeUndefined();
    });

    it("loads both cli_path and api_key", async () => {
      await writeFile(
        join(tmpDir, ".n-dx", "config.json"),
        JSON.stringify({
          claude: { cli_path: "/opt/claude", api_key: "sk-ant-123" },
        }),
      );
      const config = await loadClaudeConfig(henchDir);
      expect(config.cli_path).toBe("/opt/claude");
      expect(config.api_key).toBe("sk-ant-123");
    });

    it("loads api_endpoint from config.json claude section", async () => {
      await writeFile(
        join(tmpDir, ".n-dx", "config.json"),
        JSON.stringify({ claude: { api_endpoint: "https://proxy.example.com" } }),
      );
      const config = await loadClaudeConfig(henchDir);
      expect(config.api_endpoint).toBe("https://proxy.example.com");
    });

    it("loads model from config.json claude section", async () => {
      await writeFile(
        join(tmpDir, ".n-dx", "config.json"),
        JSON.stringify({ claude: { model: "claude-opus-4-20250514" } }),
      );
      const config = await loadClaudeConfig(henchDir);
      expect(config.model).toBe("claude-opus-4-20250514");
    });

    it("loads all claude config fields together", async () => {
      await writeFile(
        join(tmpDir, ".n-dx", "config.json"),
        JSON.stringify({
          claude: {
            cli_path: "/opt/claude",
            api_key: "sk-ant-123",
            api_endpoint: "https://proxy.example.com",
            model: "claude-opus-4-20250514",
          },
        }),
      );
      const config = await loadClaudeConfig(henchDir);
      expect(config.cli_path).toBe("/opt/claude");
      expect(config.api_key).toBe("sk-ant-123");
      expect(config.api_endpoint).toBe("https://proxy.example.com");
      expect(config.model).toBe("claude-opus-4-20250514");
    });

    it("ignores empty string values", async () => {
      await writeFile(
        join(tmpDir, ".n-dx", "config.json"),
        JSON.stringify({ claude: { cli_path: "", api_key: "", api_endpoint: "", model: "" } }),
      );
      const config = await loadClaudeConfig(henchDir);
      expect(config.cli_path).toBeUndefined();
      expect(config.api_key).toBeUndefined();
      expect(config.api_endpoint).toBeUndefined();
      expect(config.model).toBeUndefined();
    });

    it("ignores non-string values", async () => {
      await writeFile(
        join(tmpDir, ".n-dx", "config.json"),
        JSON.stringify({ claude: { cli_path: 123, api_key: true, api_endpoint: 456, model: false } }),
      );
      const config = await loadClaudeConfig(henchDir);
      expect(config.cli_path).toBeUndefined();
      expect(config.api_key).toBeUndefined();
      expect(config.api_endpoint).toBeUndefined();
      expect(config.model).toBeUndefined();
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

    it("prefers unified config api_key over env var", () => {
      process.env.ANTHROPIC_API_KEY = "env-key";
      const config: ClaudeConfig = { api_key: "config-key" };
      expect(resolveApiKey(config, "ANTHROPIC_API_KEY")).toBe("config-key");
    });

    it("falls back to env var when no config api_key", () => {
      process.env.ANTHROPIC_API_KEY = "env-key";
      const config: ClaudeConfig = {};
      expect(resolveApiKey(config, "ANTHROPIC_API_KEY")).toBe("env-key");
    });

    it("returns undefined when neither config nor env var set", () => {
      delete process.env.ANTHROPIC_API_KEY;
      const config: ClaudeConfig = {};
      expect(resolveApiKey(config, "ANTHROPIC_API_KEY")).toBeUndefined();
    });

    it("respects custom env var name", () => {
      process.env.MY_API_KEY = "custom-key";
      const config: ClaudeConfig = {};
      expect(resolveApiKey(config, "MY_API_KEY")).toBe("custom-key");
    });
  });

  describe("resolveCliPath", () => {
    it("returns custom path when set in config", () => {
      const config: ClaudeConfig = { cli_path: "/opt/claude" };
      expect(resolveCliPath(config)).toBe("/opt/claude");
    });

    it('falls back to "claude" when no custom path', () => {
      const config: ClaudeConfig = {};
      expect(resolveCliPath(config)).toBe("claude");
    });
  });
});
