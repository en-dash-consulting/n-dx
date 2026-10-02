import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { Server } from "node:http";
import type { ServerContext } from "../../../src/server/types.js";
import { handleTrustRoute } from "../../../src/server/routes-trust.js";
import { startRouteTestServer, closeRouteTestServer } from "../../helpers/server-route-test-support.js";

const WIDENED_GUARD = {
  blockedPaths: ["node_modules/**"],
  allowedCommands: ["npm", "bash", "curl"],
  commandTimeout: 30000,
  maxFileSize: 1048576,
  allowedGitSubcommands: ["status", "push"],
};

describe("trust routes", () => {
  let tmpDir: string;
  let home: string;
  let server: Server;
  let port: number;
  let savedHome: string | undefined;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "trust-routes-"));
    home = await mkdtemp(join(tmpdir(), "trust-home-"));
    // The trust store resolves the per-user directory from NDX_HOME.
    savedHome = process.env.NDX_HOME;
    process.env.NDX_HOME = home;
    await mkdir(join(tmpDir, ".hench"), { recursive: true });
    await writeFile(join(tmpDir, ".hench", "config.json"), JSON.stringify({ guard: WIDENED_GUARD }));
    const ctx: ServerContext = { projectDir: tmpDir, svDir: join(tmpDir, ".sourcevision"), rexDir: join(tmpDir, ".rex"), dev: false };
    ({ server, port } = await startRouteTestServer((req, res) => handleTrustRoute(req, res, ctx)));
  });

  afterEach(async () => {
    await closeRouteTestServer(server);
    if (savedHome === undefined) delete process.env.NDX_HOME;
    else process.env.NDX_HOME = savedHome;
    await rm(tmpDir, { recursive: true, force: true });
    await rm(home, { recursive: true, force: true });
  });

  it("GET /api/trust reports an untrusted widened repository without the trust-file path", async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/trust`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.state).toBe("untrusted");
    expect(body.restricted).toBe(true);
    expect(body.sources).toEqual([".hench/config.json"]);
    expect(body.findings.map((f: { code: string }) => f.code)).toContain("commands-added");
    expect("trustFile" in body).toBe(false);
    expect(typeof body.digest).toBe("string");
  });

  it("POST /api/trust/accept records trust in the user's home, and revoke forgets it", async () => {
    const accepted = await fetch(`http://127.0.0.1:${port}/api/trust/accept`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    expect(accepted.status).toBe(200);
    const after = await accepted.json();
    expect(after.state).toBe("trusted");
    expect(after.restricted).toBe(false);
    expect(typeof after.trustedAt).toBe("string");
    // Written outside the repository.
    expect(readdirSync(join(home, "trust")).length).toBe(1);
    expect(existsSync(join(tmpDir, ".hench", "trust"))).toBe(false);

    const revoked = await fetch(`http://127.0.0.1:${port}/api/trust/revoke`, { method: "POST" });
    expect((await revoked.json()).state).toBe("untrusted");
  });

  it("answers 405 for other methods and ignores unrelated paths", async () => {
    expect((await fetch(`http://127.0.0.1:${port}/api/trust`, { method: "DELETE" })).status).toBe(405);
    expect((await fetch(`http://127.0.0.1:${port}/api/trust/accept`)).status).toBe(405);
    expect((await fetch(`http://127.0.0.1:${port}/api/trusted`)).status).toBe(404);
  });
});
