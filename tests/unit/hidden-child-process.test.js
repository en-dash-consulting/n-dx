import { describe, it, expect } from "vitest";
import cp, { spawnSync, execFileSync, execSync } from "node:child_process";
import { hidden, optionsIndex } from "../hidden-child-process.js";

/**
 * Every spawn a test makes is hidden on Windows unless it asks not to be.
 *
 * A child that gets its own console gets its own window, and that window takes
 * focus; across ~790 spawn sites that makes a run unusable while anything else
 * is happening. The default lives in the module rather than at each call site —
 * see tests/hidden-child-process.js.
 */
describe("tests spawn hidden on Windows", () => {
  const node = (src) => [process.execPath, ["-e", src]];

  it("resolves node:child_process to the hiding wrapper", () => {
    expect(cp.__hiddenChildProcess, "the vitest alias is not in place").toBe(true);
  });

  it("runs a call that passes options", () => {
    const [bin, args] = node("process.stdout.write('ok')");
    expect(spawnSync(bin, args, { encoding: "utf-8" }).stdout).toBe("ok");
  });

  it("runs a call that passes no options at all", () => {
    const [bin, args] = node("process.stdout.write('ok')");
    expect(String(execFileSync(bin, args))).toBe("ok");
  });

  it("runs a shell call, where the console window would otherwise appear", () => {
    expect(String(execSync(`"${process.execPath}" -e "process.stdout.write('ok')"`))).toBe("ok");
  });

  it("keeps an explicit windowsHide: false", () => {
    const [bin, args] = node("process.stdout.write('ok')");
    const out = spawnSync(bin, args, { encoding: "utf-8", windowsHide: false });
    expect(out.stdout).toBe("ok");
  });

  it("puts windowsHide on the options the real call receives", () => {
    // Accepting the flag is not the same as passing it on: a test that only
    // checked exit codes would pass with the default silently dropped.
    expect(hidden(undefined)).toEqual({ windowsHide: true });
    expect(hidden({ encoding: "utf-8" })).toEqual({ encoding: "utf-8", windowsHide: true });
    expect(hidden({ windowsHide: false })).toEqual({ windowsHide: false });
  });

  it("finds the options argument in each call shape", () => {
    const opts = { cwd: "." };
    const cb = () => {};
    expect(optionsIndex(["cmd", ["a"], opts])).toBe(2);
    expect(optionsIndex(["cmd", opts])).toBe(1);
    expect(optionsIndex(["cmd", ["a"]])).toBe(-1);
    expect(optionsIndex(["cmd", ["a"], opts, cb])).toBe(2);
    expect(optionsIndex(["cmd", cb])).toBe(-1);
  });
});
