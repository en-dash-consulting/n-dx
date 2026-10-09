/**
 * The v2 store transaction: load, mutate and write the product and change
 * layers under one hold of the PRD lock, refusing a v1 tree.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cp, mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { withPrdModelTransaction } from "../../../src/store/prd-model-transaction.js";
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
    expect(written).toEqual({ written: ["product/checkout/pay-by-card.md"], removed: [] });
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
