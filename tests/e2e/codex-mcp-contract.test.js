/**
 * Codex MCP contract tests — verifies that the generated .codex/config.toml
 * entries produce working stdio MCP servers with the correct tool registrations.
 *
 * These tests complement:
 *   - codex-artifact-validation.test.js — structural validation of generated artifacts
 *   - mcp-transport.test.js — HTTP transport protocol compliance
 *
 * This file focuses on the **stdio transport contract** that Codex actually uses:
 *   1. Entrypoint paths from config.toml resolve to existing files on disk
 *   2. All paths are project-local (within monorepo, not global npm)
 *   3. Spawning servers with the exact config.toml commands produces working MCP servers
 *   4. Tool lists from running stdio servers match manifest declarations exactly
 *   5. Both rex and sourcevision servers respond to the full MCP lifecycle
 *
 * Reuses the manifest as the source of truth (same as codex-artifact-validation.test.js)
 * rather than reimplementing transport-level protocol coverage (covered by mcp-transport.test.js).
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, readFileSync } from "node:fs";
import { join, resolve, isAbsolute, relative } from "node:path";
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
 * @param {string[]} args   Arguments (e.g. ["/path/to/cli.js", "mcp", "/project"])
 * @param {string} method   JSON-RPC method to call after initialization
 * @param {object} params   Parameters for the method call
 * @param {number} timeoutMs  Max wait time
 * @returns {Promise<object>} JSON-RPC response body
 */
