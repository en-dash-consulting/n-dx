/**
 * `ndx extensions` and `ndx <extension command>` through the real CLI:
 * dispatch, help, exit codes, signals, and an n-dx home of the test's own
 * (`N_DX_HOME`). The subcommands and resolution themselves are covered in
 * tests/unit/extensions-command.test.js and tests/unit/extension-dispatch.test.js.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { CLI_PATH, createTmpDir, removeTmpDir, run, runResult } from "./e2e-helpers.js";

let root;
let home;

beforeEach(async () => {
  root = await createTmpDir("ndx-e2e-extensions-");
  home = join(root, "home");
  mkdirSync(home, { recursive: true });
});

afterEach(async () => {
  await removeTmpDir(root);
});

const env = () => ({ ...process.env, N_DX_HOME: home, NDX_HOME: "" });
const opts = () => ({ cwd: root, env: env() });

/** A user-installed extension whose command bin is missing. */
function installBroken() {
  const folder = join(home, "extensions");
  writeFileSync(join(mkdirp(folder), "package.json"), JSON.stringify({ name: "ndx-user-extensions", dependencies: { "ndx-recon": "^1.0.0" } }));
  writeFileSync(join(mkdirp(join(folder, "node_modules", "ndx-recon")), "package.json"), JSON.stringify({
    name: "ndx-recon",
    version: "1.0.0",
    ndx: { extension: { apiVersion: 1, name: "recon", ndxVersion: ">=0.0.0", commands: [{ name: "recon", bin: "bin/cli.js", summary: "Recon" }] } },
  }));
}

function mkdirp(dir) {
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("ndx extensions", () => {
  it("has its own help page and a line in the main help", () => {
    const help = run(["extensions", "--help"], opts());
    for (const sub of ["list", "add", "remove", "enable", "disable", "info", "doctor"]) {
      expect(help).toContain(`ndx extensions ${sub}`);
    }
    expect(run(["--help"], opts())).toMatch(/extensions <sub>/);
  });

  it("lists nothing in an empty home", () => {
    const out = run(["extensions", "list", "--json"], opts());
    expect(JSON.parse(out)).toEqual({ extensions: [], errors: [] });
  });

  it("lists an installed extension, and doctor exits 1 naming the missing bin", () => {
    installBroken();
    const [row] = JSON.parse(run(["extensions", "list", "--json"], opts())).extensions;
    expect(row).toMatchObject({ name: "recon", version: "1.0.0", source: "user", state: "unapproved" });

    const doctor = runResult(["extensions", "doctor"], opts());
    expect(doctor.code).toBe(1);
    expect(doctor.stdout).toMatch(/ndx-recon: ndx\.extension\.commands\[0\]\.bin "bin\/cli\.js" does not exist .* — fix: /);
  });

  it("enable without a terminal exits 2 and names --yes; with --yes it approves", () => {
    installBroken();
    const asked = runResult(["extensions", "enable", "recon"], opts());
    expect(asked.code).toBe(2);
    expect(asked.stderr).toMatch(/ndx extensions enable recon --yes/);

    run(["extensions", "enable", "recon", "--yes"], opts());
    const [row] = JSON.parse(run(["extensions", "list", "--json"], opts())).extensions;
    expect(row.state).toBe("enabled");
  });
});

/**
 * A user-installed extension `name` whose command prints its args and Node,
 * then exits with the code in its first arg (or waits, given `wait`).
 * Approved unless `approve` is false.
 */
function installEcho(name, { approve = true, ndxVersion = ">=0.0.0" } = {}) {
  const folder = join(home, "extensions");
  writeFileSync(join(mkdirp(folder), "package.json"), JSON.stringify({ name: "ndx-user-extensions", dependencies: { [`ndx-${name}`]: "^1.0.0" } }));
  const dir = mkdirp(join(folder, "node_modules", `ndx-${name}`));
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    name: `ndx-${name}`,
    version: "1.0.0",
    ndx: { extension: { apiVersion: 1, name, ndxVersion, commands: [{ name, bin: "bin/cli.js", summary: name }] } },
  }));
  writeFileSync(join(mkdirp(join(dir, "bin")), "cli.js"), [
    `process.on("SIGTERM", () => { console.log("got SIGTERM"); process.exit(7); });`,
    `console.log("args " + JSON.stringify(process.argv.slice(2)) + " exec " + process.execPath);`,
    `if (process.argv[2] === "wait") setInterval(() => {}, 1000);`,
    `else process.exit(Number(process.argv[2] ?? 0));`,
  ].join("\n"));
  if (approve) run(["extensions", "enable", name, "--yes"], opts());
}

