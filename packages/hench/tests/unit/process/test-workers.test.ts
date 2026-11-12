import { describe, it, expect } from "vitest";
import { TEST_MAX_WORKERS_ENV, withTestMaxWorkers } from "../../../src/process/test-workers.js";

describe("withTestMaxWorkers", () => {
  it("returns the same env object when no cap is configured", () => {
    const env = { PATH: "/bin" };
    expect(withTestMaxWorkers(env, undefined)).toBe(env);
  });

  it("adds NDX_TEST_MAX_WORKERS without mutating the input", () => {
    const env = { PATH: "/bin" };
    expect(withTestMaxWorkers(env, 2)).toEqual({ PATH: "/bin", [TEST_MAX_WORKERS_ENV]: "2" });
    expect(env).toEqual({ PATH: "/bin" });
  });

  it("overrides an inherited value with the configured cap", () => {
    expect(withTestMaxWorkers({ [TEST_MAX_WORKERS_ENV]: "8" }, 2)[TEST_MAX_WORKERS_ENV]).toBe("2");
  });
});
