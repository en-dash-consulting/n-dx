/**
 * Tests for the batch session chain.
 *
 * Batching resumes the *previous task's* session so the transcript
 * accumulates — the right model for a CLI whose resume appends rather than
 * branches. That makes the reset rules the load-bearing part, in two ways.
 *
 * The cap bounds growth: without it the shared transcript grows for the whole
 * loop, which costs more per turn and lets one task's framing bleed into the
 * next.
 *
 * The identity key bounds *whose* transcript it is. `codex exec resume` takes
 * no sandbox or approval flags — the thread keeps the policy that created it —
 * so a chain resumed across a worktree, ref, source-state or policy change
 * would run this task inside another context's assumptions with no signal at
 * all. Every check below therefore has a named code, and the bias throughout is
 * a false miss (one cold start) over a wrong hit.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readBatchChain,
  advanceBatchChain,
  clearBatchChain,
  clearSessionCache,
  isBatchChainUsable,
  chainRefIdentity,
  policyFingerprint,
  BATCH_CHAIN_VERSION,
  DEFAULT_TASKS_PER_SESSION,
  DEFAULT_BATCH_MAX_AGE_HOURS,
  DEFAULT_BATCH_MAX_IDLE_HOURS,
  type BatchChainEntry,
  type BatchChainIdentity,
  type BatchChainRejection,
  type PolicyFingerprintInput,
} from "../../../src/agent/lifecycle/session-cache.js";

const IDENTITY: BatchChainIdentity = {
  worktreeRoot: "/repo/main",
  ref: "feat/thing",
  svFingerprint: "fp-1",
  policyHash: "ph-1",
  vendor: "codex",
  model: "gpt-5-codex",
};

const ADVANCE = { sessionId: "sess-1", identity: IDENTITY };

/** A chain as `readBatchChain` would return it: current, fresh, one task in. */
function chainEntry(overrides: Partial<BatchChainEntry> = {}): BatchChainEntry {
  const now = new Date().toISOString();
  return {
    version: BATCH_CHAIN_VERSION,
    sessionId: "sess-1",
    tasksUsed: 1,
    ...IDENTITY,
    createdAt: now,
    lastUsedAt: now,
    ...overrides,
  };
}

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3_600_000).toISOString();
}

/** The verdict's reason, or undefined when it was usable. */
function reasonFor(
  chain: BatchChainEntry | undefined,
  input: Parameters<typeof isBatchChainUsable>[1],
): BatchChainRejection | undefined {
  const verdict = isBatchChainUsable(chain, input);
  return verdict.usable ? undefined : verdict.reason;
}

