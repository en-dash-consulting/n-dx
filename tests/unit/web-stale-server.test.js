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
 * @see packages/core/web.js — serverRefreshFix, noNonceNote, shouldRebuildForNonce, hubBuildMismatch, formatUnrecordedStatus
 * @see tests/unit/source-build.test.js — the rebuild a lagging dist/ gets before anything is spawned
 * @see tests/e2e/cli-start-stale-hub.test.js — the same, driven through `ndx start` against an older hub
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BUILD_STAMP_FILE, isBuildCurrent, packageBuildIdentity, sourceHash } from "../../packages/core/build-identity.mjs";
import { sourceHash as gateSourceHash } from "../../scripts/lib/stale-dist.mjs";
import {
  formatUnrecordedStatus,
  hereServerCommands,
  hubBuildMismatch,
  noNonceNote,
  serverRefreshFix,
  shouldRebuildForNonce,
} from "../../packages/core/web.js";

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
 * A web package under `root/packages/web` with a CLI in dist/. `distAge` and
 * `srcAge` are how many seconds ago each was last written.
 */
function webPackage({ src = true, stamp = "current", distAge = 0, srcAge = 60 } = {}) {
  write("packages/web/package.json", JSON.stringify({ name: "@n-dx/web", version: "1.2.3" }));
  const cli = write("packages/web/dist/cli/index.js", "", distAge);
  if (src) write("packages/web/src/index.ts", "export const x = 1;\n", srcAge);
  const srcDir = join(root, "packages/web/src");
  if (stamp === "current") write(`packages/web/dist/${BUILD_STAMP_FILE}`, JSON.stringify({ sourceHash: sourceHash(srcDir) }));
  if (stamp === "old") write(`packages/web/dist/${BUILD_STAMP_FILE}`, JSON.stringify({ sourceHash: "0".repeat(64) }));
  return cli;
}

/** A dangling `*.ts` symlink in the source, or false where symlinks cannot be made (Windows without the privilege). */
function danglingSourceLink() {
  try {
    symlinkSync(join(root, "gone.ts"), join(root, "packages/web/src/dangling.ts"));
    return true;
  } catch {
    return false;
  }
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
    expect(id).toMatchObject({ name: "@n-dx/web", version: "1.2.3", sourceLinked: true, current: true, lagging: null });
    expect(id.sourceHash).toBe(sourceHash(join(root, "packages/web/src")));
  });

  it("reads a dist/ older than its source, with an older stamp or none, as stale and lagging", () => {
    expect(packageBuildIdentity(webPackage({ stamp: "old", distAge: 120, srcAge: 10 })))
      .toMatchObject({ current: false, lagging: true });
    rmSync(join(root, "packages"), { recursive: true });
    expect(packageBuildIdentity(webPackage({ stamp: "none", distAge: 120, srcAge: 10 })))
      .toMatchObject({ current: false, lagging: true, sourceHash: null });
  });

  it("does not call a watch build lagging: no fresh stamp, but dist/ written after the newest source edit", () => {
    // `pnpm dev` runs tsc --watch, which rewrites dist/ and never the stamp.
    expect(packageBuildIdentity(webPackage({ stamp: "old", distAge: 0, srcAge: 30 })))
      .toMatchObject({ current: false, lagging: false });
  });

  it("does not judge a published package, which ships dist/ without src/ or a stamp", () => {
    expect(packageBuildIdentity(webPackage({ src: false, stamp: "none" })))
      .toMatchObject({ version: "1.2.3", sourceLinked: false, current: null, lagging: null, sourceHash: null });
  });

  it("reports nulls rather than throwing when there is no package", () => {
    expect(packageBuildIdentity(join(root, "nowhere", "index.js")).current).toBeNull();
  });

  it("reports unknown, never throws, when a source file cannot be read", (ctx) => {
    const cli = webPackage({ stamp: "old" });
    if (!danglingSourceLink()) ctx.skip();
    expect(() => sourceHash(join(root, "packages/web/src"))).toThrow();
    expect(packageBuildIdentity(cli)).toMatchObject({ current: null, lagging: null });
  });

  it("hashes source exactly as the root test gates do, so a stamp means the same to both", () => {
    webPackage();
    const srcDir = join(root, "packages/web/src");
    expect(gateSourceHash(srcDir)).toBe(sourceHash(srcDir));
  });
});

