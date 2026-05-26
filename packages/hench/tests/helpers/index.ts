/**
 * Shared test helpers and fixtures for hench test suite.
 * Consolidates duplicate mock factories and fixture builders used across test files.
 */

import { vi } from "vitest";
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PRDStore, PRDItem } from "@n-dx/rex";
import type { CliRunResult } from "../../src/agent/lifecycle/event-accumulator.js";
import type { RunRecord } from "../../src/schema/v1.js";
import type { PromptEnvelope } from "../../src/schema/v1.js";
import { createPromptEnvelope } from "../../src/llm/prompt-envelope.js";
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
 */
export async function cleanupProjectDir(projectDir: string): Promise<void> {
  try {
    await rm(projectDir, { recursive: true, force: true });
  } catch {
    // Ignore cleanup errors
  }
}