/**
 * An approved user-installed extension `name` whose command prints, as JSON,
 * its NDX_* environment, whether its state folder exists, and what
 * `NDX_BIN version` prints when it re-enters n-dx.
 */
function installReport(name) {
  installEcho(name, { approve: false });
  const bin = join(home, "extensions", "node_modules", `ndx-${name}`, "bin", "cli.js");
  writeFileSync(bin, [
    `const { execFileSync } = require("node:child_process");`,
    `const { existsSync } = require("node:fs");`,
    `const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k.startsWith("NDX_")));`,
    `const reentered = execFileSync(process.execPath, [process.env.NDX_BIN, "version"], { encoding: "utf-8", windowsHide: true }).trim();`,
    `console.log(JSON.stringify({ env, stateDirExists: existsSync(process.env.NDX_EXTENSION_STATE_DIR), reentered }));`,
  ].join("\n"));
  run(["extensions", "enable", name, "--yes"], opts());
}

describe("ndx <extension command>", () => {
  for (const code of [0, 1, 7]) {
    it(`runs the bin with the remaining args and passes exit code ${code} through`, () => {
      installEcho("recon");
      const result = runResult(["recon", String(code), "--flag"], opts());
      expect(result.code).toBe(code);
      expect(result.stdout).toContain(`args ${JSON.stringify([String(code), "--flag"])}`);
    });
  }

  it("runs the extension with the Node n-dx runs on", () => {
    installEcho("recon");
    expect(run(["recon"], opts())).toContain(`exec ${process.execPath}`);
  });

  it("a built-in always wins over an extension claiming its name", () => {
    installEcho("version", { approve: false });
    const out = run(["version"], opts());
    expect(out).not.toContain("args");
    expect(out.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it("an unapproved extension exits 2 with one line naming enable", () => {
    installEcho("recon", { approve: false });
    const result = runResult(["recon"], opts());
    expect(result.code).toBe(2);
    expect(result.stdout).not.toContain("args");
    expect(result.stderr.trim()).toMatch(/^Error: 'ndx recon' comes from .* — fix: ndx extensions enable recon$/);
  });

  it("a disabled extension's name is an unknown command with a hint", () => {
    installEcho("recon");
    run(["extensions", "disable", "recon"], opts());
    const result = runResult(["recon"], opts());
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/Unknown command: recon/);
    expect(result.stderr).toMatch(/Hint: extension recon .* is disabled: .*'ndx extensions enable recon'/);
  });

  it("an incompatible extension's name is an unknown command with a hint", () => {
    installEcho("recon", { approve: false, ndxVersion: ">=99.0.0" });
    const result = runResult(["recon"], opts());
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/Hint: extension recon .* is incompatible: needs n-dx >=99\.0\.0/);
  });

  it("ndx --help lists enabled extension commands under EXTENSIONS with their summary", () => {
    expect(run(["--help"], opts())).not.toContain("EXTENSIONS");
    installEcho("recon", { approve: false });
    expect(run(["--help"], opts())).not.toContain("EXTENSIONS");

    run(["extensions", "enable", "recon", "--yes"], opts());
    const help = run(["--help"], opts());
    const section = help.slice(help.indexOf("EXTENSIONS"));
    expect(section).toMatch(/^EXTENSIONS\n {2}recon +recon\n/);
    expect(run([], opts())).toContain(section.split("\n\n")[0]);
  });

  it("ndx <name> --help is passed through to the extension", () => {
    installEcho("recon");
    writeFileSync(join(home, "extensions", "node_modules", "ndx-recon", "bin", "cli.js"), `console.log("args " + JSON.stringify(process.argv.slice(2)));`);
    const result = runResult(["recon", "--help"], opts());
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`args ${JSON.stringify(["--help"])}`);
  });

  it("a name nothing claims is today's unknown command", () => {
    const result = runResult(["recon"], opts());
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/Unknown command: recon/);
    expect(result.stderr).toMatch(/Hint: Run 'ndx --help'/);
  });

  it("gives the extension the environment contract, and no token", () => {
    installReport("recon");
    writeFileSync(join(home, "auth.token"), "s3cret-token\n");
    const report = JSON.parse(run(["recon"], opts()));
    const stateDir = join(home, "ext", "recon");
    expect(report.env).toMatchObject({
      NDX_EXTENSION_API: "1",
      NDX_VERSION: report.reentered,
      NDX_BIN: realpathSync(CLI_PATH),
      NDX_HOME: home,
      NDX_EXTENSION_NAME: "recon",
      NDX_EXTENSION_STATE_DIR: stateDir,
      NDX_EXTENSION_CONFIG: join(stateDir, "ndx-config.json"),
    });
    expect(report.stateDirExists).toBe(true);
    expect(report.env).not.toHaveProperty("NDX_HUB_URL");
    expect(JSON.stringify(report)).not.toContain("s3cret-token");
  });

  // n-dx installed as a project dependency and globally: both reached through a
  // node_modules link, as npm and pnpm install it.
  for (const install of ["project", "global"]) {
    it(`NDX_BIN re-enters the same n-dx from a ${install} install`, () => {
      installReport("recon");
      const prefix = install === "project" ? join(root, "app") : join(root, "global", "lib");
      const coreDir = join(mkdirp(join(prefix, "node_modules", "@n-dx")), "core");
      symlinkSync(dirname(CLI_PATH), coreDir, "junction");
      const out = execFileSync(process.execPath, [join(coreDir, "cli.js"), "recon"], { ...opts(), encoding: "utf-8", windowsHide: true });
      const report = JSON.parse(out);
      expect(realpathSync(report.env.NDX_BIN)).toBe(realpathSync(join(coreDir, "cli.js")));
      expect(report.reentered).toBe(run(["version"], opts()).trim());
    });
  }

  it("hands the extension an empty config file when no section is set", () => {
    installConfigReader("recon");
    expect(JSON.parse(run(["recon"], opts()))).toEqual({});
  });

  it.skipIf(process.platform === "win32")("forwards SIGTERM to the extension and exits with its code", async () => {
    installEcho("recon");
    const child = spawn(process.execPath, [CLI_PATH, "recon", "wait"], { ...opts(), stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      if (stdout.includes("args ")) child.kill("SIGTERM");
    });
    const code = await new Promise((resolve) => child.on("close", resolve));
    expect(stdout).toContain("got SIGTERM");
    expect(code).toBe(7);
  });
});

