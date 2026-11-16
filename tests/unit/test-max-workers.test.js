/**
 * The shared vitest worker cap read from NDX_TEST_MAX_WORKERS.
 *
 * Every case passes an env object: tests must not write NDX_* onto the shared
 * worker env (see color-env-neutralized.test.js).
 *
 * @see tests/test-max-workers.mjs
 */

import { describe, it, expect } from "vitest";
import { testMaxWorkers, TEST_MAX_WORKERS_ENV } from "../test-max-workers.mjs";

function read(value) {
  const warnings = [];
  const env = value === undefined ? {} : { [TEST_MAX_WORKERS_ENV]: value };
  const cap = testMaxWorkers(env, (message) => warnings.push(message));
  return { cap, warnings };
}

describe("testMaxWorkers", () => {
  it("returns the cap for a positive integer", () => {
    expect(read("2")).toEqual({ cap: 2, warnings: [] });
    expect(read(" 8 ")).toEqual({ cap: 8, warnings: [] });
  });

  it("returns undefined without a warning when unset or empty", () => {
    expect(read(undefined)).toEqual({ cap: undefined, warnings: [] });
    expect(read("")).toEqual({ cap: undefined, warnings: [] });
    expect(read("  ")).toEqual({ cap: undefined, warnings: [] });
  });

  it.each(["0", "-1", "abc", "2.5", "50%", "1e3", "99999999999999999999"])(
    "ignores %j with a one-line warning",
    (value) => {
      const { cap, warnings } = read(value);
      expect(cap).toBeUndefined();
      expect(warnings).toHaveLength(1);
      expect(warnings[0]).toContain(TEST_MAX_WORKERS_ENV);
      expect(warnings[0]).not.toContain("\n");
    },
  );
});
