/**
 * Tests for the batch session chain.
 *
 * Batching resumes the *previous task's* session so the transcript
 * accumulates — the right model for a CLI whose resume appends rather than
 * branches. That makes the reset rules the load-bearing part: without a bound
 * the shared transcript grows for the whole loop, which costs more per turn
 * and lets one task's framing bleed into the next.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  readBatchChain,
  advanceBatchChain,
  clearBatchChain,
  isBatchChainUsable,
  DEFAULT_TASKS_PER_SESSION,
} from "../../../src/agent/lifecycle/session-cache.js";

const CHAIN = { sessionId: "sess-1", vendor: "claude", model: "claude-sonnet-5" };

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
    await advanceBatchChain(henchDir, CHAIN);

    const chain = await readBatchChain(henchDir);
    expect(chain?.sessionId).toBe("sess-1");
    expect(chain?.tasksUsed).toBe(1);
  });

  it("increments the count when the same session serves another task", async () => {
    await advanceBatchChain(henchDir, CHAIN);
    await advanceBatchChain(henchDir, CHAIN);

    expect((await readBatchChain(henchDir))?.tasksUsed).toBe(2);
  });

  it("restarts the count when a new session takes over", async () => {
    await advanceBatchChain(henchDir, CHAIN);
    await advanceBatchChain(henchDir, CHAIN);
    await advanceBatchChain(henchDir, { ...CHAIN, sessionId: "sess-2" });

    const chain = await readBatchChain(henchDir);
    expect(chain?.sessionId).toBe("sess-2");
    expect(chain?.tasksUsed).toBe(1);
  });

  it("clears the chain", async () => {
    await advanceBatchChain(henchDir, CHAIN);
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
    await advanceBatchChain(henchDir, CHAIN);

    expect((await readSessionCache(henchDir))?.parentId).toBe("parent-1");
    expect((await readBatchChain(henchDir))?.sessionId).toBe("sess-1");
  });
});

describe("isBatchChainUsable", () => {
  const chain = { ...CHAIN, tasksUsed: 1 };

  it("continues a chain that is under the cap", () => {
    expect(
      isBatchChainUsable(chain, { vendor: "claude", model: "claude-sonnet-5", tasksPerSession: 4 })
        .usable,
    ).toBe(true);
  });

  it("starts fresh once the chain reaches the cap", () => {
    const atCap = { ...CHAIN, tasksUsed: 4 };
    const verdict = isBatchChainUsable(atCap, {
      vendor: "claude",
      model: "claude-sonnet-5",
      tasksPerSession: 4,
    });
    expect(verdict.usable).toBe(false);
    expect(verdict.reason).toBe("cap-reached");
  });

  it("defaults the cap when none is configured", () => {
    const atDefault = { ...CHAIN, tasksUsed: DEFAULT_TASKS_PER_SESSION };
    expect(
      isBatchChainUsable(atDefault, { vendor: "claude", model: "claude-sonnet-5" }).usable,
    ).toBe(false);
  });

  it("starts fresh when the vendor or model changed", () => {
    expect(
      isBatchChainUsable(chain, { vendor: "codex", model: "claude-sonnet-5" }).reason,
    ).toBe("vendor-changed");
    expect(
      isBatchChainUsable(chain, { vendor: "claude", model: "claude-opus-5" }).reason,
    ).toBe("model-changed");
  });

  it("treats a missing chain as unusable", () => {
    expect(
      isBatchChainUsable(undefined, { vendor: "claude", model: "claude-sonnet-5" }).usable,
    ).toBe(false);
  });

  it("treats a cap of zero or less as batching disabled", () => {
    // Guards against a config value that would otherwise make every task
    // resume a chain it should never have joined.
    expect(
      isBatchChainUsable(chain, {
        vendor: "claude",
        model: "claude-sonnet-5",
        tasksPerSession: 0,
      }).usable,
    ).toBe(false);
  });
});