describe("batch chain persistence", () => {
  let henchDir: string;

  beforeEach(async () => {
    henchDir = await mkdtemp(join(tmpdir(), "hench-batch-chain-"));
  });

  afterEach(async () => {
    await rm(henchDir, { recursive: true, force: true });
  });

  it("returns undefined when no chain exists", async () => {
    expect(await readBatchChain(henchDir)).toBeUndefined();
  });

  it("records a session and counts the task that used it", async () => {
    await advanceBatchChain(henchDir, ADVANCE);

    const chain = await readBatchChain(henchDir);
    expect(chain?.sessionId).toBe("sess-1");
    expect(chain?.tasksUsed).toBe(1);
  });

  it("stamps the current version and the full identity", async () => {
    await advanceBatchChain(henchDir, ADVANCE);

    const chain = await readBatchChain(henchDir);
    expect(chain?.version).toBe(BATCH_CHAIN_VERSION);
    expect(chain).toMatchObject(IDENTITY);
    expect(Number.isNaN(Date.parse(chain!.createdAt))).toBe(false);
    expect(Number.isNaN(Date.parse(chain!.lastUsedAt))).toBe(false);
  });

  it("increments the count when the same session serves another task", async () => {
    await advanceBatchChain(henchDir, ADVANCE);
    await advanceBatchChain(henchDir, ADVANCE);

    expect((await readBatchChain(henchDir))?.tasksUsed).toBe(2);
  });

  it("keeps createdAt but moves lastUsedAt while a chain continues", async () => {
    // createdAt is what the total-age bound measures. Refreshing it on each
    // task would make that bound unreachable in a busy loop — the one case it
    // exists for.
    const opened = Date.parse("2026-09-01T00:00:00.000Z");
    await advanceBatchChain(henchDir, { ...ADVANCE, now: opened });
    await advanceBatchChain(henchDir, { ...ADVANCE, now: opened + 3_600_000 });

    const chain = await readBatchChain(henchDir);
    expect(chain?.createdAt).toBe(new Date(opened).toISOString());
    expect(chain?.lastUsedAt).toBe(new Date(opened + 3_600_000).toISOString());
  });

  it("restarts the count and the clock when a new session takes over", async () => {
    const opened = Date.parse("2026-09-01T00:00:00.000Z");
    await advanceBatchChain(henchDir, { ...ADVANCE, now: opened });
    await advanceBatchChain(henchDir, { ...ADVANCE, now: opened + 3_600_000 });
    await advanceBatchChain(henchDir, {
      ...ADVANCE,
      sessionId: "sess-2",
      now: opened + 7_200_000,
    });

    const chain = await readBatchChain(henchDir);
    expect(chain?.sessionId).toBe("sess-2");
    expect(chain?.tasksUsed).toBe(1);
    expect(chain?.createdAt).toBe(new Date(opened + 7_200_000).toISOString());
  });

  it("re-stamps identity on every advance", async () => {
    await advanceBatchChain(henchDir, ADVANCE);
    await advanceBatchChain(henchDir, {
      ...ADVANCE,
      identity: { ...IDENTITY, svFingerprint: "fp-2" },
    });

    expect((await readBatchChain(henchDir))?.svFingerprint).toBe("fp-2");
  });

  it("clears the chain", async () => {
    await advanceBatchChain(henchDir, ADVANCE);
    await clearBatchChain(henchDir);

    expect(await readBatchChain(henchDir)).toBeUndefined();
  });

  it("treats a corrupt cache file as no chain rather than throwing", async () => {
    await writeFile(join(henchDir, "session-cache.json"), "{oops", "utf-8");
    expect(await readBatchChain(henchDir)).toBeUndefined();
  });

  it("keeps the orientation parent and the batch chain independent", async () => {
    // Both live in one file; writing one must not destroy the other, or
    // switching strategies would silently discard the other's state.
    const { writeSessionCache, readSessionCache } = await import(
      "../../../src/agent/lifecycle/session-cache.js"
    );
    await writeSessionCache(henchDir, {
      parentId: "parent-1",
      svFingerprint: "fp",
      vendor: "claude",
      model: "claude-sonnet-5",
    });
    await advanceBatchChain(henchDir, ADVANCE);

    expect((await readSessionCache(henchDir))?.parentId).toBe("parent-1");
    expect((await readBatchChain(henchDir))?.sessionId).toBe("sess-1");
  });

  it("writes valid JSON a human can inspect", async () => {
    await advanceBatchChain(henchDir, ADVANCE);
    const raw = await readFile(join(henchDir, "session-cache.json"), "utf-8");
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("never persists prompt or transcript content — only identity and counters", async () => {
    await advanceBatchChain(henchDir, { ...ADVANCE, lastTaskTitle: "Fix the parser" });
    const written = JSON.parse(await readFile(join(henchDir, "session-cache.json"), "utf-8")) as {
      batch: Record<string, unknown>;
    };

    expect(Object.keys(written.batch).sort()).toEqual(
      [
        "createdAt",
        "lastTaskTitle",
        "lastUsedAt",
        "model",
        "policyHash",
        "ref",
        "sessionId",
        "svFingerprint",
        "tasksUsed",
        "vendor",
        "version",
        "worktreeRoot",
      ].sort(),
    );
  });
});

describe("batch chain — reading a pre-0.8.0 entry", () => {
  let henchDir: string;

  beforeEach(async () => {
    henchDir = await mkdtemp(join(tmpdir(), "hench-batch-legacy-"));
  });

  afterEach(async () => {
    await rm(henchDir, { recursive: true, force: true });
  });

  /** Exactly the shape released builds wrote: no version, no identity. */
  async function writeLegacyChain(): Promise<void> {
    await writeFile(
      join(henchDir, "session-cache.json"),
      JSON.stringify({
        batch: {
          sessionId: "legacy-sess",
          tasksUsed: 2,
          vendor: "codex",
          model: "gpt-5-codex",
          lastTaskTitle: "Something earlier",
        },
      }),
      "utf-8",
    );
  }

  it("reads back as version 0 rather than being dropped", async () => {
    await writeLegacyChain();
    const chain = await readBatchChain(henchDir);

    expect(chain?.version).toBe(0);
    expect(chain?.sessionId).toBe("legacy-sess");
  });

  it("is a named miss, not an error", async () => {
    await writeLegacyChain();
    const chain = await readBatchChain(henchDir);

    // The distinction that matters: "unversioned" tells the operator an old
    // entry was found and declined. Collapsing it into "no-chain" would say
    // nothing was there at all, and throwing would fail a run over a cache.
    expect(reasonFor(chain, { identity: IDENTITY })).toBe("unversioned");
  });

  it("is replaced by a current entry on the next advance", async () => {
    await writeLegacyChain();
    await advanceBatchChain(henchDir, ADVANCE);

    const chain = await readBatchChain(henchDir);
    expect(chain?.version).toBe(BATCH_CHAIN_VERSION);
    expect(chain?.tasksUsed).toBe(1);
  });
});

describe("isBatchChainUsable — admission", () => {
  it("continues a chain whose identity and freshness both still hold", () => {
    expect(isBatchChainUsable(chainEntry(), { identity: IDENTITY }).usable).toBe(true);
  });

  it("treats a missing chain as unusable", () => {
    expect(reasonFor(undefined, { identity: IDENTITY })).toBe("no-chain");
  });

  it("treats a cap of zero or less as batching disabled", () => {
    // Guards against a config value that would otherwise make every task
    // resume a chain it should never have joined.
    expect(reasonFor(chainEntry(), { identity: IDENTITY, tasksPerSession: 0 })).toBe("disabled");
    expect(reasonFor(chainEntry(), { identity: IDENTITY, tasksPerSession: 1 })).toBe("disabled");
  });

  it("starts fresh once the chain reaches the cap", () => {
    expect(
      reasonFor(chainEntry({ tasksUsed: 4 }), { identity: IDENTITY, tasksPerSession: 4 }),
    ).toBe("cap-reached");
  });

  it("defaults the cap when none is configured", () => {
    expect(
      reasonFor(chainEntry({ tasksUsed: DEFAULT_TASKS_PER_SESSION }), { identity: IDENTITY }),
    ).toBe("cap-reached");
  });

  it("rejects a version this build does not understand", () => {
    expect(reasonFor(chainEntry({ version: 0 }), { identity: IDENTITY })).toBe("unversioned");
    expect(reasonFor(chainEntry({ version: BATCH_CHAIN_VERSION + 1 }), { identity: IDENTITY })).toBe(
      "version-changed",
    );
  });

  it("checks the version before reading any other field", () => {
    // An entry from another scheme may use the same field names for different
    // things, so nothing in it is trustworthy enough to produce a more
    // specific reason.
    const foreign = chainEntry({ version: 99, worktreeRoot: "/somewhere/else", tasksUsed: 99 });
    expect(reasonFor(foreign, { identity: IDENTITY })).toBe("version-changed");
  });
});

describe("isBatchChainUsable — identity", () => {
  it("refuses a chain created in another worktree", () => {
    // The headline case: two worktrees of one repository run loops in
    // parallel, share a vendor and model, and must never share a transcript.
    const elsewhere = chainEntry({ worktreeRoot: "/repo/worktrees/feature-b" });
    expect(reasonFor(elsewhere, { identity: IDENTITY })).toBe("worktree-changed");
  });

  it("refuses a chain created on another ref", () => {
    expect(reasonFor(chainEntry({ ref: "main" }), { identity: IDENTITY })).toBe("ref-changed");
  });

  it("refuses a chain whose source analysis has moved on", () => {
    expect(reasonFor(chainEntry({ svFingerprint: "fp-2" }), { identity: IDENTITY })).toBe(
      "sourcevision-changed",
    );
  });

  it("refuses a chain opened under different permissions", () => {
    // `codex exec resume` accepts no sandbox or approval flags, so a resumed
    // thread keeps the policy it was created with. Tightening the policy
    // between tasks has to end the chain or it does not take effect at all.
    expect(reasonFor(chainEntry({ policyHash: "ph-2" }), { identity: IDENTITY })).toBe(
      "policy-changed",
    );
  });

  it("refuses a chain from another vendor or model", () => {
    expect(reasonFor(chainEntry({ vendor: "claude" }), { identity: IDENTITY })).toBe(
      "vendor-changed",
    );
    expect(reasonFor(chainEntry({ model: "gpt-5" }), { identity: IDENTITY })).toBe("model-changed");
  });

  it("reports the identity mismatch, not the cap, when both would fire", () => {
    // Order matters for the operator: "that chain belongs to another worktree"
    // is actionable, "it filled up" sends them to tune tasksPerSession.
    const full = chainEntry({ worktreeRoot: "/repo/worktrees/feature-b", tasksUsed: 99 });
    expect(reasonFor(full, { identity: IDENTITY, tasksPerSession: 4 })).toBe("worktree-changed");
  });

  it("reports the identity mismatch, not expiry, when both would fire", () => {
    const stale = chainEntry({
      worktreeRoot: "/repo/worktrees/feature-b",
      createdAt: hoursAgo(DEFAULT_BATCH_MAX_AGE_HOURS + 1),
    });
    expect(reasonFor(stale, { identity: IDENTITY })).toBe("worktree-changed");
  });

  it("gives every identity field its own rejection code", () => {
    // Holds the check table against the interface: a field added to
    // BatchChainIdentity without a code would silently never be compared, and
    // a silent identity field is exactly the wrong-hit this all exists to
    // prevent. Each key is perturbed and must produce a distinct reason.
    const reasons = new Set<BatchChainRejection>();
    for (const key of Object.keys(IDENTITY) as Array<keyof BatchChainIdentity>) {
      const reason = reasonFor(chainEntry({ [key]: `${IDENTITY[key]}-changed` }), {
        identity: IDENTITY,
      });
      expect(reason, `identity field "${key}" produced no rejection`).toBeDefined();
      reasons.add(reason!);
    }
    expect(reasons.size).toBe(Object.keys(IDENTITY).length);
  });
});

describe("isBatchChainUsable — freshness", () => {
  const now = Date.parse("2026-09-01T12:00:00.000Z");

  /** A chain opened `age` hours ago and last used `idle` hours ago. */
  function aged(age: number, idle: number): BatchChainEntry {
    return chainEntry({
      createdAt: new Date(now - age * 3_600_000).toISOString(),
      lastUsedAt: new Date(now - idle * 3_600_000).toISOString(),
    });
  }

  it("retires a chain past its total age even while it is being used", () => {
    expect(
      reasonFor(aged(DEFAULT_BATCH_MAX_AGE_HOURS + 1, 0), { identity: IDENTITY, now }),
    ).toBe("expired");
  });

  it("retires a chain that has sat idle, however young it is", () => {
    // The two bounds catch different drift, which is why one TTL cannot
    // replace both: this chain is well inside its total age.
    expect(reasonFor(aged(1, DEFAULT_BATCH_MAX_IDLE_HOURS + 0.5), { identity: IDENTITY, now })).toBe(
      "idle",
    );
  });

  it("keeps a chain that is inside both bounds", () => {
    expect(isBatchChainUsable(aged(1, 0.1), { identity: IDENTITY, now }).usable).toBe(true);
  });

  it("honors configured bounds", () => {
    expect(reasonFor(aged(3, 0), { identity: IDENTITY, now, maxAgeHours: 2 })).toBe("expired");
    expect(isBatchChainUsable(aged(3, 0), { identity: IDENTITY, now, maxAgeHours: 24 }).usable).toBe(
      true,
    );
    expect(reasonFor(aged(1, 0.5), { identity: IDENTITY, now, maxIdleHours: 0.25 })).toBe("idle");
  });

  it("rejects unparseable timestamps instead of trusting the entry", () => {
    expect(reasonFor(chainEntry({ createdAt: "not-a-date" }), { identity: IDENTITY })).toBe(
      "malformed",
    );
    expect(reasonFor(chainEntry({ lastUsedAt: "" }), { identity: IDENTITY })).toBe("malformed");
  });
});

describe("chainRefIdentity", () => {
  it("uses the branch when there is one", () => {
    expect(chainRefIdentity({ branch: "feat/thing", startHead: "abc123" })).toBe("feat/thing");
  });

  it("is stable across the commits a loop makes", () => {
    // Keying on HEAD would expire the chain after every task, since a task
    // that completes commits — batching would be disabled by its own success.
    expect(chainRefIdentity({ branch: "feat/thing", startHead: "abc123" })).toBe(
      chainRefIdentity({ branch: "feat/thing", startHead: "def456" }),
    );
  });

  it("falls back to the commit when HEAD is detached", () => {
    expect(chainRefIdentity({ startHead: "abc123" })).toBe("detached:abc123");
  });

  it("distinguishes a detached commit from a branch of the same name", () => {
    expect(chainRefIdentity({ startHead: "abc123" })).not.toBe(chainRefIdentity({ branch: "abc123" }));
  });

  it("yields a stable empty value outside a git repository", () => {
    // Nothing to invalidate on, so it must match itself rather than churn.
    expect(chainRefIdentity({})).toBe("");
    expect(reasonFor(chainEntry({ ref: "" }), { identity: { ...IDENTITY, ref: "" } })).toBeUndefined();
  });
});

describe("policyFingerprint", () => {
  const POLICY: PolicyFingerprintInput = {
    sandbox: "workspace-write",
    approvals: "never",
    networkAccess: false,
    writableRoots: ["src", "tests"],
    allowedCommands: ["git", "node", "npm"],
    allowedGitSubcommands: ["add", "commit", "status"],
    allowedFileTools: ["Edit", "Read", "Write"],
  };

  it("is stable for the same policy", () => {
    expect(policyFingerprint(POLICY)).toBe(policyFingerprint({ ...POLICY }));
  });

  it("ignores allowlist ordering, which grants the same permissions", () => {
    expect(policyFingerprint({ ...POLICY, allowedCommands: ["npm", "git", "node"] })).toBe(
      policyFingerprint(POLICY),
    );
  });

  it("changes when any field of the policy changes", () => {
    const base = policyFingerprint(POLICY);
    const variants: PolicyFingerprintInput[] = [
      { ...POLICY, sandbox: "read-only" },
      { ...POLICY, approvals: "always" },
      { ...POLICY, networkAccess: true },
      { ...POLICY, writableRoots: ["src"] },
      { ...POLICY, allowedCommands: ["git"] },
      { ...POLICY, allowedGitSubcommands: ["add"] },
      { ...POLICY, allowedFileTools: ["Read"] },
    ];
    for (const variant of variants) {
      expect(policyFingerprint(variant)).not.toBe(base);
    }
  });

  it("separates unscoped git from no git subcommands at all", () => {
    // Absent means "git granted unscoped"; empty means "no subcommand
    // permitted". Hashing them alike would let the loosest policy resume a
    // chain opened under the strictest.
    const { allowedGitSubcommands: _omitted, ...withoutKey } = POLICY;
    expect(policyFingerprint(withoutKey)).not.toBe(
      policyFingerprint({ ...POLICY, allowedGitSubcommands: [] }),
    );
  });
});

// ── Concurrent mutation ──────────────────────────────────────────────────
//
// `maxConcurrentProcesses` defaults to 3, so several runs in one checkout is
// the configured norm. Every mutation here is a read-modify-write, and the
// failure it produces is a lost update: two tasks advance the same chain,
// both read `tasksUsed: 1`, both write 2, and the cap silently counts one
// task instead of two. These race deliberately rather than asserting on the
// lock's existence, because a lock that is held but not honoured on every
// path would still pass the latter.

describe("batch chain — concurrent mutation", () => {
  let dir: string;
  beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), "batch-race-")); });
  afterEach(async () => { await rm(dir, { recursive: true, force: true }); });

  it("counts every concurrent advance of the same chain", async () => {
    const advances = 8;
    await Promise.all(
      Array.from({ length: advances }, () => advanceBatchChain(dir, ADVANCE)),
    );

    const chain = await readBatchChain(dir);
    expect(chain?.sessionId).toBe("sess-1");
    // Without serialisation the interleaved writes lose increments and this
    // lands well under the number of advances.
    expect(chain?.tasksUsed).toBe(advances);
  });

  it("never leaves the cache file unparseable under concurrent writes", async () => {
    await Promise.all([
      ...Array.from({ length: 6 }, () => advanceBatchChain(dir, ADVANCE)),
      ...Array.from({ length: 3 }, () => readBatchChain(dir)),
    ]);

    // A torn write would throw here rather than return an entry. The write is
    // a temp file plus a rename for exactly this reason.
    const raw = await readFile(join(dir, "session-cache.json"), "utf-8");
    expect(() => JSON.parse(raw) as unknown).not.toThrow();
  });

  it("preserves a batch chain written while a clear is deciding", async () => {
    // clearSessionCache reads, decides on the absence of a chain, then
    // removes the file. A chain arriving in that gap must survive.
    await Promise.all([
      clearSessionCache(dir),
      advanceBatchChain(dir, ADVANCE),
    ]);

    const chain = await readBatchChain(dir);
    expect(chain?.sessionId).toBe("sess-1");
  });
});
