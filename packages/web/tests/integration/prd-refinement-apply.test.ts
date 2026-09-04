/**
 * `POST /api/rex/apply-refinements` against a real folder-tree PRD.
 *
 * This is the boundary the unit tests cannot reach. `prd-refinement.test.ts`
 * proves the mutation and the staleness check on an in-memory document;
 * `ask-refinements.test.ts` proves the panel posts one accepted proposal and
 * posts nothing on reject. What is left — and what this feature's whole risk
 * lives in — is the disk:
 *
 *  - **The accept path writes through the lock.** Not "writes", but writes
 *    inside `store.withTransaction`, so a concurrent PRD writer is serialized
 *    against rather than raced. The test that proves it holds the lock, changes
 *    the document underneath, and checks that the request refuses instead of
 *    reverting that change.
 *  - **A held lock fails loudly, naming the holder.** Asserted against a real
 *    foreign process, because the in-process mutex means a same-process holder
 *    queues rather than collides — which would prove the opposite of the point.
 *  - **The reject path writes nothing.** Asserted as a byte-for-byte comparison
 *    of the tree before and after, which is the acceptance criterion's own
 *    wording and is stronger than "the item still says what it said".
 *  - **An applied refinement is visible without a restart**, through the same
 *    running server that applied it.
 *
 * @see ../../src/server/routes-rex/refinements.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm, readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { tmpdir } from "node:os";
import { spawn, type ChildProcess } from "node:child_process";
import { resolveStore } from "@n-dx/rex";
import { prdLockPath } from "@n-dx/rex/dist/store/paths.js";
import { acquireLock } from "@n-dx/rex/dist/store/file-lock.js";
import type { ServerContext } from "../../src/server/types.js";
import { handleRexRoute } from "../../src/server/routes-rex/index.js";
import {
  applyRefinements,
  parseAnswerRefinements,
  REFINEMENT_FENCE_TAG,
} from "../../src/server/prd-refinement.js";
import type { RefinementProposal } from "../../src/server/prd-refinement.js";
import type { PRDDocument, PRDItem } from "../../src/server/rex-gateway.js";
import {
  startRouteTestServer,
  removeTestDir,
  type RouteTestServer,
} from "../helpers/server-route-test-support.js";

/**
 * How long the route waits for a lock another process holds.
 *
 * Not configurable from here — `withTransaction` takes no `LockOptions` — so
 * the one test that exercises it has to outlast rex's `ACQUIRE_TIMEOUT_MS`
 * (10s). A guardrail against a hang, not a latency assertion: the verdict it
 * checks (a 409 naming the holder) is deterministic.
 */
const LOCK_CONTENTION_TIMEOUT_MS = 25_000;

function makeDoc(): PRDDocument {
  return {
    schema: "rex/v1",
    title: "Test Project",
    items: [
      {
        id: "epic-1",
        title: "Epic One",
        level: "epic",
        status: "pending",
        children: [
          {
            id: "task-a",
            title: "Add the Ask panel",
            level: "task",
            status: "pending",
            priority: "medium",
            description: "Original description.",
            acceptanceCriteria: ["The panel renders"],
          },
          {
            id: "task-b",
            title: "Add an Ask panel",
            level: "task",
            status: "pending",
            priority: "low",
            description: "A duplicate of the one above.",
            acceptanceCriteria: ["The panel renders", "The panel reports errors"],
          },
        ],
      },
      { id: "epic-2", title: "Epic Two", level: "epic", status: "pending", children: [] },
    ] as PRDItem[],
  };
}

/**
 * The one file under `dir` whose contents include `needle`.
 *
 * Used instead of a hand-built slug path: the folder tree's naming convention
 * (collision suffixes, leaf `<slug>.md` versus `<slug>/index.md`) is the
 * serializer's business, and a test that hard-codes it fails for a reason that
 * has nothing to do with what it is checking.
 */
async function findFileContaining(dir: string, needle: string): Promise<string> {
  for (const [path, contents] of await snapshotTree(dir)) {
    if (contents.includes(needle)) return join(dir, path);
  }
  throw new Error(`No file under ${dir} contains ${JSON.stringify(needle)}`);
}

/** Every file under `dir`, as `relative path -> contents`. */
async function snapshotTree(dir: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  async function walk(current: string): Promise<void> {
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.set(relative(dir, full).replace(/\\/g, "/"), await readFile(full, "utf-8"));
    }
  }
  await walk(dir);
  return files;
}

