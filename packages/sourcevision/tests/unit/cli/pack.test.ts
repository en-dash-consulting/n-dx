/**
 * `sv pack add|list|remove` over the per-user pack directory, with a fake npm
 * (no network) and the test ndx home (tests/setup-ndx-home.ts).
 */

import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { goConfig, javaConfig, terraformConfig, type LanguageConfig, type LanguagePackEntry } from "@n-dx/lang-kit";
import { resolveNdxHome } from "@n-dx/llm-client";
import { cmdPack, type NpmResult, type PackCommandDeps } from "../../../src/cli/commands/pack.js";
import type { InstallablePack } from "../../../src/language/pack-loader.js";

const VERSION = "1.2.3";

const entryFor = (packageName: string, config: LanguageConfig, version = VERSION): LanguagePackEntry => ({
  packageName,
  version,
  id: config.id,
  config,
  produces: ["imports", "symbols"],
  analyzeProject: async () => ({ facts: [], unparsed: [] }),
});

const notFound = (name: string): Error =>
  Object.assign(new Error(`Cannot find package '${name}' imported from /x/pack-loader.js`), { code: "ERR_MODULE_NOT_FOUND" });

const sqlConfig: LanguageConfig = { ...terraformConfig, id: "sql" };

/** Stub packs: java and terraform not resolvable, go resolvable, sql not resolvable. */
const PACKS: InstallablePack[] = [
  { id: "java", packageName: "@n-dx/lang-java", importByResolution: () => Promise.reject(notFound("@n-dx/lang-java")) },
  { id: "go", packageName: "@n-dx/lang-go", importByResolution: async () => ({ pack: entryFor("@n-dx/lang-go", goConfig) }) },
  { id: "sql", packageName: "@n-dx/lang-sql", importByResolution: () => Promise.reject(notFound("@n-dx/lang-sql")) },
  { id: "terraform", packageName: "@n-dx/lang-terraform", importByResolution: () => Promise.reject(notFound("@n-dx/lang-terraform")) },
];
const CONFIGS: Record<string, LanguageConfig> = { java: javaConfig, go: goConfig, sql: sqlConfig, terraform: terraformConfig };

let packDir: string;
let lines: string[];
let npmCalls: string[][];

/** Lay a pack out in the pack directory as `npm install --prefix` would. */
function installInPackDir(packageName: string, version = VERSION): void {
  const dir = join(packDir, "node_modules", ...packageName.split("/"));
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: packageName, version, exports: { ".": { import: "./index.js" } } }));
}

/** Imports from the pack directory: the entry of whichever pack the URL names, at the version on disk. */
const importFile = async (url: string): Promise<unknown> => {
  const pack = PACKS.find((p) => url.includes(p.packageName.split("/")[1]!))!;
  return { pack: entryFor(pack.packageName, CONFIGS[pack.id]!) };
};

/** A fake npm: records its arguments, then does `effect` and reports `result`. */
function fakeNpm(effect: (args: readonly string[]) => void = () => {}, result: Partial<NpmResult> = {}) {
  return async (args: readonly string[]): Promise<NpmResult> => {
    npmCalls.push([...args]);
    effect(args);
    return { launched: true, exitCode: 0, output: "", ...result };
  };
}

const deps = (overrides: Partial<PackCommandDeps> = {}): PackCommandDeps => ({
  packs: PACKS,
  packDir,
  version: VERSION,
  importFile,
  write: (line) => lines.push(line),
  npm: fakeNpm(),
  ...overrides,
});

beforeEach(() => {
  packDir = join(mkdtempSync(join(tmpdir(), "sv-pack-cmd-")), "packs", VERSION);
  lines = [];
  npmCalls = [];
});

afterEach(() => rmSync(join(packDir, "..", ".."), { recursive: true, force: true }));

