/**
 * Self-Heal Tag Scoping — Integration Tests
 *
 * Verifies that the self-heal pipeline honours the SELF_HEAL_TAG filter end-to-end:
 * only tasks carrying the tag advance in status; untagged tasks remain untouched.
 *
 * ## Test fixture
 *
 * A seeded PRD contains two pending tasks:
 *   - task-tagged   (tags: ["self-heal"])  ← should be selected
 *   - task-untagged (no tags)              ← must never be selected
 *
 * The Codex CLI is mocked so tests run offline and deterministically.
 *
 * ## Why this file exists
 *
 * These tests would have caught the original scoping leak: the bug allowed
 * untagged tasks to be selected during a self-heal batch, causing unintended
 * status changes.  The sentinel in the unit companion test (self-heal-task-
 * selector.test.ts) ensures this file stays in sync when SELF_HEAL_TAG changes.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { initConfig } from "../../src/store/config.js";
import { SELF_HEAL_TAG } from "@n-dx/rex/dist/store/index.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

// Bypass git-diff completion validation (temp dirs have no git repo).
vi.mock("../../src/validation/completion.js", () => ({
  validateCompletion: vi.fn().mockResolvedValue({
    valid: true,
    hasChanges: true,
    diffSummary: "stub: bypassed for tag-scoping tests",
  }),
  formatValidationResult: () => "",
}));

// Disable spin detection — Codex verbose stdout produces many turns with 0 tool calls.
vi.mock("../../src/agent/analysis/spin.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/agent/analysis/spin.js")>();
  return { ...actual, isSpinningRun: () => false };
});

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** Typical Codex verbose stdout — recognised by normalizeCodexResponse as plain text. */
const CODEX_VERBOSE_SUCCESS = [
  "Reading additional input from stdin...",
  "OpenAI Codex v0.120.0 (research preview)",
  "--------",
  "workdir: /workspace",
  "model: gpt-5",
  "Analysing task brief...",
  "Task complete.",
  "tokens used",
  "1000",
].join("\n");

/**
 * Build a mock child-process EventEmitter that emits stdout, stderr, then close.
 * Compatible with spawnCodex (stdio: ignore/pipe/pipe).
 */
function mockCliProcess(opts: { stdout?: string; stderr?: string; code: number }) {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter;
    stderr: EventEmitter;
    stdin: { write: () => void; end: () => void };
  };
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.stdin = { write: () => {}, end: () => {} };

  queueMicrotask(() => {
    if (opts.stdout) proc.stdout.emit("data", Buffer.from(opts.stdout));
    if (opts.stderr) proc.stderr.emit("data", Buffer.from(opts.stderr));
    proc.emit("close", opts.code);
  });

  return proc;
}

/** PRD document with one tagged and one untagged pending task. */
function makeMixedPrd() {
  return JSON.stringify({
    schema: "rex/v1",
    title: "Scoping Test PRD",
    items: [
      {
        id: "epic-1",
        title: "Test Epic",
        level: "epic",
        status: "pending",
        children: [
          {
            id: "task-tagged",
            title: "Self-heal task (tagged)",
            level: "task",
            status: "pending",
            priority: "high",
            tags: [SELF_HEAL_TAG],
          },
          {
            id: "task-untagged",
            title: "Unrelated task (untagged)",
            level: "task",
            status: "pending",
            priority: "critical", // higher priority — must still not be selected
          },
        ],
      },
    ],
  });
}

