/**
 * `ndx ci`'s structure-health step against the built rex CLI.
 *
 * v2: `rex health --format=json` prints `{ treeRules, warnings }` with no score,
 * so the step must gate on rex health's exit code and never print "undefined".
 * v1: the score-based step is unchanged.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn, execFileSync } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { runRexPhase } from "../../packages/core/ci.js";

const ROOT = resolve(import.meta.dirname, "../..");
const REX = join(ROOT, "packages/rex/dist/cli/index.js");
const V2_FIXTURE = join(ROOT, "packages/rex/tests/fixtures/v2-tree");
const CAPABILITY_FILE = ["product", "checkout", "pay-by-card.md"];

let dir;
let lines;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "ci-structure-health-"));
  lines = [];
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

async function structureHealth() {
  const { steps } = await runRexPhase(dir, (...a) => lines.push(a.join(" ")), false, { rex: REX }, spawn);
  return steps.find((s) => s.name === "structure-health");
}

async function setUpV2() {
  const rexDir = join(dir, ".rex");
  await cp(V2_FIXTURE, rexDir, { recursive: true });
  await writeFile(join(rexDir, "config.json"), JSON.stringify({ schema: "rex/v1", project: "t", adapter: "file" }));
  return rexDir;
}

describe("ndx ci structure health on a v2 tree", () => {
  it("passes a clean tree and shows error and warning counts", async () => {
    await setUpV2();
    const step = await structureHealth();
    expect(step.ok).toBe(true);
    expect(step.detail).toMatch(/^tree rules: 0 errors, \d+ warnings?$/);
    expect(lines.join("\n")).toContain("✓ structure health (tree rules: 0 errors");
    expect(lines.join("\n")).not.toContain("undefined");
  });

  it("fails when a tree rule reports an error", async () => {
    const rexDir = await setUpV2();
    const file = join(rexDir, ...CAPABILITY_FILE);
    const text = await readFile(file, "utf-8");
    await writeFile(file, text.replace("criteria: [", 'dependsOn: ["a0000000-0000-4000-8000-000000000099"]\ncriteria: ['));
    const step = await structureHealth();
    expect(step.ok).toBe(false);
    expect(step.detail).toMatch(/^tree rules: [1-9]\d* errors?, /);
    expect(lines.join("\n")).toContain("✗ structure health (tree rules:");
    expect(lines.join("\n")).not.toContain("undefined");
  });

  it("fails when the reader skipped a node, and counts it", async () => {
    const rexDir = await setUpV2();
    const file = join(rexDir, ...CAPABILITY_FILE);
    await writeFile(file, (await readFile(file, "utf-8")).replace('type: "capability"', 'type: "bogus"'));
    const step = await structureHealth();
    expect(step.ok).toBe(false);
    expect(step.detail).toContain("1 node skipped");
    expect(lines.join("\n")).toContain("Invalid node intent, skipped");
  });
});

describe("ndx ci structure health on a v1 tree", () => {
  it("keeps the score-based step", async () => {
    execFileSync(process.execPath, [REX, "init", dir], { stdio: "ignore" });
    const step = await structureHealth();
    expect(step.ok).toBe(true);
    expect(step.detail).toMatch(/^score: \d+\/100/);
    expect(lines.join("\n")).toMatch(/✓ structure health \(score: \d+\)/);
  });
});
