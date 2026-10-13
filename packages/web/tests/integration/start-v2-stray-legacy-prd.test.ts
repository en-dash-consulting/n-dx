/**
 * Startup on a v2 project holding a stray `.rex/prd.json`: the migration step
 * `startServer` runs (`ensureLegacyPrdMigrated`, through the rex gateway) must
 * leave the tree alone — no prd_tree/ beside product/ — and /api/rex/prd must
 * keep serving the v2 titles.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";

import { ensureLegacyPrdMigrated } from "../../src/server/rex-gateway.js";
import { refreshPRDCache } from "../../src/server/start.js";
import { handleRexRoute } from "../../src/server/routes-rex/index.js";
import type { ServerContext } from "../../src/server/types.js";
import { closeRouteTestServer } from "../helpers/server-route-test-support.js";

const FIXTURE = resolve(__dirname, "../../../rex/tests/fixtures/v2-tree");

interface Item { title: string; children?: Item[] }
const flatten = (items: Item[]): string[] => items.flatMap((i) => [i.title, ...flatten(i.children ?? [])]);

describe("startup migration on a v2 project with a stray prd.json", () => {
  let tmpDir: string;
  let rexDir: string;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "start-v2-stray-"));
    rexDir = join(tmpDir, ".rex");
    const svDir = join(tmpDir, ".sourcevision");
    mkdirSync(svDir, { recursive: true });
    cpSync(FIXTURE, rexDir, { recursive: true });
    writeFileSync(
      join(rexDir, "prd.json"),
      JSON.stringify({
        schema: "rex/v1",
        title: "stale",
        items: [{ id: "c0000000-0000-4000-8000-000000000001", title: "STALE v1 title", level: "epic", status: "completed" }],
      }),
    );

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

  it("creates no prd_tree/ and serves the v2 titles", async () => {
    const result = await ensureLegacyPrdMigrated(tmpDir);
    expect(result).toEqual({ migrated: false, reason: "v2-layout" });
    expect(existsSync(join(rexDir, "prd_tree"))).toBe(false);
    expect(existsSync(join(rexDir, "prd.json"))).toBe(true);

    await refreshPRDCache(rexDir);
    const res = await fetch(`${base}/prd`);
    expect(res.status).toBe(200);
    const doc = (await res.json()) as { items: Item[] };
    const titles = flatten(doc.items);
    expect(titles.length).toBeGreaterThan(0);
    expect(titles).not.toContain("STALE v1 title");
    expect(existsSync(join(rexDir, "prd_tree"))).toBe(false);
  });
});
