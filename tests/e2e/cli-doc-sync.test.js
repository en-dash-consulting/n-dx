/**
 * CLI documentation sync test — guards against CLAUDE.md listing commands
 * that no longer exist in the actual CLI.
 *
 * Reads the "Direct Tool Access" command lists from CLAUDE.md and verifies
 * every listed command appears in the corresponding tool's --help output.
 * Also verifies every ndx orchestration command appears in `ndx help` output.
 *
 * When you add or remove a command from a tool CLI:
 *   1. Update the command list in CLAUDE.md (and CODEX.md per SYNC NOTICE).
 *   2. Run this test to confirm the docs match the new CLI surface.
 *
 * The test does NOT fail when the CLI has commands that CLAUDE.md omits —
 * that is a gap, not a staleness problem. It only catches stale references
 * (commands documented but removed from the CLI).
 */

import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { readFileSync } from "node:fs";

const root = join(import.meta.dirname, "../..");

// ── Helper: get --help output ──────────────────────────────────────────────

function getHelpOutput(pkgDir, args = ["--help"]) {
  const pkgPath = join(root, pkgDir, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));

  let binPath;
  if (typeof pkg.bin === "string") {
    binPath = join(root, pkgDir, pkg.bin);
  } else if (pkg.bin && typeof pkg.bin === "object") {
    const first = Object.values(pkg.bin)[0];
    binPath = join(root, pkgDir, first);
  } else {
    binPath = join(root, pkgDir, "dist/cli/index.js");
  }

  try {
    return execFileSync(process.execPath, [binPath, ...args], {
      encoding: "utf-8",
      timeout: 10_000,
      cwd: root,
    });
  } catch (err) {
    // Some CLIs write help to stderr or exit non-zero — capture both
    return (err.stdout || "") + (err.stderr || "");
  }
}

// ── Helper: parse CLAUDE.md command lists ─────────────────────────────────

/**
 * Parse a "### <Tool> commands" section from CLAUDE.md.
 * Returns an array of command name strings.
 *
 * The section format is:
 *   ### Rex commands
 *
 *   `init`, `status`, `next`, ...
 */
function parseDocCommandList(content, sectionHeader) {
  const re = new RegExp(
    `### ${sectionHeader} commands\\n\\n\`([^\`]+(?:\`, \`[^\`]+)*)\``,
    "s",
  );
  const m = content.match(re);
  if (!m) return [];
  // Extract all backtick-wrapped tokens
  return [...m[0].matchAll(/`([^`]+)`/g)]
    .map((t) => t[1])
    .filter((t) => !t.startsWith("ndx")); // strip any accidental ndx lines
}

/**
 * Parse the "## n-dx Orchestration Commands" code block from CLAUDE.md.
 * Returns command names extracted from lines like:
 *   ndx <command> [args]   # comment
 */
function parseOrchestrationCommands(content) {
  const m = content.match(
    /## n-dx Orchestration Commands\n\n```sh\n([\s\S]*?)```/,
  );
  if (!m) return [];
  return m[1]
    .split("\n")
    .filter((l) => l.startsWith("ndx ") && !l.startsWith("ndx plan --"))
    .map((l) => l.replace(/^ndx /, "").split(/\s+/)[0])
    .filter(Boolean);
}

// ── Read docs once ────────────────────────────────────────────────────────

const claudeMd = readFileSync(join(root, "CLAUDE.md"), "utf-8");
const codexMd = readFileSync(join(root, "CODEX.md"), "utf-8");

// ── Tests ─────────────────────────────────────────────────────────────────

describe("cli-doc-sync: CLAUDE.md command lists match CLI --help", () => {
  // ── ndx orchestration commands ──────────────────────────────────────────

  describe("ndx orchestration commands", () => {
    const documented = parseOrchestrationCommands(claudeMd);
    const helpOutput = getHelpOutput("packages/core", ["help"]);

    it("parses at least 10 orchestration commands from CLAUDE.md", () => {
      expect(documented.length).toBeGreaterThanOrEqual(10);
    });

    for (const cmd of documented) {
      it(`"${cmd}" appears in ndx help output`, () => {
        expect(
          helpOutput.includes(cmd),
          `CLAUDE.md lists "ndx ${cmd}" but it does not appear in \`ndx help\` output.\n` +
            `Update CLAUDE.md to reflect the current CLI surface.\n\n` +
            `ndx help output (first 1200 chars):\n${helpOutput.slice(0, 1200)}`,
        ).toBe(true);
      });
    }
  });

  // ── rex subcommands ──────────────────────────────────────────────────────

  describe("rex subcommands", () => {
    const documented = parseDocCommandList(claudeMd, "Rex");
    const helpOutput = getHelpOutput("packages/rex");

    it("parses at least 10 rex commands from CLAUDE.md", () => {
      expect(documented.length).toBeGreaterThanOrEqual(10);
    });

    for (const cmd of documented) {
      it(`"${cmd}" appears in rex --help output`, () => {
        expect(
          helpOutput.includes(cmd),
          `CLAUDE.md lists rex command "${cmd}" but it does not appear in \`rex --help\` output.\n` +
            `Update CLAUDE.md to reflect the current CLI surface.\n\n` +
            `rex --help output (first 1200 chars):\n${helpOutput.slice(0, 1200)}`,
        ).toBe(true);
      });
    }
  });

  // ── sourcevision subcommands ─────────────────────────────────────────────

  describe("sourcevision subcommands", () => {
    const documented = parseDocCommandList(claudeMd, "Sourcevision");
    const helpOutput = getHelpOutput("packages/sourcevision");

    it("parses at least 6 sourcevision commands from CLAUDE.md", () => {
      expect(documented.length).toBeGreaterThanOrEqual(6);
    });

    for (const cmd of documented) {
      it(`"${cmd}" appears in sourcevision --help output`, () => {
        expect(
          helpOutput.includes(cmd),
          `CLAUDE.md lists sourcevision command "${cmd}" but it does not appear in \`sourcevision --help\` output.\n` +
            `Update CLAUDE.md to reflect the current CLI surface.\n\n` +
            `sourcevision --help output (first 1200 chars):\n${helpOutput.slice(0, 1200)}`,
        ).toBe(true);
      });
    }
  });

  // ── hench subcommands ────────────────────────────────────────────────────

  describe("hench subcommands", () => {
    const documented = parseDocCommandList(claudeMd, "Hench");
    const helpOutput = getHelpOutput("packages/hench");

    it("parses at least 4 hench commands from CLAUDE.md", () => {
      expect(documented.length).toBeGreaterThanOrEqual(4);
    });

    for (const cmd of documented) {
      it(`"${cmd}" appears in hench --help output`, () => {
        expect(
          helpOutput.includes(cmd),
          `CLAUDE.md lists hench command "${cmd}" but it does not appear in \`hench --help\` output.\n` +
            `Update CLAUDE.md to reflect the current CLI surface.\n\n` +
            `hench --help output (first 1200 chars):\n${helpOutput.slice(0, 1200)}`,
        ).toBe(true);
      });
    }
  });
});

