/**
 * `ndx init` must not create an absolute-path local-scope MCP registration,
 * and must report one it finds.
 *
 * Claude Code applies a repository's local-scope entry to sessions started in
 * that repository's other linked worktrees. An absolute project directory in
 * the entry's argv therefore pins all of them to one checkout: a hench run in
 * `~/ndx-core/n-dx-071-capture` had its `update_task_status` write the task
 * file in `~/ndx-core/n-dx`, on whatever branch that checkout had out. The
 * registration now records `.`, which each session resolves against its own
 * cwd.
 *
 * Same shim boundary as claude-mcp-scope-flag.test.js: `execFileSyncCli` is
 * mocked so no real `claude` is spawned; fs and tmp dirs are real.
 *
 * @see packages/core/claude-integration.js — registerMcpServers, findPinnedLocalEntries
 * @see packages/core/assistant-integration.js — formatPinnedMcpWarning
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
import { formatPinnedMcpWarning } from "../../packages/core/assistant-integration.js";
import { getMcpServers } from "../../packages/core/assistant-assets.js";

const serverNames = Object.keys(getMcpServers());

describe("ndx init writes no absolute project directory", () => {
  let tmpDir;
  let fakeClaude;
  let originalClaudeCliPath;
  let originalConfigDir;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ndx-mcp-pinned-"));
    fakeClaude = join(tmpDir, "fake-claude");
    writeFileSync(fakeClaude, "#!/bin/sh\n");

    originalClaudeCliPath = process.env.CLAUDE_CLI_PATH;
    originalConfigDir = process.env.CLAUDE_CONFIG_DIR;
    process.env.CLAUDE_CLI_PATH = fakeClaude;
    process.env.CLAUDE_CONFIG_DIR = join(tmpDir, "no-such-config-dir");

    execFileSyncCli.mockReset();
    execFileSyncCli.mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (originalClaudeCliPath === undefined) delete process.env.CLAUDE_CLI_PATH;
    else process.env.CLAUDE_CLI_PATH = originalClaudeCliPath;
    if (originalConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
    else process.env.CLAUDE_CONFIG_DIR = originalConfigDir;
  });

  function addCalls() {
    return execFileSyncCli.mock.calls
      .filter(([cmd, args]) => cmd === fakeClaude && args[0] === "mcp" && args[1] === "add")
      .map(([, args]) => args);
  }

  /** Seed `~/.claude.json` with a local-scope entry pinning `pinnedDir`. */
  function seedRegistration(projectKey, pinnedDir) {
    const configDir = join(tmpDir, `config-${Math.random().toString(36).slice(2)}`);
    mkdirSync(configDir, { recursive: true });
    const mcpServers = {};
    for (const name of serverNames) {
      mcpServers[name] = { args: ["node", `/abs/${name}/dist/cli/index.js`, "mcp", pinnedDir] };
    }
    writeFileSync(
      join(configDir, ".claude.json"),
      JSON.stringify({ projects: { [projectKey]: { mcpServers } } }),
    );
    process.env.CLAUDE_CONFIG_DIR = configDir;
  }

  it("registers the project as '.', never as an absolute directory", () => {
    const projectDir = join(tmpDir, "project");

    setupClaudeIntegration(projectDir, { mcpScope: "local" });

    const calls = addCalls();
    expect(calls.length).toBe(serverNames.length);
    for (const args of calls) {
      // The project directory is the trailing positional of `… mcp <dir>`.
      expect(args[args.length - 1]).toBe(".");
      expect(args).not.toContain(projectDir);
    }
  });

  it("keeps the tracked .mcp.json cwd-relative too", () => {
    const result = setupClaudeIntegration(join(tmpDir, "tracked"));
    expect(result.mcpJson.written).toBe(true);
    // buildTrackedMcpServers and registerMcpServers share one constant, so a
    // change to either cannot silently diverge from the other.
    expect(result.mcpJson.servers.sort()).toEqual([...serverNames].sort());
  });

  it("reports an entry pinning another checkout, which it cannot remove", () => {
    // `claude mcp remove --scope local` is cwd-scoped: run from this worktree
    // it cannot retire an entry filed under the main checkout's key.
    const projectDir = join(tmpDir, "worktree");
    const otherCheckout = join(tmpDir, "main-checkout");
    seedRegistration(projectDir, otherCheckout);

    const result = setupClaudeIntegration(projectDir);

    expect(result.mcp.pinned.map((p) => p.name).sort()).toEqual([...serverNames].sort());
    expect(result.mcp.pinned.every((p) => p.pinnedDir === otherCheckout)).toBe(true);
  });

  it("does not report an entry naming this project — the cleanup removes that one", () => {
    const projectDir = join(tmpDir, "self-pinned");
    seedRegistration(projectDir, projectDir);

    const result = setupClaudeIntegration(projectDir);

    expect(result.mcp.pinned).toEqual([]);
    const removes = execFileSyncCli.mock.calls.filter(
      ([cmd, args]) => cmd === fakeClaude && args[0] === "mcp" && args[1] === "remove",
    );
    expect(removes.length).toBe(serverNames.length);
  });

  it("reports every pinned entry when the claude CLI is missing and nothing can be removed", () => {
    const projectDir = join(tmpDir, "no-cli");
    seedRegistration(projectDir, projectDir);
    process.env.CLAUDE_CLI_PATH = join(tmpDir, "absent-claude");

    const result = setupClaudeIntegration(projectDir);

    expect(result.mcp.registered).toBe(false);
    expect(result.mcp.pinned.map((p) => p.name).sort()).toEqual([...serverNames].sort());
  });

  it("reports nothing when a cwd-relative entry is already on file", () => {
    const projectDir = join(tmpDir, "already-relative");
    seedRegistration(projectDir, ".");

    const result = setupClaudeIntegration(projectDir);

    expect(result.mcp.pinned).toEqual([]);
  });
});

describe("formatPinnedMcpWarning", () => {
  it("names the pinned directory and the removal command", () => {
    const lines = formatPinnedMcpWarning([
      { name: "rex", pinnedDir: "/Users/x/ndx-core/n-dx" },
    ]);

    const text = lines.join("\n");
    expect(text).toContain("/Users/x/ndx-core/n-dx");
    expect(text).toContain("claude mcp remove --scope local rex");
  });

  it("says nothing when there is nothing pinned", () => {
    expect(formatPinnedMcpWarning([])).toEqual([]);
    expect(formatPinnedMcpWarning(undefined)).toEqual([]);
  });
});
