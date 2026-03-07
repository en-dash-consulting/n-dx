import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cmdInit } from "../../src/cli/commands/init.js";
import { cmdSmartAdd } from "../../src/cli/commands/smart-add.js";
import { cmdValidate } from "../../src/cli/commands/validate.js";
import { resolveStore } from "../../src/store/index.js";
import { validateStructure } from "../../src/core/structural.js";
import { REX_DIR } from "../../src/cli/commands/constants.js";
import type { Proposal } from "../../src/analyze/index.js";
import type { PRDItem } from "../../src/schema/index.js";

const { promptAnswers, mockReasonFromDescriptions } = vi.hoisted(() => ({
  promptAnswers: [] as string[],
  mockReasonFromDescriptions: vi.fn(),
}));

vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (_prompt: string, cb: (answer: string) => void) => {
      cb(promptAnswers.shift() ?? "");
    },
    close: () => {},
  }),
}));

vi.mock("../../src/analyze/index.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/analyze/index.js")>(
    "../../src/analyze/index.js",
  );
  return {
    ...actual,
    reasonFromDescriptions: mockReasonFromDescriptions,
    validateProposalQuality: vi.fn(() => []),
    setLLMConfig: vi.fn(),
    setClaudeConfig: vi.fn(),
    getAuthMode: vi.fn(() => "api"),
    getLLMVendor: vi.fn(() => "claude"),
  };
});

function flatten(items: PRDItem[]): PRDItem[] {
  const out: PRDItem[] = [];
  for (const item of items) {
    out.push(item);
    if (item.children) out.push(...flatten(item.children));
  }
  return out;
}

