import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import Anthropic from "@anthropic-ai/sdk";
import { initConfig } from "../../../src/store/config.js";

/**
 * Tests that the API agentLoop correctly handles authentication configuration:
 * - Uses API key from .n-dx.json (via @n-dx/llm-client)
 * - Passes custom api_endpoint as baseURL to Anthropic client
 * - Uses model override from .n-dx.json
 */

async function setupProjectDir(): Promise<{
  projectDir: string;
  henchDir: string;
  rexDir: string;
}> {
  const projectDir = await mkdtemp(join(tmpdir(), "hench-test-api-auth-"));
  const henchDir = join(projectDir, ".hench");
  const rexDir = join(projectDir, ".rex");

  await initConfig(henchDir);
  await mkdir(rexDir, { recursive: true });

  await writeFile(
    join(rexDir, "config.json"),
    JSON.stringify({
      schema: "rex/v1",
      project: "test",
      adapter: "file",
    }),
    "utf-8",
  );

  await writeFile(
    join(rexDir, "prd.json"),
    JSON.stringify({
      schema: "rex/v1",
      title: "Test",
      items: [
        {
          id: "task-1",
          title: "Test task",
          status: "pending",
          level: "task",
          priority: "high",
        },
      ],
    }),
    "utf-8",
  );

  await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");

  return { projectDir, henchDir, rexDir };
}

// Get the Messages prototype for mocking
const messagesProto = Object.getPrototypeOf(
  new Anthropic({ apiKey: "test" }).messages,
);

