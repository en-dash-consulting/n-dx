/**
 * Tests for the VendorAdapter interface and SpawnConfig type.
 *
 * Validates that:
 * 1. SpawnConfig carries all fields needed to spawn a vendor CLI process
 * 2. VendorAdapter interface methods have the correct signatures
 * 3. Types compose correctly with runtime-contract.ts types
 * 4. Both Claude and Codex adapters can satisfy the interface
 */
import { describe, it, expect } from "vitest";
import type {
  VendorAdapter,
  SpawnConfig,
} from "../../../src/agent/lifecycle/vendor-adapter.js";
import type {
  RuntimeEvent,
  FailureCategory,
  PromptEnvelope,
  ExecutionPolicy,
  LLMVendor,
} from "../../../src/prd/llm-gateway.js";
import {
  DEFAULT_EXECUTION_POLICY,
  createPromptEnvelope,
} from "../../../src/prd/llm-gateway.js";

// ── SpawnConfig type tests ──────────────────────────────────────────────

describe("SpawnConfig", () => {
  it("carries binary path", () => {
    const config: SpawnConfig = {
      binary: "/usr/local/bin/claude",
      args: ["-p"],
      env: {},
      stdinContent: null,
      cwd: "/project",
    };
    expect(config.binary).toBe("/usr/local/bin/claude");
  });

  it("carries CLI arguments", () => {
    const config: SpawnConfig = {
      binary: "claude",
      args: ["-p", "--output-format", "stream-json", "--verbose"],
      env: {},
      stdinContent: null,
      cwd: "/project",
    };
    expect(config.args).toEqual(["-p", "--output-format", "stream-json", "--verbose"]);
  });

  it("carries environment variables", () => {
    const config: SpawnConfig = {
      binary: "claude",
      args: [],
      env: { ANTHROPIC_API_KEY: "sk-test" },
      stdinContent: null,
      cwd: "/project",
    };
    expect(config.env).toEqual({ ANTHROPIC_API_KEY: "sk-test" });
  });

  it("carries stdinContent for Claude (pipe-based)", () => {
    const config: SpawnConfig = {
      binary: "claude",
      args: ["-p"],
      env: {},
      stdinContent: "Hello, Claude!",
      cwd: "/project",
    };
    expect(config.stdinContent).toBe("Hello, Claude!");
  });

  it("carries null stdinContent for Codex (no stdin)", () => {
    const config: SpawnConfig = {
      binary: "codex",
      args: ["exec", "--json"],
      env: {},
      stdinContent: null,
      cwd: "/project",
    };
    expect(config.stdinContent).toBeNull();
  });

  it("carries working directory", () => {
    const config: SpawnConfig = {
      binary: "claude",
      args: [],
      env: {},
      stdinContent: null,
      cwd: "/my/project",
    };
    expect(config.cwd).toBe("/my/project");
  });

  it("all fields are required", () => {
    // Type-level test: ensures all 5 fields are present
    const config: SpawnConfig = {
      binary: "claude",
      args: [],
      env: {},
      stdinContent: null,
      cwd: ".",
    };
    const keys = Object.keys(config).sort();
    expect(keys).toEqual(["args", "binary", "cwd", "env", "stdinContent"]);
  });
});

// ── VendorAdapter interface tests ────────────────────────────────────────

