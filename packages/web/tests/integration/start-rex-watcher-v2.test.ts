/**
 * The rex watcher on a v2 project: rex creates `changes/` only once the first
 * change exists, so a folder absent at boot must still refresh
 * `.rex/.cache/prd.json` when it appears.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cpSync, mkdirSync, mkdtempSync, rmSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import type { FSWatcher } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { registerRexWatcher } from "../../src/server/start.js";
import { PRD_CACHE_DIR, PRD_CACHE_JSON } from "../../src/server/prd-io.js";

const FIXTURE = resolve(__dirname, "../../../rex/tests/fixtures/v2-tree");

let tmpDir: string;
let rexDir: string;
let watchers: FSWatcher[];

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "rex-watcher-v2-"));
  rexDir = join(tmpDir, ".rex");
  cpSync(FIXTURE, rexDir, { recursive: true });
  // A freshly bootstrapped v2 tree: product/ only, no change yet.
  rmSync(join(rexDir, "changes"), { recursive: true, force: true });
  watchers = [];
});

afterEach(() => {
  for (const w of watchers) w.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

async function waitFor(predicate: () => boolean, timeoutMs = 8000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return predicate();
}

describe("registerRexWatcher on a v2 tree", () => {
  it("refreshes the PRD cache when changes/ is created after boot", async () => {
    const cachePath = join(rexDir, PRD_CACHE_DIR, PRD_CACHE_JSON);
    const broadcasts: unknown[] = [];
    registerRexWatcher(
      undefined,
      rexDir,
      { refresh: () => {} } as never,
      { broadcast: (msg: unknown) => { broadcasts.push(msg); } } as never,
      watchers,
    );
    expect(existsSync(cachePath)).toBe(false);

    const source = join(FIXTURE, "changes", "add-apple-pay");
    mkdirSync(join(rexDir, "changes"));
    cpSync(source,join(rexDir, "changes", "add-apple-pay"), { recursive: true });

    expect(await waitFor(() => existsSync(cachePath))).toBe(true);
    const doc = JSON.parse(readFileSync(cachePath, "utf-8")) as { items: Array<{ title: string }> };
    expect(doc.items.length).toBeGreaterThan(0);

    // The new folder is now watched too: a later edit inside it refreshes again.
    const before = readFileSync(cachePath, "utf-8");
    const indexPath = join(rexDir, "changes", "add-apple-pay", "index.md");
    writeFileSync(indexPath, readFileSync(indexPath, "utf-8").replace(/^title:.*$/m, "title: Renamed after watch"));
    expect(await waitFor(() => readFileSync(cachePath, "utf-8") !== before)).toBe(true);
  });
});
