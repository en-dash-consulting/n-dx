/**
 * `sv pack` reaches cmdPack through the built CLI's dispatch. The unit tests
 * call cmdPack directly, so only this spawn fails when the `pack` case in
 * src/cli/index.ts is removed or passes the wrong arguments.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";

const CLI_PATH = join(import.meta.dirname, "../../dist/cli/index.js");
const PACKAGE_JSON = join(import.meta.dirname, "../../package.json");

// Hang guardrail, scaled like the other CLI e2e suites (TESTING.md Family 3).
const MULTIPLIER = Number(process.env["NDX_TEST_TIME_MULTIPLIER"] ?? 20);
const SPAWN_TIMEOUT = 10_000 * MULTIPLIER;
const TEST_TIMEOUT = SPAWN_TIMEOUT + 5_000;

describe("sv pack (built CLI)", () => {
  let ndxHome: string;
  let version: string;

  beforeEach(async () => {
    ndxHome = await mkdtemp(join(tmpdir(), "sv-pack-e2e-"));
    version = (JSON.parse(await readFile(PACKAGE_JSON, "utf-8")) as { version: string }).version;
  });

  afterEach(async () => {
    await rm(ndxHome, { recursive: true, force: true });
  });

  function runPack(args: string[]): { stdout: string; stderr: string; status: number | null } {
    // NDX_HOME wins over N_DX_HOME in resolveNdxHome; --dry-run spawns no npm.
    const env = { ...process.env, NDX_HOME: ndxHome };
    delete env["N_DX_HOME"];
    const run = spawnSync(process.execPath, [CLI_PATH, "pack", ...args], {
      cwd: ndxHome,
      env,
      encoding: "utf-8",
      timeout: SPAWN_TIMEOUT,
    });
    return { stdout: run.stdout, stderr: run.stderr, status: run.status };
  }

  it(
    "pack add java --dry-run prints the npm install command for the per-user pack dir",
    () => {
      const run = runPack(["add", "java", "--dry-run"]);
      expect(run.status).toBe(0);
      // The CLI double-quotes a prefix holding whitespace (a temp dir under a
      // user name with a space), as a user would type it.
      const prefix = join(ndxHome, "packs", version);
      const quotedPrefix = /\s/.test(prefix) ? `"${prefix}"` : prefix;
      expect(run.stdout.trim()).toBe(`npm install --ignore-scripts --no-audit --no-fund --prefix ${quotedPrefix} @n-dx/lang-java@${version}`);
    },
    TEST_TIMEOUT,
  );

  it(
    "pack add cobol exits non-zero and names the known packs",
    () => {
      const run = runPack(["add", "cobol", "--dry-run"]);
      expect(run.status).not.toBe(0);
      const output = run.stdout + run.stderr;
      expect(output).toContain("Unknown language pack: cobol");
      for (const id of ["java", "go", "sql", "terraform"]) expect(output).toContain(id);
    },
    TEST_TIMEOUT,
  );
});
