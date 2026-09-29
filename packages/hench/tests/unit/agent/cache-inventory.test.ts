/**
 * Tests for listing, clearing and evicting session-cache entries.
 *
 * Three properties are load-bearing here, and each is a different kind of
 * mistake if it slips.
 *
 * **Scopes are independent.** The orientation parent and the batch chain share
 * one file and nothing else. Clearing either must leave the other intact, or
 * an operator dropping a suspect chain silently pays for a fresh orientation
 * too — the exact cost the cache exists to avoid.
 *
 * **Only dead entries are evicted.** A defect (too old, idle, unreadable,
 * foreign version) is true of an entry however it is read. An identity
 * mismatch is not: that entry is the right one for the run that wrote it, and
 * deleting it because *this* caller cannot use it would make two worktrees
 * destroy each other's caches.
 *
 * **Nothing about a prompt is written down.** The file is inspected by hand and
 * lives in a repo; it holds ids, hashes, counters and timestamps. The key
 * allowlist below is what makes a future field carrying transcript content
 * fail a test rather than ship.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  advanceBatchChain,
  clearCacheScopes,
  evictDeadCacheEntries,
  listCacheEntries,
  readBatchChain,
  readSessionCache,
  settleBatchChain,
  unusedCacheScopes,
  writeSessionCache,
  BATCH_CHAIN_VERSION,
  CACHE_SCOPES,
  DEFAULT_BATCH_MAX_AGE_HOURS,
  DEFAULT_BATCH_MAX_IDLE_HOURS,
  DEFAULT_PARENT_MAX_AGE_HOURS,
  type BatchChainIdentity,
} from "../../../src/agent/lifecycle/session-cache.js";

const IDENTITY: BatchChainIdentity = {
  worktreeRoot: "/repo/main",
  ref: "feat/thing",
  svFingerprint: "fp-1",
  policyHash: "ph-1",
  vendor: "codex",
  model: "gpt-5-codex",
};

const PARENT = {
  parentId: "parent-1",
  svFingerprint: "fp-1",
  vendor: "claude",
  model: "claude-sonnet-5",
};

function hoursAgo(h: number): number {
  return Date.now() - h * 3_600_000;
}

let henchDir: string;

beforeEach(async () => {
  henchDir = await mkdtemp(join(tmpdir(), "hench-cache-inv-"));
});

afterEach(async () => {
  await rm(henchDir, { recursive: true, force: true });
});

/** The cache file as JSON, for the tests that inspect it directly. */
async function readRaw(): Promise<Record<string, unknown>> {
  return JSON.parse(await readFile(join(henchDir, "session-cache.json"), "utf-8")) as Record<
    string,
    unknown
  >;
}

describe("listCacheEntries", () => {
  it("reports nothing when the cache is empty", async () => {
    expect(await listCacheEntries(henchDir)).toEqual({});
  });

  it("reports each scope that holds something", async () => {
    await writeSessionCache(henchDir, PARENT);
    await advanceBatchChain(henchDir, { sessionId: "sess-1", identity: IDENTITY });

    const inventory = await listCacheEntries(henchDir);
    expect(inventory.parent?.parentId).toBe("parent-1");
    expect(inventory.batch?.sessionId).toBe("sess-1");
  });

  it("leaves a live entry undefected", async () => {
    await writeSessionCache(henchDir, PARENT);
    await advanceBatchChain(henchDir, { sessionId: "sess-1", identity: IDENTITY });

    const inventory = await listCacheEntries(henchDir);
    expect(inventory.parent?.defect).toBeUndefined();
    expect(inventory.batch?.defect).toBeUndefined();
  });

  it("names the defect on an entry that is past a bound", async () => {
    await writeSessionCache(henchDir, {
      ...PARENT,
      createdAt: new Date(hoursAgo(DEFAULT_PARENT_MAX_AGE_HOURS + 1)).toISOString(),
    });
    await advanceBatchChain(henchDir, {
      sessionId: "sess-1",
      identity: IDENTITY,
      now: hoursAgo(DEFAULT_BATCH_MAX_AGE_HOURS + 1),
    });

    const inventory = await listCacheEntries(henchDir);
    expect(inventory.parent?.defect).toBe("expired");
    expect(inventory.batch?.defect).toBe("expired");
  });

  it("distinguishes an idle chain from an expired one", async () => {
    await advanceBatchChain(henchDir, {
      sessionId: "sess-1",
      identity: IDENTITY,
      now: hoursAgo(DEFAULT_BATCH_MAX_IDLE_HOURS + 0.5),
    });

    // Well inside its total age — only the idle bound has been crossed.
    expect((await listCacheEntries(henchDir)).batch?.defect).toBe("idle");
  });

  it("honors configured bounds rather than only the defaults", async () => {
    await advanceBatchChain(henchDir, {
      sessionId: "sess-1",
      identity: IDENTITY,
      now: hoursAgo(3),
    });

    expect((await listCacheEntries(henchDir, { batchMaxAgeHours: 2 })).batch?.defect).toBe("expired");
    expect(
      (await listCacheEntries(henchDir, { batchMaxAgeHours: 24, batchMaxIdleHours: 24 })).batch
        ?.defect,
    ).toBeUndefined();
  });

  it("does not delete what it reports", async () => {
    // Listing is a question, not an action. An operator who lists before
    // deciding must still have something to decide about.
    await advanceBatchChain(henchDir, {
      sessionId: "sess-1",
      identity: IDENTITY,
      now: hoursAgo(DEFAULT_BATCH_MAX_AGE_HOURS + 1),
    });

    expect((await listCacheEntries(henchDir)).batch?.defect).toBe("expired");
    expect(await readBatchChain(henchDir)).toBeDefined();
  });

  it("marks a pre-0.8.0 chain as unversioned rather than hiding it", async () => {
    await writeFile(
      join(henchDir, "session-cache.json"),
      JSON.stringify({ batch: { sessionId: "legacy", tasksUsed: 2 } }),
      "utf-8",
    );

    expect((await listCacheEntries(henchDir)).batch?.defect).toBe("unversioned");
  });
});

