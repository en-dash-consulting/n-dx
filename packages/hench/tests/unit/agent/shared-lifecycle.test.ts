import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initConfig } from "../../../src/store/config.js";
import { RM_RETRY } from "../../helpers/index.js";

const { mockResolveActor, mockResolveHost } = vi.hoisted(() => ({
  mockResolveActor: vi.fn(async () => "Test Actor <test@example.com>"),
  mockResolveHost: vi.fn(() => "test-host"),
}));

// initRunRecord resolves actor/host via git config and os.hostname(); stub
// both so run records in this suite are deterministic across environments.
vi.mock("../../../src/process/actor-identity.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/process/actor-identity.js")>();
  return {
    ...actual,
    resolveActor: mockResolveActor,
    resolveHost: mockResolveHost,
  };
});

/**
 * Tests for the shared lifecycle module that extracts common validation
 * and orchestration logic used by both API and CLI agent loops.
 *
 * These tests verify that shared functions produce identical behavior
 * regardless of which loop invokes them.
 */

describe("shared lifecycle", () => {
  let projectDir: string;
  let henchDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "hench-test-shared-"));
    henchDir = join(projectDir, ".hench");
    await initConfig(henchDir);

    // Create minimal .rex/ for store
    const rexDir = join(projectDir, ".rex");
    await mkdir(rexDir, { recursive: true });
    await writeFile(
      join(rexDir, "config.json"),
      JSON.stringify({
        schema: "rex/v1",
        project: "test",
        adapter: "file",
      }),
      "utf-8",
    );
    await writeFile(
      join(rexDir, "prd.json"),
      JSON.stringify({
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "task-1",
            title: "Test task",
            status: "pending",
            level: "task",
            priority: "high",
          },
          {
            id: "task-2",
            title: "In-progress task",
            status: "in_progress",
            level: "task",
            priority: "medium",
          },
        ],
      }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true, ...RM_RETRY });
  });

  describe("prepareBrief", () => {
    it("assembles brief, formats text, builds system prompt, and displays task info", async () => {
      const { prepareBrief } = await import("../../../src/agent/lifecycle/shared.js");
      const { createStore } = await import("@n-dx/rex/dist/store/index.js");
      const { loadConfig } = await import("../../../src/store/config.js");

      const config = await loadConfig(henchDir);
      const rexDir = join(projectDir, ".rex");
      const store = createStore("file", rexDir);

      const consoleSpy = vi.spyOn(console, "log");

      const result = await prepareBrief(store, config, "task-1");

      expect(result.brief.task.id).toBe("task-1");
      expect(result.brief.task.title).toBe("Test task");
      expect(result.taskId).toBe("task-1");
      expect(result.briefText).toContain("Test task");
      expect(result.systemPrompt).toBeTruthy();

      // displayTaskInfo should have been called
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Test task"),
      );

      consoleSpy.mockRestore();
    });

    it("auto-selects a task when no taskId is provided", async () => {
      const { prepareBrief } = await import("../../../src/agent/lifecycle/shared.js");
      const { createStore } = await import("@n-dx/rex/dist/store/index.js");
      const { loadConfig } = await import("../../../src/store/config.js");

      const config = await loadConfig(henchDir);
      const rexDir = join(projectDir, ".rex");
      const store = createStore("file", rexDir);

      vi.spyOn(console, "log");

      const result = await prepareBrief(store, config);

      // Should have selected one of the tasks
      expect(result.taskId).toBeTruthy();
      expect(result.brief.task.title).toBeTruthy();

      vi.restoreAllMocks();
    });
  });

  describe("executeDryRun", () => {
    it("creates a completed run record with zero tokens", async () => {
      const { executeDryRun } = await import("../../../src/agent/lifecycle/shared.js");

      vi.spyOn(console, "log");

      const run = executeDryRun({
        label: "API",
        briefText: "test brief",
        systemPrompt: "test prompt",
        taskId: "task-1",
        taskTitle: "Test task",
        model: "claude-sonnet-4-6",
      });

      expect(run.status).toBe("completed");
      expect(run.turns).toBe(0);
      expect(run.summary).toContain("Dry run");
      expect(run.tokenUsage.input).toBe(0);
      expect(run.tokenUsage.output).toBe(0);
      expect(run.toolCalls).toEqual([]);
      expect(run.taskId).toBe("task-1");
      expect(run.taskTitle).toBe("Test task");
      expect(run.finishedAt).toBeTruthy();

      vi.restoreAllMocks();
    });

    it("includes extra info sections when provided", async () => {
      const { executeDryRun } = await import("../../../src/agent/lifecycle/shared.js");

      const consoleSpy = vi.spyOn(console, "log");

      executeDryRun({
        label: "CLI",
        briefText: "test brief",
        systemPrompt: "test prompt",
        taskId: "task-1",
        taskTitle: "Test task",
        model: "claude-sonnet-4-6",
        extraInfo: [
          { heading: "Provider", content: "cli (claude binary)" },
        ],
      });

      // Should have printed the extra info
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("Provider"),
      );

      consoleSpy.mockRestore();
    });
  });

  describe("transitionToInProgress", () => {
    it("transitions pending task to in_progress", async () => {
      const { transitionToInProgress } = await import("../../../src/agent/lifecycle/shared.js");
      const { createStore } = await import("@n-dx/rex/dist/store/index.js");

      const rexDir = join(projectDir, ".rex");
      const store = createStore("file", rexDir);

      vi.spyOn(console, "log");

      await transitionToInProgress(store, "task-1", "pending");

      // Verify the task was transitioned
      const doc = await store.loadDocument();
      const task = doc.items.find((i: { id: string }) => i.id === "task-1");
      expect(task?.status).toBe("in_progress");

      vi.restoreAllMocks();
    });

    it("skips transition for already in_progress tasks", async () => {
      const { transitionToInProgress } = await import("../../../src/agent/lifecycle/shared.js");
      const { createStore } = await import("@n-dx/rex/dist/store/index.js");

      const rexDir = join(projectDir, ".rex");
      const store = createStore("file", rexDir);

      // task-2 is already in_progress — should not throw
      await transitionToInProgress(store, "task-2", "in_progress");

      const doc = await store.loadDocument();
      const task = doc.items.find((i: { id: string }) => i.id === "task-2");
      expect(task?.status).toBe("in_progress");
    });
  });

  describe("initRunRecord", () => {
    it("creates a running run record and persists it", async () => {
      const { initRunRecord } = await import("../../../src/agent/lifecycle/shared.js");
      const { readFile } = await import("node:fs/promises");

      const { run, memoryCtx } = await initRunRecord({
        taskId: "task-1",
        taskTitle: "Test task",
        model: "claude-sonnet-4-6",
        henchDir,
      });

      expect(run.status).toBe("running");
      expect(run.taskId).toBe("task-1");
      expect(run.taskTitle).toBe("Test task");
      expect(run.model).toBe("claude-sonnet-4-6");
      expect(run.turns).toBe(0);
      expect(run.tokenUsage).toEqual({ input: 0, output: 0 });
      expect(run.toolCalls).toEqual([]);
      expect(run.turnTokenUsage).toEqual([]);
      expect(run.lastActivityAt).toBeTruthy();
      expect(run.id).toBeTruthy();

      // Verify memory context was captured
      expect(memoryCtx).toBeDefined();
      expect(typeof memoryCtx.systemTotalBytes).toBe("number");
      expect(typeof memoryCtx.systemAvailableAtStartBytes).toBe("number");

      // Verify it was persisted
      const savedFile = join(henchDir, "runs", `${run.id}.json`);
      const savedContent = await readFile(savedFile, "utf-8");
      const savedRun = JSON.parse(savedContent);
      expect(savedRun.status).toBe("running");
      expect(savedRun.taskId).toBe("task-1");
    });

    it("stamps actor and host at run start", async () => {
      const { initRunRecord } = await import("../../../src/agent/lifecycle/shared.js");
      const { readFile } = await import("node:fs/promises");

      const { run } = await initRunRecord({
        taskId: "task-1",
        taskTitle: "Test task",
        model: "claude-sonnet-4-6",
        henchDir,
        projectDir,
      });

      expect(run.actor).toBe("Test Actor <test@example.com>");
      expect(run.host).toBe("test-host");

      // Persisted run file carries the same attribution.
      const savedFile = join(henchDir, "runs", `${run.id}.json`);
      const savedRun = JSON.parse(await readFile(savedFile, "utf-8"));
      expect(savedRun.actor).toBe("Test Actor <test@example.com>");
      expect(savedRun.host).toBe("test-host");
    });

    it("stamps the worktree root, branch and starting HEAD at run start", async () => {
      const { initRunRecord } = await import("../../../src/agent/lifecycle/shared.js");
      const { readFile } = await import("node:fs/promises");
      const { execFileSync } = await import("node:child_process");
      const { realpathSync } = await import("node:fs");
      const { initGitFixtureRepoSync } = await import("../../helpers/index.js");

      // The suite's projectDir is a bare temp dir; make it a real repository so
      // the capture has something to report. The branch is created after the
      // first commit rather than via `git init --initial-branch`, which keeps
      // the fixture independent of the host git version.
      const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: projectDir, stdio: "ignore" });
      initGitFixtureRepoSync(projectDir);
      git("commit", "--allow-empty", "-m", "root");
      git("checkout", "-b", "gate-test");

      const { run } = await initRunRecord({
        taskId: "task-1",
        taskTitle: "Test task",
        model: "claude-sonnet-4-6",
        henchDir,
        projectDir,
      });

      // getWorktreeRoot realpaths its answer: tmpdir() is a symlink on macOS and
      // an 8.3 short name on Windows, so the expectation needs the OS realpath.
      expect(run.worktreeRoot).toBe(realpathSync.native(projectDir));
      expect(run.branch).toBe("gate-test");
      expect(run.startHead).toMatch(/^[0-9a-f]{40}$/);

      const savedRun = JSON.parse(
        await readFile(join(henchDir, "runs", `${run.id}.json`), "utf-8"),
      );
      expect(savedRun.worktreeRoot).toBe(run.worktreeRoot);
      expect(savedRun.branch).toBe("gate-test");
      expect(savedRun.startHead).toBe(run.startHead);
    });

    // Several checkouts run concurrently; without these two a token report
    // cannot say which build produced a run.
    it("stamps the n-dx version and the launching CLI path", async () => {
      const { initRunRecord } = await import("../../../src/agent/lifecycle/shared.js");
      const { readFile } = await import("node:fs/promises");

      const previous = process.env["NDX_CLI_PATH"];
      process.env["NDX_CLI_PATH"] = "/launcher/cli.js";
      try {
        const { run } = await initRunRecord({
          taskId: "task-1",
          taskTitle: "Test task",
          model: "claude-sonnet-4-6",
          henchDir,
          projectDir,
        });

        // Read from this package's own manifest rather than restating a literal
        // the release process would leave stale.
        const { version } = JSON.parse(
          await readFile(new URL("../../../package.json", import.meta.url), "utf-8"),
        );
        expect(run.ndxVersion).toBe(version);
        expect(run.cliPath).toBe("/launcher/cli.js");

        const savedRun = JSON.parse(
          await readFile(join(henchDir, "runs", `${run.id}.json`), "utf-8"),
        );
        expect(savedRun.ndxVersion).toBe(version);
        expect(savedRun.cliPath).toBe("/launcher/cli.js");
      } finally {
        if (previous === undefined) delete process.env["NDX_CLI_PATH"];
        else process.env["NDX_CLI_PATH"] = previous;
      }
    });
  });

  describe("handleRunFailure", () => {
    it("updates task status and logs the failure", async () => {
      const { handleRunFailure } = await import("../../../src/agent/lifecycle/shared.js");
      const { createStore } = await import("@n-dx/rex/dist/store/index.js");

      const rexDir = join(projectDir, ".rex");
      const store = createStore("file", rexDir);

      // First transition to in_progress so we can defer it
      await store.updateItem("task-1", { status: "in_progress" });

      await handleRunFailure(
        store, "task-1", "deferred", "task_failed", "API error occurred",
      );

      const doc = await store.loadDocument();
      const task = doc.items.find((i: { id: string }) => i.id === "task-1");
      expect(task?.status).toBe("deferred");
    });
  });

  describe("handleBudgetExceeded", () => {
    it("sets run status and error, then updates task", async () => {
      const { handleBudgetExceeded } = await import("../../../src/agent/lifecycle/shared.js");
      const { createStore } = await import("@n-dx/rex/dist/store/index.js");
      const { randomUUID } = await import("node:crypto");

      const rexDir = join(projectDir, ".rex");
      const store = createStore("file", rexDir);

      vi.spyOn(console, "log");

      // Transition task to in_progress first
      await store.updateItem("task-1", { status: "in_progress" });

      const run = {
        id: randomUUID(),
        taskId: "task-1",
        taskTitle: "Test task",
        startedAt: new Date().toISOString(),
        status: "running" as const,
        turns: 5,
        tokenUsage: { input: 80000, output: 20000 },
        toolCalls: [],
        model: "claude-sonnet-4-6",
      };

      const { checkTokenBudget } = await import("../../../src/agent/lifecycle/token-budget.js");
      await handleBudgetExceeded(store, "task-1", run, checkTokenBudget(run.tokenUsage, 50000));

      expect(run.status).toBe("budget_exceeded");
      expect(run.error).toContain("Token budget exceeded");
      expect(run.error).toContain("100,000");
      expect(run.error).toContain("50,000");

      vi.restoreAllMocks();
    });

    // Pins the caller contract both loops rely on: the figure in the error
    // message is whatever checkTokenBudget counted, so a prompt-cached run
    // must report its cache writes rather than the bare uncached input, and
    // must name the classes so the number can be read without guessing.
    it("reports the counted total and names the token classes", async () => {
      const { handleBudgetExceeded } = await import("../../../src/agent/lifecycle/shared.js");
      const { checkTokenBudget } = await import("../../../src/agent/lifecycle/token-budget.js");
      const { createStore } = await import("@n-dx/rex/dist/store/index.js");
      const { randomUUID } = await import("node:crypto");

      const store = createStore("file", join(projectDir, ".rex"));
      vi.spyOn(console, "log");
      await store.updateItem("task-1", { status: "in_progress" });

      const tokenUsage = {
        input: 534,
        output: 40,
        cacheCreationInput: 876_000,
        cacheReadInput: 34_100_000,
      };
      const run = {
        id: randomUUID(),
        taskId: "task-1",
        taskTitle: "Test task",
        startedAt: new Date().toISOString(),
        status: "running" as const,
        turns: 83,
        tokenUsage,
        toolCalls: [],
        model: "claude-sonnet-4-6",
      };

      const check = checkTokenBudget(tokenUsage, 200_000);
      expect(check.exceeded).toBe(true);

      await handleBudgetExceeded(store, "task-1", run, check);

      // 534 + 876_000 + 40 — not the 574 an uncached sum reports, and not the
      // 34,976,574 that counting cache reads at face value produced.
      expect(run.error).toBe(
        "Token budget exceeded: 876,574 of 200,000 " +
          "(uncached input + cache writes + output; 34,100,000 cache-read tokens not counted)",
      );

      vi.restoreAllMocks();
    });
  });

  describe("initRunRecord with diagnostics", () => {
    it("populates diagnostics when vendor and parseMode are provided", async () => {
      const { initRunRecord } = await import("../../../src/agent/lifecycle/shared.js");

      const { run } = await initRunRecord({
        taskId: "task-1",
        taskTitle: "Test task",
        model: "claude-sonnet-4-6",
        henchDir,
        vendor: "claude",
        sandbox: "workspace-write",
        approvals: "never",
        parseMode: "stream-json",
      });

      expect(run.diagnostics).toBeDefined();
      expect(run.diagnostics!.vendor).toBe("claude");
      expect(run.diagnostics!.sandbox).toBe("workspace-write");
      expect(run.diagnostics!.approvals).toBe("never");
      expect(run.diagnostics!.parseMode).toBe("stream-json");
      expect(run.diagnostics!.tokenDiagnosticStatus).toBe("unavailable");
      expect(run.diagnostics!.notes).toEqual([]);
    });

    it("omits diagnostics when no vendor or parseMode provided", async () => {
      const { initRunRecord } = await import("../../../src/agent/lifecycle/shared.js");

      const { run } = await initRunRecord({
        taskId: "task-1",
        taskTitle: "Test task",
        model: "claude-sonnet-4-6",
        henchDir,
      });

      expect(run.diagnostics).toBeUndefined();
    });

    it("uses 'unknown' parseMode when only vendor is provided", async () => {
      const { initRunRecord } = await import("../../../src/agent/lifecycle/shared.js");

      const { run } = await initRunRecord({
        taskId: "task-1",
        taskTitle: "Test task",
        model: "claude-sonnet-4-6",
        henchDir,
        vendor: "codex",
      });

      expect(run.diagnostics).toBeDefined();
      expect(run.diagnostics!.vendor).toBe("codex");
      expect(run.diagnostics!.parseMode).toBe("unknown");
    });
  });

  describe("deriveTokenDiagnosticStatus", () => {
    it("returns 'complete' when all turns are complete", async () => {
      const { deriveTokenDiagnosticStatus } = await import("../../../src/agent/lifecycle/shared.js");

      expect(deriveTokenDiagnosticStatus([
        { diagnosticStatus: "complete" },
        { diagnosticStatus: "complete" },
      ])).toBe("complete");
    });

    it("returns 'partial' when any turn is partial", async () => {
      const { deriveTokenDiagnosticStatus } = await import("../../../src/agent/lifecycle/shared.js");

      expect(deriveTokenDiagnosticStatus([
        { diagnosticStatus: "complete" },
        { diagnosticStatus: "partial" },
        { diagnosticStatus: "complete" },
      ])).toBe("partial");
    });

    it("returns 'unavailable' when any turn is unavailable", async () => {
      const { deriveTokenDiagnosticStatus } = await import("../../../src/agent/lifecycle/shared.js");

      expect(deriveTokenDiagnosticStatus([
        { diagnosticStatus: "complete" },
        { diagnosticStatus: "unavailable" },
      ])).toBe("unavailable");
    });

    it("returns 'unavailable' over partial (unavailable wins)", async () => {
      const { deriveTokenDiagnosticStatus } = await import("../../../src/agent/lifecycle/shared.js");

      expect(deriveTokenDiagnosticStatus([
        { diagnosticStatus: "partial" },
        { diagnosticStatus: "unavailable" },
      ])).toBe("unavailable");
    });

    it("returns 'complete' for empty array", async () => {
      const { deriveTokenDiagnosticStatus } = await import("../../../src/agent/lifecycle/shared.js");

      expect(deriveTokenDiagnosticStatus([])).toBe("complete");
    });

    it("returns 'complete' when diagnosticStatus is undefined on all turns", async () => {
      const { deriveTokenDiagnosticStatus } = await import("../../../src/agent/lifecycle/shared.js");

      expect(deriveTokenDiagnosticStatus([{}, {}])).toBe("complete");
    });
  });

  describe("finalizeRun updates diagnostics", () => {
    it("updates tokenDiagnosticStatus from per-turn data", async () => {
      const { initRunRecord, finalizeRun } = await import("../../../src/agent/lifecycle/shared.js");

      const { run, memoryCtx } = await initRunRecord({
        taskId: "task-1",
        taskTitle: "Test task",
        model: "claude-sonnet-4-6",
        henchDir,
        vendor: "claude",
        parseMode: "api-sdk",
      });

      // Simulate accumulated per-turn token data
      run.turnTokenUsage = [
        { turn: 1, input: 100, output: 50, diagnosticStatus: "complete" },
        { turn: 2, input: 200, output: 100, diagnosticStatus: "partial" },
      ];

      await finalizeRun({
        run,
        henchDir,
        projectDir,
        memoryCtx,
      });

      expect(run.diagnostics!.tokenDiagnosticStatus).toBe("partial");
    });

    it("preserves vendor/sandbox/approvals through finalization", async () => {
      const { initRunRecord, finalizeRun } = await import("../../../src/agent/lifecycle/shared.js");

      const { run, memoryCtx } = await initRunRecord({
        taskId: "task-1",
        taskTitle: "Test task",
        model: "claude-sonnet-4-6",
        henchDir,
        vendor: "codex",
        sandbox: "read-only",
        approvals: "on-request",
        parseMode: "json",
      });

      run.turnTokenUsage = [
        { turn: 1, input: 100, output: 50, diagnosticStatus: "complete" },
      ];

      await finalizeRun({
        run,
        henchDir,
        projectDir,
        memoryCtx,
      });

      expect(run.diagnostics!.vendor).toBe("codex");
      expect(run.diagnostics!.sandbox).toBe("read-only");
      expect(run.diagnostics!.approvals).toBe("on-request");
      expect(run.diagnostics!.parseMode).toBe("json");
      expect(run.diagnostics!.tokenDiagnosticStatus).toBe("complete");
    });
  });

  describe("RunDiagnostics schema backward compatibility", () => {
    it("validates records without new runtime identity fields", async () => {
      const { RunRecordSchema } = await import("../../../src/schema/validate.js");

      // Record with old-style diagnostics (no vendor/sandbox/approvals)
      const oldRecord = {
        id: "run-old",
        taskId: "t-1",
        taskTitle: "old task",
        startedAt: "2025-01-01T00:00:00.000Z",
        status: "completed",
        turns: 1,
        tokenUsage: { input: 10, output: 5 },
        toolCalls: [],
        model: "sonnet",
        diagnostics: {
          tokenDiagnosticStatus: "complete",
          parseMode: "stream-json",
          notes: [],
        },
      };

      const result = RunRecordSchema.safeParse(oldRecord);
      expect(result.success).toBe(true);
    });

    it("validates records with new runtime identity fields", async () => {
      const { RunRecordSchema } = await import("../../../src/schema/validate.js");

      const newRecord = {
        id: "run-new",
        taskId: "t-2",
        taskTitle: "new task",
        startedAt: "2025-01-01T00:00:00.000Z",
        status: "completed",
        turns: 1,
        tokenUsage: { input: 10, output: 5 },
        toolCalls: [],
        model: "sonnet",
        diagnostics: {
          tokenDiagnosticStatus: "complete",
          parseMode: "api-sdk",
          notes: [],
          vendor: "claude",
          sandbox: "workspace-write",
          approvals: "never",
        },
      };

      const result = RunRecordSchema.safeParse(newRecord);
      expect(result.success).toBe(true);
    });

    it("validates records without diagnostics field at all", async () => {
      const { RunRecordSchema } = await import("../../../src/schema/validate.js");

      const nodiagRecord = {
        id: "run-nodiag",
        taskId: "t-3",
        taskTitle: "legacy task",
        startedAt: "2025-01-01T00:00:00.000Z",
        status: "completed",
        turns: 1,
        tokenUsage: { input: 10, output: 5 },
        toolCalls: [],
        model: "sonnet",
      };

      const result = RunRecordSchema.safeParse(nodiagRecord);
      expect(result.success).toBe(true);
    });
  });

  describe("dry run parity between API and CLI loops", () => {
    it("both loops produce consistent dry run results through shared module", async () => {
      const { agentLoop } = await import("../../../src/agent/lifecycle/loop.js");
      const { cliLoop } = await import("../../../src/agent/lifecycle/cli-loop.js");
      const { createStore } = await import("@n-dx/rex/dist/store/index.js");
      const { loadConfig } = await import("../../../src/store/config.js");

      const config = await loadConfig(henchDir);
      const rexDir = join(projectDir, ".rex");
      const store = createStore("file", rexDir);

      vi.spyOn(console, "log");

      const apiResult = await agentLoop({
        config,
        store,
        projectDir,
        henchDir,
        dryRun: true,
        taskId: "task-1",
      });

      const cliResult = await cliLoop({
        config,
        store,
        projectDir,
        henchDir,
        dryRun: true,
        taskId: "task-1",
      });

      // Both should produce identical structural outcomes
      expect(apiResult.run.status).toBe(cliResult.run.status);
      expect(apiResult.run.turns).toBe(cliResult.run.turns);
      expect(apiResult.run.tokenUsage.input).toBe(cliResult.run.tokenUsage.input);
      expect(apiResult.run.tokenUsage.output).toBe(cliResult.run.tokenUsage.output);
      expect(apiResult.run.toolCalls).toEqual(cliResult.run.toolCalls);
      expect(apiResult.run.taskId).toBe(cliResult.run.taskId);
      expect(apiResult.run.taskTitle).toBe(cliResult.run.taskTitle);

      // Both should include "Dry run" in summary
      expect(apiResult.run.summary).toContain("Dry run");
      expect(cliResult.run.summary).toContain("Dry run");

      vi.restoreAllMocks();
    });
  });

  describe("invocation context detection", () => {
    it("CLI loop sets invocationContext to 'cli' in dry run", async () => {
      const { cliLoop } = await import("../../../src/agent/lifecycle/cli-loop.js");
      const { createStore } = await import("@n-dx/rex/dist/store/index.js");
      const { loadConfig } = await import("../../../src/store/config.js");

      const config = await loadConfig(henchDir);
      const rexDir = join(projectDir, ".rex");
      const store = createStore("file", rexDir);

      vi.spyOn(console, "log");

      const result = await cliLoop({
        config,
        store,
        projectDir,
        henchDir,
        dryRun: true,
        taskId: "task-1",
      });

      expect(result.run.invocationContext).toBe("cli");

      vi.restoreAllMocks();
    });

    it("API loop sets invocationContext to 'api' in dry run", async () => {
      const { agentLoop } = await import("../../../src/agent/lifecycle/loop.js");
      const { createStore } = await import("@n-dx/rex/dist/store/index.js");
      const { loadConfig } = await import("../../../src/store/config.js");

      const config = await loadConfig(henchDir);
      const rexDir = join(projectDir, ".rex");
      const store = createStore("file", rexDir);

      vi.spyOn(console, "log");

      const result = await agentLoop({
        config,
        store,
        projectDir,
        henchDir,
        dryRun: true,
        taskId: "task-1",
      });

      expect(result.run.invocationContext).toBe("api");

      vi.restoreAllMocks();
    });

    it("executeDryRun emits invocation context to stream when provided", async () => {
      const { executeDryRun } = await import("../../../src/agent/lifecycle/shared.js");

      const streamSpy = vi.spyOn(console, "log");

      const run = executeDryRun({
        label: "Test",
        briefText: "Test brief",
        systemPrompt: "Test prompt",
        taskId: "task-1",
        taskTitle: "Test task",
        model: "sonnet",
        invocationContext: "cli",
      });

      // Check that invocationContext is set
      expect(run.invocationContext).toBe("cli");

      // Check that stream output was called with context info
      // (The stream() function writes to console.log in non-TTY mode)
      const logCalls = streamSpy.mock.calls.map((call) => call[0]?.toString() || "");
      const contextEmitted = logCalls.some((msg) => msg.includes("CLI (ndx work command)"));
      expect(contextEmitted).toBe(true);

      streamSpy.mockRestore();
    });

    it("invocationContext is persisted in run record", async () => {
      const { initRunRecord } = await import("../../../src/agent/lifecycle/shared.js");

      const result = await initRunRecord({
        taskId: "task-1",
        taskTitle: "Test task",
        model: "sonnet",
        henchDir,
        vendor: "claude",
        invocationContext: "api",
      });

      expect(result.run.invocationContext).toBe("api");
    });
  });

  describe("recordClaimLoss", () => {
    const OTHER = "/repo/other-worktree";

    /**
     * A real TaskClaims over a scripted store: the first claim succeeds, every
     * later one (the renewals) is refused by another worktree. Real rather
     * than a bare `{ onClaimLost }` object, so the test pins the wiring the
     * loops depend on — renewal refusing → listener → run file on disk.
     */
    async function claimsThatLoseTask(taskId: string) {
      const { TaskClaims } = await import("../../../src/process/task-claims.js");
      const claimFor = (worktreeRoot: string) => ({
        taskId,
        worktreeRoot,
        pid: 1,
        host: "h",
        claimedAt: "2026-09-23T00:00:00.000Z",
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
      let calls = 0;
      const store = {
        path: "/fake/claims.json",
        claim: vi.fn(async () =>
          calls++ === 0
            ? { ok: true as const, claim: claimFor("/repo/this") }
            : { ok: false as const, heldBy: claimFor(OTHER) },
        ),
      };
      const claims = new TaskClaims(store as never, { worktreeRoot: "/repo/this", pid: process.pid });
      expect(await claims.claim(taskId)).toBeNull();
      return claims;
    }

    async function readSavedRun(id: string): Promise<Record<string, unknown>> {
      const { readFile } = await import("node:fs/promises");
      return JSON.parse(await readFile(join(henchDir, "runs", `${id}.json`), "utf-8"));
    }

    it("stamps claimLost on the run and saves it when renewal is refused", async () => {
      const { initRunRecord, recordClaimLoss } = await import("../../../src/agent/lifecycle/shared.js");
      const { run } = await initRunRecord({ taskId: "task-1", taskTitle: "Test task", model: "sonnet", henchDir, vendor: "claude" });
      const claims = await claimsThatLoseTask("task-1");

      recordClaimLoss(claims, run, henchDir);
      await claims.renewNow();

      expect(run.claimLost).toMatchObject({ taskId: "task-1", holderWorktree: OTHER });
      await vi.waitFor(async () => {
        const saved = await readSavedRun(run.id);
        expect(saved.claimLost).toEqual({ at: expect.any(String), taskId: "task-1", holderWorktree: OTHER });
      });
    });

    it("stamps a loss observed before the listener was attached", async () => {
      const { initRunRecord, recordClaimLoss } = await import("../../../src/agent/lifecycle/shared.js");
      const { run } = await initRunRecord({ taskId: "task-1", taskTitle: "Test task", model: "sonnet", henchDir, vendor: "claude" });
      const claims = await claimsThatLoseTask("task-1");

      // Refused between the claim and the loop attaching — no listener yet.
      await claims.renewNow();
      expect(run.claimLost).toBeUndefined();

      recordClaimLoss(claims, run, henchDir);

      expect(run.claimLost).toMatchObject({ taskId: "task-1", holderWorktree: OTHER });
      await vi.waitFor(async () => {
        expect((await readSavedRun(run.id)).claimLost).toMatchObject({ taskId: "task-1", holderWorktree: OTHER });
      });
    });

    it("does not stamp an earlier loss of a different task", async () => {
      const { initRunRecord, recordClaimLoss } = await import("../../../src/agent/lifecycle/shared.js");
      const { run } = await initRunRecord({ taskId: "task-1", taskTitle: "Test task", model: "sonnet", henchDir, vendor: "claude" });
      const claims = await claimsThatLoseTask("task-other");
      await claims.renewNow();

      recordClaimLoss(claims, run, henchDir);

      expect(run.claimLost).toBeUndefined();
    });

    it("is a no-op without claims", async () => {
      const { initRunRecord, recordClaimLoss } = await import("../../../src/agent/lifecycle/shared.js");
      const { run } = await initRunRecord({ taskId: "task-1", taskTitle: "Test task", model: "sonnet", henchDir, vendor: "claude" });
      expect(() => recordClaimLoss(undefined, run, henchDir)).not.toThrow();
      expect(run.claimLost).toBeUndefined();
    });
  });

  /**
   * The run log is written while the run is in progress, not assembled at the
   * end. Both loops go through `initRunRecord` and `finalizeRun`, so what is
   * asserted here holds for CLI-loop and API-loop runs alike.
   *
   * Byte-equality between the incremental writer and the end-of-run writer is
   * pinned in `tests/unit/store/run-log.test.ts`; these tests cover the
   * plumbing — that a run opens one, records its path, and streams into it.
   */
  describe("incremental run log", () => {
    /** Read `path` until `predicate` holds, or give up after `timeoutMs`. */
    async function readUntil(
      path: string,
      predicate: (content: string) => boolean,
      timeoutMs = 1000,
    ): Promise<string> {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const content = await readFile(path, "utf-8");
        if (predicate(content) || Date.now() >= deadline) return content;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }

    let consoleLog: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      const { resetCapturedLines } = await import("../../../src/types/output.js");
      resetCapturedLines();
      // stream()/detail() print as they capture; the capture is what is under
      // test, the printing is noise.
      consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleLog.mockRestore();
    });

    it("opens the log at run start and records its path on the run", async () => {
      const { initRunRecord } = await import("../../../src/agent/lifecycle/shared.js");
      const { loadRun } = await import("../../../src/store/runs.js");

      const { run } = await initRunRecord({
        taskId: "task-1",
        taskTitle: "Test task",
        model: "sonnet",
        henchDir,
        projectDir,
        vendor: "claude",
      });

      expect(run.logPath).toBeDefined();
      expect(run.logPath).toContain(run.id);
      // Readable before the agent has produced a single line — the whole point
      // of recording the path rather than letting readers guess the filename.
      expect(await readFile(run.logPath!, "utf-8")).toBe("");

      // And the path is on the persisted record, not only the in-memory one.
      expect((await loadRun(henchDir, run.id))?.logPath).toBe(run.logPath);
    });

    it("grows line by line while the run is in progress", async () => {
      const { initRunRecord } = await import("../../../src/agent/lifecycle/shared.js");
      const { stream, detail, getCapturedLines } = await import("../../../src/types/output.js");

      const { run } = await initRunRecord({
        taskId: "task-1",
        taskTitle: "Test task",
        model: "sonnet",
        henchDir,
        projectDir,
        vendor: "claude",
      });

      stream("Agent", "reading the brief");
      detail("1.2s");

      const live = await readUntil(run.logPath!, (c) => c.includes("1.2s"));
      expect(live).toBe(getCapturedLines().join("\n") + "\n");
      expect(live).toContain("reading the brief");
    });

    it("leaves every captured line in the file when the run finalizes", async () => {
      const { initRunRecord, finalizeRun } = await import("../../../src/agent/lifecycle/shared.js");
      const { stream } = await import("../../../src/types/output.js");

      const { run, memoryCtx } = await initRunRecord({
        taskId: "task-1",
        taskTitle: "Test task",
        model: "sonnet",
        henchDir,
        projectDir,
        vendor: "claude",
      });

      stream("Agent", "did the work");
      const midRun = await readUntil(run.logPath!, (c) => c.includes("did the work"));

      await finalizeRun({ run, henchDir, projectDir, memoryCtx });

      const finished = await readFile(run.logPath!, "utf-8");
      // Appended to, never rewritten: whatever a tail had already read is
      // still the start of the finished file, byte for byte.
      expect(finished.startsWith(midRun)).toBe(true);
      expect(finished.endsWith("\n")).toBe(true);
    });

    it("still writes the log at run end when no project directory was given", async () => {
      const { initRunRecord, finalizeRun } = await import("../../../src/agent/lifecycle/shared.js");
      const { stream } = await import("../../../src/types/output.js");
      const { readdir } = await import("node:fs/promises");

      // No projectDir on init: there is no project root to put .run-logs/ in,
      // so no live log is opened and finalizeRun writes the whole file.
      const { run, memoryCtx } = await initRunRecord({
        taskId: "task-1",
        taskTitle: "Test task",
        model: "sonnet",
        henchDir,
        vendor: "claude",
      });
      expect(run.logPath).toBeUndefined();

      stream("Agent", "did the work");
      await finalizeRun({ run, henchDir, projectDir, memoryCtx });

      const files = await readdir(join(projectDir, ".run-logs"));
      expect(files).toHaveLength(1);
      expect(await readFile(join(projectDir, ".run-logs", files[0]!), "utf-8"))
        .toContain("did the work");
    });

    it("loads a run record written before logPath existed", async () => {
      const { RunRecordSchema } = await import("../../../src/schema/validate.js");

      const legacy = {
        id: "run-legacy",
        taskId: "task-1",
        taskTitle: "old task",
        startedAt: "2026-01-01T00:00:00.000Z",
        status: "completed",
        turns: 1,
        tokenUsage: { input: 10, output: 5 },
        toolCalls: [],
        model: "sonnet",
      };

      const parsed = RunRecordSchema.safeParse(legacy);
      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.logPath).toBeUndefined();
    });
  });

  /**
   * The structured progress event stream, written for every run rather than
   * only verbose ones. Both loops go through `initRunRecord` and `finalizeRun`,
   * so what is asserted here holds for CLI-loop and API-loop runs alike.
   *
   * The file format and the event vocabulary are pinned in
   * `tests/unit/store/run-events.test.ts`; these tests cover the plumbing —
   * that every run opens one, records its path, and closes it.
   */
  describe("structured progress events", () => {
    type ParsedEvent = {
      kind: string;
      summary: string;
      at: string;
      counts?: Record<string, number>;
      detail?: string;
      ok?: boolean;
    };

    /** Parse whatever is in the file right now. */
    async function eventsIn(path: string): Promise<ParsedEvent[]> {
      return (await readFile(path, "utf-8"))
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l) as ParsedEvent);
    }

    /**
     * Wait for `count` events, retrying the read.
     *
     * Retried rather than slept on: the writer hands each line to Node's
     * buffer without awaiting the disk, so a fixed sleep would let a loaded
     * machine decide the verdict instead of the code.
     */
    async function readEvents(path: string, count: number): Promise<ParsedEvent[]> {
      return vi.waitFor(async () => {
        const events = await eventsIn(path);
        expect(events.length).toBeGreaterThanOrEqual(count);
        return events;
      });
    }

    let consoleLog: ReturnType<typeof vi.spyOn>;

    beforeEach(async () => {
      const { resetCapturedLines } = await import("../../../src/types/output.js");
      resetCapturedLines();
      consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleLog.mockRestore();
    });

    it("opens the stream at run start and records its path on the run", async () => {
      const { initRunRecord } = await import("../../../src/agent/lifecycle/shared.js");
      const { loadRun } = await import("../../../src/store/runs.js");

      const { run } = await initRunRecord({
        taskId: "task-1",
        taskTitle: "Test task",
        model: "sonnet",
        henchDir,
        projectDir,
        vendor: "claude",
        criteriaCount: 4,
        permissionMode: "acceptEdits",
      });

      expect(run.eventsPath).toBeDefined();
      expect(run.eventsPath).toContain(run.id);
      // On the persisted record, not only the in-memory one.
      expect((await loadRun(henchDir, run.id))?.eventsPath).toBe(run.eventsPath);

      // Readable before the agent has produced anything — the brief event is
      // already there, and it carries the facts the Work tab's first line needs.
      const [brief] = await readEvents(run.eventsPath!, 1);
      expect(brief.kind).toBe("brief_loaded");
      expect(brief.summary).toContain("Test task");
      expect(brief.counts).toEqual({ criteria: 4 });
      expect(brief.detail).toContain("acceptEdits");
      expect(Date.parse(brief.at)).not.toBeNaN();
    });

    it("opens a stream even when no project directory was given", async () => {
      // Unlike the run log, which needs a project root for `.run-logs/`: this
      // file lives beside the record, which every run has.
      const { initRunRecord } = await import("../../../src/agent/lifecycle/shared.js");
      const { run } = await initRunRecord({
        taskId: "task-1",
        taskTitle: "Test task",
        model: "sonnet",
        henchDir,
        vendor: "claude",
      });

      expect(run.logPath).toBeUndefined();
      expect(run.eventsPath).toBeDefined();
    });

    it("appends as the run progresses, and ends with run_finished", async () => {
      const { initRunRecord, finalizeRun } = await import("../../../src/agent/lifecycle/shared.js");
      const { emitRunEvent } = await import("../../../src/store/run-events.js");

      const { run, memoryCtx } = await initRunRecord({
        taskId: "task-1",
        taskTitle: "Test task",
        model: "sonnet",
        henchDir,
        projectDir,
        vendor: "claude",
      });

      emitRunEvent("file_edited", "Edited src/a.ts (+3 −1)", {
        turn: 1,
        counts: { linesAdded: 3, linesRemoved: 1 },
      });

      // Visible mid-run, which is what a tailing reader depends on.
      const live = await readEvents(run.eventsPath!, 2);
      expect(live.map((e) => e.kind)).toEqual(["brief_loaded", "file_edited"]);

      run.status = "completed";
      await finalizeRun({ run, henchDir, projectDir, memoryCtx });

      const finished = await readEvents(run.eventsPath!, 3);
      // Appended to, never rewritten: what the tail already read is still the
      // start of the finished file.
      expect(finished.slice(0, 2).map((e) => e.kind)).toEqual(["brief_loaded", "file_edited"]);
      const last = finished[finished.length - 1];
      expect(last.kind).toBe("run_finished");
      // Whatever verdict finalizeRun settled on, the closing event reports it —
      // the point being that a reader never has to infer the outcome from the
      // file simply stopping, which is also what a crash looks like.
      expect(last.summary).toBe(`Run ${run.status}`);
      expect(last.ok).toBe(run.status === "completed");
      // That the event carries a duration, not how long this run happened to
      // take — a bound on the latter would be a clock deciding the verdict.
      expect(Object.keys(last.counts ?? {})).toContain("durationMs");
      expect(typeof last.counts?.durationMs).toBe("number");
    });

    it("stops routing events once the run has finalized", async () => {
      const { initRunRecord, finalizeRun } = await import("../../../src/agent/lifecycle/shared.js");
      const { emitRunEvent } = await import("../../../src/store/run-events.js");

      const { run, memoryCtx } = await initRunRecord({
        taskId: "task-1",
        taskTitle: "Test task",
        model: "sonnet",
        henchDir,
        projectDir,
        vendor: "claude",
      });
      await finalizeRun({ run, henchDir, projectDir, memoryCtx });

      const afterFinalize = (await readFile(run.eventsPath!, "utf-8")).length;
      // A stray emit between runs must not land in the finished run's file.
      emitRunEvent("gate", "a gate from nowhere");
      expect((await readFile(run.eventsPath!, "utf-8")).length).toBe(afterFinalize);
    });

    it("does not print the events it records", async () => {
      // The stream is a side channel. Verbose output is whatever it was before
      // this existed, which is what keeps `--verbose` unchanged.
      const { initRunRecord } = await import("../../../src/agent/lifecycle/shared.js");
      const { emitRunEvent } = await import("../../../src/store/run-events.js");
      const { getCapturedLines } = await import("../../../src/types/output.js");

      await initRunRecord({
        taskId: "task-1",
        taskTitle: "Test task",
        model: "sonnet",
        henchDir,
        projectDir,
        vendor: "claude",
      });

      const before = getCapturedLines().length;
      const printedBefore = consoleLog.mock.calls.length;
      emitRunEvent("gate", "Test gate passed", { ok: true });

      expect(getCapturedLines().length).toBe(before);
      expect(consoleLog.mock.calls.length).toBe(printedBefore);
    });

    it("loads a run record written before eventsPath existed", async () => {
      const { RunRecordSchema } = await import("../../../src/schema/validate.js");

      const parsed = RunRecordSchema.safeParse({
        id: "run-legacy",
        taskId: "task-1",
        taskTitle: "old task",
        startedAt: "2026-01-01T00:00:00.000Z",
        status: "completed",
        turns: 1,
        tokenUsage: { input: 10, output: 5 },
        toolCalls: [],
        model: "sonnet",
      });

      expect(parsed.success).toBe(true);
      expect(parsed.success && parsed.data.eventsPath).toBeUndefined();
    });
  });
});
