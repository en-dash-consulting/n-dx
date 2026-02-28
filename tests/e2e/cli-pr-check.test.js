import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const PR_CHECK_PATH = join(import.meta.dirname, "../../pr-check.js");

function runResult(args) {
  try {
    const stdout = execFileSync("node", [PR_CHECK_PATH, ...args], {
      encoding: "utf-8",
      timeout: 120000,
      stdio: "pipe",
    });
    return { stdout, stderr: "", code: 0 };
  } catch (err) {
    return { stdout: err.stdout || "", stderr: err.stderr || "", code: err.status };
  }
}

/**
 * Set up a minimal project with .rex dir,
 * enough for pr-check validate step to work.
 */
async function setupRex(dir) {
  await mkdir(join(dir, ".rex"), { recursive: true });
  await writeFile(
    join(dir, ".rex", "config.json"),
    JSON.stringify({
      schema: "rex/v1",
      project: "test-pr-check",
      adapter: "file",
      sourcevision: "auto",
    }),
  );
  await writeFile(
    join(dir, ".rex", "prd.json"),
    JSON.stringify({
      schema: "rex/v1",
      title: "Test PR Check",
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
          ],
        },
      ],
    }),
  );
}

/**
 * Create a minimal package.json so `pnpm build` has something to work with.
 */
async function setupBuildable(dir) {
  await writeFile(
    join(dir, "package.json"),
    JSON.stringify({
      name: "test-pr-check-project",
      private: true,
      scripts: {
        build: "echo build-ok",
      },
    }),
  );
}

