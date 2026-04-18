/**
 * Sourcevision eval gate.
 *
 * For each fixture under tests/fixtures/sv-evals/, runs `sv analyze`
 * and scores the result against the committed golden.json. The test
 * fails if any score drops below its floor — catching silent regressions
 * from future token-reduction work (model swaps, heuristic classifiers,
 * payload trimming, etc.).
 *
 * This suite is NOT part of `pnpm gauntlet`. It is only run via
 * `pnpm gauntlet:evals` because sv analyze has non-trivial wall-clock
 * cost and, in --full mode, real token cost. Keeping it out of the
 * default gate avoids gratuitous LLM spend on every PR.
 *
 * Floor thresholds are calibrated to the recorder's default (--fast)
 * mode. When goldens are re-recorded with --full, thresholds may need
 * to be loosened for LLM-assigned archetypes.
 */

import { describe, it, expect, beforeAll } from "vitest";
import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { archetypeAccuracy, zonePartitionSimilarity, projectForScoring } from "./score.js";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const FIXTURES_DIR = join(REPO_ROOT, "tests/fixtures/sv-evals");
const SV_CLI = join(REPO_ROOT, "packages/sourcevision/dist/cli/index.js");

const FIXTURES = [
  { name: "toy-app", floors: { archetype: 1.0, zone: 1.0 } },
  { name: "medium-app", floors: { archetype: 1.0, zone: 1.0 } },
];

function runAnalyze(fixtureDir) {
  const svDir = join(fixtureDir, ".sourcevision");
  if (existsSync(svDir)) rmSync(svDir, { recursive: true, force: true });
  const r = spawnSync("node", [SV_CLI, "analyze", fixtureDir, "--fast"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.status !== 0) {
    throw new Error(
      `sv analyze failed for ${fixtureDir} (exit ${r.status})\n${r.stderr?.toString() ?? ""}`,
    );
  }
}

function readSvOutput(fixtureDir) {
  const svDir = join(fixtureDir, ".sourcevision");
  return {
    classifications: JSON.parse(readFileSync(join(svDir, "classifications.json"), "utf8")),
    zones: JSON.parse(readFileSync(join(svDir, "zones.json"), "utf8")),
  };
}

describe("sourcevision eval gate", () => {
  beforeAll(() => {
    if (!existsSync(SV_CLI)) {
      throw new Error(`sourcevision CLI not built at ${SV_CLI}. Run \`pnpm build\` first.`);
    }
  });

  for (const { name, floors } of FIXTURES) {
    describe(name, () => {
      const fixtureDir = join(FIXTURES_DIR, name);
      const goldenPath = join(fixtureDir, "golden.json");
      let scores;

      beforeAll(() => {
        if (!existsSync(goldenPath)) {
          throw new Error(
            `Golden missing at ${goldenPath}. Run \`pnpm gauntlet:evals:record\` first.`,
          );
        }
        const golden = JSON.parse(readFileSync(goldenPath, "utf8"));
        runAnalyze(fixtureDir);
        const actual = projectForScoring(readSvOutput(fixtureDir));
        scores = {
          archetype: archetypeAccuracy(golden, actual),
          zone: zonePartitionSimilarity(golden, actual),
        };
      });

      it(`archetype accuracy >= ${floors.archetype}`, () => {
        expect(scores.archetype).toBeGreaterThanOrEqual(floors.archetype);
      });

      it(`zone partition similarity >= ${floors.zone}`, () => {
        expect(scores.zone).toBeGreaterThanOrEqual(floors.zone);
      });
    });
  }
});
