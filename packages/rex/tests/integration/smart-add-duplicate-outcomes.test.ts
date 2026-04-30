import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cmdInit } from "../../src/cli/commands/init.js";
import { cmdSmartAdd } from "../../src/cli/commands/smart-add.js";
import { resolveStore } from "../../src/store/index.js";
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

const proposal: Proposal = {
  epic: {
    title: "Security Hardening",
    source: "smart-add",
  },
  features: [
    {
      title: "OAuth Security",
      source: "smart-add",
      tasks: [
        {
          title: "Implement OAuth callback handler",
          source: "smart-add",
          sourceFile: "",
          description: "Implement callback handler with strict state validation.",
          acceptanceCriteria: [
            "Callback route exists",
            "State parameter is validated",
          ],
          priority: "critical",
          tags: ["security"],
        },
        {
          title: "Rotate OAuth state secret monthly",
          source: "smart-add",
          sourceFile: "",
          description: "Set up key rotation job for OAuth state secret.",
          acceptanceCriteria: ["Rotation job runs monthly"],
          priority: "high",
          tags: ["security", "operations"],
        },
      ],
    },
  ],
};

function flatten(items: PRDItem[]): PRDItem[] {
  const out: PRDItem[] = [];
  for (const item of items) {
    out.push(item);
    if (item.children) out.push(...flatten(item.children));
  }
  return out;
}

async function seedExistingTree(dir: string): Promise<void> {
  const store = await resolveStore(join(dir, REX_DIR));
  await store.addItem({
    id: "epic-existing",
    title: "Identity Platform",
    level: "epic",
    status: "pending",
  });
  await store.addItem({
    id: "feature-existing",
    title: "OAuth Core",
    level: "feature",
    status: "pending",
  }, "epic-existing");
  await store.addItem({
    id: "task-existing",
    title: "Implement OAuth callback handler",
    level: "task",
    status: "pending",
    description: "Add callback route.",
    acceptanceCriteria: ["Callback route exists"],
    priority: "medium",
    tags: ["auth"],
  }, "feature-existing");
}

