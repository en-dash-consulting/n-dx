/**
 * The dashboard's PRD writes must leave their items looking modified.
 *
 * Three routes mutate the folder tree directly inside `store.withTransaction`
 * rather than through the store's single-item methods: bulk update and merge
 * (`routes-rex/items.ts`) and the Ask panel's apply-refinements
 * (`routes-rex/refinements.ts`). None of them stamped `lastModified`, so the
 * item was written to disk looking untouched.
 *
 * That is not a cosmetic gap. `isModifiedSinceSync` (packages/rex/src/core/sync.ts)
 * asks whether `lastModified > lastSyncedAt`; a previously-synced item whose
 * stamp never advanced answers "no", so the change is skipped on push and then
 * overwritten by the remote's value on the next pull. Silent in both
 * directions, on any project configured with a remote adapter.
 *
 * So these assertions are deliberately about the comparison, not about
 * presence: each item is seeded already synced, and the test asserts the write
 * left it *newer than its last sync*. Asserting only that `lastModified` is a
 * string would pass against the bug, because these items already had one.
 *
 * The stamp itself lives in `withTransaction` (both stores), not in the
 * routes — see packages/rex/src/core/sync.ts's `stampChangedItems`. These tests
 * are here rather than in rex because the acceptance criterion is about these
 * three endpoints, and a store-tier fix that failed to reach one of them would
 * pass the rex tests and still leave the dashboard silently unsynced.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveStore } from "@n-dx/rex";
import type { ServerContext } from "../../src/server/types.js";
import { handleRexRoute } from "../../src/server/routes-rex/index.js";
import {
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

/** A stamp far enough in the past that any real write sorts after it. */
const SYNCED_AT = "2020-01-01T00:00:00.000Z";

/**
 * Two mergeable sibling tasks, each seeded as already synced.
 *
 * `lastModified === lastSyncedAt` is the state the bug is invisible in: the
 * item has a stamp, so a presence check passes, but `isModifiedSinceSync`
 * returns false and the item never pushes.
 */
function makeDoc(): PRDDocument {
  const synced = { lastModified: SYNCED_AT, lastSyncedAt: SYNCED_AT };
  return {
    schema: "rex/v1",
    title: "Test Project",
    items: [
      {
        id: "epic-1",
        title: "Epic One",
        level: "epic",
        status: "pending",
        ...synced,
        children: [
          {
            id: "task-a",
            title: "Add the Ask panel",
            level: "task",
            status: "pending",
            priority: "medium",
            description: "Original description.",
            acceptanceCriteria: ["The panel renders"],
            ...synced,
          },
          {
            id: "task-b",
            title: "Add an Ask panel",
            level: "task",
            status: "pending",
            priority: "low",
            description: "A duplicate of the one above.",
            acceptanceCriteria: ["The panel renders", "The panel reports errors"],
            ...synced,
          },
        ],
      },
    ] as PRDItem[],
  };
}

describe("dashboard PRD writes stamp lastModified", () => {
  let tmpDir: string;
  let rexDir: string;
  let ctx: ServerContext;
  let http: RouteTestServer;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "prd-stamp-"));
    rexDir = join(tmpDir, ".rex");
    await mkdir(rexDir, { recursive: true });
    // Seeded through the store so the on-disk shape is the real folder tree.
    await (await resolveStore(rexDir)).saveDocument(makeDoc());

    ctx = { projectDir: tmpDir, svDir: join(tmpDir, ".sourcevision"), rexDir, dev: false };
    http = await startRouteTestServer((req, res) => handleRexRoute(req, res, ctx, () => {}));
  });

  afterEach(async () => {
    await http.close();
    await removeTestDir(tmpDir);
  });

  async function readItem(id: string): Promise<PRDItem> {
    const doc = await (await resolveStore(rexDir)).loadDocument();
    const stack = [...doc.items];
    while (stack.length > 0) {
      const item = stack.pop()!;
      if (item.id === id) return item as PRDItem;
      if (item.children) stack.push(...item.children);
    }
    throw new Error(`Item "${id}" is not in the tree`);
  }

  /** Assert the item now looks modified to the sync engine. */
  async function expectModifiedSinceSync(id: string): Promise<void> {
    const item = await readItem(id);
    expect(item.lastSyncedAt).toBe(SYNCED_AT);
    expect(
      (item.lastModified as string) > (item.lastSyncedAt as string),
      `"${id}" is not newer than its last sync: ${String(item.lastModified)}`,
    ).toBe(true);
    expect(item.lastModifiedBy).toBeTruthy();
  }

  async function request(
    path: string,
    method: string,
    body: unknown,
  ): Promise<{ status: number; json: Record<string, unknown> }> {
    const res = await fetch(`${http.baseUrl}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      json = {};
    }
    return { status: res.status, json };
  }

  it("bulk update leaves the items newer than their last sync", async () => {
    const { status } = await request("/api/rex/items/bulk", "PATCH", {
      ids: ["task-a", "task-b"],
      updates: { status: "in_progress" },
    });
    expect(status).toBe(200);

    await expectModifiedSinceSync("task-a");
    await expectModifiedSinceSync("task-b");
  });

  it("merge leaves the surviving item newer than its last sync", async () => {
    // The target is one of the source ids — validateMerge requires the set it
    // is given to include the survivor.
    const { status } = await request("/api/rex/items/merge", "POST", {
      sourceIds: ["task-a", "task-b"],
      targetId: "task-a",
    });
    expect(status).toBe(200);

    await expectModifiedSinceSync("task-a");
    // The parent lost a child, so its stored content changed too — the case
    // FolderTreeStore.removeItem already re-stamps the parent for by hand.
    await expectModifiedSinceSync("epic-1");
  });

  it("an applied refinement leaves the item newer than its last sync", async () => {
    const store = await resolveStore(rexDir);
    const doc = await store.loadDocument();
    const answer = `Prose.\n\n\`\`\`${REFINEMENT_FENCE_TAG}\n${JSON.stringify([
      { op: "edit", itemId: "task-a", description: "A sharper description." },
    ])}\n\`\`\``;
    const proposals: RefinementProposal[] = parseAnswerRefinements(answer, doc).proposals;
    expect(proposals).toHaveLength(1);

    const { status, json } = await request("/api/rex/apply-refinements", "POST", { proposals });
    expect(status).toBe(200);
    expect(json.applied).toBe(1);

    expect((await readItem("task-a")).description).toBe("A sharper description.");
    await expectModifiedSinceSync("task-a");
  });

  it("leaves an item no route touched alone", async () => {
    // The counterpart to the three above: a stamp applied to everything on
    // every write would satisfy them and would queue the untouched half of the
    // PRD for push on the next sync.
    await request("/api/rex/apply-refinements", "POST", {
      proposals: parseAnswerRefinements(
        `\`\`\`${REFINEMENT_FENCE_TAG}\n${JSON.stringify([
          { op: "edit", itemId: "task-a", description: "Only this one." },
        ])}\n\`\`\``,
        await (await resolveStore(rexDir)).loadDocument(),
      ).proposals,
    });

    expect((await readItem("task-b")).lastModified).toBe(SYNCED_AT);
  });
});
