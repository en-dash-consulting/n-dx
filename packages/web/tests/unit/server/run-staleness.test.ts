/**
 * The pid probe behind the Live route's liveness verdicts. Hench's canonical
 * copy is pinned to this one by `tests/e2e/run-liveness-parity.test.js`.
 */

import { describe, it, expect, afterEach } from "vitest";
import { isPidAlive } from "../../../src/server/run-staleness.js";

const original = process.kill;
afterEach(() => {
  process.kill = original;
});

/** Simulate a busy Windows host: OpenProcess drops a pid's low two bits, so kill reaches a real process. */
function killReachesAProcess(outcome: "succeeds" | "EPERM"): void {
  process.kill = (() => {
    if (outcome === "EPERM") throw Object.assign(new Error("EPERM"), { code: "EPERM" });
    return true;
  }) as typeof process.kill;
}

describe("isPidAlive", () => {
  it("counts this process as alive", () => {
    expect(isPidAlive(process.pid)).toBe(true);
  });

  for (const outcome of ["succeeds", "EPERM"] as const) {
    it(`on win32, counts a pid that is not a multiple of 4 as dead when kill ${outcome}`, () => {
      killReachesAProcess(outcome);
      for (const pid of [4242, 4241, 4243, 1]) expect(isPidAlive(pid, "win32")).toBe(false);
      expect(isPidAlive(4240, "win32")).toBe(true);
    });
  }

  it("leaves other platforms to kill", () => {
    killReachesAProcess("succeeds");
    expect(isPidAlive(4242, "linux")).toBe(true);
    expect(isPidAlive(4242, "darwin")).toBe(true);
  });

  it("counts a non-positive or non-integer pid as dead", () => {
    killReachesAProcess("succeeds");
    for (const pid of [0, -1, 1.5, Number.NaN]) expect(isPidAlive(pid, "linux")).toBe(false);
  });
});