describe("evictDeadCacheEntries", () => {
  it("removes an expired parent and names why", async () => {
    await writeSessionCache(henchDir, {
      ...PARENT,
      createdAt: new Date(hoursAgo(DEFAULT_PARENT_MAX_AGE_HOURS + 1)).toISOString(),
    });

    expect(await evictDeadCacheEntries(henchDir)).toEqual([{ scope: "parent", defect: "expired" }]);
    expect(await readSessionCache(henchDir)).toBeUndefined();
  });

  it("removes an expired, idle, malformed or unversioned chain", async () => {
    const cases: Array<[string, () => Promise<void>, string]> = [
      [
        "expired",
        () =>
          advanceBatchChain(henchDir, {
            sessionId: "s",
            identity: IDENTITY,
            now: hoursAgo(DEFAULT_BATCH_MAX_AGE_HOURS + 1),
          }),
        "expired",
      ],
      [
        "idle",
        () =>
          advanceBatchChain(henchDir, {
            sessionId: "s",
            identity: IDENTITY,
            now: hoursAgo(DEFAULT_BATCH_MAX_IDLE_HOURS + 0.5),
          }),
        "idle",
      ],
      [
        "malformed",
        async () => {
          await writeFile(
            join(henchDir, "session-cache.json"),
            JSON.stringify({
              batch: { ...IDENTITY, version: BATCH_CHAIN_VERSION, sessionId: "s", tasksUsed: 1, createdAt: "nope", lastUsedAt: "nope" },
            }),
            "utf-8",
          );
        },
        "malformed",
      ],
      [
        "unversioned",
        async () => {
          await writeFile(
            join(henchDir, "session-cache.json"),
            JSON.stringify({ batch: { sessionId: "s", tasksUsed: 1 } }),
            "utf-8",
          );
        },
        "unversioned",
      ],
    ];

    for (const [label, seed, defect] of cases) {
      await rm(join(henchDir, "session-cache.json"), { force: true });
      await seed();
      expect(await evictDeadCacheEntries(henchDir), label).toEqual([{ scope: "batch", defect }]);
      expect(await readBatchChain(henchDir), label).toBeUndefined();
    }
  });

  it("leaves a live entry alone", async () => {
    await writeSessionCache(henchDir, PARENT);
    await advanceBatchChain(henchDir, { sessionId: "sess-1", identity: IDENTITY });

    expect(await evictDeadCacheEntries(henchDir)).toEqual([]);
    expect(await readSessionCache(henchDir)).toBeDefined();
    expect(await readBatchChain(henchDir)).toBeDefined();
  });

  it("keeps an entry that is merely another caller's", async () => {
    // The distinction the whole eviction rule turns on. This chain belongs to
    // a different worktree and policy, so no run here can use it — but it is
    // exactly the entry that worktree's next task needs. Evicting on identity
    // would make two parallel loops delete each other's caches every run.
    await advanceBatchChain(henchDir, {
      sessionId: "sess-1",
      identity: { ...IDENTITY, worktreeRoot: "/repo/worktrees/other", policyHash: "ph-9" },
    });

    expect(await evictDeadCacheEntries(henchDir)).toEqual([]);
    expect(await readBatchChain(henchDir)).toBeDefined();
  });

  it("sweeps only the scopes it was given", async () => {
    await writeSessionCache(henchDir, {
      ...PARENT,
      createdAt: new Date(hoursAgo(DEFAULT_PARENT_MAX_AGE_HOURS + 1)).toISOString(),
    });
    await advanceBatchChain(henchDir, {
      sessionId: "sess-1",
      identity: IDENTITY,
      now: hoursAgo(DEFAULT_BATCH_MAX_AGE_HOURS + 1),
    });

    const evicted = await evictDeadCacheEntries(henchDir, { scopes: ["batch"] });

    expect(evicted).toEqual([{ scope: "batch", defect: "expired" }]);
    expect(await readBatchChain(henchDir)).toBeUndefined();
    // The dead parent survives because nobody asked about it — that is what
    // lets a run sweep the scope its strategy ignores without pre-empting the
    // named rejection the active strategy is about to print.
    expect(await readSessionCache(henchDir)).toBeDefined();
  });

  it("does not disturb the surviving scope's entry", async () => {
    await writeSessionCache(henchDir, PARENT);
    await advanceBatchChain(henchDir, {
      sessionId: "sess-1",
      identity: IDENTITY,
      now: hoursAgo(DEFAULT_BATCH_MAX_AGE_HOURS + 1),
    });

    await evictDeadCacheEntries(henchDir);

    expect(await readBatchChain(henchDir)).toBeUndefined();
    expect((await readSessionCache(henchDir))?.parentId).toBe("parent-1");
  });

  it("is a no-op on an empty cache", async () => {
    expect(await evictDeadCacheEntries(henchDir)).toEqual([]);
  });
});