/** Create an isolated temp project wired for Codex with the mixed PRD. */
async function setupProjectDir(): Promise<{
  projectDir: string;
  henchDir: string;
  rexDir: string;
}> {
  const projectDir = await mkdtemp(join(tmpdir(), "hench-sh-scope-"));
  const henchDir = join(projectDir, ".hench");
  const rexDir = join(projectDir, ".rex");

  await initConfig(henchDir);
  await mkdir(rexDir, { recursive: true });

  await writeFile(
    join(projectDir, ".n-dx.json"),
    JSON.stringify({
      llm: { vendor: "codex" },
      hench: { fullTestCommand: "true" },
    }),
    "utf-8",
  );

  await writeFile(
    join(rexDir, "config.json"),
    JSON.stringify({ schema: "rex/v1", project: "scoping-test", adapter: "file" }),
    "utf-8",
  );

  await writeFile(join(rexDir, "prd.json"), makeMixedPrd(), "utf-8");
  await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");

  return { projectDir, henchDir, rexDir };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("self-heal tag scoping — integration", () => {
  let projectDir: string;
  let henchDir: string;
  let rexDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    ({ projectDir, henchDir, rexDir } = await setupProjectDir());
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await rm(projectDir, { recursive: true, force: true });
  });

  // ── SC-1: Untagged task status is unchanged after a self-heal iteration ────

  it("leaves the untagged task as pending after a self-heal iteration selects the tagged task", async () => {
    // Arrange
    const mockSpawn = vi.fn();
    vi.doMock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return { ...actual, spawn: mockSpawn };
    });

    // Codex succeeds on the first attempt.
    mockSpawn.mockImplementationOnce(() =>
      mockCliProcess({ stdout: CODEX_VERBOSE_SUCCESS, code: 0 }),
    );

    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");

    const config = await loadConfig(henchDir);
    const store = createStore("file", rexDir);

    // Act: run one self-heal iteration with the tag filter active.
    await cliLoop({
      config: { ...config, selfHeal: true },
      store,
      projectDir,
      henchDir,
      // No explicit taskId — rely on auto-selection honouring the tag filter.
      tags: [SELF_HEAL_TAG],
    });

    // Assert: reload the document from disk and inspect both task statuses.
    const doc = await store.loadDocument();
    const allItems = doc.items.flatMap((e) => e.children ?? []);

    const tagged = allItems.find((t) => t.id === "task-tagged");
    const untagged = allItems.find((t) => t.id === "task-untagged");

    expect(tagged).toBeDefined();
    expect(untagged).toBeDefined();

    // The tagged task was selected and completed by the iteration.
    // updateCompletedTaskStatus marks the task completed immediately after the
    // test gate passes (before commit), so the status is "completed" even in a
    // non-git test environment where the commit step is skipped.
    expect(tagged!.status).toBe("completed");

    // The untagged task must be completely untouched.
    expect(untagged!.status).toBe("pending");
  });

  // ── SC-2: Tagged task is the one that advances ─────────────────────────────

  it("advances only the tagged task, not the higher-priority untagged task", async () => {
    // This test is a regression guard: before the fix, the untagged critical
    // task could be selected because priority was evaluated before tag filter.
    const mockSpawn = vi.fn();
    vi.doMock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return { ...actual, spawn: mockSpawn };
    });

    mockSpawn.mockImplementationOnce(() =>
      mockCliProcess({ stdout: CODEX_VERBOSE_SUCCESS, code: 0 }),
    );

    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");

    const config = await loadConfig(henchDir);
    const store = createStore("file", rexDir);

    const result = await cliLoop({
      config: { ...config, selfHeal: true },
      store,
      projectDir,
      henchDir,
      tags: [SELF_HEAL_TAG],
    });

    // Verify the run targeted the tagged task specifically.
    expect(result.run.taskId).toBe("task-tagged");

    // Verify the untagged critical task was never touched.
    const doc = await store.loadDocument();
    const untagged = doc.items
      .flatMap((e) => e.children ?? [])
      .find((t) => t.id === "task-untagged");

    expect(untagged!.status).toBe("pending");
  });

  // ── SC-3: Codex parse error retries and scope is preserved ─────────────────

  it("preserves scoping after a Codex transient retry — untagged task still pending", async () => {
    // First spawn: transient 429 error.  Second: success.
    // Even across the retry, the untagged task must not be touched.
    const mockSpawn = vi.fn();
    vi.doMock("node:child_process", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:child_process")>();
      return { ...actual, spawn: mockSpawn };
    });

    mockSpawn
      .mockImplementationOnce(() =>
        mockCliProcess({ stderr: "429 Rate limit exceeded", code: 1 }),
      )
      .mockImplementationOnce(() =>
        mockCliProcess({ stdout: CODEX_VERBOSE_SUCCESS, code: 0 }),
      );

    const { createStore } = await import("@n-dx/rex/dist/store/index.js");
    const { loadConfig } = await import("../../src/store/config.js");
    const { cliLoop } = await import("../../src/agent/lifecycle/cli-loop.js");

    const config = await loadConfig(henchDir);
    const store = createStore("file", rexDir);

    const result = await cliLoop({
      config: {
        ...config,
        selfHeal: true,
        retry: { maxRetries: 1, baseDelayMs: 0, maxDelayMs: 0 },
      },
      store,
      projectDir,
      henchDir,
      tags: [SELF_HEAL_TAG],
    });

    // Retry happened.
    expect(mockSpawn).toHaveBeenCalledTimes(2);
    expect(result.run.retryAttempts).toBe(1);

    // Scoping preserved across retry: untagged task untouched.
    const doc = await store.loadDocument();
    const untagged = doc.items
      .flatMap((e) => e.children ?? [])
      .find((t) => t.id === "task-untagged");

    expect(untagged!.status).toBe("pending");
  });
});
