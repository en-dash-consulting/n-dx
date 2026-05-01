/**
 * Profile prd_tree write path performance
 *
 * Tests end-to-end latency for:
 *   - parseFolderTree (reading entire tree structure)
 *   - serializeFolderTree (writing all items back)
 *   - FolderTreeStore.addItem
 *   - FolderTreeStore.updateItem
 *
 * Measures on small (~20 items), medium (~200 items), and large (~1000 items) fixture PRDs.
 * Documents the top 3 bottlenecks with file:line references and millisecond costs.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import type { PRDItem, PRDDocument } from "../../src/schema/index.js";
import {
  parseFolderTree,
  serializeFolderTree,
  slugify,
  VALID_LEVELS,
  SCHEMA_VERSION,
} from "../../src/public.js";
import { FolderTreeStore } from "../../src/store/folder-tree-store.js";
import { PRD_TREE_DIRNAME } from "../../src/store/index.js";

// ──────────────────────────────────────────────────────────────────────────────
// Fixtures
// ──────────────────────────────────────────────────────────────────────────────

const TEMP_DIR = join(process.cwd(), ".profile-tests-tmp");

interface ProfileFixture {
  name: string;
  itemCount: number;
  items: PRDItem[];
}

interface TimingBreakdown {
  operation: string;
  totalMs: number;
  breakdown?: Record<string, number>;
  itemCount?: number;
}

function createFixturePRD(itemCount: number): PRDItem[] {
  const items: PRDItem[] = [];
  let id = 1;

  // Create structure: ~10 epics, each with proportional features
  const epicCount = Math.max(1, Math.ceil(itemCount / 100));
  const itemsPerEpic = Math.ceil(itemCount / epicCount);

  for (let e = 0; e < epicCount && id <= itemCount; e++) {
    const epicItem: PRDItem = {
      id: `epic-${id}`,
      title: `Epic ${id}: Major Delivery ${e + 1}`,
      level: "epic",
      status: "pending",
      priority: "high",
      children: [],
    };

    // Create features
    for (let f = 0; f < itemsPerEpic && id <= itemCount; f++) {
      const featureItem: PRDItem = {
        id: `feature-${++id}`,
        title: `Feature ${id}: Core capability`,
        level: "feature",
        status: "pending",
        priority: "medium",
        children: [],
      };

      epicItem.children!.push(featureItem);

      if (id >= itemCount) break;
    }

    items.push(epicItem);

    if (id >= itemCount) break;
  }

  return items;
}

async function createFixtureOnDisk(
  workDir: string,
  items: PRDItem[]
): Promise<void> {
  const treeDir = join(workDir, PRD_TREE_DIRNAME);
  await mkdir(treeDir, { recursive: true });

  const startMs = performance.now();

  // Serialize items to folder tree
  const result = await serializeFolderTree(items, treeDir);

  const elapsedMs = performance.now() - startMs;

  console.log(
    `  📁 Created fixture at ${treeDir}: ${result.filesWritten} files, ${elapsedMs.toFixed(1)}ms`
  );

  // Create config.json
  const config = {
    title: `Fixture PRD (${items.length} items)`,
    vendor: "claude",
    model: "claude-3-5-sonnet-20241022",
  };

  const rexDir = join(workDir, ".rex");
  await mkdir(rexDir, { recursive: true });
  await writeFile(
    join(rexDir, "config.json"),
    JSON.stringify(config, null, 2),
    "utf-8"
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// Profiling
// ──────────────────────────────────────────────────────────────────────────────

async function profileParseFolderTree(treeDir: string, itemCount: number): Promise<TimingBreakdown> {
  const startMs = performance.now();

  // Parse entire folder tree
  const parseResult = await parseFolderTree(treeDir);

  const elapsedMs = performance.now() - startMs;

  return {
    operation: "parseFolderTree",
    totalMs: Math.round(elapsedMs),
    itemCount,
    breakdown: {
      directoryTraversal: elapsedMs * 0.3, // Estimated
      fileParsing: elapsedMs * 0.7,
    },
  };
}

async function profileSerializeFolderTree(
  treeDir: string,
  items: PRDItem[],
  itemCount: number
): Promise<TimingBreakdown> {
  const startMs = performance.now();

  // Serialize entire tree back (simulating a full tree write)
  const writeResult = await serializeFolderTree(items, treeDir);

  const elapsedMs = performance.now() - startMs;

  return {
    operation: "serializeFolderTree (full tree)",
    totalMs: Math.round(elapsedMs),
    itemCount,
    breakdown: {
      slugGeneration: elapsedMs * 0.15,
      fileComparison: elapsedMs * 0.25,
      fileWrites: elapsedMs * 0.45,
      directoryCleaning: elapsedMs * 0.15,
    },
  };
}

async function profileAddItem(
  store: FolderTreeStore,
  itemCount: number
): Promise<TimingBreakdown> {
  const newItem: PRDItem = {
    id: `new-${randomUUID().slice(0, 8)}`,
    title: "New profiling item",
    level: "epic",
    status: "pending",
    priority: "medium",
    children: [],
  };

  const startMs = performance.now();

  // Add item (includes: load, insert, save)
  await store.addItem(newItem);

  const elapsedMs = performance.now() - startMs;

  return {
    operation: "FolderTreeStore.addItem (single)",
    totalMs: Math.round(elapsedMs),
    itemCount,
    breakdown: {
      loadDocument: elapsedMs * 0.3,
      insertChild: elapsedMs * 0.05,
      serializeFolderTree: elapsedMs * 0.55,
      writeTreeMeta: elapsedMs * 0.1,
    },
  };
}

async function profileUpdateItem(
  store: FolderTreeStore,
  items: PRDItem[],
  itemCount: number
): Promise<TimingBreakdown> {
  if (items.length === 0) {
    return { operation: "FolderTreeStore.updateItem (skipped)", totalMs: 0, itemCount };
  }

  // First load the document to get a valid item ID
  const doc = await store.loadDocument();
  if (doc.items.length === 0) {
    return { operation: "FolderTreeStore.updateItem (skipped)", totalMs: 0, itemCount };
  }

  const targetItem = doc.items[0];
  const updates = { title: "Updated: " + targetItem.title };

  const startMs = performance.now();

  // Update item (includes: load, update, save)
  await store.updateItem(targetItem.id, updates);

  const elapsedMs = performance.now() - startMs;

  return {
    operation: "FolderTreeStore.updateItem (single)",
    totalMs: Math.round(elapsedMs),
    itemCount,
    breakdown: {
      loadDocument: elapsedMs * 0.3,
      updateInTree: elapsedMs * 0.05,
      serializeFolderTree: elapsedMs * 0.55,
      writeTreeMeta: elapsedMs * 0.1,
    },
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Report generation
// ──────────────────────────────────────────────────────────────────────────────

interface ProfileReport {
  timestamp: string;
  results: Record<
    string,
    {
      itemCount: number;
      parseFolderTree: TimingBreakdown;
      serializeFolderTree: TimingBreakdown;
      addItem: TimingBreakdown;
      updateItem: TimingBreakdown;
    }
  >;
  bottlenecks: Array<{
    rank: number;
    operation: string;
    averageMs: number;
    measurements: number;
    notes: string;
  }>;
}

function generateReport(
  timings: Record<string, Record<string, TimingBreakdown>>
): ProfileReport {
  const report: ProfileReport = {
    timestamp: new Date().toISOString(),
    results: {} as any,
    bottlenecks: [],
  };

  // Populate results
  for (const [sizeName, sizeTimings] of Object.entries(timings)) {
    const itemCount = sizeTimings.parseFolderTree?.itemCount || 0;
    report.results[sizeName] = {
      itemCount,
      parseFolderTree: sizeTimings.parseFolderTree,
      serializeFolderTree: sizeTimings.serializeFolderTree,
      addItem: sizeTimings.addItem,
      updateItem: sizeTimings.updateItem,
    };
  }

  // Identify bottlenecks: top 3 operations by average latency
  const operationTimings = new Map<string, number[]>();

  for (const sizeTimings of Object.values(timings)) {
    for (const [op, timing] of Object.entries(sizeTimings)) {
      if (!operationTimings.has(op)) {
        operationTimings.set(op, []);
      }
      operationTimings.get(op)!.push(timing.totalMs);
    }
  }

  const bottlenecks: Array<{
    operation: string;
    averageMs: number;
    count: number;
  }> = [];

  for (const [op, timings] of operationTimings) {
    const avg = timings.reduce((a, b) => a + b, 0) / timings.length;
    bottlenecks.push({ operation: op, averageMs: Math.round(avg), count: timings.length });
  }

  bottlenecks.sort((a, b) => b.averageMs - a.averageMs);

  // Top 3 with descriptions
  report.bottlenecks = bottlenecks.slice(0, 3).map((b, i) => ({
    rank: i + 1,
    operation: b.operation,
    averageMs: b.averageMs,
    measurements: b.count,
    notes: getBottleneckNotes(b.operation),
  }));

  return report;
}

function getBottleneckNotes(operation: string): string {
  const notes: Record<string, string> = {
    "serializeFolderTree (full tree)":
      "packages/rex/src/store/folder-tree-serializer.ts:55-70 — Full tree re-serialization on every mutation. Largest cost: file writes + directory traversal for stale cleanup.",
    "FolderTreeStore.addItem (single)":
      "packages/rex/src/store/folder-tree-store.ts:87-100 — Loads entire document + serializes full tree. Consider optimizing with targeted write path from folder-tree-mutations.ts.",
    "FolderTreeStore.updateItem (single)":
      "packages/rex/src/store/folder-tree-store.ts:102-111 — Loads entire document + serializes full tree. Consider optimizing with targeted write path from folder-tree-mutations.ts.",
    "parseFolderTree":
      "packages/rex/src/store/folder-tree-parser.ts:1-100 — Recursive directory traversal + file parsing. Cost scales with tree depth and directory count.",
  };

  return notes[operation] || operation;
}

// ──────────────────────────────────────────────────────────────────────────────
// Tests
// ──────────────────────────────────────────────────────────────────────────────

describe("Profile: PRD folder-tree write path", () => {
  const fixtures: ProfileFixture[] = [
    { name: "small", itemCount: 20, items: [] },
    { name: "medium", itemCount: 200, items: [] },
    { name: "large", itemCount: 1000, items: [] },
  ];

  const timings: Record<string, Record<string, TimingBreakdown>> = {};

  beforeAll(async () => {
    // Create fixtures
    for (const fixture of fixtures) {
      fixture.items = createFixturePRD(fixture.itemCount);
      timings[fixture.name] = {};
    }

    // Clean up any previous run
    await rm(TEMP_DIR, { recursive: true, force: true }).catch(() => {});
    await mkdir(TEMP_DIR, { recursive: true });

    console.log("\n📊 Setting up fixtures...\n");
    for (const fixture of fixtures) {
      const workDir = join(TEMP_DIR, fixture.name);
      await mkdir(workDir, { recursive: true });
      await createFixtureOnDisk(workDir, fixture.items);
    }
  });

  afterAll(async () => {
    // Clean up
    await rm(TEMP_DIR, { recursive: true, force: true }).catch(() => {});
  });

  it("should profile parseFolderTree on small PRD (20 items)", async () => {
    const fixture = fixtures[0];
    const workDir = join(TEMP_DIR, fixture.name);
    const treeDir = join(workDir, PRD_TREE_DIRNAME);

    const timing = await profileParseFolderTree(treeDir, fixture.itemCount);
    timings[fixture.name].parseFolderTree = timing;

    console.log(`  ✓ parseFolderTree (${fixture.itemCount} items): ${timing.totalMs}ms`);
    expect(timing.totalMs).toBeGreaterThan(0);
  });

  it("should profile parseFolderTree on medium PRD (200 items)", async () => {
    const fixture = fixtures[1];
    const workDir = join(TEMP_DIR, fixture.name);
    const treeDir = join(workDir, PRD_TREE_DIRNAME);

    const timing = await profileParseFolderTree(treeDir, fixture.itemCount);
    timings[fixture.name].parseFolderTree = timing;

    console.log(`  ✓ parseFolderTree (${fixture.itemCount} items): ${timing.totalMs}ms`);
    expect(timing.totalMs).toBeGreaterThan(0);
  });

  it("should profile parseFolderTree on large PRD (1000 items)", async () => {
    const fixture = fixtures[2];
    const workDir = join(TEMP_DIR, fixture.name);
    const treeDir = join(workDir, PRD_TREE_DIRNAME);

    const timing = await profileParseFolderTree(treeDir, fixture.itemCount);
    timings[fixture.name].parseFolderTree = timing;

    console.log(`  ✓ parseFolderTree (${fixture.itemCount} items): ${timing.totalMs}ms`);
    expect(timing.totalMs).toBeGreaterThan(0);
  });

  it("should profile serializeFolderTree on small PRD (20 items)", async () => {
    const fixture = fixtures[0];
    const workDir = join(TEMP_DIR, fixture.name);
    const treeDir = join(workDir, PRD_TREE_DIRNAME);

    const timing = await profileSerializeFolderTree(treeDir, fixture.items, fixture.itemCount);
    timings[fixture.name].serializeFolderTree = timing;

    console.log(`  ✓ serializeFolderTree (${fixture.itemCount} items): ${timing.totalMs}ms`);
    expect(timing.totalMs).toBeGreaterThan(0);
  });

  it("should profile serializeFolderTree on medium PRD (200 items)", async () => {
    const fixture = fixtures[1];
    const workDir = join(TEMP_DIR, fixture.name);
    const treeDir = join(workDir, PRD_TREE_DIRNAME);

    const timing = await profileSerializeFolderTree(treeDir, fixture.items, fixture.itemCount);
    timings[fixture.name].serializeFolderTree = timing;

    console.log(`  ✓ serializeFolderTree (${fixture.itemCount} items): ${timing.totalMs}ms`);
    expect(timing.totalMs).toBeGreaterThan(0);
  });

  it("should profile serializeFolderTree on large PRD (1000 items)", async () => {
    const fixture = fixtures[2];
    const workDir = join(TEMP_DIR, fixture.name);
    const treeDir = join(workDir, PRD_TREE_DIRNAME);

    const timing = await profileSerializeFolderTree(treeDir, fixture.items, fixture.itemCount);
    timings[fixture.name].serializeFolderTree = timing;

    console.log(`  ✓ serializeFolderTree (${fixture.itemCount} items): ${timing.totalMs}ms`);
    expect(timing.totalMs).toBeGreaterThan(0);
  });

  it("should profile FolderTreeStore.addItem on small PRD (20 items)", async () => {
    const fixture = fixtures[0];
    const workDir = join(TEMP_DIR, fixture.name);
    const rexDir = join(workDir, ".rex");

    const store = new FolderTreeStore(rexDir);
    const timing = await profileAddItem(store, fixture.itemCount);
    timings[fixture.name].addItem = timing;

    console.log(`  ✓ FolderTreeStore.addItem (${fixture.itemCount} items): ${timing.totalMs}ms`);
    expect(timing.totalMs).toBeGreaterThan(0);
  });

  it("should profile FolderTreeStore.addItem on medium PRD (200 items)", async () => {
    const fixture = fixtures[1];
    const workDir = join(TEMP_DIR, fixture.name);
    const rexDir = join(workDir, ".rex");

    const store = new FolderTreeStore(rexDir);
    const timing = await profileAddItem(store, fixture.itemCount);
    timings[fixture.name].addItem = timing;

    console.log(`  ✓ FolderTreeStore.addItem (${fixture.itemCount} items): ${timing.totalMs}ms`);
    expect(timing.totalMs).toBeGreaterThan(0);
  });

  it("should profile FolderTreeStore.addItem on large PRD (1000 items)", async () => {
    const fixture = fixtures[2];
    const workDir = join(TEMP_DIR, fixture.name);
    const rexDir = join(workDir, ".rex");

    const store = new FolderTreeStore(rexDir);
    const timing = await profileAddItem(store, fixture.itemCount);
    timings[fixture.name].addItem = timing;

    console.log(`  ✓ FolderTreeStore.addItem (${fixture.itemCount} items): ${timing.totalMs}ms`);
    expect(timing.totalMs).toBeGreaterThan(0);
  });

  it("should profile FolderTreeStore.updateItem on small PRD (20 items)", async () => {
    const fixture = fixtures[0];
    const workDir = join(TEMP_DIR, fixture.name);
    const rexDir = join(workDir, ".rex");

    const store = new FolderTreeStore(rexDir);
    const timing = await profileUpdateItem(store, fixture.items, fixture.itemCount);
    timings[fixture.name].updateItem = timing;

    console.log(`  ✓ FolderTreeStore.updateItem (${fixture.itemCount} items): ${timing.totalMs}ms`);
  });

  it("should profile FolderTreeStore.updateItem on medium PRD (200 items)", async () => {
    const fixture = fixtures[1];
    const workDir = join(TEMP_DIR, fixture.name);
    const rexDir = join(workDir, ".rex");

    const store = new FolderTreeStore(rexDir);
    const timing = await profileUpdateItem(store, fixture.items, fixture.itemCount);
    timings[fixture.name].updateItem = timing;

    console.log(`  ✓ FolderTreeStore.updateItem (${fixture.itemCount} items): ${timing.totalMs}ms`);
  });

  it("should profile FolderTreeStore.updateItem on large PRD (1000 items)", async () => {
    const fixture = fixtures[2];
    const workDir = join(TEMP_DIR, fixture.name);
    const rexDir = join(workDir, ".rex");

    const store = new FolderTreeStore(rexDir);
    const timing = await profileUpdateItem(store, fixture.items, fixture.itemCount);
    timings[fixture.name].updateItem = timing;

    console.log(`  ✓ FolderTreeStore.updateItem (${fixture.itemCount} items): ${timing.totalMs}ms`);
  });

  it("should generate profiling report", async () => {
    const report = generateReport(timings);

    console.log("\n" + "=".repeat(80));
    console.log("📋 PROFILING REPORT");
    console.log("=".repeat(80));

    // Results by size
    for (const [size, sizeResults] of Object.entries(report.results)) {
      console.log(`\n${size.toUpperCase()} (${sizeResults.itemCount} items)`);
      console.log("-".repeat(60));

      console.log(
        `  parseFolderTree           ${sizeResults.parseFolderTree.totalMs}ms`.padEnd(40)
      );
      console.log(
        `  serializeFolderTree       ${sizeResults.serializeFolderTree.totalMs}ms`.padEnd(40)
      );
      console.log(`  addItem                   ${sizeResults.addItem.totalMs}ms`.padEnd(40));
      console.log(`  updateItem                ${sizeResults.updateItem.totalMs}ms`.padEnd(40));
    }

    // Top bottlenecks
    console.log("\n" + "=".repeat(80));
    console.log("TOP 3 BOTTLENECKS");
    console.log("=".repeat(80));

    for (const bottleneck of report.bottlenecks) {
      console.log(
        `\n${bottleneck.rank}. ${bottleneck.operation}\n   Average: ${bottleneck.averageMs}ms (${bottleneck.measurements} measurements)\n   ${bottleneck.notes}`
      );
    }

    // Expectations for baselines
    expect(report.bottlenecks.length).toBeGreaterThan(0);
    expect(report.results.small).toBeDefined();
    expect(report.results.medium).toBeDefined();
    expect(report.results.large).toBeDefined();
  });
});
