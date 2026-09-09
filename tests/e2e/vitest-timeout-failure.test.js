import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

/**
 * Hang guardrail for the nested vitest run — the point past which spawnSync
 * kills it.
 *
 * Shared with the duration assertion below on purpose. The two used to be
 * separate literals that happened to be equal (`timeout: 10_000` and
 * `expect(durationMs).toBeLessThan(10_000)`), which reads as a latency budget
 * and is not one: spawnSync terminates the child *at* this number, so a reading
 * at or above it never means "slow", it means "killed". Written as two literals
 * they could also drift apart, and raising the guardrail alone would have
 * silently turned the assertion into one that can never fail.
 *
 * See TESTING.md, Family 2: "never scale a bound whose job is to sit below
 * another number — express it as a fraction of the number it must stay under".
 * Here the bound *is* that number, so it is named once.
 */
const FIXTURE_SPAWN_TIMEOUT_MS = 10_000;

function runVitestTimeoutFixture() {
  const repoRoot = process.cwd();
  const fixtureDir = mkdtempSync(join(tmpdir(), "ndx-vitest-timeout-"));
  const cleanupFile = join(fixtureDir, "cleanup.json");
  const testFile = join(fixtureDir, "fixture.test.js");
  const configFile = join(fixtureDir, "vitest.config.js");
  const vitestBin = join(repoRoot, "node_modules", "vitest", "vitest.mjs");

  mkdirSync(fixtureDir, { recursive: true });

  writeFileSync(
    configFile,
    `
export default {
  test: {
    include: ["**/*.test.js"],
    silent: true,
  },
};
`,
  );

  writeFileSync(
    testFile,
    `
import { afterEach, describe, expect, it } from "vitest";
import { writeFileSync } from "node:fs";

const cleanupFile = ${JSON.stringify(cleanupFile)};
let timer = null;

describe("timeout fixture", () => {
  afterEach(() => {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    writeFileSync(cleanupFile, JSON.stringify({ cleaned: true }));
  });

  it("fails with a Vitest timeout", async () => {
    timer = setInterval(() => {}, 1000);
    await new Promise(() => {});
  }, 150);

  it("keeps fast tests passing", () => {
    expect(2 + 2).toBe(4);
  });
});
`,
  );

  const startedAt = Date.now();
  const result = spawnSync(
    process.execPath,
    [vitestBin, "run", "fixture.test.js", "--config", "vitest.config.js"],
    {
      cwd: fixtureDir,
      encoding: "utf-8",
      timeout: FIXTURE_SPAWN_TIMEOUT_MS,
    },
  );

  return {
    ...result,
    durationMs: Date.now() - startedAt,
    cleanupFile,
  };
}

describe("Vitest timeout failures", () => {
  it("surface as standard failures and still tear down timed-out work", () => {
    const result = runVitestTimeoutFixture();
    const output = `${result.stdout}\n${result.stderr}`;

    // These three are what establish the nested run completed on its own rather
    // than being killed by the guardrail.
    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(1);
    // Same claim, stated on the clock: a reading at the guardrail means the run
    // was terminated, not that it was slow. Kept as a second reading of the same
    // fact because it names the number in the failure message, which is what
    // makes a killed run diagnosable instead of an opaque signal mismatch.
    expect(
      result.durationMs,
      `nested vitest run took ${result.durationMs}ms against a ${FIXTURE_SPAWN_TIMEOUT_MS}ms ` +
      `spawn guardrail — at or above it, spawnSync terminated the run, so raise the ` +
      `guardrail (a real product hang would still fail on status/output) rather than ` +
      `treating this as a latency regression`,
    ).toBeLessThan(FIXTURE_SPAWN_TIMEOUT_MS);
    expect(output).toMatch(/Test timed out in 150ms/);
    expect(output).toContain("fails with a Vitest timeout");
    // "keeps fast tests passing" is no longer surfaced by name in vitest v4's
    // default reporter — passing tests are only counted, not listed by name.
    // The count assertions below confirm the second test ran and passed.
    expect(output).toMatch(/1 failed/);
    expect(output).toMatch(/1 passed/);

    const cleanup = JSON.parse(readFileSync(result.cleanupFile, "utf-8"));
    expect(cleanup).toEqual({ cleaned: true });
  });
});
