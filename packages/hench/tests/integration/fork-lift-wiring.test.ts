import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { cleanupProjectDir, decodeClaudeDelivery } from "../helpers/index.js";
import {
  createScriptedClaudeCli,
  setupScriptedProject,
  initLine,
  toolUseLine,
  resultLine,
  resumes,
  forks,
  type CliInvocation,
  type ScriptedClaudeCli,
  type ScriptedTurn,
} from "../helpers/scripted-claude-cli.js";
import { loadConfig, saveConfig } from "../../src/store/config.js";
import {
  ORIENTATION_LIFT_NOTICE,
  buildOrientationPrompt,
  buildOrientationSystemPrompt,
} from "../../src/agent/lifecycle/orientation.js";

/**
 * `cliLoop` puts the orientation lift into the first user turn of a forked
 * task spawn (GH #473). The orientation spawn here is the real one — built by
 * `ensureWarmParent` from the real prompt builders — so the test proves the
 * fork inherits the read-only wording AND that the lift arrives with it.
 * Refusal-retry behaviour is covered in read-only-refusal-retry.test.ts.
 */

const PARENT = "sess-parent-0001";
const WORK = "sess-work-0001";
const FINGERPRINT = "abc123def456";
const PRIMER_BODY = "# Primer\n\nBuild with `pnpm build`.";

describe("cliLoop — orientation lift on forked spawns", () => {
  let projectDir: string;
  let henchDir: string;
  let rexDir: string;
  let cli: ScriptedClaudeCli;

  beforeEach(async () => {
    vi.resetModules();
    ({ projectDir, henchDir, rexDir } = await setupScriptedProject("hench-fork-lift-"));

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const actual = await vi.importActual<typeof import("node:child_process")>("node:child_process");
    cli = createScriptedClaudeCli(actual.spawn);
    vi.doMock("node:child_process", () => ({ ...actual, spawn: cli.spawn }));
  });

  afterEach(async () => {
    vi.doUnmock("node:child_process");
    vi.restoreAllMocks();
    await cleanupProjectDir(projectDir);
  });

  async function configure(strategy: "fork" | "cold"): Promise<void> {
    const config = await loadConfig(henchDir);
    await saveConfig(henchDir, {
      ...config,
      sessionStrategy: strategy,
      retry: { ...config.retry, baseDelayMs: 1, maxDelayMs: 1 },
    });
    execFileSync("git", ["commit", "-am", `${strategy} strategy`], { cwd: projectDir, stdio: "ignore" });
  }

  /** A primer stamped with the analysis fingerprint `readFreshPrimer` checks. */
  function writeFreshPrimer(): void {
    const dir = join(projectDir, ".sourcevision");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "manifest.json"), JSON.stringify({ analysisFingerprint: FINGERPRINT }), "utf-8");
    writeFileSync(
      join(dir, "PRIMER.md"),
      `<!-- sourcevision-primer fingerprint: ${FINGERPRINT} -->\n${PRIMER_BODY}\n`,
      "utf-8",
    );
    // Committed, so the task's own tree check sees only the task's work.
    execFileSync("git", ["add", ".sourcevision"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "sourcevision primer"], { cwd: projectDir, stdio: "ignore" });
  }

  const orients: ScriptedTurn = () => ({ lines: [initLine(PARENT), resultLine(PARENT, "Oriented.")] });

  /** Commits real work, so the attempt completes. */
  const works: ScriptedTurn = () => {
    writeFileSync(join(projectDir, "feature.ts"), "export const feature = 1;\n", "utf-8");
    execFileSync("git", ["add", "feature.ts"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "feat: the feature"], { cwd: projectDir, stdio: "ignore" });
    return {
      lines: [
        initLine(WORK),
        toolUseLine(WORK, "Write", { file_path: "feature.ts", content: "..." }),
        resultLine(WORK, "Committed the feature."),
      ],
    };
  };

  /** The session dies with a transient error, after reporting its id. */
  const dies: ScriptedTurn = () => ({ lines: [initLine(WORK)], code: 1 });

  const taskPromptOf = (call: CliInvocation): string => decodeClaudeDelivery(call.args, call.stdin).taskPrompt;

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
      reviewOptional: true,
    });
  }

  describe.each([
    { name: "with a fresh sourcevision primer", primed: true },
    { name: "without a primer", primed: false },
  ])("orientation spawn $name", ({ primed }) => {
    it("opens the forked task spawn's first turn with the lift", async () => {
      if (primed) writeFreshPrimer();
      await configure("fork");
      cli.script(orients, works);

      const { run } = await runLoop();

      expect(cli.invocations).toHaveLength(2);
      const [orientation, forked] = cli.invocations;

      // The parent really was built from the real orientation prompts.
      const orient = decodeClaudeDelivery(orientation!.args, orientation!.stdin);
      expect(orient.systemPrompt).toBe(buildOrientationSystemPrompt());
      expect(orient.taskPrompt).toBe(buildOrientationPrompt(primed ? PRIMER_BODY : undefined));
      expect(orient.taskPrompt).toContain("do not modify anything");
      expect(orient.taskPrompt.includes("## Existing primer")).toBe(primed);

      // ...and the fork that inherits it is told that phase is over.
      expect(resumes(forked!, PARENT) && forks(forked!)).toBe(true);
      expect(taskPromptOf(forked!).startsWith(ORIENTATION_LIFT_NOTICE)).toBe(true);
      expect(run.error).toBeUndefined();
      expect(run.status).toBe("completed");
    });
  });

  it("does not add the lift to a cold spawn", async () => {
    await configure("cold");
    cli.script(works);

    await runLoop();

    expect(cli.invocations).toHaveLength(1);
    const [cold] = cli.invocations;
    expect(cold!.args).not.toContain("--resume");
    expect(taskPromptOf(cold!)).not.toContain(ORIENTATION_LIFT_NOTICE);
  });

  it("does not add the lift to a fork-fallback re-spawn or a retry-resume", async () => {
    await configure("fork");
    // The fork dies, so the stale-parent fallback re-spawns cold. That dies
    // too, so the next attempt is a retry-resume of the session that reported an id.
    cli.script(orients, dies, dies, works);

    const { run } = await runLoop();

    expect(cli.invocations).toHaveLength(4);
    const [, forked, fallback, retry] = cli.invocations;
    expect(resumes(forked!, PARENT) && forks(forked!)).toBe(true);
    expect(taskPromptOf(forked!).startsWith(ORIENTATION_LIFT_NOTICE)).toBe(true);

    expect(fallback!.args).not.toContain("--resume");
    expect(taskPromptOf(fallback!)).not.toContain(ORIENTATION_LIFT_NOTICE);

    expect(resumes(retry!, WORK)).toBe(true);
    expect(forks(retry!)).toBe(false);
    expect(taskPromptOf(retry!)).not.toContain(ORIENTATION_LIFT_NOTICE);
    expect(run.status).toBe("completed");
  });
});
