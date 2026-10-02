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

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { isAcceptableNdxBin } from "../../../src/hub/routes.js";

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
