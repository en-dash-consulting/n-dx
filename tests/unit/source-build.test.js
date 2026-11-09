/**
 * A source-linked install rebuilds a stale or missing `dist/` itself.
 *
 * `ndx start`, every sub-CLI `ndx` runs, and `ndx export` used to stop and
 * print a `pnpm` command when a package's `dist/` was missing or older than
 * its source. They now run that build, say so, and carry on; a build that
 * fails is reported with its own output. A published install, which has no
 * source, says it is incomplete.
 *
 * Every case runs against a throwaway checkout in a temp directory. The build
 * is either injected or a real `pnpm` run inside that throwaway workspace, so
 * nothing here builds this checkout or touches a running hub.
 *
 * @see packages/core/source-build.js
 * @see packages/core/web.js — runHubMode and runWeb call ensureSourceBuild before spawning
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  REBUILD_LOCK_DIRNAME,
  acquireRebuildLock,
  buildFacts,
  ensureSourceBuild,
  judgeBuildNeed,
  rebuildArgs,
  rebuildFailureMessage,
  runRebuild,
} from "../../packages/core/source-build.js";
import { spawnSyncCli } from "../../packages/core/win-spawn.js";

let root;

function write(rel, content, secondsAgo = 0) {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
  const t = new Date(Date.now() - secondsAgo * 1000);
  utimesSync(full, t, t);
  return full;
}

/**
 * A pnpm workspace under `root` with `packages/web`. `dist` is "current",
 * "lagging" (written before the newest source edit) or "missing".
 */
function checkout({ dist = "current", workspace = true, src = true, build = "node -e \"require('fs').mkdirSync('dist/cli',{recursive:true});require('fs').writeFileSync('dist/cli/index.js','')\"" } = {}) {
  if (workspace) write("pnpm-workspace.yaml", "packages:\n  - 'packages/*'\n");
  write("package.json", JSON.stringify({ name: "fixture-root", private: true }));
  write("packages/web/package.json", JSON.stringify({ name: "@n-dx/web", version: "1.2.3", scripts: { build } }));
  if (src) write("packages/web/src/index.ts", "export const x = 1;\n", dist === "lagging" ? 10 : 120);
  const entry = join(root, "packages/web/dist/cli/index.js");
  if (dist !== "missing") write("packages/web/dist/cli/index.js", "", dist === "lagging" ? 120 : 10);
  return entry;
}

const quiet = () => {};
const noLock = async () => () => {};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ndx-source-build-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("judgeBuildNeed", () => {
  const base = { entryExists: true, packageDir: "/c/packages/web", name: "@n-dx/web", hasSource: true, lagging: false, checkoutRoot: "/c" };

  it("does nothing for a build that is there and does not lag", () => {
    expect(judgeBuildNeed(base)).toEqual({ action: "none" });
    expect(judgeBuildNeed({ ...base, lagging: null })).toEqual({ action: "none" });
  });

  it("rebuilds a source-linked package whose dist/ lags or whose entry is missing", () => {
    expect(judgeBuildNeed({ ...base, lagging: true })).toMatchObject({ action: "rebuild", reason: "lagging", checkoutRoot: "/c" });
    expect(judgeBuildNeed({ ...base, entryExists: false })).toMatchObject({ action: "rebuild", reason: "missing", name: "@n-dx/web" });
  });

  it("says reinstall for a missing entry with no source or no workspace to build from", () => {
    expect(judgeBuildNeed({ ...base, entryExists: false, hasSource: false })).toMatchObject({ action: "reinstall" });
    expect(judgeBuildNeed({ ...base, entryExists: false, checkoutRoot: null })).toMatchObject({ action: "reinstall" });
  });

  it("leaves a lagging dist/ alone when there is no workspace to rebuild it in", () => {
    expect(judgeBuildNeed({ ...base, lagging: true, checkoutRoot: null })).toEqual({ action: "none" });
  });
});

describe("buildFacts", () => {
  it("reads a lagging source-linked package in a pnpm workspace", () => {
    const facts = buildFacts(checkout({ dist: "lagging" }), { checkLag: true });
    expect(facts).toMatchObject({ entryExists: true, name: "@n-dx/web", hasSource: true, lagging: true });
    expect(facts.checkoutRoot).toBeTruthy();
  });

  it("does not hash the source unless asked", () => {
    expect(buildFacts(checkout({ dist: "lagging" })).lagging).toBeNull();
  });
});

