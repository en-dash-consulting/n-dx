/**
 * Guard contract for integration tests that assert on compiled server output.
 *
 * Those tests boot `dist/server/start.js` in a child process, so their
 * failures are only meaningful against a current build. Two failure modes,
 * observed live, must present as build problems rather than as the behaviour
 * under test failing:
 *
 * - never built: module-not-found noise from the child;
 * - stale build (the mode that actually bit): port-zero-reporting asserted a
 *   behaviour change made in the same commit as the test, so running against
 *   a dist built from the previous head reported "the fix doesn't work".
 *
 * Freshness is content-based. The two cases below that set mtimes do so to
 * falsify the mtime comparison this guard used to make: each one is a scenario
 * packages/web produces where the mtime ordering and the truth disagree.
 *
 * @see packages/web/tests/helpers/built-server-guard.ts
 * @see tests/e2e/verify-build.js — the repo-wide sibling this pattern follows
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeBuildStamp } from "../../../../../scripts/lib/stale-dist.mjs";
import { assertFreshServerBuild } from "../../helpers/built-server-guard.js";

describe("assertFreshServerBuild", () => {
  let dir: string;
  let srcDir: string;
  let distDir: string;
  let entry: string;

  /** Stamp a file's mtime to a fixed instant, for deterministic ordering. */
  async function stampMtime(path: string, epochMs: number): Promise<void> {
    await utimes(path, new Date(epochMs), new Date(epochMs));
  }

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "built-server-guard-"));
    srcDir = join(dir, "src");
    distDir = join(dir, "dist");
    entry = join(distDir, "server", "start.js");
    await mkdir(join(srcDir, "server"), { recursive: true });
    await mkdir(join(distDir, "server"), { recursive: true });
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("fails with an actionable message when the server entry was never built", () => {
    expect(() => assertFreshServerBuild({ srcDir, distDir, entry })).toThrow(
      /Missing build output[\s\S]*pnpm --filter @n-dx\/web build/,
    );
  });

  it("passes when dist carries a stamp of the current source", async () => {
    await writeFile(join(srcDir, "server", "start.ts"), "export {};");
    await writeFile(entry, "export {};");
    writeBuildStamp(srcDir, distDir);

    expect(() => assertFreshServerBuild({ srcDir, distDir, entry })).not.toThrow();
  });

  it("fails with a build instruction when a source changed after the build", async () => {
    await writeFile(join(srcDir, "server", "start.ts"), "export {};");
    await writeFile(entry, "export {};");
    writeBuildStamp(srcDir, distDir);
    await writeFile(join(srcDir, "server", "start.ts"), "export const changed = true;");

    expect(() => assertFreshServerBuild({ srcDir, distDir, entry })).toThrow(
      /Stale build output[\s\S]*pnpm --filter @n-dx\/web build/,
    );
  });

  it("fails when a partial build wrote newer files into dist without recompiling", async () => {
    // `pnpm --filter @n-dx/web build:landing` refreshes dist/landing/ and never
    // writes the stamp. The newest file anywhere in dist/ is then younger than
    // the edited source while dist/server/start.js is still the old compile —
    // an mtime comparison passes and the test boots the stale server.
    const base = Date.now() - 60_000;
    await writeFile(join(srcDir, "server", "start.ts"), "export {};");
    await writeFile(entry, "export {};");
    writeBuildStamp(srcDir, distDir);

    await writeFile(join(srcDir, "server", "start.ts"), "export const changed = true;");
    await stampMtime(join(srcDir, "server", "start.ts"), base + 10_000);

    await mkdir(join(distDir, "landing"), { recursive: true });
    await writeFile(join(distDir, "landing", "index.html"), "<!doctype html>");
    await stampMtime(join(distDir, "landing", "index.html"), base + 20_000);

    expect(() => assertFreshServerBuild({ srcDir, distDir, entry })).toThrow(
      /Stale build output[\s\S]*pnpm --filter @n-dx\/web build/,
    );
  });

  it("passes when a built source was rewritten with identical content", async () => {
    // `git restore` of an already-built file: the content is what dist/ was
    // compiled from, incremental tsc emits nothing, and the mtime is now newer
    // than every output. An mtime comparison throws here and no rebuild clears
    // it, because there is nothing left to emit.
    const base = Date.now() - 60_000;
    const source = join(srcDir, "server", "start.ts");
    await writeFile(source, "export {};");
    await writeFile(entry, "export {};");
    await stampMtime(entry, base);
    writeBuildStamp(srcDir, distDir);
    await stampMtime(join(distDir, ".build-stamp.json"), base);

    await writeFile(source, "export {};");
    await stampMtime(source, base + 10_000);

    expect(() => assertFreshServerBuild({ srcDir, distDir, entry })).not.toThrow();
  });

  it("ignores non-source files when deciding what counts as edited", async () => {
    await writeFile(join(srcDir, "server", "start.ts"), "export {};");
    await writeFile(entry, "export {};");
    writeBuildStamp(srcDir, distDir);
    // A README edit after the build is not a reason to rebuild.
    await writeFile(join(srcDir, "NOTES.md"), "notes");

    expect(() => assertFreshServerBuild({ srcDir, distDir, entry })).not.toThrow();
  });
});
