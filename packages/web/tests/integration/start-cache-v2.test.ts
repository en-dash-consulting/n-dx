/**
 * PRD cache on a v2 project: `.rex/.cache/prd.json` is the change-layer
 * projection, and `prdExists` / `prdMaxMtimeMs` see a v2 tree. v1 is
 * covered by start-cache-lifecycle.test.ts.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cpSync, mkdtempSync, rmSync, readFileSync, existsSync, utimesSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { refreshPRDCache } from "../../src/server/start.js";
import { PRD_CACHE_DIR, PRD_CACHE_JSON, prdExists, prdMaxMtimeMs, loadPRDSync } from "../../src/server/prd-io.js";

const FIXTURE = resolve(__dirname, "../../../rex/tests/fixtures/v2-tree");

let tmpDir: string;
let rexDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "prd-cache-v2-"));
  rexDir = join(tmpDir, ".rex");
  cpSync(FIXTURE, rexDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("v2 PRD cache", () => {
  it("prdExists is true for a v2 tree", () => {
    expect(prdExists(rexDir)).toBe(true);
  });

  it("refreshPRDCache writes the change-layer projection with titles", async () => {
    await refreshPRDCache(rexDir);

    const cachePath = join(rexDir, PRD_CACHE_DIR, PRD_CACHE_JSON);
    expect(existsSync(cachePath)).toBe(true);
    const doc = JSON.parse(readFileSync(cachePath, "utf-8")) as { items: Array<{ title: string }> };
    expect(doc.items.length).toBeGreaterThan(0);
    expect(doc.items.every((i) => typeof i.title === "string" && i.title.length > 0)).toBe(true);
  });

  it("loadPRDSync, which the task list, Live and the merge graph read, returns titled items", async () => {
    await refreshPRDCache(rexDir);

    const doc = loadPRDSync(rexDir);
    expect(doc).not.toBeNull();
    expect(doc!.items.map((i) => i.title)).toContain(JSON.parse(readFileSync(join(rexDir, PRD_CACHE_DIR, PRD_CACHE_JSON), "utf-8")).items[0].title);
    expect(doc!.items.length).toBeGreaterThan(0);
    expect(doc!.product?.some((node) => node.type === "area")).toBe(true);
  });

  it("prdMaxMtimeMs follows edits under changes/", () => {
    // A fixed mtime set here, far past any copied fixture file's, so the
    // verdict is exact equality and reads no clock.
    const stamped = new Date("2100-01-01T00:00:00Z");
    utimesSync(join(rexDir, "changes", "add-apple-pay", "index.md"), stamped, stamped);
    expect(prdMaxMtimeMs(rexDir)).toBe(stamped.getTime());
  });
});