describe("rebuildArgs", () => {
  it("builds the package and every workspace package it depends on", () => {
    expect(rebuildArgs("@n-dx/web")).toEqual(["--filter", "@n-dx/web...", "build"]);
  });
});

describe("ensureSourceBuild", () => {
  it("rebuilds a lagging dist/, says so, and prints no pnpm instruction", async () => {
    const entry = checkout({ dist: "lagging" });
    const lines = [];
    const builds = [];
    const result = await ensureSourceBuild(entry, {
      checkLag: true,
      err: (l) => lines.push(l),
      lock: noLock,
      rebuild: (need) => { builds.push(need); return { ok: true, code: 0, output: "built" }; },
    });
    expect(result).toEqual({ ok: true, rebuilt: true });
    expect(builds).toHaveLength(1);
    expect(builds[0]).toMatchObject({ action: "rebuild", reason: "lagging", name: "@n-dx/web" });
    expect(lines.join("\n")).toMatch(/Rebuilding @n-dx\/web .*older than its source/);
    expect(lines.join("\n")).toMatch(/Rebuilt @n-dx\/web/);
    expect(lines.join("\n")).not.toMatch(/pnpm/);
  });

  it("builds a missing dist/ and lets the command run", async () => {
    const entry = checkout({ dist: "missing" });
    const result = await ensureSourceBuild(entry, {
      err: quiet,
      lock: noLock,
      rebuild: () => { write("packages/web/dist/cli/index.js", ""); return { ok: true, code: 0, output: "" }; },
    });
    expect(result).toEqual({ ok: true, rebuilt: true });
    expect(existsSync(entry)).toBe(true);
  });

  it("reports a failed build with the build's own output", async () => {
    const entry = checkout({ dist: "missing" });
    const result = await ensureSourceBuild(entry, {
      err: quiet,
      lock: noLock,
      rebuild: () => ({ ok: false, code: 2, output: "src/index.ts(1,1): error TS1005: ';' expected.\n" }),
    });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("exited with code 2");
    expect(result.message).toContain("error TS1005");
  });

  it("keeps a lagging build that fails to rebuild, warning with the build's output, instead of failing", async () => {
    const entry = checkout({ dist: "lagging" });
    const result = await ensureSourceBuild(entry, {
      checkLag: true,
      err: quiet,
      lock: noLock,
      rebuild: () => ({ ok: false, code: 2, output: "src/index.ts(3,7): error TS2322: Type 'string' is not assignable.\n" }),
    });
    expect(result.ok).toBe(true);
    expect(result.rebuilt).toBe(false);
    expect(result.failed).toContain("exited with code 2");
    expect(result.failed).toContain("error TS2322");
    expect(existsSync(entry)).toBe(true);
  });

  it("waits for another process's rebuild of the same checkout, then goes on", async () => {
    const entry = checkout({ dist: "lagging" });
    const held = await acquireRebuildLock(root, { waitMs: 0 });
    const lines = [];
    let builds = 0;
    let waiting;
    const announced = new Promise((resolve) => { waiting = resolve; });
    const pending = ensureSourceBuild(entry, {
      checkLag: true,
      err: (l) => { lines.push(l); waiting(); },
      lockWaitMs: 30_000,
      rebuild: () => { builds++; return { ok: true, code: 0, output: "" }; },
    });
    // The other process's build finishes: it rewrites dist/ and lets go.
    await announced;
    write("packages/web/dist/cli/index.js", "");
    held();
    expect(await pending).toEqual({ ok: true, rebuilt: false });
    expect(lines[0]).toMatch(/Waiting for another n-dx process to finish rebuilding @n-dx\/web/);
    // Its build was the one waited for: this one did not build again.
    expect(builds).toBe(0);
  });

  it("goes on with a lagging build when the wait for another rebuild runs out, but not with a missing one", async () => {
    const lagging = checkout({ dist: "lagging" });
    const held = await acquireRebuildLock(root, { waitMs: 0 });
    try {
      const kept = await ensureSourceBuild(lagging, { checkLag: true, err: quiet, lockWaitMs: 100 });
      expect(kept).toMatchObject({ ok: true, rebuilt: false, failed: expect.stringMatching(/still rebuilding @n-dx\/web/) });
      rmSync(join(root, "packages/web/dist"), { recursive: true, force: true });
      const missing = await ensureSourceBuild(lagging, { err: quiet, lockWaitMs: 100 });
      expect(missing.ok).toBe(false);
    } finally {
      held();
    }
  });

  it("does not claim success when the build ran but the entry is still missing", async () => {
    const entry = checkout({ dist: "missing" });
    const result = await ensureSourceBuild(entry, { err: quiet, lock: noLock, rebuild: () => ({ ok: true, code: 0, output: "" }) });
    expect(result).toMatchObject({ ok: false });
    expect(result.message).toContain("still missing");
  });

  it("says reinstall for a published install missing a built file, and builds nothing", async () => {
    const entry = checkout({ dist: "missing", src: false, workspace: false });
    let built = false;
    const result = await ensureSourceBuild(entry, { err: quiet, lock: noLock, rebuild: () => { built = true; return { ok: true, code: 0, output: "" }; } });
    expect(built).toBe(false);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/reinstall n-dx/);
    expect(result.message).not.toMatch(/pnpm/);
  });

  it("leaves a current build alone, and rebuilds it when forced", async () => {
    const entry = checkout({ dist: "current" });
    let builds = 0;
    const rebuild = () => { builds++; return { ok: true, code: 0, output: "" }; };
    expect(await ensureSourceBuild(entry, { checkLag: true, err: quiet, lock: noLock, rebuild })).toEqual({ ok: true, rebuilt: false });
    expect(builds).toBe(0);
    const lines = [];
    expect(await ensureSourceBuild(entry, { force: true, err: (l) => lines.push(l), lock: noLock, rebuild })).toEqual({ ok: true, rebuilt: true });
    expect(builds).toBe(1);
    expect(lines[0]).toContain("older than this ndx");
  });

  it("runs a real pnpm build in a throwaway workspace, and exits with the build's error when it fails", async (ctx) => {
    if (spawnSyncCli("pnpm", ["--version"], { stdio: "ignore" }).status !== 0) ctx.skip();
    const entry = checkout({ dist: "missing" });
    const ok = await ensureSourceBuild(entry, { err: quiet });
    expect(ok, ok.message).toEqual({ ok: true, rebuilt: true });
    expect(existsSync(entry)).toBe(true);

    rmSync(root, { recursive: true, force: true });
    mkdirSync(root);
    const failing = checkout({ dist: "missing", build: "node -e \"console.error('the build broke here'); process.exit(3)\"" });
    const failed = await ensureSourceBuild(failing, { err: quiet });
    expect(failed.ok).toBe(false);
    expect(failed.message).toContain("the build broke here");
    expect(existsSync(join(root, "node_modules", REBUILD_LOCK_DIRNAME))).toBe(false);
  }, 120_000);
});

