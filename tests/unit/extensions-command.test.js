/**
 * `ndx extensions` (packages/core/extensions-command.js) and the state it
 * reads and writes (packages/core/extension-state.js).
 *
 * npm is replaced by a fake that installs from an in-memory registry into the
 * folder it is run in, so `add` and `remove` are checked for where they run
 * and what they leave behind without the network.
 *
 * @see docs/architecture/extensions.md — "Management commands", "Trust, versioning and config"
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync, utimesSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative } from "node:path";
import { EXTENSIONS_SUBCOMMANDS, localSpecPath, runExtensions } from "../../packages/core/extensions-command.js";
import { EXTENSION_STATES, manifestHash } from "../../packages/core/extension-state.js";

const BUILTINS = ["init", "work", "status", "config", "start", "extensions"];
const NDX_VERSION = "0.10.0";

let root;
let home;
let project;
/** Packages the fake npm can install, by spec. */
let registry;
/** Every npm call: args and cwd. */
let npmCalls;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ndx-ext-command-"));
  home = join(root, "home");
  project = join(root, "project");
  for (const dir of [home, project]) mkdirSync(dir, { recursive: true });
  writeJson(join(project, "package.json"), { name: "some-project", dependencies: {} });
  registry = {};
  npmCalls = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function writeJson(path, value) {
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(value, null, 2));
}

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

/** A package.json with an `ndx.extension` block, and the files its paths name. */
function extensionPackage(packageName, name, { version = "1.0.0", ndxVersion = ">=0.10.0 <0.12.0", extra = {} } = {}) {
  return {
    name: packageName,
    version,
    ndx: {
      extension: {
        apiVersion: 1,
        name,
        ndxVersion,
        commands: [{ name, bin: "bin/cli.js", summary: `The ${name} extension` }],
        ...extra,
      },
    },
  };
}

/** Write a package directory, with its bin files unless `withBin` is false. */
function writePackage(dir, pkg, { withBin = true } = {}) {
  writeJson(join(dir, "package.json"), pkg);
  if (withBin) {
    mkdirSync(join(dir, "bin"), { recursive: true });
    writeFileSync(join(dir, "bin", "cli.js"), "throw new Error('extension code must never run during management');\n");
  }
}

/** Seconds since the epoch, moved forward on every install. */
let clock = Math.floor(Date.now() / 1000);

/**
 * Install into `<folder>/node_modules` and list it, the way npm leaves things.
 * The listing's mtime moves forward each time, as it would across real
 * installs; two writes within one timestamp tick would otherwise look like
 * none to discovery's cache.
 */
function installInto(folder, pkg, options, saved = `^${pkg.version}`) {
  const listing = join(folder, "package.json");
  const current = existsSync(listing) ? readJson(listing) : { name: "listing" };
  current.dependencies = { ...current.dependencies, [pkg.name]: saved };
  writeJson(listing, current);
  writePackage(join(folder, "node_modules", ...pkg.name.split("/")), pkg, options);
  clock += 10;
  utimesSync(listing, clock, clock);
}

const userFolder = () => join(home, "extensions");

async function fakeNpm(args, { cwd }) {
  npmCalls.push({ args, cwd });
  const [verb, ...rest] = args;
  const names = rest.filter((a) => !a.startsWith("-"));
  if (verb === "install") {
    const spec = names[0];
    if (!isAbsolute(spec)) {
      const pkg = registry[spec];
      if (!pkg) return 1;
      installInto(cwd, pkg);
      return 0;
    }
    // A path, read from cwd as npm would: a folder with a package.json, or a
    // tarball the test registered under its absolute path. npm saves either
    // as a relative file: spec.
    if (!existsSync(spec)) return 1;
    const pkg = existsSync(join(spec, "package.json")) ? readJson(join(spec, "package.json")) : registry[spec];
    if (!pkg) return 1;
    installInto(cwd, pkg, undefined, `file:${relative(cwd, spec).replaceAll("\\", "/")}`);
    return 0;
  }
  if (verb === "uninstall") {
    const listing = readJson(join(cwd, "package.json"));
    for (const name of names) {
      delete listing.dependencies[name];
      rmSync(join(cwd, "node_modules", ...name.split("/")), { recursive: true, force: true });
    }
    writeJson(join(cwd, "package.json"), listing);
    clock += 10;
    utimesSync(join(cwd, "package.json"), clock, clock);
    return 0;
  }
  return 1;
}

