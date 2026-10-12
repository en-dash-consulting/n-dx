import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { EventEmitter } from "node:events";
import { dirname, join } from "node:path";
import { cleanupProjectDir } from "../helpers/index.js";
import {
  createScriptedClaudeCli,
  setupScriptedProject,
  initLine,
  toolUseLine,
  resultLine,
  resumes,
  type CliInvocation,
  type ScriptedClaudeCli,
  type ScriptedTurn,
} from "../helpers/scripted-claude-cli.js";
import { loadConfig } from "../../src/store/config.js";
import type { ReviewFinding } from "../../src/agent/analysis/adversarial-review.js";

/**
 * Pair review (`hench.review.mode: "pair"`): the other vendor's CLI reviews the
 * diff in a fresh session and writes the report, and the run record says so.
 * Here the executor is claude and the reviewer is codex.
 */

const WORK_SESSION = "sess-work-pair";
const REVIEWER_MODEL = "gpt-5.2-pair-reviewer";

function reportPathIn(call: CliInvocation): string {
  const match = call.stdin.match(/(\S+[\\/]\.hench[\\/]reviews[\\/][\w-]+\.json)/);
  if (!match) throw new Error("no report path in the reviewer's prompt");
  return match[1]!;
}

const MUST_FIX: ReviewFinding = {
  title: "Feature constant is never validated",
  location: "feature.ts:1",
  severity: "high",
  verdict: "must-fix",
  scenario: "Import feature -> value 1 is used as a count -> a zero-config caller gets one item",
  expected: "A zero-config caller gets no items",
  action: "dropped",
  disposition: "offered",
};

const SHOULD_FIX: ReviewFinding = {
  title: "Feature constant has no doc comment",
  location: "feature.ts:1",
  severity: "low",
  verdict: "should-fix",
  scenario: "A reader opens feature.ts -> cannot tell what the constant counts",
  action: "captured",
  itemId: "item-should-fix",
  disposition: "offered",
};

