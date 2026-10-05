/**
 * What the hub is willing to spawn.
 *
 * `POST /api/hub/projects` ends in a child process, so `ndxBin` is the most
 * dangerous field the hub accepts. It used to be checked by *path shape* —
 * anything ending `…/web/dist/cli/index.js` — and a shape is something any
 * writable directory can be given. The check asks the owning package who it
 * is now; the Origin and token gates in front of registration remain the
 * first line, this is the second.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isAcceptableNdxBin } from "../../../src/hub/routes.js";
import { resolveSelfBin } from "../../../src/hub/hub.js";
import type { HubRegistry, ProjectRecord } from "../../../src/hub/registry.js";

let root: string;

/** A `<name>/dist/cli/index.js` tree whose package.json says `pkgName`. */
function plantEntryPoint(dir: string, pkgName: string | null): string {
  const pkgRoot = join(root, dir);
  mkdirSync(join(pkgRoot, "dist", "cli"), { recursive: true });
  const entry = join(pkgRoot, "dist", "cli", "index.js");
  writeFileSync(entry, "// entry point\n");
  if (pkgName !== null) {
    writeFileSync(join(pkgRoot, "package.json"), JSON.stringify({ name: pkgName, version: "0.0.0" }));
  }
  return entry;
}

beforeAll(() => { root = mkdtempSync(join(tmpdir(), "ndx-bin-identity-")); });
afterAll(() => { rmSync(root, { recursive: true, force: true }); });

describe("isAcceptableNdxBin", () => {
  it("accepts the real @n-dx/web entry point", () => {
    expect(isAcceptableNdxBin(plantEntryPoint("web", "@n-dx/web"))).toBe(true);
    // The directory name is not what makes it real — an install path or a
    // renamed checkout is still the package.
    expect(isAcceptableNdxBin(plantEntryPoint("some-other-name", "@n-dx/web"))).toBe(true);
  });

  it("refuses an impostor that only has the right path shape", () => {
    // The attack the shape check allowed: drop a file at any writable path
    // ending …/web/dist/cli/index.js and the hub would spawn it.
    expect(isAcceptableNdxBin(plantEntryPoint("evil/web", null))).toBe(false);
    expect(isAcceptableNdxBin(plantEntryPoint("evil2/web", "totally-not-ndx"))).toBe(false);
  });

  it("refuses a package.json that is unreadable or not JSON", () => {
    const pkgRoot = join(root, "broken", "web");
    mkdirSync(join(pkgRoot, "dist", "cli"), { recursive: true });
    const entry = join(pkgRoot, "dist", "cli", "index.js");
    writeFileSync(entry, "// entry point\n");
    writeFileSync(join(pkgRoot, "package.json"), "{ not json");
    expect(isAcceptableNdxBin(entry)).toBe(false);
  });

  it("still accepts an ndx launcher by name", () => {
    // A shim has nothing to interrogate, so the name is all there is.
    for (const name of ["ndx", "n-dx", "ndx.cmd", "ndx.exe", "NDX.PS1"]) {
      expect(isAcceptableNdxBin(`/usr/local/bin/${name}`), name).toBe(true);
    }
    expect(isAcceptableNdxBin("/usr/local/bin/curl")).toBe(false);
    expect(isAcceptableNdxBin("/usr/local/bin/ndx-helper")).toBe(false);
  });
});

/** A registry holding one project that names `ndxBin`. */
function registryNaming(ndxBin: string): HubRegistry {
  return {
    projects: { alpha: { id: "alpha", ndxBin } as unknown as ProjectRecord },
  } as unknown as HubRegistry;
}

/**
 * `selfBin` is the binary the hub registers a project *it* created with, so it
 * ends in a spawn just as a caller-supplied `ndxBin` does — and its candidate
 * chain reaches into the registry, where an entry written before
 * `isAcceptableNdxBin` existed can name anything at all.
 */
describe("resolveSelfBin", () => {
  const empty = { projects: {} } as unknown as HubRegistry;

  // The chain consults `process.argv[1]` between the explicit argument and
  // the registry. Under vitest that is the runner's own entry, which would
  // make these assertions depend on how the suite was launched — so pin it to
  // something the rule plainly refuses and let each case say what it means.
  const realArgv1 = process.argv[1];
  beforeEach(() => { process.argv[1] = "/usr/local/bin/curl"; });
  afterEach(() => { process.argv[1] = realArgv1; });

  it("takes an explicit binary when it is the real package", () => {
    const good = plantEntryPoint("self-explicit", "@n-dx/web");
    expect(resolveSelfBin(good, empty)).toBe(good);
  });

  it("skips an unacceptable candidate instead of returning it", () => {
    const impostor = plantEntryPoint("self-impostor", "totally-not-ndx");
    expect(resolveSelfBin(impostor, empty)).not.toBe(impostor);
  });

  it("will not inherit an impostor from a stale registry entry", () => {
    // The whole point: "it is already registered" is not evidence, because the
    // entry may predate the rule. Falling through to "" is what the
    // new-project route reports rather than spawning.
    const impostor = plantEntryPoint("self-stale", "totally-not-ndx");
    expect(resolveSelfBin("/nope/missing", registryNaming(impostor))).toBe("");
  });

  it("falls through an unrecognizable entry point to a registered binary that passes", () => {
    const good = plantEntryPoint("self-fallback", "@n-dx/web");
    expect(resolveSelfBin("/nope/missing", registryNaming(good))).toBe(good);
  });
});
