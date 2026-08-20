/**
 * Profiling harness for the prd_tree write path.
 *
 * Measures and documents baseline latencies for single-item add and edit
 * on small (~20), medium (~200), and large (~1000) item PRDs.
 *
 * The harness also gates against complexity regressions, by asserting how each
 * phase's cost GROWS between fixture sizes rather than checking any size against
 * an absolute millisecond budget. See SCALING_HEADROOM near the bottom of this
 * file for the measured baselines the bound comes from, and the describe-block
 * comment for why a ratio replaced the budgets.
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
 * RECORDED BASELINES (Windows 11, Node.js v22, min of 3 warm passes, 2026-08-19)
 * Same fixtures, ~10-20x slower per phase — Windows pays far more per filesystem
 * syscall, and this is the machine class that sets the SCALING_HEADROOM bound.
 * ──────────────────────────────────────────────────────────────────────────────
 *
 *   size    items   parse   serialize   addItem   updateItem
 *   small      28    65ms       27ms      106ms        94ms
 *   medium    205   580ms      273ms      860ms       900ms
 *   large    1110  3133ms      709ms     3809ms      3000ms
 *
 * One representative run. Do not read these as precise: the same phase varied by
 * up to 2.6x across passes on an otherwise idle machine (large updateItem was
 * seen at 4072ms, 10468ms and 5500ms within a single min-of-3), which is exactly
 * why the assertions below compare growth rather than absolute milliseconds.
 *
 * ──────────────────────────────────────────────────────────────────────────────
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
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

/**
 * One measurement pass over all four phases.
 *
 * Returns unrounded milliseconds. Rounding happens at the display site only:
 * the scaling assertions divide these readings, and a small fixture phase that
 * rounded to 0ms would make the ratio Infinity on a fast machine.
 */
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

  return { parseMs, serializeMs, addItemMs, updateItemMs };
}

/** The four measured phases, in the order they run. */
const PHASES = ["parseMs", "serializeMs", "addItemMs", "updateItemMs"] as const;

/**
 * Per-phase fastest reading across `runs` passes.
 *
 * Minimum rather than mean or median, and taken per phase rather than per pass:
 * the thing being measured is how long the work takes, so a slower reading only
 * ever means the machine was busy at that moment. Load spikes hit individual
 * phases, not whole passes, so a per-pass minimum would let one spike discard
 * three good readings from the other phases.
 *
 * The first pass doubles as the filesystem-cache warm-up — it is reliably the
 * slowest, so the minimum discards it without needing a separate throwaway pass.
 * That keeps the cost of this harness at three passes rather than four.
 *
 * Note the phases are self-correcting across passes: phase 3 adds an epic and
 * phase 2 of the next pass re-serializes the original fixture, whose stale-subdir
 * sweep removes it again. Item counts therefore do not drift as `runs` grows.
 */
