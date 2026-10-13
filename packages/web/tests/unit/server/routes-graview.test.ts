/**
 * The product map's routes: GET reports a running face (read from the
 * `face.json` the face writes) and never starts one; POST starts
 * `ndx graview serve` only with `features.graview.productFace` on.
 *
 * The launch runs a stand-in for `ndx` (NDX_CLI_PATH) that records a face the
 * way `@n-dx/graview-face`'s bin/serve.js does and stays up until signalled.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { resolveLayout } from "@n-dx/llm-client";
import type { ServerContext } from "../../../src/server/types.js";
import { handleGraviewRoute, readRunningFace, shutdownGraviewFace } from "../../../src/server/routes-graview.js";
import { startRouteTestServer, removeTestDir, type RouteTestServer } from "../../helpers/server-route-test-support.js";

const FAKE_NDX = `
import { writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
const dir = process.env.FAKE_FACE_DIR;
const file = join(dir, "face.json");
writeFileSync(file, JSON.stringify({ url: "http://localhost:5199/", pid: process.pid }));
const stop = () => { rmSync(file, { force: true }); process.exit(0); };
process.on("SIGTERM", stop);
setInterval(() => {}, 1000);
`;

describe("graview face routes", () => {
  let dir: string;
  let graviewDir: string;
  let ctx: ServerContext;
  let srv: RouteTestServer;
  const savedCli = process.env["NDX_CLI_PATH"];

  async function setFlag(on: boolean): Promise<void> {
    await writeFile(join(dir, ".n-dx.json"), JSON.stringify({ features: { graview: { productFace: on } } }));
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "routes-graview-"));
    graviewDir = resolveLayout(dir).graviewDir;
    await mkdir(graviewDir, { recursive: true });
    ctx = { projectDir: dir, svDir: join(dir, ".sourcevision"), rexDir: join(dir, ".rex"), dev: false };
    srv = await startRouteTestServer((req, res) => handleGraviewRoute(req, res, ctx));
  });

  afterEach(async () => {
    await shutdownGraviewFace();
    await srv.close();
    if (savedCli === undefined) delete process.env["NDX_CLI_PATH"];
    else process.env["NDX_CLI_PATH"] = savedCli;
    delete process.env["FAKE_FACE_DIR"];
    await removeTestDir(dir);
  });

  it("reports no face and the flag off by default", async () => {
    const res = await fetch(`${srv.baseUrl}/api/graview/face`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ face: null, enabled: false, starting: false, error: null });
  });

  it("links a face started by hand, flag or not, and ignores a dead one", async () => {
    await writeFile(join(graviewDir, "face.json"), JSON.stringify({ url: "http://localhost:5190/", pid: process.pid }));
    const body = await (await fetch(`${srv.baseUrl}/api/graview/face`)).json();
    expect(body.face).toEqual({ url: "http://localhost:5190/" });
    expect(readRunningFace(graviewDir, () => false)).toBeNull();
  });

  it("refuses to start a face with the flag off, naming the flag", async () => {
    const res = await fetch(`${srv.baseUrl}/api/graview/face`, { method: "POST" });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.kind).toBe("feature_disabled");
    expect(body.feature).toBe("graview.productFace");
  });

  it("starts ndx graview serve with the flag on, and stops the face it started", async () => {
    await setFlag(true);
    const fake = join(dir, "fake-ndx.mjs");
    await writeFile(fake, FAKE_NDX);
    process.env["NDX_CLI_PATH"] = fake;
    process.env["FAKE_FACE_DIR"] = graviewDir;

    const started = await fetch(`${srv.baseUrl}/api/graview/face`, { method: "POST" });
    expect(started.status).toBe(202);
    expect((await started.json()).enabled).toBe(true);

    let body: { face: { url: string } | null } = { face: null };
    for (let i = 0; i < 50 && !body.face; i++) {
      await new Promise((r) => setTimeout(r, 100));
      body = await (await fetch(`${srv.baseUrl}/api/graview/face`)).json();
    }
    expect(body.face).toEqual({ url: "http://localhost:5199/" });

    // A second POST while it runs starts nothing new.
    expect((await (await fetch(`${srv.baseUrl}/api/graview/face`, { method: "POST" })).json()).face).toEqual({ url: "http://localhost:5199/" });

    await shutdownGraviewFace();
    expect(existsSync(join(graviewDir, "face.json"))).toBe(false);
  });
});
