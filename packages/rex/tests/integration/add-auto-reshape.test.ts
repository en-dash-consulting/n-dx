/**
 * Integration tests for the auto-reshape consolidation pass wired into cmdAdd.
 *
 * Verifies:
 *  - Hash-suffix duplicate siblings are merged after add
 *  - --no-reshape suppresses the pass
 *  - A live reshape.lock causes the pass to be skipped
 *  - Scoped consolidation compares siblings a linear number of times (a
 *    complexity gate that counts comparisons — see that test for why it does
 *    not time them)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
  detectNonDuplicateTitleCollisions,
  isReshapeInProgress,
  RESHAPE_LOCK_FILENAME,
  encodeReshapeLock,
} from "../../src/cli/commands/add-reshape.js";
import { loadArchive, ARCHIVE_FILE } from "../../src/core/archive.js";
import type { PRDItem } from "../../src/schema/index.js";

// No BUDGET_MULTIPLIER here, and no clock at all. The complexity gate below
// counts pairwise comparisons instead of timing them, so there is no budget to
// scale. See that test for why timing could not be made reliable here, and
// TESTING.md "Flake Resistance" for where scaled absolute budgets are still the
// right tool (genuine latency budgets, not complexity claims).

// Counts calls to the pairwise content-comparison primitive. Hoisted because
// vi.mock factories run before module-level initialisers, so a plain `let` here
// would be in its TDZ when the factory closes over it.
const counters = vi.hoisted(() => ({ similarityCalls: 0 }));

// Delegates to the real implementation and only counts — behaviour is unchanged
// for every other test in this file, which reach `similarity` through cmdAdd.
vi.mock("../../src/analyze/dedupe.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/analyze/dedupe.js")>();
  return {
    ...actual,
    similarity: (a: string, b: string): number => {
      counters.similarityCalls++;
      return actual.similarity(a, b);
    },
  };
});


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

  beforeEach(async () => {
    const setup = await setupDir();
    tmpDir = setup.tmpDir;
    rexDir = setup.rexDir;
  });

  afterEach(async () => {
    await cleanup(tmpDir);
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
   * COMPLEXITY GATE — counts work rather than timing it.
   *
   * Three earlier versions of this assertion compared wall-clock readings: an
   * absolute `expect(elapsed).toBeLessThan(500)`, then a growth ratio between two
   * sibling counts, then that ratio taken as the min of 7 passes against
   * per-size stores. The last of those still failed on an IDLE machine at 8.6x
   * against an 8x bound, and failed reliably under the CPU load of an `ndx work`
   * run — taking the hench pre-commit test gate red with it, on every task, for
   * reasons unrelated to the code under test.
   *
   * It could not be fixed by tuning the bound. Its own SENSITIVITY LIMIT note
   * recorded why: the readings were dominated by loading the tree (26 vs 101
   * items), not by the cohort scan the test claimed to guard, so the signal it
   * wanted was a minority of what it measured and the noise floor sat right at
   * the threshold.
   *
   * What actually defines the complexity is how many pairwise content
   * comparisons the detector performs. `similarity` is that primitive: grouping
   * by normalized title calls it once per colliding pair — linear in cohort size
   * — while comparing every sibling against every other calls it O(n²) times.
   * Counting it is exact, needs no clock, and survives refactors that a
   * title-read counter would not, because copying the cohort into a local
   * structure changes neither the count nor the complexity.
   *
   * Deterministic: both counts are integers fixed by the fixture, identical on an
   * idle machine and a saturated one. No raised timeout — this builds no store
   * and does no I/O, so it runs in milliseconds where the timing version needed
   * ~35s of setup.
   */
  it("scoped consolidation compares siblings a linear number of times", () => {
    /**
     * Build `siblings` items as `siblings / 2` same-title pairs, each side
     * carrying content that shares no vocabulary with the other.
     *
     * That shape is deliberate: `detectNonDuplicateTitleCollisions` only compares
     * groups of EXACTLY 2, and only when both sides have content, so every pair
     * here reaches the `similarity` call and nothing else does. Titles differ
     * across pairs, so no group ever exceeds two members.
     *
     * The two sides must be genuinely DISSIMILAR, not merely different strings.
     * A first attempt used "…side a of pair 3" / "…side b of pair 3", which
     * scored ABOVE the distinctness threshold, so the detector classified each
     * pair as a true duplicate and routed it to the merge path — comparisons
     * still happened, but the fixture guard below correctly reported that the
     * cohort had stopped exercising the collision path.
     */
    const SIDE_CONTENT = [
      "Streams ingested records through a bounded queue with backpressure.",
      "Adds keyboard navigation and focus outlines to the settings dialog.",
    ];

    function makeCohort(siblings: number): PRDItem[] {
      const items: PRDItem[] = [];
      for (let pair = 0; pair < siblings / 2; pair++) {
        for (const content of SIDE_CONTENT) {
          items.push(
            makeItem({ title: `Collision ${pair}`, level: "feature", description: content }),
          );
        }
      }
      return items;
    }

    function countComparisons(siblings: number): number {
      const cohort = makeCohort(siblings);
      counters.similarityCalls = 0;
      const collisions = detectNonDuplicateTitleCollisions(cohort);

      // Guard the fixture, do not assume it. If the cohort ever stopped producing
      // pairwise collisions the comparison count would fall to zero, and the
      // growth assertion below would pass while measuring nothing at all.
      expect(
        collisions.length,
        "fixture stopped producing pairwise title collisions, so nothing was compared",
      ).toBe(siblings / 2);

      return counters.similarityCalls;
    }

    const smallSiblings = 24;
    const largeSiblings = 96;
    const sizeRatio = largeSiblings / smallSiblings;

    const smallCount = countComparisons(smallSiblings);
    const largeCount = countComparisons(largeSiblings);

    // Exact, not bounded: one comparison per pair is what linear MEANS here, and
    // pinning it catches a detector that starts comparing more than it needs
    // without yet being quadratic.
    expect(smallCount).toBe(smallSiblings / 2);
    expect(largeCount).toBe(largeSiblings / 2);

    // The complexity claim stated as growth. Linear is sizeRatio (4x); comparing
    // every sibling against every other would be sizeRatio² (16x).
    //
    // VERIFIED IN THE FAILING DIRECTION, as TESTING.md "Flake Resistance"
    // requires. Adding a nested pairwise scan over the cohort to
    // detectNonDuplicateTitleCollisions took the 24-sibling count from 12 to 288
    // (276 pairs + the 12 the grouping path still did) and the growth to 16x.
    // The exact-count assertions above fire first and name the number, which is
    // why they are pinned rather than bounded.
    const growth = largeCount / smallCount;
    expect(
      growth,
      `pairwise comparisons grew ${growth}x for a ${sizeRatio}x sibling increase ` +
      `(${smallSiblings}: ${smallCount}, ${largeSiblings}: ${largeCount}). ` +
      `Linear is ${sizeRatio}x; a quadratic regression would be ${sizeRatio ** 2}x.`,
    ).toBeLessThanOrEqual(sizeRatio);
  });
});
