import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadClaudeConfig, resolveCliPath, resolveApiKey } from "@n-dx/llm-client";
import type { ClaudeConfig } from "@n-dx/llm-client";
import { setClaudeConfig, setClaudeClient, getAuthMode } from "../../src/analyzers/claude-client.js";

describe("Claude config integration (sourcevision)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "sv-claude-cfg-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
    // Reset module-level state
    setClaudeConfig({});
  });

  describe("loadClaudeConfig", () => {
    it("returns empty config when .n-dx.json does not exist", async () => {
      const config = await loadClaudeConfig(tmpDir);
      expect(config).toEqual({});
    });

    it("returns empty config when .n-dx.json has no claude section", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ sourcevision: { project: "test" } }),
      );
      const config = await loadClaudeConfig(tmpDir);
      expect(config).toEqual({});
    });

    it("returns empty config when .n-dx.json is invalid JSON", async () => {
      await writeFile(join(tmpDir, ".n-dx.json"), "not valid json");
      const config = await loadClaudeConfig(tmpDir);
      expect(config).toEqual({});
    });

    it("loads cli_path from .n-dx.json claude section", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ claude: { cli_path: "/usr/local/bin/claude" } }),
      );
      const config = await loadClaudeConfig(tmpDir);
      expect(config.cli_path).toBe("/usr/local/bin/claude");
    });

    it("loads api_key from .n-dx.json claude section", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ claude: { api_key: "sk-ant-test-key" } }),
      );
      const config = await loadClaudeConfig(tmpDir);
      expect(config.api_key).toBe("sk-ant-test-key");
    });

    it("loads api_endpoint from .n-dx.json claude section", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ claude: { api_endpoint: "https://proxy.example.com" } }),
      );
      const config = await loadClaudeConfig(tmpDir);
      expect(config.api_endpoint).toBe("https://proxy.example.com");
    });

    it("loads model from .n-dx.json claude section", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ claude: { model: "claude-opus-4-20250514" } }),
      );
      const config = await loadClaudeConfig(tmpDir);
      expect(config.model).toBe("claude-opus-4-20250514");
    });

    it("ignores empty string values", async () => {
      await writeFile(
        join(tmpDir, ".n-dx.json"),
        JSON.stringify({ claude: { cli_path: "", api_key: "", api_endpoint: "", model: "" } }),
      );
      const config = await loadClaudeConfig(tmpDir);
      expect(config.cli_path).toBeUndefined();
      expect(config.api_key).toBeUndefined();
      expect(config.api_endpoint).toBeUndefined();
      expect(config.model).toBeUndefined();
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

  describe("resolveApiKey", () => {
    it("returns api_key from config when present", () => {
      const config: ClaudeConfig = { api_key: "sk-ant-test-key" };
      expect(resolveApiKey(config)).toBe("sk-ant-test-key");
    });

    it("falls back to ANTHROPIC_API_KEY env var", () => {
      const original = process.env.ANTHROPIC_API_KEY;
      try {
        process.env.ANTHROPIC_API_KEY = "sk-ant-from-env";
        const config: ClaudeConfig = {};
        expect(resolveApiKey(config)).toBe("sk-ant-from-env");
      } finally {
        if (original !== undefined) {
          process.env.ANTHROPIC_API_KEY = original;
        } else {
          delete process.env.ANTHROPIC_API_KEY;
        }
      }
    });

    it("config api_key takes precedence over env var", () => {
      const original = process.env.ANTHROPIC_API_KEY;
      try {
        process.env.ANTHROPIC_API_KEY = "sk-ant-from-env";
        const config: ClaudeConfig = { api_key: "sk-ant-from-config" };
        expect(resolveApiKey(config)).toBe("sk-ant-from-config");
      } finally {
        if (original !== undefined) {
          process.env.ANTHROPIC_API_KEY = original;
        } else {
          delete process.env.ANTHROPIC_API_KEY;
        }
      }
    });

    it("supports custom env var name", () => {
      const original = process.env.MY_CLAUDE_KEY;
      try {
        process.env.MY_CLAUDE_KEY = "sk-ant-custom-env";
        const config: ClaudeConfig = {};
        expect(resolveApiKey(config, "MY_CLAUDE_KEY")).toBe("sk-ant-custom-env");
      } finally {
        if (original !== undefined) {
          process.env.MY_CLAUDE_KEY = original;
        } else {
          delete process.env.MY_CLAUDE_KEY;
        }
      }
    });

    it("returns undefined when no key available", () => {
      const original = process.env.ANTHROPIC_API_KEY;
      try {
        delete process.env.ANTHROPIC_API_KEY;
        const config: ClaudeConfig = {};
        expect(resolveApiKey(config)).toBeUndefined();
      } finally {
        if (original !== undefined) {
          process.env.ANTHROPIC_API_KEY = original;
        }
      }
    });
  });

  describe("setClaudeConfig", () => {
    it("can be called without error", () => {
      expect(() => setClaudeConfig({ cli_path: "/test/claude" })).not.toThrow();
    });
  });

  describe("getAuthMode", () => {
    it("returns 'cli' when no API key is configured", () => {
      const original = process.env.ANTHROPIC_API_KEY;
      try {
        delete process.env.ANTHROPIC_API_KEY;
        setClaudeConfig({});
        expect(getAuthMode()).toBe("cli");
      } finally {
        if (original !== undefined) {
          process.env.ANTHROPIC_API_KEY = original;
        }
      }
    });

    it("returns 'api' when API key is configured", () => {
      setClaudeConfig({ api_key: "sk-ant-test-key" });
      expect(getAuthMode()).toBe("api");
    });

    it("returns 'api' when API key is in environment", () => {
      const original = process.env.ANTHROPIC_API_KEY;
      try {
        process.env.ANTHROPIC_API_KEY = "sk-ant-from-env";
        setClaudeConfig({});
        expect(getAuthMode()).toBe("api");
      } finally {
        if (original !== undefined) {
          process.env.ANTHROPIC_API_KEY = original;
        } else {
          delete process.env.ANTHROPIC_API_KEY;
        }
      }
    });
  });

  describe("setClaudeClient", () => {
    it("can set a custom client", () => {
      const mockClient = {
        mode: "api" as const,
        complete: async () => ({ text: "test", tokenUsage: { input: 0, output: 0 } }),
      };
      expect(() => setClaudeClient(mockClient)).not.toThrow();
      expect(getAuthMode()).toBe("api");
    });

    it("getAuthMode reflects the client mode", () => {
      const mockClient = {
        mode: "cli" as const,
        complete: async () => ({ text: "test", tokenUsage: { input: 0, output: 0 } }),
      };
      setClaudeClient(mockClient);
      expect(getAuthMode()).toBe("cli");
    });
  });
});
