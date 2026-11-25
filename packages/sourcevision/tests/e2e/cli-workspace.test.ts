/**
 * `sv workspace` through the built CLI: the root is the argument left after
 * --add/--remove values, never a flag's space-separated value. The unit tests
 * cover the parser; only this spawn fails when the dispatch in
 * src/cli/index.ts goes back to passing the first non-flag argument as root.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const CLI_PATH = join(import.meta.dirname, "../../dist/cli/index.js");

// Hang guardrail, scaled like the other CLI e2e suites (TESTING.md Family 3).
const MULTIPLIER = Number(process.env["NDX_TEST_TIME_MULTIPLIER"] ?? 20);
const SPAWN_TIMEOUT = 10_000 * MULTIPLIER;
const TEST_TIMEOUT = SPAWN_TIMEOUT + 5_000;

describe("sv workspace root argument (built CLI)", () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await mkdtemp(join(tmpdir(), "sv-workspace-e2e-"));
    for (const dir of ["a", "b", "ws"]) await mkdir(join(cwd, dir));
  });

  afterEach(async () => {
    await rm(cwd, { recursive: true, force: true });
  });

  function run(args: string[]) {
    const r = spawnSync(process.execPath, [CLI_PATH, "workspace", ...args], {
      cwd,
      encoding: "utf-8",
      timeout: SPAWN_TIMEOUT,
    });
    return { status: r.status, output: `${r.stdout}${r.stderr}` };
  }

  async function members(dir: string): Promise<string[]> {
    const config = JSON.parse(await readFile(join(cwd, dir, ".n-dx.json"), "utf-8"));
    return config.sourcevision.workspace.members.map((m: { path: string }) => m.path);
  }

  const written = (dir: string) => existsSync(join(cwd, dir, ".n-dx.json"));

  it("--add a --add b ws writes members into ws, not a", async () => {
    const r = run(["--add", "a", "--add", "b", "ws"]);
    expect(r.status, r.output).toBe(0);
    expect(await members("ws")).toEqual(["a", "b"]);
    expect(written("a")).toBe(false);
  }, TEST_TIMEOUT);

  it("--add=a ws behaves the same", async () => {
    const r = run(["--add=a", "ws"]);
    expect(r.status, r.output).toBe(0);
    expect(await members("ws")).toEqual(["a"]);
    expect(written("a")).toBe(false);
  }, TEST_TIMEOUT);

  it("--root=<dir> sets the root", async () => {
    const r = run(["--add", "a", "--root=ws"]);
    expect(r.status, r.output).toBe(0);
    expect(await members("ws")).toEqual(["a"]);
  }, TEST_TIMEOUT);

  it("two leftover positionals exit non-zero naming both and write nothing", () => {
    const r = run(["--add=a", "b", "ws"]);
    expect(r.status).not.toBe(0);
    expect(r.output).toContain('"b"');
    expect(r.output).toContain('"ws"');
    for (const dir of ["a", "b", "ws", "."]) expect(written(dir)).toBe(false);
  }, TEST_TIMEOUT);

  it("--root disagreeing with the positional exits non-zero naming both and writes nothing", () => {
    const r = run(["--add=a", "--root=b", "ws"]);
    expect(r.status).not.toBe(0);
    expect(r.output).toContain('"b"');
    expect(r.output).toContain('"ws"');
    for (const dir of ["a", "b", "ws", "."]) expect(written(dir)).toBe(false);
  }, TEST_TIMEOUT);

  it("--help documents --root and the argument order", () => {
    const r = run(["--help"]);
    expect(r.status).toBe(0);
    expect(r.output).toContain("--root=<dir>");
    expect(r.output).toContain("[--root=<dir> | <root>]");
  }, TEST_TIMEOUT);
});
