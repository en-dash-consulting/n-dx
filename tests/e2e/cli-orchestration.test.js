import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const CLI_PATH = join(import.meta.dirname, "../../packages/core/cli.js");

/**
 * Run an ndx command, returning { stdout, stderr, code }.
 * Never throws — captures exit code on failure.
 */
function runResult(args) {
  try {
    const stdout = execFileSync("node", [CLI_PATH, ...args], {
      encoding: "utf-8",
      timeout: 15000,
      stdio: "pipe",
    });
    return { stdout, stderr: "", code: 0 };
  } catch (err) {
    return { stdout: err.stdout || "", stderr: err.stderr || "", code: err.status };
  }
}

/**
 * Minimal .rex directory with a valid PRD containing known items.
 */
async function setupRexDir(dir) {
  await mkdir(join(dir, ".rex"), { recursive: true });
  await writeFile(
    join(dir, ".rex", "config.json"),
    JSON.stringify({
      schema: "rex/v1",
      project: "orch-test",
      adapter: "file",
      sourcevision: "auto",
    }),
  );
  await writeFile(
    join(dir, ".rex", "prd.json"),
    JSON.stringify({
      schema: "rex/v1",
      title: "Orchestration Test",
      items: [
        {
          id: "e1",
          level: "epic",
          title: "Epic One",
          status: "pending",
          priority: "high",
          children: [
            { id: "t1", level: "task", title: "Task A", status: "completed", priority: "medium" },
            { id: "t2", level: "task", title: "Task B", status: "pending", priority: "low" },
          ],
        },
      ],
    }),
  );
}

/**
 * Minimal .hench directory with valid config.
 */
async function setupHenchDir(dir) {
  await mkdir(join(dir, ".hench"), { recursive: true });
  await writeFile(
    join(dir, ".hench", "config.json"),
    JSON.stringify({
      schema: "hench/v1",
      provider: "cli",
      model: "sonnet",
      maxTurns: 50,
      maxTokens: 8192,
      rexDir: ".rex",
      apiKeyEnv: "ANTHROPIC_API_KEY",
      guard: {
        blockedPaths: [".hench/**", ".rex/**", ".git/**"],
        allowedCommands: ["npm", "node", "git"],
        commandTimeout: 30000,
        maxFileSize: 1048576,
      },
    }),
  );
}

/**
 * Minimal .sourcevision directory with valid analysis output.
 */