describe("sv pack add", () => {
  it("installs the pack at sourcevision's version into the pack directory, creating it, and reports what loaded", async () => {
    await cmdPack(["add", "java"], deps({ npm: fakeNpm(() => installInPackDir("@n-dx/lang-java")) }));
    expect(npmCalls).toEqual([["install", "--prefix", packDir, `@n-dx/lang-java@${VERSION}`]]);
    expect(existsSync(packDir)).toBe(true);
    expect(lines).toEqual([`Installed @n-dx/lang-java@${VERSION} into ${packDir} (produces imports, symbols).`]);
  });

  it("says when sourcevision does not analyze the language with a pack yet", async () => {
    await cmdPack(["add", "sql"], deps({ npm: fakeNpm(() => installInPackDir("@n-dx/lang-sql")) }));
    expect(lines[1]).toBe("sourcevision does not analyze sql with a pack yet; the pack is ready for when it does.");
  });

  it("refuses an unknown language with the known ones, without running npm", async () => {
    await expect(cmdPack(["add", "cobol"], deps())).rejects.toMatchObject({
      message: "Unknown language pack: cobol",
      suggestion: "Known packs: java, go, sql, terraform.",
    });
    await expect(cmdPack(["add"], deps())).rejects.toThrow("Missing language");
    expect(npmCalls).toEqual([]);
  });

  it("fails with npm's output when npm fails", async () => {
    const npm = fakeNpm(() => {}, { exitCode: 1, output: "npm error 404 Not Found - @n-dx/lang-java@1.2.3\n" });
    await expect(cmdPack(["add", "java"], deps({ npm }))).rejects.toThrow(/failed \(exit 1\)[\s\S]*npm error 404 Not Found/);
  });

  it("fails when npm cannot be started", async () => {
    const npm = fakeNpm(() => {}, { launched: false, exitCode: null, output: "spawn npm ENOENT" });
    await expect(cmdPack(["add", "java"], deps({ npm }))).rejects.toMatchObject({
      message: expect.stringContaining("spawn npm ENOENT"),
      suggestion: "Is npm on your PATH?",
    });
  });

  it("fails, with npm's output, when the installed pack is of another version", async () => {
    const npm = fakeNpm(() => installInPackDir("@n-dx/lang-java", "1.0.0"), { output: "added 1 package\n" });
    await expect(cmdPack(["add", "java"], deps({ npm }))).rejects.toThrow(
      /installed but cannot be used: pack @n-dx\/lang-java@1\.0\.0 does not match @n-dx\/sourcevision@1\.2\.3[\s\S]*added 1 package/,
    );
    expect(lines).toEqual([]);
  });

  it("fails when npm succeeds but the pack is not in the pack directory", async () => {
    await expect(cmdPack(["add", "go"], deps())).rejects.toThrow(`did not install @n-dx/lang-go into ${packDir}`);
  });

  it("prints the command for --dry-run, into the ndx home's pack directory, and runs nothing", async () => {
    const { packDir: _ignored, ...rest } = deps();
    await cmdPack(["add", "java", "--dry-run"], rest);
    const home = join(resolveNdxHome(), "packs", VERSION);
    expect(lines).toEqual([`npm install --prefix ${home} @n-dx/lang-java@${VERSION}`]);
    expect(npmCalls).toEqual([]);
    expect(existsSync(home)).toBe(false);
  });

  it("quotes a pack directory with spaces in the printed command", async () => {
    await cmdPack(["add", "java", "--dry-run"], deps({ packDir: "/Users/a b/.ndx/packs/1.2.3" }));
    expect(lines).toEqual([`npm install --prefix "/Users/a b/.ndx/packs/1.2.3" @n-dx/lang-java@${VERSION}`]);
  });
});

describe("sv pack list", () => {
  beforeEach(() => {
    installInPackDir("@n-dx/lang-java");
    installInPackDir("@n-dx/lang-terraform", "1.0.0");
  });

  it("reports each pack as installed, resolved, missing or refused, with its version", async () => {
    await cmdPack(["list"], deps());
    expect(lines).toEqual([
      `Pack directory: ${packDir}`,
      `java       installed  @n-dx/lang-java@${VERSION}  in the pack directory`,
      `go         resolved   @n-dx/lang-go@${VERSION}  found by module resolution`,
      "sql        missing    @n-dx/lang-sql  Install it with `ndx sv pack add sql`. (not analyzed yet)",
      `terraform  refused    @n-dx/lang-terraform@1.0.0  pack @n-dx/lang-terraform@1.0.0 does not match @n-dx/sourcevision@${VERSION} and was not used. ` +
        "Install the matching pack with `ndx sv pack add terraform`. (not analyzed yet)",
    ]);
  });

  it("prints the same as JSON with --json", async () => {
    await cmdPack(["list", "--json"], deps());
    const out = JSON.parse(lines.join("\n")) as { packDir: string; version: string; packs: Array<Record<string, unknown>> };
    expect(out.packDir).toBe(packDir);
    expect(out.version).toBe(VERSION);
    expect(out.packs.map((p) => [p["id"], p["status"], p["version"], p["analyzed"]])).toEqual([
      ["java", "installed", VERSION, true],
      ["go", "resolved", VERSION, true],
      ["sql", "missing", undefined, false],
      ["terraform", "refused", "1.0.0", false],
    ]);
  });
});

describe("sv pack remove", () => {
  it("uninstalls a pack from the pack directory", async () => {
    installInPackDir("@n-dx/lang-java");
    await cmdPack(["remove", "java"], deps());
    expect(npmCalls).toEqual([["uninstall", "--prefix", packDir, "@n-dx/lang-java"]]);
    expect(lines).toEqual([`Removed @n-dx/lang-java from ${packDir}.`]);
  });

  it("does nothing for a pack found only by module resolution, and says so", async () => {
    await cmdPack(["remove", "go"], deps());
    expect(npmCalls).toEqual([]);
    expect(lines[0]).toContain("found by module resolution, which pack remove does not change. Nothing removed.");
  });

  it("does nothing for a pack that is not installed", async () => {
    await cmdPack(["remove", "sql"], deps());
    expect(npmCalls).toEqual([]);
    expect(lines).toEqual([`@n-dx/lang-sql is not installed in ${packDir}. Nothing removed.`]);
  });

  it("fails with npm's output when npm uninstall fails", async () => {
    installInPackDir("@n-dx/lang-java");
    const npm = fakeNpm(() => {}, { exitCode: 1, output: "npm error EACCES\n" });
    await expect(cmdPack(["remove", "java"], deps({ npm }))).rejects.toThrow(/EACCES/);
  });
});

describe("sv pack", () => {
  it("refuses an unknown subcommand", async () => {
    await expect(cmdPack(["install", "java"], deps())).rejects.toThrow("Unknown pack command: install");
    await expect(cmdPack([], deps())).rejects.toThrow("Missing pack command");
  });
});
