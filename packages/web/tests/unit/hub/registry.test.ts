import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildServeCommand,
  emptyRegistry,
  hubPidPath,
  isPidAlive,
  loadRegistry,
  parseRegisterInput,
  readHubPidFile,
  registryPath,
  removeHubPidFile,
  resolveHubHome,
  saveRegistry,
  writeHubPidFile,
} from "../../../src/hub/index.js";

let home: string;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "ndx-hub-registry-"));
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

describe("resolveHubHome", () => {
  it("prefers an explicit directory, then $N_DX_HOME, then ~/.n-dx", () => {
    const previous = process.env.N_DX_HOME;
    try {
      process.env.N_DX_HOME = "/env/home";
      expect(resolveHubHome("/explicit")).toBe("/explicit");
      expect(resolveHubHome()).toBe("/env/home");
      delete process.env.N_DX_HOME;
      expect(resolveHubHome()).toMatch(/[\\/]\.n-dx$/);
    } finally {
      if (previous === undefined) delete process.env.N_DX_HOME;
      else process.env.N_DX_HOME = previous;
    }
  });
});

describe("registry load/save", () => {
  it("returns an empty registry when the file is missing or corrupt", () => {
    const path = registryPath(home);
    expect(loadRegistry(path)).toEqual(emptyRegistry());
    writeFileSync(path, "{ not json");
    expect(loadRegistry(path)).toEqual(emptyRegistry());
    writeFileSync(path, JSON.stringify({ version: 1, projects: "nope" }));
    expect(loadRegistry(path)).toEqual(emptyRegistry());
  });

  it("round-trips records and drops entries missing their essentials", () => {
    const path = registryPath(home);
    const registry = emptyRegistry();
    registry.projects.alpha = {
      id: "alpha", name: "alpha", repoRoot: "/repos/alpha", worktrees: ["/repos/alpha"],
      ndxBin: "/bin/ndx-web.js", port: 4321, pid: 999999, lastSeen: null,
    };
    saveRegistry(path, registry);
    expect(loadRegistry(path)).toEqual(registry);

    // Hand-edited registry with a broken entry: keep the good one.
    writeFileSync(path, JSON.stringify({
      version: 1,
      projects: { alpha: registry.projects.alpha, broken: { name: "no repoRoot" } },
    }));
    expect(Object.keys(loadRegistry(path).projects)).toEqual(["alpha"]);
  });

  it("writes atomically — no temp file left behind, content complete", () => {
    const path = registryPath(home);
    saveRegistry(path, emptyRegistry());
    expect(readdirSync(home)).toEqual(["hub.json"]);
    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual(emptyRegistry());
  });
});

describe("hub pid file", () => {
  it("writes, reads and removes", () => {
    const path = hubPidPath(home);
    writeHubPidFile(path, { pid: 123, port: 3117, startedAt: "2026-09-16T00:00:00.000Z" });
    expect(readHubPidFile(path)).toEqual({ pid: 123, port: 3117, startedAt: "2026-09-16T00:00:00.000Z" });
    removeHubPidFile(path);
    expect(readHubPidFile(path)).toBeNull();
    removeHubPidFile(path); // idempotent
  });
});

describe("isPidAlive", () => {
  it("is true for this process and false for an impossible pid", () => {
    expect(isPidAlive(process.pid)).toBe(true);
    expect(isPidAlive(0)).toBe(false);
    expect(isPidAlive(-1)).toBe(false);
    expect(isPidAlive(2 ** 22 + 12345)).toBe(false);
  });
});

describe("buildServeCommand", () => {
  it("runs a script with this Node and an executable directly", () => {
    expect(buildServeCommand("/x/dist/cli/index.js", "/repo")).toEqual({
      cmd: process.execPath,
      args: ["/x/dist/cli/index.js", "serve", "--port=0", "/repo"],
    });
    expect(buildServeCommand("/usr/local/bin/n-dx-web", "/repo")).toEqual({
      cmd: "/usr/local/bin/n-dx-web",
      args: ["serve", "--port=0", "/repo"],
    });
  });
});

describe("parseRegisterInput", () => {
  it("accepts a valid body and rejects each malformed field", () => {
    const ndxBin = join(home, "cli.js");
    writeFileSync(ndxBin, "");
    const ok = parseRegisterInput({ id: "proj-1", repoRoot: home, ndxBin, name: "  Proj " });
    expect(ok).toEqual({ input: { id: "proj-1", repoRoot: home, ndxBin, worktree: undefined, name: "Proj" } });

    expect(parseRegisterInput(null)).toHaveProperty("problem");
    expect(parseRegisterInput({ id: "../etc", repoRoot: home, ndxBin })).toHaveProperty("problem");
    expect(parseRegisterInput({ id: "p", repoRoot: "relative", ndxBin })).toHaveProperty("problem");
    expect(parseRegisterInput({ id: "p", repoRoot: join(home, "missing"), ndxBin })).toHaveProperty("problem");
    expect(parseRegisterInput({ id: "p", repoRoot: home, ndxBin: join(home, "nope.js") })).toHaveProperty("problem");
    expect(parseRegisterInput({ id: "p", repoRoot: home, ndxBin, worktree: "rel" })).toHaveProperty("problem");
  });
});
