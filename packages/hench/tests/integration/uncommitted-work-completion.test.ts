import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { exec as execCb } from "node:child_process";
import { randomUUID } from "node:crypto";
import { initConfig } from "../../src/store/config.js";
import type { RunRecord } from "../../src/schema/index.js";
import { PRD_TREE_DIRNAME, openClaimsStore, resolveClaimHolder } from "../../src/prd/rex-gateway.js";
import { TaskClaims } from "../../src/process/task-claims.js";
import { initGitFixtureRepo, RM_RETRY } from "../helpers/index.js";

const execAsync = promisify(execCb);

/**
 * The uncommitted-work gate, end to end through finalizeRun (#363).
 *
 * The defect these cover: a run finished, the agent's files were never
 * committed, and the only thing that landed was hench's own PRD-status commit
 * — so the task read `completed` while its work sat in the working tree.
 */
describe("finalizeRun — uncommitted-work gate", () => {
  const taskId = "task-abc-123";
  let projectDir: string;
  let henchDir: string;
  let taskIndexPath: string;
  let statuses: string[];

  function buildCompletedRun(): RunRecord {
    return {
      id: randomUUID(),
      taskId,
      taskTitle: "Test task",
      startedAt: new Date().toISOString(),
      status: "completed",
      turns: 3,
      tokenUsage: { input: 100, output: 50 },
      turnTokenUsage: [],
      toolCalls: [],
      model: "test-model",
    };
  }

  /** A store that mirrors status writes onto the tracked PRD file, as the real one does. */
  function buildStore() {
    let status = "in_progress";
    return {
      getItem: vi.fn(async (id: string) =>
        id === taskId ? { id: taskId, status, title: "Test task", level: "task" } : null,
      ),
      updateItem: vi.fn(async (id: string, updates: Record<string, unknown>) => {
        if (id !== taskId || typeof updates.status !== "string") return;
        const next = updates.status;
        statuses.push(next);
        const current = readFileSync(taskIndexPath, "utf-8").replace(/\r\n/g, "\n");
        await writeFile(taskIndexPath, current.replace(`status: ${status}`, `status: ${next}`), "utf-8");
        status = next;
      }),
      appendLog: vi.fn(async () => {}),
      loadDocument: vi.fn(async () => ({ items: [] })),
    };
  }

  async function runFinalize(
    run: RunRecord,
    store: ReturnType<typeof buildStore>,
    // The autoCommit path is where the defect was first observed: the executor
    // is expected to have committed its own work already, so nothing downstream
    // picks up whatever it left behind. The commit-prompt path (autoCommit
    // false) has its own describe below.
    autoCommit = true,
    claims?: TaskClaims,
  ): Promise<void> {
    const { finalizeRun } = await import("../../src/agent/lifecycle/shared.js");
    await (finalizeRun as Function)({
      run,
      henchDir,
      projectDir,
      autoCommit,
      skipFullTestGate: true,
      autonomous: true,
      store,
      claims,
    });
  }

  /** A review record whose report is usable and which changed `repairedFiles`. */
  function buildUsableReview(repairedFiles: string[]): RunRecord["review"] {
    return {
      model: "test-reviewer",
      resumedSession: false,
      findingCount: 1,
      unresolvedCount: 0,
      unrepairedMustFixCount: 0,
      failedActionCount: 0,
      fixesApplied: repairedFiles.length > 0,
      reportPath: join(henchDir, "reviews", "report.json"),
      repairedFiles,
    };
  }

  async function porcelain(): Promise<string> {
    const { stdout } = await execAsync("git status --porcelain", { cwd: projectDir });
    return stdout;
  }

  async function headFiles(): Promise<string[]> {
    const { stdout } = await execAsync("git show --name-only --format= HEAD", { cwd: projectDir });
    return stdout.split("\n").filter(Boolean);
  }

  beforeEach(async () => {
    statuses = [];
    projectDir = await mkdtemp(join(tmpdir(), "hench-uncommitted-work-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);
    await mkdir(join(henchDir, "runs"), { recursive: true });

    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    await initGitFixtureRepo(projectDir);

    const taskDir = join(projectDir, ".rex", PRD_TREE_DIRNAME, "task-slug-abc");
    await mkdir(taskDir, { recursive: true });
    taskIndexPath = join(taskDir, "index.md");
    await writeFile(taskIndexPath, "# Test task\nstatus: in_progress\n", "utf-8");

    await execAsync("git add .", { cwd: projectDir });
    await execAsync('git commit -m "initial"', { cwd: projectDir });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true, ...RM_RETRY });
  });

  it("completes as before when the agent committed its work", async () => {
    await writeFile(join(projectDir, "src.ts"), "export const a = 1;\n", "utf-8");
    await execAsync("git add .", { cwd: projectDir });
    await execAsync('git commit -m "feat: the work"', { cwd: projectDir });

    const run = buildCompletedRun();
    await runFinalize(run, buildStore());

    expect(run.status).toBe("completed");
    expect(statuses).toEqual(["completed"]);
  });

  it("refuses to complete while the agent's files are uncommitted, and names them", async () => {
    // Exactly what was observed: a new test file and a stray scratch log, both
    // written by the agent and neither of them committed.
    await writeFile(join(projectDir, "git-origin.test.ts"), "// 18 passing tests\n", "utf-8");
    await writeFile(join(projectDir, "root-test-output.log"), "vitest output\n", "utf-8");

    const run = buildCompletedRun();
    await runFinalize(run, buildStore());

    expect(run.status).toBe("failed");
    expect(run.error).toContain("git-origin.test.ts");
    expect(run.error).toContain("root-test-output.log");
    expect(statuses).not.toContain("completed");
  });

  it("withdraws a completion the agent already wrote to the PRD itself", async () => {
    // The agent is told to call update_task_status before the run ends, so the
    // PRD can already read `completed` by the time the gate fires. Leaving it
    // there is the half of the defect where the status reports the opposite of
    // the truth.
    await writeFile(join(projectDir, "leaked.ts"), "export const leaked = true;\n", "utf-8");
    const store = buildStore();
    await store.updateItem(taskId, { status: "completed" });
    await execAsync("git add .rex", { cwd: projectDir });
    await execAsync('git commit -m "chore(prd): agent status write"', { cwd: projectDir });
    statuses.length = 0;

    const run = buildCompletedRun();
    await runFinalize(run, store);

    expect(run.status).toBe("failed");
    expect(statuses).toEqual(["pending"]);
  });

  it("leaves the refused work in place — nothing is reverted", async () => {
    await writeFile(join(projectDir, "leaked.ts"), "export const leaked = true;\n", "utf-8");

    const run = buildCompletedRun();
    await runFinalize(run, buildStore());

    const { stdout } = await execAsync("git status --porcelain", { cwd: projectDir });
    expect(stdout).toContain("leaked.ts");
  });

  it("completes when the only dirt is hench's own runtime artifacts", async () => {
    await mkdir(join(henchDir, "locks"), { recursive: true });
    await writeFile(join(henchDir, "locks", "1234.lock"), "pid\n", "utf-8");
    await writeFile(join(henchDir, "runs", "run-1.json"), "{}\n", "utf-8");

    const run = buildCompletedRun();
    await runFinalize(run, buildStore());

    expect(run.status).toBe("completed");
    expect(statuses).toEqual(["completed"]);
  });

  /**
   * The cross-worktree claim across the refusal (PR E, audit item c943aa11).
   *
   * The refusal must leave the claims store holding the task with reason
   * `uncommitted-work` — through the run's own `releaseAll` in its `finally` —
   * so another worktree cannot pick the task up and redo work that is sitting
   * uncommitted here. Observed broken on 2026-09-23 (run 01c990df): the
   * spawned agent's own `rex_update_status(completed)` released the claim
   * through the MCP server mid-run, and the hold at refusal time then found
   * nothing to hold.
   */
  describe("cross-worktree claim on refusal", () => {
    async function readClaimEntries() {
      return openClaimsStore(projectDir).readClaims();
    }

    it("a refused completion leaves the claim held with reason uncommitted-work", async () => {
      const claims = TaskClaims.forProject(projectDir);
      expect(await claims.claim(taskId)).toBeNull();
      await writeFile(join(projectDir, "leaked.ts"), "export const leaked = true;\n", "utf-8");

      const run = buildCompletedRun();
      await runFinalize(run, buildStore(), true, claims);
      // The run's `finally` — must not free what the refusal held. This is
      // the assertion that fails if the hold in finalizeRun were replaced
      // with a release.
      await claims.releaseAll();

      expect(run.status).toBe("failed");
      const entries = await readClaimEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ taskId, reason: "uncommitted-work" });
    });

    it("re-asserts a claim the agent's own status write already released (run 01c990df)", async () => {
      const claims = TaskClaims.forProject(projectDir);
      await claims.claim(taskId);
      // What the CLI provider's spawned agent does mid-run: it calls
      // rex_update_status(completed) through the rex MCP server, whose
      // handler releases the claim for every completing status
      // (CLAIM_RELEASING_STATUSES in rex's mcp-tools). The completion is then
      // refused here, after the claim is already gone.
      const holder = resolveClaimHolder(projectDir);
      await openClaimsStore(projectDir).release(taskId, { worktreeRoot: holder.worktreeRoot });
      expect(await readClaimEntries()).toHaveLength(0);

      await writeFile(join(projectDir, "leaked.ts"), "export const leaked = true;\n", "utf-8");
      const run = buildCompletedRun();
      await runFinalize(run, buildStore(), true, claims);
      await claims.releaseAll();

      expect(run.status).toBe("failed");
      const entries = await readClaimEntries();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ taskId, reason: "uncommitted-work" });
    });

    it("an ordinary completion still releases the claim", async () => {
      const claims = TaskClaims.forProject(projectDir);
      await claims.claim(taskId);
      await writeFile(join(projectDir, "src.ts"), "export const a = 1;\n", "utf-8");
      await execAsync("git add .", { cwd: projectDir });
      await execAsync('git commit -m "feat: the work"', { cwd: projectDir });

      const run = buildCompletedRun();
      await runFinalize(run, buildStore(), true, claims);
      await claims.releaseAll();

      expect(run.status).toBe("completed");
      expect(await readClaimEntries()).toHaveLength(0);
    });
  });

  /**
   * The commit-prompt path (hench.autoCommit=false, the default). Here the
   * gate may discount the staged index — but only when the commit prompt will
   * really run, which takes a non-empty .hench-commit-msg.txt (PR #370 review,
   * findings 4 and 5).
   */
  describe("with the commit prompt (autoCommit=false)", () => {
    const message = "feat: the work\n\nBody of the proposed commit.\n";

    async function writePendingMessage(content = message): Promise<void> {
      await writeFile(join(projectDir, ".hench-commit-msg.txt"), content, "utf-8");
    }

    it("refuses staged work when no commit message was written, and leaves it staged", async () => {
      // The agent ran `git add -A` but never wrote the message file. Before
      // the fix every path read `A  …`, was discounted as "about to be
      // committed", and then performCommitPromptIfNeeded returned early with
      // nothing to commit — the #363 symptom with the index as the hiding place.
      await writeFile(join(projectDir, "src.ts"), "export const a = 1;\n", "utf-8");
      await execAsync("git add src.ts", { cwd: projectDir });

      const run = buildCompletedRun();
      await runFinalize(run, buildStore(), false);

      expect(run.status).toBe("failed");
      expect(run.error).toContain("src.ts");
      expect(statuses).not.toContain("completed");
      expect(await porcelain()).toContain("A  src.ts");
    });

    it("treats an empty message file the same as a missing one", async () => {
      await writeFile(join(projectDir, "src.ts"), "export const a = 1;\n", "utf-8");
      await execAsync("git add src.ts", { cwd: projectDir });
      await writePendingMessage("   \n");

      const run = buildCompletedRun();
      await runFinalize(run, buildStore(), false);

      expect(run.status).toBe("failed");
      expect(run.error).toContain("src.ts");
    });

    it("completes staged work with a pending message, and the commit lands", async () => {
      await writeFile(join(projectDir, "src.ts"), "export const a = 1;\n", "utf-8");
      await execAsync("git add src.ts", { cwd: projectDir });
      await writePendingMessage();

      const run = buildCompletedRun();
      await runFinalize(run, buildStore(), false);

      expect(run.status).toBe("completed");
      expect(statuses).toEqual(["completed"]);
      const { stdout: subject } = await execAsync("git log -1 --format=%s", { cwd: projectDir });
      expect(subject.trim()).toBe("feat: the work");
      expect(await headFiles()).toContain("src.ts");
      expect(await porcelain()).not.toContain("src.ts");
    });

    it("discounts reviewer repairs, stages them, and lands them in the executor's commit", async () => {
      // The reviewer is told not to commit — "your fixes are picked up by that
      // commit" — so its edits arrive unstaged (` M`). Before the fix they were
      // only discounted on autoCommit, the gate refused the run, and the
      // executor's staged work never landed either.
      await writeFile(join(projectDir, "lib.ts"), "export const lib = 1;\n", "utf-8");
      await execAsync("git add lib.ts", { cwd: projectDir });
      await execAsync('git commit -m "chore: lib"', { cwd: projectDir });

      await writeFile(join(projectDir, "src.ts"), "export const a = 1;\n", "utf-8");
      await execAsync("git add src.ts", { cwd: projectDir });
      await writeFile(join(projectDir, "lib.ts"), "export const lib = 2; // repaired\n", "utf-8");
      await writePendingMessage();

      const run = buildCompletedRun();
      run.review = buildUsableReview(["lib.ts"]);
      await runFinalize(run, buildStore(), false);

      expect(run.status).toBe("completed");
      const committed = await headFiles();
      expect(committed).toContain("src.ts");
      expect(committed).toContain("lib.ts");
      expect(await porcelain()).not.toMatch(/(src|lib)\.ts/);
    });

    it("commits reviewer repairs even when the executor left the index empty", async () => {
      // The executor committed its own work despite being told to stage it,
      // so at finalize nothing is staged. The gate discounts the repairs on
      // the promise the prompt stages them — so the prompt must stage them
      // before it decides there is "nothing to commit" and skips.
      await writeFile(join(projectDir, "lib.ts"), "export const lib = 1;\n", "utf-8");
      await execAsync("git add lib.ts", { cwd: projectDir });
      await execAsync('git commit -m "chore: lib"', { cwd: projectDir });
      await writeFile(join(projectDir, "src.ts"), "export const a = 1;\n", "utf-8");
      await execAsync("git add src.ts", { cwd: projectDir });
      await execAsync('git commit -m "feat: executor committed itself"', { cwd: projectDir });

      await writeFile(join(projectDir, "lib.ts"), "export const lib = 2; // repaired\n", "utf-8");
      await writePendingMessage();

      const run = buildCompletedRun();
      run.review = buildUsableReview(["lib.ts"]);
      await runFinalize(run, buildStore(), false);

      expect(run.status).toBe("completed");
      expect(await headFiles()).toContain("lib.ts");
      expect(await porcelain()).not.toContain("lib.ts");
    });

    /**
     * The repairs discount rests on a commit that never happens (caos run
     * 2fb96507). `commitReviewRepairsIfNeeded` runs only on autoCommit, and
     * the commit prompt returns early when `.hench-commit-msg.txt` is missing
     * or empty — so with autoCommit off and no message file, nothing commits
     * the repairs, exactly as nothing commits the staged index. The staged
     * exclusion beside it already asked `pendingCommitMessageExists`; this one
     * did not.
     *
     * It matters because a "repair" is every path the review pass changed
     * (`diffDirtyState` in cli-loop.ts), which includes files the agent created
     * and the reviewer then edited. In 2fb96507 that was the entire feature.
     */
    it("names review repairs when no commit will follow (run 2fb96507)", async () => {
      // What the run left behind: a dependency bump to the manifests, and a new
      // module plus its test, both of which the reviewer went on to edit.
      await writeFile(join(projectDir, "package.json"), '{"name":"app"}\n', "utf-8");
      await writeFile(join(projectDir, "package-lock.json"), "{}\n", "utf-8");
      await execAsync("git add package.json package-lock.json", { cwd: projectDir });
      await execAsync('git commit -m "chore: manifests"', { cwd: projectDir });
      await writeFile(join(projectDir, "package.json"), '{"name":"app","dependencies":{}}\n', "utf-8");
      await writeFile(join(projectDir, "package-lock.json"), '{"lockfileVersion":3}\n', "utf-8");

      await mkdir(join(projectDir, "app", "utils"), { recursive: true });
      await writeFile(join(projectDir, "app/utils/mcp-auth.server.ts"), "export const auth = 1;\n", "utf-8");
      await writeFile(join(projectDir, "app/utils/mcp-auth.server.test.ts"), "// covers auth\n", "utf-8");

      const run = buildCompletedRun();
      run.review = buildUsableReview([
        "app/utils/mcp-auth.server.ts",
        "app/utils/mcp-auth.server.test.ts",
      ]);
      await runFinalize(run, buildStore(), false);

      expect(run.status).toBe("failed");
      expect(statuses).not.toContain("completed");
      // The refusal named only the manifests; its "commit exactly these paths"
      // commands would have left the feature itself behind.
      expect(run.error).toContain("package.json");
      expect(run.error).toContain("app/utils/mcp-auth.server.ts");
      expect(run.error).toContain("app/utils/mcp-auth.server.test.ts");
      const addCommand = (run.error ?? "").split("\n").find((l) => l.includes("git add --")) ?? "";
      expect(addCommand).toContain("app/utils/mcp-auth.server.ts");
      expect(addCommand).toContain("app/utils/mcp-auth.server.test.ts");
    });

    it("refuses when the repairs are the only work left, instead of completing silently", async () => {
      // The sharper form of the same defect: with nothing else dirty the
      // discount made the tree look clean, so the task reached `completed`
      // with its whole diff still untracked and no refusal printed at all.
      await mkdir(join(projectDir, "app", "utils"), { recursive: true });
      await writeFile(join(projectDir, "app/utils/mcp-auth.server.ts"), "export const auth = 1;\n", "utf-8");

      const run = buildCompletedRun();
      run.review = buildUsableReview(["app/utils/mcp-auth.server.ts"]);
      await runFinalize(run, buildStore(), false);

      expect(run.status).toBe("failed");
      expect(run.error).toContain("app/utils/mcp-auth.server.ts");
      expect(statuses).not.toContain("completed");
      // Nothing is discarded — `-uall` because the gate's own listing uses it,
      // and the default collapses a wholly-untracked directory to `app/`.
      const { stdout } = await execAsync("git status --porcelain --untracked-files=all", {
        cwd: projectDir,
      });
      expect(stdout).toContain("app/utils/mcp-auth.server.ts");
    });

    it("does not discount repairs when the review produced no usable report", async () => {
      await writeFile(join(projectDir, "lib.ts"), "export const lib = 1;\n", "utf-8");
      await execAsync("git add lib.ts", { cwd: projectDir });
      await execAsync('git commit -m "chore: lib"', { cwd: projectDir });

      await writeFile(join(projectDir, "src.ts"), "export const a = 1;\n", "utf-8");
      await execAsync("git add src.ts", { cwd: projectDir });
      await writeFile(join(projectDir, "lib.ts"), "export const lib = 2;\n", "utf-8");
      await writePendingMessage();

      const run = buildCompletedRun();
      run.review = { failed: "reviewer_crashed", detail: "no report written" };
      await runFinalize(run, buildStore(), false);

      expect(run.status).toBe("failed");
      expect(run.error).toContain("lib.ts");
      expect(run.error).not.toContain("src.ts");
    });
  });
});