async function fastestPhases(
  rexDir: string,
  items: PRDItem[],
  runs = 3,
): Promise<{ best: PhaseTiming; samples: PhaseTiming[] }> {
  const samples: PhaseTiming[] = [];
  const best: PhaseTiming = {
    parseMs: Infinity,
    serializeMs: Infinity,
    addItemMs: Infinity,
    updateItemMs: Infinity,
  };

  for (let i = 0; i < runs; i++) {
    const timing = await measurePhases(rexDir, items);
    samples.push(timing);
    for (const phase of PHASES) {
      best[phase] = Math.min(best[phase], timing[phase]);
    }
  }

  return { best, samples };
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

/**
 * How far above linear a phase may scale before it counts as a regression.
 *
 * Derived from measurement in both directions — how high a clean run goes, and
 * how low a deliberately degraded one goes — not picked round. The size step from
 * the small to the large fixture is 1110/28 ≈ 39.6x, so linear scaling lands at
 * ≈40x and a genuinely quadratic phase at ≈1570x. Anything between separates
 * them; the only question is how much of that gap to spend on headroom.
 *
 * MEASURED CLEAN (2026-08-19, Windows 11, Node v22, four runs, each the min of 3
 * warm passes). Windows is the machine class the bound has to clear: it pays far
 * more per filesystem syscall than macOS and produces the highest ratios.
 *
 *   phase        observed small→large ratios          worst   vs linear
 *   parse        48.1x  46.9x  51.2x  58.0x           58.0x      1.46x
 *   serialize    25.9x  28.6x  54.8x  56.8x           56.8x      1.43x
 *   addItem      36.0x  29.5x  48.2x  83.3x           83.3x      2.10x
 *   updateItem   31.8x  25.5x  46.3x  51.5x           51.5x      1.30x
 *
 * The same phases on macOS M-class (see RECORDED BASELINES above) all sit at
 * ≈1x linear. So the ratio is itself somewhat OS-dependent — Windows per-item
 * syscall cost grows with directory size in a way macOS's does not, which is a
 * property of the platform, not a complexity regression.
 *
 * MEASURED DEGRADED. 6x linear (238x) was tried first and is NOT sensitive
 * enough: an artificial term scaling as n² added to parseFolderTree, big enough
 * to make large-fixture parse 4.6x slower (3015ms → 13860ms), still PASSED at
 * 200.9x. Verified, not assumed — the first version of this bound was wrong and
 * only running the degradation showed it.
 *
 * 4x linear (158.6x) is the bound that holds both ends: it clears the worst clean
 * reading (83.3x) by 1.9x, and it fails that same degradation at 200.9x. It also
 * matches the two sibling conversions, which is a happier coincidence than it
 * looks — 4x is roughly where "twice the worst thing we have ever measured"
 * lands once min-of-3 has filtered the load spikes out.
 *
 * TO RE-DERIVE after a deliberate change: the test prints every gated ratio on
 * pass as well as failure. Read them off three runs, and keep the bound at about
 * twice the worst.
 *
 * See packages/rex/tests/unit/store/folder-tree-parser.test.ts and
 * tests/integration/add-auto-reshape.test.ts for the same pattern at other sites.
 */
const SCALING_HEADROOM = 4;

/**
 * Why a ratio and not a budget.
 *
 * This file used to assert absolute wall-clock per fixture — small 5s, medium
 * 20s, large 60s — described in place as "intentionally loose ... detect O(n²)
 * regressions, not enforce sub-millisecond precision". That is a complexity
 * claim expressed as a wall-clock number, and it measured the machine as much as
 * the code: it was observed failing at "slowest phase 5005ms exceeds regression
 * budget 5000ms" under full-suite load, over by 5ms out of 5000 (0.1%). A loose
 * absolute budget does not stop being machine-dependent, it just fails less
 * often — and the fix cannot be to raise it, because the next unusually busy
 * machine simply fails at the new number.
 *
 * The complexity claim is asserted directly instead. Three fixture sizes were
 * already being measured across four phases, so the scaling data was being
 * collected and then thrown away; the growth between sizes is what the budgets
 * were reaching for. Ambient load inflates both readings together, so the ratio
 * survives a busy machine while still catching a genuine complexity regression.
 *
 * Small→large is the pair asserted, rather than the adjacent steps: at 39.6x it
 * is the widest span the fixtures offer, which puts the most distance between
 * linear and quadratic. Its fixed-overhead bias is also the safe direction —
 * per-pass overhead inflates the small reading, which DEFLATES the ratio and can
 * therefore only ever make this assertion more forgiving, never falsely strict.
 */
describe("prd_tree write path profiling", () => {
  it(
    "every write-path phase scales sub-quadratically across fixture sizes",
    { timeout: 600_000 },
    async () => {
      const measured = {} as Record<
        keyof typeof FIXTURE_CONFIGS,
        { itemCount: number; best: PhaseTiming }
      >;

      for (const [label, cfg] of Object.entries(FIXTURE_CONFIGS) as [
        keyof typeof FIXTURE_CONFIGS,
        (typeof FIXTURE_CONFIGS)[keyof typeof FIXTURE_CONFIGS],
      ][]) {
        const items = buildFixture(cfg);
        const itemCount = countItems(items);
        const { rexDir } = await setupFixtureStore(label, items);
        const { best, samples } = await fastestPhases(rexDir, items);

        measured[label] = { itemCount, best };

        // Kept from the original harness: this file doubles as the documented way
        // to read current write-path latencies (see the header). Samples are shown
        // alongside the minimum so a wide spread is visible as load, not mistaken
        // for the measurement itself.
        // eslint-disable-next-line no-console
        console.log(
          `\n  [${label}] ${itemCount} items — ` +
          PHASES.map((p) => `${p.replace(/Ms$/, "")}=${Math.round(best[p])}ms`).join("  ") +
          `\n           samples: ` +
          samples
            .map((s) => `(${PHASES.map((p) => Math.round(s[p])).join("/")})`)
            .join(" "),
        );
      }

      const sizeRatio = measured.large.itemCount / measured.small.itemCount;
      const bound = sizeRatio * SCALING_HEADROOM;

      // The gated numbers, printed whether or not they pass. Re-deriving the
      // bound after a deliberate change means reading these off a few runs, and
      // a bound nobody can see the inputs to is a bound nobody will re-derive.
      // eslint-disable-next-line no-console
      console.log(
        `\n  scaling (small→large, ${sizeRatio.toFixed(1)}x size step, ` +
        `bound ${bound.toFixed(0)}x = ${SCALING_HEADROOM}x linear) — ` +
        PHASES.map((p) => {
          const ratio = measured.large.best[p] / Math.max(measured.small.best[p], 0.1);
          return `${p.replace(/Ms$/, "")}=${ratio.toFixed(1)}x`;
        }).join("  "),
      );

      for (const phase of PHASES) {
        // Floor the divisor so a sub-0.1ms small reading cannot manufacture a
        // false Infinity on a machine faster than any measured here.
        const smallMs = Math.max(measured.small.best[phase], 0.1);
        const largeMs = measured.large.best[phase];
        const timeRatio = largeMs / smallMs;

        expect(
          timeRatio,
          `${phase.replace(/Ms$/, "")} scaled ${timeRatio.toFixed(1)}x for a ` +
          `${sizeRatio.toFixed(1)}x size increase ` +
          `(${measured.small.itemCount} items: ${smallMs.toFixed(1)}ms, ` +
          `${measured.large.itemCount} items: ${largeMs.toFixed(1)}ms). ` +
          `Linear would be ~${sizeRatio.toFixed(0)}x and quadratic ~${(sizeRatio ** 2).toFixed(0)}x; ` +
          `this suggests a complexity regression. ` +
          `Medium (${measured.medium.itemCount} items) read ` +
          `${measured.medium.best[phase].toFixed(1)}ms, for triangulation.`,
        ).toBeLessThan(bound);
      }
    },
  );
});
