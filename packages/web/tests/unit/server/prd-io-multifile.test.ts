/**
 * Tests for prd-io.ts — the web server's synchronous PRD I/O helpers.
 *
 * After the Markdown-only migration, prd-io reads from:
 *   1. `.rex/.cache/prd.json` (ephemeral server cache — fast path)
 *   2. `.rex/prd.md` (fallback when cache is absent)
 *
 * Writes go to `.rex/prd.md` (Markdown source of truth) and also refresh
 * the cache file for immediate read consistency.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync, existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadPRDSync,
  prdExists,
  prdMaxMtimeMs,
  savePRDSync,
  discoverMarkdownPRDFiles,
  PRD_CACHE_DIR,
  PRD_CACHE_JSON,
} from "../../../src/server/prd-io.js";
import type { PRDDocument } from "../../../src/server/rex-gateway.js";

const SCHEMA = "rex/v1";

function makeDoc(title: string, items: unknown[]): PRDDocument {
  return { schema: SCHEMA, title, items } as PRDDocument;
}

function makeEpic(id: string, title: string) {
  return { id, title, status: "pending", level: "epic" };
}

function prdMd(title: string, items: { id: string; title: string }[]): string {
  const itemsYaml = items
    .map((i) => `  - id: ${i.id}\n    title: "${i.title}"\n    level: epic\n    status: pending`)
    .join("\n");
  const frontmatter = `---\nschema: ${SCHEMA}\ntitle: ${title}${items.length ? "\nitems:\n" + itemsYaml : ""}\n---`;
  return frontmatter + "\n\n# " + title + "\n";
}

describe("prd-io", () => {
  let rexDir: string;

  beforeEach(() => {
    const tmp = mkdtempSync(join(tmpdir(), "web-prdio-"));
    rexDir = join(tmp, ".rex");
    mkdirSync(rexDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rexDir, { recursive: true, force: true });
  });

  // ── prdExists ─────────────────────────────────────────────────────────

  describe("prdExists", () => {
    it("returns true when prd.md exists", () => {
      writeFileSync(join(rexDir, "prd.md"), prdMd("Test", []));
      expect(prdExists(rexDir)).toBe(true);
    });

    it("returns false when prd.md is absent", () => {
      expect(prdExists(rexDir)).toBe(false);
    });

    it("returns true for legacy prd.json (backward-compatibility fallback)", () => {
      writeFileSync(join(rexDir, "prd.json"), JSON.stringify(makeDoc("Legacy", [])));
      expect(prdExists(rexDir)).toBe(true);
    });
  });

  // ── discoverMarkdownPRDFiles ───────────────────────────────────────────

  describe("discoverMarkdownPRDFiles", () => {
    it("returns empty when no branch markdown files exist", () => {
      writeFileSync(join(rexDir, "prd.md"), prdMd("Primary", []));
      expect(discoverMarkdownPRDFiles(rexDir)).toEqual([]);
    });

    it("discovers branch-scoped .md files sorted lexicographically", () => {
      writeFileSync(join(rexDir, "prd_main_2026-01-01.md"), prdMd("Main", []));
      writeFileSync(join(rexDir, "prd_feature-x_2026-04-01.md"), prdMd("Feature", []));
      writeFileSync(join(rexDir, "prd_develop_2026-02-15.md"), prdMd("Dev", []));

      const files = discoverMarkdownPRDFiles(rexDir);
      expect(files).toEqual([
        "prd_develop_2026-02-15.md",
        "prd_feature-x_2026-04-01.md",
        "prd_main_2026-01-01.md",
      ]);
    });

    it("ignores lock files and json files", () => {
      writeFileSync(join(rexDir, "prd_main_2026-01-01.md"), prdMd("Main", []));
      writeFileSync(join(rexDir, "prd_main_2026-01-01.md.lock"), "");
      writeFileSync(join(rexDir, "prd_main_2026-01-01.json"), "{}");

      expect(discoverMarkdownPRDFiles(rexDir)).toEqual(["prd_main_2026-01-01.md"]);
    });
  });

  // ── loadPRDSync ───────────────────────────────────────────────────────

  describe("loadPRDSync", () => {
    it("returns null when no PRD files exist", () => {
      expect(loadPRDSync(rexDir)).toBeNull();
    });

    it("returns null when directory does not exist", () => {
      expect(loadPRDSync(join(rexDir, "nonexistent"))).toBeNull();
    });

    it("reads from .cache/prd.json when present", () => {
      const cacheDir = join(rexDir, PRD_CACHE_DIR);
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(
        join(cacheDir, PRD_CACHE_JSON),
        JSON.stringify(makeDoc("Cached", [makeEpic("e1", "Cached Epic")])),
      );

      const doc = loadPRDSync(rexDir);
      expect(doc).not.toBeNull();
      expect(doc!.title).toBe("Cached");
      expect(doc!.items).toHaveLength(1);
    });

    it("falls back to parsing prd.md when cache is absent", () => {
      writeFileSync(join(rexDir, "prd.md"), prdMd("Markdown", [{ id: "e1", title: "MD Epic" }]));

      const doc = loadPRDSync(rexDir);
      expect(doc).not.toBeNull();
      expect(doc!.title).toBe("Markdown");
      expect(doc!.items).toHaveLength(1);
    });

    it("prefers cache over prd.md when both exist", () => {
      const cacheDir = join(rexDir, PRD_CACHE_DIR);
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(
        join(cacheDir, PRD_CACHE_JSON),
        JSON.stringify(makeDoc("From Cache", [makeEpic("e1", "Cache Hit")])),
      );
      writeFileSync(join(rexDir, "prd.md"), prdMd("From Markdown", []));

      const doc = loadPRDSync(rexDir);
      expect(doc!.title).toBe("From Cache");
    });

    it("falls back to prd.md when cache is corrupt JSON", () => {
      const cacheDir = join(rexDir, PRD_CACHE_DIR);
      mkdirSync(cacheDir, { recursive: true });
      writeFileSync(join(cacheDir, PRD_CACHE_JSON), "{broken json");
      writeFileSync(join(rexDir, "prd.md"), prdMd("Fallback", [{ id: "e1", title: "Fallback Epic" }]));

      const doc = loadPRDSync(rexDir);
      expect(doc!.title).toBe("Fallback");
    });
  });

  // ── savePRDSync ───────────────────────────────────────────────────────

  describe("savePRDSync", () => {
    it("writes prd.md as Markdown", () => {
      savePRDSync(rexDir, makeDoc("Saved", [makeEpic("e1", "Saved Epic")]));

      expect(existsSync(join(rexDir, "prd.md"))).toBe(true);
      const content = readFileSync(join(rexDir, "prd.md"), "utf-8");
      expect(content).toContain("Saved");
    });

    it("also refreshes the cache file", () => {
      savePRDSync(rexDir, makeDoc("Cached Write", []));

      expect(existsSync(join(rexDir, PRD_CACHE_DIR, PRD_CACHE_JSON))).toBe(true);
    });

    it("round-trips through loadPRDSync", () => {
      const doc = makeDoc("Round Trip", [makeEpic("e1", "Persisted")]);
      savePRDSync(rexDir, doc);

      const loaded = loadPRDSync(rexDir);
      expect(loaded!.title).toBe("Round Trip");
      expect(loaded!.items).toHaveLength(1);
    });
  });

  // ── prdMaxMtimeMs ─────────────────────────────────────────────────────

  describe("prdMaxMtimeMs", () => {
    it("returns 0 when no PRD files exist", () => {
      expect(prdMaxMtimeMs(rexDir)).toBe(0);
    });

    it("returns mtime of prd.md", () => {
      writeFileSync(join(rexDir, "prd.md"), prdMd("Test", []));
      expect(prdMaxMtimeMs(rexDir)).toBeGreaterThan(0);
    });

    it("returns max mtime across prd.md and branch companion files", () => {
      writeFileSync(join(rexDir, "prd.md"), prdMd("Primary", []));
      writeFileSync(join(rexDir, "prd_branch_2026-04-01.md"), prdMd("Branch", []));

      const mtime = prdMaxMtimeMs(rexDir);
      expect(mtime).toBeGreaterThan(0);
      const primaryMtime = statSync(join(rexDir, "prd.md")).mtimeMs;
      const branchMtime = statSync(join(rexDir, "prd_branch_2026-04-01.md")).mtimeMs;
      expect(mtime).toBe(Math.max(primaryMtime, branchMtime));
    });
  });
});
