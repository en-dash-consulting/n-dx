/**
 * Extension discovery (packages/core/extension-discovery.js): the four sources
 * and their precedence, conflicts, the mtime-keyed cache, and the guarantee
 * that nothing but `package.json` is read.
 *
 * Cache cost is asserted by counting file-system calls, not by a clock
 * (TESTING.md, Flake Resistance → Family 2): a warm call with 20 extensions
 * installed must make the same reads as with none, and one stat more for each.
 *
 * @see docs/architecture/extensions.md — "Where n-dx looks"
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, readdirSync, existsSync, utimesSync, symlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { basename, join, sep } from "node:path";
import { pathToFileURL } from "node:url";
import {
  discoverExtensions,
  findGlobalRoot,
  readExtensionsText,
  replaceExtensionsFile,
  EXTENSIONS_CACHE_FILE,
  MAX_PROJECT_ENTRIES,
} from "../../packages/core/extension-discovery.js";
import { updateExtensionsFile, setDisabled, forgetApproval } from "../../packages/core/extension-state.js";

const BUILTINS = ["init", "work", "status", "config", "start"];

let root;
let home;
let project;
let globalRoot;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ndx-ext-discovery-"));
  home = join(root, "home");
  project = join(root, "project");
  globalRoot = join(root, "global", "node_modules");
  for (const dir of [home, project, globalRoot]) mkdirSync(dir, { recursive: true });
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

/** A package.json with an `ndx.extension` block named `name`. */
function manifest(packageName, name, { version = "1.0.0", commands } = {}) {
  return {
    name: packageName,
    version,
    main: "index.js",
    ndx: {
      extension: {
        apiVersion: 1,
        name,
        ndxVersion: ">=0.10.0",
        commands: commands ?? [{ name, bin: "bin/cli.js", summary: `The ${name} extension` }],
      },
    },
  };
}

function writeJson(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value));
}

/** Install `pkg` under `<folder>/node_modules` and list it in `<folder>/package.json`. */
function install(folder, pkg) {
  const listing = join(folder, "package.json");
  const current = existsSync(listing) ? JSON.parse(readFileSync(listing, "utf8")) : { name: "listing" };
  current.dependencies = { ...current.dependencies, [pkg.name]: pkg.version };
  writeJson(listing, current);
  const dir = join(folder, "node_modules", ...pkg.name.split("/"));
  writeJson(join(dir, "package.json"), pkg);
  return dir;
}

const userFolder = () => join(home, "extensions");

function devPath(dir, pkg) {
  writeJson(join(dir, "package.json"), pkg);
  const configPath = join(home, "config.json");
  const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, "utf8")) : {};
  config.extensions = { paths: [...(config.extensions?.paths ?? []), dir] };
  writeJson(configPath, config);
}

function discover(extra = {}) {
  return discoverExtensions({ builtinCommands: BUILTINS, home, projectDir: project, globalRoot, ...extra });
}

/** node:fs with every call counted and every file read recorded. */
function countingFs() {
  const counts = { readFileSync: 0, statSync: 0, readdirSync: 0, writeFileSync: 0 };
  const reads = [];
  const wrapped = { ...fs };
  for (const name of Object.keys(counts)) {
    wrapped[name] = (...args) => {
      counts[name]++;
      if (name === "readFileSync") reads.push(String(args[0]));
      return fs[name](...args);
    };
  }
  return { fs: wrapped, counts, reads };
}

