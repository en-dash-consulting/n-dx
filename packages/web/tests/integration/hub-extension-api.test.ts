/**
 * Contract tests for the versioned hub API, `apiVersion` 1
 * (docs/architecture/extensions.md, "Versioned hub API"): `GET`/`POST
 * /api/hub/projects`, `GET /api/hub/extensions[?project=<id>]` and
 * `POST /api/hub/extensions/:name/stop`. Extensions build against these
 * shapes, so a field named here is removed or retyped only with an
 * `apiVersion` bump; new fields may be added.
 *
 * The extension list is injected, standing in for `ndx extensions list --json`
 * (core, tested in tests/unit/extensions-command.test.js); `ndxCliLister` is
 * exercised against a fake CLI that prints what core prints. Registration
 * starts a real project server, so this needs a fresh build.
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { assertFreshServerBuild } from "../helpers/built-server-guard.js";
import { EXTENSION_API_VERSION, ndxCliLister, startHub } from "../../src/hub/index.js";
import type { ExtensionListing, HubHandle, HubOptions, ListResult } from "../../src/hub/index.js";

const WEB_PKG = resolve(fileURLToPath(import.meta.url), "../../..");
const NDX_BIN = join(WEB_PKG, "dist/cli/index.js");

const SIDECAR = [
  `const http = require("node:http");`,
  `http.createServer((req, res) => { res.writeHead(200); res.end("ok"); })`,
  `  .listen(Number(process.env.PORT), "127.0.0.1");`,
].join("\n");

let dir: string;
let repo: string;
const hubs: HubHandle[] = [];

beforeAll(() => {
  assertFreshServerBuild();
});

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ndx-hub-ext-api-"));
  repo = mkdtempSync(join(tmpdir(), "ndx-hub-ext-api-repo-"));
  writeFileSync(join(dir, "serve.cjs"), SIDECAR);
});

afterEach(async () => {
  while (hubs.length) await hubs.pop()!.close({ stopChildren: true });
  rmSync(dir, { recursive: true, force: true });
  rmSync(repo, { recursive: true, force: true });
});

function listing(name: string, state: ExtensionListing["state"], extra: Partial<ExtensionListing> = {}): ExtensionListing {
  return {
    name,
    packageName: `ndx-${name}`,
    version: "1.0.0",
    source: "user",
    state,
    reason: state === "enabled" ? "" : `${name} is ${state}`,
    dir: `/extensions/node_modules/ndx-${name}`,
    manifest: {
      apiVersion: 1,
      name,
      displayName: name.toUpperCase(),
      ndxVersion: ">=0.0.0",
      sidecar: { bin: "serve.cjs", health: "/" },
      hub: { label: `${name} card` },
      projectLinks: [{ label: "Report", path: "/project/{projectId}?root={repoRoot}" }],
    },
    ...extra,
  };
}

const LISTED: ListResult = {
  ok: true,
  extensions: [
    listing("recon", "enabled"),
    listing("later", "disabled"),
    listing("future", "incompatible"),
    listing("broken", "invalid", { manifest: null }),
  ],
  errors: [],
};

async function hub(options: Partial<HubOptions> = {}): Promise<HubHandle> {
  const handle = await startHub({
    port: 0,
    homeDir: join(dir, "home"),
    keepAlive: true,
    healthIntervalMs: 60_000,
    supervisor: { portFileTimeoutMs: 30_000, stopGraceMs: 3_000 },
    listExtensions: async () => LISTED,
    sidecars: {
      plan: async (name) => ({
        ok: true,
        plan: {
          name,
          execPath: process.execPath,
          bin: join(dir, "serve.cjs"),
          cwd: dir,
          env: { ...process.env },
          health: "/",
          idleStopMinutes: 15,
          logFile: join(dir, "ext", name, "sidecar.log"),
        },
      }),
      memoryFloorBytes: 0,
      freeMemory: () => null,
      healthPollMs: 50,
    },
    ...options,
  });
  hubs.push(handle);
  return handle;
}

async function api(h: HubHandle, path: string, init?: RequestInit): Promise<{ status: number; body: any }> {
  const res = await fetch(`http://127.0.0.1:${h.port}${path}`, init);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

const PROJECT_KEYS = ["id", "name", "repoRoot", "worktrees", "ndxBin", "port", "pid", "lastSeen", "status"];
const STATUS_KEYS = ["state", "pid", "port", "attached", "respawns", "lastHealthAt", "lastError"];
const EXTENSION_KEYS = ["name", "packageName", "version", "source", "state", "reason", "compatible", "manifest", "mount", "sidecar"];

describe("apiVersion", () => {
  it("is 1", () => {
    expect(EXTENSION_API_VERSION).toBe(1);
  });
});

describe("GET and POST /api/hub/projects", () => {
  it("register and list with apiVersion and the documented project fields", async () => {
    const h = await hub();
    const created = await api(h, "/api/hub/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "alpha", repoRoot: repo, ndxBin: NDX_BIN, name: "Alpha" }),
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    expect(created.body.apiVersion).toBe(1);
    expect(Object.keys(created.body.project)).toEqual(expect.arrayContaining(PROJECT_KEYS));
    expect(Object.keys(created.body.project.status)).toEqual(expect.arrayContaining(STATUS_KEYS));
    expect(created.body.project).toMatchObject({ id: "alpha", name: "Alpha", repoRoot: repo, worktrees: [repo], ndxBin: NDX_BIN });

    const again = await api(h, "/api/hub/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "alpha", repoRoot: repo, ndxBin: NDX_BIN }),
    });
    expect(again.status).toBe(200);
    expect(again.body.apiVersion).toBe(1);

    const listed = await api(h, "/api/hub/projects");
    expect(listed.status).toBe(200);
    expect(listed.body.apiVersion).toBe(1);
    expect(listed.body.projects.map((p: { id: string }) => p.id)).toEqual(["alpha"]);
    expect(Object.keys(listed.body.projects[0])).toEqual(expect.arrayContaining(PROJECT_KEYS));
  });

  it("answers a bad registration with 400 and { error }", async () => {
    const h = await hub();
    const bad = await api(h, "/api/hub/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "alpha", repoRoot: "relative", ndxBin: NDX_BIN }),
    });
    expect(bad.status).toBe(400);
    expect(typeof bad.body.error).toBe("string");
  });
});

describe("GET /api/hub/extensions", () => {
  it("lists every extension with state, compatibility, mount and sidecar", async () => {
    const h = await hub();
    const { status, body } = await api(h, "/api/hub/extensions");
    expect(status).toBe(200);
    expect(body.apiVersion).toBe(1);
    expect(body.errors).toEqual([]);
    const byName = Object.fromEntries(body.extensions.map((e: { name: string }) => [e.name, e]));
    for (const e of body.extensions) {
      expect(Object.keys(e)).toEqual(expect.arrayContaining(EXTENSION_KEYS));
      expect(e).not.toHaveProperty("links");
    }
    expect(byName.recon).toMatchObject({
      state: "enabled",
      reason: "",
      compatible: true,
      mount: "/x/recon/",
      sidecar: { state: "stopped", recentCrashes: 0, lastError: null },
      manifest: { displayName: "RECON", hub: { label: "recon card" } },
    });
    expect(byName.later).toMatchObject({ state: "disabled", compatible: true });
    expect(byName.future).toMatchObject({ state: "incompatible", compatible: false, reason: "future is incompatible" });
    expect(byName.broken).toMatchObject({ state: "invalid", compatible: false, manifest: null, mount: null, sidecar: null });
  });

  it("reports a running sidecar", async () => {
    const h = await hub();
    expect((await fetch(`http://127.0.0.1:${h.port}/x/recon/`)).status).toBe(200);
    const { body } = await api(h, "/api/hub/extensions");
    const recon = body.extensions.find((e: { name: string }) => e.name === "recon");
    expect(recon.sidecar.state).toBe("running");
  });

  it("with ?project=<id>, resolves the links of enabled extensions; an unknown project is 404", async () => {
    const h = await hub();
    expect((await api(h, "/api/hub/extensions?project=ghost")).status).toBe(404);

    const reg = await api(h, "/api/hub/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: "alpha", repoRoot: repo, ndxBin: NDX_BIN }),
    });
    expect(reg.status, JSON.stringify(reg.body)).toBe(201);

    for (const path of ["/api/hub/extensions?project=alpha", "/p/alpha/api/hub/extensions"]) {
      const { status, body } = await api(h, path);
      expect(status).toBe(200);
      const byName = Object.fromEntries(body.extensions.map((e: { name: string }) => [e.name, e]));
      expect(byName.recon.links).toEqual([
        { label: "Report", url: `/x/recon/project/alpha?root=${encodeURIComponent(repo)}` },
      ]);
      expect(byName.later.links).toEqual([]);
      expect(byName.future.links).toEqual([]);
      expect(byName.broken.links).toEqual([]);
    }
  });

  it("is 503 with { error } when n-dx cannot be asked", async () => {
    const h = await hub({ listExtensions: undefined });
    const { status, body } = await api(h, "/api/hub/extensions");
    expect(status).toBe(503);
    expect(body.error).toMatch(/without an n-dx CLI/);
  });
});

describe("POST /api/hub/extensions/:name/stop", () => {
  it("stops a running sidecar, and answers stopped: false when none runs", async () => {
    const h = await hub();
    expect((await fetch(`http://127.0.0.1:${h.port}/x/recon/`)).status).toBe(200);

    const stopped = await api(h, "/api/hub/extensions/recon/stop", { method: "POST" });
    expect(stopped).toEqual({ status: 200, body: { apiVersion: 1, name: "recon", stopped: true } });
    const listed = await api(h, "/api/hub/extensions");
    expect(listed.body.extensions.find((e: { name: string }) => e.name === "recon").sidecar.state).toBe("stopped");

    const again = await api(h, "/api/hub/extensions/recon/stop", { method: "POST" });
    expect(again).toEqual({ status: 200, body: { apiVersion: 1, name: "recon", stopped: false } });
  });

  it("is 404 for a name no extension could have", async () => {
    const h = await hub();
    expect((await api(h, "/api/hub/extensions/Not_A_Name/stop", { method: "POST" })).status).toBe(404);
  });
});

describe("ndxCliLister", () => {
  it("parses core's list, and reports a failure", async () => {
    const cli = join(dir, "fake-cli.cjs");
    writeFileSync(cli, [
      `if (process.argv.slice(2).join(" ") !== "extensions list --json") process.exit(9);`,
      `console.log(JSON.stringify({ extensions: [{ name: "recon", state: "enabled" }], errors: [] }, null, 2));`,
    ].join("\n"));
    const result = await ndxCliLister(cli, dir)();
    expect(result).toEqual({ ok: true, extensions: [{ name: "recon", state: "enabled" }], errors: [] });

    const missing = await ndxCliLister(join(dir, "nope.cjs"), dir)();
    expect(missing.ok).toBe(false);
  });
});
