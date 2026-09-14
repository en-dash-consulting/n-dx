/**
 * Codex MCP contract tests — verifies that the generated .codex/config.toml
 * entries produce working stdio MCP servers with the correct tool registrations.
 *
 * These tests complement:
 *   - codex-artifact-validation.test.js — structural validation of generated artifacts
 *   - mcp-transport.test.js — HTTP transport protocol compliance
 *
 * This file focuses on the **stdio transport contract** that Codex actually uses:
 *   1. config.toml commands are cwd-relative (bare command, no absolute paths)
 *   2. Spawning the manifest's dist CLI with the exact config.toml args (cliCommand,
 *      mcpCommand, ".") against a cwd of the project root produces working MCP servers
 *      — the same invocation Codex performs once `<cliName>` resolves on PATH
 *   3. Tool lists from running stdio servers match manifest declarations exactly
 *   4. Both rex and sourcevision servers respond to the full MCP lifecycle
 *
 * Note on spawning: config.toml's `command` is now a bare name (e.g. "n-dx")
 * resolved via PATH at Codex-launch time, not an absolute path to this
 * checkout. Depending on a globally-linked `ndx` binary here would be
 * environment-dependent (see cli-identity.js), so these lifecycle tests spawn
 * `node <dist/cli/index.js> <mcpCommand> .` directly with `cwd: tmpDir` — the
 * exact process `ndx <cliCommand> mcp .` delegates to (see cli.js's
 * tool-delegation `run()`, which spawns without overriding cwd).
 *
 * Reuses the manifest as the source of truth (same as codex-artifact-validation.test.js)
 * rather than reimplementing transport-level protocol coverage (covered by mcp-transport.test.js).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { getMcpServers } from "../../packages/core/assistant-assets.js";
import { setupCodexIntegration } from "../../packages/core/codex-integration.js";
import {
  setupRexDir,
  setupSourcevisionDir,
} from "./e2e-helpers.js";

const ROOT = resolve(import.meta.dirname, "../..");
const servers = getMcpServers();
const serverNames = Object.keys(servers);

/** Resolve a manifest server's compiled dist CLI entrypoint (test-only — no longer embedded in config.toml). */
function distCliFor(name) {
  return join(ROOT, servers[name].package, "dist/cli/index.js");
}

// ── Shared setup: generate config.toml and project fixtures ─────────────

let tmpDir;
let tomlContent;
let parsedServers; // Map<serverName, { command, args: string[] }>

/**
 * Parse server entries from generated config.toml.
 * Returns a map of server name → { command, args }.
 */
function parseTomlServers(content) {
  const result = new Map();
  let currentServer = null;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const sectionMatch = trimmed.match(/^\[mcp_servers\.(\w+)\]$/);
    if (sectionMatch) {
      currentServer = sectionMatch[1];
      result.set(currentServer, {});
      continue;
    }

    if (currentServer) {
      const kvMatch = trimmed.match(/^(\w+)\s*=\s*(.+)$/);
      if (kvMatch) {
        const key = kvMatch[1];
        let value = kvMatch[2];

        if (key === "command") {
          // Strip quotes: "node" → node
          value = value.replace(/^"(.*)"$/, "$1");
        } else if (key === "args") {
          // Parse TOML array: ["a", "b", "c"] → ["a", "b", "c"]
          const elements = value.match(/"([^"]*)"/g);
          value = elements
            ? elements.map((e) => e.slice(1, -1).replace(/\\\\/g, "\\"))
            : [];
        }

        result.get(currentServer)[key] = value;
      }
    }
  }

  return result;
}

/**
 * Spawn a stdio MCP server and perform a JSON-RPC exchange.
 *
 * Sends initialize → notifications/initialized → method, then returns the
 * method response.  The server process is killed after the exchange.
 *
 * @param {string} command  Command to spawn (e.g. "node")
 * @param {string[]} args   Arguments (e.g. ["/path/to/cli.js", "mcp", "."])
 * @param {string} method   JSON-RPC method to call after initialization
 * @param {object} params   Parameters for the method call
 * @param {number} timeoutMs  Max wait time
 * @param {string} [cwd]    Working directory for the spawned process (args may be cwd-relative)
 * @returns {Promise<object>} JSON-RPC response body
 */