describe("sources", () => {
  it("finds manifests in the project, user, global and dev sources, in that order", () => {
    install(project, manifest("@acme/ndx-alpha", "alpha"));
    install(userFolder(), manifest("ndx-beta", "beta"));
    writeJson(join(globalRoot, "@acme", "ndx-gamma", "package.json"), manifest("@acme/ndx-gamma", "gamma"));
    devPath(join(root, "checkouts", "delta"), manifest("ndx-delta", "delta"));

    const { extensions, errors } = discover();

    expect(errors).toEqual([]);
    expect(extensions.map((e) => [e.name, e.source, e.status])).toEqual([
      ["alpha", "project", "valid"],
      ["beta", "user", "valid"],
      ["gamma", "global", "valid"],
      ["delta", "dev", "valid"],
    ]);
  });

  it("reads only packages a listing names, so a hoisted dependency is not an extension", () => {
    install(project, manifest("ndx-listed", "listed"));
    writeJson(join(project, "node_modules", "ndx-hoisted", "package.json"), manifest("ndx-hoisted", "hoisted"));

    expect(discover().extensions.map((e) => e.name)).toEqual(["listed"]);
  });

  it("ignores packages without an ndx.extension block", () => {
    install(project, { name: "lodash", version: "4.0.0" });
    writeJson(join(globalRoot, "npm", "package.json"), { name: "npm", version: "10.0.0" });

    expect(discover().extensions).toEqual([]);
  });

  it("reports a dev path that is not an extension", () => {
    devPath(join(root, "checkouts", "plain"), { name: "plain" });

    const { errors } = discover();

    expect(errors).toHaveLength(1);
    expect(errors[0].message).toMatch(/declares no ndx.extension block/);
  });

  it("resolves relative dev paths against the n-dx home", () => {
    writeJson(join(home, "work", "ext", "package.json"), manifest("ndx-rel", "rel"));
    writeJson(join(home, "config.json"), { extensions: { paths: ["work/ext"] } });

    expect(discover().extensions.map((e) => [e.name, e.dir])).toEqual([["rel", join(home, "work", "ext")]]);
  });

  it("does not scan the project's node_modules as the global source when n-dx is installed there", () => {
    writeJson(join(project, "package.json"), { name: "app" });
    writeJson(join(project, "node_modules", "ndx-unlisted", "package.json"), manifest("ndx-unlisted", "unlisted"));

    expect(discover({ globalRoot: join(project, "node_modules") }).extensions).toEqual([]);
  });

  it("validates each manifest against the built-in commands", () => {
    install(project, manifest("ndx-shadow", "status"));

    const [ext] = discover().extensions;

    expect(ext.status).toBe("invalid");
    expect(ext.problems.map((p) => p.rule)).toContain("name-builtin");
  });
});

describe("no package code runs", () => {
  it("reads only package.json files, the home config and the cache", () => {
    const marker = join(root, "ran");
    const code = `require("fs").writeFileSync(${JSON.stringify(marker)}, "ran");\n`;
    const dirs = [
      install(project, { ...manifest("ndx-a", "a"), scripts: { preinstall: "node index.js" }, bin: { a: "bin/cli.js" } }),
      install(userFolder(), manifest("ndx-b", "b")),
    ];
    const globalDir = join(globalRoot, "ndx-c");
    writeJson(join(globalDir, "package.json"), manifest("ndx-c", "c"));
    dirs.push(globalDir);
    for (const dir of dirs) {
      writeFileSync(join(dir, "index.js"), code);
      mkdirSync(join(dir, "bin"), { recursive: true });
      writeFileSync(join(dir, "bin", "cli.js"), code);
    }
    const counting = countingFs();

    const { extensions } = discover({ fs: counting.fs });

    expect(extensions.map((e) => e.name)).toEqual(["a", "b", "c"]);
    expect(existsSync(marker)).toBe(false);
    expect(new Set(counting.reads.map((p) => basename(p))))
      .toEqual(new Set(["package.json", "config.json", EXTENSIONS_CACHE_FILE]));
  });
});

