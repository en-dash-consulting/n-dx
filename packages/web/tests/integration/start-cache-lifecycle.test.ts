/**
 * PRD cache lifecycle integration test.
 *
 * Verifies the three phases of the ephemeral `.rex/.cache/prd.json` lifecycle:
 *
 *   1. Boot  — `refreshPRDCache` creates the cache from `prd.md`
 *   2. Watch — mutating `prd.md` and refreshing updates the cache content
 *   3. Shutdown — removing the cache dir (as `closeWatchers` does) leaves
 *                 no trace on disk
 *
 * These tests exercise the private helper exported for testing. The full
 * `startServer` path (which also calls `refreshPRDCache` at boot and wires
 * the fs.watch debounce) requires built static assets and is covered by the
 * manual verification steps in the plan document.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { refreshPRDCache } from "../../src/server/start.js";
import { PRD_CACHE_DIR, PRD_CACHE_JSON } from "../../src/server/prd-io.js";

// ── Helpers ────────────────────────────────────────────────────────────────

function makePrdMd(title: string, items: { id: string; title: string }[] = []): string {
  const itemsYaml = items
    .map((i) => `  - id: ${i.id}\n    title: "${i.title}"\n    level: epic\n    status: pending`)
    .join("\n");
  const frontmatter = `---\nschema: rex/v1\ntitle: ${title}${items.length ? "\nitems:\n" + itemsYaml : ""}\n---`;
  return frontmatter + "\n\n# " + title + "\n";
}

// ── Fixtures ───────────────────────────────────────────────────────────────

let tmpDir: string;
let rexDir: string;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "prd-cache-lifecycle-"));
  rexDir = join(tmpDir, ".rex");
  mkdirSync(rexDir, { recursive: true });
});

afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

// ── Phase 1: Boot ─────────────────────────────────────────────────────────

describe("refreshPRDCache — boot phase", () => {
  it("creates .cache/prd.json from prd.md", async () => {
    writeFileSync(join(rexDir, "prd.md"), makePrdMd("Boot PRD", [{ id: "e1", title: "First Epic" }]));

    await refreshPRDCache(rexDir);

    const cachePath = join(rexDir, PRD_CACHE_DIR, PRD_CACHE_JSON);
    expect(existsSync(cachePath)).toBe(true);
  });

  it("cache content matches the parsed prd.md document", async () => {
    writeFileSync(
      join(rexDir, "prd.md"),
      makePrdMd("My PRD", [{ id: "e1", title: "Alpha Epic" }, { id: "e2", title: "Beta Epic" }]),
    );

    await refreshPRDCache(rexDir);

    const cached = JSON.parse(readFileSync(join(rexDir, PRD_CACHE_DIR, PRD_CACHE_JSON), "utf-8"));
    expect(cached.title).toBe("My PRD");
    expect(cached.items).toHaveLength(2);
    expect(cached.items[0].id).toBe("e1");
    expect(cached.items[1].id).toBe("e2");
  });

  it("does nothing when prd.md is absent", async () => {
    await refreshPRDCache(rexDir);

    expect(existsSync(join(rexDir, PRD_CACHE_DIR))).toBe(false);
  });

  it("overwrites a stale cache when prd.md exists", async () => {
    const cacheDir = join(rexDir, PRD_CACHE_DIR);
    mkdirSync(cacheDir, { recursive: true });
    writeFileSync(join(cacheDir, PRD_CACHE_JSON), JSON.stringify({ title: "Stale", schema: "rex/v1", items: [] }));

    writeFileSync(join(rexDir, "prd.md"), makePrdMd("Fresh PRD"));

    await refreshPRDCache(rexDir);

    const cached = JSON.parse(readFileSync(join(cacheDir, PRD_CACHE_JSON), "utf-8"));
    expect(cached.title).toBe("Fresh PRD");
  });
});

// ── Phase 2: Watch (mutation) ─────────────────────────────────────────────

describe("refreshPRDCache — mutation phase", () => {
  it("updates cache when prd.md is mutated and refresh is called again", async () => {
    writeFileSync(join(rexDir, "prd.md"), makePrdMd("Before", [{ id: "e1", title: "Old Epic" }]));
    await refreshPRDCache(rexDir);

    const v1 = JSON.parse(readFileSync(join(rexDir, PRD_CACHE_DIR, PRD_CACHE_JSON), "utf-8"));
    expect(v1.title).toBe("Before");

    writeFileSync(
      join(rexDir, "prd.md"),
      makePrdMd("After", [{ id: "e1", title: "Old Epic" }, { id: "e2", title: "New Epic" }]),
    );
    await refreshPRDCache(rexDir);

    const v2 = JSON.parse(readFileSync(join(rexDir, PRD_CACHE_DIR, PRD_CACHE_JSON), "utf-8"));
    expect(v2.title).toBe("After");
    expect(v2.items).toHaveLength(2);
  });
});

// ── Phase 3: Shutdown ─────────────────────────────────────────────────────

describe("cache cleanup — shutdown phase", () => {
  it("removing the cache dir leaves no trace on disk", async () => {
    writeFileSync(join(rexDir, "prd.md"), makePrdMd("Shutdown Test"));
    await refreshPRDCache(rexDir);

    const cacheDir = join(rexDir, PRD_CACHE_DIR);
    expect(existsSync(cacheDir)).toBe(true);

    rmSync(cacheDir, { recursive: true, force: true });

    expect(existsSync(cacheDir)).toBe(false);
    expect(existsSync(join(rexDir, "prd.md"))).toBe(true);
  });

  it("prd.md is unaffected by cache removal", async () => {
    writeFileSync(join(rexDir, "prd.md"), makePrdMd("Source of Truth", [{ id: "e1", title: "Epic" }]));
    await refreshPRDCache(rexDir);

    rmSync(join(rexDir, PRD_CACHE_DIR), { recursive: true, force: true });

    const md = readFileSync(join(rexDir, "prd.md"), "utf-8");
    expect(md).toContain("Source of Truth");
  });
});
