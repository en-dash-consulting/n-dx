import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join, resolve } from "node:path";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { symlinksSupported } from "../../helpers/symlinks.js";
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
    expect(simpleGlobMatch(".hench/**", ".hench/config.json")).toBe(true);
    expect(simpleGlobMatch(".hench/**", ".hench/runs/abc.json")).toBe(true);
  });

  it("matches .rex pattern", () => {
    expect(simpleGlobMatch(".rex/**", ".rex/prd.json")).toBe(true);
    expect(simpleGlobMatch(".rex/**", ".rex/config.json")).toBe(true);
  });

  it("matches blocked directory itself, not just children", () => {
    // dir/** must also block "dir" — accessing the directory root is just as dangerous
    expect(simpleGlobMatch(".git/**", ".git")).toBe(true);
    expect(simpleGlobMatch(".hench/**", ".hench")).toBe(true);
    expect(simpleGlobMatch(".rex/**", ".rex")).toBe(true);
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
    // ".henchman" should not be caught by ".hench/**"
    expect(simpleGlobMatch(".hench/**", ".henchman")).toBe(false);
  });
});

describe("validatePath", () => {
  const projectDir = "/project";
  const blockedPaths = [".hench/**", ".rex/**", ".git/**", "node_modules/**"];

  it("allows valid relative paths", () => {
    const resolved = validatePath("src/file.ts", projectDir, blockedPaths);
    expect(resolved).toBe(resolve(projectDir, "src/file.ts"));
  });

  it("allows nested valid paths", () => {
    const resolved = validatePath("src/deep/file.ts", projectDir, blockedPaths);
    expect(resolved).toBe(resolve(projectDir, "src/deep/file.ts"));
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
      validatePath(".hench", projectDir, blockedPaths),
    ).toThrow(GuardError);
    expect(() =>
      validatePath(".rex", projectDir, blockedPaths),
    ).toThrow(GuardError);
    expect(() =>
      validatePath("node_modules", projectDir, blockedPaths),
    ).toThrow(GuardError);
  });

  it("rejects blocked .hench paths", () => {
    expect(() =>
      validatePath(".hench/config.json", projectDir, blockedPaths),
    ).toThrow(GuardError);
  });

  it("rejects blocked .rex paths", () => {
    expect(() =>
      validatePath(".rex/prd.json", projectDir, blockedPaths),
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
    expect(resolved).toBe(resolve(projectDir, "lib/file.ts"));
  });

  it("allows absolute paths within the project directory", () => {
    const resolved = validatePath("/project/src/file.ts", projectDir, blockedPaths);
    expect(resolved).toBe(resolve(projectDir, "src/file.ts"));
  });
});

