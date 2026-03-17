import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { PRDItem } from "../../../src/schema/v1.js";
import type { ReshapeProposal } from "../../../src/core/reshape.js";
import {
  PENDING_SMART_PRUNE_FILE,
  hashPRD,
  savePendingSmartPrune,
  loadPendingSmartPrune,
  clearPendingSmartPrune,
} from "../../../src/core/pending-cache.js";

function item(
  overrides: Partial<PRDItem> & { id: string; title: string; level: PRDItem["level"] },
): PRDItem {
  return { status: "pending", ...overrides };
}

const sampleProposals: ReshapeProposal[] = [
  {
    id: "p1",
    action: {
      action: "obsolete",
      itemId: "item-1",
      reason: "No longer relevant",
    },
  },
  {
    id: "p2",
    action: {
      action: "merge",
      survivorId: "item-2",
      mergedIds: ["item-3"],
      reason: "Duplicate work",
    },
  },
];

describe("PENDING_SMART_PRUNE_FILE", () => {
  it("equals 'pending-smart-prune.json'", () => {
    expect(PENDING_SMART_PRUNE_FILE).toBe("pending-smart-prune.json");
  });
});

describe("hashPRD", () => {
  it("returns a 12-character hex string", () => {
    const items = [item({ id: "1", title: "Task A", level: "task" })];
    const hash = hashPRD(items);
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it("is deterministic for the same input", () => {
    const items = [item({ id: "1", title: "Task A", level: "task" })];
    expect(hashPRD(items)).toBe(hashPRD(items));
  });

  it("changes when items change", () => {
    const items1 = [item({ id: "1", title: "Task A", level: "task" })];
    const items2 = [item({ id: "1", title: "Task B", level: "task" })];
    expect(hashPRD(items1)).not.toBe(hashPRD(items2));
  });

  it("produces the same hash for structurally equal arrays", () => {
    const items1 = [item({ id: "1", title: "A", level: "task" })];
    const items2 = [item({ id: "1", title: "A", level: "task" })];
    expect(hashPRD(items1)).toBe(hashPRD(items2));
  });
});

describe("save/load/clear pending smart prune", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-cache-test-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("saves and loads a cache round-trip", async () => {
    const hash = "abcdef123456";
    await savePendingSmartPrune(tmpDir, sampleProposals, hash);

    const loaded = await loadPendingSmartPrune(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.prdHash).toBe(hash);
    expect(loaded!.proposals).toEqual(sampleProposals);
    expect(loaded!.generatedAt).toBeTruthy();
  });

  it("writes valid JSON to the expected file", async () => {
    await savePendingSmartPrune(tmpDir, sampleProposals, "abc");
    const raw = await readFile(join(tmpDir, PENDING_SMART_PRUNE_FILE), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed.prdHash).toBe("abc");
    expect(parsed.proposals).toHaveLength(2);
  });

  it("returns null when no cache file exists", async () => {
    const loaded = await loadPendingSmartPrune(tmpDir);
    expect(loaded).toBeNull();
  });

  it("clears the cache file", async () => {
    await savePendingSmartPrune(tmpDir, sampleProposals, "abc");
    await clearPendingSmartPrune(tmpDir);
    const loaded = await loadPendingSmartPrune(tmpDir);
    expect(loaded).toBeNull();
  });

  it("clear is a no-op when file does not exist", async () => {
    // Should not throw
    await clearPendingSmartPrune(tmpDir);
  });
});
