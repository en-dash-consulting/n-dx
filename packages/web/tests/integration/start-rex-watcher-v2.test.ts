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

describe("registerRexWatcher watcher errors", () => {
  it("survives an 'error' on every watcher it returns, closing and dropping each", () => {
    registerRexWatcher(
      undefined,
      rexDir,
      { refresh: () => {} } as never,
      { broadcast: () => {} } as never,
      watchers,
    );
    const registered = [...watchers];
    expect(registered.length).toBeGreaterThan(0);
    const closes = registered.map((w) => vi.spyOn(w, "close"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      for (const w of registered) {
        const err = Object.assign(new Error("EPERM: operation not permitted, watch"), { code: "EPERM" });
        expect(() => w.emit("error", err)).not.toThrow();
      }
      for (const close of closes) expect(close).toHaveBeenCalled();
      expect(watchers).toHaveLength(0);
      expect(warn).toHaveBeenCalledTimes(registered.length);
    } finally {
      warn.mockRestore();
    }
  });
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

  it("refreshes the PRD cache when a file under product/ is edited", async () => {
    const cachePath = join(rexDir, PRD_CACHE_DIR, PRD_CACHE_JSON);
    registerRexWatcher(
      undefined,
      rexDir,
      { refresh: () => {} } as never,
      { broadcast: () => {} } as never,
      watchers,
    );
    expect(existsSync(cachePath)).toBe(false);
    // .rex/ and product/. The count is what pins product/: on macOS the
    // recursive .rex/ watcher also reports a nested edit, so the refresh below
    // alone would pass without it.
    expect(watchers).toHaveLength(2);
    const capabilityPath = join(rexDir, "product", "checkout", "pay-by-card.md");
    const original = readFileSync(capabilityPath, "utf-8");
    expect(original).toMatch(/^title:.*$/m);
    // The cache projection does not carry capability fields, so the signal is
    // the cache being rewritten, not its content. Retried for the FSEvents
    // start-up gap described above.
    let attempt = 0;
    await vi.waitFor(() => {
      attempt += 1;
      writeFileSync(capabilityPath, original.replace(/^title:.*$/m, `title: "Edited ${attempt}"`));
      expect(existsSync(cachePath)).toBe(true);
    }, { timeout: 8_000, interval: 1_000 });
  });

  it("follows changes/ deleted and recreated while running, without growing the list", async () => {
    // Start with changes/ present so it is watched at boot.
    const changesDir = join(rexDir, "changes");
    const source = join(FIXTURE, "changes", "add-apple-pay");
    mkdirSync(changesDir);
    cpSync(source, join(changesDir, "add-apple-pay"), { recursive: true });
    const cachePath = join(rexDir, PRD_CACHE_DIR, PRD_CACHE_JSON);
    registerRexWatcher(
      undefined,
      rexDir,
      { refresh: () => {} } as never,
      { broadcast: () => {} } as never,
      watchers,
    );
    const bootWatchers = watchers.length;
    expect(bootWatchers).toBe(3); // .rex/, product/, changes/
    const original = readFileSync(join(source, "index.md"), "utf-8");
    const closes = watchers.map((w) => vi.spyOn(w, "close"));

    // Replace the directory (new inode). Retried: see the note above on
    // FSEvents; a replacement is only needed until the .rex/ event is seen.
    const indexPath = join(changesDir, "add-apple-pay", "index.md");
    await vi.waitFor(() => {
      if (!closes.some((c) => c.mock.calls.length > 0)) {
        rmSync(changesDir, { recursive: true, force: true });
        mkdirSync(changesDir);
        cpSync(source, join(changesDir, "add-apple-pay"), { recursive: true });
      }
      expect(closes.some((c) => c.mock.calls.length > 0)).toBe(true);
    }, { timeout: 8_000, interval: 1_000 });
    // The replaced watcher was closed and dropped; its successor took its place.
    expect(watchers).toHaveLength(bootWatchers);

    rmSync(cachePath, { force: true });
    let attempt = 0;
    await vi.waitFor(() => {
      attempt += 1;
      writeFileSync(indexPath, original.replace(/^title:.*$/m, `title: "Recreated ${attempt}"`));
      expect(readFileSync(cachePath, "utf-8")).toContain("Recreated ");
    }, { timeout: 8_000, interval: 1_000 });
    expect(watchers).toHaveLength(bootWatchers);
  });

  it("drops the watch on a PRD folder once it is deleted", async () => {
    // The re-watch must not hinge on the recreated directory getting a new
    // inode number (ext4 reuses freed ones): the deletion alone retires the
    // dead watcher, so whatever appears next is watched afresh.
    const changesDir = join(rexDir, "changes");
    mkdirSync(changesDir);
    registerRexWatcher(
      undefined,
      rexDir,
      { refresh: () => {} } as never,
      { broadcast: () => {} } as never,
      watchers,
    );
    expect(watchers).toHaveLength(3);
    const changesWatcher = watchers[watchers.length - 1]!;
    const close = vi.spyOn(changesWatcher, "close");
    // Retried for the FSEvents start-up gap described above: each retry
    // recreates and deletes the folder, another .rex/ event naming it.
    await vi.waitFor(() => {
      if (close.mock.calls.length === 0) {
        mkdirSync(changesDir, { recursive: true });
        rmSync(changesDir, { recursive: true, force: true });
      }
      expect(close).toHaveBeenCalled();
    }, { timeout: 8_000, interval: 1_000 });
    expect(watchers).not.toContain(changesWatcher);
    expect(watchers).toHaveLength(2);
  });
});
