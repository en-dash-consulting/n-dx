/**
 * `ndx extensions` and `ndx <extension command>` through the real CLI:
 * dispatch, help, exit codes, signals, and an n-dx home of the test's own
 * (`N_DX_HOME`). The subcommands and resolution themselves are covered in
 * tests/unit/extensions-command.test.js and tests/unit/extension-dispatch.test.js.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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

  it("a name nothing claims is today's unknown command", () => {
    const result = runResult(["recon"], opts());
    expect(result.code).toBe(1);
    expect(result.stderr).toMatch(/Unknown command: recon/);
    expect(result.stderr).toMatch(/Hint: Run 'ndx --help'/);
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
