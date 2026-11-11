/**
 * The v2 store transaction: load, mutate and write the product and change
 * layers under one hold of the PRD lock, refusing a v1 tree.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cp, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { withPrdModelTransaction, withPrdModelWriteSession } from "../../../src/store/prd-model-transaction.js";
import { loadPrdModel } from "../../../src/store/prd-model-reader.js";
import { isLockHeld } from "../../../src/store/file-lock.js";
import { PRD_TREE_DIRNAME, prdLockPath } from "../../../src/store/paths.js";
import type { RuleNode, V2Tree } from "../../../src/schema/v2-rules.js";
import { copyV2Fixture, editText } from "../../helpers/v2-fixture.js";

const CAPABILITY = "a0000000-0000-4000-8000-000000000002";
const CHANGE = "c0000000-0000-4000-8000-000000000001";
const V1_FIXTURE = resolve(import.meta.dirname, "../../fixtures/folder-tree/known-prd");

const quiet = { env: {}, warn: () => {} };

let tmp: string;
let rexDir: string;
beforeEach(async () => {
  tmp = await mkdtemp(join(tmpdir(), "rex-model-tx-"));
  rexDir = await copyV2Fixture(join(tmp, ".rex"), "lf");
});
afterEach(async () => {
  await rm(tmp, { recursive: true, force: true });
});

function find(nodes: RuleNode[], id: string): RuleNode | undefined {
  for (const node of nodes) {
    if (node.id === id) return node;
    const hit = node.children && find(node.children, id);
    if (hit) return hit;
  }
  return undefined;
}

/** `tree` with node `id` retitled; the input is not modified. */
function retitle(tree: V2Tree, id: string, title: string): V2Tree {
  const next = structuredClone(tree);
  const node = find([...next.product, ...next.changes], id);
  if (!node) throw new Error(`node ${id} not found`);
  node.title = title;
  return next;
}

async function titleOf(dir: string, id: string): Promise<string | undefined> {
  const model = await loadPrdModel(dir, quiet);
  return find([...model.tree.product, ...model.tree.changes], id)?.title;
}

const tick = () => new Promise((r) => setTimeout(r, 50));

