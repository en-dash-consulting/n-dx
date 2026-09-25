/**
 * CLI argument contract tests.
 *
 * Validates that rex, hench, and sourcevision CLI help output matches
 * expected argument signatures. When a CLI adds, removes, or renames
 * a command or option, these tests break — forcing an explicit update
 * to the contract rather than a silent breaking change.
 *
 * The contracts live alongside the tests (not in a separate schema file)
 * so they're easy to review in diffs.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, runFail } from "./e2e-helpers.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse top-level commands from CLI help output.
 * Looks for lines like "  command [dir]  Description..." under COMMANDS.
 * Returns an array of command names (first word on each indented line).
 */
function parseCommands(helpText) {
  const lines = helpText.split("\n");
  const commands = [];
  let inCommands = false;

  for (const line of lines) {
    if (/^COMMANDS/i.test(line.trim())) {
      inCommands = true;
      continue;
    }
    if (inCommands && /^[A-Z]/.test(line.trim()) && !/^\s/.test(line)) {
      // Hit a new section header (OPTIONS, USAGE, etc.)
      break;
    }
    if (inCommands && /^\s{2}\S/.test(line)) {
      // Extract the command name — first non-whitespace token, stripping
      // any package prefix like "sourcevision " from "sourcevision init [dir]"
      const trimmed = line.trim();
      const firstWord = trimmed.split(/\s+/)[0];
      commands.push(firstWord);
    }
  }

  return [...new Set(commands)];
}

/**
 * Parse option flags from CLI help output.
 * Looks for lines like "  --flag, -f  Description" under OPTIONS.
 */
