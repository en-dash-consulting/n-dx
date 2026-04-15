/**
 * Unit tests for discoverClaudeCli().
 *
 * Stubs existsSync, readFileSync, readdirSync, and execSync so no real
 * files or processes are accessed. Each describe block exercises one step
 * of the ordered discovery chain.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { homedir } from "os";
import { join } from "path";

// Hoist mocks before importing the module under test.
// Asset-loading paths (assistant-assets/) fall through to the real fs so that
// the module-load chain (claude-integration → assistant-assets/index.js) works.
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
vi.mock("child_process", async (importOriginal) => {
  const original = await importOriginal();
  return { ...original, execSync: vi.fn() };
});

import { existsSync, readdirSync, readFileSync, writeFileSync } from "fs";
import { execSync } from "child_process";
import { discoverClaudeCli } from "../../packages/core/claude-integration.js";

const HOME = homedir();

function setupPathOk() {
  execSync.mockImplementation(() => {}); // all exec succeeds by default
}

function setupPathFail() {
  // PATH lookup fails, subsequent exec calls succeed
  let callCount = 0;
  execSync.mockImplementation((cmd) => {
    if (cmd === "claude --version" && callCount === 0) {
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
    execSync.mockImplementation(() => {});
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
    execSync.mockImplementation(() => { throw new Error("permission denied"); });
    expect(discoverClaudeCli()).toEqual({ found: false, searched: ["/custom/claude (CLAUDE_CLI_PATH)"] });
  });
});

describe("discoverClaudeCli — step 2: cli.claudePath from .n-dx.json", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.CLAUDE_CLI_PATH;
    execSync.mockImplementation(() => {});
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
    // execSync for PATH check succeeds
    execSync.mockImplementation(() => {});
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
    execSync.mockImplementation(() => {});
    expect(discoverClaudeCli()).toEqual({ found: true, path: "claude" });
    expect(execSync).toHaveBeenCalledWith("claude --version", expect.objectContaining({ timeout: 5000 }));
  });

  it("falls through to well-known locations when PATH check fails", () => {
    let first = true;
    execSync.mockImplementation((cmd) => {
      if (cmd === "claude --version" && first) { first = false; throw new Error("not found"); }
    });
    const claudeLocal = join(HOME, ".claude", "local", "claude");
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
    execSync.mockImplementation((cmd) => {
      if (cmd === "claude --version") throw new Error("not found");
    });
  });

  it("discovers ~/.claude/local/claude on non-Windows", () => {
    if (process.platform === "win32") return;
    const target = join(HOME, ".claude", "local", "claude");
    existsSync.mockImplementation((p) => p === target);
    execSync.mockImplementation((cmd) => {
      if (cmd === "claude --version") throw new Error("not found");
      // all quoted-path exec calls succeed
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
    execSync.mockImplementation((cmd) => {
      if (cmd === "claude --version") throw new Error("not found");
      // all quoted-path exec calls succeed
    });
    const r = discoverClaudeCli();
    expect(r.found).toBe(true);
    expect(r.path).toBe(target);
  });

  it("returns not-found with full searched list when nothing works", () => {
    execSync.mockImplementation(() => { throw new Error("not found"); });
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
    execSync.mockImplementation((cmd) => {
      if (cmd === "claude --version") throw new Error("not found");
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
    execSync.mockImplementation(() => {}); // PATH check succeeds

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
    execSync.mockImplementation(() => {});
    discoverClaudeCli("/tmp/some-dir");
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});
