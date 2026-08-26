/**
 * Shell-spawn inventory completeness — every test file that spawns a POSIX
 * shell as a real process must be accounted for in
 * tests/shell-spawn-inventory.md (either as a guarded row or in the
 * "Sites that need no guard" table).
 *
 * Why: `sh` is not on PATH in a stock Windows shell, so an unguarded spawn
 * fails opaquely ("Exit code: 1", no mention of a shell). The inventory was
 * assembled by hand, and git.test.ts proved a hand audit misses sites — 7
 * cases failed from PowerShell on a file the audit never saw. This scan makes
 * the next missed site a test failure instead of a mystery.
 *
 * Detection is two-pronged:
 *   1. Direct spawn of "sh" via child_process or the llm-client exec wrapper.
 *   2. Static import of a hench tool module that runs exec("sh", ["-c", ...])
 *      on every platform (tools/git, tools/shell, tools/test-runner,
 *      tools/exec-shell) — unless the file vi.mocks the exec boundary, in
 *      which case no process is created and no guard is needed.
 *
 * A flagged file satisfies the policy by being mentioned anywhere in the
 * inventory. The inventory itself states whether the mention is a guard row
 * or a documented reason no guard is needed — this scan only guarantees the
 * site was looked at.
 *
 * @see tests/shell-spawn-inventory.md
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join, relative, sep } from "node:path";

const ROOT = join(import.meta.dirname, "../..");
const INVENTORY_PATH = join(ROOT, "tests", "shell-spawn-inventory.md");
const SELF = "tests/e2e/shell-spawn-inventory-policy.test.js";

/** Real spawn of `sh` — child_process APIs or llm-client's exec wrapper. */
const DIRECT_SH_SPAWN = /\b(?:spawn|spawnSync|exec|execFile|execFileSync|execSync)\(\s*["']sh["']/;

/**
 * Static import of a hench tool module whose implementation shells out on
 * every platform. Update this list when a new tool module calls execShell.
 */
const SHELL_BACKED_TOOL_IMPORT =
  /from\s+["'][^"']*\/tools\/(?:git|shell|test-runner|exec-shell)(?:\.js)?["']/;

/** vi.mock of the exec boundary or of the tool module itself — no real process. */
const EXEC_BOUNDARY_MOCK =
  /vi\.mock\(\s*["'][^"']*(?:\/process\/exec|\/tools\/(?:git|shell|test-runner|exec-shell))(?:\.js)?["']/;

function walkTestFiles(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walkTestFiles(full, files);
    } else if (/\.test\.(?:ts|js|tsx|jsx)$/.test(entry.name)) {
      files.push(full);
    }
  }
  return files;
}

function collectScanRoots() {
  const roots = [join(ROOT, "tests")];
  const packagesDir = join(ROOT, "packages");
  for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const testsDir = join(packagesDir, entry.name, "tests");
    if (existsSync(testsDir)) roots.push(testsDir);
  }
  return roots;
}

function toPosixRelative(file) {
  return relative(ROOT, file).split(sep).join("/");
}

function findShellSpawningTestFiles() {
  const flagged = [];
  for (const root of collectScanRoots()) {
    for (const file of walkTestFiles(root)) {
      const relPath = toPosixRelative(file);
      if (relPath === SELF) continue;
      const content = readFileSync(file, "utf8");
      const direct = DIRECT_SH_SPAWN.test(content);
      const viaToolImport = SHELL_BACKED_TOOL_IMPORT.test(content) && !EXEC_BOUNDARY_MOCK.test(content);
      if (direct || viaToolImport) flagged.push(relPath);
    }
  }
  return flagged.sort();
}

describe("shell-spawn inventory completeness", () => {
  it("flags the known shell-spawning suites (detector self-test)", () => {
    const flagged = findShellSpawningTestFiles();
    // If the detector regresses to flagging nothing, this fails before the
    // inventory check below turns vacuously green.
    expect(flagged).toContain("packages/hench/tests/unit/tools/shell.test.ts");
    expect(flagged).toContain("packages/hench/tests/unit/tools/git.test.ts");
    expect(flagged).toContain("tests/e2e/stop-orphan-children.test.js");
  });

  it("every test file that really spawns a shell is in the inventory", () => {
    const inventory = readFileSync(INVENTORY_PATH, "utf8");
    const missing = findShellSpawningTestFiles().filter((relPath) => !inventory.includes(relPath));

    expect(
      missing,
      `Test file(s) spawn a POSIX shell but have no entry in tests/shell-spawn-inventory.md:\n` +
        missing.map((f) => `  - ${f}`).join("\n") +
        `\nEither guard the shell-dependent cases (see the helpers table in the ` +
        `inventory) and add a row, or record in "Sites that need no guard" why ` +
        `no guard is needed.`,
    ).toEqual([]);
  });
});
