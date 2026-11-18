/**
 * POST /api/rex/items/:id/attachments stores images in the change's folder on
 * a v2 project, through rex's attachImages. A file that is not the image it
 * claims to be, or an item with no folder, is a 400 and writes nothing.
 *
 * Tree: rex's v2 fixture, whose change "Add Apple Pay" is a folder.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";

import type { ServerContext } from "../../src/server/types.js";
import { refreshPRDCache } from "../../src/server/start.js";
import { handleRexRoute } from "../../src/server/routes-rex/index.js";
import { closeRouteTestServer } from "../helpers/server-route-test-support.js";

const FIXTURE = resolve(__dirname, "../../../rex/tests/fixtures/v2-tree");
const CHANGE = "c0000000-0000-4000-8000-000000000001";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 7, 7]);

let tmpDir: string;
let changeDir: string;
let server: Server;
let port: number;

beforeAll(async () => {
  tmpDir = mkdtempSync(join(tmpdir(), "item-attach-"));
  const rexDir = join(tmpDir, ".rex");
  const svDir = join(tmpDir, ".sourcevision");
  cpSync(FIXTURE, rexDir, { recursive: true });
  mkdirSync(svDir, { recursive: true });
  changeDir = join(rexDir, "changes", "add-apple-pay");
  await refreshPRDCache(rexDir);

  const ctx: ServerContext = { projectDir: tmpDir, svDir, rexDir, dev: false };
  server = createServer(async (req, res) => {
    if (await handleRexRoute(req, res, ctx)) return;
    res.writeHead(404);
    res.end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  port = typeof addr === "object" && addr ? addr.port : 0;
});

afterAll(async () => {
  await closeRouteTestServer(server);
  rmSync(tmpDir, { recursive: true, force: true });
});

const attach = (id: string, images: unknown) =>
  fetch(`http://127.0.0.1:${port}/api/rex/items/${id}/attachments`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images }),
  });

describe("POST /api/rex/items/:id/attachments", () => {
  it("writes the image into the change's folder and names the file", async () => {
    const res = await attach(CHANGE, [{ name: "Checkout Mock.png", mediaType: "image/png", data: PNG.toString("base64") }]);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, files: ["checkout-mock.png"] });
    expect(readFileSync(join(changeDir, "checkout-mock.png"))).toEqual(PNG);
  });

  it("answers 400 and writes nothing for a file that is not the image it claims", async () => {
    const before = readdirSync(changeDir);
    const res = await attach(CHANGE, [{ name: "fake.png", mediaType: "image/png", data: Buffer.from("hello").toString("base64") }]);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/not a image\/png file/);
    expect(readdirSync(changeDir)).toEqual(before);
  });

  it("answers 400 for an item with no folder, and for a body with no images", async () => {
    const missing = await attach("no-such-item", [{ name: "a.png", mediaType: "image/png", data: PNG.toString("base64") }]);
    expect(missing.status).toBe(400);
    expect((await missing.json()).error).toMatch(/no folder/);
    expect((await attach(CHANGE, [])).status).toBe(400);
    expect(existsSync(join(changeDir, "a.png"))).toBe(false);
  });
});
