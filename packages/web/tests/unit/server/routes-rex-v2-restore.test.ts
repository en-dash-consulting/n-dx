/**
 * Restore routes on a v2 project: a v1 snapshot in .rex/.backups must neither
 * be listed nor restored — restoring one would split the tree.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cpSync, existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleRexRoute } from "../../../src/server/routes-rex/index.js";
import { closeRouteTestServer } from "../../helpers/server-route-test-support.js";

const FIXTURE = resolve(__dirname, "../../../../rex/tests/fixtures/v2-tree");
const SNAPSHOT_ID = "2026-08-25T22-01-32.215Z";
const REFUSAL = "Restore is v1-only until after the v2 cut; recover a v2 tree from git history.";

describe("Rex restore routes on a v2 project", () => {
  let tmpDir: string;
  let rexDir: string;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "rex-v2-restore-"));
    rexDir = join(tmpDir, ".rex");
    const svDir = join(tmpDir, ".sourcevision");
    mkdirSync(svDir, { recursive: true });
    cpSync(FIXTURE, rexDir, { recursive: true });
    const snapshot = join(rexDir, ".backups", `prd_tree_${SNAPSHOT_ID}`, "old-epic");
    mkdirSync(snapshot, { recursive: true });
    writeFileSync(join(snapshot, "index.md"), "---\nid: old\n---\n# Old epic\n");

    const ctx: ServerContext = { projectDir: tmpDir, svDir, rexDir, dev: false };
    server = createServer(async (req, res) => {
      const handled = await handleRexRoute(req, res, ctx);
      if (!handled) {
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

  it("POST /restore answers 409 V2_RESTORE_REFUSED and writes no prd_tree", async () => {
    const res = await fetch(`${base}/restore`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: SNAPSHOT_ID, confirmFiles: 1 }),
    });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, code: "V2_RESTORE_REFUSED", error: REFUSAL });
    expect(existsSync(join(rexDir, "prd_tree"))).toBe(false);
  });

  it("GET /backups answers 409 V2_RESTORE_REFUSED", async () => {
    const res = await fetch(`${base}/backups`);
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ ok: false, code: "V2_RESTORE_REFUSED", error: REFUSAL });
  });
});