describe("smart-add orphaned parent regression", () => {
  let tmpDir: string;
  let originalIsTTY: boolean | undefined;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-orphan-parent-"));
    await cmdInit(tmpDir, {});

    mockReasonFromDescriptions.mockReset();
    promptAnswers.splice(0, promptAnswers.length);

    originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: true, configurable: true });
  });

  afterEach(async () => {
    Object.defineProperty(process.stdin, "isTTY", {
      value: originalIsTTY,
      configurable: true,
    });
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("merge into existing item where proposed parent is new leaves no orphaned containers", async () => {
    // Seed: existing epic/feature/task tree
    const store = await resolveStore(join(tmpDir, REX_DIR));
    await store.addItem({
      id: "epic-existing",
      title: "Platform Core",
      level: "epic",
      status: "pending",
    });
    await store.addItem({
      id: "feature-existing",
      title: "Authentication",
      level: "feature",
      status: "pending",
    }, "epic-existing");
    await store.addItem({
      id: "task-existing",
      title: "Add login endpoint",
      level: "task",
      status: "pending",
      description: "Basic login.",
      acceptanceCriteria: ["Login works"],
      priority: "medium",
      tags: ["auth"],
    }, "feature-existing");

    // Proposal: new epic + new feature containing a task that matches the existing one.
    // When all tasks merge, the proposed "Security Suite" epic and "Auth Hardening" feature
    // should NOT be left as orphaned containers.
    const proposal: Proposal = {
      epic: { title: "Security Suite", source: "smart-add" },
      features: [
        {
          title: "Auth Hardening",
          source: "smart-add",
          tasks: [
            {
              title: "Add login endpoint",
              source: "smart-add",
              sourceFile: "",
              description: "Enhanced login with rate limiting.",
              acceptanceCriteria: ["Login works", "Rate limiting applied"],
              priority: "high",
              tags: ["auth", "security"],
            },
          ],
        },
      ],
    };
    mockReasonFromDescriptions.mockResolvedValueOnce({ proposals: [proposal] });

    // Choose: y (confirm proposal), m (merge duplicates)
    promptAnswers.push("y", "m");
    await cmdSmartAdd(tmpDir, "Harden auth", {}, {});

    const doc = await store.loadDocument();
    const items = flatten(doc.items);

    // The existing task should be updated via merge
    const merged = items.find((i) => i.id === "task-existing");
    expect(merged?.description).toBe("Enhanced login with rate limiting.");
    expect(merged?.priority).toBe("high");

    // No orphaned "Security Suite" epic should exist
    expect(items.find((i) => i.title === "Security Suite")).toBeUndefined();

    // No orphaned "Auth Hardening" feature should exist
    expect(items.find((i) => i.title === "Auth Hardening")).toBeUndefined();

    // Total item count unchanged (no net additions)
    expect(items).toHaveLength(3);
  });

  it("cross-level merge with parent already existing leaves no empty containers", async () => {
    // Seed: epic with two features, each with a task
    const store = await resolveStore(join(tmpDir, REX_DIR));
    await store.addItem({
      id: "epic-1",
      title: "API Layer",
      level: "epic",
      status: "pending",
    });
    await store.addItem({
      id: "feature-1",
      title: "REST Endpoints",
      level: "feature",
      status: "pending",
    }, "epic-1");
    await store.addItem({
      id: "task-1",
      title: "Add users endpoint",
      level: "task",
      status: "pending",
      description: "CRUD for users.",
      priority: "medium",
    }, "feature-1");
    await store.addItem({
      id: "feature-2",
      title: "GraphQL Schema",
      level: "feature",
      status: "pending",
    }, "epic-1");
    await store.addItem({
      id: "task-2",
      title: "Define user type",
      level: "task",
      status: "pending",
      description: "GraphQL type for User.",
      priority: "medium",
    }, "feature-2");

    // Proposal: two features — one with all tasks merging, one with a genuinely new task.
    // The first feature's container should be cleaned up; the second should remain.
    const proposal: Proposal = {
      epic: { title: "API Improvements", source: "smart-add" },
      features: [
        {
          title: "REST Enhancements",
          source: "smart-add",
          tasks: [
            {
              title: "Add users endpoint",
              source: "smart-add",
              sourceFile: "",
              description: "Enhanced user CRUD with pagination.",
              acceptanceCriteria: ["Pagination supported"],
              priority: "high",
            },
          ],
        },
        {
          title: "Monitoring",
          source: "smart-add",
          tasks: [
            {
              title: "Add health check endpoint",
              source: "smart-add",
              sourceFile: "",
              description: "Liveness probe.",
              acceptanceCriteria: ["GET /health returns 200"],
              priority: "medium",
            },
          ],
        },
      ],
    };
    mockReasonFromDescriptions.mockResolvedValueOnce({ proposals: [proposal] });

    promptAnswers.push("y", "m");
    await cmdSmartAdd(tmpDir, "Improve API", {}, {});

    const doc = await store.loadDocument();
    const items = flatten(doc.items);

    // Merged task should be updated
    const mergedTask = items.find((i) => i.id === "task-1");
    expect(mergedTask?.description).toBe("Enhanced user CRUD with pagination.");

    // The "REST Enhancements" feature container should be cleaned up (all tasks merged)
    expect(items.find((i) => i.title === "REST Enhancements")).toBeUndefined();

    // The "Monitoring" feature should exist (has a genuinely new task)
    const monitoringFeature = items.find((i) => i.title === "Monitoring");
    expect(monitoringFeature).toBeDefined();

    // The new epic "API Improvements" should exist (it has at least one child: "Monitoring")
    const apiEpic = items.find((i) => i.title === "API Improvements");
    expect(apiEpic).toBeDefined();

    // The health check task should exist
    expect(items.find((i) => i.title === "Add health check endpoint")).toBeDefined();

    // No empty containers should remain
    const structural = validateStructure(doc.items);
    expect(structural.emptyContainers).toHaveLength(0);
  });

  it("merge followed by rex validate returns no structural errors", async () => {
    // Seed: a simple tree
    const store = await resolveStore(join(tmpDir, REX_DIR));
    await store.addItem({
      id: "epic-v",
      title: "Core Features",
      level: "epic",
      status: "pending",
    });
    await store.addItem({
      id: "feature-v",
      title: "Search",
      level: "feature",
      status: "pending",
    }, "epic-v");
    await store.addItem({
      id: "task-v",
      title: "Implement full-text search",
      level: "task",
      status: "pending",
      description: "Basic FTS.",
      priority: "medium",
    }, "feature-v");

    // Proposal: exact duplicate of the single task
    const proposal: Proposal = {
      epic: { title: "Search Platform", source: "smart-add" },
      features: [
        {
          title: "Search Engine",
          source: "smart-add",
          tasks: [
            {
              title: "Implement full-text search",
              source: "smart-add",
              sourceFile: "",
              description: "Full-text search with ranking.",
              acceptanceCriteria: ["Results are ranked"],
              priority: "critical",
            },
          ],
        },
      ],
    };
    mockReasonFromDescriptions.mockResolvedValueOnce({ proposals: [proposal] });

    promptAnswers.push("y", "m");
    await cmdSmartAdd(tmpDir, "Add search", {}, {});

    // Run rex validate in JSON mode and verify clean output
    // cmdValidate calls process.exit(1) on failure, so we intercept it
    const mockExit = vi.spyOn(process, "exit").mockImplementation((() => {}) as never);
    try {
      await cmdValidate(tmpDir, { format: "json" });
    } finally {
      mockExit.mockRestore();
    }

    // If validate would have failed, it calls process.exit(1)
    // A clean PRD should NOT trigger exit(1) for error-level checks
    const exitCalls = mockExit.mock.calls.filter(([code]) => code === 1);
    expect(exitCalls).toHaveLength(0);

    // Also verify structurally via the API
    const doc = await store.loadDocument();
    const structural = validateStructure(doc.items);
    expect(structural.emptyContainers).toHaveLength(0);
    expect(structural.orphanedItems).toHaveLength(0);

    // The merged task should be updated
    const merged = flatten(doc.items).find((i) => i.id === "task-v");
    expect(merged?.description).toBe("Full-text search with ranking.");
    expect(merged?.priority).toBe("critical");

    // No orphaned containers
    expect(flatten(doc.items).find((i) => i.title === "Search Platform")).toBeUndefined();
    expect(flatten(doc.items).find((i) => i.title === "Search Engine")).toBeUndefined();
  });
});
