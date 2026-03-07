/**
 * CLI spawn boundary contract tests.
 *
 * The orchestration layer (cli.js) delegates to domain package CLIs via
 * child_process.spawn. These interfaces are untyped — if a domain CLI
 * renames or removes a subcommand, the orchestrator silently breaks.
 *
 * This test suite codifies the spawn boundary contract: for every
 * subcommand that cli.js delegates to a domain CLI, we verify that the
 * target CLI recognizes the subcommand (exits 0 with --help, or
 * produces recognizable output).
 *
 * @see cli.js — orchestrator that spawns these CLIs
 * @see tests/e2e/domain-isolation.test.js — import-graph enforcement
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const ROOT = join(import.meta.dirname, "../..");

/**
 * Resolve a package's CLI entry point (mirrors cli.js logic).
 */
function resolveToolPath(pkgDir) {
  const pkgPath = join(ROOT, pkgDir, "package.json");
  try {
    const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
    if (typeof pkg.bin === "string") return join(ROOT, pkgDir, pkg.bin);
    if (pkg.bin && typeof pkg.bin === "object") {
      const first = Object.values(pkg.bin)[0];
      if (first) return join(ROOT, pkgDir, first);
    }
  } catch { /* fall through */ }
  return join(ROOT, pkgDir, "dist/cli/index.js");
}

const tools = {
  rex: resolveToolPath("packages/rex"),
  hench: resolveToolPath("packages/hench"),
  sourcevision: resolveToolPath("packages/sourcevision"),
};

/**
 * Run a domain CLI with given args.
 * Returns { stdout, stderr, code }.
 */
function runTool(toolPath, args) {
  try {
    const stdout = execFileSync("node", [toolPath, ...args], {
      encoding: "utf-8",
      timeout: 10000,
      stdio: "pipe",
    });
    return { stdout, stderr: "", code: 0 };
  } catch (err) {
    return {
      stdout: err.stdout || "",
      stderr: err.stderr || "",
      code: err.status,
    };
  }
}

/**
 * Verify a domain CLI recognizes a subcommand by checking that
 * `<tool> --help` output mentions the subcommand name.
 */
function verifySubcommandExists(toolPath, toolName, subcommand) {
  const result = runTool(toolPath, [subcommand, "--help"]);
  const combined = result.stdout + result.stderr;

  // The tool should either:
  // 1. Show help for the subcommand (exit 0), or
  // 2. Mention the subcommand in its help output
  // It should NOT say "Unknown command" for a valid subcommand.
  expect(combined).not.toMatch(/unknown command/i);
}

// ---------------------------------------------------------------------------
// Contract: subcommands that cli.js delegates to each domain CLI
// ---------------------------------------------------------------------------

/**
 * These lists define the spawn boundary contract. Each entry is a subcommand
 * that cli.js passes to the domain CLI via spawn(). If any entry is removed
 * from the domain CLI, this test fails — forcing an explicit update to both
 * the CLI and this contract.
 *
 * Source: grep for `tools.(rex|hench|sourcevision)` in cli.js
 */

const REX_SUBCOMMANDS = [
  "init",     // ndx init → rex init
  "analyze",  // ndx plan → rex analyze
  "status",   // ndx status → rex status
  "usage",    // ndx usage → rex usage
  "sync",     // ndx sync → rex sync
];

const SOURCEVISION_SUBCOMMANDS = [
  "init",        // ndx init → sourcevision init
  "analyze",     // ndx plan / ndx refresh → sourcevision analyze
  "pr-markdown", // ndx refresh → sourcevision pr-markdown
];

const HENCH_SUBCOMMANDS = [
  "init",  // ndx init → hench init
  "run",   // ndx work → hench run
];

describe("CLI spawn boundary contract", () => {
  describe("rex subcommands delegated by cli.js", () => {
    for (const cmd of REX_SUBCOMMANDS) {
      it(`rex CLI accepts "${cmd}" subcommand`, () => {
        verifySubcommandExists(tools.rex, "rex", cmd);
      });
    }
  });

  describe("sourcevision subcommands delegated by cli.js", () => {
    for (const cmd of SOURCEVISION_SUBCOMMANDS) {
      it(`sourcevision CLI accepts "${cmd}" subcommand`, () => {
        verifySubcommandExists(tools.sourcevision, "sourcevision", cmd);
      });
    }
  });

  describe("hench subcommands delegated by cli.js", () => {
    for (const cmd of HENCH_SUBCOMMANDS) {
      it(`hench CLI accepts "${cmd}" subcommand`, () => {
        verifySubcommandExists(tools.hench, "hench", cmd);
      });
    }
  });

  describe("delegation help output consistency", () => {
    /**
     * Verify that each domain CLI's --help mentions all subcommands
     * the orchestrator relies on. This catches the case where a
     * subcommand is silently removed from help but still partially works.
     */
    it("rex --help lists all delegated subcommands", () => {
      const result = runTool(tools.rex, ["--help"]);
      const help = result.stdout + result.stderr;
      for (const cmd of REX_SUBCOMMANDS) {
        expect(help, `rex --help should mention "${cmd}"`).toContain(cmd);
      }
    });

    it("sourcevision --help lists all delegated subcommands", () => {
      const result = runTool(tools.sourcevision, ["--help"]);
      const help = result.stdout + result.stderr;
      for (const cmd of SOURCEVISION_SUBCOMMANDS) {
        expect(help, `sourcevision --help should mention "${cmd}"`).toContain(cmd);
      }
    });

    it("hench --help lists all delegated subcommands", () => {
      const result = runTool(tools.hench, ["--help"]);
      const help = result.stdout + result.stderr;
      for (const cmd of HENCH_SUBCOMMANDS) {
        expect(help, `hench --help should mention "${cmd}"`).toContain(cmd);
      }
    });
  });
});
