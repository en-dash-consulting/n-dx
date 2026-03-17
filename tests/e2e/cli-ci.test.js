import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  run as runBase,
  runResult as runResultBase,
  createTmpDir,
  removeTmpDir,
  setupRexDir,
  setupSourcevisionDir,
} from "./e2e-helpers.js";

/** Wrap helpers to prepend "ci" subcommand. */
function run(args, opts = {}) {
  return runBase(["ci", ...args], { timeout: 30000, ...opts });
}

function runResult(args) {
  return runResultBase(["ci", ...args], { timeout: 30000 });
}

/**
 * Set up a minimal project with .sourcevision and .rex dirs,
 * enough for ci to validate against.
 */
async function setupProject(dir) {
  await setupSourcevisionDir(dir);
  await setupRexDir(dir, { project: "test-ci-project" });
  // CI step 0 checks community files — provide CODE_OF_CONDUCT.md
  await writeFile(join(dir, "CODE_OF_CONDUCT.md"), "# Code of Conduct\nBe kind.\n");
}

describe("n-dx ci", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await createTmpDir("ndx-ci-e2e-");
    await setupProject(tmpDir);
  });

  afterEach(async () => {
    await removeTmpDir(tmpDir);
  });

  // ── Basic execution ───────────────────────────────────────────────────────

  describe("pipeline execution", () => {
    it("runs the full ci pipeline and exits 0 on success", () => {
      const output = run(["--quiet", tmpDir], { stdio: "pipe" });
      // Should include some structured output even in quiet mode
      expect(output).toBeDefined();
    });

    it("shows analysis step in non-quiet mode", () => {
      const { stdout } = runResult([tmpDir]);
      expect(stdout).toContain("sourcevision");
    });

    it("shows validation step", () => {
      const { stdout } = runResult([tmpDir]);
      expect(stdout).toContain("validate");
    });

    it("shows status summary", () => {
      const { stdout } = runResult([tmpDir]);
      // Should mention completion stats
      expect(stdout).toMatch(/\d+.*complete/i);
    });
  });

  // ── JSON output ────────────────────────────────────────────────────────────

  describe("--format=json", () => {
    it("outputs valid JSON report", () => {
      const output = run(["--format=json", "--quiet", tmpDir], { stdio: "pipe" });
      const report = JSON.parse(output);
      expect(report).toHaveProperty("timestamp");
      expect(report).toHaveProperty("steps");
      expect(report).toHaveProperty("ok");
    });

    it("report includes sourcevision step", () => {
      const output = run(["--format=json", "--quiet", tmpDir], { stdio: "pipe" });
      const report = JSON.parse(output);
      const svStep = report.steps.find((s) => s.name === "sourcevision");
      expect(svStep).toBeDefined();
      expect(svStep.ok).toBe(true);
    });

    it("report includes validate step", () => {
      const output = run(["--format=json", "--quiet", tmpDir], { stdio: "pipe" });
      const report = JSON.parse(output);
      const valStep = report.steps.find((s) => s.name === "validate");
      expect(valStep).toBeDefined();
      expect(valStep.ok).toBe(true);
    });

    it("report includes status step with stats", () => {
      const output = run(["--format=json", "--quiet", tmpDir], { stdio: "pipe" });
      const report = JSON.parse(output);
      const statusStep = report.steps.find((s) => s.name === "status");
      expect(statusStep).toBeDefined();
      expect(statusStep.ok).toBe(true);
      expect(statusStep.data).toHaveProperty("total");
      expect(statusStep.data).toHaveProperty("completed");
    });

    it("report includes sourcevision-validate step", () => {
      const output = run(["--format=json", "--quiet", tmpDir], { stdio: "pipe" });
      const report = JSON.parse(output);
      const svValStep = report.steps.find((s) => s.name === "sourcevision-validate");
      expect(svValStep).toBeDefined();
      expect(svValStep.ok).toBe(true);
      expect(svValStep.detail).toBe("All modules valid");
    });

    it("validate step includes checks array", () => {
      const output = run(["--format=json", "--quiet", tmpDir], { stdio: "pipe" });
      const report = JSON.parse(output);
      const valStep = report.steps.find((s) => s.name === "validate");
      expect(valStep.checks).toBeDefined();
      expect(Array.isArray(valStep.checks)).toBe(true);
      expect(valStep.checks.length).toBeGreaterThan(0);
      // Each check should have name and pass properties
      for (const check of valStep.checks) {
        expect(check).toHaveProperty("name");
        expect(check).toHaveProperty("pass");
      }
    });

    it("status data includes all count fields", () => {
      const output = run(["--format=json", "--quiet", tmpDir], { stdio: "pipe" });
      const report = JSON.parse(output);
      const statusStep = report.steps.find((s) => s.name === "status");
      expect(statusStep.data).toHaveProperty("total");
      expect(statusStep.data).toHaveProperty("completed");
      expect(statusStep.data).toHaveProperty("inProgress");
      expect(statusStep.data).toHaveProperty("pending");
      expect(statusStep.data).toHaveProperty("deferred");
      expect(statusStep.data).toHaveProperty("blocked");
    });

    it("overall ok is true when all steps pass", () => {
      const output = run(["--format=json", "--quiet", tmpDir], { stdio: "pipe" });
      const report = JSON.parse(output);
      expect(report.ok).toBe(true);
    });
  });

  // ── Missing directories ────────────────────────────────────────────────────

  describe("missing project setup", () => {
    it("exits 1 when .rex is missing", async () => {
      const emptyDir = await mkdtemp(join(tmpdir(), "ndx-ci-empty-"));
      try {
        const { stderr, code } = runResult([emptyDir]);
        expect(code).toBe(1);
        expect(stderr).toContain("Missing");
      } finally {
        await rm(emptyDir, { recursive: true, force: true });
      }
    });

    it("returns structured JSON error when .rex is missing with --format=json", async () => {
      const emptyDir = await mkdtemp(join(tmpdir(), "ndx-ci-empty-"));
      try {
        // Create .sourcevision so only .rex is missing
        await mkdir(join(emptyDir, ".sourcevision"), { recursive: true });
        const { stdout, code } = runResult(["--format=json", emptyDir]);
        expect(code).toBe(1);
        const report = JSON.parse(stdout);
        expect(report.ok).toBe(false);
        expect(report.error).toMatch(/\.rex/);
      } finally {
        await rm(emptyDir, { recursive: true, force: true });
      }
    });

    it("returns structured JSON error when both dirs missing with --format=json", async () => {
      const emptyDir = await mkdtemp(join(tmpdir(), "ndx-ci-empty-"));
      try {
        const { stdout, code } = runResult(["--format=json", emptyDir]);
        expect(code).toBe(1);
        const report = JSON.parse(stdout);
        expect(report.ok).toBe(false);
        expect(report.error).toMatch(/\.rex/);
        expect(report.error).toMatch(/\.sourcevision/);
      } finally {
        await rm(emptyDir, { recursive: true, force: true });
      }
    });

    it("JSON error includes hint for missing setup", async () => {
      const emptyDir = await mkdtemp(join(tmpdir(), "ndx-ci-empty-"));
      try {
        await mkdir(join(emptyDir, ".sourcevision"), { recursive: true });
        const { stdout, code } = runResult(["--format=json", emptyDir]);
        expect(code).toBe(1);
        const report = JSON.parse(stdout);
        expect(report.hint).toContain("ndx init");
      } finally {
        await rm(emptyDir, { recursive: true, force: true });
      }
    });

    it("includes timestamp in JSON error report", async () => {
      const emptyDir = await mkdtemp(join(tmpdir(), "ndx-ci-empty-"));
      try {
        await mkdir(join(emptyDir, ".sourcevision"), { recursive: true });
        const { stdout } = runResult(["--format=json", emptyDir]);
        const report = JSON.parse(stdout);
        expect(report.timestamp).toBeDefined();
        expect(new Date(report.timestamp).getTime()).not.toBeNaN();
      } finally {
        await rm(emptyDir, { recursive: true, force: true });
      }
    });

    it("text mode still shows clear error when .rex is missing", async () => {
      const emptyDir = await mkdtemp(join(tmpdir(), "ndx-ci-empty-"));
      try {
        const { stderr, code } = runResult([emptyDir]);
        expect(code).toBe(1);
        expect(stderr).toContain("Missing");
        expect(stderr).toMatch(/ndx init/);
      } finally {
        await rm(emptyDir, { recursive: true, force: true });
      }
    });
  });

  // ── Validation failure ─────────────────────────────────────────────────────

  describe("validation failure", () => {
    it("exits non-zero when rex validate fails", async () => {
      // Break the PRD schema
      await writeFile(
        join(tmpDir, ".rex", "prd.json"),
        JSON.stringify({ invalid: true }),
      );

      const { code } = runResult([tmpDir]);
      expect(code).toBe(1);
    });

    it("JSON report shows failed step", async () => {
      await writeFile(
        join(tmpDir, ".rex", "prd.json"),
        JSON.stringify({ invalid: true }),
      );

      const { stdout, code } = runResult(["--format=json", "--quiet", tmpDir]);
      expect(code).toBe(1);
      // Should still produce valid JSON even on failure
      const report = JSON.parse(stdout);
      expect(report.ok).toBe(false);
      const valStep = report.steps.find((s) => s.name === "validate");
      expect(valStep.ok).toBe(false);
    });

    it("exits 1 on orphaned items", async () => {
      // Subtask at root is an orphan — subtasks must be under task
      await writeFile(
        join(tmpDir, ".rex", "prd.json"),
        JSON.stringify({
          schema: "rex/v1",
          title: "Test",
          items: [
            {
              id: "sub1",
              title: "Orphan Subtask",
              level: "subtask",
              status: "pending",
            },
          ],
        }),
      );

      const { code } = runResult([tmpDir]);
      expect(code).toBe(1);
    });

    it("JSON report shows orphaned items as failed check", async () => {
      await writeFile(
        join(tmpDir, ".rex", "prd.json"),
        JSON.stringify({
          schema: "rex/v1",
          title: "Test",
          items: [
            {
              id: "sub1",
              title: "Orphan Subtask",
              level: "subtask",
              status: "pending",
            },
          ],
        }),
      );

      const { stdout, code } = runResult(["--format=json", "--quiet", tmpDir]);
      expect(code).toBe(1);
      const report = JSON.parse(stdout);
      expect(report.ok).toBe(false);
      // The validate step should show the hierarchy placement failure
      const valStep = report.steps.find((s) => s.name === "validate");
      expect(valStep.ok).toBe(false);
    });

    it("includes check details for failed validations", async () => {
      await writeFile(
        join(tmpDir, ".rex", "prd.json"),
        JSON.stringify({
          schema: "rex/v1",
          title: "Test",
          items: [
            {
              id: "sub1",
              title: "Orphan Subtask",
              level: "subtask",
              status: "pending",
            },
          ],
        }),
      );

      const { stdout } = runResult(["--format=json", "--quiet", tmpDir]);
      const report = JSON.parse(stdout);
      const valStep = report.steps.find((s) => s.name === "validate");
      // Should have checks with at least one failure
      const failedCheck = valStep.checks.find((c) => !c.pass);
      expect(failedCheck).toBeDefined();
      expect(failedCheck.errors.length).toBeGreaterThan(0);
    });
  });

  // ── Sourcevision validation failure ─────────────────────────────────────────

  describe("sourcevision validation failure", () => {
    it("exits 1 when sourcevision data is invalid", async () => {
      // Break the inventory schema
      await writeFile(
        join(tmpDir, ".sourcevision", "inventory.json"),
        JSON.stringify({ invalid: true }),
      );

      const { code } = runResult([tmpDir]);
      expect(code).toBe(1);
    });

    it("JSON report shows sourcevision-validate failure", async () => {
      await writeFile(
        join(tmpDir, ".sourcevision", "inventory.json"),
        JSON.stringify({ invalid: true }),
      );

      const { stdout, code } = runResult(["--format=json", "--quiet", tmpDir]);
      expect(code).toBe(1);
      const report = JSON.parse(stdout);
      expect(report.ok).toBe(false);
      const svValStep = report.steps.find((s) => s.name === "sourcevision-validate");
      expect(svValStep.ok).toBe(false);
    });
  });

  // ── Quiet mode ──────────────────────────────────────────────────────────────

  describe("--quiet flag", () => {
    it("suppresses text output in quiet mode", () => {
      const output = run(["--quiet", tmpDir], { stdio: "pipe" });
      // Quiet mode without --format=json should produce minimal output
      // Should NOT contain step headers like "── sourcevision analyze ──"
      expect(output).not.toContain("──");
    });

    it("-q is equivalent to --quiet", () => {
      const output = run(["-q", tmpDir], { stdio: "pipe" });
      expect(output).not.toContain("──");
    });

    it("JSON mode with quiet produces only JSON", () => {
      const output = run(["--format=json", "--quiet", tmpDir], { stdio: "pipe" });
      // Should be valid JSON with no extra text
      expect(() => JSON.parse(output)).not.toThrow();
      // First non-whitespace character should be {
      expect(output.trim().startsWith("{")).toBe(true);
    });
  });

  // ── Text output formatting ──────────────────────────────────────────────────

  describe("text output", () => {
    it("shows step headers", () => {
      const { stdout } = runResult([tmpDir]);
      expect(stdout).toContain("── sourcevision analyze ──");
      expect(stdout).toContain("── sourcevision validate ──");
      expect(stdout).toContain("── rex validate ──");
      expect(stdout).toContain("── rex status ──");
    });

    it("shows success checkmarks for passing steps", () => {
      const { stdout } = runResult([tmpDir]);
      expect(stdout).toContain("✓ sourcevision analyze");
      expect(stdout).toContain("✓ sourcevision validate");
      expect(stdout).toContain("✓ rex validate");
    });

    it("shows completion percentage", () => {
      const { stdout } = runResult([tmpDir]);
      expect(stdout).toMatch(/\d+% complete/);
    });

    it("shows pipeline passed message on success", () => {
      const { stdout } = runResult([tmpDir]);
      expect(stdout).toContain("CI pipeline passed");
    });

    it("shows pipeline failed message on failure", async () => {
      await writeFile(
        join(tmpDir, ".rex", "prd.json"),
        JSON.stringify({ invalid: true }),
      );

      const { stdout } = runResult([tmpDir]);
      expect(stdout).toContain("CI pipeline failed");
    });

    it("shows failure marks for failing steps", async () => {
      await writeFile(
        join(tmpDir, ".rex", "prd.json"),
        JSON.stringify({ invalid: true }),
      );

      const { stdout } = runResult([tmpDir]);
      expect(stdout).toContain("✗ rex validate");
    });
  });

  // ── Help text ──────────────────────────────────────────────────────────────

  describe("help text", () => {
    it("shows ci in the main help", () => {
      const output = runBase([]);
      expect(output).toContain("ci");
    });
  });
});
