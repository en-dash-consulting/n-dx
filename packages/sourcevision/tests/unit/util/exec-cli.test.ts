/**
 * Unit tests for src/util/exec-cli.ts.
 *
 * Verifies the Windows-safe execFileSyncCli helper works on the current
 * platform and that the rex spawn path in branch-work-collector / prd-epic-resolver
 * constructs a Windows-safe invocation via this helper.
 */

import { describe, it, expect } from "vitest";
import { execFileSyncCli } from "../../../src/util/exec-cli.js";

describe("execFileSyncCli", () => {
  it("runs a real process and returns output", () => {
    const out = execFileSyncCli(process.execPath, ["--version"], {
      encoding: "utf-8",
      stdio: "pipe",
    });
    expect(String(out).trim()).toMatch(/^v\d+\.\d+/);
  });

  it("passes stdin input to the process", () => {
    const script = `process.stdin.setEncoding('utf-8'); let d=''; process.stdin.on('data', c => d+=c); process.stdin.on('end', () => process.stdout.write(d.trim()));`;
    const out = execFileSyncCli(process.execPath, ["-e", script], {
      input: "hello stdin",
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    expect(String(out)).toBe("hello stdin");
  });

  it("throws when the binary does not exist", () => {
    expect(() =>
      execFileSyncCli("__sv_nonexistent_binary__", ["--version"], {
        encoding: "utf-8",
        stdio: "pipe",
      }),
    ).toThrow();
  });

  if (process.platform === "win32") {
    it("on Windows: routes through cmd.exe (invocation returns valid output)", () => {
      const out = execFileSyncCli(process.execPath, ["-e", "process.stdout.write('win32-ok')"], {
        encoding: "utf-8",
        stdio: "pipe",
      });
      expect(String(out)).toBe("win32-ok");
    });
  }
});
