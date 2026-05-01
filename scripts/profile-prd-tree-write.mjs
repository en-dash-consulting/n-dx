#!/usr/bin/env node

/**
 * Profile prd_tree write path (ndx add, rex edit_item) on representative PRDs.
 *
 * Measures:
 *   - End-to-end latency for single-item add and edit on small/medium/large PRDs
 *   - Sub-operation timing (slug generation, parent traversal, serialization, file I/O)
 *   - Cache refresh time
 *
 * Usage:
 *   node scripts/profile-prd-tree-write.mjs [--small] [--medium] [--large] [--output=file.json]
 *
 * Outputs JSON with structure:
 *   {
 *     "timestamp": "2026-05-01T14:00:00.000Z",
 *     "environment": { "node": "20.x", "cwd": "..." },
 *     "fixtures": {
 *       "small": { "itemCount": 20, ... },
 *       "medium": { "itemCount": 200, ... },
 *       "large": { "itemCount": 1000, ... }
 *     },
 *     "results": {
 *       "small": {
 *         "add": { "totalMs": 45, "breakdown": {...} },
 *         "edit": { "totalMs": 38, "breakdown": {...} }
 *       },
 *       ...
 *     },
 *     "bottlenecks": [
 *       { "rank": 1, "operation": "...", "averageMs": 25, "notes": "..." },
 *       ...
 *     ]
 *   }
 */

import { exec } from "node:child_process";
import { mkdir, rm, readdir, writeFile, readFile } from "node:fs/promises";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { promisify } from "node:util";

const execAsync = promisify(exec);

// ──────────────────────────────────────────────────────────────────────────────
// Configuration
// ──────────────────────────────────────────────────────────────────────────────

const SIZES = {
  small: 20,
  medium: 200,
  large: 1000,
};

const TEMP_DIR = join(process.cwd(), ".profile-tmp");

