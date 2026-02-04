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
