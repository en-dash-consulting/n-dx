#!/usr/bin/env node

/**
 * Profile prd_tree write path using the actual rex library APIs.
 *
 * Measures sub-operation timing for small/medium/large PRDs:
 *   - parseFolderTree  (read phase — called on every mutation via loadDocument)
 *   - serializeFolderTree  (write phase — called on every mutation)
 *   - addItem end-to-end  (lock + parse + mutate + validate + serialize + ownership)
 *   - updateItem end-to-end
 *
 * Prerequisites: build rex first  →  pnpm build  (or  pnpm --filter @n-dx/rex build)
 *
 * Usage:
 *   node scripts/profile-prd-tree-write.mjs [--small] [--medium] [--large]
 *   node scripts/profile-prd-tree-write.mjs --output=results.json
 *
 * TOP 3 BOTTLENECKS (see packages/rex/tests/unit/store/write-path-profile.test.ts):
 *
 *   #1  serializeFolderTree (file-adapter.ts:266)  — 465ms for 1110 items
 *       O(n) writes per single-item mutation; re-serialises the entire tree.
 *
 *   #2  parseFolderTree (file-adapter.ts:255)  — 241ms for 1110 items
 *       O(n) reads per single-item mutation; re-reads the entire tree.
 *
 *   #3  Sequential stat() in listSubdirs / removeStaleSubdirs
 *       folder-tree-parser.ts:148, folder-tree-serializer.ts:482
 *       ~2200 sequential stat() calls for a 1000-item PRD.
 */

import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";

// ── Resolve rex dist ──────────────────────────────────────────────────────────

const MONOREPO_ROOT = resolve(import.meta.dirname, "..");
const REX_DIST = join(MONOREPO_ROOT, "packages", "rex", "dist");

let parseFolderTree, serializeFolderTree, FileStore, SCHEMA_VERSION;

try {
  ({ parseFolderTree } = await import(`${REX_DIST}/store/folder-tree-parser.js`));
  ({ serializeFolderTree } = await import(`${REX_DIST}/store/folder-tree-serializer.js`));
  ({ FileStore } = await import(`${REX_DIST}/store/file-adapter.js`));
  ({ SCHEMA_VERSION } = await import(`${REX_DIST}/schema/index.js`));
} catch (err) {
  console.error("❌  Cannot import rex dist:", err.message);
  console.error("   Build the package first:  pnpm --filter @n-dx/rex build");
  process.exit(1);
}

// ── Fixture generation ────────────────────────────────────────────────────────

const FIXTURE_CONFIGS = {
  small:  { epics: 4,  featuresPerEpic: 1,  tasksPerFeature: 5  },  //  ~28 items
  medium: { epics: 5,  featuresPerEpic: 4,  tasksPerFeature: 9  },  // ~205 items
  large:  { epics: 10, featuresPerEpic: 10, tasksPerFeature: 10 },  // ~1110 items
};

function buildFixture({ epics, featuresPerEpic, tasksPerFeature }) {
  const items = [];
  let seq = 1;
  for (let e = 0; e < epics; e++) {
    const features = [];
    for (let f = 0; f < featuresPerEpic; f++) {
      const tasks = [];
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
        id: `fe-${seq++}`,
        title: `Feature ${f + 1} of epic ${e + 1}`,
        level: "feature",
        status: "pending",
        priority: "medium",
        acceptanceCriteria: [],
        children: tasks,
      });
    }
    items.push({
      id: `ep-${seq++}`,
      title: `Epic ${e + 1}: Fixture deliverable`,
      level: "epic",
      status: "pending",
      children: features,
    });
  }
  return items;
}

function countItems(items) {
  return items.reduce((n, item) => n + 1 + countItems(item.children ?? []), 0);
}

// ── Setup ─────────────────────────────────────────────────────────────────────

async function setupFixtureStore(rexDir, items) {
  await mkdir(rexDir, { recursive: true });
  await writeFile(
    join(rexDir, "config.json"),
    JSON.stringify({ schema: SCHEMA_VERSION, project: "profile-fixture", adapter: "file" }),
    "utf-8",
  );
  await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
  await writeFile(join(rexDir, "workflow.md"), "# Workflow\n", "utf-8");

  const store = new FileStore(rexDir);
  await store.saveDocument({ schema: SCHEMA_VERSION, title: "Fixture PRD", items });
  return store;
}

// ── Measurement ───────────────────────────────────────────────────────────────

async function measure(rexDir, items) {
  const treeRoot = join(rexDir, "prd_tree");

  const t0 = performance.now();
  await parseFolderTree(treeRoot);
  const parseMs = performance.now() - t0;

  const t1 = performance.now();
  await serializeFolderTree(items, treeRoot);
  const serializeMs = performance.now() - t1;

  const addStore = new FileStore(rexDir);
  const newItem = {
    id: randomUUID().slice(0, 8),
    title: "Profiling item — add benchmark",
    level: "epic",
    status: "pending",
  };
  const t2 = performance.now();
  await addStore.addItem(newItem);
  const addItemMs = performance.now() - t2;

  const updateStore = new FileStore(rexDir);
  const existing = await updateStore.loadDocument();
  const firstId = existing.items[0]?.id;
  const t3 = performance.now();
  await updateStore.updateItem(firstId, { status: "in_progress" });
  const updateItemMs = performance.now() - t3;

  return {
    parseMs:     Math.round(parseMs),
    serializeMs: Math.round(serializeMs),
    addItemMs:   Math.round(addItemMs),
    updateItemMs: Math.round(updateItemMs),
  };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const sizeFlags = new Set(
    args.filter((a) => ["--small", "--medium", "--large"].includes(a)).map((a) => a.slice(2)),
  );
  const outputFile = args.find((a) => a.startsWith("--output="))?.slice(9);
  const sizes = sizeFlags.size === 0 ? Object.keys(FIXTURE_CONFIGS) : [...sizeFlags];

  const baseDir = join(tmpdir(), `prd-write-profile-${Date.now()}`);
  await mkdir(baseDir, { recursive: true });

  const report = {
    timestamp: new Date().toISOString(),
    environment: { node: process.version, platform: process.platform },
    results: {},
  };

  try {
    console.log("prd_tree write-path profiler\n");
    console.log(`${"size".padEnd(8)} ${"items".padEnd(8)} ${"parse".padEnd(10)} ${"serialize".padEnd(12)} ${"addItem".padEnd(12)} ${"updateItem"}`);
    console.log("─".repeat(68));

    for (const size of sizes) {
      const cfg = FIXTURE_CONFIGS[size];
      const items = buildFixture(cfg);
      const itemCount = countItems(items);
      const rexDir = join(baseDir, size);

      await setupFixtureStore(rexDir, items);
      await measure(rexDir, items); // warm-up
      const timing = await measure(rexDir, items);

      report.results[size] = { itemCount, ...timing };

      console.log(
        `${size.padEnd(8)} ${String(itemCount).padEnd(8)} ` +
        `${String(timing.parseMs + "ms").padEnd(10)} ` +
        `${String(timing.serializeMs + "ms").padEnd(12)} ` +
        `${String(timing.addItemMs + "ms").padEnd(12)} ` +
        `${timing.updateItemMs}ms`,
      );
    }

    if (outputFile) {
      await writeFile(outputFile, JSON.stringify(report, null, 2), "utf-8");
      console.log(`\nSaved → ${outputFile}`);
    }
  } finally {
    await rm(baseDir, { recursive: true, force: true }).catch(() => {});
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
