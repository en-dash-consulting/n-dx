/**
 * Codex session resume is a contract, checked end to end without credentials.
 *
 * `batch-chain.test.ts` proves that every way a chain can be wrong produces a
 * named rejection. What it cannot prove is that the rejection *arrives* — the
 * verdict and the `codex exec resume` argv are two thousand lines apart in
 * `cli-loop.ts`, and the failure this feature exists to prevent is precisely a
 * decision that is computed correctly and then not acted on. So these drive the
 * real loop through a scripted codex CLI and assert on the argv the CLI would
 * have parsed:
 *
 *   - an eligible chain resumes **exactly once**, with the exact arguments; and
 *   - an unsafe chain's session id never appears in an argv token at all.
 *
 * Nothing here spawns codex or reaches a network: `createScriptedClaudeCli`
 * answers every vendor-CLI spawn from a fixture, so the file runs unchanged in
 * CI. That matters more than it sounds — `codex-flag-surface.test.ts`, the only
 * other test that looks at resume argv, skips itself when codex is absent, which
 * is every CI leg.
 *
 * The chain under test is never hand-written. Each case runs a first task to
 * completion and lets `settleBatchChain` persist the chain, then edits one field
 * of what production wrote. A hand-built identity would pass whatever this test
 * believed the fields were; this one fails if `cli-loop` and the cache ever
 * disagree about them.
 *
 * @see packages/hench/src/agent/lifecycle/session-cache.ts — isBatchChainUsable
 * @see packages/hench/src/agent/lifecycle/adapters/codex-cli-adapter.ts
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { serializeDocument } from "@n-dx/rex";
import { cleanupProjectDir } from "../helpers/index.js";
import {
  createScriptedClaudeCli,
  setupScriptedProject,
  type CliInvocation,
  type ScriptedClaudeCli,
  type ScriptedTurn,
} from "../helpers/scripted-claude-cli.js";
import { loadConfig, saveConfig } from "../../src/store/config.js";
import {
  BATCH_CHAIN_VERSION,
  SESSION_CACHE_FILE,
  type BatchChainEntry,
  type BatchChainRejection,
} from "../../src/agent/lifecycle/session-cache.js";

/** The thread the first task opens, and the only id a resume may name. */
const THREAD = "01a05958-2931-73f1-9aba-38fa915bb8df";

/** An hour, for moving a chain's stamps past a bound. */
const HOUR = 3_600_000;