describe("validatePath real-path resolution", () => {
  const blockedPaths = [".hench/**", ".git/**"];
  let base: string;
  let projectDir: string;
  let outside: string;
  let realProject: string;

  beforeEach(() => {
    base = mkdtempSync(join(tmpdir(), "hench-guard-realpath-"));
    projectDir = join(base, "project");
    outside = join(base, "outside");
    mkdirSync(join(projectDir, "src"), { recursive: true });
    mkdirSync(join(projectDir, ".hench"), { recursive: true });
    mkdirSync(outside, { recursive: true });
    writeFileSync(join(projectDir, "src", "main.ts"), "export const x = 1;\n");
    writeFileSync(join(outside, "secret.txt"), "outside\n");
    realProject = realpathSync.native(projectDir);
  });

  afterEach(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("returns the real path of an existing file", () => {
    expect(validatePath("src/main.ts", projectDir, blockedPaths)).toBe(join(realProject, "src", "main.ts"));
  });

  it("accepts the project directory as given and in its real spelling", () => {
    const expected = join(realProject, "src", "main.ts");
    expect(validatePath(expected, projectDir, blockedPaths)).toBe(expected);
    expect(validatePath("src/main.ts", realProject, blockedPaths)).toBe(expected);
    expect(validatePath(".", projectDir, blockedPaths)).toBe(realProject);
  });

  it("checks a path that does not exist yet at its nearest existing ancestor", () => {
    expect(validatePath("src/deep/new.ts", projectDir, blockedPaths)).toBe(join(realProject, "src", "deep", "new.ts"));
  });

  describe.skipIf(!symlinksSupported())("through symbolic links", () => {
    beforeEach(() => {
      symlinkSync(outside, join(projectDir, "link-out"), "dir");
      symlinkSync(join(outside, "secret.txt"), join(projectDir, "link-file"), "file");
      symlinkSync(join(projectDir, "src"), join(projectDir, "link-in"), "dir");
      symlinkSync(join(projectDir, ".hench"), join(projectDir, "link-state"), "dir");
    });

    it("refuses a link to a directory outside the project, and anything under it", () => {
      expect(() => validatePath("link-out", projectDir, blockedPaths)).toThrow(GuardError);
      expect(() => validatePath("link-out/secret.txt", projectDir, blockedPaths)).toThrow(GuardError);
      // Not created yet: resolved through the link's target all the same.
      expect(() => validatePath("link-out/new/file.txt", projectDir, blockedPaths)).toThrow(GuardError);
    });

    it("refuses a link to a file outside the project", () => {
      expect(() => validatePath("link-file", projectDir, blockedPaths)).toThrow(GuardError);
    });

    it("follows a link that stays inside the project and returns the real path", () => {
      expect(validatePath("link-in/main.ts", projectDir, blockedPaths)).toBe(join(realProject, "src", "main.ts"));
    });

    it("applies blocked patterns to the real location", () => {
      expect(() => validatePath("link-state/config.json", projectDir, blockedPaths)).toThrow(/blocked pattern/);
    });

    it("applies blocked patterns to the path as given", () => {
      symlinkSync(join(projectDir, "src"), join(projectDir, ".git"), "dir");
      expect(() => validatePath(".git/main.ts", projectDir, blockedPaths)).toThrow(/blocked pattern/);
    });

    it("refuses a dangling link whose target lies outside the project", () => {
      // The target does not exist: realpath fails, but a write through the
      // link would create it outside the project.
      symlinkSync(join(outside, "LaunchAgents", "x.plist"), join(projectDir, "notes.md"), "file");
      expect(() => validatePath("notes.md", projectDir, blockedPaths)).toThrow(/outside project/);
    });

    it("applies blocked patterns to a dangling link's target", () => {
      mkdirSync(join(projectDir, ".git", "hooks"), { recursive: true });
      symlinkSync(join(projectDir, ".git", "hooks", "pre-commit"), join(projectDir, "x"), "file");
      expect(() => validatePath("x", projectDir, blockedPaths)).toThrow(/blocked pattern/);
    });

    it("refuses a path under a dangling directory link that leaves the project", () => {
      symlinkSync(join(outside, "not-yet"), join(projectDir, "gone"), "dir");
      expect(() => validatePath("gone/new/file.txt", projectDir, blockedPaths)).toThrow(/outside project/);
    });

    it("resolves a dangling link that stays inside the project to its target", () => {
      symlinkSync(join(projectDir, "src", "later.ts"), join(projectDir, "alias.ts"), "file");
      expect(validatePath("alias.ts", projectDir, blockedPaths)).toBe(join(realProject, "src", "later.ts"));
    });

    it("reads a dangling link's relative target from the link's real directory", () => {
      // a/b/to-src -> src. Inside src, "up" -> "../../escaped" climbs from
      // src to the project's parent, although spelled through a/b/to-src it
      // reads lexically as a/escaped, inside the project.
      mkdirSync(join(projectDir, "a", "b"), { recursive: true });
      symlinkSync(join(projectDir, "src"), join(projectDir, "a", "b", "to-src"), "dir");
      symlinkSync(join("..", "..", "escaped"), join(projectDir, "src", "up"), "file");
      expect(() => validatePath("a/b/to-src/up", projectDir, blockedPaths)).toThrow(/outside project/);
      // Spelled through an in-project link, a relative target still lands
      // where the kernel would put it.
      mkdirSync(join(projectDir, "src", "nested"));
      symlinkSync("../later.ts", join(projectDir, "src", "nested", "rel.ts"), "file");
      expect(validatePath("link-in/nested/rel.ts", projectDir, blockedPaths)).toBe(join(realProject, "src", "later.ts"));
    });

    it("refuses a chain of links that loops", () => {
      symlinkSync(join(projectDir, "loop-b"), join(projectDir, "loop-a"), "file");
      symlinkSync(join(projectDir, "loop-a"), join(projectDir, "loop-b"), "file");
      expect(() => validatePath("loop-a", projectDir, blockedPaths)).toThrow(GuardError);
    });
  });
});
