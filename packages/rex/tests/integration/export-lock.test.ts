/**
 * Export reads under the PRD lock.
 *
 * `rex export` snapshots the tree into a durable artifact — a bundle that is
 * later imported (possibly with `--replace`) elsewhere. The folder tree is
 * written file-by-file, so an unlocked read racing a writer can capture item A
 * pre-write and item B post-write: a torn snapshot that propagates silently.
 * Unlike `rex status`, whose stale read self-corrects on the next look, a torn
 * bundle is permanent.
 *
 * These tests pin that export takes the PRD lock for its document load and
 * fails loudly — naming the holder — rather than reading a possibly-mixed
 * tree, for both the bundle and the narrative renderings.
 *
 * @see packages/rex/src/cli/commands/export.ts
 * @see tests/integration/import-bundle-transaction.test.ts — the write-side twin
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { prdLockPath } from "../../src/store/index.js";

const cliPath = join(
  fileURLToPath(import.meta.url),
  "..",
  "..",
  "..",
  "dist",
  "cli",
  "index.js",
);

/** Run the CLI, resolving with combined output and exit status. */
function runAsync(args: string[]): Promise<{ status: number | null; output: string }> {
  return new Promise((resolve) => {
    const proc = spawn("node", [cliPath, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    proc.stdout.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    proc.stderr.on("data", (chunk: Buffer) => { output += chunk.toString(); });
    proc.on("close", (status) => resolve({ status, output }));
  });
}

describe("rex export lock discipline", { timeout: 120_000 }, () => {
  let projectDir: string;
  /** A live process to own the lock, so staleness cleanup cannot reclaim it. */
  let holder: ReturnType<typeof spawn>;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "rex-export-lock-"));
    spawnSync("node", [cliPath, "init", projectDir], { encoding: "utf-8" });

    holder = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
    await writeFile(
      prdLockPath(join(projectDir, ".rex")),
      JSON.stringify({
        pid: holder.pid,
        token: "other-writer",
        timestamp: new Date().toISOString(),
      }),
      "utf-8",
    );
  });

  afterEach(async () => {
    holder.kill();
    await rm(projectDir, { recursive: true, force: true });
  });

  it("fails loudly instead of exporting a bundle while another process holds the lock", async () => {
    const outPath = join(projectDir, "bundle.json");

    const { status, output } = await runAsync(["export", `--out=${outPath}`, projectDir]);

    expect(status).not.toBe(0);
    expect(output).toMatch(new RegExp(`Held by PID ${holder.pid}`));
    expect(existsSync(outPath)).toBe(false);
  });

  it("holds the narrative rendering to the same lock", async () => {
    const outPath = join(projectDir, "prd.md");

    const { status, output } = await runAsync([
      "export",
      "--format=narrative",
      `--out=${outPath}`,
      projectDir,
    ]);

    expect(status).not.toBe(0);
    expect(output).toMatch(new RegExp(`Held by PID ${holder.pid}`));
    expect(existsSync(outPath)).toBe(false);
  });
});
