/**
 * E2E test: Verify that legacy .rex/prd.json migration triggers from all PRD-touching entry points.
 *
 * This test starts from a fixture containing only .rex/prd.json (legacy format) and verifies
 * that running representative commands (CLI, MCP) triggers the migration and leaves the project
 * in the folder-tree state with a backup file and migrated marker.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { copyFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

// Import CLI commands
import { cmdStatus } from "../../src/cli/commands/status.js";
import { cmdNext } from "../../src/cli/commands/next.js";
import { cmdAdd } from "../../src/cli/commands/add.js";
import { cmdValidate } from "../../src/cli/commands/validate.js";
import { cmdUpdate } from "../../src/cli/commands/update.js";

// Import MCP tools
import { handleGetPrdStatus, handleAddItem } from "../../src/cli/mcp-tools.js";
import { createRexMcpServer } from "../../src/cli/mcp.js";

// Import store functions
import { resolveStore } from "../../src/store/index.js";
import { PRD_TREE_DIRNAME } from "../../src/store/index.js";

const FIXTURE_DIR = resolve("packages/rex/tests/fixtures/legacy-multifile-prd");

function setupTestProject(): string {
  const testDir = join(tmpdir(), `ndx-migration-e2e-${randomUUID()}`);
  mkdirSync(testDir, { recursive: true });

  // Copy legacy prd.json fixture to the test project
  const rexDir = join(testDir, ".rex");
  mkdirSync(rexDir, { recursive: true });

  // Create a simple legacy prd.json if fixture doesn't exist
  const legacyPrdPath = join(rexDir, "prd.json");
  const samplePrd = {
    schema: "rex/v1",
    title: "Test PRD",
    items: [
      {
        id: "epic-1",
        level: "epic",
        title: "First Epic",
        status: "pending",
        priority: "high",
        children: [
          {
            id: "feature-1",
            level: "feature",
            title: "Feature 1",
            status: "pending",
            priority: "medium",
            children: [
              {
                id: "task-1",
                level: "task",
                title: "Task 1",
                status: "pending",
                priority: "low",
              },
            ],
          },
        ],
      },
    ],
  };

  writeFileSync(legacyPrdPath, JSON.stringify(samplePrd, null, 2));

  // Create config.json (required by rex commands)
  const configPath = join(rexDir, "config.json");
  const config = {
    schema: "rex/v1",
    project: "legacy-migration-test",
    adapter: "file",
    model: "claude-opus",
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2));

  return testDir;
}

function cleanupTestProject(testDir: string): void {
  try {
    rmSync(testDir, { recursive: true, force: true });
  } catch {
    // Best effort cleanup
  }
}

function verifyMigrationState(testDir: string): {
  treeExists: boolean;
  backupExists: boolean;
  migratedMarkerExists: boolean;
  itemCount: number;
} {
  const rexDir = join(testDir, ".rex");
  const treeDir = join(rexDir, PRD_TREE_DIRNAME);
  const treeExists = existsSync(treeDir);

  // Check for backup file (format: prd.json.backup-YYYYMMDD-HHMMSS)
  const files = require("node:fs").readdirSync(rexDir);
  const backupExists = files.some((f: string) => f.startsWith("prd.json.backup-"));

  // Check for migrated marker
  const migratedMarkerExists = existsSync(join(rexDir, "prd.json.migrated"));

  // Count items in tree
  let itemCount = 0;
  if (treeExists) {
    const treeFiles = require("node:fs").readdirSync(treeDir);
    // Count directories (each directory is an item)
    for (const file of treeFiles) {
      const fullPath = join(treeDir, file);
      const stat = require("node:fs").statSync(fullPath);
      if (stat.isDirectory()) {
        itemCount++;
      }
    }
  }

  return { treeExists, backupExists, migratedMarkerExists, itemCount };
}

describe("Legacy PRD migration entry point wiring", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = setupTestProject();
  });

  afterEach(() => {
    cleanupTestProject(testDir);
  });

  it("triggers migration when running rex status", async () => {
    // Suppress output
    const originalLog = console.log;
    const originalError = console.error;
    console.log = () => {};
    console.error = () => {};

    try {
      await cmdStatus(testDir, { format: "json" });

      const state = verifyMigrationState(testDir);
      expect(state.treeExists).toBe(true);
      expect(state.backupExists).toBe(true);
      expect(state.migratedMarkerExists).toBe(true);
      expect(state.itemCount).toBeGreaterThan(0);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  });

  it("triggers migration when running rex next", async () => {
    const originalLog = console.log;
    console.log = () => {};

    try {
      await cmdNext(testDir, {});

      const state = verifyMigrationState(testDir);
      expect(state.treeExists).toBe(true);
      expect(state.backupExists).toBe(true);
      expect(state.migratedMarkerExists).toBe(true);
    } finally {
      console.log = originalLog;
    }
  });

  it("triggers migration when running rex add", async () => {
    const originalLog = console.log;
    console.log = () => {};

    try {
      // Note: cmdAdd requires --title flag
      try {
        await cmdAdd(testDir, "epic", { title: "New Epic" });
      } catch {
        // May fail due to other validation, but migration should have happened
      }

      const state = verifyMigrationState(testDir);
      expect(state.treeExists).toBe(true);
      expect(state.backupExists).toBe(true);
      expect(state.migratedMarkerExists).toBe(true);
    } finally {
      console.log = originalLog;
    }
  });

  it("triggers migration when running rex validate", async () => {
    const originalLog = console.log;
    console.log = () => {};

    try {
      await cmdValidate(testDir, {});

      const state = verifyMigrationState(testDir);
      expect(state.treeExists).toBe(true);
      expect(state.backupExists).toBe(true);
      expect(state.migratedMarkerExists).toBe(true);
    } finally {
      console.log = originalLog;
    }
  });

  it("triggers migration when creating MCP server", async () => {
    const originalLog = console.log;
    const originalError = console.error;
    console.log = () => {};
    console.error = () => {};

    try {
      await createRexMcpServer(testDir);

      const state = verifyMigrationState(testDir);
      expect(state.treeExists).toBe(true);
      expect(state.backupExists).toBe(true);
      expect(state.migratedMarkerExists).toBe(true);
    } finally {
      console.log = originalLog;
      console.error = originalError;
    }
  });

  it("is idempotent - running migration twice does not duplicate items", async () => {
    const originalLog = console.log;
    console.log = () => {};

    try {
      // First migration via status
      await cmdStatus(testDir, { format: "json" });
      const state1 = verifyMigrationState(testDir);
      const itemCount1 = state1.itemCount;

      // Second migration via next should be skipped (returns "already-migrated")
      await cmdNext(testDir, {});
      const state2 = verifyMigrationState(testDir);

      // Item count should not change
      expect(state2.itemCount).toBe(itemCount1);

      // Backup should still exist
      expect(state2.backupExists).toBe(true);
      expect(state2.migratedMarkerExists).toBe(true);
    } finally {
      console.log = originalLog;
    }
  });

  it("leaves prd.json.json.migrated marker after successful migration", async () => {
    const originalLog = console.log;
    console.log = () => {};

    try {
      await cmdStatus(testDir, { format: "json" });

      const rexDir = join(testDir, ".rex");
      const migratedMarkerPath = join(rexDir, "prd.json.migrated");

      // Marker should exist
      expect(existsSync(migratedMarkerPath)).toBe(true);

      // Original prd.json should NOT exist (renamed to marker)
      const originalPath = join(rexDir, "prd.json");
      expect(existsSync(originalPath)).toBe(false);
    } finally {
      console.log = originalLog;
    }
  });

  it("creates timestamped backup file", async () => {
    const originalError = console.error;
    console.error = () => {};

    try {
      await cmdStatus(testDir, { format: "json" });

      const rexDir = join(testDir, ".rex");
      const files = require("node:fs").readdirSync(rexDir);
      const backupFile = files.find((f: string) => f.startsWith("prd.json.backup-"));

      expect(backupFile).toBeDefined();

      if (backupFile) {
        // Verify backup file is valid JSON and contains the PRD
        const backupPath = join(rexDir, backupFile);
        const backupContent = JSON.parse(readFileSync(backupPath, "utf-8"));
        expect(backupContent.title).toBe("Test PRD");
        expect(backupContent.items).toBeDefined();
      }
    } finally {
      console.error = originalError;
    }
  });
});
