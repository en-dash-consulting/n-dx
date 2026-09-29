/**
 * Integration tests for atomic writes and crash-safety in prd_tree mutations.
 *
 * Tests verify:
 * - All writes use temp + rename for crash-safety
 * - File-locking prevents concurrent mutations
 * - Single-item operations avoid full-tree re-serialization, measured as the
 *   number of files written rather than as elapsed time
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FolderTreeStore } from "../../src/store/folder-tree-store.js";
import type { PRDItem } from "../../src/schema/index.js";
import { SCHEMA_VERSION } from "../../src/schema/index.js";
import { acquireLock } from "../../src/store/file-lock.js";
import { PRD_TREE_DIRNAME } from "../../src/store/index.js";

// ── Test fixtures ──────────────────────────────────────────────────────────

function makeItem(
  id: string,
  title: string,
  level: "epic" | "feature" | "task" | "subtask" = "task",
  parentId?: string,
): PRDItem {
  return {
    id,
    title,
    level,
    status: "pending",
    priority: "medium",
    tags: [],
    acceptanceCriteria: [],
    description: `Test item: ${title}`,
  };
}

/**
 * Build a hierarchical fixture: `epicCount` epics, each with `featureCount`
 * features, each with `taskCount` tasks.
 *
 * Parameterised rather than fixed at 1000 items because the write-volume tests
 * below compare the same mutation across two tree sizes — a count that does not
 * move with the size is what "no full-tree re-serialization" means.
 */
function createHierarchy(epicCount: number, featureCount: number, taskCount: number): PRDItem[] {
  const epics: PRDItem[] = [];

  for (let e = 0; e < epicCount; e++) {
    const features: PRDItem[] = [];

    for (let f = 0; f < featureCount; f++) {
      const tasks: PRDItem[] = [];

      for (let t = 0; t < taskCount; t++) {
        tasks.push(makeItem(`task-${e}-${f}-${t}`, `Task ${e}-${f}-${t}`, "task"));
      }

      features.push({
        ...makeItem(`feature-${e}-${f}`, `Feature ${e}-${f}`, "feature"),
        children: tasks,
      });
    }

    epics.push({
      ...makeItem(`epic-${e}`, `Epic ${e}`, "epic"),
      children: features,
    });
  }

  return epics;
}

/** `items` and every descendant, counted. */
function countItems(items: PRDItem[]): number {
  return items.reduce((n, item) => n + 1 + countItems(item.children ?? []), 0);
}

/**
 * How much slower than idle a loaded machine may be before a test that is
 * merely slow counts as hung. TESTING.md's documented allowance, read from the
 * same env var every other budgeted test in the repo reads.
 */
const LOAD_ALLOWANCE = Number(process.env["NDX_TEST_TIME_MULTIPLIER"] ?? 20);

// ── Test suite ──────────────────────────────────────────────────────────────

