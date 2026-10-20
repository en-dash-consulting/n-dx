/**
 * `sv pack add|bundle|list|remove` over the per-user pack directory, with a fake npm
 * (no network) and the test ndx home (tests/setup-ndx-home.ts).
 */

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { goConfig, javaConfig, terraformConfig, type LanguageConfig, type LanguagePackEntry } from "@n-dx/lang-kit";
import { resolveNdxHome } from "@n-dx/llm-client";
import { cmdPack, dependencyClosure, type NpmResult, type PackCommandDeps } from "../../../src/cli/commands/pack.js";
import { readTarGz, writeTarGz } from "../../../src/cli/commands/pack-archive.js";
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
  listed: [],
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
    expect(npmCalls).toEqual([["install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", packDir, `@n-dx/lang-java@${VERSION}`]]);
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
    await expect(cmdPack(["bundle"], deps())).rejects.toThrow("Missing language");
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
    expect(lines).toEqual([`npm install --ignore-scripts --no-audit --no-fund --prefix ${home} @n-dx/lang-java@${VERSION}`]);
    expect(npmCalls).toEqual([]);
    expect(existsSync(home)).toBe(false);
  });

  it("quotes a pack directory with spaces in the printed command", async () => {
    await cmdPack(["add", "java", "--dry-run"], deps({ packDir: "/Users/a b/.ndx/packs/1.2.3" }));
    expect(lines).toEqual([`npm install --ignore-scripts --no-audit --no-fund --prefix "/Users/a b/.ndx/packs/1.2.3" @n-dx/lang-java@${VERSION}`]);
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
        "Install the matching pack with `ndx sv pack add terraform`.",
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
      ["terraform", "refused", "1.0.0", true],
    ]);
  });
});

describe("the project's pack list (sourcevision.packs)", () => {
  it("add with no language installs each listed pack that is not installed, as add <lang> would", async () => {
    installInPackDir("@n-dx/lang-sql");
    const npm = fakeNpm((args) => installInPackDir(args.at(-1)!.replace(/@[^@/]+$/, "")));
    await cmdPack(["add"], deps({ listed: ["java", "go", "sql", "java"], npm }));
    expect(npmCalls).toEqual([["install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix", packDir, `@n-dx/lang-java@${VERSION}`]]);
    expect(lines).toEqual([
      `Installed @n-dx/lang-java@${VERSION} into ${packDir} (produces imports, symbols).`,
      "@n-dx/lang-go is already installed (module resolution).",
      "@n-dx/lang-sql is already installed (pack directory).",
    ]);
  });

  it("add with no language says so when the list is empty, and runs nothing", async () => {
    await cmdPack(["add"], deps({ listed: [] }));
    expect(lines).toEqual(["The project lists no packs: set `sourcevision.packs` in the project config, or run `sv pack add <lang>`."]);
    expect(npmCalls).toEqual([]);
  });

  it("add with no language reads the list from the project config and refuses an unknown id before installing", async () => {
    const project = mkdtempSync(join(tmpdir(), "sv-pack-project-"));
    try {
      writeFileSync(join(project, ".n-dx.json"), JSON.stringify({ sourcevision: { packs: ["java", "cobol"] } }));
      await expect(cmdPack(["add"], { ...deps(), listed: undefined, cwd: project })).rejects.toMatchObject({
        message: "sourcevision.packs lists unknown pack: cobol",
        suggestion: "Known packs: java, go, sql, terraform.",
      });
      expect(npmCalls).toEqual([]);
    } finally {
      rmSync(project, { recursive: true, force: true });
    }
  });

  it("list marks the listed packs, in text and JSON", async () => {
    await cmdPack(["list"], deps({ listed: ["go"] }));
    expect(lines.filter((l) => l.endsWith("[listed]")).map((l) => l.split(" ")[0])).toEqual(["go"]);
    lines = [];
    await cmdPack(["list", "--json"], deps({ listed: ["go"] }));
    const out = JSON.parse(lines.join("\n")) as { packs: Array<{ id: string; listed: boolean }> };
    expect(out.packs.map((p) => [p.id, p.listed])).toEqual([["java", false], ["go", true], ["sql", false], ["terraform", false]]);
  });
});