// ── CODEX.md must mirror CLAUDE.md command lists ──────────────────────────

describe("cli-doc-sync: CODEX.md command lists match CLI --help", () => {
  // ── ndx orchestration commands ──────────────────────────────────────────

  describe("ndx orchestration commands", () => {
    const documented = parseOrchestrationCommands(codexMd);
    const helpOutput = getHelpOutput("packages/core", ["help"]);

    it("parses at least 10 orchestration commands from CODEX.md", () => {
      expect(documented.length).toBeGreaterThanOrEqual(10);
    });

    for (const cmd of documented) {
      it(`"${cmd}" appears in ndx help output`, () => {
        expect(
          helpOutput.includes(cmd),
          `CODEX.md lists "ndx ${cmd}" but it does not appear in \`ndx help\` output.\n` +
            `Update CODEX.md (and CLAUDE.md per SYNC NOTICE) to reflect the current CLI surface.\n\n` +
            `ndx help output (first 1200 chars):\n${helpOutput.slice(0, 1200)}`,
        ).toBe(true);
      });
    }
  });

  // ── rex subcommands ──────────────────────────────────────────────────────

  describe("rex subcommands", () => {
    const documented = parseDocCommandList(codexMd, "Rex");
    const helpOutput = getHelpOutput("packages/rex");

    it("parses at least 10 rex commands from CODEX.md", () => {
      expect(documented.length).toBeGreaterThanOrEqual(10);
    });

    for (const cmd of documented) {
      it(`"${cmd}" appears in rex --help output`, () => {
        expect(
          helpOutput.includes(cmd),
          `CODEX.md lists rex command "${cmd}" but it does not appear in \`rex --help\` output.\n` +
            `Update CODEX.md (and CLAUDE.md per SYNC NOTICE) to reflect the current CLI surface.\n\n` +
            `rex --help output (first 1200 chars):\n${helpOutput.slice(0, 1200)}`,
        ).toBe(true);
      });
    }
  });

  // ── sourcevision subcommands ─────────────────────────────────────────────

  describe("sourcevision subcommands", () => {
    const documented = parseDocCommandList(codexMd, "Sourcevision");
    const helpOutput = getHelpOutput("packages/sourcevision");

    it("parses at least 6 sourcevision commands from CODEX.md", () => {
      expect(documented.length).toBeGreaterThanOrEqual(6);
    });

    for (const cmd of documented) {
      it(`"${cmd}" appears in sourcevision --help output`, () => {
        expect(
          helpOutput.includes(cmd),
          `CODEX.md lists sourcevision command "${cmd}" but it does not appear in \`sourcevision --help\` output.\n` +
            `Update CODEX.md (and CLAUDE.md per SYNC NOTICE) to reflect the current CLI surface.\n\n` +
            `sourcevision --help output (first 1200 chars):\n${helpOutput.slice(0, 1200)}`,
        ).toBe(true);
      });
    }
  });

  // ── hench subcommands ────────────────────────────────────────────────────

  describe("hench subcommands", () => {
    const documented = parseDocCommandList(codexMd, "Hench");
    const helpOutput = getHelpOutput("packages/hench");

    it("parses at least 4 hench commands from CODEX.md", () => {
      expect(documented.length).toBeGreaterThanOrEqual(4);
    });

    for (const cmd of documented) {
      it(`"${cmd}" appears in hench --help output`, () => {
        expect(
          helpOutput.includes(cmd),
          `CODEX.md lists hench command "${cmd}" but it does not appear in \`hench --help\` output.\n` +
            `Update CODEX.md (and CLAUDE.md per SYNC NOTICE) to reflect the current CLI surface.\n\n` +
            `hench --help output (first 1200 chars):\n${helpOutput.slice(0, 1200)}`,
        ).toBe(true);
      });
    }
  });
});