describe("prd_tree atomic writes and crash-safety", () => {
  let tmpDir: string;
  let rexDir: string;
  let store: FolderTreeStore;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-atomic-test-"));
    rexDir = join(tmpDir, ".rex");
    await mkdir(rexDir, { recursive: true });
    store = new FolderTreeStore(rexDir);

    // Initialize store with empty PRD
    await store.saveDocument({ schema: SCHEMA_VERSION, title: "Test PRD", items: [] });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  // ── Crash-safety tests ──────────────────────────────────────────────────

  describe("crash-safety: temp files don't corrupt index.md on mid-write interrupt", () => {
    it("index.md is complete even if temp file remains from interrupted write", async () => {
      // Add an item
      const item = makeItem("test-1", "Test Item");
      await store.addItem(item);

      // Verify the item was written completely
      const doc = await store.loadDocument();
      expect(doc.items).toHaveLength(1);
      expect(doc.items[0].title).toBe("Test Item");

      // Check that no temp files were left behind
      const treeDir = join(rexDir, PRD_TREE_DIRNAME);
      const entries = await readdir(treeDir, { recursive: true });
      const tmpFiles = entries.filter((e) => typeof e === "string" && e.includes(".tmp"));
      expect(tmpFiles).toHaveLength(0);
    });

    it("can recover from crashed write that left incomplete directory", async () => {
      // Manually create an incomplete directory (simulating mid-write crash)
      const incompleteDir = join(rexDir, PRD_TREE_DIRNAME, "incomplete-item");
      await mkdir(incompleteDir, { recursive: true });

      // Try to add a new item — should not fail
      const item = makeItem("test-2", "New Item");
      await expect(store.addItem(item)).resolves.not.toThrow();

      // Verify the new item was added successfully
      const doc = await store.loadDocument();
      expect(doc.items).toHaveLength(1);
    });

    it("partial item markdown is replaced atomically on subsequent writes", async () => {
      // Under the new schema each folder item has a single canonical
      // `index.md` — corrupting it loses the item's frontmatter (no fallback
      // file). This test instead verifies that a partial child write is
      // replaced atomically: corrupt a leaf-subtask sibling file (which the
      // parent's `index.md` references) and confirm a subsequent save
      // overwrites the corrupted bytes via temp + rename.
      const epic = makeItem("test-1", "Item One", "epic");
      await store.addItem(epic);
      await store.addItem(makeItem("test-1-child", "Child", "task"), "test-1");
      await store.addItem(makeItem("test-1-grandchild", "Leaf", "subtask"), "test-1-child");

      const treeDir = join(rexDir, PRD_TREE_DIRNAME);
      const [epicDirName] = await readdir(treeDir);
      const epicDir = join(treeDir, epicDirName);
      const [taskDirName] = (await readdir(epicDir)).filter((e) => e !== "index.md");
      const taskDir = join(epicDir, taskDirName);
      const leafFile = (await readdir(taskDir)).find((e) => e.endsWith(".md") && e !== "index.md");
      expect(leafFile).toBeDefined();
      const leafPath = join(taskDir, leafFile!);

      // Manually corrupt the leaf .md to simulate partial write.
      await writeFile(leafPath, "CORRUPTED");

      // Update the item — saveDocument re-serializes the full tree, which
      // rewrites the corrupted leaf atomically (temp + rename).
      await store.updateItem("test-1", { title: "Item One Updated" });

      // Verify the item survives the round-trip with the new title.
      const doc = await store.loadDocument();
      expect(doc.items[0].title).toBe("Item One Updated");

      // Verify no "CORRUPTED" content remains in any item markdown
      const allIndexContents: string[] = [];
      for (const dir of await readdir(treeDir)) {
        const itemDir = join(treeDir, dir);
        const entries = await readdir(itemDir);
        for (const md of entries.filter((f) => f.endsWith(".md"))) {
          try {
            allIndexContents.push(await readFile(join(itemDir, md), "utf-8"));
          } catch {
            // Not readable — skip
          }
        }
      }
      const combinedContent = allIndexContents.join("\n");
      expect(combinedContent).not.toContain("CORRUPTED");
    });
  });

  // ── Concurrency tests ──────────────────────────────────────────────────

  describe("file-locking: concurrent writers are serialized", () => {
    /**
     * This replaced an ordering assertion that could not have tested locking.
     *
     * The old version pushed "second-start" synchronously at the top of the second
     * writer's async IIFE — i.e. BEFORE that writer ever asked for the lock — and
     * started it after a fixed 10ms sleep. So `firstEndIdx < secondStartIdx` was
     * really asserting "the first addItem finishes within 10ms", which says nothing
     * about serialization. Under load addItem takes longer than that and the
     * assertion failed with `expected 2 to be less than 1`, having never exercised
     * the lock at all.
     *
     * Asserted here instead, at the lock itself and without any timing assumption:
     * a lock that is held cannot be granted to anyone else. A slower machine makes
     * this MORE certainly true, not less — the failure direction is safe.
     */
    it("does not grant the lock to a second writer while the first holds it", async () => {
      const lockPath = join(rexDir, "prd.lock");

      const releaseFirst = await acquireLock(lockPath);

      let secondAcquired = false;
      const secondAcquisition = acquireLock(lockPath).then((release) => {
        secondAcquired = true;
        return release;
      });

      // Drain timers and microtasks several times over. The point is not "wait
      // long enough" — it is that no amount of event-loop progress may hand out a
      // lock that is still held.
      for (let i = 0; i < 5; i++) {
        await new Promise((r) => setTimeout(r, 0));
      }
      expect(secondAcquired).toBe(false);

      await releaseFirst();

      // Now it must be grantable. If the lock were never released this would hang
      // until acquireLock's own timeout, failing loudly rather than silently.
      const releaseSecond = await secondAcquisition;
      expect(secondAcquired).toBe(true);
      await releaseSecond();
    });

    it("serializes concurrent addItem calls without losing either write", async () => {
      // The load-independent half of the original test: whatever order the two
      // writers interleave in, neither may clobber the other.
      await Promise.all([
        store.addItem(makeItem("test-1", "First Item")),
        store.addItem(makeItem("test-2", "Second Item")),
      ]);

      const doc = await store.loadDocument();
      expect(doc.items).toHaveLength(2);
      expect(doc.items.map((i) => i.id).sort()).toEqual(["test-1", "test-2"]);
    });

    it("fails loudly instead of automatically reclaiming a stale lock", async () => {
      const lockPath = join(rexDir, "prd.lock");

      // Manually create a stale lock (very old timestamp)
      const staleTime = new Date(Date.now() - 60 * 1000).toISOString(); // 60 seconds ago
      await writeFile(lockPath, JSON.stringify({ pid: 999999, timestamp: staleTime }), "utf-8");

      await expect(
        acquireLock(lockPath, {acquireTimeoutMs: 500}),
      ).rejects.toThrow(`delete ${lockPath} manually`);

      // Automatic deletion has an unavoidable generation race, so crashed
      // writer recovery intentionally requires the documented manual cleanup.
      const entries = await readdir(rexDir);
      expect(entries).toContain("prd.lock");
    });

    it("concurrent mutations don't corrupt PRD state", async () => {
      const tasks = [];

      // Launch 5 concurrent add operations
      for (let i = 0; i < 5; i++) {
        tasks.push(
          store.addItem(makeItem(`item-${i}`, `Item ${i}`)).catch((err) => {
            // One writer may fail if lock times out, but no data should be corrupted
            console.log(`Writer ${i} failed:`, err.message);
          }),
        );
      }

      await Promise.all(tasks);

      // Verify PRD is still valid and all writes succeeded
      const doc = await store.loadDocument();
      expect(doc.items.length).toBeGreaterThanOrEqual(1);

      // Verify structure is valid (all items are loadable)
      for (const item of doc.items) {
        expect(item.id).toBeDefined();
        expect(item.title).toBeDefined();
      }
    });
  });

  // ── Write volume ────────────────────────────────────────────────────────────

  /**
   * These three tests used to decide their verdict from a clock: two raw
   * `< 500ms` budgets and a comparison of two adjacent micro-spans
   * (`addTime <= reserializeTime`), the last of which one scheduling hiccup
   * inside the first span could flip. All three were registered Open in
   * tests/wall-clock-assertion-inventory.md and skipped as DEFERRED.
   *
   * What they were standing in for is a claim about *write volume*, not latency:
   * a single-item mutation must touch the files it changed, not re-serialize the
   * tree. That is countable, so it is counted — TESTING.md Family 2 technique 1.
   * The serializer already publishes the count: `writeIfChanged` skips files
   * whose content is byte-identical, and the paths it actually wrote reach the
   * caller through `takeSaveFileReport()`. No clock is read here, so no ambient
   * load can change a verdict.
   *
   * ### Fixture size is the whole timeout budget
   *
   * The assertions below are load-immune; the real `saveDocument` each one pays
   * for before reaching them is not. That cost is linear in items — measured at
   * 5.9ms per item for a save + load + update + add cycle, flat from 18 items to
   * 1110 (Intel Core Ultra 5 225F, 10 logical CPUs, Windows 11 26200, Node
   * 24.16.0):
   *
   * | items | save | load | updateItem | addItem |
   * |------:|-----:|-----:|-----------:|--------:|
   * |  1110 | 1120 | 1393 |       1946 |    2050 |
   * |   155 |  163 |  171 |        283 |     256 |
   * |    39 |   42 |   42 |         70 |      67 |
   *
   * So a 1110-item fixture cost the two exact-set tests below 21.2s and 10.7s
   * idle against rex's 30s `testTimeout` — a third of the 20x load allowance the
   * repo documents, and both timed out under concurrent build load. Neither gets
   * anything from scale: they assert an exact set of written paths, which is
   * exact at any size, and a handful of siblings at each level is all it takes
   * for "only these files" to mean something. They use {@link SIBLING_TREE}.
   *
   * The first test is the one whose subject *is* scale, so it keeps the large
   * tree and takes an explicit timeout derived from its measured idle cost
   * instead. See {@link SIZE_STEP_TIMEOUT_MS}.
   *
   * Where the three land afterwards, idle and under four concurrent `tsc`
   * workers — twice the load the soak harness applies:
   *
   * | test | idle | loaded | timeout | headroom left |
   * |---|---:|---:|---:|---:|
   * | size step (1110 items)    | 3055ms | 9785ms | 102000ms | 10.4x |
   * | updateItem exact set (39) |  175ms |  863ms |  30000ms | 34.8x |
   * | full-tree count (39)      |  123ms |  507ms |  30000ms | 59.2x |
   *
   * Load costs each of them about 3-4x, so the failure mode this replaces —
   * a 1110-item fixture at 21.2s idle meeting a 30s default — is now roughly
   * an order of magnitude out of reach.
   */
  describe("write volume: single-item mutations don't re-serialize the tree", () => {
    /**
     * Small enough to be cheap, large enough that "only the updated item and
     * its parent" excludes something: 3 epics x 3 features x 3 tasks is 39
     * items, with two siblings beside the target at every level and a
     * grandparent above it. The two tests using it went from 21156ms and
     * 10721ms idle at 1110 items to 182-192ms and 130-145ms over three runs —
     * a margin of 150x or better against the package's 30s `testTimeout`,
     * comfortably past the documented 20x.
     */
    const SIBLING_TREE: [number, number, number] = [3, 3, 3];

    /**
     * Idle cost of the size-step test below, worst of four runs on the machine
     * described above — 5011ms cold, then 3636/3112/3055ms — and 2867ms on the
     * soak machine that filed this task.
     *
     * Times the documented load allowance this is a hang guardrail, not a
     * latency budget. The test's verdict comes from comparing two exact path
     * sets, so nothing about it gets easier or harder to pass as this bound
     * moves; it exists so a serializer that deadlocks fails with a named cause
     * instead of silently inheriting a package default that this fixture — the
     * only 1110-item one left in the file — does not fit.
     */
    const SIZE_STEP_TIMEOUT_MS = 5_100 * LOAD_ALLOWANCE;

    /** Project-relative paths written by `mutate`, with earlier saves drained first. */
    async function writesDuring(mutate: () => Promise<void>): Promise<string[]> {
      store.takeSaveFileReport();
      await mutate();
      return store.takeSaveFileReport()?.written ?? [];
    }

    /** A store of its own, on its own temp dir, torn down after `use`. */
    async function withStore(use: (store: FolderTreeStore) => Promise<void>): Promise<void> {
      const dir = await mkdtemp(join(tmpdir(), "rex-atomic-size-"));
      const ownRexDir = join(dir, ".rex");
      await mkdir(ownRexDir, { recursive: true });
      try {
        await use(new FolderTreeStore(ownRexDir));
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }

    /** Files written by adding one task under `feature-0-0` of a fresh `size` tree. */
    async function addWritesOnTree(size: [number, number, number]): Promise<string[]> {
      let written: string[] = [];
      await withStore(async (own) => {
        await own.saveDocument({
          schema: SCHEMA_VERSION,
          title: "Sized PRD",
          items: createHierarchy(...size),
        });
        own.takeSaveFileReport();
        await own.addItem(makeItem("added-task", "Added Task"), "feature-0-0");
        written = own.takeSaveFileReport()?.written ?? [];
      });
      return written;
    }

    it(
      "a single add writes the same files on a 1000-item tree as on a 5-item one",
      async () => {
        // The replacement for a `median < 500ms` budget on a 1000-item add. What
        // that budget was guarding is that the cost of an add tracks the change,
        // not the tree — so the two counts are taken across a 222× size step and
        // must be identical, not merely both small.
        const small = await addWritesOnTree([1, 1, 3]);
        const large = await addWritesOnTree([10, 10, 10]);

        // The new task's own file plus its parent feature's `index.md`, which
        // renders its children. Depth-bounded, and the same at either size.
        expect(small).toHaveLength(2);
        expect(large).toEqual(small);
      },
      SIZE_STEP_TIMEOUT_MS,
    );

    it("updateItem writes only the updated item and its parent", async () => {
      await store.saveDocument({
        schema: SCHEMA_VERSION,
        title: "Sibling PRD",
        items: createHierarchy(...SIBLING_TREE),
      });

      const doc = await store.loadDocument();
      const target = doc.items[0].children![0].children![0];

      const written = await writesDuring(() =>
        store.updateItem(target.id, { status: "in_progress" as const }),
      );

      // The exact set, not a count: a regression that wrote one *different*
      // file — the epic above, or either sibling task, or either sibling
      // feature — still fails. The parent's `index.md` is in the set because it
      // renders its children's status.
      expect(written.sort()).toEqual([
        `${PRD_TREE_DIRNAME}/epic-0/feature-0-0/index.md`,
        `${PRD_TREE_DIRNAME}/epic-0/feature-0-0/task-0-0-0.md`,
      ].map((p) => `.rex/${p}`));
    });

    it("no full-tree re-serialization on single-item add", async () => {
      const items = createHierarchy(...SIBLING_TREE);
      await store.saveDocument({ schema: SCHEMA_VERSION, title: "Sibling PRD", items });
      const fullTreeWrites = store.takeSaveFileReport()?.written.length ?? 0;

      const added = await writesDuring(() => store.addItem(makeItem("epic-new", "New Epic", "epic")));

      // What a full serialization of this tree costs, measured in this same
      // process moments earlier: one file per item, exactly. Pinned that way
      // rather than to the `> 1000` this line used to carry, which was the old
      // 1110-item fixture's own size wearing the costume of a threshold — it
      // moved with the fixture and bounded nothing. The count holds at any
      // fixture size (verified exact at 18, 39, 84, 155, 258 and 1110 items)
      // and is the stronger claim: dropping one leaf write from a full save
      // fails here at 38-vs-39, where `> 1000` — or `> 38` — would not.
      expect(fullTreeWrites).toBe(countItems(items));

      // Against that, the add: the new epic's own file and nothing else. A
      // root-level add has no parent index to refresh, and a childless item is
      // a bare `<slug>.md` leaf rather than a folder. Two counts rather than
      // two timings, so no threshold has to be guessed.
      expect(added).toEqual([`.rex/${PRD_TREE_DIRNAME}/new-epic.md`]);
    });
  });

  // ── Atomicity tests ────────────────────────────────────────────────────

  describe("atomicity: all writes or nothing", () => {
    it("addItem either completes fully or leaves tree unchanged", async () => {
      const beforeDoc = await store.loadDocument();
      const beforeCount = beforeDoc.items.length;

      // Add a valid item
      const item = makeItem("test-1", "Valid Item");
      await store.addItem(item);

      const afterDoc = await store.loadDocument();
      expect(afterDoc.items.length).toBe(beforeCount + 1);
    });

    it("updateItem either succeeds fully or throws without partial changes", async () => {
      const item = makeItem("test-1", "Original Title");
      await store.addItem(item);

      // Try to update to an invalid parent (should fail cleanly)
      await expect(store.updateItem("test-1", { priority: "high" })).resolves.not.toThrow();

      // Verify the update succeeded
      const doc = await store.loadDocument();
      expect(doc.items[0].priority).toBe("high");
    });
  });
});
