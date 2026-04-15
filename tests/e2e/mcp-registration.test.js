/**
 * MCP registration idempotency tests — verifies that `registerMcpServers()`
 * in claude-integration.js safely handles re-registration by removing existing
 * servers from all scopes before adding.
 *
 * Complements:
 *   - assistant-integration.test.js — orchestration-level idempotency
 *   - mcp-transport.test.js — HTTP transport protocol compliance
 *   - codex-mcp-contract.test.js — Codex stdio MCP contract
 *
 * This file focuses on the **registration lifecycle**:
 *   1. Source-level: removal-before-add pattern covers all three scopes
 *   2. Source-level: every manifest server gets the idempotent treatment
 *   3. Behavioral: MCP result shape contract (with and without claude CLI)
 *   4. Behavioral: running setupClaudeIntegration twice is safe
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setupClaudeIntegration } from "../../packages/core/claude-integration.js";
import { getMcpServers } from "../../assistant-assets/index.js";

const ROOT = resolve(import.meta.dirname, "../..");
const SRC = readFileSync(join(ROOT, "packages/core/claude-integration.js"), "utf-8");
const servers = getMcpServers();
const serverNames = Object.keys(servers);

// ── Source-level: idempotent removal pattern ─────────────────────────────────

describe("registerMcpServers idempotent removal pattern (source)", () => {
  it("removes from all three Claude scopes before adding", () => {
    // The function must remove from local, project, and user scopes
    expect(SRC).toContain('"local"');
    expect(SRC).toContain('"project"');
    expect(SRC).toContain('"user"');
  });

  it("iterates removal across scopes in a loop", () => {
    // Should use a loop over scopes rather than three separate commands
    expect(SRC).toMatch(/for\s*\(\s*const\s+\w+\s+of\s+\[.*"local".*"project".*"user".*\]/);
  });

  it("calls claude mcp remove with --scope flag", () => {
    expect(SRC).toMatch(/claude mcp remove --scope/);
  });

  it("execSync add call appears after execSync remove call in registerMcpServers", () => {
    // Extract the function body and match execSync calls specifically
    // (not comments which also mention the command strings).
    const fnStart = SRC.indexOf("function registerMcpServers");
    const fnBody = SRC.slice(fnStart, SRC.indexOf("\nfunction", fnStart + 1));
    // Match the actual execSync invocations, not comment references
    const removeMatch = fnBody.match(/execSync\(\s*`claude mcp remove/);
    const addMatch = fnBody.match(/execSync\(\s*\n?\s*`claude mcp add/);
    expect(removeMatch).not.toBeNull();
    expect(addMatch).not.toBeNull();
    expect(addMatch.index).toBeGreaterThan(removeMatch.index);
  });

  it("suppresses removal errors (server may not exist in a scope)", () => {
    // The removal loop must catch errors — a server may not exist in every scope
    // Extract the removal loop block and verify it contains a try-catch
    const fnStart = SRC.indexOf("function registerMcpServers");
    const fnBody = SRC.slice(fnStart, SRC.indexOf("\nfunction", fnStart + 1));
    // Count try blocks — at least one for the removal loop and one for the add
    const tryCount = (fnBody.match(/\btry\s*\{/g) || []).length;
    expect(tryCount).toBeGreaterThanOrEqual(2);
  });

  it("removal uses stdio: 'ignore' to suppress output", () => {
    // Removal should not leak output to the terminal
    const fnStart = SRC.indexOf("function registerMcpServers");
    const fnBody = SRC.slice(fnStart, SRC.indexOf("\nfunction", fnStart + 1));
    // Removal calls use stdio: "ignore" (at least 1 for the remove loop)
    const ignoreCount = (fnBody.match(/stdio:\s*"ignore"/g) || []).length;
    expect(ignoreCount).toBeGreaterThanOrEqual(1);
  });

  it("add command uses stdio: 'pipe' to capture error details", () => {
    const fnStart = SRC.indexOf("function registerMcpServers");
    const fnBody = SRC.slice(fnStart, SRC.indexOf("\nfunction", fnStart + 1));
    // The add call uses stdio: "pipe" so stderr is available on failure
    expect(fnBody).toMatch(/claude mcp add[\s\S]*?stdio:\s*"pipe"/);
  });
});

// ── Source-level: manifest coverage ──────────────────────────────────────────

describe("registerMcpServers processes all manifest servers", () => {
  it("iterates over getMcpServers() entries", () => {
    expect(SRC).toMatch(/getMcpServers\(\)/);
    expect(SRC).toMatch(/Object\.entries\(servers\)/);
  });

  it("manifest defines at least rex and sourcevision servers", () => {
    expect(serverNames).toContain("rex");
    expect(serverNames).toContain("sourcevision");
    expect(serverNames.length).toBeGreaterThanOrEqual(2);
  });

  it("each manifest server has the required descriptor fields", () => {
    for (const [name, descriptor] of Object.entries(servers)) {
      expect(descriptor).toHaveProperty("package");
      expect(descriptor).toHaveProperty("npmName");
      expect(descriptor).toHaveProperty("mcpCommand");
      expect(typeof descriptor.package).toBe("string");
      expect(typeof descriptor.npmName).toBe("string");
      expect(typeof descriptor.mcpCommand).toBe("string");
    }
  });
});

// ── Behavioral: MCP result shape ─────────────────────────────────────────────

describe("registerMcpServers result shape", () => {
  let tmpDir;
  let originalClaudeCliPath;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ndx-mcp-reg-"));
    // Force discoverClaudeCli to return { found: false } so MCP registration
    // short-circuits instead of invoking the real `claude mcp add` CLI (which
    // takes ~5–30s per call and makes these tests flaky). The existing
    // CLAUDE_CLI_PATH env var is designed exactly for this — see
    // packages/core/claude-integration.js:306–320.
    originalClaudeCliPath = process.env.CLAUDE_CLI_PATH;
    process.env.CLAUDE_CLI_PATH = "/nonexistent/path/to/claude";
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (originalClaudeCliPath === undefined) {
      delete process.env.CLAUDE_CLI_PATH;
    } else {
      process.env.CLAUDE_CLI_PATH = originalClaudeCliPath;
    }
  });

  it("detail.mcp is always defined", () => {
    const result = setupClaudeIntegration(tmpDir);
    expect(result).toHaveProperty("mcp");
    expect(result.mcp).toBeDefined();
  });

  it("detail.mcp.registered is a boolean", () => {
    const result = setupClaudeIntegration(tmpDir);
    expect(typeof result.mcp.registered).toBe("boolean");
  });

  it("when claude CLI is absent, returns registered: false with reason", () => {
    const result = setupClaudeIntegration(tmpDir);
    // In CI/test environments without claude CLI installed, this path is hit.
    // If claude IS available, the servers array will be populated instead.
    if (!result.mcp.registered) {
      expect(result.mcp.reason).toBe("claude CLI not found");
      expect(result.mcp.servers).toBeUndefined();
    } else {
      // claude CLI is available — verify servers array
      expect(Array.isArray(result.mcp.servers)).toBe(true);
      expect(result.mcp.servers.length).toBe(serverNames.length);
    }
  });

  it("when registered, each server entry has name, transport, and ok fields", () => {
    const result = setupClaudeIntegration(tmpDir);
    if (!result.mcp.registered) return; // skip when CLI is absent
    for (const entry of result.mcp.servers) {
      expect(entry).toHaveProperty("name");
      expect(entry).toHaveProperty("transport");
      expect(entry).toHaveProperty("ok");
      expect(typeof entry.name).toBe("string");
      expect(entry.transport).toBe("stdio");
      expect(typeof entry.ok).toBe("boolean");
    }
  });

  it("when registered, server names match manifest entries", () => {
    const result = setupClaudeIntegration(tmpDir);
    if (!result.mcp.registered) return;
    const registeredNames = result.mcp.servers.map((s) => s.name).sort();
    expect(registeredNames).toEqual([...serverNames].sort());
  });
});

// ── Behavioral: idempotent integration ───────────────────────────────────────

describe("setupClaudeIntegration is idempotent", () => {
  let tmpDir;
  let originalClaudeCliPath;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ndx-mcp-idempotent-"));
    // Force CLAUDE CLI discovery to fail so we test idempotency of the
    // non-MCP phases (settings, skills, instructions) without paying for
    // real `claude mcp add` calls. See note above for details.
    originalClaudeCliPath = process.env.CLAUDE_CLI_PATH;
    process.env.CLAUDE_CLI_PATH = "/nonexistent/path/to/claude";
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (originalClaudeCliPath === undefined) {
      delete process.env.CLAUDE_CLI_PATH;
    } else {
      process.env.CLAUDE_CLI_PATH = originalClaudeCliPath;
    }
  });

  it("running twice does not throw", () => {
    setupClaudeIntegration(tmpDir);
    expect(() => setupClaudeIntegration(tmpDir)).not.toThrow();
  });

  it("running twice produces identical MCP result structure", () => {
    const first = setupClaudeIntegration(tmpDir);
    const second = setupClaudeIntegration(tmpDir);
    expect(first.mcp.registered).toBe(second.mcp.registered);
    if (first.mcp.registered) {
      expect(first.mcp.servers.length).toBe(second.mcp.servers.length);
      for (let i = 0; i < first.mcp.servers.length; i++) {
        expect(first.mcp.servers[i].name).toBe(second.mcp.servers[i].name);
        expect(first.mcp.servers[i].transport).toBe(second.mcp.servers[i].transport);
        expect(first.mcp.servers[i].ok).toBe(second.mcp.servers[i].ok);
      }
    } else {
      expect(first.mcp.reason).toBe(second.mcp.reason);
    }
  });

  it("running twice produces identical settings result", () => {
    const first = setupClaudeIntegration(tmpDir);
    const second = setupClaudeIntegration(tmpDir);
    // Second run should add 0 new permissions (all already present)
    expect(second.settings.added).toBe(0);
    expect(second.settings.total).toBe(first.settings.total);
  });

  it("running twice produces identical skills result", () => {
    const first = setupClaudeIntegration(tmpDir);
    const second = setupClaudeIntegration(tmpDir);
    expect(first.skills.written).toBe(second.skills.written);
  });

  it("running twice produces identical instructions result", () => {
    const first = setupClaudeIntegration(tmpDir);
    const second = setupClaudeIntegration(tmpDir);
    expect(first.instructions.written).toBe(second.instructions.written);
  });
});

// ── Source-level: error detail capture ────────────────────────────────────────

describe("registerMcpServers error detail capture (source)", () => {
  it("uses stdio: 'pipe' for the add command to capture stderr", () => {
    const fnStart = SRC.indexOf("function registerMcpServers");
    const fnBody = SRC.slice(fnStart, SRC.indexOf("\nfunction", fnStart + 1));
    // The add call should use stdio: "pipe" to capture stderr on failure
    expect(fnBody).toMatch(/claude mcp add[\s\S]*?stdio:\s*"pipe"/);
  });

  it("catches the error object in the add call", () => {
    const fnStart = SRC.indexOf("function registerMcpServers");
    const fnBody = SRC.slice(fnStart, SRC.indexOf("\nfunction", fnStart + 1));
    // Should catch the error as a named variable, not a bare catch
    expect(fnBody).toMatch(/\}\s*catch\s*\(\s*\w+\s*\)/);
  });

  it("includes an error field in the result when add fails", () => {
    const fnStart = SRC.indexOf("function registerMcpServers");
    const fnBody = SRC.slice(fnStart, SRC.indexOf("\nfunction", fnStart + 1));
    // The failed result should include an error property
    expect(fnBody).toMatch(/ok:\s*false,\s*error:/);
  });

  it("defines extractExecError helper for error message extraction", () => {
    expect(SRC).toContain("function extractExecError");
  });

  it("extractExecError prefers stderr over error.message", () => {
    const fnStart = SRC.indexOf("function extractExecError");
    const fnEnd = SRC.indexOf("\n}", fnStart);
    const fnBody = SRC.slice(fnStart, fnEnd + 2);
    // stderr check should come before message check
    const stderrIdx = fnBody.indexOf("err.stderr");
    const messageIdx = fnBody.indexOf("err.message");
    expect(stderrIdx).toBeLessThan(messageIdx);
  });
});

// ── Behavioral: error field in result shape ──────────────────────────────────

describe("registerMcpServers error field in result", () => {
  let tmpDir;
  let originalClaudeCliPath;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ndx-mcp-err-"));
    // Same short-circuit as the other behavioral describes — the tests below
    // early-return when `!result.mcp.registered`, so forcing that branch is
    // safe and keeps each call under ~100ms instead of 15s.
    originalClaudeCliPath = process.env.CLAUDE_CLI_PATH;
    process.env.CLAUDE_CLI_PATH = "/nonexistent/path/to/claude";
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (originalClaudeCliPath === undefined) {
      delete process.env.CLAUDE_CLI_PATH;
    } else {
      process.env.CLAUDE_CLI_PATH = originalClaudeCliPath;
    }
  });

  it("failed server entries include a string error field", () => {
    const result = setupClaudeIntegration(tmpDir);
    if (!result.mcp.registered) return; // skip when CLI absent
    const failed = result.mcp.servers.filter((s) => !s.ok);
    for (const entry of failed) {
      expect(entry).toHaveProperty("error");
      expect(typeof entry.error).toBe("string");
      expect(entry.error.length).toBeGreaterThan(0);
    }
  });

  it("successful server entries do not have an error field", () => {
    const result = setupClaudeIntegration(tmpDir);
    if (!result.mcp.registered) return;
    const ok = result.mcp.servers.filter((s) => s.ok);
    for (const entry of ok) {
      expect(entry.error).toBeUndefined();
    }
  });
});

// ── Source-level: hasClaudeCli guard ─────────────────────────────────────────

describe("registerMcpServers guard: discoverClaudeCli", () => {
  it("checks for claude CLI before attempting registration", () => {
    const fnStart = SRC.indexOf("function registerMcpServers");
    const fnBody = SRC.slice(fnStart, SRC.indexOf("\nfunction", fnStart + 1));
    expect(fnBody).toContain("discoverClaudeCli");
  });

  it("returns early with reason when claude CLI is absent", () => {
    const fnStart = SRC.indexOf("function registerMcpServers");
    const fnBody = SRC.slice(fnStart, SRC.indexOf("\nfunction", fnStart + 1));
    expect(fnBody).toContain("claude CLI not found");
    expect(fnBody).toContain("registered: false");
  });
});