describe("VendorAdapter", () => {
  const envelope: PromptEnvelope = createPromptEnvelope([
    { name: "system", content: "You are a helpful assistant." },
    { name: "brief", content: "Fix the bug in auth.ts" },
  ]);
  const policy: ExecutionPolicy = DEFAULT_EXECUTION_POLICY;

  function createMockClaudeAdapter(): VendorAdapter {
    return {
      vendor: "claude" as LLMVendor,
      parseMode: "stream-json",
      buildSpawnConfig(env, pol, model) {
        return {
          binary: "claude",
          args: ["-p", "--output-format", "stream-json"],
          env: {},
          stdinContent: env.sections.map((s) => s.content).join("\n"),
          cwd: ".",
        };
      },
      parseEvent(line, turn, metadata) {
        return null;
      },
      classifyError(err) {
        return "unknown";
      },
    };
  }

  function createMockCodexAdapter(): VendorAdapter {
    return {
      vendor: "codex" as LLMVendor,
      parseMode: "json",
      buildSpawnConfig(env, pol, model) {
        const text = env.sections.map((s) => s.content).join("\n");
        return {
          binary: "codex",
          args: ["exec", "--json", text],
          env: {},
          stdinContent: null,
          cwd: ".",
        };
      },
      parseEvent(line, turn, metadata) {
        return null;
      },
      classifyError(err) {
        return "unknown";
      },
    };
  }

  describe("vendor property", () => {
    it("Claude adapter reports 'claude' vendor", () => {
      const adapter = createMockClaudeAdapter();
      expect(adapter.vendor).toBe("claude");
    });

    it("Codex adapter reports 'codex' vendor", () => {
      const adapter = createMockCodexAdapter();
      expect(adapter.vendor).toBe("codex");
    });

    it("vendor is readonly", () => {
      const adapter = createMockClaudeAdapter();
      // Verify vendor property exists and is a string
      expect(typeof adapter.vendor).toBe("string");
    });
  });

  describe("parseMode property", () => {
    it("Claude adapter reports 'stream-json' parse mode", () => {
      const adapter = createMockClaudeAdapter();
      expect(adapter.parseMode).toBe("stream-json");
    });

    it("Codex adapter reports 'json' parse mode", () => {
      const adapter = createMockCodexAdapter();
      expect(adapter.parseMode).toBe("json");
    });

    it("parseMode is a string", () => {
      const adapter = createMockClaudeAdapter();
      expect(typeof adapter.parseMode).toBe("string");
    });
  });

  describe("buildSpawnConfig", () => {
    it("returns a valid SpawnConfig for Claude", () => {
      const adapter = createMockClaudeAdapter();
      const config = adapter.buildSpawnConfig(envelope, policy, "claude-sonnet-4-20250514");
      expect(config.binary).toBe("claude");
      expect(config.args).toContain("-p");
      expect(config.stdinContent).not.toBeNull();
      expect(config.cwd).toBe(".");
    });

    it("returns a valid SpawnConfig for Codex", () => {
      const adapter = createMockCodexAdapter();
      const config = adapter.buildSpawnConfig(envelope, policy, "gpt-5-codex");
      expect(config.binary).toBe("codex");
      expect(config.args).toContain("exec");
      expect(config.stdinContent).toBeNull();
      expect(config.cwd).toBe(".");
    });

    it("accepts optional model parameter", () => {
      const adapter = createMockClaudeAdapter();
      // model is optional — both calls should work
      const withModel = adapter.buildSpawnConfig(envelope, policy, "claude-sonnet-4-20250514");
      const withoutModel = adapter.buildSpawnConfig(envelope, policy, undefined);
      expect(withModel).toBeDefined();
      expect(withoutModel).toBeDefined();
    });

    it("receives the PromptEnvelope with sections", () => {
      let capturedEnvelope: PromptEnvelope | null = null;
      const adapter: VendorAdapter = {
        vendor: "claude",
        parseMode: "stream-json",
        buildSpawnConfig(env, pol, model) {
          capturedEnvelope = env;
          return { binary: "claude", args: [], env: {}, stdinContent: null, cwd: "." };
        },
        parseEvent: () => null,
        classifyError: () => "unknown",
      };
      adapter.buildSpawnConfig(envelope, policy, undefined);
      expect(capturedEnvelope).not.toBeNull();
      expect(capturedEnvelope!.sections).toHaveLength(2);
      expect(capturedEnvelope!.sections[0].name).toBe("system");
    });

    it("receives the ExecutionPolicy", () => {
      let capturedPolicy: ExecutionPolicy | null = null;
      const adapter: VendorAdapter = {
        vendor: "codex",
        parseMode: "json",
        buildSpawnConfig(env, pol, model) {
          capturedPolicy = pol;
          return { binary: "codex", args: [], env: {}, stdinContent: null, cwd: "." };
        },
        parseEvent: () => null,
        classifyError: () => "unknown",
      };
      adapter.buildSpawnConfig(envelope, policy, undefined);
      expect(capturedPolicy).not.toBeNull();
      expect(capturedPolicy!.sandbox).toBe("workspace-write");
    });
  });

  describe("parseEvent", () => {
    it("returns RuntimeEvent or null", () => {
      const adapter = createMockClaudeAdapter();
      const result = adapter.parseEvent('{"type":"assistant"}', 1, {});
      // Mock returns null, which is valid
      expect(result).toBeNull();
    });

    it("receives line, turn number, and metadata", () => {
      let capturedArgs: { line: string; turn: number; metadata: Record<string, unknown> } | null = null;
      const adapter: VendorAdapter = {
        vendor: "claude",
        parseMode: "stream-json",
        buildSpawnConfig: () => ({ binary: "", args: [], env: {}, stdinContent: null, cwd: "." }),
        parseEvent(line, turn, metadata) {
          capturedArgs = { line, turn, metadata };
          return null;
        },
        classifyError: () => "unknown",
      };
      adapter.parseEvent('{"test": true}', 3, { model: "claude-sonnet" });
      expect(capturedArgs).not.toBeNull();
      expect(capturedArgs!.line).toBe('{"test": true}');
      expect(capturedArgs!.turn).toBe(3);
      expect(capturedArgs!.metadata).toEqual({ model: "claude-sonnet" });
    });

    it("can return a RuntimeEvent", () => {
      const adapter: VendorAdapter = {
        vendor: "claude",
        parseMode: "stream-json",
        buildSpawnConfig: () => ({ binary: "", args: [], env: {}, stdinContent: null, cwd: "." }),
        parseEvent(line, turn, metadata): RuntimeEvent | null {
          return {
            type: "assistant",
            vendor: "claude",
            turn,
            timestamp: new Date().toISOString(),
            text: "Hello",
          };
        },
        classifyError: () => "unknown",
      };
      const event = adapter.parseEvent("test", 1, {});
      expect(event).not.toBeNull();
      expect(event!.type).toBe("assistant");
      expect(event!.vendor).toBe("claude");
      expect(event!.turn).toBe(1);
      expect(event!.text).toBe("Hello");
    });
  });

  describe("classifyError", () => {
    it("returns a FailureCategory", () => {
      const adapter = createMockClaudeAdapter();
      const category: FailureCategory = adapter.classifyError(new Error("test"));
      expect(category).toBe("unknown");
    });

    it("accepts Error objects", () => {
      const adapter = createMockClaudeAdapter();
      const result = adapter.classifyError(new Error("auth failed"));
      expect(typeof result).toBe("string");
    });

    it("accepts unknown values", () => {
      const adapter = createMockClaudeAdapter();
      const result = adapter.classifyError("string error");
      expect(typeof result).toBe("string");
    });

    it("returns valid FailureCategory values", () => {
      const validCategories: FailureCategory[] = [
        "auth", "not_found", "timeout", "rate_limit",
        "completion_rejected", "budget_exceeded", "spin_detected",
        "malformed_output", "mcp_unavailable", "transient_exhausted", "unknown",
      ];
      const adapter = createMockClaudeAdapter();
      const result = adapter.classifyError(new Error("test"));
      expect(validCategories).toContain(result);
    });
  });

  describe("interface composability", () => {
    it("adapter can be selected by vendor type", () => {
      const adapters: Record<LLMVendor, VendorAdapter> = {
        claude: createMockClaudeAdapter(),
        codex: createMockCodexAdapter(),
      };
      expect(adapters.claude.vendor).toBe("claude");
      expect(adapters.codex.vendor).toBe("codex");
    });

    it("adapter buildSpawnConfig composes with runtime-contract types", () => {
      const adapter = createMockClaudeAdapter();
      // Verify the full pipeline: envelope → adapter → SpawnConfig
      const env = createPromptEnvelope([
        { name: "system", content: "System prompt" },
        { name: "workflow", content: "Workflow rules" },
        { name: "brief", content: "Task brief" },
      ]);
      const config: SpawnConfig = adapter.buildSpawnConfig(env, DEFAULT_EXECUTION_POLICY, "model-v1");
      expect(config).toBeDefined();
      expect(typeof config.binary).toBe("string");
      expect(Array.isArray(config.args)).toBe(true);
    });
  });
});
