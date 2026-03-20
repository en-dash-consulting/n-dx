import { describe, it, expect } from "vitest";
import { validatePath, simpleGlobMatch, GuardError } from "../../../src/guard/paths.js";

describe("simpleGlobMatch", () => {
  it("matches exact filenames", () => {
    expect(simpleGlobMatch("foo.txt", "foo.txt")).toBe(true);
    expect(simpleGlobMatch("foo.txt", "bar.txt")).toBe(false);
  });

  it("matches * wildcard (single segment)", () => {
    expect(simpleGlobMatch("*.ts", "foo.ts")).toBe(true);
    expect(simpleGlobMatch("*.ts", "foo.js")).toBe(false);
    expect(simpleGlobMatch("*.ts", "dir/foo.ts")).toBe(false);
  });

  it("matches ** wildcard (multiple segments)", () => {
    expect(simpleGlobMatch("**/*.ts", "foo.ts")).toBe(true);
    expect(simpleGlobMatch("**/*.ts", "src/foo.ts")).toBe(true);
    expect(simpleGlobMatch("**/*.ts", "src/deep/foo.ts")).toBe(true);
    expect(simpleGlobMatch("**/*.ts", "foo.js")).toBe(false);
  });

  it("matches directory prefix patterns", () => {
    expect(simpleGlobMatch(".git/**", ".git/config")).toBe(true);
    expect(simpleGlobMatch(".git/**", ".git/refs/heads")).toBe(true);
    expect(simpleGlobMatch(".git/**", "src/file.ts")).toBe(false);
  });

  it("matches node_modules pattern", () => {
    expect(simpleGlobMatch("node_modules/**", "node_modules/foo/bar.js")).toBe(true);
    expect(simpleGlobMatch("node_modules/**", "src/file.ts")).toBe(false);
  });

  it("matches .hench pattern", () => {
    expect(simpleGlobMatch(".n-dx/hench/**", ".n-dx/hench/config.json")).toBe(true);
    expect(simpleGlobMatch(".n-dx/hench/**", ".n-dx/hench/runs/abc.json")).toBe(true);
  });

  it("matches .rex pattern", () => {
    expect(simpleGlobMatch(".n-dx/rex/**", ".n-dx/rex/prd.json")).toBe(true);
    expect(simpleGlobMatch(".n-dx/rex/**", ".n-dx/rex/config.json")).toBe(true);
  });

  it("matches blocked directory itself, not just children", () => {
    // dir/** must also block "dir" — accessing the directory root is just as dangerous
    expect(simpleGlobMatch(".git/**", ".git")).toBe(true);
    expect(simpleGlobMatch(".n-dx/hench/**", ".n-dx/hench")).toBe(true);
    expect(simpleGlobMatch(".n-dx/rex/**", ".n-dx/rex")).toBe(true);
    expect(simpleGlobMatch("node_modules/**", "node_modules")).toBe(true);
  });

  it("matches ? wildcard correctly", () => {
    expect(simpleGlobMatch("?.ts", "a.ts")).toBe(true);
    expect(simpleGlobMatch("?.ts", "ab.ts")).toBe(false);
    expect(simpleGlobMatch("?.ts", ".ts")).toBe(false); // ? requires exactly one char
    expect(simpleGlobMatch("src/?/file.ts", "src/a/file.ts")).toBe(true);
    expect(simpleGlobMatch("src/?/file.ts", "src//file.ts")).toBe(false); // ? must not match /
  });

  it("handles backslash-separated paths (Windows compatibility)", () => {
    expect(simpleGlobMatch(".git/**", ".git\\config")).toBe(true);
    expect(simpleGlobMatch("src\\**\\*.ts", "src/deep/file.ts")).toBe(true);
  });

  it("does not match unrelated prefixes", () => {
    // ".gitignore" should not be caught by ".git/**"
    expect(simpleGlobMatch(".git/**", ".gitignore")).toBe(false);
    // ".n-dx/henchman" should not be caught by ".n-dx/hench/**"
    expect(simpleGlobMatch(".n-dx/hench/**", ".n-dx/henchman")).toBe(false);
  });
});

describe("validatePath", () => {
  const projectDir = "/project";
  const blockedPaths = [".n-dx/hench/**", ".n-dx/rex/**", ".git/**", "node_modules/**"];

  it("allows valid relative paths", () => {
    const resolved = validatePath("src/file.ts", projectDir, blockedPaths);
    expect(resolved).toBe("/project/src/file.ts");
  });

  it("allows nested valid paths", () => {
    const resolved = validatePath("src/deep/file.ts", projectDir, blockedPaths);
    expect(resolved).toBe("/project/src/deep/file.ts");
  });

  it("rejects paths that escape project directory", () => {
    expect(() =>
      validatePath("../../etc/passwd", projectDir, blockedPaths),
    ).toThrow(GuardError);
  });

  it("rejects absolute paths outside the project", () => {
    expect(() =>
      validatePath("/etc/passwd", projectDir, blockedPaths),
    ).toThrow(GuardError);
  });

  it("rejects internal traversal that escapes the project", () => {
    expect(() =>
      validatePath("src/../../etc/passwd", projectDir, blockedPaths),
    ).toThrow(GuardError);
    expect(() =>
      validatePath("a/b/c/../../../../etc", projectDir, blockedPaths),
    ).toThrow(GuardError);
  });

  it("rejects paths containing null bytes", () => {
    expect(() =>
      validatePath("src/\0malicious", projectDir, blockedPaths),
    ).toThrow(GuardError);
    expect(() =>
      validatePath("foo\0/../../../etc/passwd", projectDir, blockedPaths),
    ).toThrow(GuardError);
  });

  it("rejects blocked directory roots, not just children", () => {
    expect(() =>
      validatePath(".git", projectDir, blockedPaths),
    ).toThrow(GuardError);
    expect(() =>
      validatePath(".n-dx/hench", projectDir, blockedPaths),
    ).toThrow(GuardError);
    expect(() =>
      validatePath(".n-dx/rex", projectDir, blockedPaths),
    ).toThrow(GuardError);
    expect(() =>
      validatePath("node_modules", projectDir, blockedPaths),
    ).toThrow(GuardError);
  });

  it("rejects blocked .hench paths", () => {
    expect(() =>
      validatePath(".n-dx/hench/config.json", projectDir, blockedPaths),
    ).toThrow(GuardError);
  });

  it("rejects blocked .rex paths", () => {
    expect(() =>
      validatePath(".n-dx/rex/prd.json", projectDir, blockedPaths),
    ).toThrow(GuardError);
  });

  it("rejects blocked .git paths", () => {
    expect(() =>
      validatePath(".git/config", projectDir, blockedPaths),
    ).toThrow(GuardError);
  });

  it("rejects blocked node_modules paths", () => {
    expect(() =>
      validatePath("node_modules/foo/bar.js", projectDir, blockedPaths),
    ).toThrow(GuardError);
  });

  it("allows internal traversal that stays within project", () => {
    // src/../lib/file.ts resolves to /project/lib/file.ts — valid
    const resolved = validatePath("src/../lib/file.ts", projectDir, blockedPaths);
    expect(resolved).toBe("/project/lib/file.ts");
  });

  it("allows absolute paths within the project directory", () => {
    const resolved = validatePath("/project/src/file.ts", projectDir, blockedPaths);
    expect(resolved).toBe("/project/src/file.ts");
  });
});