/** Run `ndx extensions …` and capture its output. */
async function ndx(args, deps = {}) {
  const out = [];
  const err = [];
  const code = await runExtensions(args, {
    builtinCommands: BUILTINS,
    ndxVersion: NDX_VERSION,
    cwd: project,
    home,
    globalRoot: null,
    runNpm: fakeNpm,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    ...deps,
  });
  return { code, out: out.join("\n"), err: err.join("\n") };
}

async function listJson() {
  const { code, out } = await ndx(["list", "--json"]);
  expect(code).toBe(0);
  return JSON.parse(out).extensions;
}

const stateOf = async (name) => (await listJson()).find((e) => e.name === name);

describe("ndx extensions list --json", () => {
  it("gives name, version, source, state and reason for each extension", async () => {
    installInto(userFolder(), extensionPackage("@acme/ndx-recon", "recon", { version: "1.2.0" }));
    const [row] = await listJson();
    expect(row).toMatchObject({
      name: "recon",
      packageName: "@acme/ndx-recon",
      version: "1.2.0",
      source: "user",
      state: "unapproved",
      reason: "not approved yet",
      manifest: { apiVersion: 1, name: "recon" },
    });
  });

  it("reports every state the criteria name", async () => {
    installInto(userFolder(), extensionPackage("ndx-on", "on"));
    installInto(userFolder(), extensionPackage("ndx-off", "off"));
    installInto(userFolder(), extensionPackage("ndx-new", "fresh"));
    installInto(userFolder(), extensionPackage("ndx-old", "old", { ndxVersion: "<0.10.0" }));
    installInto(userFolder(), { name: "ndx-future", version: "1.0.0", ndx: { extension: { apiVersion: 99, name: "future" } } });
    expect((await ndx(["enable", "on", "--yes"])).code).toBe(0);
    expect((await ndx(["enable", "off", "--yes"])).code).toBe(0);
    expect((await ndx(["disable", "off"])).code).toBe(0);

    const rows = Object.fromEntries((await listJson()).map((r) => [r.name, r]));
    expect(rows.on).toMatchObject({ state: "enabled", reason: "" });
    expect(rows.off).toMatchObject({ state: "disabled" });
    expect(rows.fresh).toMatchObject({ state: "unapproved" });
    expect(rows.old).toMatchObject({ state: "incompatible", reason: "needs n-dx <0.10.0; this is 0.10.0" });
    expect(rows.future.state).toBe("incompatible");
    expect(rows.future.reason).toMatch(/apiVersion/);
    for (const row of Object.values(rows)) expect(EXTENSION_STATES).toContain(row.state);
  });

  it("names an invalid manifest's first problem as the reason", async () => {
    installInto(userFolder(), extensionPackage("ndx-broken", "broken", { extra: { commands: [{ name: "broken", summary: "x" }] } }));
    const row = await stateOf("broken");
    expect(row.state).toBe("invalid");
    expect(row.reason).toMatch(/commands\[0\]\.bin/);
    expect(row.manifest).toBeNull();
  });

  it("reports a package whose version is not semver as invalid, never approvable", async () => {
    installInto(userFolder(), extensionPackage("ndx-odd", "odd", { version: "latest" }));
    const row = await stateOf("odd");
    expect(row).toMatchObject({ state: "invalid", version: "latest" });
    expect(row.reason).toMatch(/version/);
    const enable = await ndx(["enable", "odd", "--yes"]);
    expect(enable.code).toBe(1);
    expect(readJson(join(home, "extensions.json")).approvals ?? {}).toEqual({});
  });

  it("list and info print a package's control characters as visible escapes", async () => {
    const spoof = "1.0.0\n  source   project (/trusted)\u001b[2K";
    installInto(userFolder(), extensionPackage("ndx-spoof", "spoof", { version: spoof }));
    for (const args of [["list"], ["info", "spoof"], ["doctor"]]) {
      const { out, err } = await ndx(args);
      expect(`${out}\n${err}`, args.join(" ")).not.toMatch(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f]/);
      expect(out.split("\n").some((line) => line.startsWith("  source   project")), args.join(" ")).toBe(false);
    }
    expect((await ndx(["info", "spoof"])).out).toContain("1.0.0\\x0a  source   project (/trusted)\\x1b[2K");
    expect((await stateOf("spoof")).version).toBe(spoof);
  });

  it("prints a table, and says so when nothing is installed", async () => {
    expect((await ndx(["list"])).out).toMatch(/No extensions installed/);
    installInto(userFolder(), extensionPackage("ndx-recon", "recon"));
    const { out } = await ndx([]);
    expect(out.split("\n")[0]).toMatch(/^NAME\s+VERSION\s+SOURCE\s+STATE\s+REASON$/);
    expect(out).toMatch(/recon\s+1\.0\.0\s+user\s+unapproved/);
  });
});

