import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupProjectDir } from "../helpers/index.js";
import {
  createScriptedClaudeCli,
  setupScriptedProject,
  initLine,
  toolUseLine,
  textLine,
  resultLine,
  resumes,
  forks,
  type CliInvocation,
  type ScriptedClaudeCli,
  type ScriptedTurn,
} from "../helpers/scripted-claude-cli.js";
import { loadConfig } from "../../src/store/config.js";

/**
 * A reviewer that ends waiting instead of writing its report is resumed once
 * (PR BG, task 1bfcfdad).
 *
 * The defect: in run 01d15d75 the reviewer — resuming the work session, and
 * with it the belief that a backgrounded suite would report back — printed
 * its findings, said it would "fold its result in before writing the report
 * file", and ended. hench recorded "PRODUCED NO REPORT — this task was NOT
 * reviewed" for a review that had in fact been done.
 */

const WORK_SESSION = "sess-work-0002";
const REVIEW_SESSION = "sess-review-0002";

/** The report path named in the reviewer's stdin — the brief and the resume message both carry it. */
function reportPathIn(call: CliInvocation): string {
  const match = call.stdin.match(/(\S+[\\/]\.hench[\\/]reviews[\\/][\w-]+\.json)/);
  if (!match) throw new Error("no report path in the reviewer's prompt");
  return match[1]!;
}

function writeReport(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      taskId: "task-1",
      fixesApplied: false,
      summary: "Attacked the feature export. The full suite was not seen to finish.",
      findings: [
        {
          title: "Feature flag is never read",
          location: "feature.ts:1",
          severity: "low",
          verdict: "not-worth-fixing",
          scenario: "Import the module -> the constant is unused -> no wrong behaviour",
          action: "dropped",
          disposition: "dropped",
        },
      ],
    }),
    "utf-8",
  );
}