describe("POST /api/rex/apply-refinements", () => {
  let tmpDir: string;
  let rexDir: string;
  let treeDir: string;
  let ctx: ServerContext;
  let http: RouteTestServer;
  let broadcasts: string[];
  let holder: ChildProcess | null = null;

  /**
   * Build proposals the way the Ask endpoint does — from a model answer parsed
   * against the document on disk. Hand-writing them would let the test agree
   * with itself about a fingerprint the real path never produces.
   */
  async function proposalsFrom(raw: unknown[]): Promise<RefinementProposal[]> {
    const store = await resolveStore(rexDir);
    const doc = await store.loadDocument();
    const answer = `Prose.\n\n\`\`\`${REFINEMENT_FENCE_TAG}\n${JSON.stringify(raw)}\n\`\`\``;
    const parsed = parseAnswerRefinements(answer, doc);
    expect(parsed.notes).toEqual([]);
    return parsed.proposals;
  }

  async function post(body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const res = await fetch(`${http.baseUrl}/api/rex/apply-refinements`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let json: Record<string, unknown> = {};
    try {
      json = await res.json() as Record<string, unknown>;
    } catch {
      json = {};
    }
    return { status: res.status, json };
  }

  async function readBack(): Promise<PRDDocument> {
    return (await resolveStore(rexDir)).loadDocument();
  }

  function find(doc: PRDDocument, id: string): PRDItem | undefined {
    const stack = [...doc.items];
    while (stack.length > 0) {
      const item = stack.pop()!;
      if (item.id === id) return item;
      if (item.children) stack.push(...item.children);
    }
    return undefined;
  }

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "prd-refine-"));
    rexDir = join(tmpDir, ".rex");
    treeDir = join(rexDir, "prd_tree");
    await mkdir(rexDir, { recursive: true });
    // Seed through the store so the on-disk shape is the real folder tree,
    // not a fixture that happens to parse.
    await (await resolveStore(rexDir)).saveDocument(makeDoc());

    ctx = { projectDir: tmpDir, svDir: join(tmpDir, ".sourcevision"), rexDir, dev: false };
    broadcasts = [];
    http = await startRouteTestServer((req, res) => handleRexRoute(
      req,
      res,
      ctx,
      (message) => { broadcasts.push((message as { type: string }).type); },
    ));
  });

  afterEach(async () => {
    await http.close();
    if (holder) {
      holder.kill();
      holder = null;
    }
    await removeTestDir(tmpDir);
  });

  // ── Accept ───────────────────────────────────────────────────────

  it("applies an accepted edit to the folder tree", async () => {
    const proposals = await proposalsFrom([{
      op: "edit",
      itemId: "task-a",
      description: "A sharper description.",
      acceptanceCriteria: ["The panel renders", "The panel names its failure modes"],
      rationale: "The criteria did not say what done looks like.",
    }]);

    const { status, json } = await post({ proposals });
    expect(status).toBe(200);
    expect(json.applied).toBe(1);
    expect(json.refused).toBe(0);

    const item = find(await readBack(), "task-a");
    expect(item?.description).toBe("A sharper description.");
    expect(item?.acceptanceCriteria).toEqual([
      "The panel renders",
      "The panel names its failure modes",
    ]);
  });

  it("applies an accepted merge, removing the duplicate from the tree", async () => {
    const proposals = await proposalsFrom([{ op: "merge", itemId: "task-b", intoId: "task-a" }]);
    expect((await post({ proposals })).json.applied).toBe(1);

    const doc = await readBack();
    expect(find(doc, "task-b")).toBeUndefined();
    expect(find(doc, "task-a")?.acceptanceCriteria).toContain("The panel reports errors");
  });

  it("applies an accepted reparent, and the item's directory moves with it", async () => {
    const proposals = await proposalsFrom([{
      op: "reparent", itemId: "task-a", parentId: "epic-2",
    }]);
    expect((await post({ proposals })).json.applied).toBe(1);

    const doc = await readBack();
    expect(doc.items[0].children?.map((c) => c.id)).toEqual(["task-b"]);
    expect(doc.items[1].children?.map((c) => c.id)).toEqual(["task-a"]);
  });

  it("makes the change visible through the running server, with no restart", async () => {
    const proposals = await proposalsFrom([{
      op: "edit", itemId: "task-a", description: "Visible immediately.",
    }]);
    await post({ proposals });

    // Same server process, same in-flight caches. `refreshPRDCache` is what
    // makes this read see the write; without it the route would answer from
    // the snapshot taken before the mutation.
    const res = await fetch(`${http.baseUrl}/api/rex/prd`);
    const doc = await res.json() as PRDDocument;
    expect(find(doc, "task-a")?.description).toBe("Visible immediately.");
    // And the views that poll rather than re-read are told to.
    expect(broadcasts).toContain("rex:prd-changed");
  });

  // ── The lock ─────────────────────────────────────────────────────

  it("serializes against a concurrent writer instead of overwriting it", async () => {
    const proposals = await proposalsFrom([{
      op: "edit", itemId: "task-a", description: "The proposal's text.",
    }]);

    // A second writer takes the lock and rewrites the same item. The request
    // is issued while that lock is held, so if the route loaded the document
    // outside the transaction it would apply over the top of this change.
    const release = await acquireLock(prdLockPath(rexDir));
    const pending = post({ proposals });
    // The other writer's change, made on disk while the lock is held. Written
    // directly rather than through the store: the store's own save would
    // deadlock on the in-process mutex this test is already holding, and the
    // file is what a genuinely separate process would be editing anyway.
    const itemPath = await findFileContaining(treeDir, "Original description.");
    await writeFile(
      itemPath,
      (await readFile(itemPath, "utf-8"))
        .replace("Original description.", "The other writer's text."),
      "utf-8",
    );
    await release();

    const { status, json } = await pending;
    expect(status).toBe(200);
    // Refused, not applied: the fingerprint no longer matches what the user
    // reviewed, so the accept does not revert the concurrent writer's work.
    expect(json.applied).toBe(0);
    expect(json.refused).toBe(1);
    const outcomes = json.outcomes as Array<{ status: string; detail?: string }>;
    expect(outcomes[0].status).toBe("stale");
    expect(find(await readBack(), "task-a")?.description).toBe("The other writer's text.");
  });

  it("fails loudly, naming the holder, when another process holds the lock", async () => {
    // A real child process: the in-process mutex means a same-process holder
    // would queue and then succeed, which is the opposite of what this asserts.
    holder = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    expect(holder.pid).toBeGreaterThan(0);
    await writeFile(
      prdLockPath(rexDir),
      JSON.stringify({
        pid: holder.pid,
        token: "held-by-another-process",
        timestamp: new Date().toISOString(),
      }),
      "utf-8",
    );

    const proposals = await proposalsFrom([{
      op: "edit", itemId: "task-a", description: "Never written.",
    }]);
    const { status, json } = await post({ proposals });

    expect(status).toBe(409);
    // The PID is the single most useful fact in the failure, so it reaches the
    // panel rather than being flattened into wording of the route's own.
    expect(String(json.error)).toContain("Could not acquire PRD lock");
    expect(String(json.error)).toContain(`PID ${holder.pid}`);
    expect(find(await readBack(), "task-a")?.description).toBe("Original description.");
  }, LOCK_CONTENTION_TIMEOUT_MS);

  // ── Reject ───────────────────────────────────────────────────────

  it("writes nothing when no proposal is accepted: the tree is byte-identical", async () => {
    const before = await snapshotTree(treeDir);

    // The panel's reject path issues no request at all, so the strongest
    // server-side statement of the same criterion is that the endpoint refuses
    // an empty accept rather than opening a transaction that would re-serialize
    // the whole tree for no change.
    const { status } = await post({ proposals: [] });
    expect(status).toBe(400);

    const after = await snapshotTree(treeDir);
    expect([...after.keys()].sort()).toEqual([...before.keys()].sort());
    for (const [path, contents] of before) {
      expect(after.get(path)).toBe(contents);
    }
  });

  it("refuses a body that is not a proposal, without touching the tree", async () => {
    const before = await snapshotTree(treeDir);
    expect((await post({ proposals: [{ op: "edit", itemId: "task-a" }] })).status).toBe(400);
    expect((await post({ proposals: "not an array" })).status).toBe(400);

    const after = await snapshotTree(treeDir);
    for (const [path, contents] of before) {
      expect(after.get(path)).toBe(contents);
    }
  });

  // ── Batch behaviour ──────────────────────────────────────────────

  it("applies the valid half of a batch and reports the rest", async () => {
    const proposals = await proposalsFrom([
      { op: "edit", itemId: "task-a", priority: "high" },
      { op: "edit", itemId: "task-b", priority: "high" },
    ]);

    // task-a moves on behind the user's back; task-b does not.
    const store = await resolveStore(rexDir);
    await store.withTransaction(async (doc) => {
      find(doc, "task-a")!.description = "Changed by someone else.";
    });

    const { json } = await post({ proposals });
    expect(json.applied).toBe(1);
    expect(json.refused).toBe(1);

    const doc = await readBack();
    expect(find(doc, "task-a")?.priority).toBe("medium");
    expect(find(doc, "task-b")?.priority).toBe("high");
  });

  it("does not apply a proposal the caller never accepted", async () => {
    const all = await proposalsFrom([
      { op: "edit", itemId: "task-a", priority: "high" },
      { op: "edit", itemId: "task-b", priority: "high" },
    ]);

    // Only the first is posted, which is what the panel does per Accept press.
    await post({ proposals: [all[0]] });

    const doc = await readBack();
    expect(find(doc, "task-a")?.priority).toBe("high");
    expect(find(doc, "task-b")?.priority).toBe("low");
  });

  // ── The mutation itself, against the real store ──────────────────

  it("applyRefinements under withTransaction is the only write path used", async () => {
    // A direct exercise of the contract the route depends on: the document the
    // mutation sees is loaded inside the lock, so nothing can slip between the
    // read and the write.
    const proposals = await proposalsFrom([{
      op: "edit", itemId: "task-a", description: "Written under the lock.",
    }]);
    const store = await resolveStore(rexDir);
    const outcomes = await store.withTransaction(async (doc) => applyRefinements(doc, proposals));

    expect(outcomes.map((o) => o.status)).toEqual(["applied"]);
    expect(find(await readBack(), "task-a")?.description).toBe("Written under the lock.");
  });
});
