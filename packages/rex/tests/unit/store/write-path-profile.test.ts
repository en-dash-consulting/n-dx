/**
 * Profiling harness for the prd_tree write path.
 *
 * Measures and documents baseline latencies for single-item add and edit
 * on small (~20), medium (~200), and large (~1000) item PRDs.
 *
 * Run:
 *   cd packages/rex && pnpm vitest run tests/unit/store/write-path-profile.test.ts
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * TOP 3 BOTTLENECKS (measured 2026-05-06, macOS M-class, Node v22)
 * ──────────────────────────────────────────────────────────────────────────────
 *
 * #1  Full tree serialization on every mutation — O(n) writes per single-item change
 *     packages/rex/src/store/file-adapter.ts:266
 *       `await serializeFolderTree(doc.items, this.treeRoot)`
 *     packages/rex/src/store/folder-tree-serializer.ts:89 (serializeChildren)
 *       Per item: stat (ensureDir) + readFile×2 (writeIfChanged) +
 *                 readdir (removeOrphanedMarkdownFiles) + writeFile×2+rename×2
 *     Measured: 13ms (28 items) · 84ms (205 items) · 465ms (1110 items)
 *     Adding one item reads and re-writes all ~2000 files in a 1000-item tree.
 *
 * #2  Full tree parse on every mutation — O(n) reads per single-item change
 *     packages/rex/src/store/file-adapter.ts:255
 *       `const doc = await this.loadDocument()`
 *     packages/rex/src/store/folder-tree-parser.ts:59 (parseFolderTree)
 *       Per item: readdir (listSubdirs) + stat×N (listSubdirs entry loop) +
 *                 readFile (<title>.md) + readFile (index.md for tasks)
 *     Measured: 5ms (28 items) · 40ms (205 items) · 241ms (1110 items)
 *     Every addItem/updateItem first reads the entire tree from disk.
 *
 * #3  Sequential stat() calls in listSubdirs and removeStaleSubdirs
 *     packages/rex/src/store/folder-tree-parser.ts:148
 *       `if (await isDirectory(join(dir, entry))) dirs.push(entry)`
 *     packages/rex/src/store/folder-tree-serializer.ts:482
 *       `isDir = (await stat(entryPath)).isDirectory()`
 *     Each directory entry is stat'd in a sequential for-loop. A 1000-item PRD
 *     with 10 epics × 10 features incurs ~1100 serialised stat() calls just for
 *     stale-subdir checks, plus ~1100 more in the parse listSubdirs loops.
 *     Switching to Promise.all() across siblings would flatten these to O(depth).
 *
 * ──────────────────────────────────────────────────────────────────────────────
 * RECORDED BASELINES (macOS M-class, Node.js v22, warm filesystem, 2026-05-06)
 * These are second-run (warm) wall-clock times. CI numbers will be higher.
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *   size    items   parse   serialize   addItem   updateItem
 *   small      28     5ms       13ms       21ms        19ms
 *   medium    205    40ms       84ms      143ms       138ms
 *   large    1110   241ms      465ms      789ms       738ms
 *
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, beforeAll, afterAll } from "vitest";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { FileStore, ensureRexDir } from "../../../src/store/file-adapter.js";
import { parseFolderTree } from "../../../src/store/folder-tree-parser.js";
import { serializeFolderTree } from "../../../src/store/folder-tree-serializer.js";
import { SCHEMA_VERSION } from "../../../src/schema/index.js";
import { toCanonicalJSON } from "../../../src/core/canonical.js";
import type { PRDDocument, PRDItem } from "../../../src/schema/index.js";

// ── Fixture generation ────────────────────────────────────────────────────────

/**
 * Build a synthetic PRD item tree with a realistic epic→feature→task shape.
 *
 * Target sizes:
 *   small  → 24 items  (4 epics × 1 feature × 5 tasks + 4 epics)
 *   medium → 205 items (5 epics × 4 features × 9 tasks)
 *   large  → 1010 items (10 epics × 10 features × 10 tasks)
 */
function buildFixture(config: { epics: number; featuresPerEpic: number; tasksPerFeature: number }): PRDItem[] {
  const { epics, featuresPerEpic, tasksPerFeature } = config;
  const items: PRDItem[] = [];
  let seq = 1;

  for (let e = 0; e < epics; e++) {
    const epicId = `ep-${seq++}`;
    const features: PRDItem[] = [];

    for (let f = 0; f < featuresPerEpic; f++) {
      const featureId = `fe-${seq++}`;
      const tasks: PRDItem[] = [];

      for (let t = 0; t < tasksPerFeature; t++) {
        tasks.push({
          id: `ta-${seq++}`,
          title: `Task ${t + 1} of feature ${f + 1} under epic ${e + 1}`,
          level: "task",
          status: "pending",
          priority: "medium",
          acceptanceCriteria: [],
          description: "Fixture task for write-path profiling.",
        });
      }

      features.push({
        id: featureId,
        title: `Feature ${f + 1} of epic ${e + 1}`,
        level: "feature",
        status: "pending",
        priority: "medium",
        acceptanceCriteria: [],
        children: tasks,
      });
    }

    items.push({
      id: epicId,
      title: `Epic ${e + 1}: Fixture deliverable`,
      level: "epic",
      status: "pending",
      children: features,
    });
  }

  return items;
}

