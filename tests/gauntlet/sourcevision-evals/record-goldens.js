/**
 * Records sourcevision eval goldens by running `sv analyze` against each
 * fixture project and writing a trimmed snapshot to golden.json next to it.
 *
 * The snapshot captures only deterministic-enough fields — per-file
 * archetype assignment and zone partition by file membership — so that
 * baseline-vs-self comparisons survive LLM nondeterminism on zone names
 * and descriptions.
 *
 * Default mode is `fast` (algorithmic only, no LLM calls). Pass `--full`
 * to record goldens with LLM enrichment enabled. Only run with `--full`
 * when you intend to spend tokens — the gauntlet eval test reads goldens
 * as-is regardless of how they were recorded.
 *
 * Usage:
 *   node tests/gauntlet/sourcevision-evals/record-goldens.js [--full]
 *   pnpm gauntlet:evals:record
 */

import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURES_DIR = join(REPO_ROOT, "tests/fixtures/sv-evals");
const SV_CLI = join(REPO_ROOT, "packages/sourcevision/dist/cli/index.js");
const FIXTURES = ["toy-app", "medium-app"];

function runAnalyze(fixtureDir, mode) {
  const svDir = join(fixtureDir, ".sourcevision");
  if (existsSync(svDir)) rmSync(svDir, { recursive: true, force: true });

  const args = [SV_CLI, "analyze", fixtureDir];
  if (mode === "fast") args.push("--fast");

  const r = spawnSync("node", args, { stdio: ["ignore", "pipe", "inherit"] });
  if (r.status !== 0) {
    throw new Error(`sv analyze failed for ${fixtureDir} (exit ${r.status})`);
  }
}

function recordGolden(fixtureDir, mode) {
  const svDir = join(fixtureDir, ".sourcevision");
  const classifications = JSON.parse(readFileSync(join(svDir, "classifications.json"), "utf8"));
  const zones = JSON.parse(readFileSync(join(svDir, "zones.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(join(svDir, "manifest.json"), "utf8"));

  const golden = {
    recordedWith: mode,
    svVersion: manifest.toolVersion,
    files: classifications.files
      .map((f) => ({ path: f.path, archetype: f.archetype ?? null }))
      .sort((a, b) => a.path.localeCompare(b.path)),
    zones: zones.zones
      .map((z) => ({ id: z.id, files: [...z.files].sort() }))
      .sort((a, b) => a.id.localeCompare(b.id)),
  };

  const goldenPath = join(fixtureDir, "golden.json");
  writeFileSync(goldenPath, JSON.stringify(golden, null, 2) + "\n");
  return { path: goldenPath, fileCount: golden.files.length, zoneCount: golden.zones.length };
}

function main() {
  const mode = process.argv.includes("--full") ? "full" : "fast";
  console.log(`Recording goldens (mode: ${mode}, LLM: ${mode === "full" ? "enabled" : "disabled"})`);

  for (const name of FIXTURES) {
    const dir = join(FIXTURES_DIR, name);
    if (!existsSync(dir)) throw new Error(`Fixture missing: ${dir}`);
    console.log(`\n[${name}] analyzing…`);
    runAnalyze(dir, mode);
    const out = recordGolden(dir, mode);
    console.log(`  → golden.json (${out.fileCount} files, ${out.zoneCount} zones)`);
  }
  console.log("\nDone.");
}

main();