describe("withPrdModelTransaction", () => {
  it("holds the PRD lock across the load, the mutation and the write", async () => {
    const lockPath = prdLockPath(rexDir);
    const { result, written } = await withPrdModelTransaction(rexDir, (model) => {
      expect(isLockHeld(lockPath)).toBe(true);
      expect(existsSync(lockPath)).toBe(true);
      expect(model.layout).toBe("v2");
      return { tree: retitle(model.tree, CAPABILITY, "Pay by card, renamed"), result: "done" };
    });
    expect(result).toBe("done");
    // state.yaml takes the retitled node's lastModified / lastModifiedBy.
    expect(written).toEqual({ written: ["product/checkout/pay-by-card.md", "product/checkout/state.yaml"], removed: [], deletedFiles: [] });
    expect(await titleOf(rexDir, CAPABILITY)).toBe("Pay by card, renamed");
    expect(isLockHeld(lockPath)).toBe(false);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("waits for another process's lock, then loads that process's write instead of dropping it", async () => {
    // Another live process (the parent: alive, and not this one) holds the lock.
    const lockPath = prdLockPath(rexDir);
    await writeFile(lockPath, JSON.stringify({ pid: process.ppid, token: "other-writer", timestamp: new Date().toISOString() }));
    let loadedTitle: string | undefined;
    const tx = withPrdModelTransaction(
      rexDir,
      (model) => {
        loadedTitle = find(model.tree.product, CAPABILITY)?.title;
        return { tree: retitle(model.tree, CHANGE, "Change, renamed"), result: undefined };
      },
      { lock: { retryDelayMs: 10 } },
    );
    await tick();
    expect(loadedTitle).toBeUndefined();
    // The holder writes its change, then releases.
    await editText(join(rexDir, "product/checkout/pay-by-card.md"), (t) => t.replace('"Pay by card"', '"Holder title"'));
    await unlink(lockPath);
    await tx;
    expect(loadedTitle).toBe("Holder title");
    expect(await titleOf(rexDir, CAPABILITY)).toBe("Holder title");
    expect(await titleOf(rexDir, CHANGE)).toBe("Change, renamed");
  });

  it("runs two concurrent transactions one after the other, keeping both changes", async () => {
    let openGate!: () => void;
    const gate = new Promise<void>((r) => (openGate = r));
    const first = withPrdModelTransaction(rexDir, async (model) => {
      await gate;
      return { tree: retitle(model.tree, CAPABILITY, "First"), result: 1 };
    });
    let secondRan = false;
    const second = withPrdModelTransaction(rexDir, (model) => {
      secondRan = true;
      return { tree: retitle(model.tree, CHANGE, "Second"), result: 2 };
    });
    await tick();
    expect(secondRan).toBe(false);
    openGate();
    expect((await first).result).toBe(1);
    expect((await second).result).toBe(2);
    expect(await titleOf(rexDir, CAPABILITY)).toBe("First");
    expect(await titleOf(rexDir, CHANGE)).toBe("Second");
  });

  it("writes nothing and releases the lock when the mutation throws", async () => {
    await expect(
      withPrdModelTransaction(rexDir, () => {
        throw new Error("mutation refused");
      }),
    ).rejects.toThrow("mutation refused");
    expect(await titleOf(rexDir, CAPABILITY)).toBe("Pay by card");
    expect(isLockHeld(prdLockPath(rexDir))).toBe(false);
    expect(existsSync(prdLockPath(rexDir))).toBe(false);
  });

  it("stamps createdAt once on a new change, and never on an edit or on another type", async () => {
    const first = new Date("2026-11-01T10:00:00.000Z");
    const later = new Date("2026-11-02T10:00:00.000Z");
    const fresh = "d0000000-0000-4000-8000-0000000000aa";
    await withPrdModelTransaction(
      rexDir,
      (model) => {
        const next = structuredClone(model.tree);
        next.changes.push({ id: fresh, type: "change", slug: "fresh-change", title: "Fresh change", needsPlacement: true } as RuleNode);
        return { tree: next, result: undefined };
      },
      { now: () => first },
    );
    // An edit to the new change and to a change recorded before the field existed.
    await withPrdModelTransaction(
      rexDir,
      (model) => ({ tree: retitle(retitle(model.tree, fresh, "Fresh change, renamed"), CHANGE, "Add Apple Pay, renamed"), result: undefined }),
      { now: () => later },
    );
    const { tree } = await loadPrdModel(rexDir, quiet);
    expect(find(tree.changes, fresh)).toMatchObject({ createdAt: first.toISOString(), lastModified: later.toISOString() });
    expect(find(tree.changes, CHANGE)?.createdAt).toBeUndefined();
    expect(find(tree.product, CAPABILITY)?.createdAt).toBeUndefined();
  });

  it("takes createdAt from a new change's own lastModified, as an import brings it", async () => {
    const stampedAt = new Date("2026-11-06T10:00:00.000Z");
    const older = "2026-09-01T08:00:00.000Z";
    const imported = "d0000000-0000-4000-8000-0000000000bb";
    await withPrdModelTransaction(
      rexDir,
      (model) => {
        const next = structuredClone(model.tree);
        next.changes.push({
          id: imported,
          type: "change",
          slug: "imported-change",
          title: "Imported change",
          needsPlacement: true,
          lastModified: older,
        } as RuleNode);
        return { tree: next, result: undefined };
      },
      { now: () => stampedAt },
    );
    const { tree } = await loadPrdModel(rexDir, quiet);
    expect(find(tree.changes, imported)).toMatchObject({ createdAt: older, lastModified: older });
  });

  it("refuses a v1 tree, naming the layout, before running the mutation", async () => {
    const v1Dir = join(tmp, "v1");
    await cp(V1_FIXTURE, join(v1Dir, PRD_TREE_DIRNAME), { recursive: true });
    let ran = false;
    await expect(
      withPrdModelTransaction(v1Dir, (model) => {
        ran = true;
        return { tree: model.tree, result: undefined };
      }),
    ).rejects.toThrow(/v1 layout/);
    expect(ran).toBe(false);
    expect(existsSync(prdLockPath(v1Dir))).toBe(false);
  });
});


describe("withPrdModelWriteSession", () => {
  it("holds the shared lock after assignment and throughout failure recovery", async () => {
    await expect(withPrdModelWriteSession(rexDir, async (transaction) => {
      await transaction(rexDir, ({ tree }) => ({ tree: retitle(tree, CHANGE, "Assigned"), result: null }));
      try {
        await expect(withPrdModelTransaction(rexDir, ({ tree }) => ({ tree, result: null }), {
          lock: { acquireTimeoutMs: 25 },
        })).rejects.toThrow("Could not acquire PRD lock");
        throw new Error("commit failed");
      } catch (err) {
        expect(isLockHeld(prdLockPath(rexDir))).toBe(true);
        // Recovery uses the same explicit transaction, without reacquisition.
        await transaction(rexDir, ({ tree }) => ({ tree: retitle(tree, CHANGE, "Recovered"), result: null }));
        throw err;
      }
    })).rejects.toThrow("commit failed");
    expect(await titleOf(rexDir, CHANGE)).toBe("Recovered");
    await withPrdModelTransaction(rexDir, ({ tree }) => ({ tree: retitle(tree, CHANGE, "Later capture"), result: null }));
    expect(await titleOf(rexDir, CHANGE)).toBe("Later capture");
  });

  it("refuses escaped, cross-workspace and overlapping session transactions", async () => {
    let saved!: typeof withPrdModelTransaction;
    const edit = ({ tree }: Awaited<ReturnType<typeof loadPrdModel>>) => ({ tree, result: null });
    await withPrdModelWriteSession(rexDir, async (transaction) => {
      saved = transaction;
      await expect(transaction(join(tmp, "another-workspace"), edit)).rejects.toThrow("another workspace");
      let release!: () => void;
      const gate = new Promise<void>((resolve) => { release = resolve; });
      const first = transaction(rexDir, async (model) => { await gate; return edit(model); });
      try {
        await expect(transaction(rexDir, edit)).rejects.toThrow("sequentially");
      } finally {
        release();
        await first;
      }
    });
    await expect(saved(rexDir, edit)).rejects.toThrow("closed");
    expect(existsSync(prdLockPath(rexDir))).toBe(false);
  });
});
