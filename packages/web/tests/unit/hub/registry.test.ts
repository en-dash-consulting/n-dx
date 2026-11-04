import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildServeCommand,
  emptyRegistry,
  hubPidPath,
  isPidAlive,
  loadRegistry,
  loadRegistryHealing,
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
  /** Run `body` with both home overrides set as given, then restore. */
  function withEnv(
    vars: Record<string, string | undefined>,
    body: () => void,
  ): void {
    const previous = Object.fromEntries(
      Object.keys(vars).map((key) => [key, process.env[key]]),
    );
    try {
      for (const [key, value] of Object.entries(vars)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      body();
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  it("prefers an explicit directory over everything else", () => {
    withEnv({ NDX_HOME: "/env/new", N_DX_HOME: "/env/old" }, () => {
      expect(resolveHubHome("/explicit")).toBe("/explicit");
    });
  });

  it("takes $NDX_HOME ahead of $N_DX_HOME", () => {
    withEnv({ NDX_HOME: "/env/new", N_DX_HOME: "/env/old" }, () => {
      expect(resolveHubHome()).toBe("/env/new");
    });
  });

  it("honours $N_DX_HOME when $NDX_HOME is unset", () => {
    withEnv({ NDX_HOME: undefined, N_DX_HOME: "/env/old" }, () => {
      expect(resolveHubHome()).toBe("/env/old");
    });
  });

  it("falls back to a directory under the user's home with neither set", () => {
    withEnv({ NDX_HOME: undefined, N_DX_HOME: undefined }, () => {
      // Which of the two names depends on what exists on the machine running
      // the suite; `resolveNdxHome`'s own tests pin that choice. Here the point
      // is only that the hub asks the resolver rather than hard-coding a name.
      expect(resolveHubHome()).toMatch(/[\\/]\.n-?dx$/);
    });
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

  it("strips a recorded ndxBin from an older registry and reports it", () => {
    const path = registryPath(home);
    writeFileSync(path, JSON.stringify({
      version: 1,
      projects: {
        old: { id: "old", name: "old", repoRoot: "/repos/old", worktrees: ["/repos/old"], ndxBin: "/somewhere/else.js", port: null, pid: null, lastSeen: null },
        current: { id: "current", name: "current", repoRoot: "/repos/current", worktrees: ["/repos/current"], port: null, pid: null, lastSeen: null },
      },
    }));
    const { registry, healed } = loadRegistryHealing(path);
    expect(healed).toEqual([{ id: "old", ndxBin: "/somewhere/else.js" }]);
    expect(Object.keys(registry.projects).sort()).toEqual(["current", "old"]);
    expect(registry.projects.old).not.toHaveProperty("ndxBin");
    expect(registry.projects.old).toMatchObject({ repoRoot: "/repos/old" });
    expect(loadRegistry(path).projects.old).not.toHaveProperty("ndxBin");
  });

  it("round-trips records and drops entries missing their essentials", () => {
    const path = registryPath(home);
    const registry = emptyRegistry();
    registry.projects.alpha = {
      id: "alpha", name: "alpha", repoRoot: "/repos/alpha", worktrees: ["/repos/alpha"],
      port: 4321, pid: 999999, lastSeen: null,
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
    // The hub only spawns @n-dx/web's CLI entry point (or an ndx launcher),
    // and "is" means the owning package says so — the path shape is not enough.
    const ndxBin = join(home, "web", "dist", "cli", "index.js");
    mkdirSync(join(home, "web", "dist", "cli"), { recursive: true });
    writeFileSync(ndxBin, "");
    writeFileSync(join(home, "web", "package.json"), JSON.stringify({ name: "@n-dx/web" }));
    const ok = parseRegisterInput({ id: "proj-1", repoRoot: home, name: "  Proj " }, ndxBin);
    expect(ok).toEqual({ input: { id: "proj-1", repoRoot: home, worktree: undefined, name: "Proj" } });

    expect(parseRegisterInput(null, ndxBin)).toHaveProperty("problem");
    expect(parseRegisterInput({ id: "../etc", repoRoot: home }, ndxBin)).toHaveProperty("problem");
    expect(parseRegisterInput({ id: "p", repoRoot: "relative" }, ndxBin)).toHaveProperty("problem");
    expect(parseRegisterInput({ id: "p", repoRoot: join(home, "missing") }, ndxBin)).toHaveProperty("problem");
    expect(parseRegisterInput({ id: "p", repoRoot: home, worktree: "rel" }, ndxBin)).toHaveProperty("problem");
  });

  it("drops whatever ndxBin the body names — the hub spawns its own", () => {
    const ndxBin = join(home, "web", "dist", "cli", "index.js");
    mkdirSync(join(home, "web", "dist", "cli"), { recursive: true });
    writeFileSync(ndxBin, "");
    writeFileSync(join(home, "web", "package.json"), JSON.stringify({ name: "@n-dx/web" }));
    const other = join(home, "evil.js");
    writeFileSync(other, "");
    const parsed = parseRegisterInput({ id: "p", repoRoot: home, ndxBin: other }, ndxBin);
    expect(parsed).toHaveProperty("input");
    expect((parsed as { input: object }).input).not.toHaveProperty("ndxBin");
    expect(parseRegisterInput({ id: "x", repoRoot: home }, ndxBin)).toEqual({
      problem: 'id "x" is reserved: /x/ is where the hub mounts extension sidecars',
    });
    expect(parseRegisterInput({ id: "X", repoRoot: home }, ndxBin)).toHaveProperty("problem");
    expect(parseRegisterInput({ id: "x1", repoRoot: home }, ndxBin)).toHaveProperty("input");
  });

  it("refuses to register when the hub has no acceptable binary of its own", () => {
    const impostor = join(home, "impostor", "web", "dist", "cli", "index.js");
    mkdirSync(join(home, "impostor", "web", "dist", "cli"), { recursive: true });
    writeFileSync(impostor, "");
    expect(parseRegisterInput({ id: "p", repoRoot: home }, impostor)).toHaveProperty("problem");
    expect(parseRegisterInput({ id: "p", repoRoot: home }, "")).toHaveProperty("problem");
  });
});
