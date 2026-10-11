import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
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
  action: "captured",
  itemId: "item-must-fix",
  disposition: "offered",
};

describe("cliLoop — pair review", () => {
  let projectDir: string;
  let henchDir: string;
  let rexDir: string;
  let cli: ScriptedClaudeCli;
  let missingReviewerCli: boolean;
  let printed: string[];

  beforeEach(async () => {
    vi.resetModules();
    ({ projectDir, henchDir, rexDir } = await setupScriptedProject("hench-pair-review-"));
    // The reviewer's model comes from llm.<reviewer>.reviewModel.
    writeFileSync(
      join(projectDir, ".n-dx.json"),
      JSON.stringify({ llm: { vendor: "claude", codex: { reviewModel: REVIEWER_MODEL } } }),
      "utf-8",
    );
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
    cli.script(workCommits, reviewerReports([MUST_FIX]));

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
    cli.script(workCommits, reviewerReports([MUST_FIX]));

    const { run } = await runLoop();

    expect(run.reviewPlan).toMatchObject({ mode: "pair", vendor: "codex", model: REVIEWER_MODEL });
    expect(run.review).toMatchObject({
      mode: "pair",
      vendor: "codex",
      model: REVIEWER_MODEL,
      resumedSession: false,
      findingCount: 1,
      unrepairedMustFixCount: 1,
    });
    // Must-fix findings are captured as today, and do not block the commit.
    expect(run.status).toBe("completed");
    expect(printed.join("\n")).toContain("Pair review reports only");
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