describe("precedence and conflicts", () => {
  it("lets the higher source win and names the copies it shadows", () => {
    install(project, manifest("ndx-dup", "dup", { version: "3.0.0" }));
    const userDir = install(userFolder(), manifest("ndx-dup", "dup", { version: "2.0.0" }));
    const devDir = join(root, "checkouts", "dup");
    devPath(devDir, manifest("ndx-dup", "dup", { version: "1.0.0-dev" }));

    const { extensions } = discover();

    expect(extensions).toHaveLength(1);
    expect(extensions[0]).toMatchObject({ name: "dup", source: "project", version: "3.0.0", status: "valid" });
    expect(extensions[0].shadowed).toEqual([
      { source: "user", dir: userDir, version: "2.0.0" },
      { source: "dev", dir: devDir, version: "1.0.0-dev" },
    ]);
  });

  it("refuses both packages when two claim one extension name, each naming the other", () => {
    const first = install(project, manifest("@one/ndx-recon", "recon"));
    const second = install(userFolder(), manifest("@two/ndx-recon", "recon"));

    const { extensions } = discover();

    expect(extensions.map((e) => [e.packageName, e.status])).toEqual([
      ["@one/ndx-recon", "conflict"],
      ["@two/ndx-recon", "conflict"],
    ]);
    expect(extensions[0].conflicts).toEqual([{ packageName: "@two/ndx-recon", source: "user", dir: second, names: ["recon"] }]);
    expect(extensions[1].conflicts).toEqual([{ packageName: "@one/ndx-recon", source: "project", dir: first, names: ["recon"] }]);
  });

  it("refuses both packages when one's command takes the other's name", () => {
    install(project, manifest("ndx-a", "a", { commands: [{ name: "b", bin: "cli.js", summary: "b" }] }));
    install(userFolder(), manifest("ndx-b", "b"));

    expect(discover().extensions.map((e) => e.status)).toEqual(["conflict", "conflict"]);
  });

  it("leaves an incompatible manifest out of name conflicts, since it never runs", () => {
    install(project, manifest("ndx-a", "same"));
    const future = manifest("ndx-future", "same");
    future.ndx.extension.apiVersion = 99;
    install(userFolder(), future);

    expect(discover().extensions.map((e) => e.status)).toEqual(["valid", "incompatible"]);
  });
});

