/**
 * Every vitest config takes its worker cap from the shared helper.
 *
 * A config that drops it runs on every core whatever NDX_TEST_MAX_WORKERS
 * says, and nothing fails: the host is simply oversubscribed again. The
 * assertion is therefore on the configs. The rex bench config is exempt: it
 * already runs one file at a time.
 *
 * @see tests/test-max-workers.mjs
 */

import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";

const ROOT = join(import.meta.dirname, "../..");

describe("vitest configs cap workers from NDX_TEST_MAX_WORKERS", () => {
  const configs = ["vitest.config.js"];
  for (const pkg of readdirSync(join(ROOT, "packages"))) {
    const rel = `packages/${pkg}/vitest.config.ts`;
    if (existsSync(join(ROOT, rel))) configs.push(rel);
  }

  it("finds the configs it is meant to check", () => {
    expect(configs.length).toBeGreaterThan(4);
    expect(configs).toContain("vitest.config.js");
  });

  it("every config sets test.maxWorkers from testMaxWorkers()", () => {
    const missing = configs.filter((rel) => {
      const src = readFileSync(join(ROOT, rel), "utf-8");
      return !/test-max-workers\.mjs["']/.test(src) || !/maxWorkers:\s*testMaxWorkers\(\)/.test(src);
    });
    expect(
      missing,
      "These vitest configs do not set `maxWorkers: testMaxWorkers()` from " +
        "tests/test-max-workers.mjs, so NDX_TEST_MAX_WORKERS does not bound them.",
    ).toEqual([]);
  });
});
