/**
 * Hench intra-package call-graph analysis script.
 *
 * Analyzes callgraph.json to detect circular call patterns between
 * hench subdirectories (agent/, prd/, tools/, etc.).
 *
 * Each edge in callgraph.json represents a single call site (no callCount
 * field), so we count edges rather than summing a weight.
 *
 * Usage:  node scripts/hench-callgraph-analysis.mjs
 * Requires: Node >= 18 (ES module, top-level await not used but fs imports needed)
 * Prerequisite: Run `ndx plan .` or `sourcevision analyze .` first to generate
 *               .sourcevision/callgraph.json.
 *
 * Note: This script is intentionally excluded from the monorepo build and test
 * pipelines — it is a one-off diagnostic tool, not production code.
 */

import { readFileSync, existsSync } from "fs";

const CALLGRAPH_PATH = ".sourcevision/callgraph.json";

// ── Data loading ─────────────────────────────────────────────────────

function loadCallgraph(path) {
  if (!existsSync(path)) {
    console.error(
      `ERROR: ${path} not found.\n` +
      `Run 'ndx plan .' or 'sourcevision analyze .' first to generate analysis artifacts.`,
    );
    process.exit(1);
  }

  let cg;
  try {
    cg = JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    console.error(`ERROR: Failed to parse ${path}: ${err.message}`);
    process.exit(1);
  }

  if (!cg.edges || !Array.isArray(cg.edges)) {
    console.error(`ERROR: ${path} is missing or has an invalid 'edges' array.`);
    process.exit(1);
  }

  return cg;
}

// ── Edge filtering and directory extraction ──────────────────────────

function filterHenchEdges(edges) {
  return edges.filter(
    (e) =>
      e.callerFile?.startsWith("packages/hench/src/") &&
      e.calleeFile?.startsWith("packages/hench/src/"),
  );
}

function subdir(path) {
  const rel = path.replace("packages/hench/src/", "");
  // Files directly in src/ (e.g. public.ts) get subdir "."
  const slash = rel.indexOf("/");
  return slash === -1 ? "." : rel.slice(0, slash);
}

// ── Directory-level edge aggregation ─────────────────────────────────

function buildDirectoryEdgeCounts(henchEdges) {
  const dirCalls = new Map();
  for (const edge of henchEdges) {
    const from = subdir(edge.callerFile);
    const to = subdir(edge.calleeFile);
    const key = `${from} -> ${to}`;
    dirCalls.set(key, (dirCalls.get(key) || 0) + 1);
  }
  return dirCalls;
}

function separateEdges(dirCalls) {
  const sorted = [...dirCalls.entries()].sort((a, b) => b[1] - a[1]);
  const crossDir = [];
  const internal = [];
  for (const [key, count] of sorted) {
    const parts = key.split(" -> ");
    if (parts[0] === parts[1]) {
      internal.push({ key, count });
    } else {
      crossDir.push({ key, count, from: parts[0], to: parts[1] });
    }
  }
  return { crossDir, internal };
}

// ── Cycle detection ──────────────────────────────────────────────────

function detectCycles(crossDir) {
  const adjacency = new Map();
  for (const { from, to, count } of crossDir) {
    if (!adjacency.has(from)) adjacency.set(from, []);
    adjacency.get(from).push({ to, count });
  }

  const cycles = [];
  for (const [a, targets] of adjacency) {
    for (const { to: b, count: countAB } of targets) {
      const reverse = adjacency.get(b);
      if (reverse) {
        const reverseEdge = reverse.find((r) => r.to === a);
        if (reverseEdge) {
          const key = [a, b].sort().join(" <-> ");
          if (!cycles.find((c) => c.key === key)) {
            cycles.push({
              key,
              a,
              b,
              abCount: countAB,
              baCount: reverseEdge.count,
              total: countAB + reverseEdge.count,
            });
          }
        }
      }
    }
  }

  return cycles.sort((a, b) => b.total - a.total);
}

// ── File-level cycle detail ──────────────────────────────────────────

function getCycleFileDetail(cycle, henchEdges) {
  const groupEdges = (fromDir, toDir) => {
    const edges = henchEdges.filter(
      (e) => subdir(e.callerFile) === fromDir && subdir(e.calleeFile) === toDir,
    );
    const groups = new Map();
    for (const e of edges) {
      const k = `${e.callerFile} -> ${e.calleeFile}`;
      groups.set(k, (groups.get(k) || 0) + 1);
    }
    return [...groups.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  };

  return {
    ab: groupEdges(cycle.a, cycle.b),
    ba: groupEdges(cycle.b, cycle.a),
  };
}

// ── Output formatting ────────────────────────────────────────────────

function printReport(henchEdges, crossDir, internal, cycles) {
  console.log("Hench intra-package call graph (directory level):");
  console.log(`Total internal edges: ${henchEdges.length}`);
  console.log("");

  console.log("=== Cross-directory calls ===");
  for (const { key, count } of crossDir) {
    console.log(`  ${key.padEnd(40)} ${String(count).padStart(5)}`);
  }

  console.log("\n=== Internal calls ===");
  for (const { key, count } of internal) {
    console.log(`  ${key.padEnd(40)} ${String(count).padStart(5)}`);
  }

  console.log("\n=== Circular pattern detection ===");
  if (cycles.length === 0) {
    console.log("  No circular patterns detected.");
  } else {
    for (const cycle of cycles) {
      console.log(
        `  CYCLE: ${cycle.a} <-> ${cycle.b} (${cycle.abCount} + ${cycle.baCount} = ${cycle.total} calls)`,
      );
    }
  }

  if (cycles.length > 0) {
    console.log("\n=== File-level cycle detail ===");
    for (const cycle of cycles) {
      console.log(`\n  ${cycle.a} <-> ${cycle.b}:`);
      const detail = getCycleFileDetail(cycle, henchEdges);

      console.log(`    ${cycle.a} -> ${cycle.b}:`);
      for (const [k, c] of detail.ab) {
        console.log(`      ${k} (${c} calls)`);
      }

      console.log(`    ${cycle.b} -> ${cycle.a}:`);
      for (const [k, c] of detail.ba) {
        console.log(`      ${k} (${c} calls)`);
      }
    }
  }

  // Known import-level cycles from manual analysis
  console.log("\n=== Import-level cross-directory analysis ===");
  console.log("(Detected from source code, not callgraph.json)");
  console.log("  process <-> tools: directory-level import cycle");
  console.log("    process/exec-shell.ts re-exports from tools/exec-shell.ts");
  console.log("    tools/exec-shell.ts imports exec from process/exec.ts");
  console.log("    tools/rex.ts imports execShellCmd from process/index.ts");
  console.log("    tools/test-runner.ts imports execShellCmd from process/index.ts");
}

// ── Main ─────────────────────────────────────────────────────────────

const cg = loadCallgraph(CALLGRAPH_PATH);
const henchEdges = filterHenchEdges(cg.edges);
const dirCalls = buildDirectoryEdgeCounts(henchEdges);
const { crossDir, internal } = separateEdges(dirCalls);
const cycles = detectCycles(crossDir);
printReport(henchEdges, crossDir, internal, cycles);