function stdioJsonRpc(command, args, method, params = {}, timeoutMs = 10000) {
  return new Promise((resolvePromise, reject) => {
    const proc = spawn(command, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
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

// ── Entrypoint existence ─────────────────────────────────────────────────

describe("entrypoint existence", () => {
  it("config.toml references entrypoints that exist on disk", () => {
    for (const [name, config] of parsedServers) {
      const entrypoint = config.args[0];
      expect(existsSync(entrypoint), `${name} entrypoint does not exist: ${entrypoint}`).toBe(
        true,
      );
    }
  });

  it("manifest entrypoints match config.toml entrypoints (same file)", () => {
    for (const [name, descriptor] of Object.entries(servers)) {
      const config = parsedServers.get(name);
      expect(config, `${name} missing from parsed config.toml`).toBeDefined();

      const entrypoint = config.args[0].replace(/\\/g, "/");
      // Both should end with the same relative path
      expect(entrypoint).toContain(descriptor.entrypoint);
    }
  });
});

// ── Path locality: project-local, not global npm ─────────────────────────

describe("path locality", () => {
  it("all entrypoint paths are absolute", () => {
    for (const [name, config] of parsedServers) {
      const entrypoint = config.args[0];
      expect(isAbsolute(entrypoint), `${name} entrypoint is not absolute: ${entrypoint}`).toBe(
        true,
      );
    }
  });

  it("all entrypoint paths are within the monorepo root", () => {
    for (const [name, config] of parsedServers) {
      const entrypoint = config.args[0];
      const rel = relative(ROOT, entrypoint);
      expect(
        !rel.startsWith(".."),
        `${name} entrypoint escapes monorepo: ${entrypoint} (relative: ${rel})`,
      ).toBe(true);
    }
  });

  it("no entrypoint references node_modules (prefers monorepo source)", () => {
    for (const [name, config] of parsedServers) {
      const entrypoint = config.args[0];
      expect(
        !entrypoint.includes("node_modules"),
        `${name} entrypoint uses node_modules instead of monorepo: ${entrypoint}`,
      ).toBe(true);
    }
  });

  it("project directory argument matches the temp dir", () => {
    for (const [name, config] of parsedServers) {
      const projectDir = config.args[2];
      expect(projectDir, `${name} project dir mismatch`).toBe(tmpDir);
    }
  });
});

// ── Command structure ────────────────────────────────────────────────────

describe("command structure", () => {
  it("every server uses 'node' as the command", () => {
    for (const [name, config] of parsedServers) {
      expect(config.command, `${name} command`).toBe("node");
    }
  });

  it("every server has exactly 3 args: [entrypoint, mcpCommand, projectDir]", () => {
    for (const [name, config] of parsedServers) {
      expect(config.args.length, `${name} args count`).toBe(3);
    }
  });

  it("every server args[1] is the manifest mcpCommand", () => {
    for (const [name, config] of parsedServers) {
      expect(config.args[1], `${name} mcpCommand`).toBe(servers[name].mcpCommand);
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
});

// ── Stdio MCP server lifecycle ───────────────────────────────────────────

describe("stdio MCP server lifecycle", { timeout: 30000 }, () => {
  it("rex: spawning with config.toml command/args starts a working MCP server", async () => {
    const config = parsedServers.get("rex");
    expect(config).toBeDefined();

    const response = await stdioJsonRpc(config.command, config.args, "tools/list");

    expect(response.jsonrpc).toBe("2.0");
    expect(response.id).toBe(2);
    expect(response.result).toBeDefined();
    expect(response.result.tools).toBeInstanceOf(Array);
    expect(response.result.tools.length).toBeGreaterThan(0);
  });

  it("sourcevision: spawning with config.toml command/args starts a working MCP server", async () => {
    const config = parsedServers.get("sourcevision");
    expect(config).toBeDefined();

    const response = await stdioJsonRpc(config.command, config.args, "tools/list");

    expect(response.jsonrpc).toBe("2.0");
    expect(response.id).toBe(2);
    expect(response.result).toBeDefined();
    expect(response.result.tools).toBeInstanceOf(Array);
    expect(response.result.tools.length).toBeGreaterThan(0);
  });
});

// ── Tool list parity: stdio servers vs. manifest ─────────────────────────

describe("tool list parity with manifest", { timeout: 30000 }, () => {
  it("rex stdio server registers exactly the tools declared in manifest", async () => {
    const config = parsedServers.get("rex");
    const response = await stdioJsonRpc(config.command, config.args, "tools/list");

    const registeredTools = response.result.tools.map((t) => t.name).sort();
    const manifestTools = [
      ...servers.rex.tools.read,
      ...servers.rex.tools.write,
    ].sort();

    expect(registeredTools).toEqual(manifestTools);
  });

  it("sourcevision stdio server registers exactly the tools declared in manifest", async () => {
    const config = parsedServers.get("sourcevision");
    const response = await stdioJsonRpc(config.command, config.args, "tools/list");

    const registeredTools = response.result.tools.map((t) => t.name).sort();
    const manifestTools = [
      ...servers.sourcevision.tools.read,
      ...servers.sourcevision.tools.write,
    ].sort();

    expect(registeredTools).toEqual(manifestTools);
  });

  it("rex stdio server uses bare tool names (no mcp__ prefix)", async () => {
    const config = parsedServers.get("rex");
    const response = await stdioJsonRpc(config.command, config.args, "tools/list");

    for (const tool of response.result.tools) {
      expect(
        tool.name.startsWith("mcp__"),
        `Rex tool "${tool.name}" has unexpected mcp__ prefix`,
      ).toBe(false);
    }
  });

  it("sourcevision stdio server uses bare tool names (no mcp__ prefix)", async () => {
    const config = parsedServers.get("sourcevision");
    const response = await stdioJsonRpc(config.command, config.args, "tools/list");

    for (const tool of response.result.tools) {
      expect(
        tool.name.startsWith("mcp__"),
        `Sourcevision tool "${tool.name}" has unexpected mcp__ prefix`,
      ).toBe(false);
    }
  });
});

// ── Config.toml path stability across regeneration ───────────────────────

describe("config.toml path stability", () => {
  it("regenerating config.toml in same dir produces identical entrypoint paths", () => {
    // First generation already happened in beforeAll.
    // Regenerate and compare entrypoints.
    const secondDir = mkdtempSync(join(tmpdir(), "ndx-codex-mcp-regen-"));
    try {
      setupCodexIntegration(secondDir);
      const secondToml = readFileSync(join(secondDir, ".codex", "config.toml"), "utf-8");
      const secondParsed = parseTomlServers(secondToml);

      for (const [name, config] of parsedServers) {
        const secondConfig = secondParsed.get(name);
        expect(secondConfig, `${name} missing after regeneration`).toBeDefined();

        // Entrypoints should be identical (same monorepo paths)
        expect(secondConfig.args[0], `${name} entrypoint changed`).toBe(config.args[0]);

        // mcpCommand should be identical
        expect(secondConfig.args[1], `${name} mcpCommand changed`).toBe(config.args[1]);

        // Project dirs differ (different tmp dirs) — that's expected
      }
    } finally {
      rmSync(secondDir, { recursive: true, force: true });
    }
  });

  it("entrypoint paths use forward slashes or platform-native separators consistently", () => {
    for (const [name, config] of parsedServers) {
      const entrypoint = config.args[0];
      // On Unix, should use forward slashes only.
      // On Windows, should use consistent separators (either all \ or all /).
      if (process.platform !== "win32") {
        expect(
          !entrypoint.includes("\\"),
          `${name} entrypoint has backslashes on Unix: ${entrypoint}`,
        ).toBe(true);
      }
    }
  });
});
