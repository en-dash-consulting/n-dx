/**
 * `withTransaction` must resolve the actor identity *before* taking the PRD
 * lock.
 *
 * `resolveActor` shells out to `git config` on its first call in a process
 * (packages/rex/src/core/identity.ts). Doing that inside the locked span puts
 * a 5-second-timeout subprocess between every other writer and the PRD —
 * `withTransaction` holds the lock across load, mutate and write, and any
 * writer that cannot acquire it within its own timeout fails loudly naming
 * this process as the holder.
 *
 * The ordering is invisible in the result — the stamp is identical either way
 * — so it is asserted directly, on its own, in this file: the mocks below
 * would otherwise apply to every test that shares the module.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const events = vi.hoisted(() => ({ order: [] as string[] }));

vi.mock("../../../src/core/identity.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/core/identity.js")>();
  return {
    ...actual,
    resolveActor: vi.fn(async () => {
      events.order.push("resolveActor");
      return "Ordering Test <ordering@example.com>";
    }),
  };
});

vi.mock("../../../src/store/file-lock.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/store/file-lock.js")>();
  return {
    ...actual,
    // Records entry, then defers to the real lock so the transaction still
    // serializes exactly as it would in production.
    withLock: vi.fn(async (lockPath: string, fn: () => Promise<unknown>, options?: unknown) => {
      events.order.push("withLock");
      return actual.withLock(lockPath, fn, options as never);
    }),
  };
});

const { FolderTreeStore, ensureFolderTreeRexDir } = await import(
  "../../../src/store/folder-tree-store.js"
);
const { FileStore } = await import("../../../src/store/file-adapter.js");
const { SCHEMA_VERSION } = await import("../../../src/schema/index.js");
const { toCanonicalJSON } = await import("../../../src/core/canonical.js");
const { updateInTree } = await import("../../../src/core/tree.js");
import type { PRDStore } from "../../../src/store/contracts.js";
import type { PRDItem } from "../../../src/schema/index.js";

const STORES: Array<{ name: string; create: (rexDir: string) => PRDStore }> = [
  { name: "FolderTreeStore", create: (rexDir) => new FolderTreeStore(rexDir) },
  { name: "FileStore", create: (rexDir) => new FileStore(rexDir) },
];

describe.each(STORES)("$name withTransaction actor resolution", ({ create }) => {
  let tmpDir: string;
  let store: PRDStore;

  beforeEach(async () => {
    events.order.length = 0;
    tmpDir = await mkdtemp(join(tmpdir(), "rex-txn-actor-"));
    const rexDir = join(tmpDir, ".rex");
    await ensureFolderTreeRexDir(rexDir);
    await writeFile(
      join(rexDir, "config.json"),
      toCanonicalJSON({ schema: SCHEMA_VERSION, project: "txn-actor", adapter: "folder-tree" }),
      "utf-8",
    );
    await writeFile(join(rexDir, "execution-log.jsonl"), "", "utf-8");
    await writeFile(join(rexDir, "workflow.md"), "# Workflow", "utf-8");

    store = create(rexDir);
    await store.saveDocument({
      schema: "rex/v1",
      title: "Actor Ordering",
      items: [{ id: "task-a", title: "Task A", level: "task", status: "pending" } as PRDItem],
    });
    // saveDocument takes the lock too; only the transaction's ordering is
    // under test.
    events.order.length = 0;
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("resolves the actor before acquiring the PRD lock", async () => {
    await store.withTransaction(async (doc) => {
      updateInTree(doc.items, "task-a", { description: "Changed." });
    });

    expect(events.order).toEqual(["resolveActor", "withLock"]);
  });

  it("uses the resolved actor for the stamp", async () => {
    await store.withTransaction(async (doc) => {
      updateInTree(doc.items, "task-a", { description: "Changed." });
    });

    expect((await store.getItem("task-a"))!.lastModifiedBy).toBe(
      "Ordering Test <ordering@example.com>",
    );
  });
});
