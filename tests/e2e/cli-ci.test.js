import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const CLI_PATH = join(import.meta.dirname, "../../cli.js");

function run(args, opts = {}) {
  return execFileSync("node", [CLI_PATH, "ci", ...args], {
    encoding: "utf-8",
    timeout: 30000,
    ...opts,
  });
}

function runResult(args) {
  try {
    const stdout = execFileSync("node", [CLI_PATH, "ci", ...args], {
      encoding: "utf-8",
      timeout: 30000,
      stdio: "pipe",
    });
    return { stdout, code: 0 };
  } catch (err) {
    return { stdout: err.stdout || "", stderr: err.stderr || "", code: err.status };
  }
}

/**
 * Set up a minimal project with .sourcevision and .rex dirs,
 * enough for ci to validate against.
 */
async function setupProject(dir) {
  // .sourcevision with valid data files
  await mkdir(join(dir, ".sourcevision"), { recursive: true });
  await writeFile(
    join(dir, ".sourcevision", "manifest.json"),
    JSON.stringify({
      schemaVersion: "1.0.0",
      toolVersion: "0.1.0",
      analyzedAt: new Date().toISOString(),
      targetPath: dir,
      modules: {
        inventory: { status: "complete", lastRun: new Date().toISOString() },
        imports: { status: "complete", lastRun: new Date().toISOString() },
        zones: { status: "complete", lastRun: new Date().toISOString() },
        components: { status: "complete", lastRun: new Date().toISOString() },
      },
    }),
  );
  await writeFile(
    join(dir, ".sourcevision", "inventory.json"),
    JSON.stringify({ files: [], summary: { totalFiles: 0, totalBytes: 0, languages: {} } }),
  );
  await writeFile(
    join(dir, ".sourcevision", "imports.json"),
    JSON.stringify({
      edges: [],
      external: {},
      summary: { totalEdges: 0, totalExternal: 0 },
    }),
  );
  await writeFile(
    join(dir, ".sourcevision", "zones.json"),
    JSON.stringify({
      zones: [],
      crossings: [],
      unzoned: [],
      summary: { totalZones: 0, totalFiles: 0 },
    }),
  );
  await writeFile(
    join(dir, ".sourcevision", "components.json"),
    JSON.stringify({
      components: [],
      routeModules: [],
      usageEdges: [],
      summary: { totalComponents: 0, totalRouteModules: 0, totalUsageEdges: 0 },
    }),
  );

  // .rex with valid config and minimal PRD
  await mkdir(join(dir, ".rex"), { recursive: true });
  await writeFile(
    join(dir, ".rex", "config.json"),
    JSON.stringify({
      schema: "rex/v1",
      project: "test-ci-project",
      adapter: "file",
      sourcevision: "auto",
    }),
  );
  await writeFile(
    join(dir, ".rex", "prd.json"),
    JSON.stringify({
      schema: "rex/v1",
      title: "Test CI Project",
      items: [
        {
          id: "epic-1",
          level: "epic",
          title: "Test Epic",
          status: "pending",
          priority: "medium",
          children: [
            {
              id: "task-1",
              level: "task",
              title: "Test Task",
              status: "completed",
              priority: "medium",
            },
            {
              id: "task-2",
              level: "task",
              title: "Another Task",
              status: "pending",
              priority: "low",
            },
          ],
        },
      ],
    }),
  );
}

describe("n-dx ci", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ndx-ci-e2e-"));
    await setupProject(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
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
    it("errors when .rex is missing", async () => {
      const emptyDir = await mkdtemp(join(tmpdir(), "ndx-ci-empty-"));
      try {
        const { stderr, code } = runResult([emptyDir]);
        expect(code).not.toBe(0);
        expect(stderr).toContain("Missing");
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
      expect(code).not.toBe(0);
    });

    it("JSON report shows failed step", async () => {
      await writeFile(
        join(tmpDir, ".rex", "prd.json"),
        JSON.stringify({ invalid: true }),
      );

      const { stdout, code } = runResult(["--format=json", "--quiet", tmpDir]);
      expect(code).not.toBe(0);
      // Should still produce valid JSON even on failure
      const report = JSON.parse(stdout);
      expect(report.ok).toBe(false);
      const valStep = report.steps.find((s) => s.name === "validate");
      expect(valStep.ok).toBe(false);
    });

    it("exits non-zero on orphaned items", async () => {
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
      expect(code).not.toBe(0);
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
      expect(code).not.toBe(0);
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
    it("exits non-zero when sourcevision data is invalid", async () => {
      // Break the inventory schema
      await writeFile(
        join(tmpDir, ".sourcevision", "inventory.json"),
        JSON.stringify({ invalid: true }),
      );

      const { code } = runResult([tmpDir]);
      expect(code).not.toBe(0);
    });

    it("JSON report shows sourcevision-validate failure", async () => {
      await writeFile(
        join(tmpDir, ".sourcevision", "inventory.json"),
        JSON.stringify({ invalid: true }),
      );

      const { stdout, code } = runResult(["--format=json", "--quiet", tmpDir]);
      expect(code).not.toBe(0);
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
      const output = execFileSync("node", [CLI_PATH], {
        encoding: "utf-8",
        timeout: 10000,
        stdio: "pipe",
      });
      expect(output).toContain("ci");
    });
  });
});