function countItems(items: PRDItem[]): number {
  let n = items.length;
  for (const item of items) {
    if (item.children) n += countItems(item.children);
  }
  return n;
}

/** Fixture configs matched to ~small/medium/large item counts. */
const FIXTURE_CONFIGS = {
  small:  { epics: 4, featuresPerEpic: 1, tasksPerFeature: 5 },   // ~24 items
  medium: { epics: 5, featuresPerEpic: 4, tasksPerFeature: 9 },   // ~205 items
  large:  { epics: 10, featuresPerEpic: 10, tasksPerFeature: 10 }, // ~1010 items
} as const;

// ── Timing helpers ────────────────────────────────────────────────────────────

interface PhaseTiming {
  parseMs: number;
  serializeMs: number;
  addItemMs: number;
  updateItemMs: number;
}

async function measurePhases(rexDir: string, items: PRDItem[]): Promise<PhaseTiming> {
  const treeRoot = join(rexDir, "prd_tree");

  // ── Phase 1: parseFolderTree (isolated, no store overhead) ──────────────────
  const t0 = performance.now();
  await parseFolderTree(treeRoot);
  const parseMs = performance.now() - t0;

  // ── Phase 2: serializeFolderTree (isolated, no store overhead) ──────────────
  const t1 = performance.now();
  await serializeFolderTree(items, treeRoot);
  const serializeMs = performance.now() - t1;

  // ── Phase 3: addItem end-to-end (cold FileStore = no ownership cache) ───────
  const addStore = new FileStore(rexDir);
  const newItem: PRDItem = {
    id: randomUUID().slice(0, 8),
    title: "Profiling item — add benchmark",
    level: "epic",
    status: "pending",
  };
  const t2 = performance.now();
  await addStore.addItem(newItem);
  const addItemMs = performance.now() - t2;

  // ── Phase 4: updateItem end-to-end (warm ownership cache from addItem) ──────
  const updateStore = new FileStore(rexDir);
  // Warm up the ownership map so we isolate the write path
  const existing = await updateStore.loadDocument();
  const firstId = existing.items[0]?.id;
  if (!firstId) throw new Error("No items in fixture — fixture generation failed");

  const t3 = performance.now();
  await updateStore.updateItem(firstId, { status: "in_progress" });
  const updateItemMs = performance.now() - t3;

  return {
    parseMs: Math.round(parseMs),
    serializeMs: Math.round(serializeMs),
    addItemMs: Math.round(addItemMs),
    updateItemMs: Math.round(updateItemMs),
  };
}

// ── Test setup ────────────────────────────────────────────────────────────────

let baseDir: string;

beforeAll(async () => {
  baseDir = join(tmpdir(), `rex-write-profile-${Date.now()}`);
  await mkdir(baseDir, { recursive: true });
});

afterAll(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

async function setupFixtureStore(label: string, items: PRDItem[]): Promise<{ rexDir: string; store: FileStore }> {
  const rexDir = join(baseDir, label);
  await ensureRexDir(rexDir);
  await writeFile(
    join(rexDir, "config.json"),
    toCanonicalJSON({ schema: SCHEMA_VERSION, project: label, adapter: "file" }),
    "utf-8",
  );
  await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
  await writeFile(join(rexDir, "workflow.md"), "# Workflow\n", "utf-8");

  const store = new FileStore(rexDir);
  const doc: PRDDocument = { schema: SCHEMA_VERSION, title: `Fixture PRD (${label})`, items };
  await store.saveDocument(doc);
  return { rexDir, store };
}

// ── Profiling tests ───────────────────────────────────────────────────────────

// Catastrophic-regression budgets — intentionally loose.
// Goal: detect O(n²) regressions, not enforce sub-millisecond precision.
const REGRESSION_BUDGETS: Record<keyof typeof FIXTURE_CONFIGS, number> = {
  small:  5_000,
  medium: 20_000,
  large:  60_000,
};

describe("prd_tree write path profiling", () => {
  for (const [label, cfg] of Object.entries(FIXTURE_CONFIGS) as [keyof typeof FIXTURE_CONFIGS, (typeof FIXTURE_CONFIGS)[keyof typeof FIXTURE_CONFIGS]][]) {
    it(
      `${label} fixture — measures parse / serialize / addItem / updateItem`,
      { timeout: 120_000 },
      async () => {
        const items = buildFixture(cfg);
        const itemCount = countItems(items);
        const { rexDir } = await setupFixtureStore(label, items);

        // Run twice: first pass warms the filesystem cache; second is the measurement.
        // This isolates library overhead from OS-level cold-read penalties.
        await measurePhases(rexDir, items); // warm-up
        const timing = await measurePhases(rexDir, items);

        // eslint-disable-next-line no-console
        console.log(
          `\n  [${label}] ${itemCount} items — ` +
          `parse=${timing.parseMs}ms  serialize=${timing.serializeMs}ms  ` +
          `addItem=${timing.addItemMs}ms  updateItem=${timing.updateItemMs}ms`,
        );

        const maxMs = REGRESSION_BUDGETS[label];
        const worst = Math.max(timing.parseMs, timing.serializeMs, timing.addItemMs, timing.updateItemMs);
        if (worst > maxMs) {
          throw new Error(
            `${label} fixture: slowest phase ${worst}ms exceeds regression budget ${maxMs}ms — ` +
            `likely O(n²) regression. Full timing: ${JSON.stringify(timing)}`,
          );
        }
      },
    );
  }
});