describe("cache", () => {
  it("writes <ndx home>/extensions.json and reads no package on a warm call", () => {
    install(userFolder(), manifest("ndx-a", "a"));
    discover();
    expect(existsSync(join(home, EXTENSIONS_CACHE_FILE))).toBe(true);

    const counting = countingFs();
    const { extensions } = discover({ fs: counting.fs });

    expect(extensions.map((e) => e.name)).toEqual(["a"]);
    expect(counting.reads.map((p) => basename(p)).sort()).toEqual(["config.json", EXTENSIONS_CACHE_FILE]);
    expect(counting.counts.writeFileSync).toBe(0);
  });

  it("costs one stat per extension warm, and no reads", () => {
    const warmCost = () => {
      discover();
      const counting = countingFs();
      discover({ fs: counting.fs });
      return counting.counts;
    };
    writeJson(join(userFolder(), "package.json"), { name: "listing" });
    mkdirSync(join(userFolder(), "node_modules"));
    const none = warmCost();
    for (let i = 0; i < 20; i++) install(userFolder(), manifest(`ndx-e${i}`, `e${i}`));
    const twenty = warmCost();

    expect(discover().extensions).toHaveLength(20);
    expect(twenty).toEqual({ ...none, statSync: none.statSync + 20 });
  });

  it("recomputes a source when a package is added to it", () => {
    install(userFolder(), manifest("ndx-a", "a"));
    discover();
    install(userFolder(), manifest("ndx-b", "b"));
    bumpMtime(join(userFolder(), "node_modules"));

    expect(discover().extensions.map((e) => e.name)).toEqual(["a", "b"]);
  });

  it("recomputes the global source when a scoped package is added", () => {
    writeJson(join(globalRoot, "@acme", "ndx-a", "package.json"), manifest("@acme/ndx-a", "a"));
    discover();
    writeJson(join(globalRoot, "@acme", "ndx-b", "package.json"), manifest("@acme/ndx-b", "b"));
    bumpMtime(join(globalRoot, "@acme"));

    expect(discover().extensions.map((e) => e.name)).toEqual(["a", "b"]);
  });

  it("recomputes a dev path when its package.json changes", () => {
    const dir = join(root, "checkouts", "x");
    devPath(dir, manifest("ndx-x", "x"));
    expect(discover().extensions[0].version).toBe("1.0.0");
    writeJson(join(dir, "package.json"), manifest("ndx-x", "x", { version: "1.1.0" }));
    bumpMtime(join(dir, "package.json"));

    expect(discover().extensions[0].version).toBe("1.1.0");
  });

  it.each([
    ["the user folder", () => join(userFolder(), "node_modules", "ndx-linked"), () => install(userFolder(), manifest("ndx-linked", "linked"))],
    ["the global source", () => join(globalRoot, "ndx-linked"), () => {}],
  ])("recomputes a symlinked package in %s when its target's package.json changes", (_, linkPath, list) => {
    const target = join(root, "checkouts", "linked");
    list();
    rmSync(linkPath(), { recursive: true, force: true });
    writeJson(join(target, "package.json"), manifest("ndx-linked", "linked"));
    mkdirSync(join(linkPath(), ".."), { recursive: true });
    symlinkSync(target, linkPath(), "junction");
    expect(discover().extensions[0]).toMatchObject({ version: "1.0.0", manifest: { commands: [{ bin: "bin/cli.js" }] } });

    writeJson(join(target, "package.json"), manifest("ndx-linked", "linked", {
      version: "2.0.0",
      commands: [{ name: "linked", bin: "bin/other.js", summary: "Moved" }],
    }));
    bumpMtime(join(target, "package.json"));

    expect(discover().extensions[0]).toMatchObject({ version: "2.0.0", manifest: { commands: [{ bin: "bin/other.js" }] } });
  });

  it("keeps the file's other keys, where approvals live", () => {
    writeJson(join(home, EXTENSIONS_CACHE_FILE), { approvals: { a: { hash: "h" } } });
    install(userFolder(), manifest("ndx-a", "a"));
    discover();

    const file = JSON.parse(readFileSync(join(home, EXTENSIONS_CACHE_FILE), "utf8"));
    expect(file.approvals).toEqual({ a: { hash: "h" } });
    expect(file.discovery.version).toBe(2);
  });

  it("keeps a disable, approval and removal written while discovery was scanning", () => {
    const cachePath = join(home, EXTENSIONS_CACHE_FILE);
    writeJson(cachePath, { approvals: { "ndx-gone": { manifestHash: "h" } } });
    install(userFolder(), manifest("ndx-a", "a"));
    // Another process changes the file after discovery's first read of it.
    let interleaved = false;
    const racing = {
      ...fs,
      readFileSync: (...args) => {
        const result = fs.readFileSync(...args);
        if (!interleaved && String(args[0]) === cachePath) {
          interleaved = true;
          updateExtensionsFile(home, (file) => {
            setDisabled(file, "a", true);
            forgetApproval(file, "ndx-gone");
            file.approvals["ndx-a"] = { manifestHash: "new" };
          });
        }
        return result;
      },
    };

    discover({ fs: racing });

    const file = JSON.parse(readFileSync(cachePath, "utf8"));
    expect(interleaved).toBe(true);
    expect(Object.keys(file.disabled)).toEqual(["a"]);
    expect(file.approvals).toEqual({ "ndx-a": { manifestHash: "new" } });
    expect(Object.keys(file.discovery.sources)).toContain(`user:${userFolder()}`);
  });

  it("keeps only the most recently scanned project entries", () => {
    const dirs = Array.from({ length: 50 }, (_, i) => join(root, "projects", `p${i}`));
    for (const dir of dirs) {
      mkdirSync(dir, { recursive: true });
      discover({ projectDir: dir });
    }
    // A project dropped from the cache is rescanned and becomes the newest.
    discover({ projectDir: dirs[0] });

    const keys = Object.keys(JSON.parse(readFileSync(join(home, EXTENSIONS_CACHE_FILE), "utf8")).discovery.sources);
    const projects = keys.filter((key) => key.startsWith("project:"));
    expect(projects).toEqual([...dirs.slice(-(MAX_PROJECT_ENTRIES - 1)), dirs[0]].map((dir) => `project:${dir}`));
    expect(keys).toContain(`user:${userFolder()}`);
  });

  it("does not overwrite a cache file that became unreadable during discovery", () => {
    const cachePath = join(home, EXTENSIONS_CACHE_FILE);
    install(userFolder(), manifest("ndx-a", "a"));
    let reads = 0;
    const racing = {
      ...fs,
      readFileSync: (...args) => {
        if (String(args[0]) === cachePath && ++reads === 2) writeFileSync(cachePath, "{ not json");
        return fs.readFileSync(...args);
      },
    };

    const { errors } = discover({ fs: racing });

    expect(errors.map((e) => e.path)).toEqual([cachePath]);
    expect(readFileSync(cachePath, "utf8")).toBe("{ not json");
  });

  it("reports a cache file that is not JSON and leaves it untouched", () => {
    writeFileSync(join(home, EXTENSIONS_CACHE_FILE), "{ not json");
    install(userFolder(), manifest("ndx-a", "a"));

    const { extensions, errors } = discover();

    expect(extensions.map((e) => e.name)).toEqual(["a"]);
    expect(errors.map((e) => e.path)).toEqual([join(home, EXTENSIONS_CACHE_FILE)]);
    expect(readFileSync(join(home, EXTENSIONS_CACHE_FILE), "utf8")).toBe("{ not json");
  });
});