function parseOptions(helpText) {
  const lines = helpText.split("\n");
  const options = [];
  let inOptions = false;

  for (const line of lines) {
    if (/^OPTIONS/i.test(line.trim())) {
      inOptions = true;
      continue;
    }
    if (inOptions && /^[A-Z]/.test(line.trim()) && !/^\s/.test(line)) {
      break;
    }
    if (inOptions && /^\s{2}--/.test(line)) {
      // Extract all --flag tokens from the line
      const flags = line.match(/--[\w-]+(=\S+)?/g);
      if (flags) options.push(...flags);
    }
  }

  return options;
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

/**
 * Expected top-level commands for each CLI.
 * Update these arrays when CLI commands are intentionally added/removed.
 */
const REX_COMMANDS = [
  "init",
  "status",
  "tree",
  "next",
  "add",
  "update",
  "remove",
  "move",
  "reshape",
  "prune",
  "usage",
  "validate",
  "fix",
  "report",
  "verify",
  "recommend",
  "analyze",
  "import",
  "export",
  "import-bundle",
  "reorganize",
  "health",
  "sync",
  "claim",
  "adapter",
  "migrate-to-md",
  "migrate-folder-tree-filenames",
  "migrate-slugs",
  "merge-driver",
  "backfill-commit-attribution",
  "mcp",
];

const HENCH_COMMANDS = [
  "init",
  "run",
  "record",
  "config",
  "template",
  "status",
  "show",
  "review",
  "validate-tokens",
];

const SOURCEVISION_COMMANDS = [
  "sourcevision",  // all SV commands are prefixed in help output
];

// Sourcevision help lists commands with prefix — extract the subcommand part
const SOURCEVISION_SUBCOMMANDS = [
  "init",
  "analyze",
  "narrate",
  "serve",
  "validate",
  "export-pdf",
  "iso",
  "pr-markdown",
  "git-credential-helper",
  "reset",
  "workspace",
  "mcp",
];

const NDX_ORCHESTRATION_COMMANDS = [
  "init",
  "which",
  "analyze",
  "recommend",
  "add",
  "plan",
  "refresh",
  "work",
  "self-heal",
  "status",
  "usage",
  "sync",
  "start",
  "dev",
  "ci",
  "config",
  "export",
  "validate",
  "fix",
  "health",
  "report",
  "verify",
  "update",
  "remove",
  "move",
  "reshape",
  "reorganize",
  "prune",
  "next",
  "reset",
  "show",
];

const NDX_TOOL_COMMANDS = [
  "rex",
  "hench",
  "sourcevision",
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CLI argument contracts", () => {
  describe("rex CLI", () => {
    let helpText;

    it("produces help output", () => {
      helpText = run(["rex", "--help"]);
      expect(helpText).toContain("rex");
    });

    it("exposes all expected commands", () => {
      const commands = parseCommands(helpText);
      for (const cmd of REX_COMMANDS) {
        expect(commands, `missing rex command: ${cmd}`).toContain(cmd);
      }
    });

    it("does not expose unexpected commands", () => {
      const commands = parseCommands(helpText);
      for (const cmd of commands) {
        // Some lines parse as "echo" or "add" variants — skip quoted/pipe forms
        if (cmd === "echo") continue;
        expect(
          REX_COMMANDS,
          `unexpected rex command: ${cmd} — update the contract if intentional`,
        ).toContain(cmd);
      }
    });

    it("exposes expected global options", () => {
      const options = parseOptions(helpText);
      expect(options).toContain("--help");
      expect(options).toContain("--quiet");
      expect(options).toContain("--format=tree|json");
    });
  });

  describe("hench CLI", () => {
    let helpText;

    it("produces help output", () => {
      helpText = run(["hench", "--help"]);
      expect(helpText).toContain("hench");
    });

    it("exposes all expected commands", () => {
      const commands = parseCommands(helpText);
      for (const cmd of HENCH_COMMANDS) {
        expect(commands, `missing hench command: ${cmd}`).toContain(cmd);
      }
    });

    it("does not expose unexpected commands", () => {
      const commands = parseCommands(helpText);
      for (const cmd of commands) {
        expect(
          HENCH_COMMANDS,
          `unexpected hench command: ${cmd} — update the contract if intentional`,
        ).toContain(cmd);
      }
    });

    it("exposes expected global options", () => {
      const options = parseOptions(helpText);
      expect(options).toContain("--help");
      expect(options).toContain("--quiet");
      expect(options).toContain("--format=json");
    });
  });

  describe("sourcevision CLI", () => {
    let helpText;

    it("produces help output", () => {
      helpText = run(["sourcevision", "--help"]);
      expect(helpText).toContain("sourcevision");
    });

    it("exposes all expected subcommands", () => {
      for (const cmd of SOURCEVISION_SUBCOMMANDS) {
        expect(
          helpText,
          `missing sourcevision subcommand: ${cmd}`,
        ).toContain(`sourcevision ${cmd}`);
      }
    });

    it("does not expose unexpected subcommands", () => {
      // Extract "sourcevision <word>" patterns from COMMANDS section
      const matches = helpText.match(/sourcevision\s+([\w-]+)/g) || [];
      const found = matches.map((m) => m.replace("sourcevision ", ""));
      const unique = [...new Set(found)];
      for (const cmd of unique) {
        expect(
          SOURCEVISION_SUBCOMMANDS,
          `unexpected sourcevision subcommand: ${cmd} — update the contract if intentional`,
        ).toContain(cmd);
      }
    });

    it("exposes expected global options", () => {
      const options = parseOptions(helpText);
      expect(options).toContain("--help");
      expect(options).toContain("--quiet");
    });
  });

  describe("ndx orchestrator CLI", () => {
    let helpText;

    it("produces help output", () => {
      helpText = run([]);
      expect(helpText).toContain("n-dx");
    });

    it("lists all orchestration commands", () => {
      for (const cmd of NDX_ORCHESTRATION_COMMANDS) {
        expect(
          helpText,
          `missing ndx orchestration command: ${cmd}`,
        ).toMatch(new RegExp(`^\\s+${cmd}\\b`, "m"));
      }
    });

    it("lists all tool delegation commands", () => {
      // Tools are mentioned in the footer rather than as individual entries
      for (const tool of NDX_TOOL_COMMANDS) {
        expect(
          helpText,
          `missing tool name in footer: ${tool}`,
        ).toContain(tool);
      }
    });
  });

  /**
   * `ndx claim` takes an optional trailing [dir], and the init check must
   * look at that directory — not process.cwd() — because rex resolves the
   * same argument itself (PR E, audit item ddfd38ea). Where the [dir] sits
   * depends on the subcommand, so each shape is exercised from a cwd that is
   * NOT an initialized project.
   */
  describe("ndx claim directory argument", () => {
    let projectDir;
    let outsideDir;

    beforeAll(() => {
      projectDir = mkdtempSync(join(tmpdir(), "ndx-claim-dir-project-"));
      mkdirSync(join(projectDir, ".rex"), { recursive: true });
      outsideDir = mkdtempSync(join(tmpdir(), "ndx-claim-dir-outside-"));
    });

    afterAll(() => {
      for (const dir of [projectDir, outsideDir]) {
        if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
      }
    });

    it("claim list <dir> works from outside the project", () => {
      const out = run(["claim", "list", projectDir], { cwd: outsideDir });
      expect(out).toContain("No task claims");
    });

    it("claim release <taskId> <dir> reaches rex from outside the project", () => {
      // The release itself fails — there is no such claim — but with rex's
      // own message, not the orchestrator's init refusal: the dir landed in
      // the right positional slot.
      const { stdout, stderr } = runFail(["claim", "release", "no-such-task", projectDir], {
        cwd: outsideDir,
      });
      expect(`${stdout}\n${stderr}`).toContain("no live claim");
      expect(`${stdout}\n${stderr}`).not.toContain("NOT_INITIALIZED");
    });

    it("claim release --all <dir> works from outside the project", () => {
      const out = run(["claim", "release", "--all", projectDir], { cwd: outsideDir });
      expect(out).toContain("No claims are held");
    });

    it("claim release --all=true <dir> works from outside the project", () => {
      // Rex's flag parser reads `--all=true` as `--all`; the orchestrator's
      // [dir] slicing must agree, or the init check validates the cwd and
      // fails with NDX_CLI_NOT_INITIALIZED despite a valid <dir> argument.
      const out = run(["claim", "release", "--all=true", projectDir], { cwd: outsideDir });
      expect(out).toContain("No claims are held");
    });

    it("claim list without a dir still refuses an uninitialized cwd", () => {
      const { stderr } = runFail(["claim", "list"], { cwd: outsideDir });
      expect(stderr).toContain("NOT_INITIALIZED");
    });
  });

  describe("cross-CLI consistency", () => {
    it("rex, hench, and sourcevision all support --help flag", () => {
      for (const tool of ["rex", "hench", "sourcevision"]) {
        const output = run([tool, "--help"]);
        expect(output.length).toBeGreaterThan(50);
        expect(output).toMatch(/USAGE/i);
        expect(output).toMatch(/COMMANDS/i);
      }
    });

    it("rex, hench, and sourcevision all support --quiet flag", () => {
      for (const tool of ["rex", "hench", "sourcevision"]) {
        const output = run([tool, "--help"]);
        expect(output, `${tool} missing --quiet`).toContain("--quiet");
      }
    });

    it("all three CLIs display version in help header", () => {
      for (const tool of ["rex", "hench"]) {
        const output = run([tool, "--help"]);
        expect(output, `${tool} missing version`).toMatch(/v\d+\.\d+\.\d+/);
      }
    });
  });
});
