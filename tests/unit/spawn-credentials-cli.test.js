/**
 * `spawnCredentialsCli` turns a spawn refused before it starts into an
 * ordinary failure, so `ndx config` prints one line instead of a stack.
 */
import { describe, it, expect } from "vitest";
import { spawnCredentialsCli } from "../../packages/core/config.js";
import { assertNoWindowsEnvExpansion } from "../../packages/core/win-spawn.js";

describe("spawnCredentialsCli", () => {
  it("reports a Windows %NAME% refusal as one stderr line, no stack", () => {
    // The Windows branch of spawnSyncCli, against a path cmd.exe would expand.
    const refusingSpawn = (binary, args) => {
      assertNoWindowsEnvExpansion(["C:\\Users\\%USERNAME%\\node.exe", binary, ...args], { USERNAME: "x" });
      throw new Error("unreachable");
    };
    const result = spawnCredentialsCli(["status"], undefined, refusingSpawn);
    expect(result.code).toBe(1);
    expect(result.stdout).toBe("");
    expect(result.stderr).toMatch(/^Refusing to spawn: .*%USERNAME%/);
    expect(result.stderr.trim().split("\n")).toHaveLength(1);
    expect(result.stderr).not.toMatch(/\n\s+at /);
  });

  it("passes a spawn's exit status and streams through", () => {
    const spawn = () => ({ status: 3, stdout: "out", stderr: "bad store" });
    expect(spawnCredentialsCli(["status"], undefined, spawn)).toEqual({ code: 3, stdout: "out", stderr: "bad store" });
  });
});