describe("writing extensions.json", () => {
  const cachePath = () => join(home, EXTENSIONS_CACHE_FILE);
  const tempFiles = () => readdirSync(home).filter((entry) => entry.endsWith(".tmp"));
  const errno = (code) => Object.assign(new Error(`${code}: rename`), { code });

  /** node:fs whose renameSync throws `code` for the first `times` calls. */
  function failingRename(code, times = Infinity) {
    let calls = 0;
    return {
      ...fs,
      renameSync: (...args) => {
        if (++calls <= times) throw errno(code);
        return fs.renameSync(...args);
      },
    };
  }

  it.each(["EPERM", "EACCES", "EBUSY"])("retries a rename refused with %s until it succeeds", (code) => {
    const waits = [];
    replaceExtensionsFile(failingRename(code, 3), cachePath(), "{}\n", { sleep: (ms) => waits.push(ms) });

    expect(readFileSync(cachePath(), "utf8")).toBe("{}\n");
    expect(waits).toHaveLength(3);
    expect(tempFiles()).toEqual([]);
  });

  it("gives up after its retry budget, throws and removes the temp file", () => {
    let waited = 0;
    expect(() => replaceExtensionsFile(failingRename("EPERM"), cachePath(), "{}\n", { sleep: (ms) => (waited += ms) })).toThrow(/EPERM/);

    expect(waited).toBeGreaterThanOrEqual(2000);
    expect(existsSync(cachePath())).toBe(false);
    expect(tempFiles()).toEqual([]);
  });

  it("does not retry an error that is not transient", () => {
    const waits = [];
    expect(() => replaceExtensionsFile(failingRename("EXDEV"), cachePath(), "{}\n", { sleep: (ms) => waits.push(ms) })).toThrow(/EXDEV/);

    expect(waits).toEqual([]);
    expect(tempFiles()).toEqual([]);
  });

  it("retries a read refused while another process replaces the file", () => {
    writeFileSync(cachePath(), "{}\n");
    let calls = 0;
    const flaky = {
      ...fs,
      readFileSync: (...args) => {
        if (++calls <= 2) throw errno("EPERM");
        return fs.readFileSync(...args);
      },
    };
    const waits = [];

    expect(readExtensionsText(flaky, cachePath(), { sleep: (ms) => waits.push(ms), platform: "win32" })).toBe("{}\n");
    expect(waits).toHaveLength(2);
  });

  it.each(["EPERM", "EACCES"])("fails a %s read at once outside Windows, where it is permanent", (code) => {
    const denied = { ...fs, readFileSync: () => { throw errno(code); } };
    const waits = [];

    expect(() => readExtensionsText(denied, cachePath(), { sleep: (ms) => waits.push(ms), platform: "linux" })).toThrow(code);
    expect(waits).toEqual([]);
  });

  it("removes the temp file when discovery's cache write fails", () => {
    install(userFolder(), manifest("ndx-a", "a"));

    const { errors } = discover({ fs: failingRename("EXDEV") });

    expect(errors.map((e) => e.message)).toEqual([expect.stringContaining("cache not written")]);
    expect(tempFiles()).toEqual([]);
  });

  it("removes the temp file when an approval write fails", () => {
    expect(() => updateExtensionsFile(home, (file) => setDisabled(file, "a", true), failingRename("EXDEV"))).toThrow(/EXDEV/);

    expect(tempFiles()).toEqual([]);
  });

  it("sweeps temp files left by processes that are gone and keeps a live one's", () => {
    writeFileSync(`${cachePath()}.111.tmp`, "{");
    writeFileSync(`${cachePath()}.222.tmp`, "{");
    writeFileSync(join(home, "other.json.111.tmp"), "{");

    replaceExtensionsFile(fs, cachePath(), "{}\n", { isAlive: (pid) => pid === 222 });

    expect(tempFiles().sort()).toEqual([`${EXTENSIONS_CACHE_FILE}.222.tmp`, "other.json.111.tmp"]);
  });

  it("concurrent list and approval writers from separate processes all succeed and leave no temp file", async () => {
    install(userFolder(), manifest("ndx-a", "a"));
    const discovery = pathToFileURL(join(import.meta.dirname, "../../packages/core/extension-discovery.js")).href;
    const state = pathToFileURL(join(import.meta.dirname, "../../packages/core/extension-state.js")).href;
    // Each worker alternates a discovery from a directory it has not scanned
    // (so the cache is rewritten) with a disable/enable write.
    const script = `
      import { mkdirSync } from "node:fs";
      import { join } from "node:path";
      import { discoverExtensions } from ${JSON.stringify(discovery)};
      import { updateExtensionsFile, setDisabled } from ${JSON.stringify(state)};
      const [home, root, id] = process.argv.slice(1);
      for (let i = 0; i < 25; i++) {
        const projectDir = join(root, "projects", id + "-" + i);
        mkdirSync(projectDir, { recursive: true });
        const { errors } = discoverExtensions({ builtinCommands: [], home, projectDir, globalRoot: join(root, "global", "node_modules") });
        if (errors.length) { console.error(JSON.stringify(errors)); process.exit(2); }
        updateExtensionsFile(home, (file) => setDisabled(file, "a", i % 2 === 0));
      }
    `;
    const run = (id) => new Promise((done) => {
      const child = spawn(process.execPath, ["--input-type=module", "-e", script, home, root, String(id)], { stdio: ["ignore", "ignore", "pipe"] });
      let stderr = "";
      child.stderr.on("data", (chunk) => (stderr += chunk));
      child.on("close", (status) => done({ status, stderr }));
    });

    const results = await Promise.all(Array.from({ length: 8 }, (_, id) => run(id)));

    expect(results).toEqual(Array.from({ length: 8 }, () => ({ status: 0, stderr: "" })));
    expect(() => JSON.parse(readFileSync(cachePath(), "utf8"))).not.toThrow();
    expect(tempFiles()).toEqual([]);
  });
});