describe("clearCacheScopes", () => {
  it("clears one scope and keeps the other", async () => {
    await writeSessionCache(henchDir, PARENT);
    await advanceBatchChain(henchDir, { sessionId: "sess-1", identity: IDENTITY });

    expect(await clearCacheScopes(henchDir, ["batch"])).toEqual(["batch"]);
    expect(await readBatchChain(henchDir)).toBeUndefined();
    expect((await readSessionCache(henchDir))?.parentId).toBe("parent-1");
  });

  it("clears the parent and keeps the chain", async () => {
    await writeSessionCache(henchDir, PARENT);
    await advanceBatchChain(henchDir, { sessionId: "sess-1", identity: IDENTITY });

    expect(await clearCacheScopes(henchDir, ["parent"])).toEqual(["parent"]);
    expect(await readSessionCache(henchDir)).toBeUndefined();
    expect((await readBatchChain(henchDir))?.sessionId).toBe("sess-1");
  });

  it("clears both when asked for both", async () => {
    await writeSessionCache(henchDir, PARENT);
    await advanceBatchChain(henchDir, { sessionId: "sess-1", identity: IDENTITY });

    expect(await clearCacheScopes(henchDir, CACHE_SCOPES)).toEqual(["parent", "batch"]);
    expect(await listCacheEntries(henchDir)).toEqual({});
  });

  it("reports only the scopes that held something", async () => {
    await advanceBatchChain(henchDir, { sessionId: "sess-1", identity: IDENTITY });

    expect(await clearCacheScopes(henchDir, CACHE_SCOPES)).toEqual(["batch"]);
  });

  it("clears a dead entry too — a scoped clear is unconditional", async () => {
    await advanceBatchChain(henchDir, {
      sessionId: "sess-1",
      identity: IDENTITY,
      now: hoursAgo(DEFAULT_BATCH_MAX_AGE_HOURS + 1),
    });

    expect(await clearCacheScopes(henchDir, ["batch"])).toEqual(["batch"]);
  });

  it("is a no-op on an empty cache", async () => {
    expect(await clearCacheScopes(henchDir, CACHE_SCOPES)).toEqual([]);
  });
});

