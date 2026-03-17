/**
 * CLI output format contract tests — validates that tool CLIs produce
 * expected output shapes.
 *
 * The orchestration layer (cli.js, ci.js) spawns domain tool CLIs and
 * parses their output. cli-contract.test.js verifies subcommands exist;
 * this file verifies their output formats are stable.
 *
 * If a tool changes its JSON schema or exit code convention, these tests
 * break — forcing an explicit update rather than a silent contract violation.
 *
 * @see tests/e2e/cli-contract.test.js — subcommand existence tests
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import {
  createTmpDir,
  removeTmpDir,
  setupRexDir,
  setupSourcevisionDir,
  CLI_PATH,
} from "./e2e-helpers.js";

/** Run an ndx command and return { stdout, stderr, code }. */
function runResult(args, opts = {}) {
  try {
    const stdout = execFileSync("node", [CLI_PATH, ...args], {
      encoding: "utf-8",
      timeout: 15000,
      stdio: "pipe",
      ...opts,
    });
    return { stdout, stderr: "", code: 0 };
  } catch (err) {
    return { stdout: err.stdout || "", stderr: err.stderr || "", code: err.status };
  }
}

describe("CLI output format contracts", () => {
  let tmpDir;

  beforeAll(async () => {
    tmpDir = await createTmpDir("ndx-output-");
    await setupRexDir(tmpDir);
    await setupSourcevisionDir(tmpDir);
  });

  afterAll(async () => {
    await removeTmpDir(tmpDir);
  });

  describe("rex status --format=json", () => {
    it("produces valid JSON PRD document with expected top-level keys", () => {
      const result = runResult(["rex", "status", "--format=json", tmpDir]);
      expect(result.code).toBe(0);

      const parsed = JSON.parse(result.stdout);
      expect(parsed).toHaveProperty("schema");
      expect(parsed).toHaveProperty("title");
      expect(parsed).toHaveProperty("items");
      expect(Array.isArray(parsed.items)).toBe(true);
      expect(parsed.schema).toMatch(/^rex\/v\d/);
    });
  });

  describe("rex validate", () => {
    it("exits 0 for a valid PRD", () => {
      const result = runResult(["rex", "validate", tmpDir]);
      expect(result.code).toBe(0);
    });
  });

  describe("sourcevision validate", () => {
    it("exits 0 for a fully analyzed project", () => {
      // Use the real project directory — the e2e fixture uses a simplified
      // schema that doesn't pass Zod validation. This test validates that
      // the CLI exits cleanly with a real analysis output.
      const root = join(import.meta.dirname, "../..");
      const result = runResult(["sourcevision", "validate", root]);
      expect(result.code).toBe(0);
    });
  });
});