describe("sv pack remove", () => {
  it("uninstalls a pack from the pack directory", async () => {
    installInPackDir("@n-dx/lang-java");
    await cmdPack(["remove", "java"], deps());
    expect(npmCalls).toEqual([["uninstall", "--ignore-scripts", "--prefix", packDir, "@n-dx/lang-java"]]);
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

describe("the pack directory lock", () => {
  const lockFile = (): string => `${packDir}.lock`;
  const holdLock = (pid: number, command = "pack add go"): void => {
    mkdirSync(join(packDir, ".."), { recursive: true });
    writeFileSync(lockFile(), JSON.stringify({ pid, token: "other", command, since: "2026-10-17T00:00:00.000Z" }));
  };

  it("refuses add, add --from and remove while another writer holds it, naming its PID, and runs nothing", async () => {
    holdLock(4242);
    installInPackDir("@n-dx/lang-java");
    const alive = { isAlive: (pid: number) => pid === 4242 };
    const held = { message: expect.stringContaining("Another sv pack (PID 4242, `pack add go`"), suggestion: expect.stringContaining(lockFile()) };
    await expect(cmdPack(["add", "java"], deps(alive))).rejects.toMatchObject(held);
    await expect(cmdPack(["add"], deps({ ...alive, listed: ["java"] }))).rejects.toMatchObject(held);
    await expect(cmdPack(["add", "java", "--from", "missing.tgz"], deps(alive))).rejects.toMatchObject(held);
    await expect(cmdPack(["remove", "java"], deps(alive))).rejects.toMatchObject(held);
    expect(npmCalls).toEqual([]);
    expect(JSON.parse(readFileSync(lockFile(), "utf-8")).pid).toBe(4242);
  });

  it("takes over a lock whose PID is dead, and releases it when done", async () => {
    holdLock(4242);
    await cmdPack(["add", "java"], deps({ isAlive: () => false, npm: fakeNpm(() => installInPackDir("@n-dx/lang-java")) }));
    expect(npmCalls).toHaveLength(1);
    expect(existsSync(lockFile())).toBe(false);
    expect(readdirSync(join(packDir, ".."))).toEqual([VERSION]);
  });

  it("is held while npm runs and released when the command fails", async () => {
    let seen: string | undefined;
    const npm = fakeNpm(() => (seen = readFileSync(lockFile(), "utf-8")), { exitCode: 1 });
    await expect(cmdPack(["remove", "java"], deps({ npm, listed: [] }))).resolves.toBeUndefined(); // not installed: no npm
    installInPackDir("@n-dx/lang-java");
    await expect(cmdPack(["remove", "java"], deps({ npm }))).rejects.toThrow("failed (exit 1)");
    expect(JSON.parse(seen!)).toMatchObject({ pid: process.pid, command: "pack remove java" });
    expect(existsSync(lockFile())).toBe(false);
  });

  it("is not taken by --dry-run", async () => {
    holdLock(4242);
    await cmdPack(["add", "java", "--dry-run"], deps({ isAlive: () => true }));
    expect(lines).toHaveLength(1);
  });
});

describe("sv pack", () => {
  it("refuses an unknown subcommand", async () => {
    await expect(cmdPack(["install", "java"], deps())).rejects.toThrow("Unknown pack command: install");
    await expect(cmdPack([], deps())).rejects.toThrow("Missing pack command");
  });
});

/** Lay out what `npm install --prefix <prefix> <pack>` leaves: the pack, its dependencies, npm's files and command links. */
function installPrefix(prefix: string, packageName: string, version = VERSION): void {
  const lay = (name: string, files: Record<string, string>) => {
    const dir = join(prefix, "node_modules", ...name.split("/"));
    mkdirSync(dir, { recursive: true });
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(join(dir, file, ".."), { recursive: true });
      writeFileSync(join(dir, file), text);
    }
  };
  lay(packageName, {
    "package.json": JSON.stringify({
      name: packageName,
      version,
      exports: { ".": { import: "./dist/index.js" } },
      dependencies: { "@n-dx/lang-kit": version, "web-tree-sitter": "0.25.0" },
    }),
    "dist/index.js": "export const pack = {};\n",
    "build/grammars/tree-sitter.wasm": "\0asm",
  });
  lay("@n-dx/lang-kit", { "package.json": JSON.stringify({ name: "@n-dx/lang-kit", version }) });
  lay("web-tree-sitter", { "package.json": JSON.stringify({ name: "web-tree-sitter", version: "0.25.0" }) });
  mkdirSync(join(prefix, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(prefix, "node_modules", ".bin", "tool"), "#!/bin/sh\n");
  writeFileSync(join(prefix, "node_modules", ".package-lock.json"), "{}");
  writeFileSync(join(prefix, "package.json"), JSON.stringify({ dependencies: { [packageName]: version } }));
}

describe("sv pack bundle and add --from", () => {
  let work: string;
  let tempRoot: string;

  beforeEach(() => {
    work = mkdtempSync(join(tmpdir(), "sv pack bundle "));
    tempRoot = join(work, "temp root");
    mkdirSync(tempRoot);
  });
  afterEach(() => rmSync(work, { recursive: true, force: true }));

  /** A fake npm that installs the named pack into the `--prefix` it is given. */
  const npmInstalling = (version = VERSION) => fakeNpm((args) => installPrefix(args[args.indexOf("--prefix") + 1]!, args.at(-1)!.replace(/@[^@]*$/, ""), version));

  async function makeBundle(id = "java", out = join(work, "out dir", "java.tgz")): Promise<string> {
    await cmdPack(["bundle", id, "--out", out], deps({ npm: npmInstalling(), tempRoot, cwd: work }));
    return out;
  }

  it("installs the pack into a temporary prefix and archives it, its dependencies and a manifest", async () => {
    const out = await makeBundle();
    expect(npmCalls).toHaveLength(1);
    expect(npmCalls[0]!.slice(0, 5)).toEqual(["install", "--ignore-scripts", "--no-audit", "--no-fund", "--prefix"]);
    expect(npmCalls[0]![5]!.startsWith(tempRoot)).toBe(true);
    expect(npmCalls[0]![6]).toBe(`@n-dx/lang-java@${VERSION}`);
    expect(readdirSync(tempRoot)).toEqual([]);

    const entries = readTarGz(readFileSync(out));
    const files = entries.filter((e) => e.type === "file").map((e) => e.path);
    expect(files).toEqual(expect.arrayContaining([
      "n-dx-pack-bundle.json",
      "node_modules/@n-dx/lang-java/package.json",
      "node_modules/@n-dx/lang-java/build/grammars/tree-sitter.wasm",
      "node_modules/@n-dx/lang-kit/package.json",
      "node_modules/web-tree-sitter/package.json",
    ]));
    expect(files.some((f) => f.includes(".bin"))).toBe(false);
    const manifest = entries.find((e) => e.path === "n-dx-pack-bundle.json");
    expect(manifest?.type === "file" && JSON.parse(manifest.data.toString())).toEqual({
      format: 1, pack: "java", packageName: "@n-dx/lang-java", version: VERSION, sourcevisionVersion: VERSION, platform: "any",
    });
    expect(lines[0]).toMatch(/^Bundled @n-dx\/lang-java@1\.2\.3 and its dependencies \(\d+ files\) into /);
    const hash = createHash("sha256").update(readFileSync(out)).digest("hex");
    expect(readFileSync(`${out}.sha256`, "utf-8")).toBe(`${hash}  java.tgz\n`);
    expect(lines[1]).toBe(`SHA-256 ${hash}, written to ${out}.sha256.`);
    expect(lines[2]).toBe(`Install it with no network: ndx sv pack add java --from "${out}" --sha256 ${hash}`);
  });

  it("leaves a symbolic link in the prefix out of the bundle and says so", async () => {
    const outside = join(work, "outside");
    mkdirSync(outside);
    writeFileSync(join(outside, "secret.txt"), "not for the bundle");
    const npm = fakeNpm((args) => {
      const prefix = args[args.indexOf("--prefix") + 1]!;
      installPrefix(prefix, "@n-dx/lang-java");
      // "junction" makes a directory link on Windows without symlink privilege; elsewhere it is ignored.
      symlinkSync(outside, join(prefix, "node_modules", "escape"), "junction");
    });
    const out = join(work, "java.tgz");
    await cmdPack(["bundle", "java", "--out", out], deps({ npm, tempRoot, cwd: work }));
    expect(readTarGz(readFileSync(out)).some((e) => e.path.startsWith("node_modules/escape"))).toBe(false);
    expect(lines[1]).toBe("Left out 1 symbolic link(s), which a bundle never follows: node_modules/escape.");
  });

  it("names the bundle n-dx-lang-<lang>-<version>.tgz in the working directory by default", async () => {
    await cmdPack(["bundle", "go"], deps({ npm: npmInstalling(), tempRoot, cwd: work }));
    expect(existsSync(join(work, `n-dx-lang-go-${VERSION}.tgz`))).toBe(true);
  });

  it("fails without an archive, and removes the temporary prefix, when npm fails", async () => {
    const npm = fakeNpm(() => {}, { exitCode: 1, output: "npm error ENOTFOUND registry.npmjs.org\n" });
    await expect(cmdPack(["bundle", "java"], deps({ npm, tempRoot, cwd: work }))).rejects.toThrow(/ENOTFOUND/);
    expect(readdirSync(tempRoot)).toEqual([]);
    expect(existsSync(join(work, `n-dx-lang-java-${VERSION}.tgz`))).toBe(false);
  });

  it("installs a bundle into the pack directory with no npm call, keeping other packs, and the pack loads", async () => {
    const out = await makeBundle();
    npmCalls = [];
    lines = [];
    packDir = join(work, "ndx home", "packs", VERSION);
    installPrefix(packDir, "@n-dx/lang-sql");
    const stale = join(packDir, "node_modules", "@n-dx", "lang-java", "stale.js");
    mkdirSync(join(stale, ".."), { recursive: true });
    writeFileSync(stale, "");

    await cmdPack(["add", "java", "--from", out], deps({ cwd: work }));
    expect(npmCalls).toEqual([]);
    expect(lines[0]).toMatch(/^Checked .*java\.tgz against .*java\.tgz\.sha256 \(SHA-256 [0-9a-f]{64}\)\. .*catches damage, not tampering/);
    expect(lines[1]).toBe(`Installed @n-dx/lang-java@${VERSION} into ${packDir} (produces imports, symbols).`);
    expect(existsSync(stale)).toBe(false);
    expect(existsSync(join(packDir, "node_modules", "@n-dx", "lang-java", "build", "grammars", "tree-sitter.wasm"))).toBe(true);
    expect(existsSync(join(packDir, "node_modules", ".package-lock.json"))).toBe(false);
    expect(JSON.parse(readFileSync(join(packDir, "package.json"), "utf-8"))).toEqual({
      dependencies: { "@n-dx/lang-sql": VERSION, "@n-dx/lang-java": VERSION },
    });
    lines = [];
    await cmdPack(["list"], deps());
    expect(lines[1]).toMatch(/^java\s+installed\s+@n-dx\/lang-java@1\.2\.3/);
  });

  it("accepts --from=<bundle> relative to the working directory, and --dry-run writes nothing", async () => {
    await makeBundle("java", join(work, "java.tgz"));
    lines = [];
    await cmdPack(["add", "java", "--from=java.tgz", "--dry-run"], deps({ cwd: work }));
    expect(lines[1]).toMatch(new RegExp(`^Would install @n-dx/lang-java@1\\.2\\.3 from .*java\\.tgz into `));
    expect(existsSync(packDir)).toBe(false);
  });

  it("refuses a bundle of another pack, naming both", async () => {
    const out = await makeBundle("go");
    await expect(cmdPack(["add", "java", "--from", out], deps())).rejects.toMatchObject({
      message: `${out} is a bundle of @n-dx/lang-go@${VERSION}, not of @n-dx/lang-java.`,
      suggestion: "Install it with `sv pack add go --from <bundle>`.",
    });
    expect(existsSync(packDir)).toBe(false);
  });

  it("refuses a bundle made for another sourcevision version, naming both", async () => {
    const out = await makeBundle();
    await expect(cmdPack(["add", "java", "--from", out], deps({ version: "2.0.0" }))).rejects.toThrow(
      `${out} is a bundle of @n-dx/lang-java@${VERSION}, made for sourcevision ${VERSION}; this is sourcevision 2.0.0.`,
    );
    expect(existsSync(packDir)).toBe(false);
  });

  it("leaves the previous install in place and loadable when the bundle's pack will not load", async () => {
    const out = await makeBundle();
    packDir = join(work, "ndx home", "packs", VERSION);
    installPrefix(packDir, "@n-dx/lang-java");
    const marker = join(packDir, "node_modules", "@n-dx", "lang-java", "previous.js");
    writeFileSync(marker, "");
    const failing = async (url: string): Promise<unknown> => {
      if (url.includes(".sv-pack-stage-")) throw new Error("grammar will not load");
      return importFile(url);
    };

    await expect(cmdPack(["add", "java", "--from", out], deps({ cwd: work, importFile: failing }))).rejects.toThrow(
      /The bundle .*java\.tgz holds @n-dx\/lang-java@1\.2\.3 but it cannot be used/,
    );
    expect(existsSync(marker)).toBe(true);
    expect(readdirSync(join(packDir, ".."))).toEqual([VERSION]);
    lines = [];
    await cmdPack(["list"], deps());
    expect(lines[1]).toMatch(/^java\s+installed\s+@n-dx\/lang-java@1\.2\.3/);
  });

  it("refuses a bundle whose manifest is null or not an object as not a pack bundle", async () => {
    for (const json of ["null", "[]", "7"]) {
      const file = join(work, `manifest-${json}.tgz`);
      writeFileSync(file, writeTarGz([{ type: "file", path: "n-dx-pack-bundle.json", mode: 0o644, data: Buffer.from(json) }]));
      await expect(cmdPack(["add", "java", "--from", file], deps())).rejects.toThrow(
        `${file} is not a pack bundle: its n-dx-pack-bundle.json is not a JSON object.`,
      );
    }
  });

  it("refuses a corrupt archive, a truncated one, one with no manifest and a missing file", async () => {
    const out = await makeBundle();
    const archive = readFileSync(out);
    const write = (name: string, data: Buffer): string => {
      writeFileSync(join(work, name), data);
      return join(work, name);
    };
    await expect(cmdPack(["add", "java", "--from", write("junk.tgz", Buffer.from("not an archive"))], deps())).rejects.toThrow(
      /junk\.tgz is not a usable pack bundle: not gzip data/,
    );
    await expect(cmdPack(["add", "java", "--from", write("cut.tgz", archive.subarray(0, archive.length / 2))], deps())).rejects.toThrow(
      /cut\.tgz is not a usable pack bundle/,
    );
    await expect(
      cmdPack(["add", "java", "--from", write("big.tgz", archive)], deps({ maxBundleBytes: 1024 })),
    ).rejects.toThrow(/big\.tgz is not a usable pack bundle: it inflates past 1024 bytes/);
    const bare = writeTarGz([{ type: "file", path: "node_modules/x/package.json", mode: 0o644, data: Buffer.from("{}") }]);
    await expect(cmdPack(["add", "java", "--from", write("bare.tgz", bare)], deps())).rejects.toThrow(
      "bare.tgz is not a pack bundle: it has no n-dx-pack-bundle.json.",
    );
    await expect(cmdPack(["add", "java", "--from", join(work, "absent.tgz")], deps())).rejects.toThrow(/Cannot read the bundle .*absent\.tgz/);
    await expect(cmdPack(["add", "java", "--from"], deps())).rejects.toThrow("Missing value for --from");
    expect(existsSync(packDir)).toBe(false);
  });

  const sha256 = (file: string): string => createHash("sha256").update(readFileSync(file)).digest("hex");

  /** An importer that counts its calls, so a test can show nothing from a bundle ran. */
  function countingImport(): { importFile: PackCommandDeps["importFile"]; calls: () => number } {
    let calls = 0;
    return {
      importFile: (url: string) => {
        calls++;
        return importFile(url);
      },
      calls: () => calls,
    };
  }

  /** No pack directory and no staging directory beside it: the lock file is all a refused add leaves, and it is released. */
  const expectNothingExtracted = (): void => {
    expect(existsSync(packDir)).toBe(false);
    const parent = join(packDir, "..");
    expect(existsSync(parent) ? readdirSync(parent) : []).toEqual([]);
  };

  it("refuses a --sha256 mismatch before extracting or importing anything", async () => {
    const out = await makeBundle();
    const counted = countingImport();
    await expect(
      cmdPack(["add", "java", "--from", out, "--sha256", "0".repeat(64)], deps({ cwd: work, importFile: counted.importFile })),
    ).rejects.toMatchObject({
      message: `${out} has SHA-256 ${sha256(out)}, not the ${"0".repeat(64)} given with --sha256.`,
      suggestion: expect.stringContaining("Nothing was extracted or installed."),
    });
    expect(counted.calls()).toBe(0);
    expectNothingExtracted();
  });

  it("refuses a bundle that no longer matches the .sha256 beside it, extracting nothing", async () => {
    const out = await makeBundle();
    const entries = readTarGz(readFileSync(out));
    writeFileSync(out, writeTarGz([...entries, { type: "file", path: "node_modules/extra/package.json", mode: 0o644, data: Buffer.from("{}") }]));
    const counted = countingImport();
    await expect(cmdPack(["add", "java", "--from", out], deps({ cwd: work, importFile: counted.importFile }))).rejects.toThrow(
      `${out} has SHA-256 ${sha256(out)}, not the ${readFileSync(`${out}.sha256`, "utf-8").slice(0, 64)} recorded in ${out}.sha256.`,
    );
    expect(counted.calls()).toBe(0);
    expectNothingExtracted();
  });

  it("installs a bundle whose hash matches --sha256, in any case", async () => {
    const out = await makeBundle();
    lines = [];
    await cmdPack(["add", "java", "--from", out, `--sha256=${sha256(out).toUpperCase()}`], deps({ cwd: work }));
    expect(lines[0]).toBe(`Verified ${out}: SHA-256 ${sha256(out)} matches --sha256.`);
    expect(lines[1]).toBe(`Installed @n-dx/lang-java@${VERSION} into ${packDir} (produces imports, symbols).`);
  });

  it("installs a bundle with no hash to check, saying it was not verified and printing its hash", async () => {
    const out = await makeBundle();
    rmSync(`${out}.sha256`);
    lines = [];
    await cmdPack(["add", "java", "--from", out], deps({ cwd: work }));
    expect(lines[0]).toBe(
      `Not verified: ${out} has SHA-256 ${sha256(out)}. Pass --sha256 <hex> with the hash sv pack bundle printed to check it.`,
    );
    expect(lines[1]).toMatch(/^Installed @n-dx\/lang-java/);
  });

  it("refuses a --sha256 that is not a SHA-256, and --sha256 without --from", async () => {
    const out = await makeBundle();
    await expect(cmdPack(["add", "java", "--from", out, "--sha256", "abc"], deps())).rejects.toThrow(
      '--sha256 takes the bundle\'s SHA-256 as 64 hex digits, not "abc".',
    );
    await expect(cmdPack(["add", "java", "--sha256", sha256(out)], deps())).rejects.toThrow("--sha256 checks a bundle");
    expect(existsSync(packDir)).toBe(false);
  });

  it("replaces only the named pack and its dependency closure, never another pack or a stray package", async () => {
    const out = await makeBundle();
    // A modified java bundle: it also carries lang-sql and an unrelated package, and declares lang-sql a dependency.
    const tampered = readTarGz(readFileSync(out)).map((e) =>
      e.type === "file" && e.path === "node_modules/@n-dx/lang-java/package.json"
        ? { ...e, data: Buffer.from(JSON.stringify({ ...JSON.parse(e.data.toString()), dependencies: { "web-tree-sitter": "0.25.0", "@n-dx/lang-sql": VERSION } })) }
        : e,
    );
    const file = join(work, "tampered.tgz");
    writeFileSync(file, writeTarGz([
      ...tampered,
      { type: "file", path: "node_modules/@n-dx/lang-sql/package.json", mode: 0o644, data: Buffer.from(JSON.stringify({ name: "@n-dx/lang-sql", version: VERSION, tampered: true })) },
      { type: "file", path: "node_modules/stray/package.json", mode: 0o644, data: Buffer.from("{}") },
    ]));
    packDir = join(work, "ndx home", "packs", VERSION);
    installPrefix(packDir, "@n-dx/lang-sql");
    const sqlManifest = join(packDir, "node_modules", "@n-dx", "lang-sql", "package.json");
    const before = readFileSync(sqlManifest, "utf-8");
    rmSync(join(packDir, "node_modules", "web-tree-sitter"), { recursive: true });

    await cmdPack(["add", "java", "--from", file], deps({ cwd: work }));
    expect(readFileSync(sqlManifest, "utf-8")).toBe(before);
    expect(existsSync(join(packDir, "node_modules", "stray"))).toBe(false);
    expect(existsSync(join(packDir, "node_modules", "@n-dx", "lang-java", "package.json"))).toBe(true);
    expect(existsSync(join(packDir, "node_modules", "web-tree-sitter", "package.json"))).toBe(true);
  });
});

describe("dependencyClosure", () => {
  let nodeModules: string;
  const pkg = (path: string, dependencies: Record<string, string> = {}, extra: Record<string, unknown> = {}): void => {
    mkdirSync(join(nodeModules, ...path.split("/")), { recursive: true });
    writeFileSync(join(nodeModules, ...path.split("/"), "package.json"), JSON.stringify({ dependencies, ...extra }));
  };
  beforeEach(() => {
    nodeModules = join(mkdtempSync(join(tmpdir(), "sv-pack-closure-")), "node_modules");
  });
  afterEach(() => rmSync(join(nodeModules, ".."), { recursive: true, force: true }));

  it("follows dependencies, optional and peer dependencies as Node resolves them, nested copies counting as their ancestor", () => {
    pkg("@n-dx/lang-go", { "@n-dx/lang-kit": "1", a: "1" }, { peerDependencies: { peer: "1" }, optionalDependencies: { absent: "1" } });
    pkg("@n-dx/lang-kit");
    pkg("a", { b: "1" });
    // a's own copy of b, whose dependency c is hoisted to the top.
    pkg("a/node_modules/b", { c: "1" });
    pkg("b");
    pkg("c");
    pkg("peer");
    pkg("unrelated");
    expect(dependencyClosure(nodeModules, "@n-dx/lang-go")).toEqual(["@n-dx/lang-go", "@n-dx/lang-kit", "a", "c", "peer"]);
  });

  it("never follows an excluded name, and stops on a cycle", () => {
    pkg("@n-dx/lang-go", { "@n-dx/lang-java": "1", x: "1" });
    pkg("@n-dx/lang-java");
    pkg("x", { "@n-dx/lang-go": "1" });
    expect(dependencyClosure(nodeModules, "@n-dx/lang-go", ["@n-dx/lang-java"])).toEqual(["@n-dx/lang-go", "x"]);
  });

  it("refuses a dependency name that would leave node_modules, before anything is moved", () => {
    for (const name of ["../escape", "@s/../../escape", "..", "@../x", "a\\..\\b"]) {
      pkg("@n-dx/lang-go", { [name]: "1" });
      expect(() => dependencyClosure(nodeModules, "@n-dx/lang-go"), name).toThrow(`names ${JSON.stringify(name)}, which is not a package name`);
    }
    pkg("@n-dx/lang-go", { "@scope/ok.name": "1", "a.b-c_d": "1" });
    expect(dependencyClosure(nodeModules, "@n-dx/lang-go")).toEqual(["@n-dx/lang-go"]);
  });

  it("fails naming a package.json in the closure that will not parse", () => {
    pkg("@n-dx/lang-go", { x: "1" });
    mkdirSync(join(nodeModules, "x"));
    writeFileSync(join(nodeModules, "x", "package.json"), "{");
    expect(() => dependencyClosure(nodeModules, "@n-dx/lang-go")).toThrow(/Cannot read .*x.package\.json from the bundle/);
  });
});