describe("settleBatchChain", () => {
  it("hands the session on when the task completed", async () => {
    const outcome = await settleBatchChain(henchDir, {
      completed: true,
      sessionId: "sess-1",
      identity: IDENTITY,
      lastTaskTitle: "Fix the parser",
    });

    expect(outcome).toBe("advanced");
    expect((await readBatchChain(henchDir))?.sessionId).toBe("sess-1");
  });

  it("evicts the chain when the task failed", async () => {
    // The failure is in that transcript now. Resuming it would start the next
    // task inside the failure, with no signal that it had.
    await advanceBatchChain(henchDir, { sessionId: "sess-1", identity: IDENTITY });

    const outcome = await settleBatchChain(henchDir, {
      completed: false,
      sessionId: "sess-1",
      identity: IDENTITY,
    });

    expect(outcome).toBe("cleared");
    expect(await readBatchChain(henchDir)).toBeUndefined();
  });

  it("evicts the chain when the vendor reported no session", async () => {
    await advanceBatchChain(henchDir, { sessionId: "sess-1", identity: IDENTITY });

    expect(await settleBatchChain(henchDir, { completed: true, identity: IDENTITY })).toBe("cleared");
    expect(await readBatchChain(henchDir)).toBeUndefined();
  });

  it("evicts the chain when the run carried no batch identity", async () => {
    // Without an identity there is nothing to stamp, and an unstamped chain is
    // precisely the wrong-hit risk the identity key exists to close.
    await advanceBatchChain(henchDir, { sessionId: "sess-1", identity: IDENTITY });

    expect(await settleBatchChain(henchDir, { completed: true, sessionId: "sess-2" })).toBe("cleared");
    expect(await readBatchChain(henchDir)).toBeUndefined();
  });

  it("leaves the orientation parent alone either way", async () => {
    await writeSessionCache(henchDir, PARENT);

    await settleBatchChain(henchDir, { completed: false });

    expect((await readSessionCache(henchDir))?.parentId).toBe("parent-1");
  });
});

describe("unusedCacheScopes", () => {
  it("leaves the scope the active strategy reads", async () => {
    // The strategy's own admission check evicts that scope with a named
    // reason; sweeping it first would replace "expired" with "no chain".
    expect(unusedCacheScopes("fork")).toEqual(["batch"]);
    expect(unusedCacheScopes("batch")).toEqual(["parent"]);
  });

  it("sweeps everything under a strategy that caches nothing", () => {
    expect(unusedCacheScopes("cold")).toEqual([...CACHE_SCOPES]);
  });
});

describe("cache file contents", () => {
  /**
   * Every key the cache file is permitted to hold.
   *
   * The point of writing it down: a field added later that carries a prompt,
   * a brief, a diff or a transcript excerpt fails here. The file is inspected
   * by hand, sits next to a repo, and is read by whoever picks up the run —
   * it holds identity and counters, and nothing a model said.
   */
  const ALLOWED_TOP_LEVEL = ["parentId", "createdAt", "svFingerprint", "vendor", "model", "batch"];
  const ALLOWED_BATCH = [
    "version",
    "sessionId",
    "tasksUsed",
    "worktreeRoot",
    "ref",
    "svFingerprint",
    "policyHash",
    "vendor",
    "model",
    "createdAt",
    "lastUsedAt",
    "lastTaskTitle",
  ];

  it("holds only identity, counters and timestamps in either scope", async () => {
    await writeSessionCache(henchDir, PARENT);
    await settleBatchChain(henchDir, {
      completed: true,
      sessionId: "sess-1",
      identity: IDENTITY,
      lastTaskTitle: "Fix the parser",
    });

    const file = await readRaw();
    expect(Object.keys(file).sort()).toEqual(ALLOWED_TOP_LEVEL.sort());
    expect(Object.keys(file.batch as object).sort()).toEqual(ALLOWED_BATCH.sort());
  });

  it("carries no free text beyond the task's own title", async () => {
    // The title is the one human-authored string here, and it is the PRD's
    // own — already public in .rex/. Everything else must be an id, a hash, a
    // path, a count or a timestamp, so a value that reads like prose is a
    // leak. Asserted by elimination rather than by scanning for a sentinel:
    // a sentinel only catches the leak you thought to plant.
    await writeSessionCache(henchDir, PARENT);
    await advanceBatchChain(henchDir, {
      sessionId: "sess-1",
      identity: IDENTITY,
      lastTaskTitle: "Fix the parser",
    });

    const file = await readRaw();
    const batch = file.batch as Record<string, unknown>;
    const freeText = Object.entries(batch)
      .filter(([, v]) => typeof v === "string" && /\s/.test(v))
      .map(([k]) => k);

    expect(freeText).toEqual(["lastTaskTitle"]);
  });
});
