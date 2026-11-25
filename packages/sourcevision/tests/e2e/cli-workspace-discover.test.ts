/**
 * `sv workspace --discover` through the built CLI, over real git repositories:
 * the child `sv analyze --fast` runs, a failing repository is reported, a
 * nested repository and a symlink out of the folder are not analysed, and a
 * second run keeps the analyses it finds current. Walk, bound and skip
 * classification are unit-tested in tests/unit/cli/workspace-discover.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, realpathSync, symlinkSync, chmodSync } from "node:fs";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const CLI_PATH = join(import.meta.dirname, "../../dist/cli/index.js");

// Hang guardrail, scaled like the other CLI e2e suites (TESTING.md Family 3).
const MULTIPLIER = Number(process.env["NDX_TEST_TIME_MULTIPLIER"] ?? 20);
const SPAWN_TIMEOUT = 30_000 * MULTIPLIER;
const TEST_TIMEOUT = SPAWN_TIMEOUT + 5_000;

const GIT_ENV = {
  GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
};

function git(cwd: string, ...args: string[]): void {
  const r = spawnSync("git", args, { cwd, env: { ...process.env, ...GIT_ENV }, encoding: "utf-8", windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
}

function repo(dir: string, file: string): void {
  mkdirSync(join(dir, "src"), { recursive: true });
  writeFileSync(join(dir, "src", file), `export const v = "${file}";\n`);
  git(dir, "init", "-q");
  git(dir, "add", ".");
  git(dir, "commit", "-qm", "init");
}

interface DiscoverJson {
  found: { path: string; analysis: string }[];
  skipped: { path: string; reason: string; detail?: string }[];
  aggregate: { fileCount: number } | null;
}

describe("sv workspace --discover (built CLI)", () => {
  let base: string;
  let outside: string;
  let fakeBin: string;
  const marker = () => join(fakeBin, "model-called");

  beforeAll(() => {
    base = realpathSync(mkdtempSync(join(tmpdir(), "sv-discover-e2e-")));
    outside = realpathSync(mkdtempSync(join(tmpdir(), "sv-discover-e2e-out-")));
    fakeBin = realpathSync(mkdtempSync(join(tmpdir(), "sv-discover-e2e-bin-")));

    repo(join(base, "alpha"), "a.ts");
    repo(join(base, "group", "beta"), "b.ts");
    repo(join(base, "group", "beta", "nested"), "n.ts");
    repo(join(base, "broken"), "c.ts");
    // A file where the analysis folder goes: the analysis cannot write and fails.
    writeFileSync(join(base, "broken", ".sourcevision"), "not a folder\n");
    repo(join(outside, "ext"), "e.ts");
    symlinkSync(join(outside, "ext"), join(base, "ext-link"), process.platform === "win32" ? "junction" : "dir");

    // Any vendor CLI the analysis reached for would leave the marker behind.
    for (const name of ["claude", "codex"]) {
      const bin = join(fakeBin, name);
      writeFileSync(bin, `#!/bin/sh\ntouch "${marker()}"\nexit 1\n`);
      chmodSync(bin, 0o755);
    }
  }, TEST_TIMEOUT);

  afterAll(() => {
    for (const d of [base, outside, fakeBin]) rmSync(d, { recursive: true, force: true });
  });

  function discover(...extra: string[]) {
    const r = spawnSync(process.execPath, [CLI_PATH, "workspace", "--discover", base, "--jobs=2", "--json", ...extra], {
      encoding: "utf-8",
      timeout: SPAWN_TIMEOUT,
      windowsHide: true,
      env: {
        ...process.env,
        PATH: `${fakeBin}${delimiter}${process.env.PATH ?? ""}`,
        // A model or network call would need these; neither may be used.
        ANTHROPIC_API_KEY: "sk-test-unused",
        ANTHROPIC_BASE_URL: "http://127.0.0.1:9",
      },
    });
    return { status: r.status, stdout: r.stdout, output: `${r.stdout}${r.stderr}` };
  }

  const manifestOf = (dir: string) => readFileSync(join(base, dir, ".sourcevision", "manifest.json"), "utf-8");

  it("analyses and aggregates the repositories that work and reports the rest with a reason", () => {
    const r = discover();
    expect(r.status, r.output).toBe(0);
    const out = JSON.parse(r.stdout) as DiscoverJson;

    expect(out.found).toEqual([
      { path: "alpha", analysis: "analysed" },
      { path: "group/beta", analysis: "analysed" },
    ]);
    expect(out.skipped.map(({ path, reason }) => ({ path, reason }))).toEqual([
      { path: "broken", reason: "analysis-failed" },
      { path: "ext-link", reason: "outside-dir" },
    ]);
    expect(out.aggregate?.fileCount).toBeGreaterThan(0);

    // The nested repository is part of beta, never analysed on its own.
    expect(existsSync(join(base, "group", "beta", "nested", ".sourcevision"))).toBe(false);
    // The symlink was not followed.
    expect(existsSync(join(outside, "ext", ".sourcevision"))).toBe(false);

    const config = JSON.parse(readFileSync(join(base, ".n-dx.json"), "utf-8"));
    expect(config.sourcevision.workspace.members.map((m: { path: string }) => m.path)).toEqual(["alpha", "group/beta"]);
    expect(existsSync(join(base, ".sourcevision", "zones.json"))).toBe(true);
    expect(existsSync(marker())).toBe(false);
  }, TEST_TIMEOUT);

  it("keeps an analysis of the current HEAD instead of re-running it", () => {
    const before = manifestOf("alpha");
    const r = discover();
    expect(r.status, r.output).toBe(0);
    const out = JSON.parse(r.stdout) as DiscoverJson;
    expect(out.found).toEqual([
      { path: "alpha", analysis: "current" },
      { path: "group/beta", analysis: "current" },
    ]);
    expect(manifestOf("alpha")).toBe(before);
    expect(existsSync(marker())).toBe(false);
  }, TEST_TIMEOUT);
});