describe("ndx extensions add", () => {
  it("installs into <ndx home>/extensions with install scripts off, and leaves the project alone", async () => {
    registry["@acme/ndx-recon"] = extensionPackage("@acme/ndx-recon", "recon");
    const projectBefore = readFileSync(join(project, "package.json"), "utf8");

    const { code, out } = await ndx(["add", "@acme/ndx-recon"]);

    expect(code).toBe(0);
    expect(npmCalls).toHaveLength(1);
    expect(npmCalls[0].cwd).toBe(userFolder());
    expect(npmCalls[0].args).toEqual(expect.arrayContaining(["install", "@acme/ndx-recon", "--ignore-scripts"]));
    expect(readFileSync(join(project, "package.json"), "utf8")).toBe(projectBefore);
    expect(readJson(join(userFolder(), "package.json")).dependencies).toHaveProperty("@acme/ndx-recon");
    expect(out).toMatch(/Added @acme\/ndx-recon@1\.0\.0 as 'recon' \(unapproved/);
    expect(out).toMatch(/ndx extensions enable recon/);
  });

  it("uninstalls a package that is not an extension and fails", async () => {
    registry["left-pad"] = { name: "left-pad", version: "1.3.0" };
    const { code, err } = await ndx(["add", "left-pad"]);
    expect(code).toBe(1);
    expect(err).toMatch(/left-pad is not an n-dx extension/);
    expect(npmCalls.map((c) => c.args[0])).toEqual(["install", "uninstall"]);
    expect(readJson(join(userFolder(), "package.json")).dependencies).toEqual({});
  });

  it("installs a relative tarball or folder from where the command runs, not from the ndx home", async () => {
    const tarball = join(project, "ndx-recon-1.0.0.tgz");
    writeFileSync(tarball, "");
    registry[tarball] = extensionPackage("@acme/ndx-recon", "recon");
    const checkout = join(root, "checkouts", "hello");
    writePackage(checkout, extensionPackage("ndx-hello", "hello"));

    const fromTarball = await ndx(["add", "./ndx-recon-1.0.0.tgz"]);
    const fromFolder = await ndx(["add", "../checkouts/hello"]);

    expect(fromTarball).toMatchObject({ code: 0, err: "" });
    expect(fromFolder).toMatchObject({ code: 0, err: "" });
    expect(npmCalls.map((c) => c.args[1])).toEqual([tarball, checkout]);
    expect(npmCalls.every((c) => c.cwd === userFolder())).toBe(true);
    expect(fromTarball.out).toMatch(/Added @acme\/ndx-recon@1\.0\.0 as 'recon'/);
    expect(fromFolder.out).toMatch(/Added ndx-hello@1\.0\.0 as 'hello'/);
  });

  it("reports an extension re-added by path as that extension", async () => {
    writePackage(join(root, "checkouts", "hello"), extensionPackage("ndx-hello", "hello"));
    expect((await ndx(["add", "../checkouts/hello"])).code).toBe(0);

    const again = await ndx(["add", "../checkouts/hello"]);

    expect(again).toMatchObject({ code: 0, err: "" });
    expect(again.out).toMatch(/Added ndx-hello@1\.0\.0 as 'hello'/);
    expect(npmCalls.map((c) => c.args[0])).toEqual(["install", "install"]);
  });

  it("refuses a flag it does not take instead of dropping it", async () => {
    registry["@acme/ndx-recon"] = extensionPackage("@acme/ndx-recon", "recon");
    const { code, err } = await ndx(["add", "@acme/ndx-recon", "--registry=https://npm.example.com"]);
    expect(code).toBe(1);
    expect(err).toMatch(/'ndx extensions add' does not take --registry=https:\/\/npm\.example\.com/);
    expect(err).toMatch(/npm_config_/);
    expect(npmCalls).toEqual([]);
    expect((await ndx(["remove", "recon", "--force"])).err).toMatch(/'ndx extensions remove' does not take --force/);
  });

  it("takes n-dx's global flags with every subcommand and still refuses an unknown one", async () => {
    for (const sub of EXTENSIONS_SUBCOMMANDS) {
      for (const flag of ["--quiet", "-q", "--verbose", "--debug"]) {
        expect((await ndx([sub, flag])).err).not.toMatch(/does not take/);
      }
    }
    const { code, err } = await ndx(["list", "--quiet", "--loud"]);
    expect(code).toBe(1);
    expect(err).toMatch(/'ndx extensions list' does not take --loud\./);
  });

  it("fails when npm does", async () => {
    const { code, err } = await ndx(["add", "@acme/missing"]);
    expect(code).toBe(1);
    expect(err).toMatch(/npm install @acme\/missing failed/);
  });
});

describe("localSpecPath", () => {
  it("resolves the specs npm reads as paths against the caller's cwd, and leaves the rest alone", () => {
    const cwd = join(root, "here");
    expect(localSpecPath("./pkg.tgz", cwd)).toBe(join(cwd, "pkg.tgz"));
    expect(localSpecPath("../folder", cwd)).toBe(join(root, "folder"));
    expect(localSpecPath("..", cwd)).toBe(root);
    expect(localSpecPath("pkg.tgz", cwd)).toBe(join(cwd, "pkg.tgz"));
    expect(localSpecPath("file:../folder", cwd)).toBe(join(root, "folder"));
    expect(localSpecPath(join(root, "abs"), cwd)).toBe(join(root, "abs"));
    for (const spec of ["@acme/ndx-recon", "ndx-recon@1.2.0", "github:acme/ndx-recon", "https://example.com/ndx-recon.tgz", "git+https://example.com/r.git"]) {
      expect(localSpecPath(spec, cwd), spec).toBeNull();
    }
  });
});

describe("ndx extensions remove", () => {
  it("uninstalls a user extension, forgets its approval, and --purge deletes its state folder", async () => {
    installInto(userFolder(), extensionPackage("@acme/ndx-recon", "recon"));
    await ndx(["enable", "recon", "--yes"]);
    const stateDir = join(home, "ext", "recon");
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "data.json"), "{}");

    const { code } = await ndx(["remove", "recon", "--purge"]);

    expect(code).toBe(0);
    expect(npmCalls.at(-1)).toMatchObject({ cwd: userFolder(), args: expect.arrayContaining(["uninstall", "@acme/ndx-recon"]) });
    expect(readJson(join(home, "extensions.json")).approvals).toEqual({});
    expect(existsSync(stateDir)).toBe(false);
    expect(await listJson()).toEqual([]);
  });

  it("--purge keeps the state folder when a shadowed copy takes over, and names that copy", async () => {
    const globalRoot = join(root, "global", "node_modules");
    writePackage(join(globalRoot, "ndx-recon"), extensionPackage("ndx-recon", "recon"));
    installInto(userFolder(), extensionPackage("ndx-recon", "recon"));
    const stateDir = join(home, "ext", "recon");
    mkdirSync(stateDir, { recursive: true });

    const { code, out, err } = await ndx(["remove", "recon", "--purge"], { globalRoot });

    expect(code).toBe(0);
    expect(existsSync(stateDir)).toBe(true);
    expect(out).toMatch(/The global copy at .*ndx-recon now applies\./);
    expect(err).toMatch(/Nothing purged: the global copy at .*ndx-recon now uses the state folder of 'recon'\./);
    expect(JSON.parse((await ndx(["list", "--json"], { globalRoot })).out).extensions).toEqual([expect.objectContaining({ name: "recon", source: "global" })]);
  });

  it("--purge keeps the state folder when another package claims the same extension name, and names it", async () => {
    const globalRoot = join(root, "global", "node_modules");
    writePackage(join(globalRoot, "@b", "recon"), extensionPackage("@b/recon", "recon"));
    installInto(userFolder(), extensionPackage("@a/recon", "recon"));
    const stateDir = join(home, "ext", "recon");
    mkdirSync(stateDir, { recursive: true });

    const { code, err } = await ndx(["remove", "@a/recon", "--purge"], { globalRoot });

    expect(code).toBe(0);
    expect(existsSync(stateDir)).toBe(true);
    expect(err).toMatch(/Nothing purged: @b\/recon \(global, .*recon\) also claims 'recon' and uses its state folder\./);
    expect(JSON.parse((await ndx(["list", "--json"], { globalRoot })).out).extensions).toEqual([expect.objectContaining({ packageName: "@b/recon" })]);
  });

  it("keeps the state folder without --purge", async () => {
    installInto(userFolder(), extensionPackage("ndx-recon", "recon"));
    mkdirSync(join(home, "ext", "recon"), { recursive: true });
    expect((await ndx(["remove", "recon"])).code).toBe(0);
    expect(existsSync(join(home, "ext", "recon"))).toBe(true);
  });

  it("refuses an extension that add did not install, naming where it comes from", async () => {
    installInto(project, extensionPackage("ndx-recon", "recon"));
    const { code, err } = await ndx(["remove", "recon"]);
    expect(code).toBe(1);
    expect(err).toMatch(/comes from the project source/);
    expect(err).toMatch(/project's package\.json/);
    expect(npmCalls).toEqual([]);
  });

  it("reports an unknown name", async () => {
    const { code, err } = await ndx(["remove", "nope"]);
    expect(code).toBe(1);
    expect(err).toMatch(/No installed extension is named 'nope'/);
  });
});

