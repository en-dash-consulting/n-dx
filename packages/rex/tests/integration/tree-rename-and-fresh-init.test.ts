/**
 * Integration tests: `.rex/tree` → `.rex/prd_tree` auto-rename and fresh-init path.
 *
 * Verifies two scenarios end-to-end:
 * 1. A project with a legacy `.rex/tree/` directory is transparently renamed to
 *    `.rex/prd_tree/` on the first PRD-touching CLI command.
 * 2. `rex init` creates `.rex/prd_tree/` directly — no legacy rename step involved.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  existsSync,
  mkdtempSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cmdStatus } from "../../src/cli/commands/status.js";
import { cmdInit } from "../../src/cli/commands/init.js";
import { PRD_TREE_DIRNAME } from "../../src/store/index.js";
import { toCanonicalJSON } from "../../src/core/canonical.js";

// ── helpers ───────────────────────────────────────────────────────────────────

function writeConfig(rexDir: string): void {
  writeFileSync(
    join(rexDir, "config.json"),
    toCanonicalJSON({ schema: "rex/v1", project: "test", adapter: "file" }),
  );
}

/** Write a minimal valid `index.md` for a single epic item inside a tree dir. */
function writeEpicItem(treeDir: string, slug: string, id: string): void {
  const epicDir = join(treeDir, slug);
  mkdirSync(epicDir, { recursive: true });
  writeFileSync(
    join(epicDir, "index.md"),
    [
      "---",
      `id: "${id}"`,
      `level: "epic"`,
      `title: "Test Epic"`,
      `status: "pending"`,
      "---",
      "",
      "# Test Epic",
    ].join("\n"),
  );
}

// ── scenarios ─────────────────────────────────────────────────────────────────

describe("tree rename and fresh-init integration", () => {
  let tmp: string;
  let rexDir: string;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "rex-tree-rename-integ-"));
    rexDir = join(tmp, ".rex");
    mkdirSync(rexDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  // ── Rename path ─────────────────────────────────────────────────────────────

  it("cmdStatus auto-renames .rex/tree to .rex/prd_tree and preserves item content", async () => {
    writeConfig(rexDir);

    // Place content in the legacy directory name (.rex/tree/).
    const legacyTree = join(rexDir, "tree");
    const epicSlug = "sample-epic-ab123456";
    const epicId = "ab123456-0000-0000-0000-000000000001";
    writeEpicItem(legacyTree, epicSlug, epicId);

    // Silence output.
    const restore = silenceConsole();
    try {
      await cmdStatus(tmp, { format: "json" });
    } finally {
      restore();
    }

    // Legacy directory must be gone.
    expect(existsSync(legacyTree)).toBe(false);

    // Canonical directory must exist.
    const canonical = join(rexDir, PRD_TREE_DIRNAME);
    expect(existsSync(canonical)).toBe(true);

    // Item content must be intact under the canonical path.
    const indexPath = join(canonical, epicSlug, "index.md");
    expect(existsSync(indexPath)).toBe(true);
    const content = require("node:fs").readFileSync(indexPath, "utf-8");
    expect(content).toContain("Test Epic");
    expect(content).toContain(epicId);
  });

  it("rename is skipped when canonical directory already exists", async () => {
    writeConfig(rexDir);

    // Populate BOTH legacy and canonical directories.
    const legacyTree = join(rexDir, "tree");
    mkdirSync(legacyTree, { recursive: true });
    writeFileSync(join(legacyTree, "stray.md"), "stray content");

    const canonical = join(rexDir, PRD_TREE_DIRNAME);
    const epicSlug = "real-epic-cd456789";
    const epicId = "cd456789-0000-0000-0000-000000000002";
    writeEpicItem(canonical, epicSlug, epicId);

    const restore = silenceConsole();
    try {
      await cmdStatus(tmp, { format: "json" });
    } finally {
      restore();
    }

    // Both directories survive: no merge, no overwrite.
    expect(existsSync(join(legacyTree, "stray.md"))).toBe(true);
    expect(existsSync(join(canonical, epicSlug, "index.md"))).toBe(true);
  });

  // ── Fresh-init path ─────────────────────────────────────────────────────────

  it("cmdInit creates .rex/prd_tree directly on a fresh project", async () => {
    const restore = silenceConsole();
    try {
      await cmdInit(tmp, {});
    } finally {
      restore();
    }

    // The canonical folder-tree directory must be created.
    const canonical = join(rexDir, PRD_TREE_DIRNAME);
    expect(existsSync(canonical)).toBe(true);

    // No legacy .rex/tree/ should exist.
    expect(existsSync(join(rexDir, "tree"))).toBe(false);
  });

  it("PRD_TREE_DIRNAME constant equals 'prd_tree' (sentinel guards against accidental regression)", () => {
    expect(PRD_TREE_DIRNAME).toBe("prd_tree");
  });
});

// ── utility ───────────────────────────────────────────────────────────────────

function silenceConsole(): () => void {
  const origLog = console.log;
  const origErr = console.error;
  const origWarn = console.warn;
  console.log = () => {};
  console.error = () => {};
  console.warn = () => {};
  return () => {
    console.log = origLog;
    console.error = origErr;
    console.warn = origWarn;
  };
}
