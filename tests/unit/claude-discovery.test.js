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

describe("discoverClaudeCli — step 2: cli.claudePath from .n-dx.json", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CLAUDE_CLI_PATH;
    execFileSyncCli.mockImplementation(() => {});
  });

  it("returns configured path when file exists and runs", () => {
    const dir = "/tmp/project";
    readFileSync.mockImplementation((p) => {
      if (p === join(dir, ".n-dx.json")) return JSON.stringify({ cli: { claudePath: "/cfg/claude" } });
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    existsSync.mockImplementation((p) => p === join(dir, ".n-dx.json") || p === "/cfg/claude");
    expect(discoverClaudeCli(dir)).toEqual({ found: true, path: "/cfg/claude" });
  });

  it("returns not-found with no fallback when configured path is missing", () => {
    const dir = "/tmp/project";
    readFileSync.mockImplementation((p) => {
      if (p === join(dir, ".n-dx.json")) return JSON.stringify({ cli: { claudePath: "/missing/claude" } });
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    existsSync.mockImplementation((p) => p === join(dir, ".n-dx.json"));
    const r = discoverClaudeCli(dir);
    expect(r.found).toBe(false);
    expect(r.searched[0]).toContain("cli.claudePath");
  });

  it("falls through to PATH when .n-dx.json has no cli.claudePath", () => {
    const dir = "/tmp/project";
    readFileSync.mockImplementation((p) => {
      if (p === join(dir, ".n-dx.json")) return JSON.stringify({ web: { port: 3117 } });
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    existsSync.mockImplementation((p) => p === join(dir, ".n-dx.json"));
    // PATH check succeeds
    execFileSyncCli.mockImplementation(() => {});
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

describe("discoverClaudeCli — persistence to .hench/config.json", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CLAUDE_CLI_PATH;
    readFileSync.mockImplementation(() => { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); });
  });

  it("persists resolved PATH path to .hench/config.json", () => {
    const dir = "/tmp/persist-test";
    const henchConfig = { schema: "hench/v1", provider: "cli" };
    existsSync.mockImplementation((p) => p === join(dir, ".hench", "config.json"));
    readFileSync.mockImplementation((p) => {
      if (p === join(dir, ".hench", "config.json")) return JSON.stringify(henchConfig);
      throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    });
    execFileSyncCli.mockImplementation(() => {}); // PATH check succeeds

    discoverClaudeCli(dir);

    expect(writeFileSync).toHaveBeenCalledWith(
      join(dir, ".hench", "config.json"),
      expect.stringContaining('"claudePath"'),
      "utf-8",
    );
  });

  it("does not write .hench/config.json when env var is used (user-configured)", () => {
    process.env.CLAUDE_CLI_PATH = "/env/claude";
    existsSync.mockImplementation((p) => p === "/env/claude");
    execFileSyncCli.mockImplementation(() => {});
    discoverClaudeCli("/tmp/some-dir");
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});
