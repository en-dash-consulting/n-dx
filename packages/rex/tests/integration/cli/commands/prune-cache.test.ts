import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cmdInit } from "../../../../src/cli/commands/init.js";
import { cmdPrune } from "../../../../src/cli/commands/prune.js";
import { resolveStore } from "../../../../src/store/index.js";
import { REX_DIR } from "../../../../src/cli/commands/constants.js";
import {
  PENDING_SMART_PRUNE_FILE,
  loadPendingSmartPrune,
} from "../../../../src/core/pending-cache.js";
import type { PRDItem } from "../../../../src/schema/index.js";

// ── Mocks ──

const mockReasonForReshape = vi.hoisted(() => vi.fn());

vi.mock("../../../../src/analyze/reshape-reason.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/analyze/reshape-reason.js")
  >("../../../../src/analyze/reshape-reason.js");
  return {
    ...actual,
    reasonForReshape: mockReasonForReshape,
  };
});

vi.mock("../../../../src/analyze/reason.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/analyze/reason.js")
  >("../../../../src/analyze/reason.js");
  return {
    ...actual,
    setLLMConfig: vi.fn(),
    setClaudeConfig: vi.fn(),
  };
});

vi.mock("../../../../src/store/project-config.js", async () => {
  const actual = await vi.importActual<
    typeof import("../../../../src/store/project-config.js")
  >("../../../../src/store/project-config.js");
  return {
    ...actual,
    loadLLMConfig: vi.fn().mockResolvedValue({}),
    loadClaudeConfig: vi.fn().mockResolvedValue({}),
  };
});

// ── Helpers ──

const sampleItems: PRDItem[] = [
  {
    id: "epic-1",
    title: "Auth System",
    level: "epic",
    status: "pending",
    children: [
      {
        id: "feature-1",
        title: "Login",
        level: "feature",
        status: "pending",
        children: [
          {
            id: "task-1",
            title: "Build login form",
            level: "task",
            status: "completed",
          },
          {
            id: "task-2",
            title: "Add password reset",
            level: "task",
            status: "pending",
          },
        ],
      },
    ],
  },
];

function makeReshapeResult(proposals: Array<{ id: string; action: Record<string, unknown> }>) {
  return {
    proposals,
    tokenUsage: {
      inputTokens: 100,
      outputTokens: 50,
      totalTokens: 150,
      estimatedCostUsd: 0.01,
      calls: 1,
    },
  };
}

const sampleProposals = [
  {
    id: "p1",
    action: {
      action: "obsolete" as const,
      itemId: "task-1",
      reason: "Already completed, no longer needed in tree",
    },
  },
];

async function seedPRD(dir: string, items: PRDItem[]): Promise<void> {
  const store = await resolveStore(join(dir, REX_DIR));
  const doc = await store.loadDocument();
  doc.items = items;
  await store.saveDocument(doc);
}

// ── Tests ──

describe("smart prune caching integration", () => {
  let tmpDir: string;
  let rexDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-prune-cache-integ-"));
    rexDir = join(tmpDir, REX_DIR);
    await cmdInit(tmpDir, {});
    await seedPRD(tmpDir, sampleItems);
    mockReasonForReshape.mockReset();
    mockReasonForReshape.mockResolvedValue(makeReshapeResult(sampleProposals));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("writes cache file after LLM generation with correct prdHash", async () => {
    await cmdPrune(tmpDir, { smart: "true", "dry-run": "true" });

    expect(mockReasonForReshape).toHaveBeenCalledOnce();

    const cached = await loadPendingSmartPrune(rexDir);
    expect(cached).not.toBeNull();
    expect(cached!.prdHash).toMatch(/^[0-9a-f]{12}$/);
    expect(cached!.proposals).toEqual(sampleProposals);
    expect(cached!.generatedAt).toBeTruthy();

    // Verify the actual file exists on disk
    const raw = await readFile(join(rexDir, PENDING_SMART_PRUNE_FILE), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.prdHash).toBe(cached!.prdHash);
  });

  it("reuses cache on second call with unchanged PRD", async () => {
    // First call — generates proposals via LLM
    await cmdPrune(tmpDir, { smart: "true", "dry-run": "true" });
    expect(mockReasonForReshape).toHaveBeenCalledOnce();

    // Second call — should use cache, NOT call LLM again
    mockReasonForReshape.mockClear();
    await cmdPrune(tmpDir, { smart: "true", "dry-run": "true" });
    expect(mockReasonForReshape).not.toHaveBeenCalled();
  });

  it("invalidates cache when PRD changes between runs", async () => {
    // First call — generates and caches
    await cmdPrune(tmpDir, { smart: "true", "dry-run": "true" });
    expect(mockReasonForReshape).toHaveBeenCalledOnce();

    const firstCache = await loadPendingSmartPrune(rexDir);
    const firstHash = firstCache!.prdHash;

    // Modify PRD — add a new task
    const store = await resolveStore(rexDir);
    const doc = await store.loadDocument();
    doc.items[0]!.children![0]!.children!.push({
      id: "task-3",
      title: "Add 2FA support",
      level: "task",
      status: "pending",
    });
    await store.saveDocument(doc);

    // Second call — hash mismatch should trigger fresh LLM call
    mockReasonForReshape.mockClear();
    await cmdPrune(tmpDir, { smart: "true", "dry-run": "true" });
    expect(mockReasonForReshape).toHaveBeenCalledOnce();

    const secondCache = await loadPendingSmartPrune(rexDir);
    expect(secondCache!.prdHash).not.toBe(firstHash);
  });

  it("clears cache after successful apply", async () => {
    // First call — generates and caches (dry-run)
    await cmdPrune(tmpDir, { smart: "true", "dry-run": "true" });

    const cached = await loadPendingSmartPrune(rexDir);
    expect(cached).not.toBeNull();

    // Second call — accept uses cache and then clears it
    mockReasonForReshape.mockClear();
    await cmdPrune(tmpDir, { smart: "true", accept: "true" });
    expect(mockReasonForReshape).not.toHaveBeenCalled();

    const afterApply = await loadPendingSmartPrune(rexDir);
    expect(afterApply).toBeNull();
  });
});