describe("n-dx home", () => {
  it("honours $NDX_HOME", () => {
    const custom = join(root, "custom-home");
    install(join(custom, "extensions"), manifest("ndx-a", "a"));

    const result = discover({ home: undefined, env: { NDX_HOME: custom } });

    expect(result.home).toBe(custom);
    expect(result.extensions.map((e) => e.name)).toEqual(["a"]);
    expect(existsSync(join(custom, EXTENSIONS_CACHE_FILE))).toBe(true);
  });

  it("uses the legacy ~/.n-dx when it is the only home present", () => {
    const userHome = join(root, "os-home");
    const legacy = join(userHome, ".n-dx");
    install(join(legacy, "extensions"), manifest("ndx-a", "a"));

    const result = discover({ home: undefined, env: {}, userHome });

    expect(result.home).toBe(legacy);
    expect(result.extensions.map((e) => e.name)).toEqual(["a"]);
  });
});

describe("findGlobalRoot", () => {
  const p = (...parts) => [sep === "\\" ? "C:" : "", ...parts].join(sep);

  it("is the node_modules holding @n-dx/core in an npm global install", () => {
    expect(findGlobalRoot(p("usr", "lib", "node_modules", "@n-dx", "core"))).toBe(p("usr", "lib", "node_modules"));
  });

  it("is the node_modules above .pnpm in a pnpm global install", () => {
    const real = p("pnpm", "global", "5", "node_modules", ".pnpm", "@n-dx+core@0.10.0", "node_modules", "@n-dx", "core");
    expect(findGlobalRoot(real)).toBe(p("pnpm", "global", "5", "node_modules"));
  });

  it("is null for a checkout", () => {
    expect(findGlobalRoot(p("src", "n-dx", "packages", "core"))).toBeNull();
  });

  it("is null for a project that installs @n-dx/core itself, run from any subdirectory", () => {
    const repo = join(root, "cloned-repo");
    writeJson(join(repo, "package.json"), { name: "cloned-repo", devDependencies: { "@n-dx/core": "^0.10.0" } });
    const core = join(repo, "node_modules", "@n-dx", "core");
    mkdirSync(core, { recursive: true });
    expect(findGlobalRoot(core, { env: {} })).toBeNull();
    expect(findGlobalRoot(join(repo, "node_modules", ".pnpm", "@n-dx+core@0.10.0", "node_modules", "@n-dx", "core"), { env: {} })).toBeNull();
  });

  it("is the node_modules of a real npm global prefix, which has no package.json", () => {
    const core = join(root, "prefix", "lib", "node_modules", "@n-dx", "core");
    mkdirSync(core, { recursive: true });
    expect(findGlobalRoot(core, { env: {} })).toBe(join(root, "prefix", "lib", "node_modules"));
  });

  /**
   * Install `@n-dx/core` into a global directory that, like the real ones, has
   * a package.json beside its node_modules; returns core's real directory.
   */
  const installGlobal = (globalDir, { viaPnpm = false } = {}) => {
    writeJson(join(globalDir, "package.json"), { dependencies: { "@n-dx/core": "0.10.0" } });
    const core = viaPnpm
      ? join(globalDir, "node_modules", ".pnpm", "@n-dx+core@0.10.0", "node_modules", "@n-dx", "core")
      : join(globalDir, "node_modules", "@n-dx", "core");
    mkdirSync(core, { recursive: true });
    return core;
  };

  it("is pnpm's global directory under $PNPM_HOME/global", () => {
    const pnpmHome = join(root, "pnpm-home");
    const core = installGlobal(join(pnpmHome, "global", "5"), { viaPnpm: true });
    const opts = { home: join(root, "user"), platform: "linux" };
    expect(findGlobalRoot(core, { ...opts, env: { PNPM_HOME: pnpmHome } })).toBe(join(pnpmHome, "global", "5", "node_modules"));
    expect(findGlobalRoot(core, { ...opts, env: {} })).toBeNull();
    expect(findGlobalRoot(core, { ...opts, env: { PNPM_HOME: join(root, "elsewhere") } })).toBeNull();
  });

  it.each([
    ["linux", (h) => join(h, ".local", "share", "pnpm")],
    ["darwin", (h) => join(h, "Library", "pnpm")],
    ["win32", (h) => join(h, "AppData", "Local", "pnpm")],
  ])("is pnpm's default global directory on %s when PNPM_HOME is unset", (platform, pnpmHome) => {
    const home = join(root, "user");
    const core = installGlobal(join(pnpmHome(home), "global", "5"), { viaPnpm: true });
    expect(findGlobalRoot(core, { env: {}, home, platform })).toBe(join(pnpmHome(home), "global", "5", "node_modules"));
  });

  it.each([
    ["yarn classic on linux", "linux", {}, (h) => join(h, ".config", "yarn", "global")],
    ["yarn classic under XDG_DATA_HOME", "linux", { XDG_DATA_HOME: "data" }, () => join(root, "data", "yarn", "global")],
    ["yarn classic on Windows", "win32", { LOCALAPPDATA: "local" }, () => join(root, "local", "Yarn", "Data", "global")],
    ["yarn classic's configured global folder", "linux", { YARN_GLOBAL_FOLDER: "yarn-global" }, () => join(root, "yarn-global")],
    ["bun", "darwin", {}, (h) => join(h, ".bun", "install", "global")],
    ["bun under BUN_INSTALL", "linux", { BUN_INSTALL: "bun" }, () => join(root, "bun", "install", "global")],
  ])("is the global directory of %s", (_label, platform, relEnv, globalDir) => {
    const home = join(root, "user");
    const env = Object.fromEntries(Object.entries(relEnv).map(([k, v]) => [k, join(root, v)]));
    const core = installGlobal(globalDir(home));
    expect(findGlobalRoot(core, { env, home, platform })).toBe(join(globalDir(home), "node_modules"));
  });

  it("is null for a project inside a known global directory's parent, or named like one", () => {
    const home = join(root, "user");
    const opts = { env: {}, home, platform: "linux" };
    // A project beside the global directory, and one whose own path ends in global/…
    expect(findGlobalRoot(installGlobal(join(home, ".config", "yarn", "project")), opts)).toBeNull();
    expect(findGlobalRoot(installGlobal(join(root, "clones", "install", "global")), opts)).toBeNull();
    expect(findGlobalRoot(installGlobal(join(root, "clones", "global", "5"), { viaPnpm: true }), opts)).toBeNull();
  });

  it("matches a known global directory reached through a symlinked home", () => {
    const realHome = join(root, "real-home");
    const core = installGlobal(join(realHome, ".bun", "install", "global"));
    const linkedHome = join(root, "linked-home");
    symlinkSync(realHome, linkedHome, "junction");
    expect(findGlobalRoot(core, { env: {}, home: linkedHome, platform: "linux" })).toBe(join(realHome, ".bun", "install", "global", "node_modules"));
  });
});

/** Move a path's mtime forward, as an install would; filesystems with coarse mtimes need it. */
function bumpMtime(path) {
  const later = new Date(Date.now() + 5_000);
  utimesSync(path, later, later);
}


describe("a linked dependency becoming an extension", () => {
  it.each(["project", "user", "global"])("invalidates a warm %s cache when the linked manifest gains a block", (source) => {
    const linked = join(root, "linked-checkout");
    writeJson(join(linked, "package.json"), { name: "ndx-linked", version: "1.0.0" });
    const folder = source === "project" ? project : userFolder();
    const modules = source === "global" ? globalRoot : join(folder, "node_modules");
    mkdirSync(modules, { recursive: true });
    if (source !== "global") writeJson(join(folder, "package.json"), { dependencies: { "ndx-linked": "file:../linked-checkout" } });
    symlinkSync(linked, join(modules, "ndx-linked"), "junction");
    expect(discover().extensions).toEqual([]);
    writeJson(join(linked, "package.json"), manifest("ndx-linked", "linked"));
    bumpMtime(join(linked, "package.json"));
    expect(discover().extensions).toMatchObject([{ name: "linked", source }]);
  });
});
