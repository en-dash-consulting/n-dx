/**
 * `rex release stamp` through the CLI entry.
 *
 * The integration tests call cmdRelease in-process, which skips the two
 * dispatch lines the never-fail path depends on: "release" in
 * SKIP_DIR_CHECK, and resolving the dir from the third positional. If either
 * regresses, "1.0.0" is taken as the project dir (or the missing rex
 * directory is an error) and the release workflow's fail-open step only
 * prints a warning. These tests spawn the built CLI so that cannot pass
 * unseen.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cliPath = join(fileURLToPath(import.meta.url), "..", "..", "..", "dist", "cli", "index.js");

function run(args: string[], cwd: string): { status: number | null; stdout: string; stderr: string } {
  const r = spawnSync("node", [cliPath, ...args], { cwd, encoding: "utf-8", timeout: 10000 });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

describe("rex release stamp (CLI entry)", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-e2e-release-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("is a no-op on a v1 project when no dir is given", () => {
    expect(run(["init", tmpDir], tmpDir).status).toBe(0);

    const r = run(["release", "stamp", "1.0.0"], tmpDir);

    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(
      "Nothing to stamp: this project is on the v1 tree; shippedIn is stamped on v2 changes.",
    );
  });

  it("is a no-op when the given dir has no rex directory", () => {
    const r = run(["release", "stamp", "1.0.0", tmpDir], tmpDir);

    expect(r.stderr).toBe("");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(`Nothing to stamp: there is no rex directory in ${tmpDir}.`);
  });
});