describe("cmdSmartAdd duplicate outcomes integration", () => {
  let tmpDir: string;
  let originalIsTTY: boolean | undefined;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-smart-add-duplicates-"));
    await cmdInit(tmpDir, {});
    await seedExistingTree(tmpDir);

    mockReasonFromDescriptions.mockReset();
    mockReasonFromDescriptions.mockResolvedValue({ proposals: [proposal] });
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

  it("cancel path writes nothing", async () => {
    const store = await resolveStore(join(tmpDir, REX_DIR));
    const before = flatten((await store.loadDocument()).items);

    promptAnswers.push("y", "c");
    await cmdSmartAdd(tmpDir, "Improve OAuth security", {}, {});

    const after = flatten((await store.loadDocument()).items);
    expect(after).toHaveLength(before.length);
    expect(after.find((i) => i.title === "Rotate OAuth state secret monthly")).toBeUndefined();
    expect(after.find((i) => i.id === "task-existing")?.mergedProposals).toBeUndefined();
    expect(after.every((i) => i.overrideMarker === undefined)).toBe(true);
  });

  it("merge path removes orphaned epic/feature when all tasks are merged", async () => {
    // Proposal where the ONLY task is a duplicate of the existing task.
    // After merge, the newly-created epic and feature would be childless — they
    // should be cleaned up automatically.
    const allDuplicateProposal: Proposal = {
      epic: { title: "Security Hardening", source: "smart-add" },
      features: [
        {
          title: "OAuth Security",
          source: "smart-add",
          tasks: [
            {
              title: "Implement OAuth callback handler",
              source: "smart-add",
              sourceFile: "",
              description: "Implement callback handler with strict state validation.",
              acceptanceCriteria: ["Callback route exists", "State parameter is validated"],
              priority: "critical",
              tags: ["security"],
            },
          ],
        },
      ],
    };
    mockReasonFromDescriptions.mockResolvedValueOnce({ proposals: [allDuplicateProposal] });

    const store = await resolveStore(join(tmpDir, REX_DIR));
    const beforeItems = flatten((await store.loadDocument()).items);
    const beforeCount = beforeItems.length;

    promptAnswers.push("y", "m");
    await cmdSmartAdd(tmpDir, "Improve OAuth security", {}, {});

    const afterItems = flatten((await store.loadDocument()).items);
    // The existing task should be updated (merged)
    const existing = afterItems.find((i) => i.id === "task-existing");
    expect(existing?.description).toBe("Implement callback handler with strict state validation.");

    // No new orphaned epic or feature should be created
    const orphanedEpic = afterItems.find(
      (i) => i.level === "epic" && i.title === "Security Hardening",
    );
    expect(orphanedEpic).toBeUndefined();

    const orphanedFeature = afterItems.find(
      (i) => i.level === "feature" && i.title === "OAuth Security",
    );
    expect(orphanedFeature).toBeUndefined();

    // Item count should remain the same (no net additions)
    expect(afterItems).toHaveLength(beforeCount);
  });

  // mergedProposals is in STORAGE_FIELDS (folder-tree-serializer.ts:297-301) so it
  // is not persisted to the per-item frontmatter. Re-enable when the storage layer
  // round-trips merge provenance.
  it.skip("merge path updates existing duplicate and only creates non-duplicate items", async () => {
    const store = await resolveStore(join(tmpDir, REX_DIR));

    promptAnswers.push("y", "m");
    await cmdSmartAdd(tmpDir, "Improve OAuth security", {}, {});

    const items = flatten((await store.loadDocument()).items);
    const existing = items.find((i) => i.id === "task-existing");
    expect(existing?.description).toBe("Implement callback handler with strict state validation.");
    expect(existing?.acceptanceCriteria).toEqual([
      "Callback route exists",
      "State parameter is validated",
    ]);
    expect(existing?.priority).toBe("critical");
    expect(existing?.tags).toEqual(["auth", "security"]);
    expect(existing?.mergedProposals).toHaveLength(1);
    expect(existing?.overrideMarker).toBeUndefined();

    const duplicateTitleItems = items.filter((i) => i.title === "Implement OAuth callback handler");
    expect(duplicateTitleItems).toHaveLength(1);

    const normalCreated = items.find((i) => i.title === "Rotate OAuth state secret monthly");
    expect(normalCreated).toBeDefined();
    expect(normalCreated?.overrideMarker).toBeUndefined();
    expect(items.every((i) => i.overrideMarker === undefined)).toBe(true);
  });

  // overrideMarker is in STORAGE_FIELDS (folder-tree-serializer.ts:297-301) so it
  // is not persisted to the per-item frontmatter. Re-enable when the storage layer
  // round-trips override provenance.
  it.skip("proceed path creates duplicate with override marker and leaves normal items unmarked", async () => {
    const store = await resolveStore(join(tmpDir, REX_DIR));

    promptAnswers.push("y", "p");
    await cmdSmartAdd(tmpDir, "Improve OAuth security", {}, {});

    const items = flatten((await store.loadDocument()).items);
    const existing = items.find((i) => i.id === "task-existing");
    expect(existing?.mergedProposals).toBeUndefined();
    expect(existing?.overrideMarker).toBeUndefined();

    const duplicateTitleItems = items.filter((i) => i.title === "Implement OAuth callback handler");
    expect(duplicateTitleItems).toHaveLength(2);
    const forceCreated = duplicateTitleItems.find((i) => i.id !== "task-existing");
    expect(forceCreated?.overrideMarker).toBeDefined();
    expect(forceCreated?.overrideMarker?.type).toBe("duplicate_guard_override");
    expect(forceCreated?.overrideMarker?.matchedItemId).toBe("task-existing");

    const normalCreated = items.find((i) => i.title === "Rotate OAuth state secret monthly");
    expect(normalCreated).toBeDefined();
    expect(normalCreated?.overrideMarker).toBeUndefined();

    const overrideItems = items.filter((i) => i.overrideMarker);
    expect(overrideItems).toHaveLength(1);
    expect(overrideItems[0]?.id).toBe(forceCreated?.id);
  });
});
