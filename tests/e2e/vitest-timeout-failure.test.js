import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

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
      timeout: 10_000,
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

    expect(result.error).toBeUndefined();
    expect(result.signal).toBeNull();
    expect(result.status).toBe(1);
    expect(result.durationMs).toBeLessThan(10_000);
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