function stdioJsonRpc(command, args, method, params = {}, timeoutMs = 10000, cwd) {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
      ...(cwd ? { cwd } : {}),
    });

    let stdout = "";
    let stderr = "";
    const responses = [];
    let settled = false;

    const timeout = setTimeout(() => {
      if (!settled) {
        settled = true;
        proc.kill("SIGTERM");
        reject(
          new Error(
            `Stdio MCP exchange timed out after ${timeoutMs}ms.\nstderr: ${stderr}\nstdout: ${stdout}`,
          ),
        );
      }
    }, timeoutMs);

    const cleanup = () => {
      clearTimeout(timeout);
      if (!proc.killed) proc.kill("SIGTERM");
    };

    proc.stdout.on("data", (chunk) => {
      stdout += chunk.toString();

      // Parse newline-delimited JSON messages
      const lines = stdout.split("\n");
      // Keep the last incomplete line in the buffer
      stdout = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          responses.push(JSON.parse(trimmed));
        } catch {
          // Skip non-JSON lines (e.g. debug output)
        }
      }

      // Check if we have the response for our method call (id: 2)
      const methodResponse = responses.find((r) => r.id === 2);
      if (methodResponse && !settled) {
        settled = true;
        cleanup();
        resolvePromise(methodResponse);
      }
    });

    proc.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    proc.on("error", (err) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(new Error(`Failed to spawn MCP server: ${err.message}`));
      }
    });

    proc.on("exit", (code) => {
      if (!settled) {
        settled = true;
        cleanup();
        reject(
          new Error(
            `MCP server exited with code ${code} before responding.\nstderr: ${stderr}\nstdout: ${stdout}`,
          ),
        );
      }
    });

    // Step 1: Send initialize request
    const initMsg = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        capabilities: {},
        clientInfo: { name: "codex-mcp-contract-test", version: "1.0.0" },
      },
    });
    proc.stdin.write(initMsg + "\n");

    // Step 2: Wait for initialize response, then send initialized + method call
    // We use a polling approach on responses since stdio is async
    const waitForInit = setInterval(() => {
      const initResponse = responses.find((r) => r.id === 1);
      if (initResponse) {
        clearInterval(waitForInit);

        // Send initialized notification (no id — it's a notification)
        const initializedMsg = JSON.stringify({
          jsonrpc: "2.0",
          method: "notifications/initialized",
        });
        proc.stdin.write(initializedMsg + "\n");

        // Send the actual method call
        const methodMsg = JSON.stringify({
          jsonrpc: "2.0",
          id: 2,
          method,
          params,
        });
        proc.stdin.write(methodMsg + "\n");
      }
    }, 50);
  });
}

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "ndx-codex-mcp-contract-"));

  // Generate Codex config
  setupCodexIntegration(tmpDir);

  // Set up project fixtures that MCP servers need
  await setupRexDir(tmpDir);
  await setupSourcevisionDir(tmpDir);

  tomlContent = readFileSync(join(tmpDir, ".codex", "config.toml"), "utf-8");
  parsedServers = parseTomlServers(tomlContent);
});

afterAll(() => {
  if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
});

// ── Command structure: cwd-relative, no absolute paths ────────────────────

describe("command structure", () => {
  it("every server uses the same bare (non-path) command", () => {
    const commands = new Set();
    for (const [name, config] of parsedServers) {
      expect(config.command, `${name} command looks like a path`).not.toMatch(/[/\\]/);
      commands.add(config.command);
    }
    expect(commands.size).toBe(1);
  });

  it("every server has exactly 3 args: [cliCommand, mcpCommand, '.']", () => {
    for (const [name, config] of parsedServers) {
      expect(config.args.length, `${name} args count`).toBe(3);
    }
  });

  it("every server args[0] is the manifest cliCommand", () => {
    for (const [name, config] of parsedServers) {
      expect(config.args[0], `${name} cliCommand`).toBe(servers[name].cliCommand ?? name);
    }
  });

  it("every server args[1] is the manifest mcpCommand", () => {
    for (const [name, config] of parsedServers) {
      expect(config.args[1], `${name} mcpCommand`).toBe(servers[name].mcpCommand);
    }
  });

  it("every server args[2] is the cwd-relative '.'", () => {
    for (const [name, config] of parsedServers) {
      expect(config.args[2], `${name} directory arg`).toBe(".");
    }
  });

  it("config.toml has entries for every manifest server (no missing)", () => {
    for (const name of serverNames) {
      expect(parsedServers.has(name), `missing config.toml entry for ${name}`).toBe(true);
    }
  });

  it("config.toml has no extra servers beyond manifest", () => {
    const tomlNames = [...parsedServers.keys()].sort();
    expect(tomlNames).toEqual([...serverNames].sort());
  });

  it("contains no absolute paths anywhere (tmpDir never appears)", () => {
    expect(tomlContent).not.toContain(tmpDir);
  });

  it("dist CLI entrypoints referenced by the manifest still exist on disk", () => {
    // config.toml no longer embeds these paths, but the servers Codex would
    // reach via `<cliName> <cliCommand> mcp .` still need to resolve.
    for (const name of serverNames) {
      const entrypoint = distCliFor(name);
      expect(existsSync(entrypoint), `${name} dist entrypoint missing: ${entrypoint}`).toBe(true);
    }
  });
});

