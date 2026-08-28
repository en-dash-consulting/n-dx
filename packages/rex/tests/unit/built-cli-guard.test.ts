/**
 * The guard that tests spawning the built CLI use to fail honestly.
 *
 * A test that runs `node dist/cli/index.js` depends on a build step the import
 * graph cannot see. Checking only that dist/ exists catches a missing build but
 * not a stale one, and a stale build fails somewhere else entirely: the
 * merge-driver suite reported `NDX_CLI_NOT_INITIALIZED` against a git temp
 * path, which points at everything except the build. These cases pin the two
 * failures apart and pin the instruction into the message.
 *
 * @see packages/rex/tests/helpers/built-cli.ts
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { requireFreshBuiltCli } from "../helpers/built-cli.js";

/** Seconds since the epoch, for setting mtimes deterministically. */
const T = Math.floor(Date.now() / 1000);

describe("requireFreshBuiltCli", () => {
  let root: string;
  let srcDir: string;
  let distDir: string;
  let cliPath: string;

  function paths() {
    return { cliPath, srcDir, distDir };
  }

  function writeSource(mtimeSeconds: number): void {
    const file = join(srcDir, "cli", "index.ts");
    writeFileSync(file, "export const x = 1;\n", "utf-8");
    utimesSync(file, mtimeSeconds, mtimeSeconds);
  }

  function writeBuilt(mtimeSeconds: number): void {
    const file = join(distDir, "cli", "index.js");
    writeFileSync(file, "export const x = 1;\n", "utf-8");
    utimesSync(file, mtimeSeconds, mtimeSeconds);
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "rex-built-cli-"));
    srcDir = join(root, "src");
    distDir = join(root, "dist");
    cliPath = join(distDir, "cli", "index.js");
    mkdirSync(join(srcDir, "cli"), { recursive: true });
    mkdirSync(join(distDir, "cli"), { recursive: true });
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it("returns the CLI path when the build is present and current", () => {
    writeSource(T - 60);
    writeBuilt(T);
    expect(requireFreshBuiltCli(paths())).toBe(cliPath);
  });

  it("names the build when dist is missing entirely", () => {
    writeSource(T);
    expect(() => requireFreshBuiltCli(paths())).toThrow(/pnpm build/);
    expect(() => requireFreshBuiltCli(paths())).toThrow(/not found/i);
  });

  it("names the build — not the symptom — when dist is stale", () => {
    writeBuilt(T - 3600);
    writeSource(T);

    let message = "";
    try {
      requireFreshBuiltCli(paths());
    } catch (err) {
      message = (err as Error).message;
    }

    expect(message).toMatch(/stale/i);
    expect(message).toMatch(/pnpm build/);
    // The distinction that costs a debugging cycle when it is missing: this is
    // an out-of-date build, not an absent one.
    expect(message).not.toMatch(/not found/i);
  });

  it("ignores non-source files when deciding staleness", () => {
    writeBuilt(T - 60);
    writeSource(T - 120);
    // A stray artifact — a coverage dump, an editor scratch file — is not a
    // source edit and must not demand a rebuild.
    const stray = join(srcDir, "notes.md");
    writeFileSync(stray, "scratch\n", "utf-8");
    utimesSync(stray, T, T);

    expect(() => requireFreshBuiltCli(paths())).not.toThrow();
  });

  it("ignores a nested dist inside src", () => {
    writeBuilt(T - 60);
    writeSource(T - 120);
    mkdirSync(join(srcDir, "fixture", "dist"), { recursive: true });
    const nested = join(srcDir, "fixture", "dist", "bundled.js");
    writeFileSync(nested, "// generated\n", "utf-8");
    utimesSync(nested, T, T);

    expect(() => requireFreshBuiltCli(paths())).not.toThrow();
  });
});
