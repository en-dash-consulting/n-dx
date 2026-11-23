/**
 * The planned run queue's routes: `GET`/`PUT /api/hench/queue` over
 * `<hench dir>/run-queue.json`, the file `ndx work` reads (hench
 * `queue/run-queue.ts`). The format is the contract between the two.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";
import { handleHenchQueueRoute, parseQueueOrder, readQueueFile, RUN_QUEUE_MAX } from "../../../src/server/routes-hench-queue.js";
import type { ServerContext } from "../../../src/server/types.js";
import { startRouteTestServer, closeRouteTestServer } from "../../helpers/server-route-test-support.js";

let dir: string;
let ctx: ServerContext;
let server: Server;
let port: number;

const queueFile = () => join(dir, ".hench", "run-queue.json");

async function call(method: "GET" | "PUT", body?: unknown): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://127.0.0.1:${port}/api/hench/queue`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, body: await res.json() };
}

beforeEach(async () => {
  dir = realpathSync.native(await mkdtemp(join(tmpdir(), "hench-queue-route-")));
  const rexDir = join(dir, ".rex");
  await mkdir(join(rexDir, ".cache"), { recursive: true });
  await writeFile(join(rexDir, ".cache", "prd.json"), JSON.stringify({
    schema: "rex/v1",
    title: "queue",
    items: [{
      id: "e", title: "Epic", level: "epic", status: "pending",
      children: [
        { id: "t1", title: "First task", level: "task", status: "pending", priority: "high" },
        { id: "t2", title: "Second task", level: "task", status: "pending" },
      ],
    }],
  }));
  ctx = { projectDir: dir, svDir: join(dir, ".sourcevision"), rexDir, dev: false };
  const started = await startRouteTestServer((req, res) => handleHenchQueueRoute(req, res, ctx));
  server = started.server;
  port = started.port;
});

afterEach(async () => {
  await closeRouteTestServer(server);
  await rm(dir, { recursive: true, force: true });
});

describe("the run queue routes", () => {
  it("answers an empty queue before anything is saved", async () => {
    expect(await call("GET")).toEqual({ status: 200, body: { items: [] } });
  });

  it("saves the order, names each task from the PRD, and keeps when each was first added", async () => {
    const saved = await call("PUT", { taskIds: ["t2", "t1"] });
    expect(saved.status).toBe(200);
    expect(saved.body.items.map((i: { taskId: string; title: string }) => [i.taskId, i.title])).toEqual([["t2", "Second task"], ["t1", "First task"]]);
    expect(saved.body.items[1]).toMatchObject({ status: "pending", priority: "high" });
    const firstAdded = saved.body.items[0].addedAt;

    // The file is the one ndx work reads.
    const file = JSON.parse(await readFile(queueFile(), "utf-8"));
    expect(file).toMatchObject({ version: 1, items: [{ taskId: "t2" }, { taskId: "t1" }] });

    // Reordering keeps each item's addedAt.
    const reordered = await call("PUT", { taskIds: ["t1", "t2"] });
    expect(reordered.body.items.map((i: { taskId: string }) => i.taskId)).toEqual(["t1", "t2"]);
    expect(reordered.body.items[1].addedAt).toBe(firstAdded);
    expect((await call("GET")).body.items.map((i: { taskId: string }) => i.taskId)).toEqual(["t1", "t2"]);
  });

  it("marks a queued id no longer in the PRD as missing", async () => {
    const saved = await call("PUT", { taskIds: ["gone"] });
    expect(saved.body.items).toEqual([{ taskId: "gone", addedAt: expect.any(String), missing: true }]);
  });

  it("refuses a body that is not a list of ids, or too long a queue, and writes nothing", async () => {
    expect((await call("PUT", { taskIds: "t1" })).status).toBe(400);
    expect((await call("PUT", { taskIds: [1] })).status).toBe(400);
    expect((await call("PUT", { taskIds: Array.from({ length: RUN_QUEUE_MAX + 1 }, (_, i) => `t${i}`) })).status).toBe(400);
    expect(readQueueFile(queueFile())).toEqual([]);
  });

  it("refuses a save made over a stale order with 409 and the queue as it stands, writing nothing", async () => {
    await call("PUT", { taskIds: ["t1", "t2"] });
    // ndx work took t1 after this client read [t1, t2].
    await call("PUT", { taskIds: ["t2"], base: ["t1", "t2"] });
    const stale = await call("PUT", { taskIds: ["t1"], base: ["t1", "t2"] });
    expect(stale.status).toBe(409);
    expect(stale.body.items.map((i: { taskId: string }) => i.taskId)).toEqual(["t2"]);
    expect(readQueueFile(queueFile()).map((i) => i.taskId)).toEqual(["t2"]);
    // A save over the order as it stands goes through.
    const fresh = await call("PUT", { taskIds: ["t2", "t1"], base: ["t2"] });
    expect(fresh.status).toBe(200);
    expect(readQueueFile(queueFile()).map((i) => i.taskId)).toEqual(["t2", "t1"]);
    expect((await call("PUT", { taskIds: [], base: "t2" })).status).toBe(400);
  });

  it("parses an order by trimming, dropping blanks and keeping the first of each id", () => {
    expect(parseQueueOrder({ taskIds: [" a ", "b", "a", ""] })).toEqual(["a", "b"]);
    expect(parseQueueOrder({})).toBeNull();
    expect(parseQueueOrder(null)).toBeNull();
  });
});
