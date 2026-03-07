import { describe, it, expect } from "vitest";
import { parseWorkspaceFlags } from "../../../src/cli/commands/workspace.js";

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
});
