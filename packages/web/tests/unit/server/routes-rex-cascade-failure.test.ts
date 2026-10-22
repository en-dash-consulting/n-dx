/**
 * A parent cascade that fails after the status write must not fail the close.
 *
 * The task's own transaction has committed by the time the cascade runs, so
 * answering 409 (a writer holding the PRD lock past its timeout is enough)
 * told the dashboard the close had not happened when it had. The route
 * answers 200 with the task saved and says which part did not land.
 *
 * Its own file because it mocks the gateway for the whole worker.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleRexRoute } from "../../../src/server/routes-rex/index.js";
import { serializeDocument, resolveStore } from "@n-dx/rex";
import { closeRouteTestServer } from "../../helpers/server-route-test-support.js";

vi.mock("../../../src/server/rex-gateway.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/server/rex-gateway.js")>()),
  cascadeParentCompletion: vi.fn(async () => {
    throw new Error("Could not acquire PRD lock within 10000ms. Held by PID 4242.");
  }),
}));

const PRD = {
  schema: "rex/v1",
  title: "T",
  items: [{
    id: "epic-1", title: "Epic", status: "pending", level: "epic",
    children: [{ id: "task-1", title: "Only task", status: "in_progress", level: "task" }],
  }],
};

describe("a failed parent cascade", () => {
  let tmpDir: string;
  let rexDir: string;
  let server: Server;
  let port: number;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-cascade-fail-"));
    rexDir = join(tmpDir, ".rex");
    await mkdir(join(tmpDir, ".sourcevision"), { recursive: true });
    await mkdir(rexDir, { recursive: true });
    await writeFile(join(rexDir, "prd.md"), serializeDocument(PRD as never));
    const ctx: ServerContext = { projectDir: tmpDir, svDir: join(tmpDir, ".sourcevision"), rexDir, dev: false };
    server = createServer(async (req, res) => {
      if (!(await handleRexRoute(req, res, ctx))) {
        res.writeHead(404);
        res.end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    port = (server.address() as { port: number }).port;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  const readStatus = async (id: string) => {
    const doc = await (await resolveStore(rexDir)).loadDocument();
    const walk = (items: typeof doc.items): string | undefined => {
      for (const item of items) {
        if (item.id === id) return item.status;
        const found = walk(item.children ?? []);
        if (found) return found;
      }
      return undefined;
    };
    return walk(doc.items);
  };

  it("still answers 200 for the single PATCH, saves the task, and names what did not close", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/rex/items/task-1`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "completed" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.autoCompleteError).toMatch(/Could not acquire PRD lock/);
    expect(await readStatus("task-1")).toBe("completed");
    expect(await readStatus("epic-1")).toBe("pending");
  });

  it("still answers 200 for the bulk route, with the error beside the results", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/rex/items/bulk`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids: ["task-1"], updates: { status: "completed" } }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results).toEqual([{ id: "task-1", ok: true }]);
    expect(body.autoCompleteError).toMatch(/Could not acquire PRD lock/);
    expect(await readStatus("task-1")).toBe("completed");
  });
});