// ── Stdio MCP server lifecycle ───────────────────────────────────────────

describe("stdio MCP server lifecycle", { timeout: 30000 }, () => {
  it("rex: spawning the manifest's dist CLI with config.toml's args (cwd-relative) starts a working MCP server", async () => {
    const config = parsedServers.get("rex");
    expect(config).toBeDefined();

    // config.command ("n-dx") is resolved via PATH at Codex-launch time — see
    // the file header note. Substitute `node <dist cli>` for the bare
    // command, keep config's own [mcpCommand, "."] args, and spawn with
    // cwd: tmpDir so "." resolves the same way it would under a real "ndx
    // rex mcp ." invocation.
    const response = await stdioJsonRpc(
      process.execPath,
      [distCliFor("rex"), config.args[1], config.args[2]],
      "tools/list",
      {},
      10000,
      tmpDir,
    );

    expect(response.jsonrpc).toBe("2.0");
    expect(response.id).toBe(2);
    expect(response.result).toBeDefined();
    expect(response.result.tools).toBeInstanceOf(Array);
    expect(response.result.tools.length).toBeGreaterThan(0);
  });

  it("sourcevision: spawning the manifest's dist CLI with config.toml's args (cwd-relative) starts a working MCP server", async () => {
    const config = parsedServers.get("sourcevision");
    expect(config).toBeDefined();

    const response = await stdioJsonRpc(
      process.execPath,
      [distCliFor("sourcevision"), config.args[1], config.args[2]],
      "tools/list",
      {},
      10000,
      tmpDir,
    );

    expect(response.jsonrpc).toBe("2.0");
    expect(response.id).toBe(2);
    expect(response.result).toBeDefined();
    expect(response.result.tools).toBeInstanceOf(Array);
    expect(response.result.tools.length).toBeGreaterThan(0);
  });
});

// ── Tool list parity: stdio servers vs. manifest ─────────────────────────

describe("tool list parity with manifest", { timeout: 30000 }, () => {
  async function listTools(name) {
    const config = parsedServers.get(name);
    const response = await stdioJsonRpc(
      process.execPath,
      [distCliFor(name), config.args[1], config.args[2]],
      "tools/list",
      {},
      10000,
      tmpDir,
    );
    return response.result.tools;
  }

  it("rex stdio server registers exactly the tools declared in manifest", async () => {
    const tools = await listTools("rex");
    const registeredTools = tools.map((t) => t.name).sort();
    const manifestTools = [
      ...servers.rex.tools.read,
      ...servers.rex.tools.write,
    ].sort();

    expect(registeredTools).toEqual(manifestTools);
  });

  it("sourcevision stdio server registers exactly the tools declared in manifest", async () => {
    const tools = await listTools("sourcevision");
    const registeredTools = tools.map((t) => t.name).sort();
    const manifestTools = [
      ...servers.sourcevision.tools.read,
      ...servers.sourcevision.tools.write,
    ].sort();

    expect(registeredTools).toEqual(manifestTools);
  });

  it("rex stdio server uses bare tool names (no mcp__ prefix)", async () => {
    const tools = await listTools("rex");
    for (const tool of tools) {
      expect(
        tool.name.startsWith("mcp__"),
        `Rex tool "${tool.name}" has unexpected mcp__ prefix`,
      ).toBe(false);
    }
  });

  it("sourcevision stdio server uses bare tool names (no mcp__ prefix)", async () => {
    const tools = await listTools("sourcevision");
    for (const tool of tools) {
      expect(
        tool.name.startsWith("mcp__"),
        `Sourcevision tool "${tool.name}" has unexpected mcp__ prefix`,
      ).toBe(false);
    }
  });
});

// ── Config.toml stability across regeneration ─────────────────────────────

describe("config.toml stability", () => {
  it("regenerating config.toml in a different dir produces identical content", () => {
    // First generation already happened in beforeAll. Nothing in the
    // cwd-relative shape embeds the target directory (for a fresh dir with
    // no package.json, getCliName falls back to the same DEFAULT_CLI_NAME),
    // so a second, unrelated tmp dir gets byte-identical output.
    const secondDir = mkdtempSync(join(tmpdir(), "ndx-codex-mcp-regen-"));
    try {
      setupCodexIntegration(secondDir);
      const secondToml = readFileSync(join(secondDir, ".codex", "config.toml"), "utf-8");
      expect(secondToml).toBe(tomlContent);
    } finally {
      rmSync(secondDir, { recursive: true, force: true });
    }
  });
});
