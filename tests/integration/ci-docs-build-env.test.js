/**
 * `ndx ci` runs the repository's own `pnpm docs:build` (#686 finding 3
 * follow-up). That script belongs to the checkout, so it gets the same
 * sanitized repository-command environment as every other repository-owned
 * command — not the operator's whole shell.
 *
 * runCI's injected spawn sends the docs build to a real node stub with the
 * options ci.js chose, so the stub reports what the child actually sees.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const { runCI } = await import("../../packages/core/ci.js");

const SECRET_NAME = "NDX_TEST_DOCS_BUILD_TOKEN";
const STUB = "process.stdout.write(JSON.stringify({ secret: process.env[process.argv[1]] ?? null, path: Boolean(process.env.PATH ?? process.env.Path) }))";

let projectDir;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "ndx-ci-docs-env-"));
  mkdirSync(join(projectDir, ".rex"), { recursive: true });
  mkdirSync(join(projectDir, ".sourcevision"), { recursive: true });
  process.env[SECRET_NAME] = "operator-secret";
});

afterEach(() => {
  delete process.env[SECRET_NAME];
  rmSync(projectDir, { recursive: true, force: true });
});

/** Runs `ndx ci` in-process and returns what the docs-build child saw. */
async function docsBuildView() {
  let seen;
  const spawnTracked = (cmd, args, opts) => {
    if (cmd === "pnpm" && args[0] === "docs:build") {
      const { shell: _shell, ...rest } = opts;
      const child = spawn(process.execPath, ["-e", STUB, SECRET_NAME], rest);
      let out = "";
      child.stdout.on("data", (d) => { out += d; });
      child.on("close", () => { seen = JSON.parse(out); });
      return child;
    }
    // Every other ci step: an immediate no-op child.
    return spawn(process.execPath, ["-e", ""], { stdio: ["ignore", "pipe", "pipe"] });
  };
  await runCI(projectDir, ["--quiet"], { run: () => {}, tools: { sourcevision: "sv.js", rex: "rex.js" }, spawnTracked });
  return seen;
}

describe("ndx ci docs build environment", () => {
  it("does not hand the operator's credentials to the repository's docs:build", async () => {
    const seen = await docsBuildView();
    expect(seen).toBeDefined();
    expect(seen.secret).toBeNull();
    // Sanitized, not emptied: the build still finds its tools.
    expect(seen.path).toBe(true);
  });

  it("ignores the checkout's own guard.env.allow until the checkout is trusted", async () => {
    mkdirSync(join(projectDir, ".hench"), { recursive: true });
    writeFileSync(join(projectDir, ".hench", "config.json"), JSON.stringify({ guard: { env: { allow: ["*"] } } }));
    const seen = await docsBuildView();
    expect(seen.secret).toBeNull();
  });
});