describe("cliLoop — review background-wait resume", () => {
  let projectDir: string;
  let henchDir: string;
  let rexDir: string;
  let cli: ScriptedClaudeCli;

  beforeEach(async () => {
    vi.resetModules();
    ({ projectDir, henchDir, rexDir } = await setupScriptedProject("hench-review-bg-"));

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    const scripted = createScriptedClaudeCli(actual.spawn);
    cli = scripted;
    vi.doMock("node:child_process", () => ({ ...actual, spawn: scripted.spawn }));
  });

  afterEach(async () => {
    vi.doUnmock("node:child_process");
    vi.restoreAllMocks();
    await cleanupProjectDir(projectDir);
  });

  const commitWork = (): void => {
    writeFileSync(join(projectDir, "feature.ts"), "export const feature = 1;\n", "utf-8");
    execFileSync("git", ["add", "feature.ts"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "feat: the feature"], { cwd: projectDir, stdio: "ignore" });
  };

  /** A work session that commits and finishes. */
  const workCommits: ScriptedTurn = () => {
    commitWork();
    return {
      lines: [
        initLine(WORK_SESSION),
        toolUseLine(WORK_SESSION, "Bash", { command: "git commit -m 'feat: the feature'" }),
        resultLine(WORK_SESSION, "Committed."),
      ],
    };
  };

  /** A reviewer that backgrounds the suite and ends without a report. */
  const reviewerEndsWaiting: ScriptedTurn = () => ({
    lines: [
      initLine(REVIEW_SESSION),
      toolUseLine(REVIEW_SESSION, "Bash", { command: "pnpm test", run_in_background: true }),
      textLine(REVIEW_SESSION, "The full suite is still running; I'll fold its result in before writing the report file."),
      resultLine(REVIEW_SESSION, "Findings above; report pending the suite."),
    ],
  });

  /** A reviewer that writes its report. */
  const reviewerWritesReport: ScriptedTurn = (call) => {
    writeReport(reportPathIn(call));
    return {
      lines: [
        initLine(REVIEW_SESSION),
        toolUseLine(REVIEW_SESSION, "Write", { file_path: reportPathIn(call), content: "..." }),
        resultLine(REVIEW_SESSION, "Report written."),
      ],
    };
  };

  async function runLoop() {
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
    });
  }

  it("resumes a reviewer that ended waiting with no report once, and takes the report it then writes", async () => {
    cli.script(workCommits, reviewerEndsWaiting, reviewerWritesReport);

    const { run } = await runLoop();

    expect(cli.invocations).toHaveLength(3);
    const [, review, resume] = cli.invocations;
    expect(resumes(review!, WORK_SESSION)).toBe(true);
    expect(resumes(resume!, REVIEW_SESSION)).toBe(true);
    expect(forks(resume!)).toBe(false);
    expect(resume!.stdin).toMatch(/Write the JSON report now, from what you already have/);
    expect(resume!.stdin).toContain(reportPathIn(review!));

    expect(run.review).toMatchObject({ findingCount: 1, backgroundResumed: true });
    expect(run.review?.failed).toBeUndefined();
    expect(run.status).toBe("completed");
  });

  it("records a reviewer that ends waiting twice as no-report, and spawns it no third time", async () => {
    cli.script(workCommits, reviewerEndsWaiting, reviewerEndsWaiting, reviewerWritesReport);

    const { run } = await runLoop();

    expect(cli.invocations).toHaveLength(3);
    expect(run.review).toMatchObject({ failed: "no-report", backgroundResumed: true });
  });

  it("never resumes a reviewer that wrote its report, background call or not", async () => {
    cli.script(workCommits, (call) => {
      writeReport(reportPathIn(call));
      return {
        lines: [
          initLine(REVIEW_SESSION),
          toolUseLine(REVIEW_SESSION, "Bash", { command: "pnpm test", run_in_background: true }),
          toolUseLine(REVIEW_SESSION, "Write", { file_path: reportPathIn(call), content: "..." }),
          resultLine(REVIEW_SESSION, "Report written."),
        ],
      };
    });

    const { run } = await runLoop();

    expect(cli.invocations).toHaveLength(2);
    expect(run.review).toMatchObject({ findingCount: 1 });
    expect(run.review && "backgroundResumed" in run.review ? run.review.backgroundResumed : undefined)
      .toBeUndefined();
  });

  it("resumes a reviewer that inherited the wait from the work session it resumed", async () => {
    // 01d15d75's shape: the work session backgrounded the suite, and the
    // reviewer — resuming that transcript — polled the old job's output file
    // rather than backgrounding anything itself.
    cli.script(
      () => {
        writeFileSync(join(projectDir, "feature.ts"), "export const feature = 1;\n", "utf-8");
        return {
          lines: [
            initLine(WORK_SESSION),
            toolUseLine(WORK_SESSION, "Bash", { command: "pnpm test", run_in_background: true }),
            toolUseLine(WORK_SESSION, "ScheduleWakeup", { delaySeconds: 300, reason: "suite" }),
            resultLine(WORK_SESSION, "Waiting on the suite."),
          ],
        };
      },
      workCommits,
      () => ({
        lines: [
          initLine(REVIEW_SESSION),
          toolUseLine(REVIEW_SESSION, "Bash", { command: "sleep 120; tail -40 /tmp/tasks/b1.output" }),
          textLine(REVIEW_SESSION, "The full suite is still running; I'll write the report once it finishes."),
          resultLine(REVIEW_SESSION, "Report pending."),
        ],
      }),
      reviewerWritesReport,
    );

    const { run } = await runLoop();

    expect(cli.invocations).toHaveLength(4);
    expect(resumes(cli.invocations[3]!, REVIEW_SESSION)).toBe(true);
    expect(run.review).toMatchObject({ findingCount: 1, backgroundResumed: true });
  });

  // A resumed session does not keep its MCP config, and the reviewer can write
  // review captures to the PRD. Without the pin, the resume falls back to
  // Claude's own MCP discovery — where a local-scope registration pinning
  // another checkout sends those writes to the wrong worktree (task 859a814b).
  it("pins the resumed reviewer to this run's MCP config, like every other spawn", async () => {
    const saved = process.env["NDX_CLI_PATH"];
    // A usable launcher is what makes the run prepare an MCP config at all.
    process.env["NDX_CLI_PATH"] = join(
      dirname(fileURLToPath(import.meta.url)),
      "../../../..",
      "packages/core/cli.js",
    );
    try {
      cli.script(workCommits, reviewerEndsWaiting, reviewerWritesReport);

      await runLoop();

      expect(cli.invocations).toHaveLength(3);
      const configOf = (call: CliInvocation): string | undefined => {
        const i = call.args.indexOf("--mcp-config");
        return i === -1 ? undefined : call.args[i + 1];
      };
      const [work, review, resume] = cli.invocations;
      expect(configOf(work!)).toBeDefined();
      expect(configOf(review!)).toBe(configOf(work!));
      expect(configOf(resume!)).toBe(configOf(work!));
      expect(resume!.args).toContain("--strict-mcp-config");
    } finally {
      if (saved === undefined) delete process.env["NDX_CLI_PATH"];
      else process.env["NDX_CLI_PATH"] = saved;
    }
  });

  it("leaves a reviewer that wrote nothing without any background wait to the existing no-report path", async () => {
    cli.script(workCommits, () => ({
      lines: [
        initLine(REVIEW_SESSION),
        textLine(REVIEW_SESSION, "No findings."),
        resultLine(REVIEW_SESSION, "Done."),
      ],
    }));

    const { run } = await runLoop();

    expect(cli.invocations).toHaveLength(2);
    expect(run.review).toMatchObject({ failed: "no-report" });
    expect(run.review && "backgroundResumed" in run.review ? run.review.backgroundResumed : undefined)
      .toBeUndefined();
  });
});
