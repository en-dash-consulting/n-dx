/**
 * GET /api/rex/validate on a v2 tree adds rex's release-plans check, the one
 * `rex validate` runs, plus the time the check ran.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cp, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { createServer, type Server } from "node:http";
import { handleValidationRoute } from "../../../src/server/routes-validation.js";
import { closeRouteTestServer } from "../../helpers/server-route-test-support.js";

const FIXTURE = resolve(__dirname, "../../../../rex/tests/fixtures/v2-tree");
const SHIPPED = "c0000000-0000-4000-8000-0000000000aa";

describe("GET /api/rex/validate on a v2 tree", () => {
  let tmpDir: string;
  let server: Server;
  let base: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "validation-v2-"));
    await mkdir(join(tmpDir, ".sourcevision"), { recursive: true });
    await cp(FIXTURE, join(tmpDir, ".rex"), { recursive: true });
    // The projection `ndx start` writes at boot; the route's v1 checks read it.
    await mkdir(join(tmpDir, ".rex", ".cache"), { recursive: true });
    await writeFile(join(tmpDir, ".rex", ".cache", "prd.json"), JSON.stringify({ schema: "rex/v1", title: "Shop", items: [] }));
    const ctx = { projectDir: tmpDir, svDir: join(tmpDir, ".sourcevision"), rexDir: join(tmpDir, ".rex"), dev: false };
    server = createServer(async (req, res) => {
      if (await handleValidationRoute(req, res, ctx)) return;
      res.writeHead(404);
      res.end("Not found");
    });
    await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
    const addr = server.address();
    base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    await rm(tmpDir, { recursive: true, force: true });
  });

  /** An applied change that shipped in `release`; the fixture's open change is planned for 1.2.0. */
  async function shipChange(release: string): Promise<void> {
    const dir = join(tmpDir, ".rex", "changes", "shipped-wallets");
    await mkdir(dir);
    await writeFile(
      join(dir, "index.md"),
      `---\nid: "${SHIPPED}"\ntype: "change"\ntitle: "Shipped wallets"\nslug: "shipped-wallets"\ntouches: ["a0000000-0000-4000-8000-000000000002"]\n---\n`,
    );
    await writeFile(
      join(dir, "state.yaml"),
      `schema: "rex/v2"\nitems:\n  "${SHIPPED}":\n    status: "completed"\n    completedAt: "2026-10-01T00:00:00.000Z"\n    appliedAt: "2026-10-01T00:00:00.000Z"\n    shippedIn: "${release}"\n`,
    );
  }

  const validate = async () => (await fetch(`${base}/api/rex/validate`)).json() as Promise<{
    ok: boolean;
    ranAt: string;
    checks: Array<{ name: string; pass: boolean; severity?: string; errors: Array<{ itemId?: string; message: string }> }>;
  }>;

  it("passes the release-plans check while nothing planned has shipped, and stamps when it ran", async () => {
    const body = await validate();
    expect(body.checks.find((c) => c.name === "release plans")).toMatchObject({ pass: true, errors: [] });
    expect(Number.isNaN(Date.parse(body.ranAt))).toBe(false);
  });

  it("warns, without failing, for an open change planned for a shipped release", async () => {
    await shipChange("1.2.0");
    const body = await validate();
    const check = body.checks.find((c) => c.name === "release plans")!;
    expect(check).toMatchObject({ pass: false, severity: "warn" });
    expect(check.errors).toHaveLength(1);
    expect(check.errors[0]!.message).toContain("1.2.0");
    expect(body.ok).toBe(true);
  });
});
