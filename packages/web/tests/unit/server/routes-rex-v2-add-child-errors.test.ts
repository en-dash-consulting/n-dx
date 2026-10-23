/**
 * Adding a task under a v2 change answers as PATCH does when the write fails:
 * a held PRD lock is 409 and names the holder, rex's refusal is 400, and
 * anything unexpected (an I/O failure) is 500, not a client error.
 *
 * Its own file because it mocks the gateway for the whole worker.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { cpSync, mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleRexRoute } from "../../../src/server/routes-rex/index.js";
import { closeRouteTestServer } from "../../helpers/server-route-test-support.js";

const failure = vi.hoisted(() => ({ error: new Error("unset") as Error }));

vi.mock("../../../src/server/rex-gateway.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/server/rex-gateway.js")>()),
  addChangeNode: vi.fn(() => {
    throw failure.error;
  }),
}));

const FIXTURE = resolve(__dirname, "../../../../rex/tests/fixtures/v2-tree");
const CHANGE_ID = "c0000000-0000-4000-8000-000000000001";

const named = (name: string, message: string): Error => Object.assign(new Error(message), { name });

describe("POST /items under a v2 change when the write fails", () => {
  let tmpDir: string;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "rex-v2-add-child-errors-"));
    const rexDir = join(tmpDir, ".rex");
    const svDir = join(tmpDir, ".sourcevision");
    mkdirSync(svDir, { recursive: true });
    cpSync(FIXTURE, rexDir, { recursive: true });
    const ctx: ServerContext = { projectDir: tmpDir, svDir, rexDir, dev: false };
    server = createServer(async (req, res) => {
      if (!(await handleRexRoute(req, res, ctx))) {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/api/rex`;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  const addTask = () =>
    fetch(`${base}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Wire Apple Pay", parentId: CHANGE_ID }),
    });

  it.each([
    ["a held PRD lock", new Error("Could not acquire PRD lock within 10000ms. Held by PID 4242."), 409, "PID 4242"],
    ["rex's refusal", named("AddChangeNodeError", "A task does not carry amends"), 400, "does not carry"],
    ["a closed change", named("ClosedChangeError", "Change c1 is completed"), 400, "completed"],
    ["an I/O failure", Object.assign(new Error("EPERM: operation not permitted, rename"), { code: "EPERM" }), 500, "EPERM"],
  ])("answers %s with its status and message", async (_case, error, status, text) => {
    failure.error = error;
    const res = await addTask();
    expect(res.status).toBe(status);
    expect((await res.json()).error).toContain(text);
  });
});
