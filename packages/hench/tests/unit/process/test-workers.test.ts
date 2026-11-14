import { describe, it, expect } from "vitest";
import { TEST_MAX_WORKERS_ENV, withTestMaxWorkers } from "../../../src/process/test-workers.js";

/** A parent environment exporting `value` as the cap. */
const exporting = (value: string) => ({ [TEST_MAX_WORKERS_ENV]: value });

describe("withTestMaxWorkers", () => {
  it("returns the same env object when no cap is configured", () => {
    const env = { PATH: "/bin", [TEST_MAX_WORKERS_ENV]: "1" };
    expect(withTestMaxWorkers(env, undefined, env)).toBe(env);
  });

  it("sets the configured cap when none is inherited, without mutating the input", () => {
    const env = { PATH: "/bin" };
    expect(withTestMaxWorkers(env, 2, env)).toEqual({ PATH: "/bin", [TEST_MAX_WORKERS_ENV]: "2" });
    expect(env).toEqual({ PATH: "/bin" });
  });

  it("keeps a lower inherited cap", () => {
    const env = exporting("1");
    expect(withTestMaxWorkers(env, 2, env)[TEST_MAX_WORKERS_ENV]).toBe("1");
  });

  it("lowers a higher inherited cap to the configured one", () => {
    const env = exporting("8");
    expect(withTestMaxWorkers(env, 2, env)[TEST_MAX_WORKERS_ENV]).toBe("2");
  });

  it.each(["", "0", "-1", "2.5", "abc", " "])("replaces an invalid inherited cap %j with the configured one", (inherited) => {
    const env = exporting(inherited);
    expect(withTestMaxWorkers(env, 2, env)[TEST_MAX_WORKERS_ENV]).toBe("2");
  });

  it("reads an inherited cap with surrounding whitespace as the test configs do", () => {
    const env = exporting(" 1 ");
    expect(withTestMaxWorkers(env, 2, env)[TEST_MAX_WORKERS_ENV]).toBe("1");
  });

  it("keeps the parent's lower cap when sanitizing stripped it from env", () => {
    // A repository's guard.env.deny removed the user's export; its cap must not replace it.
    expect(withTestMaxWorkers({ PATH: "/bin" }, 8, exporting("1"))[TEST_MAX_WORKERS_ENV]).toBe("1");
  });
});
