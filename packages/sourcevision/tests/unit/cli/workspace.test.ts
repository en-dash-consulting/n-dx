import { describe, it, expect } from "vitest";
import { parseWorkspaceFlags, resolveWorkspaceRoot } from "../../../src/cli/commands/workspace.js";
import { CLIError } from "../../../src/cli/errors.js";

describe("parseWorkspaceFlags", () => {
  it("parses --add with space-separated value", () => {
    const flags = parseWorkspaceFlags(["--add", "packages/api", "."]);
    expect(flags.add).toEqual(["packages/api"]);
  });

  it("parses --add with = syntax", () => {
    const flags = parseWorkspaceFlags(["--add=packages/api", "."]);
    expect(flags.add).toEqual(["packages/api"]);
  });

  it("parses multiple --add flags", () => {
    const flags = parseWorkspaceFlags([
      "--add", "packages/api",
      "--add", "packages/web",
      ".",
    ]);
    expect(flags.add).toEqual(["packages/api", "packages/web"]);
  });

  it("parses --remove with space-separated value", () => {
    const flags = parseWorkspaceFlags(["--remove", "packages/api", "."]);
    expect(flags.remove).toEqual(["packages/api"]);
  });

  it("parses --remove with = syntax", () => {
    const flags = parseWorkspaceFlags(["--remove=packages/api", "."]);
    expect(flags.remove).toEqual(["packages/api"]);
  });

  it("parses --status", () => {
    const flags = parseWorkspaceFlags(["--status", "."]);
    expect(flags.status).toBe(true);
  });

  it("defaults to no flags", () => {
    const flags = parseWorkspaceFlags(["."]);
    expect(flags.add).toEqual([]);
    expect(flags.remove).toEqual([]);
    expect(flags.status).toBe(false);
  });

  it("handles empty args", () => {
    const flags = parseWorkspaceFlags([]);
    expect(flags.add).toEqual([]);
    expect(flags.remove).toEqual([]);
    expect(flags.status).toBe(false);
  });

  it("ignores unrelated flags", () => {
    const flags = parseWorkspaceFlags(["--quiet", "--fast", "."]);
    expect(flags.add).toEqual([]);
    expect(flags.remove).toEqual([]);
    expect(flags.status).toBe(false);
  });

  it("consumes space-separated values, leaving only the root as a positional", () => {
    const flags = parseWorkspaceFlags(["--add", "a", "--add", "b", "ws"]);
    expect(flags.add).toEqual(["a", "b"]);
    expect(flags.positionals).toEqual(["ws"]);
  });

  it("parses --root in both spellings", () => {
    expect(parseWorkspaceFlags(["--root=ws"]).root).toBe("ws");
    expect(parseWorkspaceFlags(["--root", "ws"]).root).toBe("ws");
  });

  it.each([["--add"], ["--add="], ["--remove", "--status"], ["--root="]])(
    "refuses a value flag without a value: %s",
    (...args) => {
      expect(() => parseWorkspaceFlags(args)).toThrow(CLIError);
    },
  );
});

describe("resolveWorkspaceRoot", () => {
  const root = (args: string[]) => resolveWorkspaceRoot(parseWorkspaceFlags(args));

  it("takes the leftover positional after space-separated --add values", () => {
    expect(root(["--add", "a", "--add", "b", "ws"])).toBe("ws");
  });

  it("takes the positional after --add=", () => {
    expect(root(["--add=a", "ws"])).toBe("ws");
  });

  it("takes --root", () => {
    expect(root(["--add=a", "--root=ws"])).toBe("ws");
  });

  it("accepts --root and a positional naming the same directory", () => {
    expect(root(["--root=ws", "./ws"])).toBe("ws");
  });

  it("defaults to the current directory", () => {
    expect(root(["--status"])).toBe(".");
  });

  it("refuses two positionals, naming both", () => {
    expect(() => root(["--add=a", "b", "ws"])).toThrow(/"b" and "ws"/);
  });

  it("refuses --root disagreeing with the positional, naming both", () => {
    expect(() => root(["--root=x", "ws"])).toThrow(/"x".*"ws"/);
  });
});