async function setupSourcevisionDir(dir) {
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
    JSON.stringify({ edges: [], external: {}, summary: { totalEdges: 0, totalExternal: 0 } }),
  );
  await writeFile(
    join(dir, ".sourcevision", "zones.json"),
    JSON.stringify({ zones: [], crossings: [], unzoned: [], summary: { totalZones: 0, totalFiles: 0 } }),
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
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("orchestration script integration", () => {
  let tmpDir;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "ndx-orch-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── ndx status ────────────────────────────────────────────────────────────

  describe("ndx status", () => {
    it("requires .rex directory", () => {
      const { stderr, code } = runResult(["status", tmpDir]);
      expect(code).toBe(1);
      expect(stderr).toContain("Missing");
      expect(stderr).toContain(".rex");
      expect(stderr).toContain("ndx init");
    });

    it("delegates to rex status and returns JSON output", async () => {
      await setupRexDir(tmpDir);
      const { stdout, code } = runResult(["status", "--format=json", tmpDir]);
      expect(code).toBe(0);
      const data = JSON.parse(stdout);
      expect(data.schema).toBe("rex/v1");
      expect(data.items).toBeDefined();
      expect(data.items.length).toBeGreaterThan(0);
    });

    it("passes --format=json flag through to rex", async () => {
      await setupRexDir(tmpDir);
      const { stdout, code } = runResult(["status", "--format=json", tmpDir]);
      expect(code).toBe(0);
      // Should be valid JSON (not text tree output)
      expect(() => JSON.parse(stdout)).not.toThrow();
    });

    it("produces text output by default", async () => {
      await setupRexDir(tmpDir);
      const { stdout, code } = runResult(["status", tmpDir]);
      expect(code).toBe(0);
      // Text output contains the PRD title or task titles
      expect(stdout).toContain("Orchestration Test");
    });

    it("reflects PRD item statuses in output", async () => {
      await setupRexDir(tmpDir);
      const { stdout } = runResult(["status", "--format=json", tmpDir]);
      const data = JSON.parse(stdout);
      const epic = data.items.find((i) => i.id === "e1");
      expect(epic).toBeDefined();
      expect(epic.children.length).toBe(2);
      const completed = epic.children.find((c) => c.id === "t1");
      expect(completed.status).toBe("completed");
    });
  });

  // ── ndx usage ─────────────────────────────────────────────────────────────

  describe("ndx usage", () => {
    it("requires .rex directory", () => {
      const { stderr, code } = runResult(["usage", tmpDir]);
      expect(code).toBe(1);
      expect(stderr).toContain(".rex");
    });

    it("delegates to rex usage and succeeds with empty usage", async () => {
      await setupRexDir(tmpDir);
      const { stdout, code } = runResult(["usage", tmpDir]);
      expect(code).toBe(0);
      // With no execution log, should report no usage
      expect(stdout).toMatch(/none|no.*recorded|0/i);
    });

    it("passes --format=json flag through to rex usage", async () => {
      await setupRexDir(tmpDir);
      const { stdout, code } = runResult(["usage", "--format=json", tmpDir]);
      expect(code).toBe(0);
      const data = JSON.parse(stdout);
      // JSON output should have a recognizable structure
      expect(data).toBeDefined();
    });
  });

  // ── ndx sync ──────────────────────────────────────────────────────────────

  describe("ndx sync", () => {
    it("requires .rex directory", () => {
      const { stderr, code } = runResult(["sync", tmpDir]);
      expect(code).toBe(1);
      expect(stderr).toContain(".rex");
    });

    it("delegates to rex sync (fails gracefully without adapter)", async () => {
      await setupRexDir(tmpDir);
      const { stderr, code } = runResult(["sync", tmpDir]);
      // sync requires a remote adapter; with file adapter it should exit non-zero
      expect(code).not.toBe(0);
      expect(stderr).toContain("adapter");
    });
  });

  // ── ndx plan ──────────────────────────────────────────────────────────────

  describe("ndx plan", () => {
    it("requires .rex directory", () => {
      const { stderr, code } = runResult(["plan", tmpDir]);
      expect(code).toBe(1);
      expect(stderr).toContain(".rex");
    });

    it("shows help with --help flag", () => {
      const { stdout, code } = runResult(["plan", "--help"]);
      expect(code).toBe(0);
      expect(stdout.toLowerCase()).toContain("plan");
    });
  });

  // ── ndx work ──────────────────────────────────────────────────────────────

  describe("ndx work", () => {
    it("requires .rex directory", () => {
      const { stderr, code } = runResult(["work", tmpDir]);
      expect(code).toBe(1);
      expect(stderr).toContain(".rex");
    });

    it("requires .hench directory", async () => {
      await setupRexDir(tmpDir);
      const { stderr, code } = runResult(["work", tmpDir]);
      expect(code).toBe(1);
      expect(stderr).toContain(".hench");
    });

    it("requires LLM vendor configuration for non-dry-run", async () => {
      await setupRexDir(tmpDir);
      await setupHenchDir(tmpDir);
      const { stderr, code } = runResult(["work", tmpDir]);
      expect(code).toBe(1);
      expect(stderr).toContain("No LLM vendor configured");
      expect(stderr).toContain("ndx config llm.vendor");
    });

    it("skips vendor check for --dry-run", async () => {
      await setupRexDir(tmpDir);
      await setupHenchDir(tmpDir);
      // --dry-run should bypass vendor check and delegate to hench run --dry-run
      const { stdout, code } = runResult(["work", "--dry-run", tmpDir]);
      expect(code).toBe(0);
      // hench dry-run should show the task brief
      expect(stdout).toContain("Task");
    });

    it("delegates to hench run with flags", async () => {
      await setupRexDir(tmpDir);
      await setupHenchDir(tmpDir);
      // --dry-run is passed through to hench run
      const { stdout } = runResult(["work", "--dry-run", tmpDir]);
      // Dry run output includes the system prompt and task info
      expect(stdout).toContain("Dry Run");
    });

    it("passes --task flag through to hench", async () => {
      await setupRexDir(tmpDir);
      await setupHenchDir(tmpDir);
      // Use a non-existent task ID — should fail with clear error from hench
      const { code, stderr } = runResult(["work", "--dry-run", "--task=nonexistent-id", tmpDir]);
      // hench should report no such task
      expect(code).not.toBe(0);
      expect(stderr).toMatch(/not found|no.*task|invalid/i);
    });
  });

  // ── ndx ci ────────────────────────────────────────────────────────────────

  describe("ndx ci (command construction)", () => {
    it("requires .rex and .sourcevision directories in text mode", () => {
      const { stderr, code } = runResult(["ci", tmpDir]);
      expect(code).toBe(1);
      expect(stderr).toContain("Missing");
    });

    it("invokes sourcevision analyze, sourcevision validate, rex validate, and rex status", async () => {
      await setupRexDir(tmpDir);
      await setupSourcevisionDir(tmpDir);
      const { stdout, code } = runResult(["ci", "--format=json", tmpDir]);
      const report = JSON.parse(stdout);
      // Should have all expected pipeline steps
      const stepNames = report.steps.map((s) => s.name);
      expect(stepNames).toContain("sourcevision");
      expect(stepNames).toContain("sourcevision-validate");
      expect(stepNames).toContain("zone-health");
      expect(stepNames).toContain("validate");
      expect(stepNames).toContain("status");
    });
  });

  // ── Tool delegation ───────────────────────────────────────────────────────

  describe("tool delegation paths", () => {
    it("delegates rex subcommands to rex CLI", () => {
      const { stdout, code } = runResult(["rex", "--help"]);
      expect(code).toBe(0);
      expect(stdout).toContain("rex");
      expect(stdout).toContain("PRD management");
    });

    it("delegates sourcevision subcommands to sourcevision CLI", () => {
      const { stdout, code } = runResult(["sourcevision", "--help"]);
      expect(code).toBe(0);
      expect(stdout).toContain("sourcevision");
    });

    it("delegates hench subcommands to hench CLI", () => {
      const { stdout, code } = runResult(["hench", "--help"]);
      expect(code).toBe(0);
      expect(stdout).toContain("hench");
    });

    it("resolves tool paths from package.json bin fields", () => {
      // All three tools should resolve and respond to --help without errors
      for (const tool of ["rex", "sourcevision", "hench"]) {
        const { code } = runResult([tool, "--help"]);
        expect(code).toBe(0);
      }
    });
  });

  // ── Cross-cutting: flag passthrough ────────────────────────────────────────

  describe("flag passthrough", () => {
    it("passes --quiet flag to underlying tools", async () => {
      await setupRexDir(tmpDir);
      const { stdout: quietOut } = runResult(["status", "--quiet", tmpDir]);
      const { stdout: normalOut } = runResult(["status", tmpDir]);
      // Quiet output should be shorter or equal
      expect(quietOut.length).toBeLessThanOrEqual(normalOut.length);
    });

    it("passes directory argument as last positional arg", async () => {
      await setupRexDir(tmpDir);
      // dir can appear before or after flags
      const r1 = runResult(["status", "--format=json", tmpDir]);
      const r2 = runResult(["status", tmpDir, "--format=json"]);
      expect(r1.code).toBe(0);
      expect(r2.code).toBe(0);
      // Both should produce equivalent JSON
      expect(JSON.parse(r1.stdout).title).toBe(JSON.parse(r2.stdout).title);
    });
  });

  // ── Per-command --help ─────────────────────────────────────────────────────

  describe("per-command --help", () => {
    const orchestratorCommands = ["plan", "status", "work", "usage", "sync", "ci", "init", "refresh", "start", "dev"];

    for (const cmd of orchestratorCommands) {
      it(`'ndx ${cmd} --help' shows command-specific help`, () => {
        const { stdout, code } = runResult([cmd, "--help"]);
        expect(code).toBe(0);
        expect(stdout.length).toBeGreaterThan(10);
        // Should contain the command name
        expect(stdout.toLowerCase()).toContain(cmd);
      });
    }
  });
});
