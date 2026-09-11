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
 * @see packages/web/tests/helpers/built-server-guard.ts
 * @see tests/e2e/verify-build.js — the repo-wide sibling this pattern follows
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, mkdir, writeFile, utimes } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { assertFreshServerBuild } from "../../helpers/built-server-guard.js";

describe("assertFreshServerBuild", () => {
  let dir: string;
  let srcDir: string;
  let distDir: string;
  let entry: string;

  /** Stamp a file's mtime to a fixed offset from a base, for deterministic ordering. */
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

  it("passes when the newest dist output is at least as new as the newest source", async () => {
    const base = Date.now() - 60_000;
    await writeFile(join(srcDir, "server", "start.ts"), "export {};");
    await stampMtime(join(srcDir, "server", "start.ts"), base);
    await writeFile(entry, "export {};");
    await stampMtime(entry, base + 10_000);

    expect(() => assertFreshServerBuild({ srcDir, distDir, entry })).not.toThrow();
  });

  it("fails with a build instruction when a source is newer than every dist output", async () => {
    const base = Date.now() - 60_000;
    await writeFile(entry, "export {};");
    await stampMtime(entry, base);
    await writeFile(join(srcDir, "server", "start.ts"), "export {};");
    await stampMtime(join(srcDir, "server", "start.ts"), base + 10_000);

    expect(() => assertFreshServerBuild({ srcDir, distDir, entry })).toThrow(
      /Stale build output[\s\S]*pnpm --filter @n-dx\/web build/,
    );
  });

  it("judges staleness against the newest file anywhere in dist, not the entry alone", async () => {
    // packages/web builds incrementally: editing one source refreshes only its
    // own output, leaving dist/server/start.js untouched. Comparing against
    // that single file would report a fresh build as stale forever.
    const base = Date.now() - 60_000;
    await writeFile(entry, "export {};");
    await stampMtime(entry, base);
    await writeFile(join(srcDir, "other.ts"), "export {};");
    await stampMtime(join(srcDir, "other.ts"), base + 10_000);
    // The incremental rebuild refreshed only other.js — the build IS current.
    await writeFile(join(distDir, "other.js"), "export {};");
    await stampMtime(join(distDir, "other.js"), base + 20_000);

    expect(() => assertFreshServerBuild({ srcDir, distDir, entry })).not.toThrow();
  });

  it("ignores non-source files when deciding what counts as edited", async () => {
    const base = Date.now() - 60_000;
    await writeFile(join(srcDir, "server", "start.ts"), "export {};");
    await stampMtime(join(srcDir, "server", "start.ts"), base);
    await writeFile(entry, "export {};");
    await stampMtime(entry, base + 10_000);
    // A README edit after the build is not a reason to rebuild.
    await writeFile(join(srcDir, "NOTES.md"), "notes");
    await stampMtime(join(srcDir, "NOTES.md"), base + 20_000);

    expect(() => assertFreshServerBuild({ srcDir, distDir, entry })).not.toThrow();
  });
});
