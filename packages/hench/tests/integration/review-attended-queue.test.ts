import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
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
import { loadConfig } from "../../src/store/config.js";
import type { ReviewFinding } from "../../src/agent/analysis/adversarial-review.js";

/**
 * Offered review findings reach the pending queue on an attended run too
 * (PR BG, task 95b81c0a).
 *
 * The defect: on an attended run (a TTY, no --yes) the reviewer was told to
 * "offer to capture; capture only what the user selects". The reviewer is a
 * headless `claude -p` session, so no selection could ever reach it; its
 * findings ended `offered`, only autonomous runs parked anything, and
 * `hench review pending` answered "No deferred findings". Runs a32aeeb0 and
 * 8dc53406 each lost a finding that way.
 */

const WORK_SESSION = "sess-work-0003";
const REVIEW_SESSION = "sess-review-0003";

function reportPathIn(call: CliInvocation): string {
  const match = call.stdin.match(/(\S+[\\/]\.hench[\\/]reviews[\\/][\w-]+\.json)/);
  if (!match) throw new Error("no report path in the reviewer's prompt");
  return match[1]!;
}

const OFFERED: ReviewFinding = {
  title: "Tuner reports cache TTL in the wrong units",
  location: "feature.ts:1",
  severity: "medium",
  verdict: "should-fix",
  scenario: "Set promptCacheTtl to 1h -> the tuner prints 3600 minutes -> operator mis-sizes the budget",
  // What the attended brief now asks for: reported, not captured.
  action: "dropped",
  disposition: "offered",
};

describe("cliLoop — offered review findings on an attended run", () => {
  let projectDir: string;
  let henchDir: string;
  let rexDir: string;
  let cli: ScriptedClaudeCli;
  let printed: string[];
  let ttyDescriptor: PropertyDescriptor | undefined;

  beforeEach(async () => {
    vi.resetModules();
    ({ projectDir, henchDir, rexDir } = await setupScriptedProject("hench-review-attended-"));

    printed = [];
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      printed.push(args.map(String).join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    const scripted = createScriptedClaudeCli(actual.spawn);
    cli = scripted;
    vi.doMock("node:child_process", () => ({ ...actual, spawn: scripted.spawn }));

    ttyDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
  });

  afterEach(async () => {
    if (ttyDescriptor) Object.defineProperty(process.stdin, "isTTY", ttyDescriptor);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
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
      JSON.stringify({ taskId: "task-1", fixesApplied: false, summary: "Attacked the tuner.", findings }),
      "utf-8",
    );
    return {
      lines: [
        initLine(REVIEW_SESSION),
        toolUseLine(REVIEW_SESSION, "Write", { file_path: path, content: "..." }),
        resultLine(REVIEW_SESSION, "Report written."),
      ],
    };
  };

  async function runLoop(attended: boolean) {
    Object.defineProperty(process.stdin, "isTTY", { value: attended, configurable: true });
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");
    const config = await loadConfig(henchDir);
    return cliLoop({
      config,
      store: createStore("file", rexDir),
      projectDir,
      henchDir,
      taskId: "task-1",
      autonomous: !attended,
      yes: !attended,
      reviewPass: true,
    });
  }

  async function reviewPending(runId: string): Promise<string> {
    const { cmdReview } = await import("../../src/cli/commands/review.js");
    printed.length = 0;
    await cmdReview(projectDir, ["pending", runId], {});
    return printed.join("\n");
  }

  it("lists an attended review's offered finding in `hench review pending`", async () => {
    cli.script(workCommits, reviewerReports([OFFERED]));

    const { run } = await runLoop(true);

    expect(run.status).toBe("completed");
    expect(run.review).toMatchObject({ findingCount: 1, deferredCount: 1 });
    expect(printed.join("\n")).toContain(`1 finding(s) queued for your decision`);

    const pending = await reviewPending(run.id);
    expect(pending).toContain("1 deferred finding(s)");
    expect(pending).toContain(OFFERED.title);
    expect(pending).toContain(OFFERED.scenario);
  });

  it("no longer tells an attended reviewer to wait for a selection it cannot receive", async () => {
    cli.script(workCommits, reviewerReports([OFFERED]));

    await runLoop(true);

    const brief = cli.invocations[1]!.stdin;
    expect(brief).toMatch(/Do not stop to ask, and do not capture/);
    expect(brief).not.toMatch(/wait for an explicit selection/);
    expect(brief).not.toMatch(/capture only what the user selects/);
  });

  it("leaves autonomous capture as it was: the reviewer captures, and a captured finding is not queued", async () => {
    const captured: ReviewFinding = { ...OFFERED, action: "captured", itemId: "item-123", disposition: "offered" };
    cli.script(workCommits, reviewerReports([captured]));

    const { run } = await runLoop(false);

    const brief = cli.invocations[1]!.stdin;
    expect(brief).toContain(
      "| `should-fix` | Capture as a PRD task with `add_item` (rex MCP). Do not fix it here. | `captured` | `offered` |",
    );
    expect(brief).toMatch(/Do not stop to ask\.\*\* The skill's Step 5/);
    expect(run.review).toMatchObject({ findingCount: 1 });
    expect(run.review && "deferredCount" in run.review ? run.review.deferredCount : undefined)
      .toBeUndefined();
    expect(await reviewPending(run.id)).toContain("No deferred findings");
  });
});