describe("isBuildCurrent", () => {
  it("reads a source it cannot hash as not current, so a gate rebuilds rather than crashes", (ctx) => {
    webPackage();
    if (!danglingSourceLink()) ctx.skip();
    expect(isBuildCurrent(join(root, "packages/web/src"), join(root, "packages/web/dist"))).toBe(false);
  });
});

const current = { packageDir: join("/c", "packages", "web"), version: "1.2.3", sourceHash: "a".repeat(64), sourceLinked: true, current: true, lagging: null };
const stale = { ...current, current: false, lagging: true };
const watchBuilt = { ...current, current: false, lagging: false };
const published = { packageDir: "/n/node_modules/@n-dx/web", version: "1.2.3", sourceHash: null, sourceLinked: false, current: null, lagging: null };
const here = hereServerCommands("start", false);

describe("serverRefreshFix", () => {
  it("never tells a single-project server's user to run pnpm: a lagging dist/ was rebuilt before spawning", () => {
    for (const web of [current, stale, watchBuilt]) {
      const fix = serverRefreshFix(web, here);
      expect(fix).not.toMatch(/pnpm/);
      expect(fix).toContain("rebuilt");
    }
  });

  it("says reinstall for a published install, which has no source to rebuild", () => {
    expect(serverRefreshFix(published, here)).toBe("reinstall n-dx so @n-dx/web matches this ndx");
  });

  it("names the commands that address the server it is for: --here, --preview, ndx web", () => {
    expect(hereServerCommands("start", false)).toMatchObject({ stop: "ndx start --here stop", start: "ndx start --here" });
    expect(hereServerCommands("start", true)).toMatchObject({ stop: "ndx start --preview stop", start: "ndx start --preview" });
    expect(hereServerCommands("web", false)).toMatchObject({ stop: "ndx web --here stop", start: "ndx web --here" });
  });
});

describe("shouldRebuildForNonce", () => {
  it("rebuilds and respawns once when a source-linked server just spawned has no nonce route", () => {
    for (const status of [404, 405, 409]) expect(shouldRebuildForNonce(status, current, false)).toBe(true);
    expect(shouldRebuildForNonce(404, current, true)).toBe(false);
  });

  it("does not for a published install, or for a failure that is not a missing route", () => {
    expect(shouldRebuildForNonce(404, published, false)).toBe(false);
    for (const status of [0, 401, 500]) expect(shouldRebuildForNonce(status, current, false)).toBe(false);
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
  it("says this user's hub is running and no registration is recorded for the directory", () => {
    const text = formatUnrecordedStatus({ port: 3117, hub: { port: 3117, pid: 42 }, portInUse: true }).join("\n");
    expect(text).toContain("hub is running on port 3117 (PID 42)");
    expect(text).toContain("no registration with it is recorded");
    expect(text).toContain("'ndx start .'");
    expect(text).not.toContain("No background server recorded");
    expect(text).not.toContain("another process");
  });

  it("names the directory it was asked about, quoted when it has a space", () => {
    const text = formatUnrecordedStatus({ port: 3117, hub: { port: 3117, pid: 42 }, portInUse: true, dir: "C:\\work\\my app" }).join("\n");
    expect(text).toContain(`'ndx start "C:\\work\\my app"'`);
  });

  it("still notes a stranger on the dashboard port when the hub is on another one", () => {
    expect(formatUnrecordedStatus({ port: 3117, hub: { port: 4000, pid: 42 }, portInUse: true }).at(-1))
      .toBe("Note: Port 3117 is in use by another process.");
  });

  it("keeps the generic note when no hub of this user's answers", () => {
    expect(formatUnrecordedStatus({ port: 3117, hub: null, portInUse: true }))
      .toEqual(["No background server recorded.", "Note: Port 3117 is in use by another process."]);
    expect(formatUnrecordedStatus({ port: 3117, hub: null, portInUse: false })).toEqual(["No background server recorded."]);
  });
});
