import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { cleanupProjectDir } from "../helpers/index.js";
import {
  createScriptedClaudeCli,
  setupScriptedProject,
  initLine,
  toolUseLine,
  resultLine,
  type CliInvocation,
  type ScriptedClaudeCli,
  type ScriptedTurn,
} from "../helpers/scripted-claude-cli.js";
import { loadConfig, saveConfig } from "../../src/store/config.js";
import { listRuns, loadRun, saveRun } from "../../src/store/runs.js";
import { TaskClaims } from "../../src/process/task-claims.js";
import type { RunRecord, RunReviewRecord } from "../../src/schema/index.js";

/**
 * Gate-only retry (#539 item 1): a retry of a run that failed only at the test
 * gate, with its work committed and its completion held, runs the gate and no
 * agent. Real repository, real claims, real PRD and the real cliLoop; the
 * vendor CLI is scripted and only the gate's verdict is stubbed.
 */

const SESSION = "sess-agent-0539";

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

interface GateCall {
  filesChanged: string[];
  testCommand?: string;
}

describe("cliLoop — gate-only retry", () => {
  let projectDir: string;
  let henchDir: string;
  let rexDir: string;
  let baseline: string;
  let cli: ScriptedClaudeCli;
  let claims: TaskClaims;
  let gateCalls: GateCall[];
  let gatePasses: boolean;

  beforeEach(async () => {
    vi.resetModules();
    ({ projectDir, henchDir, rexDir } = await setupScriptedProject("hench-gate-only-"));
    // `{base}` makes the base the gate ran from visible on the command and the record.
    const config = await loadConfig(henchDir);
    await saveConfig(henchDir, { ...config, testGate: { command: "node --version {base}" } });
    git(projectDir, "commit", "-qam", "gate template");
    baseline = git(projectDir, "rev-parse", "HEAD");

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    const scripted = createScriptedClaudeCli(actual.spawn);
    cli = scripted;
    vi.doMock("node:child_process", () => ({ ...actual, spawn: scripted.spawn }));

    gateCalls = [];
    gatePasses = true;
    vi.doMock("../../src/tools/test-runner.js", async (importOriginal) => ({
      ...(await importOriginal<typeof import("../../src/tools/test-runner.js")>()),
      runTestGate: async (o: GateCall) => {
        gateCalls.push({ filesChanged: [...o.filesChanged], testCommand: o.testCommand });
        return {
          ran: true,
          passed: gatePasses,
          packages: [{ name: "workspace", passed: gatePasses }],
          command: o.testCommand ?? "",
          totalDurationMs: 5,
        };
      },
    }));

    claims = TaskClaims.forProject(projectDir);
  });

  afterEach(async () => {
    await claims.releaseAll();
    vi.doUnmock("node:child_process");
    vi.doUnmock("../../src/tools/test-runner.js");
    vi.restoreAllMocks();
    await cleanupProjectDir(projectDir);
  });

  /** The agent's work from the failed run, committed. */
  function commitWork(file = "feature.ts"): string {
    writeFileSync(join(projectDir, file), `export const value = "${file}";\n`, "utf-8");
    git(projectDir, "add", file);
    git(projectDir, "commit", "-qm", `feat: ${file}`);
    return git(projectDir, "rev-parse", "HEAD");
  }

  /** The run record a gate failure leaves: failed, gate red, completion held. */
  async function seedGateFailure(overrides: Partial<RunRecord> = {}): Promise<RunRecord> {
    const work = commitWork();
    const run: RunRecord = {
      id: randomUUID(),
      taskId: "task-1",
      taskTitle: "Scripted task",
      startedAt: new Date(Date.now() - 60_000).toISOString(),
      finishedAt: new Date(Date.now() - 30_000).toISOString(),
      status: "failed",
      error: "Test gate failed [command: npm test]: workspace",
      turns: 3,
      tokenUsage: { input: 0, output: 0 },
      toolCalls: [],
      model: "test-model",
      summary: "Added the feature.",
      startHead: baseline,
      branch: git(projectDir, "rev-parse", "--abbrev-ref", "HEAD"),
      commits: [{ sha: work, subject: "feat: feature.ts" }],
      testGate: { ran: true, passed: false, packages: [{ name: "workspace", passed: false }] },
      completionHold: {
        outcome: "not-applied",
        resolutionType: "code-change",
        resolutionDetail: "Added the feature",
        requestedAt: new Date(Date.now() - 40_000).toISOString(),
      },
      ...overrides,
    };
    await saveRun(henchDir, run);
    return run;
  }

  /** An agent session that commits new work, for the normal path. */
  const agentCommits: ScriptedTurn = () => {
    commitWork("agent.ts");
    return {
      lines: [
        initLine(SESSION),
        toolUseLine(SESSION, "Write", { file_path: "agent.ts", content: "..." }),
        resultLine(SESSION, "Committed."),
      ],
    };
  };

  async function runLoop(extra: { reviewPass?: boolean } = {}) {
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");
    const config = await loadConfig(henchDir);
    const store = createStore("file", rexDir);
    try {
      const result = await cliLoop({
        config,
        store,
        projectDir,
        henchDir,
        taskId: "task-1",
        autonomous: true,
        yes: true,
        reviewOptional: true,
        runHistory: await listRuns(henchDir),
        claims,
        ...extra,
      });
      return { ...result, store };
    } finally {
      await claims.releaseAll();
    }
  }

  function printed(): string {
    return (console.log as unknown as { mock: { calls: unknown[][] } }).mock.calls.map((c) => String(c[0])).join("\n");
  }

  it("gates the committed work from the source run's start, with no agent, and applies the held resolution", async () => {
    const source = await seedGateFailure();
    cli.script(agentCommits);

    const { run, store } = await runLoop();

    expect(cli.invocations).toHaveLength(0);
    expect(gateCalls).toHaveLength(1);
    expect(gateCalls[0]!.filesChanged).toContain("feature.ts");
    expect(gateCalls[0]!.testCommand).toBe(`node --version ${baseline}`);
    expect(run.testGate?.base).toBe(baseline);

    expect(run.status).toBe("completed");
    expect(run.completionHold?.outcome).toBe("applied");
    const item = await store.getItem("task-1");
    expect(item?.status).toBe("completed");
    expect(item?.resolutionDetail).toBe("Added the feature");

    expect(run.gateOnlyRetry).toEqual({ sourceRunId: source.id, base: baseline, commits: source.commits });
    expect(run.spawnCount).toBe(0);
    expect((await loadRun(henchDir, run.id)).gateOnlyRetry).toEqual(run.gateOnlyRetry);
  });

  it("fails when the gate fails again, and the next retry runs the agent (loop guard)", async () => {
    await seedGateFailure();
    gatePasses = false;

    const { run: retry } = await runLoop();

    expect(cli.invocations).toHaveLength(0);
    expect(retry.status).toBe("failed");
    expect(retry.gateOnlyRetry).toBeDefined();
    expect(retry.completionHold?.outcome).toBe("not-applied");

    gatePasses = true;
    cli.script(agentCommits);
    const { run: next } = await runLoop();

    expect(cli.invocations).toHaveLength(1);
    expect(next.gateOnlyRetry).toBeUndefined();
    expect(printed()).toMatch(/Gate-only retry not used for run .*itself a gate-only retry/);
  });

  it("runs the agent when the working tree is dirty", async () => {
    await seedGateFailure();
    writeFileSync(join(projectDir, "scratch.ts"), "// operator's work\n", "utf-8");
    cli.script(agentCommits);

    const { run } = await runLoop();

    expect(cli.invocations).toHaveLength(1);
    expect(run.gateOnlyRetry).toBeUndefined();
    expect(printed()).toMatch(/Gate-only retry not used for run .*uncommitted changes/);
  });

  it("runs the agent when HEAD no longer contains the source run's last commit", async () => {
    await seedGateFailure();
    git(projectDir, "reset", "-q", "--hard", baseline);
    cli.script(agentCommits);

    const { run } = await runLoop();

    expect(cli.invocations).toHaveLength(1);
    expect(run.gateOnlyRetry).toBeUndefined();
    expect(printed()).toMatch(/Gate-only retry not used for run .*is not in HEAD/);
  });

  it("runs the agent when the source run failed for a reason other than the gate", async () => {
    await seedGateFailure({ testGate: undefined, error: "Agent spin detected: 9 turns with 0 tool calls." });
    cli.script(agentCommits);

    const { run } = await runLoop();

    expect(cli.invocations).toHaveLength(1);
    expect(run.gateOnlyRetry).toBeUndefined();
    expect(printed()).toMatch(/Gate-only retry not used for run .*did not fail at the test gate/);
  });

  describe("with --review", () => {
    const passingReview: RunReviewRecord = {
      model: "review-model",
      resumedSession: true,
      findingCount: 0,
      unresolvedCount: 0,
      unrepairedMustFixCount: 0,
      failedActionCount: 0,
      fixesApplied: false,
      reportPath: "/tmp/review.json",
    };

    function reportPathIn(call: CliInvocation): string {
      const match = call.stdin.match(/(\S+[\\/]\.hench[\\/]reviews[\\/][\w-]+\.json)/);
      if (!match) throw new Error("no report path in the reviewer's prompt");
      return match[1]!;
    }

    const reviewerWritesReport: ScriptedTurn = (call) => {
      const path = reportPathIn(call);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, JSON.stringify({ taskId: "task-1", fixesApplied: false, summary: "Clean.", findings: [] }));
      return { lines: [initLine("sess-review"), resultLine("sess-review", "Report written.")] };
    };

    it("inherits a passing review when HEAD is the commit the source run ended on", async () => {
      const source = await seedGateFailure({ review: passingReview });

      const { run } = await runLoop({ reviewPass: true });

      expect(cli.invocations).toHaveLength(0);
      expect(run.review).toMatchObject({ inheritedFrom: source.id, unrepairedMustFixCount: 0 });
      expect(run.status).toBe("completed");
      expect((await loadRun(henchDir, run.id)).review).toMatchObject({ inheritedFrom: source.id });
    });

    it("runs a fresh review of base..HEAD before the gate when HEAD moved on", async () => {
      await seedGateFailure({ review: passingReview });
      // Someone committed on top of the source run's work; its review no longer covers HEAD.
      commitWork("later.ts");
      cli.script(reviewerWritesReport);

      const { run } = await runLoop({ reviewPass: true });

      expect(cli.invocations).toHaveLength(1);
      const [review] = cli.invocations;
      expect(review!.args).not.toContain("--resume");
      expect(review!.stdin).toContain(`${baseline}..HEAD`);
      expect(run.review).toMatchObject({ findingCount: 0 });
      expect(run.review && "inheritedFrom" in run.review ? run.review.inheritedFrom : undefined).toBeUndefined();
      expect(gateCalls).toHaveLength(1);
      expect(gateCalls[0]!.filesChanged).toEqual(expect.arrayContaining(["feature.ts", "later.ts"]));
      expect(run.status).toBe("completed");
    });

    it("runs a fresh review when the source run had none", async () => {
      await seedGateFailure();
      cli.script(reviewerWritesReport);

      const { run } = await runLoop({ reviewPass: true });

      expect(cli.invocations).toHaveLength(1);
      expect(run.gateOnlyRetry).toBeDefined();
      expect(run.review).toMatchObject({ findingCount: 0 });
    });
  });
});
