import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import {
  run as runBase,
  runResult as runResultBase,
  createTmpDir,
  removeTmpDir,
  setupRexDir,
  setupSourcevisionDir,
} from "./e2e-helpers.js";

/**
 * Every `ndx ci` run here spawns sourcevision analyze, sourcevision validate,
 * rex validate, rex health and rex status: about three seconds on a developer
 * machine and six on the Windows CI runner. This file used to run it once per
 * test against a fixture rebuilt per test — 47 spawns for 42 tests, 255 s on
 * the Windows leg (run 38193308009), the longest file in the monorepo and the
 * floor of the root suite's wall time.
 *
 * So each describe below builds its fixture state once in `beforeAll`, runs
 * every argv the group's tests need once, and the tests assert on the captured
 * results. One `it` per contract is kept on purpose: a failure still names the
 * exact field or line that broke, not "the JSON group". Groups are organised by
 * fixture STATE, because that is what a run is a function of: a test that
 * needs a broken PRD lives with the broken-PRD run, whatever it asserts.
 */

/** Wrap helpers to prepend "ci" subcommand. */
function run(args, opts = {}) {
  return runBase(["ci", ...args], { timeout: 30000, ...opts });
}

function runResult(args) {
  return runResultBase(["ci", ...args], { timeout: 30000 });
}

/**
 * Parse an `ndx ci --format=json` run, or fail saying which run and why.
 *
 * These parses happen in `beforeAll`, so a run that crashed or timed out gives
 * an empty stdout and every test in the block fails with "Unexpected end of
 * JSON input" — naming neither the case nor the reason. The argv, exit code
 * and stderr are what identify it.
 */
