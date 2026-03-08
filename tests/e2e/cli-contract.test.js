/**
 * CLI contract test — compile-time safety net for orchestration-to-domain boundary.
 *
 * cli.js and ci.js spawn tool CLIs as subprocesses, passing subcommand names
 * as string arguments. A renamed or removed subcommand produces a silent
 * runtime failure. This test verifies that every subcommand the orchestration
 * layer invokes actually exists in the target tool's CLI dispatch table.
 *
 * @see cli.js — orchestration entry point
 * @see ci.js  — CI pipeline
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const root = join(import.meta.dirname, "../..");

/**
 * Resolve a package's CLI entry point from its package.json bin field.
 */
function resolveToolPath(pkgDir) {
  const pkgPath = join(root, pkgDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
  if (typeof pkg.bin === "string") return join(root, pkgDir, pkg.bin);
  if (pkg.bin && typeof pkg.bin === "object") {
    const first = Object.values(pkg.bin)[0];
    if (first) return join(root, pkgDir, first);
  }
  return join(root, pkgDir, "dist/cli/index.js");
}

/**
 * Get the list of supported subcommands from a tool's CLI help output.
 * Spawns the tool with --help and parses the output.
 */
function getSupportedCommands(toolPath) {
  let output;
  try {
    output = execFileSync(process.execPath, [toolPath, "--help"], {
      encoding: "utf-8",
      timeout: 10_000,
      cwd: root,
    });
  } catch (err) {
    // Some CLIs exit with non-zero on --help but still print usage
    output = (err.stdout || "") + (err.stderr || "");
  }
  return output;
}

/**
 * Subcommands the orchestration layer (cli.js + ci.js) passes to each tool.
 * Extracted by grepping for `tools.<name>` calls in cli.js and ci.js.
 *
 * Keep this list in sync with the orchestration files. If a new subcommand
 * is added to cli.js, add it here to ensure contract coverage.
 */
const ORCHESTRATION_CONTRACTS = {
  sourcevision: {
    pkgDir: "packages/sourcevision",
    /** Subcommands invoked by cli.js and ci.js */
    commands: ["init", "analyze", "validate", "pr-markdown", "mcp"],
  },
  rex: {
    pkgDir: "packages/rex",
    /** Subcommands invoked by cli.js and ci.js */
    commands: ["init", "analyze", "status", "usage", "sync", "validate", "mcp"],
  },
  hench: {
    pkgDir: "packages/hench",
    /** Subcommands invoked by cli.js */
    commands: ["init", "run"],
  },
};

describe("CLI orchestration contract", () => {
  for (const [toolName, contract] of Object.entries(ORCHESTRATION_CONTRACTS)) {
    describe(toolName, () => {
      const toolPath = resolveToolPath(contract.pkgDir);
      const helpOutput = getSupportedCommands(toolPath);

      for (const cmd of contract.commands) {
        it(`supports "${cmd}" subcommand`, () => {
          // Verify the command name appears in the help output.
          // This catches renamed/removed subcommands at test time.
          expect(
            helpOutput.includes(cmd),
            `${toolName} CLI does not mention "${cmd}" in its --help output.\n` +
            `cli.js/ci.js invokes this subcommand — if it was renamed or removed,\n` +
            `update the orchestration layer to match.\n\n` +
            `Help output:\n${helpOutput.slice(0, 1000)}`,
          ).toBe(true);
        });
      }
    });
  }
});
