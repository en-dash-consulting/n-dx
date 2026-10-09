/**
 * v2 MCP write tools read their clock inside the PRD lock, after the tree is
 * loaded. A call that waits behind another writer must be stamped with the time
 * it got the lock, not the time it was made (PR #612 review).
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createStore } from "../../src/store/index.js";
import { handleAddItem, handleApplyChange, handlePlaceChange } from "../../src/cli/mcp-tools/index.js";
import { loadPrdModel } from "../../src/store/prd-model-reader.js";
import { prdLockPath } from "../../src/store/paths.js";
import { indexTree } from "../../src/schema/v2-rules.js";
import { copyV2Fixture, editText } from "../helpers/v2-fixture.js";

const CHANGE = "c0000000-0000-4000-8000-000000000001";
const quiet = { env: {}, warn: () => {} };

const BEFORE_WAIT = new Date("2026-10-09T00:00:00.000Z");
const HOLDER_STARTED = new Date("2026-10-09T00:01:00.000Z");
const AFTER_LOCK = new Date("2026-10-09T00:02:00.000Z");

let tmp: string;
let rexDir: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rex-v2-lock-clock-"));
  rexDir = await copyV2Fixture(join(tmp, ".rex"), "lf");
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

const store = () => createStore("file", rexDir);
const tick = () => new Promise((r) => setTimeout(r, 50));

/** A clock whose value the test moves; it records every read. */
function movableClock(start: Date) {
  let current = start;
  const reads: Date[] = [];
  return {
    read: () => {
      reads.push(current);
      return current;
    },
    set: (d: Date) => (current = d),
    reads,
  };
}

/**
 * Hold the PRD lock as another live process (the parent), run `call` so it
 * waits, then let `holderWrites` mutate the tree before releasing.
 */
async function behindHolder<T>(call: () => Promise<T>, holderWrites: () => Promise<void>): Promise<T> {
  const lockPath = prdLockPath(rexDir);
  await writeFile(lockPath, JSON.stringify({ pid: process.ppid, token: "other-writer", timestamp: new Date().toISOString() }));
  const pending = call();
  await tick();
  await holderWrites();
  await unlink(lockPath);
  return pending;
}

/** The holder starts the change: an open active interval in its state.yaml. */
async function holderStartsChange() {
  await editText(
    join(rexDir, "changes/add-apple-pay/state.yaml"),
    (t) => `${t.trimEnd()}\n    activeIntervals: ${JSON.stringify([{ start: HOLDER_STARTED.toISOString() }])}\n`,
  );
}

async function nodeById(id: string) {
  const model = await loadPrdModel(rexDir, quiet);
  return indexTree(model.tree, { includeTombstones: true }).resolve(id) as ReturnType<ReturnType<typeof indexTree>["resolve"]> & {
    activeIntervals?: { start: string; end?: string }[];
    children?: { id: string; activeIntervals?: { start: string; end?: string }[] }[];
  };
}

describe("add_item on v2 reads its clock inside the lock", () => {
  it("splits at the post-lock time when a writer that held the lock started the change", async () => {
    // The first live task is what splits a change: drop the fixture's own.
    await rm(join(rexDir, "changes/add-apple-pay/wire-the-button.md"));
    const clock = movableClock(BEFORE_WAIT);
    const res = await behindHolder(
      () => handleAddItem(store(), tmp, rexDir, { type: "task", title: "First task", parentId: CHANGE }, clock.read),
      async () => {
        await holderStartsChange();
        clock.set(AFTER_LOCK);
      },
    );
    expect(res.isError, res.content[0].text).toBeFalsy();
    expect(clock.reads).toEqual([AFTER_LOCK]);

    const change = await nodeById(CHANGE);
    expect(change.activeIntervals).toEqual([{ start: HOLDER_STARTED.toISOString(), end: AFTER_LOCK.toISOString() }]);
    const { id } = JSON.parse(res.content[0].text);
    const task = change.children!.find((c) => c.id === id)!;
    expect(task.activeIntervals).toEqual([{ start: AFTER_LOCK.toISOString() }]);
  });

  it("logs the post-lock time", async () => {
    const clock = movableClock(BEFORE_WAIT);
    await behindHolder(
      () => handleAddItem(store(), tmp, rexDir, { title: "Waited" }, clock.read),
      async () => void clock.set(AFTER_LOCK),
    );
    const entries = (await readFile(join(rexDir, "execution-log.jsonl"), "utf-8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(entries.at(-1)).toMatchObject({ event: "item_added", timestamp: AFTER_LOCK.toISOString() });
  });
});

describe("place_change on v2 reads its clock inside the lock", () => {
  it("logs the post-lock time", async () => {
    const id = JSON.parse((await handleAddItem(store(), tmp, rexDir, { title: "Unplaced" })).content[0].text).id;
    const clock = movableClock(BEFORE_WAIT);
    const res = await behindHolder(
      () => handlePlaceChange(store(), rexDir, { id, target: "A1.1", relation: "touches" }, clock.read),
      async () => void clock.set(AFTER_LOCK),
    );
    expect(res.isError, res.content[0].text).toBeFalsy();
    expect(clock.reads).toEqual([AFTER_LOCK]);
    const entries = (await readFile(join(rexDir, "execution-log.jsonl"), "utf-8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(entries.at(-1)).toMatchObject({ event: "change_placed", timestamp: AFTER_LOCK.toISOString() });
  });
});

describe("apply_change on v2 reads its clock inside the lock", () => {
  it("stamps appliedAt and the log with the post-lock time", async () => {
    const clock = movableClock(BEFORE_WAIT);
    const res = await behindHolder(
      () => handleApplyChange(store(), rexDir, { id: "CH-1" }, clock.read),
      async () => void clock.set(AFTER_LOCK),
    );
    expect(res.isError, res.content[0].text).toBeFalsy();
    expect(clock.reads).toEqual([AFTER_LOCK]);
    expect(JSON.parse(res.content[0].text).appliedAt).toBe(AFTER_LOCK.toISOString());
    expect((await nodeById(CHANGE) as { appliedAt?: string }).appliedAt).toBe(AFTER_LOCK.toISOString());
    const entries = (await readFile(join(rexDir, "execution-log.jsonl"), "utf-8")).trim().split("\n").map((l) => JSON.parse(l));
    expect(entries.at(-1)).toMatchObject({ event: "change_applied", timestamp: AFTER_LOCK.toISOString() });
  });
});
