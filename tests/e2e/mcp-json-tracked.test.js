/**
 * Tracked `.mcp.json` — `ndx init` writes cwd-relative stdio MCP server
 * entries for rex and sourcevision at the project root, independent of
 * whether the `claude` CLI is installed (unlike `registerMcpServers`, which
 * shells out to `claude mcp add`).
 *
 * Complements:
 *   - mcp-registration.test.js — the local-scope `claude mcp add` lifecycle
 *   - mcp-registration-scope.test.js — cwd handling for that same lifecycle
 *
 * @see packages/core/claude-integration.js — writeMcpJson, buildTrackedMcpServers
 * @see packages/core/cli-identity.js — getCliName
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { setupClaudeIntegration } from "../../packages/core/claude-integration.js";
import { getMcpServers } from "../../packages/core/assistant-assets.js";

const servers = getMcpServers();
const serverNames = Object.keys(servers).sort();

describe("writeMcpJson (via setupClaudeIntegration)", () => {
  let tmpDir;
  let originalClaudeCliPath;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "ndx-mcp-json-"));
    // registerMcpServers is exercised elsewhere (mcp-registration.test.js);
    // forcing claude CLI discovery to fail here keeps these tests fast and
    // focused on writeMcpJson, which must not depend on the claude CLI at all.
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

  function readMcpJson() {
    return JSON.parse(readFileSync(join(tmpDir, ".mcp.json"), "utf-8"));
  }

  it("writes .mcp.json with exactly the manifest's servers", () => {
    setupClaudeIntegration(tmpDir);
    const config = readMcpJson();
    expect(Object.keys(config.mcpServers).sort()).toEqual(serverNames);
  });

  it("every entry is cwd-relative — command is a bare name, args end in '.', no absolute paths", () => {
    setupClaudeIntegration(tmpDir);
    const config = readMcpJson();
    for (const [name, entry] of Object.entries(config.mcpServers)) {
      expect(typeof entry.command).toBe("string");
      expect(entry.command.startsWith("/")).toBe(false);
      expect(Array.isArray(entry.args)).toBe(true);
      expect(entry.args[entry.args.length - 1]).toBe(".");
      for (const arg of entry.args) {
        expect(arg.startsWith("/")).toBe(false);
        expect(arg).not.toContain(tmpDir);
      }
      expect(entry.args).toContain(servers[name].mcpCommand);
    }
  });

  it("uses each server's manifest cliCommand as the first argument", () => {
    setupClaudeIntegration(tmpDir);
    const config = readMcpJson();
    for (const [name, descriptor] of Object.entries(servers)) {
      expect(config.mcpServers[name].args[0]).toBe(descriptor.cliCommand ?? name);
    }
  });

  it("result.mcpJson reports the written path and server names", () => {
    const result = setupClaudeIntegration(tmpDir);
    expect(result.mcpJson.written).toBe(true);
    expect(result.mcpJson.path).toBe(resolve(tmpDir, ".mcp.json"));
    expect(result.mcpJson.servers.sort()).toEqual(serverNames);
  });

  it("respects a configured cli.name from .n-dx.json instead of the default", () => {
    writeFileSync(join(tmpDir, ".n-dx.json"), JSON.stringify({ cli: { name: "myapp" } }));
    setupClaudeIntegration(tmpDir);
    const config = readMcpJson();
    for (const entry of Object.values(config.mcpServers)) {
      expect(entry.command).toBe("myapp");
    }
  });

  it("re-running init is idempotent — identical output on a second run", () => {
    setupClaudeIntegration(tmpDir);
    const first = readMcpJson();
    setupClaudeIntegration(tmpDir);
    const second = readMcpJson();
    expect(second).toEqual(first);
  });

  it("merges into an existing .mcp.json, preserving unrelated servers", () => {
    writeFileSync(
      join(tmpDir, ".mcp.json"),
      JSON.stringify({ mcpServers: { unrelated: { command: "node", args: ["./other.js"] } } }, null, 2),
    );
    setupClaudeIntegration(tmpDir);
    const config = readMcpJson();
    expect(config.mcpServers.unrelated).toEqual({ command: "node", args: ["./other.js"] });
    for (const name of serverNames) {
      expect(config.mcpServers[name]).toBeDefined();
    }
  });

  it("preserves other top-level keys in an existing .mcp.json", () => {
    writeFileSync(
      join(tmpDir, ".mcp.json"),
      JSON.stringify({ mcpServers: {}, someOtherKey: "keep me" }, null, 2),
    );
    setupClaudeIntegration(tmpDir);
    const config = readMcpJson();
    expect(config.someOtherKey).toBe("keep me");
  });

  it("recovers instead of throwing when .mcp.json is malformed", () => {
    writeFileSync(join(tmpDir, ".mcp.json"), "{not json");
    expect(() => setupClaudeIntegration(tmpDir)).not.toThrow();
    const config = readMcpJson();
    expect(Object.keys(config.mcpServers).sort()).toEqual(serverNames);
  });
});
