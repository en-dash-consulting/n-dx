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

  it("leaves a win32 8.3 short path (with ~) unquoted", () => {
    const short = "C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\x";
    expect(shellWord(short, "win32")).toBe(short);
  });

  it("still double-quotes a win32 path with a space and a ~", () => {
    expect(shellWord("C:\\RUNNER~1\\My Repo", "win32")).toBe('"C:\\RUNNER~1\\My Repo"');
  });

  it("single-quotes a POSIX word starting with ~ (tilde expansion)", () => {
    expect(shellWord("~/x", "linux")).toBe("'~/x'");
    expect(shellWord("~/x", "darwin")).toBe("'~/x'");
  });
});
