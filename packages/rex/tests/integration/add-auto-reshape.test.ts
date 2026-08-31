/**
 * Integration tests for the auto-reshape consolidation pass wired into cmdAdd.
 *
 * Verifies:
 *  - Hash-suffix duplicate siblings are merged after add
 *  - --no-reshape suppresses the pass
 *  - A live reshape.lock causes the pass to be skipped
 *  - Scoped pass cost grows sub-quadratically with sibling count (a complexity
 *    gate, not a wall-clock budget — see that test for why)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { cmdInit } from "../../src/cli/commands/init.js";
import { cmdAdd } from "../../src/cli/commands/add.js";
import { resolveStore } from "../../src/store/index.js";
import { REX_DIR } from "../../src/cli/commands/constants.js";
import {
  stripHashSuffix,
  detectHashSuffixDuplicates,
  isReshapeInProgress,
  runScopedConsolidationPass,
  RESHAPE_LOCK_FILENAME,
  encodeReshapeLock,
} from "../../src/cli/commands/add-reshape.js";
import { loadArchive, ARCHIVE_FILE } from "../../src/core/archive.js";
import { stampModified } from "../../src/core/sync.js";
import { insertChild } from "../../src/core/tree.js";
import type { PRDItem } from "../../src/schema/index.js";

// No BUDGET_MULTIPLIER here. The perf assertion below guards complexity, and it
// now says so directly by comparing growth between two sibling counts rather than
// scaling an absolute wall-clock budget. See that test for the reasoning, and
// TESTING.md "Flake Resistance" for where scaled absolute budgets are still the
// right tool (genuine latency budgets, not complexity claims).


// ── Helpers ───────────────────────────────────────────────────────────────────

async function setupDir(): Promise<{ tmpDir: string; rexDir: string }> {
  const tmpDir = await mkdtemp(join(tmpdir(), "rex-add-reshape-"));
  await cmdInit(tmpDir, {});
  return { tmpDir, rexDir: join(tmpDir, REX_DIR) };
}

async function cleanup(tmpDir: string): Promise<void> {
  try {
    await rm(tmpDir, { recursive: true, force: true });
  } catch {
    // best-effort
  }
}

function makeItem(overrides: Partial<PRDItem> & { id?: string; title: string }): PRDItem {
  return {
    id: overrides.id ?? randomUUID(),
    title: overrides.title,
    level: overrides.level ?? "task",
    status: overrides.status ?? "pending",
    ...overrides,
  };
}

// ── Unit: stripHashSuffix ────────────────────────────────────────────────────

describe("stripHashSuffix", () => {
  it("strips parenthetical hash suffix", () => {
    expect(stripHashSuffix("Fix observation in global (abc123)")).toBe("Fix observation in global");
  });

  it("strips bracket hash suffix", () => {
    expect(stripHashSuffix("Fix bug [def456]")).toBe("Fix bug");
  });

  it("strips mixed-case hash suffix", () => {
    expect(stripHashSuffix("Update cache (AbC-123)")).toBe("Update cache");
  });

  it("leaves title without hash suffix unchanged", () => {
    expect(stripHashSuffix("Fix observation in global")).toBe("Fix observation in global");
  });

  it("does not strip long tokens (>12 chars)", () => {
    const title = "Fix bug (thisiswaytoolongatoken)";
    expect(stripHashSuffix(title)).toBe(title);
  });

  it("does not strip 2-char tokens (< 3 chars)", () => {
    const title = "Fix bug (ab)";
    expect(stripHashSuffix(title)).toBe(title);
  });

  it("handles trailing whitespace around suffix", () => {
    expect(stripHashSuffix("Fix bug ( abc123 )")).toBe("Fix bug");
  });
});

// ── Unit: detectHashSuffixDuplicates ─────────────────────────────────────────

describe("detectHashSuffixDuplicates", () => {
  it("returns empty when fewer than 2 siblings", () => {
    const result = detectHashSuffixDuplicates([makeItem({ title: "Fix bug (abc123)" })], "id1");
    expect(result).toHaveLength(0);
  });

  it("detects hash-suffix duplicate pair", () => {
    const existing = makeItem({ id: "existing", title: "Fix bug (abc123)" });
    const newItem = makeItem({ id: "new-id", title: "Fix bug (def456)" });
    const proposals = detectHashSuffixDuplicates([existing, newItem], "new-id");
    expect(proposals).toHaveLength(1);
    expect(proposals[0].action.action).toBe("merge");
    const action = proposals[0].action as { survivorId: string; mergedIds: string[] };
    // Existing (older, non-new) should survive
    expect(action.survivorId).toBe("existing");
    expect(action.mergedIds).toContain("new-id");
  });

  it("prefers no-suffix title as survivor", () => {
    const canonical = makeItem({ id: "canonical", title: "Fix bug" });
    const hashed = makeItem({ id: "hashed", title: "Fix bug (abc123)" });
    const proposals = detectHashSuffixDuplicates([canonical, hashed], "hashed");
    expect(proposals).toHaveLength(1);
    const action = proposals[0].action as { survivorId: string };
    expect(action.survivorId).toBe("canonical");
  });

  it("no proposals when titles differ after stripping", () => {
    const a = makeItem({ id: "a", title: "Fix bug (abc123)" });
    const b = makeItem({ id: "b", title: "Add feature (def456)" });
    const proposals = detectHashSuffixDuplicates([a, b], "b");
    expect(proposals).toHaveLength(0);
  });

  it("new item's title matching existing stripped title triggers consolidation", () => {
    const existing = makeItem({ id: "existing", title: "Fix observation in global (abc123)" });
    const newItem = makeItem({ id: "new-id", title: "Fix observation in global" });
    const proposals = detectHashSuffixDuplicates([existing, newItem], "new-id");
    expect(proposals).toHaveLength(1);
    const action = proposals[0].action as { survivorId: string };
    // canonical (no suffix) wins
    expect(action.survivorId).toBe("new-id");
  });
});

// ── Unit: isReshapeInProgress ─────────────────────────────────────────────────

describe("isReshapeInProgress", () => {
  let tmpDir: string;

  beforeEach(async () => {
    const setup = await setupDir();
    tmpDir = setup.tmpDir;
  });

  afterEach(async () => { await cleanup(tmpDir); });

  it("returns false when lock file is absent", async () => {
    expect(await isReshapeInProgress(join(tmpDir, REX_DIR))).toBe(false);
  });

  it("returns false when lock file contains dead PID", async () => {
    const rexDir = join(tmpDir, REX_DIR);
    // Use PID 1 on non-root — sending signal 0 to PID 1 typically succeeds
    // (init is always running). Use a PID that is almost certainly not running:
    // a large number unlikely to be a running process.
    const fakePid = 9_999_999;
    await writeFile(
      join(rexDir, RESHAPE_LOCK_FILENAME),
      JSON.stringify({ pid: fakePid, timestamp: new Date().toISOString() }),
    );
    expect(await isReshapeInProgress(rexDir)).toBe(false);
  });

  it("returns true when lock file contains current PID", async () => {
    const rexDir = join(tmpDir, REX_DIR);
    await writeFile(join(rexDir, RESHAPE_LOCK_FILENAME), encodeReshapeLock());
    expect(await isReshapeInProgress(rexDir)).toBe(true);
  });
});

// ── Regression: no hash-suffix creation on duplicate title ───────────────────

describe("no-hash-suffix-creation regression", () => {
  let tmpDir: string;
  let rexDir: string;

  beforeEach(async () => {
    const setup = await setupDir();
    tmpDir = setup.tmpDir;
    rexDir = setup.rexDir;
  });

  afterEach(async () => { await cleanup(tmpDir); });

  it("adds item with exact same title as sibling → merge, not hash-suffix", async () => {
    const store = await resolveStore(rexDir);

    const epicId = randomUUID();
    const existingId = randomUUID();
    await store.addItem({ id: epicId, title: "Auth Epic", level: "epic", status: "pending" });
    await store.addItem(
      { id: existingId, title: "Implement Login", level: "feature", status: "pending" },
      epicId,
    );

    // Add a second item with the exact same clean title
    await cmdAdd(tmpDir, "feature", { title: "Implement Login", parent: epicId });

    const doc = await store.loadDocument();
    const epic = doc.items.find((i) => i.id === epicId);
    const features = epic!.children?.filter((c) => c.level === "feature") ?? [];

    // Duplicate merged → only one feature remains
    expect(features).toHaveLength(1);

    // Surviving title must be the clean title (no appended hash/id suffix)
    const title = features[0].title;
    expect(title).toBe("Implement Login");
    // Belt-and-suspenders: no trailing parenthesised or bracketed short-id
    expect(title).not.toMatch(/\s*[\(\[][a-zA-Z0-9\-]{3,12}[\)\]]\s*$/);
  });

  it("add path never appends hash suffix for any title collision scenario", async () => {
    const store = await resolveStore(rexDir);

    const epicId = randomUUID();
    await store.addItem({ id: epicId, title: "Epic", level: "epic", status: "pending" });

    // Pre-populate several clean features
    const titles = ["Feature Alpha", "Feature Beta", "Feature Gamma"];
    for (const title of titles) {
      await store.addItem({ id: randomUUID(), title, level: "feature", status: "pending" }, epicId);
    }

    // Re-add each title via cmdAdd (exact duplicates, no descriptions)
    for (const title of titles) {
      await cmdAdd(tmpDir, "feature", { title, parent: epicId });
    }

    const doc = await store.loadDocument();
    const epic = doc.items.find((i) => i.id === epicId)!;
    const features = epic.children?.filter((c) => c.level === "feature") ?? [];

    // All duplicates should have been merged — original count preserved
    expect(features).toHaveLength(titles.length);

    // No title may carry a hash/id suffix
    for (const f of features) {
      expect(f.title).not.toMatch(/\s*[\(\[][a-zA-Z0-9\-]{3,12}[\)\]]\s*$/);
      expect(f.title).not.toMatch(/\s+-\s+[a-f0-9]{6,12}$/i);
    }
  });
});

// ── Integration: scoped pass wired into cmdAdd ─────────────────────────────

describe("cmdAdd scoped consolidation pass", () => {
  let tmpDir: string;
  let rexDir: string;

  /**
   * Extra project dirs created inside a single test, cleaned up alongside tmpDir.
   * The scaling test needs one store PER sibling count — see it for why sharing a
   * store invalidates the measurement.
   */
  let extraDirs: string[] = [];

  beforeEach(async () => {
    const setup = await setupDir();
    tmpDir = setup.tmpDir;
    rexDir = setup.rexDir;
    extraDirs = [];
  });

  afterEach(async () => {
    await cleanup(tmpDir);
    await Promise.all(extraDirs.map((d) => cleanup(d)));
  });

  it("consolidates hash-suffix duplicate siblings after add", async () => {
    const store = await resolveStore(rexDir);

    // Add an epic with an existing feature that has a hash suffix
    const epicId = randomUUID();
    const existingFeatureId = randomUUID();
    await store.addItem({ id: epicId, title: "Auth Epic", level: "epic", status: "pending" });
    await store.addItem(
      { id: existingFeatureId, title: "Fix auth bug (abc123)", level: "feature", status: "pending" },
      epicId,
    );

    // Add a new feature whose stripped title matches the existing one
    await cmdAdd(tmpDir, "feature", {
      title: "Fix auth bug (def456)",
      parent: epicId,
    });

    // The scoped consolidation pass should have merged the two hash-suffix duplicates
    const doc = await store.loadDocument();
    const epic = doc.items.find((i) => i.id === epicId);
    expect(epic).toBeDefined();
    // One of the two should have been merged into the other → only 1 feature remains
    expect(epic!.children?.filter((c) => c.level === "feature")).toHaveLength(1);
  });

  it("does not consolidate non-duplicate siblings", async () => {
    const store = await resolveStore(rexDir);

    const epicId = randomUUID();
    await store.addItem({ id: epicId, title: "Epic", level: "epic", status: "pending" });
    await store.addItem(
      { id: randomUUID(), title: "Fix auth bug", level: "feature", status: "pending" },
      epicId,
    );

    await cmdAdd(tmpDir, "feature", {
      title: "Add user login",
      parent: epicId,
    });

    const doc = await store.loadDocument();
    const epic = doc.items.find((i) => i.id === epicId);
    // Both features should remain (different titles)
    expect(epic!.children?.filter((c) => c.level === "feature")).toHaveLength(2);
  });

  it("--no-reshape bypasses the consolidation pass", async () => {
    const store = await resolveStore(rexDir);

    const epicId = randomUUID();
    const existingId = randomUUID();
    await store.addItem({ id: epicId, title: "Epic", level: "epic", status: "pending" });
    await store.addItem(
      { id: existingId, title: "Fix bug (abc123)", level: "feature", status: "pending" },
      epicId,
    );

    // Add duplicate with --no-reshape
    await cmdAdd(tmpDir, "feature", {
      title: "Fix bug (def456)",
      parent: epicId,
      "no-reshape": "true",
    });

    const doc = await store.loadDocument();
    const epic = doc.items.find((i) => i.id === epicId);
    // Both features should remain because the pass was skipped
    expect(epic!.children?.filter((c) => c.level === "feature")).toHaveLength(2);
  });

  it("skips consolidation when reshape.lock is held by live process", async () => {
    const store = await resolveStore(rexDir);

    const epicId = randomUUID();
    const existingId = randomUUID();
    await store.addItem({ id: epicId, title: "Epic", level: "epic", status: "pending" });
    await store.addItem(
      { id: existingId, title: "Fix bug (abc123)", level: "feature", status: "pending" },
      epicId,
    );

    // Write a reshape.lock for the current process (simulates in-progress reshape)
    await writeFile(join(rexDir, RESHAPE_LOCK_FILENAME), encodeReshapeLock());

    try {
      await cmdAdd(tmpDir, "feature", {
        title: "Fix bug (def456)",
        parent: epicId,
      });

      const doc = await store.loadDocument();
      const epic = doc.items.find((i) => i.id === epicId);
      // Both should remain because the pass was skipped due to the lock
      expect(epic!.children?.filter((c) => c.level === "feature")).toHaveLength(2);
    } finally {
      // Clean up the lock file
      try {
        const { unlink } = await import("node:fs/promises");
        await unlink(join(rexDir, RESHAPE_LOCK_FILENAME));
      } catch { /* already gone */ }
    }
  });

  it("prefers survivor with more children over no-suffix survivor with no children", () => {
    // item-with-children has a hash suffix but has 2 children
    // item-no-suffix has no hash suffix but has no children
    // Survivor selection: most children wins first
    const withChildren = makeItem({
      id: "with-children",
      title: "Fix bug (abc123)",
      children: [makeItem({ title: "Sub A" }), makeItem({ title: "Sub B" })],
    });
    const noSuffix = makeItem({ id: "no-suffix", title: "Fix bug" });
    const proposals = detectHashSuffixDuplicates([withChildren, noSuffix], "no-suffix");
    expect(proposals).toHaveLength(1);
    const action = proposals[0].action as { survivorId: string; mergedIds: string[] };
    expect(action.survivorId).toBe("with-children");
    expect(action.mergedIds).toContain("no-suffix");
  });

  it("emits GroupAction when all items in a group have at least one child", () => {
    const feat1 = makeItem({
      id: "feat-1",
      title: "Login (abc)",
      level: "feature",
      children: [makeItem({ title: "Subtask A" })],
    });
    const feat2 = makeItem({
      id: "feat-2",
      title: "Login (def)",
      level: "feature",
      children: [makeItem({ title: "Subtask B" })],
    });
    const proposals = detectHashSuffixDuplicates([feat1, feat2], "feat-2");
    expect(proposals).toHaveLength(1);
    expect(proposals[0].action.action).toBe("group");
  });

  it("emits MergeAction when at least one item has no children", () => {
    const feat1 = makeItem({
      id: "feat-1",
      title: "Login (abc)",
      level: "feature",
      children: [makeItem({ title: "Subtask A" })],
    });
    // feat2 has no children
    const feat2 = makeItem({ id: "feat-2", title: "Login (def)", level: "feature" });
    const proposals = detectHashSuffixDuplicates([feat1, feat2], "feat-2");
    expect(proposals).toHaveLength(1);
    expect(proposals[0].action.action).toBe("merge");
  });

  it("writes to archive after scoped consolidation merges items", async () => {
    const store = await resolveStore(rexDir);

    const epicId = randomUUID();
    const existingId = randomUUID();
    await store.addItem({ id: epicId, title: "Epic", level: "epic", status: "pending" });
    await store.addItem(
      { id: existingId, title: "Fix bug (abc123)", level: "feature", status: "pending" },
      epicId,
    );

    // Add a duplicate
    await cmdAdd(tmpDir, "feature", {
      title: "Fix bug (def456)",
      parent: epicId,
    });

    // After the consolidation pass, archive should have a batch
    const archive = await loadArchive(join(rexDir, ARCHIVE_FILE));
    expect(archive.batches.length).toBeGreaterThan(0);
    const lastBatch = archive.batches[archive.batches.length - 1];
    expect(lastBatch.source).toBe("reshape");
    expect(lastBatch.items.length).toBeGreaterThan(0);
  });

  /**
   * This replaced an absolute `expect(elapsed).toBeLessThan(500)`.
   *
   * That budget measured the machine rather than the code: it passed in isolation
   * and, under full-suite load, was observed timing out at the 30s test limit —
   * 60x over — with runScopedConsolidationPass unchanged. A gate that is red for
   * reasons unrelated to its subject stops being read.
   *
   * What it was guarding is that the pass stays SCOPED: cost should track the
   * sibling set it examines, not blow up super-linearly as that set grows. So
   * measure two sibling counts back-to-back in the same process and assert the
   * growth. Ambient load scales both readings, so the ratio holds on a busy
   * machine while a real complexity regression still trips it.
   */
  // Back on the default timeout. This carried an explicit 60s because building
  // 125 items through store.addItem — one full load-and-rewrite of the tree per
  // item — made setup ~14s, and under full-suite load that setup blew past even
  // 60s (observed at 60034ms while passing in 21s isolated). Batching the whole
  // cohort into a single withTransaction removed the cause rather than the
  // symptom: the case now runs in ~1.5s, so the default leaves ~20x headroom and
  // the two-point measurement no longer costs a special-cased limit.
  it("scoped pass cost grows sub-quadratically with sibling count", async () => {
    /**
     * Build an epic with `siblings` features in ITS OWN store, then time the
     * consolidation pass triggered by one more. Returns the fastest of `runs`.
     *
     * OWN STORE, NOT A SHARED ONE. Both sizes used to be built in the same store,
     * so the 100-sibling pass ran against a tree that already held the 25-sibling
     * epic while the 25-sibling pass did not. Any part of the pass's cost that
     * tracks TOTAL tree size rather than sibling count then landed on the large
     * reading only, inflating the ratio — biased toward false failure, and the
     * sibling-count claim was never cleanly isolated. One store per size makes
     * sibling count the only variable.
     *
     * FASTEST OF N, NOT ONE SHOT. A single timing per size left this gate as
     * load-sensitive as the absolute budget it replaced: three runs on an idle
     * machine produced small readings of 204.7ms, 68.3ms and 59.9ms — a 3.4x
     * spread — and the cold first reading is the one that flatters the ratio, which
     * is backwards. The minimum treats load as the noise it is, and it also makes
     * the first pass double as the warm-up: that pass is reliably the slowest, so
     * the minimum discards it without needing a separate throwaway.
     *
     * The tree is built ONCE and only the pass is repeated. Rebuilding per run
     * would repeat the setup for no gain — it is still the larger half even
     * batched, and repeating it would measure the same tree either way.
     */
    async function timeScopedPass(siblings: number, runs = 7): Promise<number> {
      const own = await setupDir();
      extraDirs.push(own.tmpDir);
      const store = await resolveStore(own.rexDir);

      const epicId = randomUUID();
      // Added directly, bypassing cmdAdd overhead, so only the pass is timed.
      const newId = randomUUID();

      // ONE transaction for the whole cohort, not one per item. store.addItem
      // wraps every insert in its own withTransaction — take the lock, load the
      // entire tree, write the entire tree — so building 126 items cost 126 full
      // loads and 126 full writes, quadratic in the work rather than the tree.
      // That setup, not the timed pass, is what pushed this test past its limit
      // under full-suite load (observed timing out at 60s while passing in 21s
      // isolated).
      //
      // Uses the same stampModified + insertChild that addItem uses, so the tree
      // this produces is identical — it is only serialized once. insertChild's
      // return is asserted because it answers false on a hierarchy violation
      // rather than throwing, and a silently-empty epic would make the timings
      // below measure nothing.
      await store.withTransaction(async (doc) => {
        doc.items.push(
          await stampModified({ id: epicId, title: "Scaling Epic", level: "epic", status: "pending" }),
        );
        for (let i = 0; i < siblings; i++) {
          const ok = insertChild(
            doc.items,
            epicId,
            await stampModified({
              id: randomUUID(),
              title: `Scaling Feature ${i}`,
              level: "feature",
              status: "pending",
            }),
          );
          expect(ok, `failed to insert sibling ${i}`).toBe(true);
        }
        const ok = insertChild(
          doc.items,
          epicId,
          await stampModified({
            id: newId,
            title: "Scaling Feature unique",
            level: "feature",
            status: "pending",
          }),
        );
        expect(ok, "failed to insert the triggering sibling").toBe(true);
      });

      let best = Infinity;
      for (let i = 0; i < runs; i++) {
        const start = performance.now();
        await runScopedConsolidationPass(own.rexDir, store, newId, {});
        best = Math.min(best, performance.now() - start);
      }

      // Repeating the pass is only sound because it is a no-op on this fixture:
      // every sibling title is distinct, so nothing is consolidated and each run
      // measures the same tree. Asserted rather than assumed — if the pass ever
      // began merging here, runs 2 and 3 would silently measure a shrinking tree
      // and the minimum would be meaningless.
      const doc = await store.loadDocument();
      const epic = doc.items.find((i) => i.id === epicId);
      expect(
        epic?.children?.length,
        "the timed pass mutated the fixture, so repeated runs did not measure the same work",
      ).toBe(siblings + 1);

      return best;
    }

    const smallSiblings = 25;
    const largeSiblings = 100;
    const sizeRatio = largeSiblings / smallSiblings;

    const smallMs = await timeScopedPass(smallSiblings);
    const largeMs = await timeScopedPass(largeSiblings);

    // MEASURED 2026-08-19 (Windows 11, Node v22). Three runs of this test, each
    // reading already the min of 7 passes against an isolated store:
    //
    //   run   25 siblings   100 siblings   ratio
    //     1        61.4ms        192.0ms    3.13x
    //     2        64.4ms        199.7ms    3.10x
    //     3        80.5ms        227.9ms    2.83x
    //
    // RE-MEASURED 2026-08-31, after setup moved to a single withTransaction:
    // 34.3ms / 129.7ms, ratio 3.78x. The timed pass is unchanged, so the lower
    // absolute readings are the quieter machine (no 126 tree rewrites racing the
    // filesystem immediately beforehand); the ratio moved within its existing
    // spread and stays far below the 8x bound.
    //
    // Sub-linear for a 4x sibling step, because the pass's cost is dominated by
    // loading the tree (26 vs 101 items) rather than by scanning the cohort.
    //
    // MIN-OF-7, NOT 3, AND THAT NUMBER IS MEASURED TOO. With 3 the ratios were
    // 4.91x / 7.15x / 3.23x — a 2.2x spread that left only 1.68x below the old 12x
    // bound, barely better than the single-shot version this replaced. At 7 the
    // spread collapses to 1.11x. It is affordable because the expensive half is
    // setup, not the passes: going 3 → 7 cost ~1-2s of a ~35s test.
    //
    // BOUND TIGHTENED 12x → 8x (2x the size ratio), not raised. It sits 2.6x above
    // the worst clean reading, and is verified in the other direction as
    // TESTING.md "Flake Resistance" requires: an artificial term scaling as
    // (cohort size)² added to runScopedConsolidationPass drove the ratio to 9.4x
    // (25: 127.8ms, 100: 1200.5ms) and failed this gate. The old 12x bound would
    // have let that same regression through.
    //
    // SENSITIVITY LIMIT, worth knowing before tightening further: because tree
    // loading dominates, a quadratic term has to be large in absolute terms at 100
    // siblings (~1s) before it moves this ratio. A smaller one is real but invisible
    // here — it would need a bigger sibling step to surface, which costs setup time.
    const timeRatio = largeMs / Math.max(smallMs, 0.1);

    // Printed on pass as well as failure: re-deriving this bound after a
    // deliberate change means reading these off a few runs, and a bound nobody can
    // see the inputs to is a bound nobody will re-derive.
    // eslint-disable-next-line no-console
    console.log(
      `\n  [scoped pass] ${smallSiblings} siblings ${smallMs.toFixed(1)}ms · ` +
      `${largeSiblings} siblings ${largeMs.toFixed(1)}ms · ` +
      `ratio ${timeRatio.toFixed(2)}x for a ${sizeRatio}x size step (bound ${sizeRatio * 2}x)`,
    );
    expect(
      timeRatio,
      `scoped pass scaled ${timeRatio.toFixed(1)}x for a ${sizeRatio}x sibling increase ` +
      `(${smallSiblings}: ${smallMs.toFixed(1)}ms, ${largeSiblings}: ${largeMs.toFixed(1)}ms). ` +
      `It was linear (~${sizeRatio}x) when this test was written; a quadratic ` +
      `regression would show ~${(sizeRatio * sizeRatio).toFixed(0)}x.`,
    ).toBeLessThan(sizeRatio * 2);
  });
});