describe("pr-check", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ndx-pr-check-e2e-"));
    await setupBuildable(tmpDir);
    await setupRex(tmpDir);
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── Basic execution ───────────────────────────────────────────────────────

  describe("pipeline execution", () => {
    it("exits 0 when build and validate both pass", () => {
      const { code } = runResult([tmpDir]);
      expect(code).toBe(0);
    });

    it("shows build step header", () => {
      const { stdout } = runResult([tmpDir]);
      expect(stdout).toContain("── build ──");
    });

    it("shows rex validate step header", () => {
      const { stdout } = runResult([tmpDir]);
      expect(stdout).toContain("── rex validate ──");
    });

    it("shows PR check passed message on success", () => {
      const { stdout } = runResult([tmpDir]);
      expect(stdout).toContain("PR check passed");
    });

    it("shows success checkmarks for passing steps", () => {
      const { stdout } = runResult([tmpDir]);
      expect(stdout).toContain("✓ build");
      expect(stdout).toContain("✓ rex validate");
    });
  });

  // ── Build failure ────────────────────────────────────────────────────────

  describe("build failure", () => {
    it("exits 1 when build fails", async () => {
      await writeFile(
        join(tmpDir, "package.json"),
        JSON.stringify({
          name: "test-pr-check-project",
          private: true,
          scripts: {
            build: "echo 'TS compilation error' && exit 1",
          },
        }),
      );

      const { code } = runResult([tmpDir]);
      expect(code).toBe(1);
    });

    it("shows failure mark for build step", async () => {
      await writeFile(
        join(tmpDir, "package.json"),
        JSON.stringify({
          name: "test-pr-check-project",
          private: true,
          scripts: {
            build: "echo 'TS compilation error' >&2 && exit 1",
          },
        }),
      );

      const { stdout } = runResult([tmpDir]);
      expect(stdout).toContain("✗ build");
    });

    it("shows PR check failed on build failure", async () => {
      await writeFile(
        join(tmpDir, "package.json"),
        JSON.stringify({
          name: "test-pr-check-project",
          private: true,
          scripts: {
            build: "exit 1",
          },
        }),
      );

      const { stdout } = runResult([tmpDir]);
      expect(stdout).toContain("PR check failed");
    });
  });

  // ── Rex validation failure ──────────────────────────────────────────────

  describe("rex validation failure", () => {
    it("exits 1 when rex validate fails (broken schema)", async () => {
      await writeFile(
        join(tmpDir, ".rex", "prd.json"),
        JSON.stringify({ invalid: true }),
      );

      const { code } = runResult([tmpDir]);
      expect(code).toBe(1);
    });

    it("exits 1 on orphaned items", async () => {
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

    it("shows failure mark for rex validate", async () => {
      await writeFile(
        join(tmpDir, ".rex", "prd.json"),
        JSON.stringify({ invalid: true }),
      );

      const { stdout } = runResult([tmpDir]);
      expect(stdout).toContain("✗ rex validate");
    });
  });

  // ── No .rex directory ───────────────────────────────────────────────────

  describe("no .rex directory", () => {
    it("still passes when .rex is absent (build-only)", async () => {
      await rm(join(tmpDir, ".rex"), { recursive: true, force: true });

      const { code } = runResult([tmpDir]);
      expect(code).toBe(0);
    });

    it("shows skipped for rex validate when no .rex", async () => {
      await rm(join(tmpDir, ".rex"), { recursive: true, force: true });

      const { stdout } = runResult([tmpDir]);
      expect(stdout).toContain("skipped");
    });
  });

  // ── JSON output ─────────────────────────────────────────────────────────

  describe("--format=json", () => {
    it("outputs valid JSON report", () => {
      const { stdout } = runResult(["--format=json", tmpDir]);
      const report = JSON.parse(stdout);
      expect(report).toHaveProperty("timestamp");
      expect(report).toHaveProperty("steps");
      expect(report).toHaveProperty("ok");
    });

    it("report includes build step", () => {
      const { stdout } = runResult(["--format=json", tmpDir]);
      const report = JSON.parse(stdout);
      const buildStep = report.steps.find((s) => s.name === "build");
      expect(buildStep).toBeDefined();
      expect(buildStep.ok).toBe(true);
    });

    it("report includes rex-validate step", () => {
      const { stdout } = runResult(["--format=json", tmpDir]);
      const report = JSON.parse(stdout);
      const valStep = report.steps.find((s) => s.name === "rex-validate");
      expect(valStep).toBeDefined();
      expect(valStep.ok).toBe(true);
    });

    it("overall ok is true when all steps pass", () => {
      const { stdout } = runResult(["--format=json", tmpDir]);
      const report = JSON.parse(stdout);
      expect(report.ok).toBe(true);
    });

    it("overall ok is false on build failure", async () => {
      await writeFile(
        join(tmpDir, "package.json"),
        JSON.stringify({
          name: "test-pr-check-project",
          private: true,
          scripts: { build: "exit 1" },
        }),
      );

      const { stdout } = runResult(["--format=json", tmpDir]);
      const report = JSON.parse(stdout);
      expect(report.ok).toBe(false);
      const buildStep = report.steps.find((s) => s.name === "build");
      expect(buildStep.ok).toBe(false);
    });

    it("overall ok is false on rex validate failure", async () => {
      await writeFile(
        join(tmpDir, ".rex", "prd.json"),
        JSON.stringify({ invalid: true }),
      );

      const { stdout } = runResult(["--format=json", tmpDir]);
      const report = JSON.parse(stdout);
      expect(report.ok).toBe(false);
    });

    it("includes timestamp in report", () => {
      const { stdout } = runResult(["--format=json", tmpDir]);
      const report = JSON.parse(stdout);
      expect(new Date(report.timestamp).getTime()).not.toBeNaN();
    });
  });

  // ── Quiet mode ──────────────────────────────────────────────────────────

  describe("--quiet flag", () => {
    it("suppresses text output", () => {
      const { stdout } = runResult(["--quiet", tmpDir]);
      expect(stdout).not.toContain("──");
    });

    it("-q is equivalent to --quiet", () => {
      const { stdout } = runResult(["-q", tmpDir]);
      expect(stdout).not.toContain("──");
    });

    it("JSON mode with quiet produces only JSON", () => {
      const { stdout } = runResult(["--format=json", "--quiet", tmpDir]);
      expect(() => JSON.parse(stdout)).not.toThrow();
      expect(stdout.trim().startsWith("{")).toBe(true);
    });
  });
});