/**
 * An approved user-installed extension `name` whose command prints the JSON
 * file `NDX_EXTENSION_CONFIG` names, with `schema` as its configSchema when given.
 */
function installConfigReader(name, schema) {
  installEcho(name, { approve: false });
  const dir = join(home, "extensions", "node_modules", `ndx-${name}`);
  writeFileSync(join(dir, "bin", "cli.js"), `process.stdout.write(require("node:fs").readFileSync(process.env.NDX_EXTENSION_CONFIG, "utf-8"));`);
  if (schema) {
    const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf-8"));
    pkg.ndx.extension.configSchema = "schema/config.json";
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
    writeFileSync(join(mkdirp(join(dir, "schema")), "config.json"), JSON.stringify(schema));
  }
  run(["extensions", "enable", name, "--yes"], opts());
}

const RECON_SCHEMA = {
  type: "object",
  properties: {
    mode: { enum: ["fast", "deep"] },
    depth: { type: "integer", minimum: 1 },
    target: { type: "string" },
  },
  required: ["target"],
  additionalProperties: false,
};

const readJson = (path) => JSON.parse(readFileSync(path, "utf-8"));

describe("ndx config extensions.<name>", () => {
  it("merges the project section over the user's and hands the result to the extension", () => {
    installConfigReader("recon", RECON_SCHEMA);
    expect(run(["config", "extensions.recon.mode", "deep", "--user"], opts())).toContain("extensions.recon.mode = deep");
    run(["config", "extensions.recon.depth", "3", "--user"], opts());
    run(["config", "extensions.recon.mode", "fast"], opts());
    run(["config", "extensions.recon.target", "12345"], opts());

    expect(readJson(join(home, "config.json")).extensions.recon).toEqual({ mode: "deep", depth: 3 });
    expect(readJson(join(root, ".n-dx.json")).extensions.recon).toEqual({ mode: "fast", target: "12345" });

    const merged = { mode: "fast", depth: 3, target: "12345" };
    expect(JSON.parse(run(["config", "extensions.recon", "--json"], opts()))).toEqual(merged);
    expect(run(["config", "extensions.recon.depth"], opts()).trim()).toBe("3");
    expect(JSON.parse(run(["recon"], opts()))).toEqual(merged);
  });

  it("refuses a value the configSchema rejects, unless --force", () => {
    installConfigReader("recon", RECON_SCHEMA);
    const bad = runResult(["config", "extensions.recon.mode", "slow"], opts());
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain('mode must be one of: "fast", "deep"');
    expect(bad.stderr).toContain("--force");
    expect(runResult(["config", "extensions.recon.depth", "0"], opts()).stderr).toContain("depth must be >= 1");
    expect(runResult(["config", "extensions.recon.extra", "1"], opts()).stderr).toContain('must not have the property "extra"');

    run(["config", "extensions.recon.mode", "slow", "--force"], opts());
    expect(readJson(join(root, ".n-dx.json")).extensions.recon.mode).toBe("slow");
  });

  it("refuses to run an extension whose merged section breaks its schema, required keys included", () => {
    installConfigReader("recon", RECON_SCHEMA);
    run(["config", "extensions.recon.mode", "fast"], opts());
    const result = runResult(["recon"], opts());
    expect(result.code).toBe(2);
    expect(result.stderr).toContain('the section must have the property "target"');
    expect(result.stderr).toContain("fix: ndx config extensions.recon.<key> <value>");
  });

  it("refuses a key for an extension that is not installed, unless --force", () => {
    const result = runResult(["config", "extensions.ghost.mode", "fast"], opts());
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/No installed extension is named "ghost" — fix: ndx extensions list/);
    run(["config", "extensions.ghost.mode", "fast", "--force"], opts());
    expect(run(["config", "extensions.ghost.mode"], opts()).trim()).toBe("fast");
  });

  it("says when the project config overrides a --user write", () => {
    installConfigReader("recon");
    run(["config", "extensions.recon.mode", "fast"], opts());
    // runResult keeps stderr only on failure; this note comes with exit 0.
    const result = spawnSync(process.execPath, [CLI_PATH, "config", "extensions.recon.mode", "deep", "--user"], { ...opts(), encoding: "utf-8", windowsHide: true });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain('the project config also sets "extensions.recon.mode", and its value wins');
  });
});

