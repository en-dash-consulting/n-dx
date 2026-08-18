/**
 * Shared test helpers and fixtures for hench test suite.
 * Consolidates duplicate mock factories and fixture builders used across test files.
 */

import { vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join, sep } from "node:path";
import { tmpdir } from "node:os";
import type { PRDStore, PRDItem } from "@n-dx/rex";
import { WINDOWS_STDIN_PROMPT_SEPARATOR } from "../../src/agent/lifecycle/adapters/claude-cli-adapter.js";
import type { CliRunResult } from "../../src/agent/lifecycle/event-accumulator.js";
import type { RunRecord } from "../../src/schema/v1.js";
import type { PromptEnvelope } from "../../src/schema/v1.js";
import { createPromptEnvelope } from "../../src/prd/llm-gateway.js";
import { initConfig } from "../../src/store/config.js";

/**
 * Creates a minimal mock PRDStore with all methods mocked.
 * Use for tests that don't need specific return values.
 */
export function mockStore(): PRDStore {
  return {
    updateItem: vi.fn().mockResolvedValue(undefined),
    appendLog: vi.fn().mockResolvedValue(undefined),
    addItem: vi.fn().mockResolvedValue(undefined),
    loadDocument: vi.fn(),
    saveDocument: vi.fn(),
    getItem: vi.fn(),
    removeItem: vi.fn(),
    loadConfig: vi.fn(),
    saveConfig: vi.fn(),
    readLog: vi.fn(),
    loadWorkflow: vi.fn(),
    saveWorkflow: vi.fn(),
    capabilities: vi.fn(),
  };
}

/**
 * Creates a mock PRDStore with pre-configured return values.
 * Useful for tests that need to read from or write to the store.
 */
export function mockStoreWithDefaults(items: PRDItem[] = []): PRDStore {
  return {
    loadDocument: async () => ({
      schema: "rex/v1",
      title: "Test",
      items,
    }),
    loadConfig: async () => ({
      schema: "rex/v1",
      project: "test",
      adapter: "file",
    }),
    loadWorkflow: async () => "",
    readLog: async () => [],
    saveDocument: async () => {},
    saveConfig: async () => {},
    getItem: async () => null,
    addItem: async () => {},
    updateItem: async () => {},
    removeItem: async () => {},
    appendLog: async () => {},
    saveWorkflow: async () => {},
    capabilities: () => ({ adapter: "file", supportsTransactions: false, supportsWatch: false }),
  };
}

/**
 * Creates a tracked mock PRDStore that allows reading back state changes.
 * Useful for tests that need to verify store mutations.
 */
export function mockStoreWithTracking(initialStatus: string = "pending"): {
  store: PRDStore;
  getUpdatedStatus: () => string;
} {
  let currentStatus = initialStatus;
  const store: PRDStore = {
    async getItem(id: string) {
      return { id, status: currentStatus } as any;
    },
    async updateItem(_id: string, updates: any) {
      if (updates.status) currentStatus = updates.status;
    },
    async appendLog() {},
    async loadDocument() {
      return { version: 1, title: "Test", items: [] };
    },
    async saveDocument() {},
    async addItem() {},
    async removeItem() {},
    async loadConfig() {
      return {};
    },
    async saveConfig() {},
    async readLog() {
      return [];
    },
    async loadWorkflow() {
      return "";
    },
    async saveWorkflow() {},
    capabilities: () => ({ adapter: "file", supportsTransactions: false, supportsWatch: false }),
  };
  return { store, getUpdatedStatus: () => currentStatus };
}

/**
 * Creates a standard prompt envelope for testing vendor adapters.
 */
export function createStandardEnvelope(): PromptEnvelope {
  return createPromptEnvelope([
    { name: "system", content: "You are Hench, an autonomous AI agent." },
    { name: "workflow", content: "Follow TDD: red → green → refactor." },
    { name: "brief", content: "Fix the authentication bug in src/auth.ts." },
    { name: "files", content: "src/auth.ts — existing auth module." },
    { name: "validation", content: "Run `npm test` and `npm run typecheck`." },
    { name: "completion", content: "Done when all tests pass and types check." },
  ]);
}

/**
 * Creates a minimal prompt envelope for testing vendor adapters.
 */
export function createMinimalEnvelope(): PromptEnvelope {
  return createPromptEnvelope([
    { name: "system", content: "You are Hench." },
    { name: "brief", content: "Fix the bug." },
  ]);
}

/**
 * Creates a full prompt envelope with all sections for comprehensive testing.
 */
