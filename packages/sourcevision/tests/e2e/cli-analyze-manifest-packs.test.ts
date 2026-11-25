/**
 * manifest.json `packs` lists the language packs that ran, with their package
 * versions, sorted by id. A PHP project lists `php` at lang-php's version; a
 * project with no PHP lists no `php`, whether or not the pack is installed;
 * two runs over an unchanged project write the same manifest apart from its
 * timestamps and the per-run record. The PHP case skips when the PHP grammar
 * is not built.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { skipUnlessPackRuns } from "../helpers/workspace-pack.js";

const CLI_PATH = join(import.meta.dirname, "../../dist/cli/index.js");
const LANG_PHP_VERSION = (JSON.parse(readFileSync(join(import.meta.dirname, "../../../lang-php/package.json"), "utf-8")) as { version: string }).version;

const dirs: string[] = [];

function project(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "sv-manifest-packs-"));
  dirs.push(dir);
  for (const [path, content] of Object.entries(files)) writeFileSync(join(dir, path), content);
  return dir;
}

function analyze(dir: string): Record<string, unknown> & { packs?: Array<{ id: string; version: string }> } {
  const run = spawnSync(process.execPath, [CLI_PATH, "analyze", dir, "--fast"], { encoding: "utf-8", timeout: 90_000 });
  expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);
  return JSON.parse(readFileSync(join(dir, ".sourcevision", "manifest.json"), "utf-8"));
}

/** The manifest without the fields that record when, or how long, a run took. */
function withoutTimestamps(manifest: Record<string, unknown>): Record<string, unknown> {
  const { analyzedAt: _at, lastAnalysis: _run, modules, ...rest } = manifest;
  const stable = Object.fromEntries(
    Object.entries(modules as Record<string, Record<string, unknown>>).map(([name, { startedAt: _s, completedAt: _c, ...module }]) => [name, module]),
  );
  return { ...rest, modules: stable };
}

describe("sv analyze --fast records the packs that ran in manifest.json", { timeout: 240_000 }, () => {
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("lists php at lang-php's version for a PHP project, sorted, the same on a second run", async (ctx) => {
    await skipUnlessPackRuns(ctx, "php");
    const dir = project({
      "index.php": "<?php\nrequire_once 'lib.php';\necho ok();\n",
      "lib.php": "<?php\nfunction ok() { return 1; }\n",
    });

    const first = analyze(dir);
    const second = analyze(dir);

    expect(first.packs).toContainEqual({ id: "php", version: LANG_PHP_VERSION });
    const ids = (first.packs ?? []).map((p) => p.id);
    expect(ids).toEqual([...ids].sort());
    expect(withoutTimestamps(second)).toEqual(withoutTimestamps(first));
  });

  it("lists no php for a project with no PHP", () => {
    const dir = project({ "index.ts": "export const ok = 1;\n" });

    const manifest = analyze(dir);

    expect(manifest.packs).toBeDefined();
    expect(manifest.packs?.some((p) => p.id === "php")).toBe(false);
  });
});
