/**
 * Tests for multi-file PRD aggregation in prd-io.ts.
 *
 * Verifies that the web server's sync PRD loading correctly discovers
 * and aggregates items from branch-scoped `prd_{branch}_{date}.json`
 * files alongside the legacy `prd.json`.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadPRDSync,
  prdExists,
  discoverPRDFilesSync,
  prdMaxMtimeMs,
} from "../../../src/server/prd-io.js";

const SCHEMA = "rex/v1";

function makeDoc(title: string, items: unknown[]) {
  return JSON.stringify({ schema: SCHEMA, title, items }, null, 2);
}

function makeEpic(id: string, title: string, children?: unknown[]) {
  return { id, title, status: "pending", level: "epic", ...(children ? { children } : {}) };
}

function makeTask(id: string, title: string) {
  return { id, title, status: "pending", level: "task" };
}

describe("prd-io multi-file", () => {
  let rexDir: string;

  beforeEach(() => {
    const tmp = mkdtempSync(join(tmpdir(), "web-prdio-"));
    rexDir = join(tmp, ".rex");
    mkdirSync(rexDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(rexDir, { recursive: true, force: true });
  });

  // ── discoverPRDFilesSync ──────────────────────────────────────────────

  describe("discoverPRDFilesSync", () => {
    it("returns empty when no branch files exist", () => {
      writeFileSync(join(rexDir, "prd.json"), makeDoc("Legacy", []));
      expect(discoverPRDFilesSync(rexDir)).toEqual([]);
    });

    it("discovers branch-scoped files sorted lexicographically", () => {
      writeFileSync(join(rexDir, "prd_main_2026-01-01.json"), makeDoc("Main", []));
      writeFileSync(join(rexDir, "prd_feature-x_2026-04-01.json"), makeDoc("Feature", []));
      writeFileSync(join(rexDir, "prd_develop_2026-02-15.json"), makeDoc("Dev", []));

      const files = discoverPRDFilesSync(rexDir);
      expect(files).toEqual([
        "prd_develop_2026-02-15.json",
        "prd_feature-x_2026-04-01.json",
        "prd_main_2026-01-01.json",
      ]);
    });

    it("ignores lock files and temp files", () => {
      writeFileSync(join(rexDir, "prd_main_2026-01-01.json"), makeDoc("Main", []));
      writeFileSync(join(rexDir, "prd_main_2026-01-01.json.lock"), "");
      writeFileSync(join(rexDir, "prd.json"), makeDoc("Legacy", []));

      const files = discoverPRDFilesSync(rexDir);
      expect(files).toEqual(["prd_main_2026-01-01.json"]);
    });
  });

  // ── prdExists ─────────────────────────────────────────────────────────

  describe("prdExists", () => {
    it("returns true for legacy prd.json", () => {
      writeFileSync(join(rexDir, "prd.json"), makeDoc("Legacy", []));
      expect(prdExists(rexDir)).toBe(true);
    });

    it("returns true for branch-scoped files (no legacy prd.json)", () => {
      writeFileSync(join(rexDir, "prd_main_2026-01-01.json"), makeDoc("Main", []));
      expect(prdExists(rexDir)).toBe(true);
    });

    it("returns false when no PRD files exist", () => {
      expect(prdExists(rexDir)).toBe(false);
    });
  });

  // ── loadPRDSync ───────────────────────────────────────────────────────

  describe("loadPRDSync", () => {
    it("loads legacy prd.json when no branch files exist", () => {
      writeFileSync(
        join(rexDir, "prd.json"),
        makeDoc("Legacy", [makeEpic("e1", "Epic One")]),
      );

      const doc = loadPRDSync(rexDir);
      expect(doc).not.toBeNull();
      expect(doc!.title).toBe("Legacy");
      expect(doc!.items).toHaveLength(1);
    });

    it("loads single branch file when no legacy prd.json exists", () => {
      writeFileSync(
        join(rexDir, "prd_main_2026-01-01.json"),
        makeDoc("Main", [makeEpic("e1", "Epic One")]),
      );

      const doc = loadPRDSync(rexDir);
      expect(doc).not.toBeNull();
      expect(doc!.title).toBe("Main");
      expect(doc!.items).toHaveLength(1);
    });

    it("aggregates items from two branch files", () => {
      writeFileSync(
        join(rexDir, "prd_main_2026-01-01.json"),
        makeDoc("Main", [makeEpic("e-auth", "Auth")]),
      );
      writeFileSync(
        join(rexDir, "prd_feature-x_2026-04-01.json"),
        makeDoc("Feature", [makeEpic("e-search", "Search")]),
      );

      const doc = loadPRDSync(rexDir);
      expect(doc).not.toBeNull();
      expect(doc!.items).toHaveLength(2);

      const ids = doc!.items.map((i: { id: string }) => i.id);
      expect(ids).toContain("e-auth");
      expect(ids).toContain("e-search");
    });

    it("aggregates legacy prd.json with branch files", () => {
      writeFileSync(
        join(rexDir, "prd.json"),
        makeDoc("Legacy", [makeEpic("e-legacy", "Legacy")]),
      );
      writeFileSync(
        join(rexDir, "prd_main_2026-01-01.json"),
        makeDoc("Main", [makeEpic("e-main", "Main")]),
      );

      const doc = loadPRDSync(rexDir);
      expect(doc).not.toBeNull();
      expect(doc!.items).toHaveLength(2);
      // Primary metadata from prd.json (first source)
      expect(doc!.title).toBe("Legacy");
    });

    it("preserves nested tree structure in aggregation", () => {
      writeFileSync(
        join(rexDir, "prd_main_2026-01-01.json"),
        makeDoc("Main", [
          makeEpic("e1", "Auth", [
            { id: "f1", title: "OAuth", status: "pending", level: "feature", children: [
              makeTask("t1", "Token exchange"),
            ] },
          ]),
        ]),
      );
      writeFileSync(
        join(rexDir, "prd_branch_2026-04-01.json"),
        makeDoc("Branch", [
          makeEpic("e2", "Search", [
            { id: "f2", title: "Index", status: "pending", level: "feature", children: [
              makeTask("t2", "Build index"),
            ] },
          ]),
        ]),
      );

      const doc = loadPRDSync(rexDir);
      expect(doc).not.toBeNull();
      expect(doc!.items).toHaveLength(2);

      const e1 = doc!.items.find((i: { id: string }) => i.id === "e1") as Record<string, unknown>;
      expect((e1.children as unknown[])).toHaveLength(1);

      const e2 = doc!.items.find((i: { id: string }) => i.id === "e2") as Record<string, unknown>;
      expect((e2.children as unknown[])).toHaveLength(1);
    });

    it("returns null when no PRD files exist", () => {
      expect(loadPRDSync(rexDir)).toBeNull();
    });

    it("returns null when directory does not exist", () => {
      expect(loadPRDSync(join(rexDir, "nonexistent"))).toBeNull();
    });
  });

  // ── prdMaxMtimeMs ─────────────────────────────────────────────────────

  describe("prdMaxMtimeMs", () => {
    it("returns 0 when no PRD files exist", () => {
      expect(prdMaxMtimeMs(rexDir)).toBe(0);
    });

    it("returns mtime of legacy prd.json", () => {
      writeFileSync(join(rexDir, "prd.json"), makeDoc("Legacy", []));
      expect(prdMaxMtimeMs(rexDir)).toBeGreaterThan(0);
    });

    it("returns max mtime across branch files", () => {
      writeFileSync(join(rexDir, "prd_main_2026-01-01.json"), makeDoc("Main", []));
      writeFileSync(join(rexDir, "prd_branch_2026-04-01.json"), makeDoc("Branch", []));

      const mtime = prdMaxMtimeMs(rexDir);
      expect(mtime).toBeGreaterThan(0);
    });
  });
});