/** A user-installed extension `name` that declares only a sidecar. */
function installSidecar(name, { approve = true, sidecar = { bin: "bin/serve.js", health: "/healthz" } } = {}) {
  const folder = join(home, "extensions");
  writeFileSync(join(mkdirp(folder), "package.json"), JSON.stringify({ name: "ndx-user-extensions", dependencies: { [`ndx-${name}`]: "^1.0.0" } }));
  const dir = mkdirp(join(folder, "node_modules", `ndx-${name}`));
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    name: `ndx-${name}`,
    version: "1.0.0",
    ndx: { extension: { apiVersion: 1, name, ndxVersion: ">=0.0.0", sidecar } },
  }));
  writeFileSync(join(mkdirp(join(dir, "bin")), "serve.js"), "// served by the hub\n");
  if (approve) run(["extensions", "enable", name, "--yes"], opts());
  return dir;
}

describe("ndx extensions sidecar", () => {
  it("prints the hub's launch plan for an enabled sidecar, with the defaults filled in", () => {
    const dir = installSidecar("recon", { sidecar: { bin: "bin/serve.js" } });
    const plan = JSON.parse(run(["extensions", "sidecar", "recon", "--json"], opts()));
    const stateDir = join(home, "ext", "recon");
    expect(plan).toMatchObject({
      name: "recon",
      execPath: process.execPath,
      bin: join(dir, "bin", "serve.js"),
      cwd: stateDir,
      health: "/",
      idleStopMinutes: 15,
      logFile: join(stateDir, "logs", "sidecar.log"),
    });
    expect(plan.env).toMatchObject({ NDX_EXTENSION_NAME: "recon", NDX_EXTENSION_STATE_DIR: stateDir });
    expect(readJson(plan.env.NDX_EXTENSION_CONFIG)).toEqual({});
    expect(readdirSync(join(stateDir, "logs"))).toEqual([]);
  });

  it("keeps the manifest's health path", () => {
    installSidecar("recon");
    expect(JSON.parse(run(["extensions", "sidecar", "recon", "--json"], opts())).health).toBe("/healthz");
  });

  it("refuses an unapproved sidecar with exit 2, naming enable", () => {
    installSidecar("recon", { approve: false });
    const result = runResult(["extensions", "sidecar", "recon", "--json"], opts());
    expect(result.code).toBe(2);
    const body = JSON.parse(result.stdout);
    expect(body.reason).toBe("refused");
    expect(body.error).toMatch(/is unapproved .* — fix: ndx extensions enable recon$/);
    expect(result.stderr.trim()).toBe(body.error);
  });

  it("refuses a name with no sidecar with exit 2", () => {
    installEcho("recon");
    const result = runResult(["extensions", "sidecar", "recon", "--json"], opts());
    expect(result.code).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({ reason: "none" });
  });
});
