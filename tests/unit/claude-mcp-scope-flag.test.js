/**
 * Unit tests for the `--mcp-scope=local` mode switch in
 * `registerMcpServers()` (packages/core/claude-integration.js).
 *
 * `ndx init` defaults to the tracked `.mcp.json` for MCP registration — no
 * `claude mcp add` call is made at all. `{ mcpScope: "local" }` restores the
 * legacy `claude mcp add --scope local` behaviour. Either way, a stale
 * local-scope entry from a prior run is cleaned up first, but only "local"
 * scope is ever touched, and only when the existing entry's own recorded
 * args actually target this project — "user" and "project" scope are never
 * removed by any code path.
 *
 * Shim approach (same boundary claude-discovery.test.js mocks): mock
 * win-spawn.js's `execFileSyncCli` so no real `claude` process is spawned.
 * Everything else (fs, tmp dirs) is real — `setupClaudeIntegration()` also
 * writes settings/skills/CLAUDE.md/.mcp.json, which is easiest to exercise
 * against a real tmpdir rather than a fully mocked fs.
 *
 * @see packages/core/claude-integration.js — registerMcpServers, localEntryTargetsProject
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("../../packages/core/win-spawn.js", async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, execFileSyncCli: vi.fn() };
});

import { execFileSyncCli } from "../../packages/core/win-spawn.js";
import { setupClaudeIntegration } from "../../packages/core/claude-integration.js";
import { getMcpServers } from "../../packages/core/assistant-assets.js";

const serverNames = Object.keys(getMcpServers());

describe("registerMcpServers — default (tracked) vs --mcp-scope=local", () => {
  let tmpDir;
  let fakeClaude;
  let originalClaudeCliPath;
  let originalConfigDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ndx-mcp-scope-unit-"));
    fakeClaude = join(tmpDir, "fake-claude");
    writeFileSync(fakeClaude, "#!/bin/sh\n");

    originalClaudeCliPath = process.env.CLAUDE_CLI_PATH;
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CLI_PATH = fakeClaude;
    // No Claude config on disk under this dir — readLocalMcpServers finds
    // nothing, so the stale-entry cleanup loop is a no-op unless a test
    // seeds one explicitly.
    process.env.CLAUDE_CONFIG_DIR = join(tmpDir, "no-such-config-dir");

    execFileSyncCli.mockReset();
    execFileSyncCli.mockImplementation(() => {}); // every claude invocation "succeeds"
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (originalClaudeCliPath === undefined) delete process.env.CLAUDE_CLI_PATH;
    else process.env.CLAUDE_CLI_PATH = originalClaudeCliPath;
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
  });

  /** Every execFileSyncCli call made against the fake claude binary. */
  function claudeCalls() {
    return execFileSyncCli.mock.calls.filter(([cmd]) => cmd === fakeClaude);
  }

  it("default mode makes no 'claude mcp add' calls", () => {
    const result = setupClaudeIntegration(join(tmpDir, "project"));

    const addCalls = claudeCalls().filter(([, args]) => args[0] === "mcp" && args[1] === "add");
    expect(addCalls).toEqual([]);
    expect(result.mcp.registered).toBe(false);
    expect(result.mcp.mode).toBe("tracked");
  });

  it("default mode still writes the tracked .mcp.json for every manifest server", () => {
    const result = setupClaudeIntegration(join(tmpDir, "project2"));

    expect(result.mcpJson.written).toBe(true);
    expect(result.mcpJson.servers.sort()).toEqual([...serverNames].sort());
  });

  it("--mcp-scope=local restores a 'claude mcp add --scope local' call for every manifest server", () => {
    const result = setupClaudeIntegration(join(tmpDir, "project3"), { mcpScope: "local" });

    const addCalls = claudeCalls().filter(([, args]) => args[0] === "mcp" && args[1] === "add");
    expect(addCalls.length).toBe(serverNames.length);
    for (const [, args] of addCalls) {
      const scopeIndex = args.indexOf("--scope");
      expect(scopeIndex).toBeGreaterThan(-1);
      expect(args[scopeIndex + 1]).toBe("local");
    }
    expect(result.mcp.registered).toBe(true);
    expect(result.mcp.mode).toBe("local");
    expect(result.mcp.servers.map((s) => s.name).sort()).toEqual([...serverNames].sort());
  });

  it("never calls 'claude mcp remove --scope user', in either mode", () => {
    setupClaudeIntegration(join(tmpDir, "a"));
    setupClaudeIntegration(join(tmpDir, "b"), { mcpScope: "local" });

    const removeUserCalls = execFileSyncCli.mock.calls.filter(
      ([, args]) => Array.isArray(args) && args[0] === "mcp" && args[1] === "remove" && args.includes("user"),
    );
    expect(removeUserCalls).toEqual([]);
  });

  it("never calls 'claude mcp remove --scope project' — project scope is .mcp.json, owned by writeMcpJson", () => {
    setupClaudeIntegration(join(tmpDir, "c"), { mcpScope: "local" });

    const removeProjectCalls = execFileSyncCli.mock.calls.filter(
      ([, args]) => Array.isArray(args) && args[0] === "mcp" && args[1] === "remove" && args.includes("project"),
    );
    expect(removeProjectCalls).toEqual([]);
  });

  it("cleans up a stale local-scope entry that targets this project (local scope only)", () => {
    const projectDir = join(tmpDir, "stale-project");
    const configDir = join(tmpDir, "claude-config-stale");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, ".claude.json"),
      JSON.stringify({
        projects: {
          [projectDir]: {
            mcpServers: {
              [serverNames[0]]: { args: ["node", "/abs/dist/cli/index.js", "mcp", projectDir] },
            },
          },
        },
      }),
    );
    process.env.CLAUDE_CONFIG_DIR = configDir;

    setupClaudeIntegration(projectDir);

    const removeCalls = claudeCalls()
      .filter(([, args]) => args[0] === "mcp" && args[1] === "remove")
      .map(([, args]) => args);
    expect(removeCalls).toEqual([["mcp", "remove", "--scope", "local", serverNames[0]]]);
  });

  it("does not remove a same-named local entry whose args do not target this project", () => {
    const projectDir = join(tmpDir, "safe-project");
    const configDir = join(tmpDir, "claude-config-safe");
    mkdirSync(configDir, { recursive: true });
    writeFileSync(
      join(configDir, ".claude.json"),
      JSON.stringify({
        projects: {
          [projectDir]: {
            mcpServers: {
              [serverNames[0]]: { args: ["node", "/abs/dist/cli/index.js", "mcp", "/some/other/dir"] },
            },
          },
        },
      }),
    );
    process.env.CLAUDE_CONFIG_DIR = configDir;

    setupClaudeIntegration(projectDir);

    const removeCalls = claudeCalls().filter(([, args]) => args[0] === "mcp" && args[1] === "remove");
    expect(removeCalls).toEqual([]);
  });
});
