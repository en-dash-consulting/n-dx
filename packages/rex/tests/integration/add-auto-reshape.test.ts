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

  beforeEach(async () => {
    const setup = await setupDir();
    tmpDir = setup.tmpDir;
    rexDir = setup.rexDir;
  });

  afterEach(async () => { await cleanup(tmpDir); });

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
  // 60s, not the 30s default: comparing two sizes means building 125 items via
  // addItem, and each add re-serializes the tree, so SETUP dominates — measured
  // ~14s locally while the two timed passes together are ~190ms of it. The old
  // single-size version fit in 30s, so raising this is a direct cost of the
  // two-point measurement. Note this is a timeout, not the assertion: it guards
  // against a hang, and the pass/fail decision is the ratio below.
  it("scoped pass cost grows sub-quadratically with sibling count", { timeout: 60_000 }, async () => {
    const store = await resolveStore(rexDir);

    /**
     * Build an epic with `siblings` features, then time the consolidation pass
     * triggered by one more. Returns the pass duration in ms.
     */
    async function timeScopedPass(epicTitle: string, siblings: number): Promise<number> {
      const epicId = randomUUID();
      await store.addItem({ id: epicId, title: epicTitle, level: "epic", status: "pending" });
      for (let i = 0; i < siblings; i++) {
        await store.addItem(
          { id: randomUUID(), title: `${epicTitle} Feature ${i}`, level: "feature", status: "pending" },
          epicId,
        );
      }

      // Added directly, bypassing cmdAdd overhead, so only the pass is timed.
      const newId = randomUUID();
      await store.addItem(
        { id: newId, title: `${epicTitle} Feature unique`, level: "feature", status: "pending" },
        epicId,
      );

      const start = performance.now();
      await runScopedConsolidationPass(rexDir, store, newId, {});
      return performance.now() - start;
    }

    const smallSiblings = 25;
    const largeSiblings = 100;
    const sizeRatio = largeSiblings / smallSiblings;

    const smallMs = await timeScopedPass("Small Epic", smallSiblings);
    const largeMs = await timeScopedPass("Big Epic", largeSiblings);

    // MEASURED when written: 4.3x for a 4x increase (25 siblings 35.6ms,
    // 100 siblings 151.9ms) — the pass is linear in sibling count today. The
    // bound sits at 3x the size ratio, leaving ~2.8x headroom over that
    // observation while still tripping on a quadratic regression (~16x).
    const timeRatio = largeMs / Math.max(smallMs, 0.1);
    expect(
      timeRatio,
      `scoped pass scaled ${timeRatio.toFixed(1)}x for a ${sizeRatio}x sibling increase ` +
      `(${smallSiblings}: ${smallMs.toFixed(1)}ms, ${largeSiblings}: ${largeMs.toFixed(1)}ms). ` +
      `It was linear (~${sizeRatio}x) when this test was written; a quadratic ` +
      `regression would show ~${(sizeRatio * sizeRatio).toFixed(0)}x.`,
    ).toBeLessThan(sizeRatio * 3);
  });
});
