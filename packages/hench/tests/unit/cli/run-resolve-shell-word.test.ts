import { describe, it, expect } from "vitest";
import { shellWord } from "../../../src/cli/commands/run-resolve.js";

describe("shellWord", () => {
  it("leaves a plain word alone on every platform", () => {
    expect(shellWord("/repo/src", "linux")).toBe("/repo/src");
    expect(shellWord("--x=1", "win32")).toBe("--x=1");
  });

  it("single-quotes on POSIX, escaping embedded quotes and backslashes", () => {
    expect(shellWord("/my repo", "linux")).toBe("'/my repo'");
    expect(shellWord("a\\b", "darwin")).toBe("'a\\b'");
    expect(shellWord("it's", "linux")).toBe("'it'\\''s'");
  });

  it("double-quotes a path with spaces on win32", () => {
    expect(shellWord("C:\\My Repo\\app", "win32")).toBe('"C:\\My Repo\\app"');
  });

  it("leaves a backslash path without spaces unquoted on win32", () => {
    expect(shellWord("C:\\repo\\app", "win32")).toBe("C:\\repo\\app");
  });
});
