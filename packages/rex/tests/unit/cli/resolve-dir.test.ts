/**
 * Unit tests for `resolveDir()` — the cwd-relative directory contract that
 * `rex <command> .` (and every other positional-dir command) relies on.
 *
 * This is the behaviour `ndx rex mcp .` depends on: the tracked `.mcp.json`
 * and `.codex/config.toml` both register the rex/sourcevision MCP servers
 * with a literal `"."` positional (see packages/core/claude-integration.js
 * writeMcpJson and packages/core/codex-integration.js
 * renderCodexConfigToml), trusting that the spawned CLI resolves it against
 * whatever directory the client process launched it from — not a path
 * baked in at registration time. Pinning `resolveDir` directly (rather than
 * only exercising it indirectly through the built CLI) keeps this contract
 * from regressing silently if `dispatchCommand` is refactored.
 *
 * @see packages/rex/src/cli/resolve-dir.ts
 * @see packages/rex/src/cli/index.ts — case "mcp": resolveDir(positional)
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resolveDir } from "../../../src/cli/resolve-dir.js";

describe("resolveDir", () => {
  const originalCwd = process.cwd();
  let tmpDir: string | undefined;

  afterEach(() => {
    process.chdir(originalCwd);
    if (tmpDir) {
      rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it("resolves '.' to the current working directory — the `rex mcp .` contract", () => {
    tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "rex-resolve-dir-")));
    process.chdir(tmpDir);

    expect(resolveDir(["."])).toBe(tmpDir);
  });

  it("tracks cwd changes — the same positional resolves differently after chdir", () => {
    tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "rex-resolve-dir-")));
    const first = resolveDir(["."]);
    process.chdir(tmpDir);
    const second = resolveDir(["."]);

    expect(second).toBe(tmpDir);
    expect(second).not.toBe(first);
  });

  it("defaults to cwd when no positional is given", () => {
    expect(resolveDir([])).toBe(process.cwd());
  });

  it("resolves a relative positional against cwd, not against the package root", () => {
    tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "rex-resolve-dir-")));
    process.chdir(tmpDir);

    expect(resolveDir(["sub/dir"])).toBe(resolve(tmpDir, "sub/dir"));
  });

  it("passes an absolute positional through untouched", () => {
    tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "rex-resolve-dir-")));

    expect(resolveDir([tmpDir])).toBe(tmpDir);
  });

  it("falls back to cwd when the last positional looks like a flag", () => {
    tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "rex-resolve-dir-")));
    process.chdir(tmpDir);

    expect(resolveDir(["--verbose"])).toBe(tmpDir);
  });

  it("uses only the last positional (mirrors dispatchCommand's `[...extra, dir]` calls)", () => {
    tmpDir = realpathSync(mkdtempSync(join(tmpdir(), "rex-resolve-dir-")));

    expect(resolveDir(["ignored-earlier-arg", tmpDir])).toBe(tmpDir);
  });
});
