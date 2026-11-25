/**
 * Every fact file in `DATA_FILES` carries `schemaVersion` at its top level, and
 * two analyses of an unchanged project write byte-identical fact files (once
 * zones.json has recorded its first stability comparison; see `twoSteadyRuns`).
 *
 * config.json, legacy.json and sites.json are written only when a language pack produced
 * their facts, so they are checked over the invented PHP estate
 * (`tests/fixtures/php-legacy-estate/`), which skips when the PHP grammar is
 * not built. Everything else is checked over a small TypeScript project.
 */

import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { ALL_DATA_FILES, DATA_FILES } from "../../src/schema/data-files.js";
import { SCHEMA_VERSION } from "../../src/schema/v1.js";
import { skipUnlessPackRuns } from "../helpers/workspace-pack.js";

const CLI_PATH = join(import.meta.dirname, "../../dist/cli/index.js");
const PHP_ESTATE = join(import.meta.dirname, "../fixtures/php-legacy-estate");

/** Written only when a language pack produced their facts. */
const PACK_ONLY: readonly string[] = [DATA_FILES.config, DATA_FILES.legacy, DATA_FILES.sites];

/** Carries the analysis time, so it differs between two runs by design. */
const TIMESTAMPED: readonly string[] = [DATA_FILES.manifest];

/**
 * Analyze until steady state and return the last two runs' fact files. The
 * first run differs from the second by design: zones.json records the second
 * run's stability against the first (`initial`, `stability`).
 */
function twoSteadyRuns(dir: string): [Map<string, string>, Map<string, string>] {
  analyze(dir);
  analyze(dir);
  const first = factFiles(dir);
  analyze(dir);
  return [first, factFiles(dir)];
}

const dirs: string[] = [];

function scratch(): string {
  const dir = mkdtempSync(join(tmpdir(), "sv-schema-version-"));
  dirs.push(dir);
  return dir;
}

function analyze(dir: string): void {
  const run = spawnSync(process.execPath, [CLI_PATH, "analyze", dir, "--fast"], { encoding: "utf-8", timeout: 240_000 });
  expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
}

/** Each data file that exists, by name, as written. */
function factFiles(dir: string): Map<string, string> {
  const svDir = join(dir, ".sourcevision");
  return new Map(
    ALL_DATA_FILES.filter((file) => existsSync(join(svDir, file))).map((file) => [file, readFileSync(join(svDir, file), "utf-8")]),
  );
}

function expectStamped(files: Map<string, string>, expected: readonly string[]): void {
  expect([...files.keys()].sort()).toEqual([...expected].sort());
  for (const [file, text] of files) {
    expect((JSON.parse(text) as { schemaVersion?: unknown }).schemaVersion, file).toBe(SCHEMA_VERSION);
  }
}

function expectByteIdentical(first: Map<string, string>, second: Map<string, string>): void {
  for (const [file, text] of first) {
    if (TIMESTAMPED.includes(file)) continue;
    expect(second.get(file), file).toBe(text);
  }
}

describe("schemaVersion on every fact file", { timeout: 600_000 }, () => {
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("stamps every file but the pack-only ones over a TypeScript project, byte-identical across runs", () => {
    const dir = scratch();
    writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "stamp-fixture", version: "1.0.0" }));
    writeFileSync(join(dir, "index.ts"), 'import { add } from "./math.js";\nexport const total = add(1, 2);\n');
    writeFileSync(join(dir, "math.ts"), "export function add(a: number, b: number): number {\n  return a + b;\n}\n");

    const [first, second] = twoSteadyRuns(dir);
    expectStamped(first, ALL_DATA_FILES.filter((file) => !PACK_ONLY.includes(file)));
    expectByteIdentical(first, second);
  });

  it("stamps config.json, legacy.json and sites.json over the PHP estate, byte-identical across runs", async (ctx) => {
    await skipUnlessPackRuns(ctx, "php");
    const dir = join(scratch(), "estate");
    cpSync(PHP_ESTATE, dir, { recursive: true });

    const [first, second] = twoSteadyRuns(dir);
    expectStamped(first, ALL_DATA_FILES);
    expectByteIdentical(first, second);
  });
});
