/**
 * `analyze --accept` builds its items nested, and inserts them in one transaction.
 *
 * WHY THIS EXISTS. Acceptance used to call `store.addItem` once per item, so an
 * accept of N items ran N transactions and serialized the whole folder tree N
 * times. Every intermediate state reached disk: an epic added before its first
 * feature is written as the LEAF `general.md`, and the next transaction has to
 * delete that leaf to promote the epic to `general/index.md`.
 *
 * That delete is what the stale-save guard inspects, comparing the leaf's mtime
 * against the transaction's `loadedAt` with a 2 ms tolerance. Measured on
 * Windows, the leaf's mtime lands only 0.57–2.04 ms before the next
 * transaction's load — inside the tolerance, but barely. Under the I/O pressure
 * of the full suite the write timestamp drifts past the window and the accept
 * dies with "Stale-save guard: this save would delete 1 item written after the
 * document being saved was loaded", naming `prd_tree/general.md`. It reproduced
 * 2/2 through `scripts/run-all-tests.mjs` and passed 2/2 with the rex suite
 * alone, which is why it read as flake.
 *
 * Building each epic with its children already attached is the fix: one write
 * emits the final shape, so the intermediate leaf is never created and there is
 * no stale entry for the guard to weigh. These cases pin the structural
 * property rather than the timing, so they fail deterministically if the
 * per-item insertion pattern comes back.
 *
 * @see packages/rex/src/cli/commands/analyze.ts
 * @see packages/rex/src/store/folder-tree-serializer.ts guardStaleEntries
 */

import { describe, it, expect } from "vitest";
import { buildAcceptedItems } from "../../../src/cli/commands/analyze.js";
import type { Proposal } from "../../../src/analyze/index.js";

/** A proposal shaped like the ones `buildProposals` emits for scanned tests. */
function proposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    epic: { title: "General", status: "pending", source: "test", description: "Scanned" },
    features: [
      {
        title: "General Tests",
        status: "pending",
        source: "test",
        description: "From billing.test.ts",
        tasks: [
          {
            title: "processes payments",
            status: "pending",
            source: "test",
            description: "",
            acceptanceCriteria: [],
          },
        ],
      },
    ],
    ...overrides,
  } as Proposal;
}

describe("buildAcceptedItems", () => {
  it("nests features and tasks under their epic instead of emitting a flat list", async () => {
    const { items } = await buildAcceptedItems([proposal()]);

    // One top-level entry — the epic. Anything flat here would be written as a
    // separate tree entry and reintroduce the promotion churn.
    expect(items).toHaveLength(1);
    expect(items[0]!.level).toBe("epic");

    const features = items[0]!.children ?? [];
    expect(features).toHaveLength(1);
    expect(features[0]!.level).toBe("feature");

    const tasks = features[0]!.children ?? [];
    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.level).toBe("task");
    expect(tasks[0]!.title).toBe("processes payments");
  });

  it("never emits an epic without its children — the shape that writes a leaf", async () => {
    const { items } = await buildAcceptedItems([proposal(), proposal()]);

    // An epic carrying features must arrive with them attached. An epic whose
    // children were to be added by a later transaction is exactly the state
    // that serializes to `<slug>.md` and then has to be deleted.
    for (const epic of items) {
      expect(epic.children, `epic "${epic.title}" arrived childless`).toBeDefined();
      expect(epic.children!.length).toBeGreaterThan(0);
    }
  });

  it("counts every item added, at all three levels", async () => {
    const { addedCount } = await buildAcceptedItems([proposal()]);
    // epic + feature + task
    expect(addedCount).toBe(3);
  });

  it("counts completed items separately for the baseline summary", async () => {
    const baseline = proposal({
      epic: { title: "Existing", status: "completed", source: "test", description: "" },
    } as Partial<Proposal>);
    const { addedCount, completedCount } = await buildAcceptedItems([baseline]);

    expect(addedCount).toBe(3);
    expect(completedCount).toBe(1);
  });

  it("stamps completedAt on completed items only", async () => {
    const baseline = proposal({
      epic: { title: "Existing", status: "completed", source: "test", description: "" },
    } as Partial<Proposal>);
    const { items } = await buildAcceptedItems([baseline]);

    expect(items[0]!.completedAt).toBeTruthy();
    expect(items[0]!.children![0]!.completedAt).toBeUndefined();
  });

  it("stamps lastModified on every item, as addItem did", async () => {
    const { items } = await buildAcceptedItems([proposal()]);

    const epic = items[0]!;
    const feature = epic.children![0]!;
    const task = feature.children![0]!;
    for (const item of [epic, feature, task]) {
      expect(item.lastModified, `"${item.title}" was not stamped`).toBeTruthy();
    }
  });

  it("gives every item a distinct id", async () => {
    const { items } = await buildAcceptedItems([proposal(), proposal()]);

    const ids: string[] = [];
    const walk = (list: typeof items): void => {
      for (const item of list) {
        ids.push(item.id);
        if (item.children) walk(item.children);
      }
    };
    walk(items);

    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });
});
