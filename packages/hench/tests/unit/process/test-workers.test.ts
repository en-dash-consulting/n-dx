import { describe, it, expect } from "vitest";
import { TEST_MAX_WORKERS_ENV, withTestMaxWorkers } from "../../../src/process/test-workers.js";

describe("withTestMaxWorkers", () => {
  it("returns the same env object when no cap is configured", () => {
    const env = { PATH: "/bin", [TEST_MAX_WORKERS_ENV]: "1" };
    expect(withTestMaxWorkers(env, undefined)).toBe(env);
  });

  it("sets the configured cap when none is inherited, without mutating the input", () => {
    const env = { PATH: "/bin" };
    expect(withTestMaxWorkers(env, 2)).toEqual({ PATH: "/bin", [TEST_MAX_WORKERS_ENV]: "2" });
    expect(env).toEqual({ PATH: "/bin" });
  });

  it("keeps a lower inherited cap", () => {
    expect(withTestMaxWorkers({ [TEST_MAX_WORKERS_ENV]: "1" }, 2)[TEST_MAX_WORKERS_ENV]).toBe("1");
  });

  it("lowers a higher inherited cap to the configured one", () => {
    expect(withTestMaxWorkers({ [TEST_MAX_WORKERS_ENV]: "8" }, 2)[TEST_MAX_WORKERS_ENV]).toBe("2");
  });

  it.each(["", "0", "-1", "2.5", "abc", " "])("replaces an invalid inherited cap %j with the configured one", (inherited) => {
    expect(withTestMaxWorkers({ [TEST_MAX_WORKERS_ENV]: inherited }, 2)[TEST_MAX_WORKERS_ENV]).toBe("2");
  });

  it("reads an inherited cap with surrounding whitespace as the test configs do", () => {
    expect(withTestMaxWorkers({ [TEST_MAX_WORKERS_ENV]: " 1 " }, 2)[TEST_MAX_WORKERS_ENV]).toBe("1");
  });
});