describe("codex batch resume — contract", () => {
  let projectDir: string;
  let henchDir: string;
  let rexDir: string;
  let cli: ScriptedClaudeCli;

  beforeEach(async () => {
    vi.resetModules();
    ({ projectDir, henchDir, rexDir } = await setupScriptedProject("hench-codex-resume-"));

    // Two tasks, because the chain only exists *between* tasks: the first opens
    // the session and the second is the one that may or may not resume it.
    await writeFile(
      join(rexDir, "prd.md"),
      serializeDocument({
        schema: "rex/v1",
        title: "Test",
        items: [
          { id: "task-1", title: "First task", status: "pending", level: "task", priority: "high" },
          { id: "task-2", title: "Second task", status: "pending", level: "task", priority: "high" },
        ],
      } as never),
      "utf-8",
    );

    const config = await loadConfig(henchDir);
    await saveConfig(henchDir, { ...config, sessionStrategy: "batch" });
    writeFileSync(join(projectDir, ".n-dx.json"), JSON.stringify({ llm: { vendor: "codex" } }), "utf-8");
    execFileSync("git", ["add", "-A"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "codex vendor, batch strategy"], { cwd: projectDir, stdio: "ignore" });

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

  // ── Fixture plumbing ──────────────────────────────────────────────────────

  /**
   * A codex session that does the work, commits it, and reports `THREAD`.
   *
   * It must commit: completion is git-derived, and an uncommitted task fails —
   * at which point `settleBatchChain` clears the chain rather than advancing it,
   * and every case below would be testing the same empty cache.
   */
  const worksAndCommits = (file: string): ScriptedTurn => () => {
    writeFileSync(join(projectDir, file), `export const ${file.replace(/\W/g, "_")} = 1;\n`, "utf-8");
    execFileSync("git", ["add", file], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", `feat: ${file}`], { cwd: projectDir, stdio: "ignore" });
    return {
      lines: [
        { type: "thread.started", thread_id: THREAD },
        { type: "item.completed", item: { id: "i1", type: "agent_message", text: `Wrote and committed ${file}.` } },
        { type: "turn.completed", usage: { input_tokens: 10, output_tokens: 5 } },
      ],
    };
  };

  async function runTask(taskId: string) {
    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");
    return cliLoop({
      config: await loadConfig(henchDir),
      store: createStore("file", rexDir),
      projectDir,
      henchDir,
      taskId,
      autonomous: true,
      yes: true,
      reviewOptional: true,
    });
  }

  const cachePath = (): string => join(henchDir, SESSION_CACHE_FILE);

  async function readChain(): Promise<BatchChainEntry> {
    const file = JSON.parse(await readFile(cachePath(), "utf-8")) as { batch?: BatchChainEntry };
    if (!file.batch) throw new Error("fixture: the first task left no batch chain to test against");
    return file.batch;
  }

  async function writeChain(batch: BatchChainEntry): Promise<void> {
    const file = JSON.parse(await readFile(cachePath(), "utf-8")) as Record<string, unknown>;
    await writeFile(cachePath(), `${JSON.stringify({ ...file, batch }, null, 2)}\n`, "utf-8");
  }

  /**
   * Run the first task and hand back the chain production wrote for it.
   *
   * Returns the invocations too, so a case can assert that the *opening* spawn
   * was a plain `exec` — a resume on the first task would mean the cache served
   * something it had no business having.
   */
  async function seedChain(): Promise<{ chain: BatchChainEntry; opening: CliInvocation }> {
    cli.script(worksAndCommits("feature-one.ts"));
    const { run } = await runTask("task-1");
    expect(run.status, `fixture: first task did not complete (${run.error ?? "no error"})`).toBe("completed");
    const opening = cli.invocations[0]!;
    expect(opening.args[0]).toBe("exec");
    expect(opening.args[1]).not.toBe("resume");
    cli.invocations.length = 0;

    // Land everything the first run left behind — it writes a `.gitignore`,
    // which is not hench runtime state and so is not excused by the
    // uncommitted-work gate. Between two tasks of a real loop the tree is clean;
    // without this the second task fails the gate before its resume decision
    // could matter, and every case below would be reading a cleared chain.
    execFileSync("git", ["add", "-A"], { cwd: projectDir, stdio: "ignore" });
    execFileSync("git", ["commit", "-m", "chore: land the first task", "--allow-empty"], {
      cwd: projectDir,
      stdio: "ignore",
    });

    return { chain: await readChain(), opening };
  }

  // ── An eligible chain resumes, exactly once, with these arguments ─────────

  it("resumes an eligible chain exactly once, with the exact codex exec resume argv", async () => {
    await seedChain();

    cli.script(worksAndCommits("feature-two.ts"));
    const { run } = await runTask("task-2");

    expect(run.status, run.error ?? "no error").toBe("completed");
    expect(cli.invocations).toHaveLength(1);
    // Exact, not "contains": a resume that also carried `-s`/`--approve-for-me`
    // dies on codex's own argument parsing, and one that carried `--last` would
    // capture whichever session the machine touched most recently.
    expect(cli.invocations[0]!.args).toEqual([
      "exec",
      "resume",
      THREAD,
      "--json",
      "--skip-git-repo-check",
      "-",
    ]);
    expect(run.session).toMatchObject({ strategy: "batch", outcome: "hit", reason: "chain-continued" });
    expect(run.session?.sessionId).toBe(THREAD);
  });

  it("counts the resumed task against the chain rather than restarting it", async () => {
    const { chain } = await seedChain();
    expect(chain.tasksUsed).toBe(1);

    cli.script(worksAndCommits("feature-two.ts"));
    await runTask("task-2");

    const after = await readChain();
    expect(after.tasksUsed).toBe(2);
    expect(after.sessionId).toBe(THREAD);
    // The total-age bound measures from the chain's first task, so a continuing
    // chain must not restamp it — that would make the bound unreachable.
    expect(after.createdAt).toBe(chain.createdAt);
  });

  // ── An unsafe chain never reaches the spawned command ─────────────────────

  /**
   * One edit to the chain production wrote, and the rejection it must produce.
   *
   * Every {@link BatchChainRejection} that a persisted entry can carry is here.
   * The three that cannot be reached by editing an entry are excluded by
   * construction: `no-chain` and `disabled` are the absence of one, and
   * `malformed` is covered by the unparseable-stamp case below (it shares the
   * expired path). Typing the tuple as the rejection union means a renamed code
   * fails to compile rather than silently testing nothing.
   */
  const UNSAFE: Array<[BatchChainRejection, (chain: BatchChainEntry) => BatchChainEntry]> = [
    ["worktree-changed", (c) => ({ ...c, worktreeRoot: join(c.worktreeRoot, "..", "other-checkout") })],
    ["ref-changed", (c) => ({ ...c, ref: "some-other-branch" })],
    ["sourcevision-changed", (c) => ({ ...c, svFingerprint: "a-different-analysis" })],
    ["policy-changed", (c) => ({ ...c, policyHash: "a0a0a0a0a0a0a0a0" })],
    ["vendor-changed", (c) => ({ ...c, vendor: "claude" })],
    ["model-changed", (c) => ({ ...c, model: "some-other-model" })],
    ["unversioned", (c) => ({ ...c, version: 0 })],
    ["version-changed", (c) => ({ ...c, version: BATCH_CHAIN_VERSION + 1 })],
    ["malformed", (c) => ({ ...c, lastUsedAt: "not a timestamp" })],
    [
      "expired",
      (c) => ({
        ...c,
        createdAt: new Date(Date.now() - 9 * HOUR).toISOString(),
        lastUsedAt: new Date(Date.now() - 9 * HOUR).toISOString(),
      }),
    ],
    ["idle", (c) => ({ ...c, lastUsedAt: new Date(Date.now() - 2 * HOUR).toISOString() })],
    ["cap-reached", (c) => ({ ...c, tasksUsed: 4 })],
  ];

  it.each(UNSAFE)("never spawns a resume for a chain rejected as %s", async (reason, mutate) => {
    const { chain } = await seedChain();
    await writeChain(mutate(chain));

    cli.script(worksAndCommits("feature-two.ts"));
    const { run } = await runTask("task-2");

    expect(cli.invocations).toHaveLength(1);
    const spawned = cli.invocations[0]!;

    // The load-bearing assertion: not merely "argv[1] is not resume", but that
    // the session id is absent from every token. A resume built some other way
    // — a `--last`, a config override, a future flag — still fails this.
    expect(spawned.args).not.toContain("resume");
    expect(spawned.args.some((arg) => arg.includes(THREAD))).toBe(false);
    expect(spawned.args[0]).toBe("exec");

    // And the run record says why, so the operator is not left guessing which
    // of the twelve reasons cost them the chain.
    expect(run.session).toMatchObject({ strategy: "batch", outcome: "miss", reason });
  });

  it("drops the rejected chain rather than leaving it for the next task to reconsider", async () => {
    const { chain } = await seedChain();
    await writeChain({ ...chain, policyHash: "a0a0a0a0a0a0a0a0" });

    cli.script(worksAndCommits("feature-two.ts"));
    await runTask("task-2");

    // The second task opened its own session under the current identity; the
    // one built under the old policy is gone, not merely unused.
    const after = await readChain();
    expect(after.policyHash).toBe(chain.policyHash);
    expect(after.tasksUsed).toBe(1);
  });

  // ── The other direction: a strategy that resumes nothing ──────────────────

  it("never resumes under the cold strategy, however good the chain is", async () => {
    await seedChain();

    const config = await loadConfig(henchDir);
    await saveConfig(henchDir, { ...config, sessionStrategy: "cold" });

    cli.script(worksAndCommits("feature-two.ts"));
    const { run } = await runTask("task-2");

    expect(cli.invocations).toHaveLength(1);
    expect(cli.invocations[0]!.args).not.toContain("resume");
    expect(cli.invocations[0]!.args.some((arg) => arg.includes(THREAD))).toBe(false);
    expect(run.session).toMatchObject({ strategy: "cold", outcome: "miss" });
  });
});
