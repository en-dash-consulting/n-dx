/**
 * `ndx start` against a server older than itself.
 *
 * A source-linked install runs core from source, so it is always current, but
 * spawns the hub and project servers from `packages/web/dist`, which is only
 * as current as the last build. When the two drift, the CLI asks for a landing
 * nonce the server has no route for, and the sign-in link goes missing. These
 * pin the pieces that name the drift and a fix that works: the build identity
 * read from disk, the comparison with a running hub's, and the wording.
 *
 * @see packages/core/build-identity.mjs
 * @see packages/core/web.js — serverRefreshFix, noNonceNote, staleWebDistWarning, hubBuildMismatch, formatUnrecordedStatus
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILD_STAMP_FILE, packageBuildIdentity, sourceHash } from "../../packages/core/build-identity.mjs";
import { sourceHash as gateSourceHash } from "../../scripts/lib/stale-dist.mjs";
import {
  formatUnrecordedStatus,
  hubBuildMismatch,
  noNonceNote,
  serverRefreshFix,
  staleWebDistWarning,
} from "../../packages/core/web.js";

let root;

function write(rel, content) {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
  return full;
}

/** A web package under `root/packages/web` with a CLI in dist/. */
function webPackage({ src = true, stamp = "current" } = {}) {
  write("packages/web/package.json", JSON.stringify({ name: "@n-dx/web", version: "1.2.3" }));
  const cli = write("packages/web/dist/cli/index.js", "");
  if (src) write("packages/web/src/index.ts", "export const x = 1;\n");
  const srcDir = join(root, "packages/web/src");
  if (stamp === "current") write(`packages/web/dist/${BUILD_STAMP_FILE}`, JSON.stringify({ sourceHash: sourceHash(srcDir) }));
  if (stamp === "old") write(`packages/web/dist/${BUILD_STAMP_FILE}`, JSON.stringify({ sourceHash: "0".repeat(64) }));
  return cli;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ndx-stale-server-"));
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("packageBuildIdentity", () => {
  it("reads a source-linked package whose dist/ is a build of its source as current", () => {
    const id = packageBuildIdentity(webPackage());
    expect(id).toMatchObject({ name: "@n-dx/web", version: "1.2.3", sourceLinked: true, current: true });
    expect(id.sourceHash).toBe(sourceHash(join(root, "packages/web/src")));
  });

  it("reads a source-linked package with an older stamp, or none, as stale", () => {
    expect(packageBuildIdentity(webPackage({ stamp: "old" })).current).toBe(false);
    rmSync(join(root, "packages"), { recursive: true });
    expect(packageBuildIdentity(webPackage({ stamp: "none" }))).toMatchObject({ current: false, sourceHash: null });
  });

  it("does not judge a published package, which ships dist/ without src/ or a stamp", () => {
    expect(packageBuildIdentity(webPackage({ src: false, stamp: "none" })))
      .toMatchObject({ version: "1.2.3", sourceLinked: false, current: null, sourceHash: null });
  });

  it("reports nulls rather than throwing when there is no package", () => {
    expect(packageBuildIdentity(join(root, "nowhere", "index.js")).current).toBeNull();
  });

  it("hashes source exactly as the root test gates do, so a stamp means the same to both", () => {
    webPackage();
    const srcDir = join(root, "packages/web/src");
    expect(gateSourceHash(srcDir)).toBe(sourceHash(srcDir));
  });
});

const current = { packageDir: "/c/packages/web", version: "1.2.3", sourceHash: "a".repeat(64), sourceLinked: true, current: true };
const stale = { ...current, current: false };
const published = { packageDir: "/n/node_modules/@n-dx/web", version: "1.2.3", sourceHash: null, sourceLinked: false, current: null };

describe("serverRefreshFix", () => {
  it("leads with the rebuild when the dist/ on disk is itself stale — a restart alone respawns it", () => {
    for (const kind of ["hub", "here"]) {
      const fix = serverRefreshFix(stale, kind);
      expect(fix).toMatch(/^rebuild it with 'pnpm --filter @n-dx\/web build' in /);
      expect(fix).toContain(kind === "hub" ? "'ndx hub stop', then 'ndx start'" : "'ndx start stop', then 'ndx start'");
    }
  });

  it("restarts the hub when the build on disk is current, since a fresh hub runs it", () => {
    expect(serverRefreshFix(current, "hub")).toBe("restart the hub: 'ndx hub stop', then 'ndx start'");
    expect(serverRefreshFix(published, "hub")).toBe("restart the hub: 'ndx hub stop', then 'ndx start'");
  });

  it("never offers a bare restart for a single-project server just spawned from that same build", () => {
    expect(serverRefreshFix(current, "here")).not.toMatch(/^restart/);
    expect(serverRefreshFix(published, "here")).toBe("reinstall n-dx so @n-dx/web matches this ndx");
  });
});

describe("noNonceNote", () => {
  it("names an older server and the fix when the nonce route is missing (404, or 409 from an old hub's proxy)", () => {
    for (const status of [404, 405, 409]) {
      const note = noNonceNote(status, "THE FIX");
      expect(note).toContain("older than this ndx");
      expect(note).toContain("THE FIX");
      expect(note).not.toContain("run 'ndx start' again");
    }
  });

  it("suggests another try for anything else", () => {
    for (const status of [0, 401, 500]) {
      expect(noNonceNote(status, "THE FIX")).toBe("  (could not get a sign-in link from the server; run 'ndx start' again)");
    }
  });
});

describe("staleWebDistWarning", () => {
  it("warns a source-linked install with a stale dist/, naming the rebuild", () => {
    const warning = staleWebDistWarning(stale, "hub");
    expect(warning).toMatch(/^Warning: .*dist is not a build of its current source/);
    expect(warning).toContain("pnpm --filter @n-dx/web build");
  });

  it("is silent for a current build and for a published install", () => {
    expect(staleWebDistWarning(current, "hub")).toBeNull();
    expect(staleWebDistWarning(published, "hub")).toBeNull();
  });
});

describe("hubBuildMismatch", () => {
  it("names a hub that reports no build identity as predating this ndx", () => {
    expect(hubBuildMismatch(undefined, current)).toMatch(/predates this ndx/);
  });

  it("names a version or build that differs from what this ndx would start", () => {
    expect(hubBuildMismatch({ version: "1.2.2", sourceHash: current.sourceHash }, current)).toMatch(/1\.2\.2.*1\.2\.3/);
    expect(hubBuildMismatch({ version: "1.2.3", sourceHash: "b".repeat(64) }, current)).toMatch(/another build/);
  });

  it("accepts the same build, and does not compare hashes a published install does not have", () => {
    expect(hubBuildMismatch({ version: "1.2.3", sourceHash: current.sourceHash }, current)).toBeNull();
    expect(hubBuildMismatch({ version: "1.2.3", sourceHash: null }, published)).toBeNull();
  });
});

describe("formatUnrecordedStatus", () => {
  it("says this user's hub is running and the directory is not registered with it", () => {
    const lines = formatUnrecordedStatus({ port: 3117, hub: { port: 3117, pid: 42 }, portInUse: true });
    expect(lines.join("\n")).toContain("hub is running on port 3117 (PID 42)");
    expect(lines.join("\n")).toContain("not registered");
    expect(lines.join("\n")).not.toContain("No background server recorded");
    expect(lines.join("\n")).not.toContain("another process");
  });

  it("keeps the generic note when no hub of this user's answers", () => {
    expect(formatUnrecordedStatus({ port: 3117, hub: null, portInUse: true }))
      .toEqual(["No background server recorded.", "Note: Port 3117 is in use by another process."]);
    expect(formatUnrecordedStatus({ port: 3117, hub: null, portInUse: false })).toEqual(["No background server recorded."]);
  });
});