export function createFullEnvelope(): PromptEnvelope {
  return createPromptEnvelope([
    { name: "system", content: "You are Hench, an autonomous AI agent." },
    { name: "workflow", content: "Follow TDD: red → green → refactor." },
    { name: "brief", content: "Fix the authentication bug in src/auth.ts." },
    { name: "files", content: "src/auth.ts — existing auth module." },
    { name: "validation", content: "Run `npm test` and `npm run typecheck`." },
    { name: "completion", content: "Done when all tests pass and types check." },
    { name: "assumptions", content: "Auth module uses JWT tokens." },
    { name: "constraints", content: "No breaking changes to API." },
  ]);
}

/**
 * Creates a minimal CLI run result for testing.
 */
export function createCliResult(overrides?: Partial<CliRunResult>): CliRunResult {
  return {
    vendor: "claude",
    exitCode: 0,
    stdout: "",
    stderr: "",
    ...overrides,
  };
}

/**
 * Creates a minimal run record for testing.
 */
export function createRunRecord(overrides?: Partial<RunRecord>): RunRecord {
  return {
    id: "run-1",
    taskId: "task-1",
    brief: "Test brief",
    status: "pending",
    turns: [],
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Creates a codex turn record for testing token usage.
 */
export function createCodexTurn(turn: number = 1): {
  turn: number;
  inputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  outputTokens: number;
} {
  return {
    turn,
    inputTokens: 100 * turn,
    cacheCreationTokens: turn === 1 ? 500 : 0,
    cacheReadTokens: turn > 1 ? 500 : 0,
    outputTokens: 50 * turn,
  };
}

/**
 * Creates a completed run record for testing state transitions.
 */
export function buildCompletedRun(overrides?: Partial<RunRecord>): RunRecord {
  return {
    id: "run-1",
    taskId: "task-1",
    brief: "Test brief",
    status: "completed",
    turns: [],
    startedAt: new Date().toISOString(),
    completedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Creates a failed run record for testing failure scenarios.
 */
export function buildFailedRun(overrides?: Partial<RunRecord>): RunRecord {
  return {
    id: "run-1",
    taskId: "task-1",
    brief: "Test brief",
    status: "failed",
    turns: [],
    startedAt: new Date().toISOString(),
    failureReason: "Test failure",
    ...overrides,
  };
}

/**
 * Creates a minimal run record for quick test setup.
 */
export function buildMinimalRun(overrides?: Partial<RunRecord>): RunRecord {
  return {
    id: "run-1",
    taskId: "task-1",
    brief: "Test",
    status: "pending",
    turns: [],
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Creates a run record with sample event data.
 */
export function makeRun(overrides?: Partial<RunRecord>): RunRecord {
  return buildMinimalRun(overrides);
}

/**
 * Sleeps for the specified number of milliseconds.
 */
export async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry settings for removing a temp directory that a child process may still be
 * holding. Node's fs.rm retries only the codes that signal exactly this — EBUSY,
 * EPERM, ENOTEMPTY, EMFILE, ENFILE — so a real error (a bad path, a permission
 * problem that will not clear) still fails immediately rather than stalling for
 * the whole window.
 *
 * Node backs off linearly, so the window is retryDelay * n(n+1)/2 — roughly 5.5s
 * here. That is sized to outlast a child that exits on its own within a few
 * seconds while still failing in bounded time when a lock will never clear.
 *
 * Spread this into an fs.rm call when the directory is not a setupProjectDir
 * project; use cleanupProjectDir when it is.
 */
export const RM_RETRY = { maxRetries: 10, retryDelay: 100 } as const;

/**
 * Sets up a temporary project directory with hench and rex configuration.
 * Returns the paths to the project, hench, and rex directories.
 * Remember to clean up with `rm(projectDir, { recursive: true })`.
 */
export async function setupProjectDir(prefix: string = "hench-test-"): Promise<{
  projectDir: string;
  henchDir: string;
  rexDir: string;
}> {
  const projectDir = await mkdtemp(join(tmpdir(), prefix));
  const henchDir = join(projectDir, ".hench");
  const rexDir = join(projectDir, ".rex");

  await initConfig(henchDir);
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

  await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");

  return { projectDir, henchDir, rexDir };
}

/**
 * Cleans up a test project directory created by setupProjectDir.
 *
 * Retries rather than giving up. On Windows a directory cannot be removed while
 * any process holds a handle inside it — most often as its current working
 * directory — and a child that has just been signalled has not necessarily let go
 * by the time teardown runs. POSIX allows unlinking an open file, so the retry
 * only ever engages on Windows.
 *
 * Failures propagate deliberately. Swallowing them turns a leaked temp directory
 * into an invisible problem, and the retry means a transient lock no longer
 * reaches the caller as an error in the first place.
 */
export async function cleanupProjectDir(projectDir: string): Promise<void> {
  await rm(projectDir, { recursive: true, force: true, ...RM_RETRY });
}

// ── Path expectations ─────────────────────────────────────────────────────────

/**
 * Convert a POSIX-style path literal into this platform's separator.
 *
 * Production helpers such as candidateTestPaths build paths with path.join, so
 * they emit "src\agent\loop.test.ts" on Windows and "src/agent/loop.test.ts" on
 * POSIX. Test expectations are written with forward slashes because that reads
 * better, so they need converting rather than the assertion being loosened —
 * `expect(paths).toContain(osPath("src/agent/loop.test.ts"))` stays an exact
 * match on both platforms.
 *
 * Use this for RELATIVE paths. For an absolute path that production produces via
 * path.resolve, build the expectation with resolve() against the same root so the
 * drive letter matches too (see tests/unit/guard/paths.test.ts).
 */
export function osPath(posixPath: string): string {
  return join(...posixPath.split("/"));
}

/**
 * A directory prefix with this platform's separator, e.g. "tests/" -> "tests\".
 *
 * Needed because osPath() cannot express a trailing separator: join() drops the
 * empty final segment. Without this, `p.startsWith("tests/")` is VACUOUSLY FALSE
 * on Windows, so a "does not generate mirror paths" assertion would pass without
 * checking anything.
 */
export function osPrefix(posixPrefix: string): string {
  return osPath(posixPrefix.replace(/\/$/, "")) + sep;
}

// ── Claude CLI delivery decoding ──────────────────────────────────────────────

/**
 * What the Claude CLI session will actually receive, independent of which channel
 * carried it.
 *
 * buildClaudeCliArgs delivers the same three things two different ways:
 *
 *   POSIX    system prompt in `--system-prompt <value>`, task prompt on stdin,
 *            each allowed-tool as its own argv entry.
 *   Windows  `--system-prompt` omitted and BOTH prompts on stdin separated by
 *            `\n\n---\n\n`, allowed-tools collapsed into one comma-joined argv
 *            entry — because cmd.exe cannot carry a multi-line argument safely.
 *
 * Tests that assert argv POSITIONS therefore encode one platform's shape and fail
 * on the other. Decoding first lets them assert the property they actually care
 * about — that the model receives this system prompt, this task prompt and these
 * tools — with exact equality rather than a loosened substring match.
 *
 * The shape is detected from the presence of `--system-prompt`, which is not a
 * heuristic: Windows always omits that flag and POSIX always includes it, so the
 * signal is exact.
 */
export function decodeClaudeDelivery(
  args: readonly string[],
  stdinContent: string,
): { systemPrompt: string; taskPrompt: string; allowedTools: string[]; shape: "posix" | "windows" } {
  const sysIdx = args.indexOf("--system-prompt");
  const isPosixShape = sysIdx > -1;

  const toolsIdx = args.indexOf("--allowed-tools");
  if (toolsIdx === -1) {
    throw new Error("decodeClaudeDelivery: --allowed-tools missing from args");
  }
  // Tool entries run until the next flag (or the end of argv).
  const afterFlag = args.slice(toolsIdx + 1);
  const nextFlag = afterFlag.findIndex((a) => a.startsWith("--"));
  const toolTokens = nextFlag === -1 ? afterFlag : afterFlag.slice(0, nextFlag);
  const allowedTools = isPosixShape
    ? [...toolTokens]
    : (toolTokens[0] ?? "").split(",").filter(Boolean);

  if (isPosixShape) {
    return {
      systemPrompt: args[sysIdx + 1]!,
      taskPrompt: stdinContent,
      allowedTools,
      shape: "posix",
    };
  }

  const at = stdinContent.indexOf(WINDOWS_STDIN_PROMPT_SEPARATOR);
  if (at === -1) {
    throw new Error(
      "decodeClaudeDelivery: no --system-prompt flag and no stdin separator — " +
      "the system prompt is not being delivered by either channel",
    );
  }
  return {
    systemPrompt: stdinContent.slice(0, at),
    taskPrompt: stdinContent.slice(at + WINDOWS_STDIN_PROMPT_SEPARATOR.length),
    allowedTools,
    shape: "windows",
  };
}
