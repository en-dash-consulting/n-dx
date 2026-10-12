/**
 * An ndx command that spawns rex several times prints the v1 deprecation
 * notice once: core prints it and sets NDX_LEGACY_NOTICE=off for its children.
 * Direct rex use keeps rex's own notice.
 *
 * @see packages/core/cli.js (noteLegacyLayoutOnce)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CLI_PATH, createTmpDir, removeTmpDir, setupSourcevisionDir, withSandboxedClaudeConfig } from "./e2e-helpers.js";

const NOTICE = "Deprecated: this PRD uses the v1 layout (prd_tree/). Run 'ndx migrate'";

/** Unlike the shared runResult, keeps stderr of a successful run, which is where the notice goes. */
function runResult(args, opts = {}) {
  const out = spawnSync("node", [CLI_PATH, ...args], {
    encoding: "utf-8",
    timeout: 60_000,
    windowsHide: true,
    ...withSandboxedClaudeConfig(opts),
  });
  return { stdout: out.stdout, stderr: out.stderr, status: out.status };
}

const count = (text) => text.split(NOTICE).length - 1;

describe("v1 deprecation notice per ndx command", () => {
  let dir;

  beforeEach(async () => {
    dir = await createTmpDir("ndx-legacy-notice-once-");
    await setupSourcevisionDir(dir);
    await writeFile(join(dir, "CODE_OF_CONDUCT.md"), "# Code of Conduct\nBe kind.\n");
    expect(runResult(["rex", "init", dir]).status).toBe(0);
    expect(runResult(["rex", "add", "epic", "--title=Billing", dir]).status).toBe(0);
  });

  afterEach(async () => {
    await removeTmpDir(dir);
  });

  it("ndx ci prints it exactly once across its rex spawns", () => {
    const out = runResult(["ci", dir]);
    expect(count(out.stderr)).toBe(1);
    expect(out.stdout).not.toContain(NOTICE);
  });

  it("ndx status prints it exactly once", () => {
    const out = runResult(["status", dir]);
    expect(out.status).toBe(0);
    expect(count(out.stderr)).toBe(1);
  });

  it("--quiet drops it", () => {
    expect(count(runResult(["status", "--quiet", dir]).stderr)).toBe(0);
  });

  it("ndx rex status (direct rex use) still gets rex's own notice, once", () => {
    expect(count(runResult(["rex", "status", dir]).stderr)).toBe(1);
  });
});