describe("ndx extensions enable and disable", () => {
  beforeEach(() => {
    installInto(userFolder(), extensionPackage("@acme/ndx-recon", "recon", { extra: { sidecar: { bin: "bin/cli.js" } } }));
  });

  it("with --yes, approves without asking and records the manifest hash and version", async () => {
    const { code, out } = await ndx(["enable", "recon", "--yes"]);
    expect(code).toBe(0);
    expect(out).toMatch(/package {2}@acme\/ndx-recon@1\.0\.0/);
    expect(out).toMatch(/command {2}ndx recon → bin\/cli\.js/);
    expect(out).toMatch(/sidecar {2}bin\/cli\.js/);
    const approval = readJson(join(home, "extensions.json")).approvals["@acme/ndx-recon"];
    expect(approval).toMatchObject({ version: "1.0.0", source: "user" });
    expect(approval.manifestHash).toBe(manifestHash(extensionPackage("@acme/ndx-recon", "recon", { extra: { sidecar: { bin: "bin/cli.js" } } }).ndx.extension));
    expect((await stateOf("recon")).state).toBe("enabled");
  });

  it("exits 2 with the --yes hint when there is no terminal to ask on", async () => {
    const { code, err } = await ndx(["enable", "recon"], { confirm: undefined });
    expect(code).toBe(2);
    expect(err).toMatch(/ndx extensions enable recon --yes/);
    expect((await stateOf("recon")).state).toBe("unapproved");
  });

  it("asks, and approves only on yes", async () => {
    const asked = [];
    expect((await ndx(["enable", "recon"], { confirm: async (q) => (asked.push(q), false) })).code).toBe(1);
    expect((await stateOf("recon")).state).toBe("unapproved");
    expect((await ndx(["enable", "recon"], { confirm: async (q) => (asked.push(q), true) })).code).toBe(0);
    expect((await stateOf("recon")).state).toBe("enabled");
    expect(asked).toEqual(["Approve and enable 'recon'?", "Approve and enable 'recon'?"]);
  });

  it("disable keeps the approval, so enabling again does not ask", async () => {
    await ndx(["enable", "recon", "--yes"]);
    expect((await ndx(["disable", "recon"])).code).toBe(0);
    expect((await stateOf("recon")).state).toBe("disabled");
    expect(readJson(join(home, "extensions.json")).approvals).toHaveProperty("@acme/ndx-recon");

    const { code } = await ndx(["enable", "recon"], { confirm: async () => { throw new Error("must not ask"); } });
    expect(code).toBe(0);
    expect((await stateOf("recon")).state).toBe("enabled");
  });

  it("asks again after the version or the manifest changes", async () => {
    await ndx(["enable", "recon", "--yes"]);
    installInto(userFolder(), extensionPackage("@acme/ndx-recon", "recon", { version: "1.1.0", extra: { sidecar: { bin: "bin/cli.js" } } }));
    expect(await stateOf("recon")).toMatchObject({ state: "unapproved", reason: "version changed since approval (1.0.0 → 1.1.0)" });

    await ndx(["enable", "recon", "--yes"]);
    installInto(userFolder(), extensionPackage("@acme/ndx-recon", "recon", { version: "1.1.0" }));
    expect(await stateOf("recon")).toMatchObject({ state: "unapproved", reason: "manifest changed since approval" });
  });

  it("asks again when a linked package's own package.json changes, with nothing else touched", async () => {
    // `ndx extensions add <folder>` leaves a symlink: an edit to the folder
    // moves no mtime in the user folder or its node_modules.
    const target = join(root, "checkouts", "recon");
    const link = join(userFolder(), "node_modules", "@acme", "ndx-recon");
    writePackage(target, extensionPackage("@acme/ndx-recon", "recon"));
    rmSync(link, { recursive: true, force: true });
    symlinkSync(target, link, "junction");
    await ndx(["enable", "recon", "--yes"]);
    expect((await stateOf("recon")).state).toBe("enabled");
    const edit = (pkg, seconds) => {
      writeJson(join(target, "package.json"), pkg);
      clock += seconds;
      utimesSync(join(target, "package.json"), clock, clock);
    };

    edit(extensionPackage("@acme/ndx-recon", "recon", { version: "2.0.0" }), 10);
    expect(await stateOf("recon")).toMatchObject({ state: "unapproved", reason: "version changed since approval (1.0.0 → 2.0.0)" });

    await ndx(["enable", "recon", "--yes"]);
    edit(extensionPackage("@acme/ndx-recon", "recon", { version: "2.0.0", extra: { commands: [{ name: "recon", bin: "bin/other.js", summary: "Moved" }] } }), 10);
    expect(await stateOf("recon")).toMatchObject({ state: "unapproved", reason: "manifest changed since approval" });
  });

  it("approves a project-source extension for that project only", async () => {
    installInto(project, extensionPackage("ndx-local", "local"));
    await ndx(["enable", "local", "--yes"]);
    expect((await stateOf("local")).state).toBe("enabled");
    const file = readJson(join(home, "extensions.json"));
    expect(file.approvals ?? {}).not.toHaveProperty("ndx-local");
    expect(Object.values(file.projectApprovals)[0]).toHaveProperty("ndx-local");

    const clone = join(root, "clone");
    installInto(clone, extensionPackage("ndx-local", "local"));
    const { out } = await ndx(["list", "--json"], { cwd: clone });
    expect(JSON.parse(out).extensions.find((e) => e.name === "local")).toMatchObject({ state: "unapproved", reason: "not approved for this project" });
  });

  it("an approval covers only the copy approved, not a same-named, same-version copy elsewhere", async () => {
    const pkg = extensionPackage("ndx-foo", "foo");
    const approvedRoot = join(root, "approved-global", "node_modules");
    const otherRoot = join(root, "clone", "node_modules");
    writePackage(join(approvedRoot, "ndx-foo"), pkg);
    writePackage(join(otherRoot, "ndx-foo"), pkg);
    const state = async (globalRoot) => JSON.parse((await ndx(["list", "--json"], { globalRoot })).out).extensions.find((e) => e.name === "foo");

    expect((await ndx(["enable", "foo", "--yes"], { globalRoot: approvedRoot })).code).toBe(0);
    expect(readJson(join(home, "extensions.json")).approvals["ndx-foo"]).toMatchObject({ source: "global", dir: realpathSync(join(approvedRoot, "ndx-foo")) });
    expect((await state(approvedRoot)).state).toBe("enabled");

    // Same source, other directory.
    expect(await state(otherRoot)).toMatchObject({ state: "unapproved", reason: expect.stringMatching(/^the approval is for another copy \(global: /) });

    // Approved in the user source; the user copy goes and a global one is left.
    installInto(userFolder(), pkg);
    expect((await ndx(["enable", "foo", "--yes"], { globalRoot: approvedRoot })).code).toBe(0);
    expect(readJson(join(home, "extensions.json")).approvals["ndx-foo"]).toMatchObject({ source: "user" });
    rmSync(join(userFolder(), "node_modules", "ndx-foo"), { recursive: true });
    clock += 10;
    utimesSync(join(userFolder(), "node_modules"), clock, clock);
    expect(await state(approvedRoot)).toMatchObject({ state: "unapproved", reason: expect.stringMatching(/^the approval is for another copy \(user: /) });
  });

  it("an extension named constructor is not found in what every object inherits", async () => {
    installInto(userFolder(), extensionPackage("constructor", "constructor"));
    await ndx(["disable", "recon"]);
    expect(await stateOf("constructor")).toMatchObject({ state: "unapproved", reason: "not approved yet" });

    expect((await ndx(["enable", "constructor", "--yes"])).code).toBe(0);
    expect((await stateOf("constructor")).state).toBe("enabled");
    expect((await ndx(["disable", "constructor"])).code).toBe(0);
    expect((await stateOf("constructor")).state).toBe("disabled");
    expect((await ndx(["enable", "constructor"])).code).toBe(0);
    expect((await stateOf("constructor")).state).toBe("enabled");
  });

  it("refuses to enable an incompatible extension", async () => {
    installInto(userFolder(), extensionPackage("ndx-old", "old", { ndxVersion: "<0.10.0" }));
    const { code, err } = await ndx(["enable", "old", "--yes"]);
    expect(code).toBe(1);
    expect(err).toMatch(/cannot be enabled: incompatible/);
  });

  it("keeps the discovery cache when it writes a decision", async () => {
    await ndx(["list"]);
    expect(readJson(join(home, "extensions.json"))).toHaveProperty("discovery");
    await ndx(["disable", "recon"]);
    const file = readJson(join(home, "extensions.json"));
    expect(file).toHaveProperty("discovery");
    expect(file.disabled).toHaveProperty("recon");
  });
});

describe("ndx extensions info", () => {
  it("shows the manifest, the state and the copies it shadows", async () => {
    installInto(project, extensionPackage("ndx-recon", "recon", { version: "2.0.0" }));
    installInto(userFolder(), extensionPackage("ndx-recon", "recon", { version: "1.0.0" }));
    const { code, out } = await ndx(["info", "recon"]);
    expect(code).toBe(0);
    expect(out).toMatch(/package {4}ndx-recon@2\.0\.0/);
    expect(out).toMatch(/source {5}project/);
    expect(out).toMatch(/command {4}ndx recon — The recon extension/);
    expect(out).toMatch(/also found user: .*\(1\.0\.0\) — not used/);

    const json = JSON.parse((await ndx(["info", "ndx-recon", "--json"])).out);
    expect(json).toMatchObject({ name: "recon", source: "project", state: "unapproved" });
    expect(json.shadowed).toEqual([expect.objectContaining({ source: "user", version: "1.0.0" })]);
  });
});

describe("ndx extensions doctor", () => {
  /** A global source, so these tests see no note about a missing one. */
  const withGlobal = () => {
    const globalRoot = join(root, "global", "node_modules");
    mkdirSync(globalRoot, { recursive: true });
    return { globalRoot };
  };

  it("exits 0 and says so when nothing is wrong", async () => {
    installInto(userFolder(), extensionPackage("ndx-recon", "recon"));
    const { code, out } = await ndx(["doctor"], withGlobal());
    expect(code).toBe(0);
    expect(out).toBe("No problems found in 1 extension.");
  });

  it("notes when no global source was recognised, without counting it as a problem", async () => {
    installInto(userFolder(), extensionPackage("ndx-recon", "recon"));
    const { code, out } = await ndx(["doctor"], { globalRoot: null });
    expect(code).toBe(0);
    expect(out.split("\n")).toEqual([
      expect.stringMatching(/^Note: this n-dx is not in a recognised global install .*globally installed extensions are not discovered\.$/),
      "No problems found in 1 extension.",
    ]);
  });

  it("prints one line per problem, each with its fix, and exits 1", async () => {
    installInto(userFolder(), extensionPackage("ndx-nobin", "nobin"), { withBin: false });
    installInto(userFolder(), extensionPackage("ndx-old", "old", { ndxVersion: "<0.10.0" }));
    installInto(userFolder(), extensionPackage("ndx-broken", "broken", { extra: { commands: [] } }));
    installInto(userFolder(), extensionPackage("ndx-one", "same"));
    installInto(userFolder(), extensionPackage("ndx-two", "same"));
    const listing = readJson(join(userFolder(), "package.json"));
    listing.dependencies["ndx-gone"] = "^1.0.0";
    writeJson(join(userFolder(), "package.json"), listing);

    const { code, out, err } = await ndx(["doctor"], withGlobal());

    expect(code).toBe(1);
    const lines = out.split("\n");
    for (const line of lines) expect(line).toMatch(/ — fix: /);
    expect(lines.filter((l) => l.startsWith("ndx-nobin:"))).toEqual([expect.stringMatching(/commands\[0\]\.bin "bin\/cli\.js" does not exist/)]);
    expect(lines.filter((l) => l.startsWith("ndx-old:"))).toEqual([expect.stringMatching(/needs n-dx <0\.10\.0; this is 0\.10\.0/)]);
    expect(lines.some((l) => l.startsWith("ndx-broken:") && l.includes("[nothing-declared]"))).toBe(true);
    expect(lines.filter((l) => l.startsWith("ndx-one:"))).toEqual([expect.stringMatching(/"same" also claimed by ndx-two/)]);
    expect(lines.filter((l) => l.startsWith("ndx-gone:"))).toEqual([expect.stringMatching(/not installed/)]);
    expect(err).toBe(`${lines.length} problems found.`);
  });

  it("reports an unreadable extensions.json instead of failing on it", async () => {
    writeFileSync(join(home, "extensions.json"), "{ not json");
    const { code, out } = await ndx(["doctor"]);
    expect(code).toBe(1);
    expect(out).toMatch(/extensions\.json: is not valid JSON.* — fix: fix or delete/);
  });
});

it("rejects an unknown subcommand", async () => {
  const { code, err } = await ndx(["frobnicate"]);
  expect(code).toBe(1);
  expect(err).toMatch(/Unknown 'ndx extensions' subcommand: frobnicate/);
});
