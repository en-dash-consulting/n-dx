/**
 * Unit tests for discoverClaudeCli().
 *
 * Stubs existsSync, readFileSync, readdirSync, and the win-spawn CLI runner so no real
 * files or processes are accessed. Each describe block exercises one step
 * of the ordered discovery chain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { homedir } from "os";
import { join } from "path";

// Hoist mocks before importing the module under test.
// Asset-loading paths fall through to the real fs so the module-load chain
// (claude-integration → packages/core/assistant-assets.js → assistant-assets/*) works.
vi.mock("fs", async (importOriginal) => {
  const original = await importOriginal();
  const isAssetPath = (p) => typeof p === "string" && p.includes("assistant-assets");
  return {
    ...original,
    existsSync: vi.fn((p) => isAssetPath(p) ? original.existsSync(p) : false),
    readdirSync: vi.fn((p, opts) => isAssetPath(p) ? original.readdirSync(p, opts) : []),
    readFileSync: vi.fn((p, opts) => {
      if (isAssetPath(p)) return original.readFileSync(p, opts);
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    }),
    writeFileSync: vi.fn(),
  };
});
// claude-integration.js invokes the claude CLI through win-spawn.js
// (execFileSyncCli), not child_process.execSync — mocking child_process here
// would no longer intercept anything. Mock the boundary it actually imports.
vi.mock("../../packages/core/win-spawn.js", async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, execFileSyncCli: vi.fn() };
});

import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { execFileSyncCli } from "../../packages/core/win-spawn.js";
import { discoverClaudeCli } from "../../packages/core/claude-integration.js";

const HOME = homedir();

function setupPathOk() {
  execFileSyncCli.mockImplementation(() => {}); // all exec succeeds by default
}

function setupPathFail() {
  // PATH lookup fails, subsequent exec calls succeed
  let callCount = 0;
  execFileSyncCli.mockImplementation((binary) => {
    if (binary === "claude" && callCount === 0) {
      callCount++;
      throw new Error("not found");
    }
  });
}

describe("discoverClaudeCli — step 1: CLAUDE_CLI_PATH env var", () => {
  beforeEach(() => { vi.clearAllMocks(); delete process.env.CLAUDE_CLI_PATH; });
  afterEach(() => { delete process.env.CLAUDE_CLI_PATH; });

  it("returns the env-var path when file exists and runs", () => {
    process.env.CLAUDE_CLI_PATH = "/custom/claude";
    existsSync.mockImplementation((p) => p === "/custom/claude");
    execFileSyncCli.mockImplementation(() => {});
    expect(discoverClaudeCli()).toEqual({ found: true, path: "/custom/claude" });
  });

  it("returns not-found with no fallback when env var points to missing file", () => {
    process.env.CLAUDE_CLI_PATH = "/nonexistent/claude";
    existsSync.mockReturnValue(false);
    const r = discoverClaudeCli();
    expect(r.found).toBe(false);
    expect(r.searched).toHaveLength(1);
    expect(r.searched[0]).toContain("CLAUDE_CLI_PATH");
  });

  it("returns not-found when env-var file exists but is not executable", () => {
    process.env.CLAUDE_CLI_PATH = "/custom/claude";
    existsSync.mockImplementation((p) => p === "/custom/claude");
    execFileSyncCli.mockImplementation(() => { throw new Error("permission denied"); });
    expect(discoverClaudeCli()).toEqual({ found: false, searched: ["/custom/claude (CLAUDE_CLI_PATH)"] });
  });
});

describe("discoverClaudeCli — step 2: cli.claudePath from .n-dx.local.json", () => {
  const dir = "/tmp/project";
  const LOCAL = join(dir, ".n-dx.local.json");
  const SHARED = join(dir, ".n-dx.json");

  function files(map) {
    readFileSync.mockImplementation((p) => {
      if (p in map) return JSON.stringify(map[p]);
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CLAUDE_CLI_PATH;
    execFileSyncCli.mockImplementation(() => {});
  });

  it("returns configured path when file exists and runs", () => {
    files({ [LOCAL]: { cli: { claudePath: "/cfg/claude" } } });
    existsSync.mockImplementation((p) => p === LOCAL || p === "/cfg/claude");
    expect(discoverClaudeCli(dir)).toEqual({ found: true, path: "/cfg/claude" });
  });

  it("returns not-found with no fallback when configured path is missing", () => {
    files({ [LOCAL]: { cli: { claudePath: "/missing/claude" } } });
    existsSync.mockImplementation((p) => p === LOCAL);
    const r = discoverClaudeCli(dir);
    expect(r.found).toBe(false);
    expect(r.searched[0]).toContain("cli.claudePath");
  });

  it("never runs a cli.claudePath from the shared .n-dx.json, which the repository chooses", () => {
    files({ [SHARED]: { cli: { claudePath: "/repo/tools/claude" } } });
    existsSync.mockImplementation((p) => p === SHARED || p === "/repo/tools/claude");
    expect(discoverClaudeCli(dir)).toEqual({ found: true, path: "claude" });
    expect(execFileSyncCli.mock.calls.map(([bin]) => bin)).not.toContain("/repo/tools/claude");
  });

  it("names an ignored shared cli.claudePath, not its value, when nothing is found", () => {
    files({ [SHARED]: { cli: { claudePath: "/repo/tools/claude" } } });
    existsSync.mockImplementation((p) => p === SHARED);
    execFileSyncCli.mockImplementation(() => { throw new Error("not found"); });
    const r = discoverClaudeCli(dir);
    expect(r.found).toBe(false);
    const last = r.searched.at(-1);
    expect(last).toContain("cli.claudePath in .n-dx.json");
    expect(last).toContain(".n-dx.local.json");
    expect(r.searched.join("\n")).not.toContain("/repo/tools/claude");
  });

  it("falls through to PATH when no cli.claudePath is set", () => {
    files({ [SHARED]: { web: { port: 3117 } } });
    existsSync.mockImplementation((p) => p === SHARED);
    expect(discoverClaudeCli(dir)).toEqual({ found: true, path: "claude" });
  });
});

describe("discoverClaudeCli — step 3: system PATH", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CLAUDE_CLI_PATH;
    readFileSync.mockImplementation(() => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); });
    existsSync.mockReturnValue(false);
  });

  it("returns 'claude' when found on PATH", () => {
    execFileSyncCli.mockImplementation(() => {});
    expect(discoverClaudeCli()).toEqual({ found: true, path: "claude" });
    expect(execFileSyncCli).toHaveBeenCalledWith("claude", ["--version"], expect.objectContaining({ timeout: 5000 }));
  });

  it("falls through to well-known locations when PATH check fails", () => {
    let first = true;
    execFileSyncCli.mockImplementation((binary) => {
      if (binary === "claude" && first) { first = false; throw new Error("not found"); }
    });
    const claudeLocal = process.platform === "win32"
      ? join(process.env.APPDATA ?? join(HOME, "AppData", "Roaming"), "npm", "claude.cmd")
      : join(HOME, ".claude", "local", "claude");
    existsSync.mockImplementation((p) => p === claudeLocal);
    const r = discoverClaudeCli();
    expect(r.found).toBe(true);
    expect(r.path).toBe(claudeLocal);
  });
});

describe("discoverClaudeCli — step 4: well-known install locations", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CLAUDE_CLI_PATH;
    readFileSync.mockImplementation(() => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); });
    existsSync.mockReturnValue(false);
    // PATH always fails
    execFileSyncCli.mockImplementation((binary) => {
      if (binary === "claude") throw new Error("not found");
    });
  });

  it("discovers ~/.claude/local/claude on non-Windows", () => {
    if (process.platform === "win32") return;
    const target = join(HOME, ".claude", "local", "claude");
    existsSync.mockImplementation((p) => p === target);
    execFileSyncCli.mockImplementation((binary) => {
      if (binary === "claude") throw new Error("not found");
      // all absolute-path probes succeed
    });
    const r = discoverClaudeCli();
    expect(r.found).toBe(true);
    expect(r.path).toBe(target);
  });

  it("discovers claude via nvm node version bin", () => {
    if (process.platform === "win32") return;
    const nvmDir = join(HOME, ".nvm", "versions", "node");
    const target = join(nvmDir, "v20.0.0", "bin", "claude");
    existsSync.mockImplementation((p) => p === nvmDir || p === target);
    readdirSync.mockImplementation((p) => (p === nvmDir ? ["v20.0.0", "v18.0.0"] : []));
    execFileSyncCli.mockImplementation((binary) => {
      if (binary === "claude") throw new Error("not found");
      // all absolute-path probes succeed
    });
    const r = discoverClaudeCli();
    expect(r.found).toBe(true);
    expect(r.path).toBe(target);
  });

  it("returns not-found with full searched list when nothing works", () => {
    execFileSyncCli.mockImplementation(() => { throw new Error("not found"); });
    existsSync.mockReturnValue(false);
    const r = discoverClaudeCli();
    expect(r.found).toBe(false);
    expect(r.searched[0]).toBe("claude (PATH)");
    expect(r.searched.length).toBeGreaterThan(1);
  });

  it("checks %APPDATA%\\npm\\claude.cmd on Windows", () => {
    if (process.platform !== "win32") return;
    const appData = process.env.APPDATA ?? join(HOME, "AppData", "Roaming");
    const target = join(appData, "npm", "claude.cmd");
    existsSync.mockImplementation((p) => p === target);
    execFileSyncCli.mockImplementation((binary) => {
      if (binary === "claude") throw new Error("not found");
    });
    const r = discoverClaudeCli();
    expect(r.found).toBe(true);
    expect(r.path).toBe(target);
  });
});

describe("discoverClaudeCli — persistence to .n-dx.local.json", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CLAUDE_CLI_PATH;
    readFileSync.mockImplementation(() => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); });
  });

  it("persists a well-known install path as hench.claudePath in the machine-local config, never .hench/config.json", () => {
    if (process.platform === "win32") return;
    const dir = "/tmp/persist-test";
    const target = join(HOME, ".claude", "local", "claude");
    const localFile = join(dir, ".n-dx.local.json");
    existsSync.mockImplementation((p) => p === join(dir, ".hench", "config.json") || p === target || p === localFile);
    readFileSync.mockImplementation((p) => {
      if (p === localFile) return JSON.stringify({ llm: { vendor: "claude" } });
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    execFileSyncCli.mockImplementation((binary) => {
      if (binary === "claude") throw new Error("not found");
    });

    expect(discoverClaudeCli(dir).path).toBe(target);

    expect(writeFileSync).toHaveBeenCalledTimes(1);
    const [path, body] = writeFileSync.mock.calls[0];
    expect(path).toBe(localFile);
    expect(JSON.parse(body)).toEqual({ llm: { vendor: "claude" }, hench: { claudePath: target } });
  });

  it("writes nothing for the bare claude found on PATH, hench's default", () => {
    const dir = "/tmp/persist-test";
    existsSync.mockImplementation((p) => p === join(dir, ".hench", "config.json"));
    execFileSyncCli.mockImplementation(() => {}); // PATH check succeeds

    expect(discoverClaudeCli(dir).path).toBe("claude");
    expect(writeFileSync).not.toHaveBeenCalled();
  });

  it("does not write .hench/config.json when env var is used (user-configured)", () => {
    process.env.CLAUDE_CLI_PATH = "/env/claude";
    existsSync.mockImplementation((p) => p === "/env/claude");
    execFileSyncCli.mockImplementation(() => {});
    discoverClaudeCli("/tmp/some-dir");
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});