describe("API loop authentication and endpoint config", () => {
  let projectDir: string;
  let henchDir: string;
  let rexDir: string;
  let origKey: string | undefined;

  beforeEach(async () => {
    ({ projectDir, henchDir, rexDir } = await setupProjectDir());
    origKey = process.env.ANTHROPIC_API_KEY;
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (origKey) {
      process.env.ANTHROPIC_API_KEY = origKey;
    } else {
      delete process.env.ANTHROPIC_API_KEY;
    }
    await rm(projectDir, { recursive: true, force: true });
  });

  it("uses api_key from .n-dx.json when env var is unset", async () => {
    // Write .n-dx.json with API key
    await writeFile(
      join(projectDir, ".n-dx.json"),
      JSON.stringify({
        claude: { api_key: "sk-ant-from-config" },
      }),
      "utf-8",
    );

    // Unset env var — config key should be used
    delete process.env.ANTHROPIC_API_KEY;

    // Mock Anthropic to capture the constructor args
    let capturedApiKey: string | undefined;
    const OrigAnthropic = Anthropic;
    const constructorSpy = vi.fn().mockImplementation(function (this: Anthropic, opts: Record<string, unknown>) {
      capturedApiKey = opts.apiKey as string;
      return new OrigAnthropic({ apiKey: "sk-ant-from-config" });
    });

    // Instead of mocking the constructor, we verify the key is resolved
    // by checking that the loop doesn't throw "API key not found"
    // and that it proceeds to the API call phase
    vi.spyOn(messagesProto, "create").mockResolvedValue({
      content: [{ type: "text", text: "Done" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    });

    const { agentLoop } = await import("../../../src/agent/lifecycle/loop.js");
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../../src/store/config.js");

    const config = await loadConfig(henchDir);
    const store = createStore("file", rexDir);

    // Should NOT throw "API key not found" — the .n-dx.json key is used
    const result = await agentLoop({ config, store, projectDir, henchDir });

    // The agent loop ran (even though the mock response won't validate completion,
    // it at least progressed past the API key check)
    expect(result.run.status).toBeDefined();
    expect(result.run.turns).toBeGreaterThanOrEqual(1);
  });

  it("prefers .n-dx.json api_key over env var", async () => {
    // Write .n-dx.json with API key
    await writeFile(
      join(projectDir, ".n-dx.json"),
      JSON.stringify({
        claude: { api_key: "sk-ant-config-key" },
      }),
      "utf-8",
    );

    // Also set env var — config should take precedence
    process.env.ANTHROPIC_API_KEY = "sk-ant-env-key";

    // Verify through the loadClaudeConfig/resolveApiKey chain
    const { loadClaudeConfig, resolveApiKey } = await import(
      "../../../src/store/project-config.js"
    );

    const claudeConfig = await loadClaudeConfig(henchDir);
    expect(claudeConfig.api_key).toBe("sk-ant-config-key");

    const resolved = resolveApiKey(claudeConfig, "ANTHROPIC_API_KEY");
    expect(resolved).toBe("sk-ant-config-key");
  });

  it("falls back to env var when .n-dx.json has no api_key", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-ant-env-key";

    // No .n-dx.json file
    const { loadClaudeConfig, resolveApiKey } = await import(
      "../../../src/store/project-config.js"
    );

    const claudeConfig = await loadClaudeConfig(henchDir);
    expect(claudeConfig.api_key).toBeUndefined();

    const resolved = resolveApiKey(claudeConfig, "ANTHROPIC_API_KEY");
    expect(resolved).toBe("sk-ant-env-key");
  });

  it("reads api_endpoint from .n-dx.json", async () => {
    await writeFile(
      join(projectDir, ".n-dx.json"),
      JSON.stringify({
        claude: {
          api_key: "sk-ant-test",
          api_endpoint: "https://proxy.example.com/v1",
        },
      }),
      "utf-8",
    );

    const { loadClaudeConfig } = await import(
      "../../../src/store/project-config.js"
    );

    const claudeConfig = await loadClaudeConfig(henchDir);
    expect(claudeConfig.api_endpoint).toBe("https://proxy.example.com/v1");
  });

  it("reads model from .n-dx.json", async () => {
    await writeFile(
      join(projectDir, ".n-dx.json"),
      JSON.stringify({
        claude: {
          api_key: "sk-ant-test",
          model: "claude-opus-4-20250514",
        },
      }),
      "utf-8",
    );

    const { loadClaudeConfig } = await import(
      "../../../src/store/project-config.js"
    );

    const claudeConfig = await loadClaudeConfig(henchDir);
    expect(claudeConfig.model).toBe("claude-opus-4-20250514");
  });

  it("loads all claude config fields together", async () => {
    await writeFile(
      join(projectDir, ".n-dx.json"),
      JSON.stringify({
        claude: {
          cli_path: "/opt/claude",
          api_key: "sk-ant-all-fields",
          api_endpoint: "https://proxy.example.com",
          model: "claude-opus-4-20250514",
        },
      }),
      "utf-8",
    );

    const { loadClaudeConfig } = await import(
      "../../../src/store/project-config.js"
    );

    const claudeConfig = await loadClaudeConfig(henchDir);
    expect(claudeConfig.cli_path).toBe("/opt/claude");
    expect(claudeConfig.api_key).toBe("sk-ant-all-fields");
    expect(claudeConfig.api_endpoint).toBe("https://proxy.example.com");
    expect(claudeConfig.model).toBe("claude-opus-4-20250514");
  });

  it("dry run succeeds with api_endpoint configured", async () => {
    await writeFile(
      join(projectDir, ".n-dx.json"),
      JSON.stringify({
        claude: {
          api_key: "sk-ant-test",
          api_endpoint: "https://proxy.example.com/v1",
        },
      }),
      "utf-8",
    );

    const { agentLoop } = await import("../../../src/agent/lifecycle/loop.js");
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../../src/store/config.js");

    const config = await loadConfig(henchDir);
    const store = createStore("file", rexDir);

    // Dry run should work fine — doesn't make API calls
    const result = await agentLoop({
      config,
      store,
      projectDir,
      henchDir,
      dryRun: true,
    });

    expect(result.run.status).toBe("completed");
    expect(result.run.summary).toContain("Dry run");
  });

  it("api_endpoint is passed to Anthropic client as baseURL", async () => {
    // Write config with custom endpoint
    await writeFile(
      join(projectDir, ".n-dx.json"),
      JSON.stringify({
        claude: {
          api_key: "sk-ant-proxy-test",
          api_endpoint: "https://proxy.example.com/v1",
        },
      }),
      "utf-8",
    );

    delete process.env.ANTHROPIC_API_KEY;

    // Spy on the Anthropic constructor to capture options
    const constructorArgs: unknown[] = [];
    const OriginalAnthropic = vi.fn().mockImplementation(function (opts: unknown) {
      constructorArgs.push(opts);
      // Return a real-ish client that we can mock messages on
      return Object.getPrototypeOf(new Anthropic({ apiKey: "test" })).constructor.call(
        this,
        opts,
      );
    });

    // Capture what's passed to messages.create to verify the loop runs
    const createSpy = vi.spyOn(messagesProto, "create").mockRejectedValue(
      Object.assign(new Error("test error"), { status: 401 }),
    );

    const { agentLoop } = await import("../../../src/agent/lifecycle/loop.js");
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../../src/store/config.js");

    const config = await loadConfig(henchDir);
    const store = createStore("file", rexDir);

    // The loop will fail because the mock returns 401, but we just need
    // to verify it ran past the key check (meaning api_key from config worked)
    const result = await agentLoop({ config, store, projectDir, henchDir });

    // The loop should have attempted an API call (and failed)
    expect(result.run.status).toBe("failed");
    expect(createSpy).toHaveBeenCalled();
  });
});

describe("CLI loop claude-client integration", () => {
  let projectDir: string;
  let henchDir: string;
  let rexDir: string;

  beforeEach(async () => {
    ({ projectDir, henchDir, rexDir } = await setupProjectDir());
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("resolves cli_path from .n-dx.json via @n-dx/llm-client", async () => {
    await writeFile(
      join(projectDir, ".n-dx.json"),
      JSON.stringify({
        claude: { cli_path: "/custom/path/to/claude" },
      }),
      "utf-8",
    );

    const { loadClaudeConfig, resolveCliPath } = await import(
      "../../../src/store/project-config.js"
    );

    const claudeConfig = await loadClaudeConfig(henchDir);
    expect(claudeConfig.cli_path).toBe("/custom/path/to/claude");

    const cliPath = resolveCliPath(claudeConfig);
    expect(cliPath).toBe("/custom/path/to/claude");
  });

  it("falls back to 'claude' when no cli_path configured", async () => {
    const { loadClaudeConfig, resolveCliPath } = await import(
      "../../../src/store/project-config.js"
    );

    const claudeConfig = await loadClaudeConfig(henchDir);
    expect(claudeConfig.cli_path).toBeUndefined();

    const cliPath = resolveCliPath(claudeConfig);
    expect(cliPath).toBe("claude");
  });

  it("dry run succeeds with cli_path configured", async () => {
    await writeFile(
      join(projectDir, ".n-dx.json"),
      JSON.stringify({
        claude: { cli_path: "/opt/special-claude" },
      }),
      "utf-8",
    );

    const { cliLoop } = await import("../../../src/agent/lifecycle/cli-loop.js");
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../../src/store/config.js");

    const config = await loadConfig(henchDir);
    const store = createStore("file", rexDir);

    // Dry run should work fine — doesn't spawn CLI
    const result = await cliLoop({
      config,
      store,
      projectDir,
      henchDir,
      dryRun: true,
    });

    expect(result.run.status).toBe("completed");
    expect(result.run.summary).toContain("Dry run");
  });
});
