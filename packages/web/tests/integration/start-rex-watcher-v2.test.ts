/**
 * The rex watcher on a v2 project: rex creates `changes/` only once the first
 * change exists, so a folder absent at boot must still refresh
 * `.rex/.cache/prd.json` when it appears.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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

describe("registerRexWatcher on a v2 tree", () => {
  it("refreshes the PRD cache when changes/ is created after boot", async () => {
    const cachePath = join(rexDir, PRD_CACHE_DIR, PRD_CACHE_JSON);
    registerRexWatcher(
      undefined,
      rexDir,
      { refresh: () => {} } as never,
      { broadcast: () => {} } as never,
      watchers,
    );
    expect(existsSync(cachePath)).toBe(false);
    // .rex/ itself and product/; changes/ does not exist yet.
    const bootWatchers = watchers.length;
    expect(bootWatchers).toBe(2);

    // Each step is repeated, not done once: on macOS fs.watch returns before
    // its FSEvents stream is live, so a write made straight after registration
    // can go unseen, and under load that gap outlasts the whole wait. Every
    // retry is another event the armed watcher must report. The interval stays
    // above the watcher's 500ms debounce, which every event restarts.
    // changes/ is recreated only while its lazy watch has not been added, so a
    // retry never deletes a directory that is already being watched.
    const changesDir = join(rexDir, "changes");
    const source = join(FIXTURE, "changes", "add-apple-pay");
    await vi.waitFor(() => {
      if (watchers.length === bootWatchers) {
        rmSync(changesDir, { recursive: true, force: true });
        mkdirSync(changesDir);
        cpSync(source, join(changesDir, "add-apple-pay"), { recursive: true });
      }
      expect(existsSync(cachePath)).toBe(true);
    }, { timeout: 8_000, interval: 1_000 });
    expect(watchers.length).toBe(bootWatchers + 1);
    const doc = JSON.parse(readFileSync(cachePath, "utf-8")) as { items: Array<{ title: string }> };
    expect(doc.items.map((i) => i.title)).toContain("Add Apple Pay");

    // The new folder is now watched too: an edit inside it, which the
    // non-recursive .rex/ watcher cannot see, refreshes again.
    const indexPath = join(changesDir, "add-apple-pay", "index.md");
    const original = readFileSync(indexPath, "utf-8");
    let attempt = 0;
    await vi.waitFor(() => {
      attempt += 1;
      writeFileSync(indexPath, original.replace(/^title:.*$/m, `title: "Renamed ${attempt}"`));
      expect(readFileSync(cachePath, "utf-8")).toContain("Renamed ");
    }, { timeout: 8_000, interval: 1_000 });
  });
});