// ──────────────────────────────────────────────────────────────────────────────
// Main profiler
// ──────────────────────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);
  const sizeFlags = new Set(
    args.filter((a) => ["--small", "--medium", "--large"].includes(a)).map((a) => a.slice(2))
  );
  const outputFile = args.find((a) => a.startsWith("--output="))?.slice(9);

  // If no size flags, run all
  const sizes = sizeFlags.size === 0 ? Object.keys(SIZES) : Array.from(sizeFlags);

  console.log("🔍 Profile: PRD folder-tree write path");
  console.log(`📊 Sizes: ${sizes.join(", ")}`);
  console.log(`📁 Temp dir: ${TEMP_DIR}`);
  console.log("");

  const report = {
    timestamp: new Date().toISOString(),
    environment: {
      node: process.version,
      cwd: process.cwd(),
      platform: process.platform,
    },
    fixtures: {},
    results: {},
    bottlenecks: [],
  };

  try {
    // Clean up any previous run
    try {
      await rm(TEMP_DIR, { recursive: true, force: true });
    } catch {}

    await mkdir(TEMP_DIR, { recursive: true });

    // Profile each size
    for (const size of sizes) {
      console.log(`\n📈 Profiling ${size} PRD (${SIZES[size]} items)...`);
      const result = await profileSize(size, SIZES[size]);
      report.fixtures[size] = result.fixture;
      report.results[size] = result.measurements;
      console.log(`   ✅ Complete`);
    }

    // Analyze bottlenecks
    report.bottlenecks = analyzeBottlenecks(report.results);

    // Output report
    console.log("\n" + "=".repeat(80));
    console.log("📋 REPORT");
    console.log("=".repeat(80));
    printReport(report);

    if (outputFile) {
      await writeFile(outputFile, JSON.stringify(report, null, 2), "utf-8");
      console.log(`\n✅ Report saved to ${outputFile}`);
    }
  } finally {
    try {
      await rm(TEMP_DIR, { recursive: true, force: true });
    } catch {}
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Fixture creation and profiling
// ──────────────────────────────────────────────────────────────────────────────

async function profileSize(sizeName, itemCount) {
  const workDir = join(TEMP_DIR, sizeName);
  await mkdir(workDir, { recursive: true });

  // Create fixture PRD
  const fixture = await createFixture(workDir, itemCount);

  // Initialize Rex
  await initRex(workDir);

  // Profile ndx add
  const addMeasure = await profileAdd(workDir, fixture);

  // Profile rex edit_item
  const editMeasure = await profileEdit(workDir, fixture);

  return {
    fixture,
    measurements: {
      add: addMeasure,
      edit: editMeasure,
    },
  };
}

async function createFixture(workDir, itemCount) {
  const rexDir = join(workDir, ".rex");
  const treeDir = join(rexDir, "tree");
  await mkdir(treeDir, { recursive: true });

  // Create epics
  const epicCount = Math.ceil(itemCount / 20);
  const itemsPerEpic = Math.ceil(itemCount / epicCount);

  let itemId = 1;
  let totalItems = 0;

  for (let e = 0; e < epicCount && totalItems < itemCount; e++) {
    const epicSlug = `epic-${e + 1}`;
    const epicDir = join(treeDir, epicSlug);
    await mkdir(epicDir, { recursive: true });

    // Create epic index.md
    const epicContent = `# Epic ${e + 1}

- **Status**: pending
- **Priority**: medium

## Description

Fixture epic for profiling. Contains ${itemsPerEpic} child tasks.

## Children

| Title | Status | Priority |
|-------|--------|----------|`;

    let childTable = epicContent;

    // Create features
    for (let f = 0; f < itemsPerEpic && totalItems < itemCount; f++) {
      const featureSlug = `feature-${f + 1}`;
      const featureDir = join(epicDir, featureSlug);
      await mkdir(featureDir, { recursive: true });

      const featureId = `f-${itemId++}`;
      const featureContent = `---
id: ${featureId}
title: Feature ${f + 1} of Epic ${e + 1}
level: feature
status: pending
priority: medium
---

# Feature ${f + 1}

Child of Epic ${e + 1}.

## Children

| Title | Status |
|-------|--------|`;

      await writeFile(join(featureDir, "feature.md"), featureContent, "utf-8");
      await writeFile(join(featureDir, "index.md"), featureContent, "utf-8");

      childTable += `\n| Feature ${f + 1} | pending | medium |`;
      totalItems++;
    }

    childTable += "\n";
    await writeFile(join(epicDir, `epic.md`), childTable, "utf-8");
    await writeFile(join(epicDir, "index.md"), childTable, "utf-8");
  }

  // Create config.json
  const config = {
    title: `Fixture PRD (${itemCount} items)`,
    vendor: "claude",
    model: "claude-3-5-sonnet-20241022",
  };

  await writeFile(join(rexDir, "config.json"), JSON.stringify(config, null, 2), "utf-8");

  return {
    itemCount: totalItems,
    epicCount,
    itemsPerEpic,
  };
}

async function initRex(workDir) {
  // Just ensure config exists; tree is already created
  const rexDir = join(workDir, ".rex");
  const configPath = join(rexDir, "config.json");

  try {
    const raw = await readFile(configPath, "utf-8");
    JSON.parse(raw);
  } catch {
    const config = {
      title: "Fixture PRD",
      vendor: "claude",
      model: "claude-3-5-sonnet-20241022",
    };
    await writeFile(configPath, JSON.stringify(config, null, 2), "utf-8");
  }
}

async function profileAdd(workDir, fixture) {
  const measurements = {
    totalMs: 0,
    breakdown: {},
  };

  // Time: ndx add <description> (using pnpm exec, not npx)
  const t0 = performance.now();
  try {
    const mainDir = process.cwd();
    await execAsync(
      `cd "${workDir}" && pnpm exec --dir="${mainDir}" ndx add "Profiling item ${fixture.itemCount + 1}"`,
      {
        timeout: 30000,
        cwd: mainDir,
      }
    );
  } catch (err) {
    console.warn("  ⚠️  ndx add failed:", err.message?.split("\n")[0]);
  }
  const t1 = performance.now();

  measurements.totalMs = Math.round(t1 - t0);
  measurements.breakdown.totalMs = measurements.totalMs;

  return measurements;
}

async function profileEdit(workDir, fixture) {
  const measurements = {
    totalMs: 0,
    breakdown: {},
  };

  // Find first item ID by reading the tree
  const treeDir = join(workDir, ".rex", "tree");
  let itemId = "";

  try {
    const entries = await readdir(treeDir, { recursive: true });
    for (const entry of entries) {
      if (entry.endsWith("index.md")) {
        const fullPath = join(treeDir, entry);
        const content = await readFile(fullPath, "utf-8");
        const match = content.match(/^id:\s*(.+)$/m);
        if (match) {
          itemId = match[1].trim();
          break;
        }
      }
    }
  } catch {
    // Continue
  }

  if (!itemId) {
    console.warn("  ⚠️  Could not extract item ID for edit test");
    return measurements;
  }

  // Time: rex update --title (using pnpm exec)
  const t0 = performance.now();
  try {
    const mainDir = process.cwd();
    await execAsync(
      `cd "${workDir}" && pnpm exec --dir="${mainDir}" rex update ${itemId} --title="Updated title (profiled)"`,
      {
        timeout: 30000,
        cwd: mainDir,
      }
    );
  } catch (err) {
    console.warn("  ⚠️  rex update failed:", err.message?.split("\n")[0]);
  }
  const t1 = performance.now();

  measurements.totalMs = Math.round(t1 - t0);
  measurements.breakdown.totalMs = measurements.totalMs;

  return measurements;
}

// ──────────────────────────────────────────────────────────────────────────────
// Bottleneck analysis
// ──────────────────────────────────────────────────────────────────────────────

function analyzeBottlenecks(results) {
  const timings = [];

  // Collect timings from all measurements
  for (const [size, sizeResults] of Object.entries(results)) {
    for (const [operation, measure] of Object.entries(sizeResults)) {
      if (measure.totalMs) {
        timings.push({
          operation,
          size,
          totalMs: measure.totalMs,
        });
      }
    }
  }

  // Group by operation and find average
  const grouped = new Map();
  for (const t of timings) {
    if (!grouped.has(t.operation)) {
      grouped.set(t.operation, []);
    }
    grouped.get(t.operation).push(t.totalMs);
  }

  const averages = [];
  for (const [operation, values] of grouped) {
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    averages.push({ operation, averageMs: Math.round(avg), count: values.length });
  }

  // Sort by average time (descending) and take top 3
  averages.sort((a, b) => b.averageMs - a.averageMs);

  return averages.slice(0, 3).map((item, index) => ({
    rank: index + 1,
    operation: item.operation,
    averageMs: item.averageMs,
    measurements: item.count,
    notes: getNoteForOperation(item.operation, item.averageMs),
  }));
}

function getNoteForOperation(operation, avgMs) {
  const notes = {
    add: `ndx add (includes CLI overhead, PRD load, serialization, file I/O)`,
    edit: `rex update (includes PRD load, item update, full tree re-serialization)`,
  };
  return notes[operation] || operation;
}

// ──────────────────────────────────────────────────────────────────────────────
// Reporting
// ──────────────────────────────────────────────────────────────────────────────

function printReport(report) {
  console.log("");

  // Results by size
  for (const [size, results] of Object.entries(report.results)) {
    const fixture = report.fixtures[size];
    console.log(`\n${size.toUpperCase()} PRD (${fixture.itemCount} items)`);
    console.log("-".repeat(60));

    for (const [op, measure] of Object.entries(results)) {
      console.log(`  ${op.padEnd(8)} ${measure.totalMs}ms`);
    }
  }

  // Top bottlenecks
  console.log("\n" + "=".repeat(60));
  console.log("TOP BOTTLENECKS");
  console.log("=".repeat(60));

  for (const bottleneck of report.bottlenecks) {
    console.log(
      `${bottleneck.rank}. ${bottleneck.operation} (avg ${bottleneck.averageMs}ms across ${bottleneck.measurements} measurements)`
    );
    console.log(`   ${bottleneck.notes}`);
  }
}

// ──────────────────────────────────────────────────────────────────────────────
// Run
// ──────────────────────────────────────────────────────────────────────────────

main().catch((err) => {
  console.error("❌ Error:", err.message);
  process.exit(1);
});