function parseReport(result, args) {
  try {
    return JSON.parse(result.stdout);
  } catch (err) {
    throw new Error(
      [
        `ndx ci ${args.join(" ")} produced no parseable JSON (exit ${result.code}).`,
        `parse error: ${err.message}`,
        `stdout: ${result.stdout ? JSON.stringify(result.stdout.slice(0, 400)) : "(empty)"}`,
        `stderr: ${result.stderr ? result.stderr.slice(0, 1200) : "(empty)"}`,
      ].join("\n"),
    );
  }
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

/** A fresh project fixture; the caller removes it in afterAll. */
async function freshProject(prefix = "ndx-ci-e2e-") {
  const dir = await createTmpDir(prefix);
  await setupProject(dir);
  return dir;
}

const ORPHAN_PRD = JSON.stringify({
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
});

describe("n-dx ci", () => {
  // ── A healthy project: every passing-path argv, run once each ──────────────

  describe("on a healthy project", () => {
    let tmpDir;
    /** `ndx ci <dir>` */
    let text;
    /** `ndx ci --quiet <dir>` and `-q` */
    let quiet;
    let shortQuiet;
    /** `ndx ci --format=json --quiet <dir>`, raw and parsed */
    let json;
    let report;

    beforeAll(async () => {
      tmpDir = await freshProject();
      text = runResult([tmpDir]);
      quiet = runResult(["--quiet", tmpDir]);
      shortQuiet = runResult(["-q", tmpDir]);
      json = runResult(["--format=json", "--quiet", tmpDir]);
      report = parseReport(json, ["--format=json", "--quiet", tmpDir]);
    });

    afterAll(async () => {
      await removeTmpDir(tmpDir);
    });

    describe("pipeline execution", () => {
      it("runs the full ci pipeline and exits 0 on success", () => {
        expect(quiet.code).toBe(0);
        // Should include some structured output even in quiet mode
        expect(quiet.stdout).toBeDefined();
      });

      it("shows analysis step in non-quiet mode", () => {
        expect(text.stdout).toContain("sourcevision");
      });

      it("shows validation step", () => {
        expect(text.stdout).toContain("validate");
      });

      it("shows status summary", () => {
        // Should mention completion stats
        expect(text.stdout).toMatch(/\d+.*complete/i);
      });
    });

    describe("--format=json", () => {
      it("outputs valid JSON report", () => {
        expect(json.code).toBe(0);
        expect(report).toHaveProperty("timestamp");
        expect(report).toHaveProperty("steps");
        expect(report).toHaveProperty("ok");
      });

      it("report includes sourcevision step", () => {
        const svStep = report.steps.find((s) => s.name === "sourcevision");
        expect(svStep).toBeDefined();
        expect(svStep.ok).toBe(true);
      });

      it("report includes validate step", () => {
        const valStep = report.steps.find((s) => s.name === "validate");
        expect(valStep).toBeDefined();
        expect(valStep.ok).toBe(true);
      });

      it("report includes status step with stats", () => {
        const statusStep = report.steps.find((s) => s.name === "status");
        expect(statusStep).toBeDefined();
        expect(statusStep.ok).toBe(true);
        expect(statusStep.data).toHaveProperty("total");
        expect(statusStep.data).toHaveProperty("completed");
      });

      it("report includes sourcevision-validate step", () => {
        const svValStep = report.steps.find((s) => s.name === "sourcevision-validate");
        expect(svValStep).toBeDefined();
        expect(svValStep.ok).toBe(true);
        expect(svValStep.detail).toBe("All modules valid");
      });

      it("validate step includes checks array", () => {
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
        const statusStep = report.steps.find((s) => s.name === "status");
        expect(statusStep.data).toHaveProperty("total");
        expect(statusStep.data).toHaveProperty("completed");
        expect(statusStep.data).toHaveProperty("inProgress");
        expect(statusStep.data).toHaveProperty("pending");
        expect(statusStep.data).toHaveProperty("deferred");
        expect(statusStep.data).toHaveProperty("blocked");
      });

      it("overall ok is true when all steps pass", () => {
        expect(report.ok).toBe(true);
      });
    });

    describe("--quiet flag", () => {
      it("suppresses text output in quiet mode", () => {
        // Quiet mode without --format=json should produce minimal output
        // Should NOT contain step headers like "── sourcevision analyze ──"
        expect(quiet.code).toBe(0);
        expect(quiet.stdout).not.toContain("──");
      });

      it("-q is equivalent to --quiet", () => {
        expect(shortQuiet.code).toBe(0);
        expect(shortQuiet.stdout).not.toContain("──");
      });

      it("JSON mode with quiet produces only JSON", () => {
        // Should be valid JSON with no extra text
        expect(() => JSON.parse(json.stdout)).not.toThrow();
        // First non-whitespace character should be {
        expect(json.stdout.trim().startsWith("{")).toBe(true);
      });
    });

    describe("text output", () => {
      it("shows step headers", () => {
        expect(text.stdout).toContain("── sourcevision analyze ──");
        expect(text.stdout).toContain("── sourcevision validate ──");
        expect(text.stdout).toContain("── rex validate ──");
        expect(text.stdout).toContain("── rex status ──");
      });

      it("shows success checkmarks for passing steps", () => {
        expect(text.stdout).toContain("✓ sourcevision analyze");
        expect(text.stdout).toContain("✓ sourcevision validate");
        expect(text.stdout).toContain("✓ rex validate");
      });

      it("shows completion percentage", () => {
        expect(text.stdout).toMatch(/\d+% complete/);
      });

      it("shows pipeline passed message on success", () => {
        expect(text.stdout).toContain("CI pipeline passed");
      });
    });
  });

  describe("architecture policy scope", () => {
    let tmpDir;
    let report;

    beforeAll(async () => {
      tmpDir = await freshProject();
      await mkdir(join(tmpDir, "scripts"), { recursive: true });
      await writeFile(
        join(tmpDir, "scripts", "release.js"),
        'import { execFileSync } from "node:child_process";\nexecFileSync("true");\n',
      );
      report = parseReport(
        runResult(["--format=json", "--quiet", tmpDir]),
        ["--format=json", "--quiet", tmpDir],
      );
    });

    afterAll(async () => {
      await removeTmpDir(tmpDir);
    });

    it("does not fail a user project that imports child_process", () => {
      const arch = report.steps.find((s) => s.name === "architecture-policy");
      expect(arch.ok).toBe(true);
      expect(arch.violations).toBeUndefined();
    });

    it("reports the step as skipped when no ci.restrictedImports rule is configured", () => {
      const arch = report.steps.find((s) => s.name === "architecture-policy");
      expect(arch.detail).toMatch(/^skipped \(no ci\.restrictedImports configured\)/);
    });
  });

  // ── Restricted imports: a user project opting in through .n-dx.json ────────

  describe("restricted-imports opt-in", () => {
    const RELEASE_SCRIPT = 'import { execFileSync } from "node:child_process";\nexecFileSync("true");\n';
    // A configured rule behind a trailing comma: the rule must not silently vanish.
    const UNPARSEABLE_CONFIG =
      '{ "ci": { "restrictedImports": [{ "module": "node:child_process", "allow": [] }] }, }\n';

    /** Write the shared config with one child_process rule allowing `allow`. */
    async function configure(dir, allow) {
      await writeFile(
        join(dir, ".n-dx.json"),
        JSON.stringify({ ci: { restrictedImports: [{ module: "node:child_process", allow }] } }) + "\n",
      );
    }

    /** `git` in `dir` with a throwaway identity. */
    function git(dir, args) {
      execFileSync("git", ["-c", "user.email=ci@test", "-c", "user.name=ci", ...args], { cwd: dir, stdio: "pipe" });
    }

    /**
     * A git repo whose allowed wrapper src/lib/exec.ts is committed. With
     * `trackRelease`, scripts/release.js is committed too; otherwise it stays
     * an untracked, non-ignored file.
     */
    async function gitProject(dir, { trackRelease }) {
      await mkdir(join(dir, "src", "lib"), { recursive: true });
      await writeFile(join(dir, "src", "lib", "exec.ts"), RELEASE_SCRIPT);
      git(dir, ["init", "-q"]);
      git(dir, ["add", "src", ...(trackRelease ? ["scripts"] : [])]);
      git(dir, ["commit", "-q", "-m", "init"]);
    }

    const CASES = {
      "file outside the allow list": async (dir) => configure(dir, ["src/lib/exec.js"]),
      // A local tsc build: the compiled copy has a path the allow list never names.
      "gitignored build output": async (dir) => {
        await gitProject(dir, { trackRelease: true });
        await writeFile(join(dir, ".gitignore"), "build/\n");
        await mkdir(join(dir, "build", "lib"), { recursive: true });
        await writeFile(join(dir, "build", "lib", "exec.js"), RELEASE_SCRIPT);
        await configure(dir, ["src/lib/exec.ts", "scripts/release.js"]);
      },
      // A Claude agent worktree: a full second checkout inside the project.
      "agent worktree": async (dir) => {
        await gitProject(dir, { trackRelease: true });
        git(dir, ["worktree", "add", "-q", join(".claude", "worktrees", "agent")]);
        await configure(dir, ["src/lib/exec.ts", "scripts/release.js"]);
      },
      "untracked source file": async (dir) => {
        await gitProject(dir, { trackRelease: false });
        await configure(dir, ["src/lib/exec.ts"]);
      },
      "file in the allow list": async (dir) => configure(dir, ["src/lib/exec.js", "scripts/release.js"]),
      "malformed rule": async (dir) => {
        await writeFile(
          join(dir, ".n-dx.json"),
          JSON.stringify({ ci: { restrictedImports: [{ allow: ["scripts/release.js"] }] } }) + "\n",
        );
      },
      "unparseable config": async (dir) => {
        await writeFile(join(dir, ".n-dx.json"), UNPARSEABLE_CONFIG);
      },
    };

    /** @type {Map<string, { dir: string, code: number, step: object }>} */
    const results = new Map();

    beforeAll(async () => {
      for (const [name, setup] of Object.entries(CASES)) {
        const dir = await freshProject("ndx-ci-restricted-");
        await mkdir(join(dir, "scripts"), { recursive: true });
        await writeFile(join(dir, "scripts", "release.js"), RELEASE_SCRIPT);
        await setup(dir);
        const result = runResult(["--format=json", "--quiet", dir]);
        const report = parseReport(result, ["--format=json", "--quiet", name]);
        results.set(name, {
          dir,
          code: result.code,
          step: report.steps.find((s) => s.name === "architecture-policy"),
        });
      }
      // One `ndx ci` run per fixture, all in one hook; see config-secrets.
    }, 300_000);

    afterAll(async () => {
      for (const { dir } of results.values()) await removeTmpDir(dir);
    });

    it("fails ndx ci on a file importing the module outside its allow list", () => {
      const { code, step } = results.get("file outside the allow list");
      expect(code).toBe(1);
      expect(step.ok).toBe(false);
      expect(step.violations).toHaveLength(1);
      // Names the file, the module and the config entry, and says how to allow it.
      const [message] = step.violations;
      expect(message).toContain("scripts/release.js");
      expect(message).toContain("node:child_process");
      expect(message).toContain("ci.restrictedImports[0]");
      expect(message).toContain(".n-dx.json");
      expect(message).toMatch(/add .* to its allow list/);
    });

    it("passes once the file is in the allow list", () => {
      const { code, step } = results.get("file in the allow list");
      expect(code).toBe(0);
      expect(step.ok).toBe(true);
      expect(step.violations).toBeUndefined();
      expect(step.detail).not.toMatch(/^skipped/);
    });

    it("does not scan gitignored build output", () => {
      const { code, step } = results.get("gitignored build output");
      expect(step.violations).toBeUndefined();
      expect(step.ok).toBe(true);
      expect(code).toBe(0);
    });

    it("does not scan an agent worktree under .claude/worktrees", () => {
      const { code, step } = results.get("agent worktree");
      expect(step.violations).toBeUndefined();
      expect(step.ok).toBe(true);
      expect(code).toBe(0);
    });

    it("still fails an untracked, non-ignored source file outside the allow list", () => {
      const { code, step } = results.get("untracked source file");
      expect(code).toBe(1);
      expect(step.ok).toBe(false);
      expect(step.violations).toHaveLength(1);
      expect(step.violations[0]).toMatch(/^scripts\/release\.js imports node:child_process/);
    });

    it("fails on a rule it cannot read rather than skipping it", () => {
      const { code, step } = results.get("malformed rule");
      expect(code).toBe(1);
      expect(step.ok).toBe(false);
      expect(step.violations.join("\n")).toContain("ci.restrictedImports[0].module");
    });

    it("fails on a config file it cannot parse, naming the file and the parse error", () => {
      const { code, step } = results.get("unparseable config");
      let parseError;
      try {
        JSON.parse(UNPARSEABLE_CONFIG);
      } catch (err) {
        parseError = err.message;
      }
      expect(code).toBe(1);
      expect(step.ok).toBe(false);
      expect(step.detail).not.toMatch(/^skipped/);
      const message = step.violations.join("\n");
      expect(message).toContain(".n-dx.json");
      expect(message).toContain(parseError);
    });
  });

  // ── Config secrets: one fixture per git state ───────────────────────────────

  describe("config-secrets step", () => {
    /** Turn a dir into a git repo with `file` tracked, as a teammate's clone would have it. */
    function gitTrack(dir, file) {
      const opts = { cwd: dir, stdio: "pipe" };
      execFileSync("git", ["init", "-q"], opts);
      execFileSync("git", ["-c", "user.email=ci@test", "-c", "user.name=ci", "add", file], opts);
      execFileSync(
        "git",
        ["-c", "user.email=ci@test", "-c", "user.name=ci", "commit", "-q", "-m", "track"],
        opts,
      );
    }

    /**
     * Each case is a fixture state and the `--format=json --quiet` run against
     * it. `setup` receives the project dir; the case stores the exit code, the
     * parsed report and the config-secrets step.
     */
    const CASES = {
      "clean shared file": async (dir) => {
        await writeFile(join(dir, ".n-dx.json"), JSON.stringify({ llm: { vendor: "claude" } }) + "\n");
        gitTrack(dir, ".n-dx.json");
      },
      "tracked shared file with key": async (dir) => {
        await writeFile(
          join(dir, ".n-dx.json"),
          JSON.stringify({ llm: { vendor: "claude", claude: { api_key: "sk-ant-leaked" } } }) + "\n",
        );
        gitTrack(dir, ".n-dx.json");
      },
      "tracked local file": async (dir) => {
        await writeFile(join(dir, ".n-dx.local.json"), JSON.stringify({}) + "\n");
        gitTrack(dir, ".n-dx.local.json");
      },
      "both tracked with keys": async (dir) => {
        await writeFile(
          join(dir, ".n-dx.json"),
          JSON.stringify({ llm: { claude: { api_key: "sk-ant-shared" } } }) + "\n",
        );
        await writeFile(join(dir, ".n-dx.local.json"), JSON.stringify({ llm: { claude: { api_key: "sk-ant-local" } } }) + "\n");
        gitTrack(dir, ".");
      },
      "untracked local file with key": async (dir) => {
        await writeFile(
          join(dir, ".n-dx.local.json"),
          JSON.stringify({ llm: { claude: { api_key: "sk-ant-local-only" } } }) + "\n",
        );
        await writeFile(join(dir, ".n-dx.json"), JSON.stringify({ llm: { vendor: "claude" } }) + "\n");
        gitTrack(dir, ".n-dx.json");
      },
      "untracked shared file with key": async (dir) => {
        await writeFile(
          join(dir, ".n-dx.json"),
          JSON.stringify({ claude: { api_key: "sk-ant-local-only" } }) + "\n",
        );
        execFileSync("git", ["init", "-q"], { cwd: dir, stdio: "pipe" });
      },
    };

    /** @type {Map<string, { dir: string, code: number, report: object, step: object }>} */
    const results = new Map();

    beforeAll(async () => {
      for (const [name, setup] of Object.entries(CASES)) {
        const dir = await freshProject("ndx-ci-secrets-");
        await setup(dir);
        const result = runResult(["--format=json", "--quiet", dir]);
        // Named by case: six fixtures share this hook, and without the name a
        // failure here says only that some JSON was unparseable.
        const report = parseReport(result, ["--format=json", "--quiet", name]);
        results.set(name, {
          dir,
          code: result.code,
          report,
          step: report.steps.find((s) => s.name === "config-secrets"),
        });
      }
      // Six fixtures, about sixteen git spawns and six `ndx ci` runs in one
      // hook, measured at 9-11 s per run locally. The 120 s default leaves no
      // room on a loaded runner, and the failure it produces is a hook timeout
      // rather than anything about the case that was slow.
    }, 300_000);

    afterAll(async () => {
      for (const { dir } of results.values()) await removeTmpDir(dir);
    });

    it("passes when .n-dx.json holds no api_key", () => {
      const { code, step } = results.get("clean shared file");
      expect(code).toBe(0);
      expect(step).toBeDefined();
      expect(step.ok).toBe(true);
    });

    it("fails when a git-tracked .n-dx.json holds an api_key", () => {
      const { code, report, step } = results.get("tracked shared file with key");
      expect(code).toBe(1);
      expect(step.ok).toBe(false);
      expect(step.secrets).toEqual(["llm.claude.api_key"]);
      expect(report.ok).toBe(false);
    });

    it("fails when .n-dx.local.json is tracked by git, whatever it holds", () => {
      // The file every `ndx config` API key lands in. Its only protection is
      // the gitignore entry, so tracking it at all is the failure — reading it
      // would not change the answer, and the next config write fills it.
      const { code, report, step } = results.get("tracked local file");
      expect(code).toBe(1);
      expect(step.ok).toBe(false);
      expect(report.ok).toBe(false);
      // Names the file, says it must stay ignored, and gives both remedies.
      expect(step.detail).toContain(".n-dx.local.json");
      expect(step.detail).toContain(".gitignore");
      expect(step.detail).toContain("git rm --cached .n-dx.local.json");
      expect(step.detail).toContain("rotate");
    });

    it("names both files when the shared one also holds a key", () => {
      const { code, step } = results.get("both tracked with keys");
      expect(code).toBe(1);
      expect(step.ok).toBe(false);
      // The local file leads — it is where the keys are — but the shared
      // file's key is not lost from the report.
      expect(step.detail).toContain(".n-dx.local.json is tracked");
      expect(step.detail).toContain("llm.claude.api_key");
      expect(step.secrets).toEqual(["llm.claude.api_key"]);
    });

    it("passes when .n-dx.local.json exists but is untracked", () => {
      // The ordinary state of a configured project: keys on disk, ignored.
      const { code, report, step } = results.get("untracked local file with key");
      expect(code).toBe(0);
      expect(step.ok).toBe(true);
      expect(report.ok).toBe(true);
      // Nothing to report: the key is in the file it belongs in, unignored by
      // nobody. (`secrets` is omitted entirely when empty.)
      expect(step.detail).toBe("no API keys in .n-dx.json");
    });

    it("warns but passes when an untracked .n-dx.json holds an api_key", () => {
      const { code, step } = results.get("untracked shared file with key");
      expect(code).toBe(0);
      expect(step.ok).toBe(true);
      expect(step.secrets).toEqual(["claude.api_key"]);
      expect(step.detail).toContain(".n-dx.local.json");
    });
  });

  // ── Missing directories ────────────────────────────────────────────────────

  describe("missing project setup", () => {
    let emptyDir;
    let svOnlyDir;
    /** `ndx ci <empty>` and `--format=json` against it: both dirs missing. */
    let emptyText;
    let emptyJson;
    /** `--format=json` against a dir with only .sourcevision: just .rex missing. */
    let svOnlyJson;

    beforeAll(async () => {
      emptyDir = await mkdtemp(join(tmpdir(), "ndx-ci-empty-"));
      svOnlyDir = await mkdtemp(join(tmpdir(), "ndx-ci-empty-"));
      // Create .sourcevision so only .rex is missing
      await mkdir(join(svOnlyDir, ".sourcevision"), { recursive: true });
      emptyText = runResult([emptyDir]);
      emptyJson = runResult(["--format=json", emptyDir]);
      svOnlyJson = runResult(["--format=json", svOnlyDir]);
    });

    afterAll(async () => {
      await rm(emptyDir, { recursive: true, force: true });
      await rm(svOnlyDir, { recursive: true, force: true });
    });

    it("exits 1 when .rex is missing", () => {
      expect(emptyText.code).toBe(1);
      expect(emptyText.stderr).toContain("Missing");
    });

    it("returns structured JSON error when .rex is missing with --format=json", () => {
      expect(svOnlyJson.code).toBe(1);
      const report = JSON.parse(svOnlyJson.stdout);
      expect(report.ok).toBe(false);
      expect(report.error).toMatch(/\.rex/);
    });

    it("returns structured JSON error when both dirs missing with --format=json", () => {
      expect(emptyJson.code).toBe(1);
      const report = JSON.parse(emptyJson.stdout);
      expect(report.ok).toBe(false);
      expect(report.error).toMatch(/\.rex/);
      expect(report.error).toMatch(/\.sourcevision/);
    });

    it("JSON error includes hint for missing setup", () => {
      expect(svOnlyJson.code).toBe(1);
      const report = JSON.parse(svOnlyJson.stdout);
      expect(report.hint).toContain("ndx init");
    });

    it("includes timestamp in JSON error report", () => {
      const report = JSON.parse(svOnlyJson.stdout);
      expect(report.timestamp).toBeDefined();
      expect(new Date(report.timestamp).getTime()).not.toBeNaN();
    });

    it("text mode still shows clear error when .rex is missing", () => {
      expect(emptyText.code).toBe(1);
      expect(emptyText.stderr).toContain("Missing");
      expect(emptyText.stderr).toMatch(/ndx init/);
    });
  });

  // ── Validation failure: a broken PRD, and an orphaned item ─────────────────

  describe("validation failure", () => {
    let invalidDir;
    let orphanDir;
    /** Text and JSON runs against `{ invalid: true }` as the PRD. */
    let invalidText;
    let invalidJson;
    /** Text and JSON runs against a subtask at the root. */
    let orphanText;
    let orphanJson;

    beforeAll(async () => {
      // Break the PRD schema
      invalidDir = await freshProject();
      await writeFile(join(invalidDir, ".rex", "prd.json"), JSON.stringify({ invalid: true }));
      invalidText = runResult([invalidDir]);
      invalidJson = runResult(["--format=json", "--quiet", invalidDir]);

      // Subtask at root is an orphan — subtasks must be under task
      orphanDir = await freshProject();
      await writeFile(join(orphanDir, ".rex", "prd.json"), ORPHAN_PRD);
      orphanText = runResult([orphanDir]);
      orphanJson = runResult(["--format=json", "--quiet", orphanDir]);
    });

    afterAll(async () => {
      await removeTmpDir(invalidDir);
      await removeTmpDir(orphanDir);
    });

    it("exits non-zero when rex validate fails", () => {
      expect(invalidText.code).toBe(1);
    });

    it("JSON report shows failed step", () => {
      expect(invalidJson.code).toBe(1);
      // Should still produce valid JSON even on failure
      const report = JSON.parse(invalidJson.stdout);
      expect(report.ok).toBe(false);
      const valStep = report.steps.find((s) => s.name === "validate");
      expect(valStep.ok).toBe(false);
    });

    it("exits 1 on orphaned items", () => {
      expect(orphanText.code).toBe(1);
    });

    it("JSON report shows orphaned items as failed check", () => {
      expect(orphanJson.code).toBe(1);
      const report = JSON.parse(orphanJson.stdout);
      expect(report.ok).toBe(false);
      // The validate step should show the hierarchy placement failure
      const valStep = report.steps.find((s) => s.name === "validate");
      expect(valStep.ok).toBe(false);
    });

    it("includes check details for failed validations", () => {
      const report = JSON.parse(orphanJson.stdout);
      const valStep = report.steps.find((s) => s.name === "validate");
      // Should have checks with at least one failure
      const failedCheck = valStep.checks.find((c) => !c.pass);
      expect(failedCheck).toBeDefined();
      expect(failedCheck.errors.length).toBeGreaterThan(0);
    });

    describe("text output", () => {
      it("shows pipeline failed message on failure", () => {
        expect(invalidText.stdout).toContain("CI pipeline failed");
      });

      it("shows failure marks for failing steps", () => {
        expect(invalidText.stdout).toContain("✗ rex validate");
      });
    });
  });

  // ── Sourcevision validation failure ─────────────────────────────────────────

  describe("sourcevision validation failure", () => {
    let tmpDir;
    let text;
    let json;

    beforeAll(async () => {
      // Break the inventory schema
      tmpDir = await freshProject();
      await writeFile(join(tmpDir, ".sourcevision", "inventory.json"), JSON.stringify({ invalid: true }));
      text = runResult([tmpDir]);
      json = runResult(["--format=json", "--quiet", tmpDir]);
    });

    afterAll(async () => {
      await removeTmpDir(tmpDir);
    });

    it("exits 1 when sourcevision data is invalid", () => {
      expect(text.code).toBe(1);
    });

    it("JSON report shows sourcevision-validate failure", () => {
      expect(json.code).toBe(1);
      const report = JSON.parse(json.stdout);
      expect(report.ok).toBe(false);
      const svValStep = report.steps.find((s) => s.name === "sourcevision-validate");
      expect(svValStep.ok).toBe(false);
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
