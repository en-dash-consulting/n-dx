/**
 * A hub missing its n-dx binary or CLI repairs what it can itself and reports
 * the rest, instead of telling the operator to restart it.
 *
 * - With no `--ndx-cli`, the hub finds `@n-dx/core`'s `cli.js` beside its own
 *   package; with none there, `/x/<name>/` and `/api/hub/extensions` answer
 *   503 naming the fault, and `/api/hub/health` reports `no-ndx-cli` so the
 *   next `ndx start` replaces the hub with one that has it.
 * - With no binary for project servers, the hub looks again before each start
 *   and on each health check, so a server it could not start before starts
 *   once the binary is there; until then health reports `no-ndx-bin`.
 *
 * Every hub here runs in a temporary home on an OS-assigned port.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NO_NDX_BIN, NO_NDX_CLI, resolveNdxCli, startHub } from "../../src/hub/index.js";
import type { HubHandle } from "../../src/hub/index.js";
import { removeTempDir } from "../helpers/temp-dir.js";

let dir: string;
const hubs: HubHandle[] = [];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ndx-hub-faults-"));
});

afterEach(async () => {
  while (hubs.length) await hubs.pop()!.close({ stopChildren: true });
  await removeTempDir(dir);
});

function writePackage(root: string, name: string, files: string[]): void {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "package.json"), JSON.stringify({ name }));
  for (const file of files) {
    mkdirSync(join(root, file, ".."), { recursive: true });
    writeFileSync(join(root, file), "");
  }
}

async function json(port: number, path: string, init?: RequestInit): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${port}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

/** Neither message may send the operator to stop or start the hub by hand. */
function expectNoRestartAdvice(text: string): void {
  expect(text).not.toMatch(/ndx hub stop/);
  expect(text).not.toMatch(/\brestart\b/i);
}

describe("resolveNdxCli", () => {
  it("uses the CLI it was given", () => {
    expect(resolveNdxCli("/given/cli.js", join(dir, "web"))).toBe("/given/cli.js");
  });

  it("finds @n-dx/core beside the web package, in a checkout or a flat install", () => {
    writePackage(join(dir, "packages", "web"), "@n-dx/web", []);
    writePackage(join(dir, "packages", "core"), "@n-dx/core", ["cli.js"]);
    expect(resolveNdxCli(undefined, join(dir, "packages", "web"))).toBe(join(dir, "packages", "web", "..", "core", "cli.js"));
  });

  it("finds the @n-dx/core package this web package is installed under", () => {
    const core = join(dir, "node_modules", "@n-dx", "core");
    writePackage(core, "@n-dx/core", ["cli.js"]);
    const web = join(core, "node_modules", "@n-dx", "web");
    writePackage(web, "@n-dx/web", []);
    expect(resolveNdxCli(undefined, web)).toBe(join(web, "..", "..", "..", "cli.js"));
  });

  it("takes nothing that is not @n-dx/core, and nothing at all for an explicit null", () => {
    writePackage(join(dir, "packages", "web"), "@n-dx/web", []);
    writePackage(join(dir, "packages", "core"), "impostor", ["cli.js"]);
    expect(resolveNdxCli(undefined, join(dir, "packages", "web"))).toBe("");
    expect(resolveNdxCli(null, join(dir, "packages", "web"))).toBe("");
  });
});

describe("a hub missing its n-dx CLI and binary", () => {
  it("reports both faults on health, says what happens next, and picks up a binary that appears", async () => {
    const webRoot = join(dir, "late", "web");
    const bin = join(webRoot, "dist", "cli", "index.js");
    const hub = await startHub({
      port: 0,
      homeDir: join(dir, "home"),
      keepAlive: true,
      healthIntervalMs: 60_000,
      ndxCli: null,
      selfBin: bin,
    });
    hubs.push(hub);

    const health = await json(hub.port, "/api/hub/health");
    expect(health.body.faults).toEqual(["no-ndx-bin", "no-ndx-cli"]);

    const extensions = await json(hub.port, "/api/hub/extensions");
    expect(extensions.status).toBe(503);
    expect(extensions.body.error).toBe(NO_NDX_CLI);
    expectNoRestartAdvice(NO_NDX_CLI);
    expectNoRestartAdvice(NO_NDX_BIN);

    const repo = join(dir, "repo");
    mkdirSync(repo);
    const refused = await json(hub.port, "/api/hub/projects", { method: "POST", body: JSON.stringify({ id: "alpha", repoRoot: repo }) });
    expect(refused.status).toBe(400);
    expectNoRestartAdvice(String(refused.body.error));

    // The binary appears (a rebuild finished): the hub finds it without a restart.
    writePackage(webRoot, "@n-dx/web", ["dist/cli/index.js"]);
    const after = await json(hub.port, "/api/hub/health");
    expect(after.body.faults).toEqual(["no-ndx-cli"]);
  });

  it("reports only what is missing", async () => {
    const hub = await startHub({
      port: 0,
      homeDir: join(dir, "home"),
      keepAlive: true,
      healthIntervalMs: 60_000,
      ndxCli: "/some/cli.js",
      selfBin: join(dir, "nope", "dist", "cli", "index.js"),
    });
    hubs.push(hub);
    // Only the binary is missing here.
    expect((await json(hub.port, "/api/hub/health")).body.faults).toEqual(["no-ndx-bin"]);
  });
});