describe("cliLoop — pair review", () => {
  let projectDir: string;
  let henchDir: string;
  let rexDir: string;
  let cli: ScriptedClaudeCli;
  let missingReviewerCli: boolean;
  let printed: string[];
  let validateLog: string;

  beforeEach(async () => {
    vi.resetModules();
    ({ projectDir, henchDir, rexDir } = await setupScriptedProject("hench-pair-review-"));
    // The reviewer's model comes from llm.<reviewer>.reviewModel.
    writeFileSync(
      join(projectDir, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "claude", codex: { reviewModel: REVIEWER_MODEL } } }),
      "utf-8",
    );
    // The task's own validation (rex `test`): counts its runs in a log outside
    // the project, and fails from run N when `<log>.fail-from` says N.
    validateLog = `${projectDir}-validate.log`;
    writeFileSync(
      join(projectDir, "validate.js"),
      [
        'const fs = require("node:fs");',
        `const log = ${JSON.stringify(validateLog)};`,
        'const runs = fs.existsSync(log) ? fs.readFileSync(log, "utf-8").length : 0;',
        'fs.appendFileSync(log, "x");',
        'const marker = log + ".fail-from";',
        'if (fs.existsSync(marker) && runs >= Number(fs.readFileSync(marker, "utf-8"))) process.exit(1);',
      ].join("\n"),
      "utf-8",
    );
    const rexConfigPath = join(rexDir, "config.json");
    const rexConfig = JSON.parse(readFileSync(rexConfigPath, "utf-8")) as Record<string, unknown>;
    writeFileSync(rexConfigPath, JSON.stringify({ ...rexConfig, test: "node validate.js" }), "utf-8");
    execFileSync("git", ["add", "-A"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "test: pair review config"], { cwd: projectDir, stdio: "ignore" });

    printed = [];
    missingReviewerCli = false;
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      printed.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    const scripted = createScriptedClaudeCli(actual.spawn);
    cli = scripted;
    const spawn = (command: string, args: string[] = [], opts?: unknown): unknown => {
      // A codex binary that is not installed: spawn fails with ENOENT.
      if (missingReviewerCli && /(^|[\\/])codex(\.exe)?$/i.test(command)) {
        const proc = new EventEmitter() as EventEmitter & Record<string, unknown>;
        Object.assign(proc, {
          pid: undefined,
          stdout: new EventEmitter(),
          stderr: new EventEmitter(),
          stdin: { write: () => true, end: () => {}, on: () => {} },
          kill: () => true,
        });
        setImmediate(() => proc.emit("error", Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" })));
        return proc;
      }
      return scripted.spawn(command, args, opts);
    };
    vi.doMock("node:child_process", () => ({ ...actual, spawn }));
  });

  afterEach(async () => {
    vi.doUnmock("node:child_process");
    vi.restoreAllMocks();
    await cleanupProjectDir(projectDir);
    rmSync(validateLog, { force: true });
    rmSync(`${validateLog}.fail-from`, { force: true });
  });

  const workCommits: ScriptedTurn = () => {
    writeFileSync(join(projectDir, "feature.ts"), "export const feature = 1;\n", "utf-8");
    execFileSync("git", ["add", "feature.ts"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "feat: the feature"], { cwd: projectDir, stdio: "ignore" });
    return {
      lines: [
        initLine(WORK_SESSION),
        toolUseLine(WORK_SESSION, "Bash", { command: "git commit -m 'feat: the feature'" }),
        resultLine(WORK_SESSION, "Committed."),
      ],
    };
  };

  const reviewerReports = (findings: ReviewFinding[]): ScriptedTurn => (call) => {
    const path = reportPathIn(call);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ taskId: "task-1", fixesApplied: false, summary: "Attacked the feature.", findings }),
      "utf-8",
    );
    return { lines: [{ type: "item.completed", item: { type: "agent_message", text: "Report written." } }] };
  };

  async function runLoop(extra: Record<string, unknown> = {}) {
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");
    const config = await loadConfig(henchDir);
    return cliLoop({
      config,
      store: createStore("file", rexDir),
      projectDir,
      henchDir,
      taskId: "task-1",
      autonomous: true,
      yes: true,
      reviewPass: true,
      reviewMode: "pair",
      reviewVendor: "codex",
      ...extra,
    });
  }

  it("spawns the codex CLI fresh, on the reviewer model, and tells it to edit nothing", async () => {
    cli.script(workCommits, reviewerReports([]));

    const { run } = await runLoop();

    expect(cli.invocations).toHaveLength(2);
    const reviewer = cli.invocations[1]!;
    // codex, not the executor's claude session, and not a resume of anything.
    expect(reviewer.args[0]).toBe("exec");
    expect(reviewer.args).not.toContain("resume");
    expect(resumes(reviewer, WORK_SESSION)).toBe(false);
    expect(reviewer.args).toContain("-m");
    expect(reviewer.args[reviewer.args.indexOf("-m") + 1]).toBe(REVIEWER_MODEL);

    // The prompt carries the task, the diff and the file list, and forbids edits.
    expect(reviewer.stdin).toContain("Scripted task");
    expect(reviewer.stdin).toContain("export const feature = 1;");
    expect(reviewer.stdin).toContain("- feature.ts");
    expect(reviewer.stdin).toMatch(/Edit no files/);
    expect(reviewer.stdin).toMatch(/MUST NOT\s+edit/);
    expect(reviewer.stdin).not.toMatch(/Fix it now/);

    expect(run.status).toBe("completed");
  });

  it("parses the reviewer's report and records mode, vendor and model on the run", async () => {
    cli.script(workCommits, reviewerReports([SHOULD_FIX]));

    const { run } = await runLoop();

    expect(run.reviewPlan).toMatchObject({ mode: "pair", vendor: "codex", model: REVIEWER_MODEL });
    expect(run.review).toMatchObject({
      mode: "pair",
      vendor: "codex",
      model: REVIEWER_MODEL,
      resumedSession: false,
      findingCount: 1,
      unrepairedMustFixCount: 0,
    });
    // A should-fix finding is captured and never blocks the commit, nor does it
    // earn the executor a fix round.
    expect(run.status).toBe("completed");
    expect(run.reviewRounds).toBeUndefined();
    expect(cli.invocations).toHaveLength(2);
  });

  describe("fix rounds", () => {
    const FIX_SESSION = "sess-fix-pair";
    const validations = (): number => (existsSync(validateLog) ? readFileSync(validateLog, "utf-8").length : 0);

    /** The executor, resumed: edits the feature and commits it, as it did the original work. */
    const executorFixes = (value: number): ScriptedTurn => () => {
      writeFileSync(join(projectDir, "feature.ts"), `export const feature = ${value};\n`, "utf-8");
      execFileSync("git", ["add", "feature.ts"], { cwd: projectDir, stdio: "ignore" });
      execFileSync("git", ["commit", "-m", `fix: feature ${value}`], { cwd: projectDir, stdio: "ignore" });
      return {
        lines: [
          initLine(FIX_SESSION),
          toolUseLine(FIX_SESSION, "Bash", { command: "git commit" }),
          resultLine(FIX_SESSION, "Fixed."),
        ],
      };
    };

    /** A reviewer that still reports `finding` and captures it when it is the last round. */
    const reviewerKeepsReporting = (): ScriptedTurn => (call) => {
      const captured = /Capture as a PRD task[^\n]*\|\s*`captured`/.test(
        call.stdin.split("\n").find((l) => l.includes("`must-fix`") && l.includes("Capture")) ?? "",
      );
      return reviewerReports([
        captured ? { ...MUST_FIX, action: "captured", itemId: "item-final-capture" } : MUST_FIX,
      ])(call);
    };

    it("resumes the executor with the must-fix finding, re-runs its tests, and completes once the reviewer passes", async () => {
      let validationsAtRecheck = -1;
      const recheckReports = reviewerReports([]);
      cli.script(workCommits, reviewerReports([MUST_FIX]), executorFixes(0), (call) => {
        validationsAtRecheck = validations();
        return recheckReports(call);
      });

      const { run } = await runLoop();

      expect(cli.invocations).toHaveLength(4);
      const fix = cli.invocations[2]!;
      // The executor's own session, resumed, told the file, the trigger and the behaviour wanted.
      expect(resumes(fix, WORK_SESSION)).toBe(true);
      expect(fix.stdin).toContain(MUST_FIX.title);
      expect(fix.stdin).toContain("feature.ts:1");
      expect(fix.stdin).toContain(MUST_FIX.scenario);
      expect(fix.stdin).toContain(MUST_FIX.expected);
      expect(fix.stdin).toMatch(/nothing else/);

      // The tests ran for the original work and again after the fix, before the re-review.
      expect(validationsAtRecheck).toBe(2);

      // A fresh reviewer, told what to confirm, looking at the new diff.
      const recheck = cli.invocations[3]!;
      expect(recheck.args[0]).toBe("exec");
      expect(recheck.stdin).toContain("## Previous round");
      expect(recheck.stdin).toContain(MUST_FIX.title);
      expect(recheck.stdin).toContain("export const feature = 0;");

      expect(run.status).toBe("completed");
      expect(run.review).toMatchObject({ mode: "pair", findingCount: 0, unrepairedMustFixCount: 0 });
      expect(run.reviewRounds).toEqual([
        {
          round: 1,
          findingsIn: 1,
          findingsFixed: 1,
          remaining: 0,
          verdict: "pass",
          reportPath: expect.stringMatching(/-r1\.json$/),
        },
      ]);
    });

    it("keeps the lesser findings of the first review in the last report", async () => {
      cli.script(workCommits, reviewerReports([MUST_FIX, SHOULD_FIX]), executorFixes(0), reviewerReports([]));

      const { run } = await runLoop();

      expect(run.status).toBe("completed");
      const report = JSON.parse(readFileSync((run.review as { reportPath: string }).reportPath, "utf-8")) as {
        findings: ReviewFinding[];
      };
      expect(report.findings.map((f) => f.title)).toEqual([SHOULD_FIX.title]);
    });

    it("fails the review when the reviewer never passes: the executor runs once per round, and the findings are captured", async () => {
      cli.script(
        workCommits,
        reviewerReports([MUST_FIX]),
        executorFixes(0),
        reviewerKeepsReporting(),
        executorFixes(2),
        reviewerKeepsReporting(),
      );

      const { run } = await runLoop({ reviewRounds: 2 });

      expect(cli.invocations).toHaveLength(6);
      expect(cli.invocations.filter((c) => resumes(c, WORK_SESSION) || resumes(c, FIX_SESSION))).toHaveLength(2);
      // Only the last review captures a must-fix finding: the earlier one hands it to the executor.
      expect(cli.invocations[3]!.stdin).not.toMatch(/`must-fix`, `should-fix`/);
      expect(cli.invocations[5]!.stdin).toMatch(/`must-fix`, `should-fix`/);

      expect(run.status).toBe("failed");
      expect(run.error).toMatch(/pair review did not pass/);
      expect(run.error).toContain("1 must-fix finding(s) still open after 2 fix round(s)");
      expect(run.review).toMatchObject({ failed: "must-fix-unresolved" });
      expect(run.reviewRounds).toMatchObject([
        { round: 1, findingsIn: 1, findingsFixed: 0, remaining: 1, verdict: "must-fix" },
        { round: 2, findingsIn: 1, findingsFixed: 0, remaining: 1, verdict: "must-fix" },
      ]);
      const reportPath = (run.review as { reportPath?: string }).reportPath ?? "";
      const report = JSON.parse(readFileSync(reportPath, "utf-8")) as { findings: ReviewFinding[] };
      expect(report.findings).toMatchObject([{ title: MUST_FIX.title, action: "captured", itemId: "item-final-capture" }]);

      // The task is not completed.
      const { createStore } = await import("@n-dx/rex/dist/store/index.js");
      const item = await createStore("file", rexDir).getItem("task-1");
      expect(item?.status).not.toBe("completed");
    });

    it("fails review even under --review-optional: a reviewer that said no is not a missing reviewer", async () => {
      cli.script(workCommits, reviewerReports([MUST_FIX]), executorFixes(0), reviewerKeepsReporting());

      const { run } = await runLoop({ reviewRounds: 1, reviewOptional: true });

      expect(cli.invocations).toHaveLength(4);
      expect(run.status).toBe("failed");
      expect(run.review).toMatchObject({ failed: "must-fix-unresolved" });
    });

    it("does not spend a re-review on a fix that breaks the task's tests", async () => {
      writeFileSync(`${validateLog}.fail-from`, "1", "utf-8");
      cli.script(workCommits, reviewerReports([MUST_FIX]), executorFixes(0));

      const { run } = await runLoop();

      expect(cli.invocations).toHaveLength(3);
      expect(run.status).toBe("failed");
      expect(run.review).toMatchObject({ failed: "must-fix-unresolved" });
      expect(run.reviewRounds).toMatchObject([{ round: 1, findingsIn: 1, verdict: "validation-failed" }]);
    });
  });

  it("skips the review with a warning when the reviewer CLI is missing, under --review-optional", async () => {
    missingReviewerCli = true;
    cli.script(workCommits);

    const { run } = await runLoop({ reviewOptional: true });

    expect(run.status).toBe("completed");
    expect(run.review).toMatchObject({ failed: "spawn-failed" });
    expect(run.review && "detail" in run.review ? run.review.detail : "").toMatch(/codex reviewer/);
    expect(printed.join("\n")).toContain("Adversarial review did not complete (spawn-failed)");
  });
});