describe("runRebuild", () => {
  const need = { action: "rebuild", reason: "lagging", name: "@n-dx/web", packageDir: "/c/packages/web", checkoutRoot: "/c" };

  it("runs pnpm with the filter in the checkout, capturing output", () => {
    const calls = [];
    const result = runRebuild(need, {
      spawnSync: (bin, args, opts) => { calls.push({ bin, args, cwd: opts.cwd }); return { status: 0, stdout: "out", stderr: "" }; },
    });
    expect(calls).toEqual([{ bin: "pnpm", args: ["--filter", "@n-dx/web...", "build"], cwd: "/c" }]);
    expect(result).toEqual({ ok: true, code: 0, output: "out" });
  });

  it("reports pnpm that cannot be started as a failure, not a throw", () => {
    const result = runRebuild(need, { spawnSync: () => ({ status: null, stdout: "", stderr: "", error: new Error("spawn pnpm ENOENT") }) });
    expect(result.ok).toBe(false);
    expect(rebuildFailureMessage(need, result)).toMatch(/could not run[\s\S]*ENOENT/);
  });
});

describe("acquireRebuildLock", () => {
  it("serializes builds of one checkout, and takes over a lock whose owner is gone", async () => {
    const release = await acquireRebuildLock(root, { waitMs: 0 });
    expect(release).toBeTypeOf("function");
    // Held by this live process: a second taker gives up once its wait runs out.
    expect(await acquireRebuildLock(root, { waitMs: 50, pollMs: 10 })).toBeNull();
    release();

    // A lock left by a process that is gone is taken over.
    const dir = join(root, "node_modules", REBUILD_LOCK_DIRNAME);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "owner.json"), JSON.stringify({ pid: 2 ** 30 }));
    const again = await acquireRebuildLock(root, { waitMs: 0 });
    expect(again).toBeTypeOf("function");
    again();
    expect(existsSync(dir)).toBe(false);
  });
});
