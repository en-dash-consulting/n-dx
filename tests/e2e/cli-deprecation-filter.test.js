/**
 * CLI deprecation filter smoke tests.
 *
 * Asserts that no `DeprecationWarning` lines appear in standard CLI output.
 * This is a belt-and-suspenders guard: the root causes have been fixed, but
 * future dependency upgrades could silently reintroduce deprecation noise.
 * These tests catch any regression at CI time.
 *
 * Covers all n-dx CLI entry points: ndx, rex, hench, and sourcevision/sv.
 * Each entry point installs suppressKnownDeprecations() from @n-dx/llm-client.
 *
 * @see packages/llm-client/src/suppress-deprecations.ts — filter implementation
 * @see packages/core/cli.js, packages/rex/src/cli/index.ts,
 *      packages/hench/src/cli/index.ts, packages/sourcevision/src/cli/index.ts
 */

import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CLI_PATH } from "./e2e-helpers.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** Resolve a package's CLI entry point from its package.json bin field. */
function resolveBin(pkgDir) {
  const pkgPath = join(ROOT, pkgDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  if (typeof pkg.bin === "string") return join(ROOT, pkgDir, pkg.bin);
  if (pkg.bin && typeof pkg.bin === "object") {
    const first = Object.values(pkg.bin)[0];
    if (first) return join(ROOT, pkgDir, first);
  }
  return join(ROOT, pkgDir, "dist/cli/index.js");
}

/**
 * Run a CLI and capture both stdout and stderr.
 * Returns { stdout, stderr, combined, status }.
 */
function capture(scriptPath, args = []) {
  const result = spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf-8",
    timeout: 10_000,
    cwd: ROOT,
  });
  const stdout = result.stdout ?? "";
  const stderr = result.stderr ?? "";
  return { stdout, stderr, combined: stdout + stderr, status: result.status ?? -1 };
}

/**
 * Extract any DeprecationWarning lines from combined output.
 * Returns an array of matching lines (empty if clean).
 */
function deprecationLines(combined) {
  return combined
    .split("\n")
    .filter((line) => line.includes("DeprecationWarning"));
}

describe("CLI deprecation filter: no DeprecationWarning in standard output", () => {
  it("ndx --version emits no DeprecationWarning on stdout or stderr", () => {
    const { combined } = capture(CLI_PATH, ["--version"]);
    expect(deprecationLines(combined)).toEqual([]);
  });

  it("rex --help emits no DeprecationWarning on stdout or stderr", () => {
    const rexBin = resolveBin("packages/rex");
    const { combined } = capture(rexBin, ["--help"]);
    expect(deprecationLines(combined)).toEqual([]);
  });

  it("hench --help emits no DeprecationWarning on stdout or stderr", () => {
    const henchBin = resolveBin("packages/hench");
    const { combined } = capture(henchBin, ["--help"]);
    expect(deprecationLines(combined)).toEqual([]);
  });

  it("sourcevision --help emits no DeprecationWarning on stdout or stderr", () => {
    const svBin = resolveBin("packages/sourcevision");
    const { combined } = capture(svBin, ["--help"]);
    expect(deprecationLines(combined)).toEqual([]);
  });
});
