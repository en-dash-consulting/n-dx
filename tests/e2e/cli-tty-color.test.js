/**
 * Integration tests: TTY-aware color emission and NO_COLOR suppression.
 *
 * Each CLI tool (rex, sourcevision, hench, ndx) is spawned in three modes:
 *   1. FORCE_COLOR=1         — simulates a TTY; asserts ANSI codes are present
 *   2. NO_COLOR=1            — asserts ANSI codes are suppressed per no-color.org
 *   3. Default (piped only)  — asserts ANSI codes are absent (no TTY, no override)
 *
 * Representative commands per tool:
 *   rex          — `rex status <dir>`          (PRD tree with status coloring)
 *   sourcevision — `sourcevision validate <dir>` (pass/fail coloring)
 *   hench        — `hench --help`               (help page with header/flag colors)
 *   ndx          — `ndx help`                   (orchestrator help page)
 *
 * All three color-detection mechanisms are exercised:
 *   FORCE_COLOR > NO_COLOR > process.stdout.isTTY (false when piped)
 *
 * @see packages/llm-client/src/help-format.ts  — TS color implementation
 * @see packages/core/help.js                   — JS color implementation (ndx)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  createTmpDir,
  removeTmpDir,
  setupRexDir,
  setupSourcevisionDir,
} from "./e2e-helpers.js";

// ---------------------------------------------------------------------------
// CLI entry points
// ---------------------------------------------------------------------------

const ROOT = join(import.meta.dirname, "../..");
const REX_CLI = join(ROOT, "packages/rex/dist/cli/index.js");
const SV_CLI = join(ROOT, "packages/sourcevision/dist/cli/index.js");
const HENCH_CLI = join(ROOT, "packages/hench/dist/cli/index.js");
const NDX_CLI = join(ROOT, "packages/core/cli.js");

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Matches any ANSI SGR escape sequence (colors, bold, dim, etc.). */
const ANSI_ESCAPE = /\x1b\[[\d;]*m/;

const TIMEOUT = 15_000;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a child-process environment from the current env, applying overrides.
 * Pass `null` as a value to *delete* a variable from the spawned environment —
 * this is essential for clearing FORCE_COLOR / NO_COLOR that might be set in
 * the parent test runner.
 *
 * @param {Record<string, string | null>} overrides
 * @returns {NodeJS.ProcessEnv}
 */
function buildEnv(overrides) {
  const env = { ...process.env };
  for (const [key, val] of Object.entries(overrides)) {
    if (val === null) {
      delete env[key];
    } else {
      env[key] = val;
    }
  }
  return env;
}

/**
 * Spawn a CLI and return its stdout as a string.
 * Non-zero exit codes are tolerated: any output written before the error is
 * still returned so the caller can assert against it.
 *
 * Only stdout is returned — stderr (e.g. Node.js deprecation warnings) is
 * intentionally excluded to prevent false positives in ANSI-code assertions.
 *
 * @param {string} cliPath
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 * @returns {string}
 */
function spawnCLI(cliPath, args, env) {
  try {
    return execFileSync("node", [cliPath, ...args], {
      encoding: "utf-8",
      timeout: TIMEOUT,
      stdio: "pipe",
      env,
    });
  } catch (err) {
    // Capture whatever was written to stdout before non-zero exit
    return err.stdout ?? "";
  }
}

// ---------------------------------------------------------------------------
// Environment presets
// ---------------------------------------------------------------------------

/** Forces colors on — overrides NO_COLOR and isTTY=false. */
const colorEnv = () =>
  buildEnv({ FORCE_COLOR: "1", NO_COLOR: null });

/** Forces colors off via the no-color.org standard. */
const noColorEnv = () =>
  buildEnv({ NO_COLOR: "1", FORCE_COLOR: null });

/**
 * Neutral environment: no color-forcing variables.
 * When the process is spawned with stdio:"pipe", isTTY is false, so the
 * implementation falls back to the default of no colors.
 */
const pipedEnv = () =>
  buildEnv({ FORCE_COLOR: null, NO_COLOR: null });

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("CLI TTY-aware color emission", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await createTmpDir("ndx-color-e2e-");
    // rex status and sourcevision validate both need a project directory
    await Promise.all([
      setupRexDir(tmpDir),
      setupSourcevisionDir(tmpDir),
    ]);
  });

  afterEach(async () => {
    await removeTmpDir(tmpDir);
  });

  // ── FORCE_COLOR=1 — ANSI codes must be present ────────────────────────────

  describe("FORCE_COLOR=1 — ANSI escape codes are emitted", () => {
    it("rex status emits ANSI escape codes", () => {
      const out = spawnCLI(REX_CLI, ["status", tmpDir], colorEnv());
      expect(out).toMatch(ANSI_ESCAPE);
    });

    it("sourcevision validate emits ANSI escape codes", () => {
      const out = spawnCLI(SV_CLI, ["validate", tmpDir], colorEnv());
      expect(out).toMatch(ANSI_ESCAPE);
    });

    it("hench --help emits ANSI escape codes", () => {
      const out = spawnCLI(HENCH_CLI, ["--help"], colorEnv());
      expect(out).toMatch(ANSI_ESCAPE);
    });

    it("ndx help emits ANSI escape codes", () => {
      const out = spawnCLI(NDX_CLI, ["help"], colorEnv());
      expect(out).toMatch(ANSI_ESCAPE);
    });
  });

  // ── NO_COLOR=1 — ANSI codes must be absent ────────────────────────────────

  describe("NO_COLOR=1 — ANSI escape codes are suppressed", () => {
    it("rex status produces no ANSI escape codes", () => {
      const out = spawnCLI(REX_CLI, ["status", tmpDir], noColorEnv());
      expect(out).not.toMatch(ANSI_ESCAPE);
    });

    it("sourcevision validate produces no ANSI escape codes", () => {
      const out = spawnCLI(SV_CLI, ["validate", tmpDir], noColorEnv());
      expect(out).not.toMatch(ANSI_ESCAPE);
    });

    it("hench --help produces no ANSI escape codes", () => {
      const out = spawnCLI(HENCH_CLI, ["--help"], noColorEnv());
      expect(out).not.toMatch(ANSI_ESCAPE);
    });

    it("ndx help produces no ANSI escape codes", () => {
      const out = spawnCLI(NDX_CLI, ["help"], noColorEnv());
      expect(out).not.toMatch(ANSI_ESCAPE);
    });
  });

  // ── piped stdout (no TTY) — ANSI codes must be absent ────────────────────

  describe("piped stdout (no TTY) — ANSI escape codes are suppressed", () => {
    it("rex status produces no ANSI escape codes when piped", () => {
      const out = spawnCLI(REX_CLI, ["status", tmpDir], pipedEnv());
      expect(out).not.toMatch(ANSI_ESCAPE);
    });

    it("sourcevision validate produces no ANSI escape codes when piped", () => {
      const out = spawnCLI(SV_CLI, ["validate", tmpDir], pipedEnv());
      expect(out).not.toMatch(ANSI_ESCAPE);
    });

    it("hench --help produces no ANSI escape codes when piped", () => {
      const out = spawnCLI(HENCH_CLI, ["--help"], pipedEnv());
      expect(out).not.toMatch(ANSI_ESCAPE);
    });

    it("ndx help produces no ANSI escape codes when piped", () => {
      const out = spawnCLI(NDX_CLI, ["help"], pipedEnv());
      expect(out).not.toMatch(ANSI_ESCAPE);
    });
  });
});
