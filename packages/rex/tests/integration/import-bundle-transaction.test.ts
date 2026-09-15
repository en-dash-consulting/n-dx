/**
 * Import writes under the PRD lock.
 *
 * `rex import-bundle` does a read-modify-write: it loads the tree, merges the
 * bundle into it, and saves the whole document. Done unlocked, a second writer
 * in that window would be silently overwritten — the exact lost-update the
 * store's `withTransaction` exists to prevent. These tests pin that the import
 * command actually uses it:
 *
 *   1. Two concurrent imports of disjoint bundles both survive — neither
 *      writer's items are lost.
 *   2. An import that cannot take the lock fails loudly, naming the holder,
 *      and leaves the tree untouched.
 *
 * @see packages/rex/src/cli/commands/import-bundle.ts
 * @see packages/rex/src/store/contracts.ts — withTransaction contract
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { prdLockPath } from "../../src/store/index.js";
import { SCHEMA_VERSION } from "../../src/schema/index.js";
import { readPRD } from "../helpers/rex-dir-test-support.js";
import type { PRDItem } from "../../src/schema/index.js";

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

async function writeBundle(path: string, items: PRDItem[]): Promise<void> {
  await writeFile(
    path,
    JSON.stringify({
      bundle: "rex/prd-bundle",
      bundleVersion: 1,
      schema: SCHEMA_VERSION,
      title: "Concurrent PRD",
      exportedAt: "2026-01-01T00:00:00.000Z",
      items,
    }),
  );
}

function epic(id: string, title: string): PRDItem {
  return { id, title, level: "epic", status: "pending", priority: "medium", acceptanceCriteria: [] };
}

/** Collect every id in a tree. */
function allIds(items: PRDItem[]): string[] {
  return items.flatMap((item) => [item.id, ...allIds(item.children ?? [])]);
}

describe("rex import-bundle transaction discipline", { timeout: 120_000 }, () => {
  let projectDir: string;

  beforeEach(async () => {
    projectDir = await mkdtemp(join(tmpdir(), "rex-bundle-txn-"));
    spawnSync("node", [cliPath, "init", projectDir], { encoding: "utf-8" });
  });

  afterEach(async () => {
    await rm(projectDir, { recursive: true, force: true });
  });

  it("does not lose either writer's items when two imports run concurrently", async () => {
    const first = join(projectDir, "first.json");
    const second = join(projectDir, "second.json");
    await writeBundle(first, [epic("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "From First Bundle")]);
    await writeBundle(second, [epic("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "From Second Bundle")]);

    const [a, b] = await Promise.all([
      runAsync(["import-bundle", `--in=${first}`, projectDir]),
      runAsync(["import-bundle", `--in=${second}`, projectDir]),
    ]);

    expect(a.status, a.output).toBe(0);
    expect(b.status, b.output).toBe(0);

    const ids = allIds(readPRD(projectDir).items);
    expect(ids).toContain("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(ids).toContain("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
  });

  it("fails without writing when another process holds the PRD lock", async () => {
    const bundlePath = join(projectDir, "bundle.json");
    await writeBundle(bundlePath, [epic("cccccccc-cccc-4ccc-8ccc-cccccccccccc", "Should Not Land")]);

    // A real live PID in a fresh lock file, so staleness cleanup cannot
    // reclaim the lock while the import is trying to take it.
    const holder = spawn(process.execPath, ["-e", "setTimeout(() => {}, 60000)"], { stdio: "ignore" });
    try {
      await writeFile(
        prdLockPath(join(projectDir, ".rex")),
        JSON.stringify({
          pid: holder.pid,
          token: "other-writer",
          timestamp: new Date().toISOString(),
        }),
        "utf-8",
      );

      const { status, output } = await runAsync(["import-bundle", `--in=${bundlePath}`, projectDir]);

      expect(status).not.toBe(0);
      expect(output).toMatch(new RegExp(`Held by PID ${holder.pid}`));
      expect(allIds(readPRD(projectDir).items)).not.toContain(
        "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      );
    } finally {
      holder.kill();
    }
  });
});
