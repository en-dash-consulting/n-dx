/**
 * `ndx extensions` through the real CLI: dispatch, help, exit codes, and an
 * n-dx home of the test's own (`N_DX_HOME`). The subcommands themselves are
 * covered in tests/unit/extensions-command.test.js.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTmpDir, removeTmpDir, run, runResult } from "./e2e-helpers.js";

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
