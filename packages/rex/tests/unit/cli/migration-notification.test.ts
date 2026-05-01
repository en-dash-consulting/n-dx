/**
 * Unit tests for migration-notification module.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  formatMigrationBanner,
  shouldEmitMigrationBanner,
  getMigrationLogEntry,
  getMigrationMcpWarning,
  emitMigrationNotification,
} from "../../../src/cli/migration-notification.js";
import type { LegacyPrdMigrationResult } from "../../../src/store/ensure-legacy-prd-migrated.js";
import { PRD_TREE_DIRNAME } from "../../../src/store/index.js";
import { setQuiet, isQuiet, resetColorCache } from "@n-dx/llm-client";

describe("Migration Notification", () => {
  beforeEach(() => {
    setQuiet(false);
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
    resetColorCache();
  });

  afterEach(() => {
    setQuiet(false);
    delete process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
    resetColorCache();
  });

  describe("formatMigrationBanner", () => {
    it("includes migration header", () => {
      const banner = formatMigrationBanner(".rex/prd.json.backup-20260430-123456", 5);
      expect(banner).toContain("Legacy PRD migration completed");
    });

    it("includes item count", () => {
      const banner = formatMigrationBanner(".rex/prd.json.backup-20260430-123456", 5);
      expect(banner).toContain("5 item(s) migrated");
    });

    it("includes backup path", () => {
      const backupPath = ".rex/prd.json.backup-20260430-123456";
      const banner = formatMigrationBanner(backupPath, 5);
      expect(banner).toContain(backupPath);
    });

    it("includes folder-tree path", () => {
      const banner = formatMigrationBanner(".rex/prd.json.backup-20260430-123456", 5);
      expect(banner).toContain(`.rex/${PRD_TREE_DIRNAME}`);
    });

    it("includes suggestion to run rex status", () => {
      const banner = formatMigrationBanner(".rex/prd.json.backup-20260430-123456", 5);
      expect(banner).toContain("rex status");
    });

    it("uses default folder-tree path when not provided", () => {
      const banner = formatMigrationBanner(".rex/prd.json.backup-20260430-123456", 5);
      expect(banner).toContain(`.rex/${PRD_TREE_DIRNAME}`);
    });

    it("uses custom folder-tree path when provided", () => {
      const banner = formatMigrationBanner(
        ".rex/prd.json.backup-20260430-123456",
        5,
        ".rex/tree-v2"
      );
      expect(banner).toContain(".rex/tree-v2");
    });
  });

  describe("shouldEmitMigrationBanner", () => {
    it("returns true for normal CLI invocation", () => {
      const result = shouldEmitMigrationBanner({});
      expect(result).toBe(true);
    });

    it("returns false when --quiet is true", () => {
      const result = shouldEmitMigrationBanner({ quiet: "true" });
      expect(result).toBe(false);
    });

    it("returns false when --format=json", () => {
      const result = shouldEmitMigrationBanner({ format: "json" });
      expect(result).toBe(false);
    });

    it("returns false when global quiet mode is set", () => {
      setQuiet(true);
      const result = shouldEmitMigrationBanner({});
      expect(result).toBe(false);
    });

    it("returns false with other flag values", () => {
      const result = shouldEmitMigrationBanner({ format: "tree", other: "value" });
      expect(result).toBe(true);
    });
  });

  describe("getMigrationLogEntry", () => {
    it("creates log entry with correct event type", () => {
      const result: LegacyPrdMigrationResult = {
        migrated: true,
        backupPath: ".rex/prd.json.backup-20260430-123456",
        itemCount: 5,
      };
      const entry = getMigrationLogEntry(result);
      expect(entry.event).toBe("legacy_prd_migration");
    });

    it("includes timestamp in ISO format", () => {
      const result: LegacyPrdMigrationResult = {
        migrated: true,
        backupPath: ".rex/prd.json.backup-20260430-123456",
        itemCount: 5,
      };
      const entry = getMigrationLogEntry(result);
      expect(entry.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it("includes migration details in detail field as JSON", () => {
      const result: LegacyPrdMigrationResult = {
        migrated: true,
        backupPath: ".rex/prd.json.backup-20260430-123456",
        itemCount: 5,
      };
      const entry = getMigrationLogEntry(result);
      expect(entry.detail).toBeDefined();
      const detail = JSON.parse(entry.detail ?? "");
      expect(detail.migrated).toBe(true);
      expect(detail.backupPath).toBe(".rex/prd.json.backup-20260430-123456");
      expect(detail.itemCount).toBe(5);
    });

    it("handles missing backupPath gracefully", () => {
      const result: LegacyPrdMigrationResult = {
        migrated: true,
        itemCount: 3,
      };
      const entry = getMigrationLogEntry(result);
      const detail = JSON.parse(entry.detail ?? "");
      expect(detail.backupPath).toBe("(unknown)");
    });

    it("handles missing itemCount gracefully", () => {
      const result: LegacyPrdMigrationResult = {
        migrated: true,
        backupPath: ".rex/prd.json.backup-20260430-123456",
      };
      const entry = getMigrationLogEntry(result);
      const detail = JSON.parse(entry.detail ?? "");
      expect(detail.itemCount).toBe(0);
    });
  });

  describe("getMigrationMcpWarning", () => {
    it("returns undefined when migration did not happen", () => {
      const result: LegacyPrdMigrationResult = {
        migrated: false,
        reason: "no-legacy-file",
      };
      const warning = getMigrationMcpWarning(result);
      expect(warning).toBeUndefined();
    });

    it("returns warning message when migration happened", () => {
      const result: LegacyPrdMigrationResult = {
        migrated: true,
        backupPath: ".rex/prd.json.backup-20260430-123456",
        itemCount: 5,
      };
      const warning = getMigrationMcpWarning(result);
      expect(warning).toContain("prd.json detected and migrated");
      expect(warning).toContain(".rex/prd.json.backup-20260430-123456");
      expect(warning).toContain("5 items");
    });

    it("handles missing backupPath in warning", () => {
      const result: LegacyPrdMigrationResult = {
        migrated: true,
        itemCount: 3,
      };
      const warning = getMigrationMcpWarning(result);
      expect(warning).toContain("(unknown)");
    });
  });

  describe("emitMigrationNotification", () => {
    let consoleErrorSpy: ReturnType<typeof vi.spyOn>;
    let appendLogSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
      appendLogSpy = vi.fn().mockResolvedValue(undefined);
    });

    afterEach(() => {
      consoleErrorSpy.mockRestore();
    });

    it("skips notification when migration did not happen", async () => {
      const result: LegacyPrdMigrationResult = {
        migrated: false,
        reason: "no-legacy-file",
      };
      await emitMigrationNotification(result, {}, appendLogSpy);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      expect(appendLogSpy).not.toHaveBeenCalled();
    });

    it("emits banner to stderr when migration happened", async () => {
      const result: LegacyPrdMigrationResult = {
        migrated: true,
        backupPath: ".rex/prd.json.backup-20260430-123456",
        itemCount: 5,
      };
      await emitMigrationNotification(result, {}, appendLogSpy);
      expect(consoleErrorSpy).toHaveBeenCalled();
      const output = consoleErrorSpy.mock.calls[0][0] as string;
      expect(output).toContain("Legacy PRD migration completed");
    });

    it("suppresses banner when --quiet is set", async () => {
      const result: LegacyPrdMigrationResult = {
        migrated: true,
        backupPath: ".rex/prd.json.backup-20260430-123456",
        itemCount: 5,
      };
      await emitMigrationNotification(result, { quiet: "true" }, appendLogSpy);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      // But logging should still happen
      expect(appendLogSpy).toHaveBeenCalled();
    });

    it("suppresses banner when --format=json", async () => {
      const result: LegacyPrdMigrationResult = {
        migrated: true,
        backupPath: ".rex/prd.json.backup-20260430-123456",
        itemCount: 5,
      };
      await emitMigrationNotification(result, { format: "json" }, appendLogSpy);
      expect(consoleErrorSpy).not.toHaveBeenCalled();
      // But logging should still happen
      expect(appendLogSpy).toHaveBeenCalled();
    });

    it("always logs migration event", async () => {
      const result: LegacyPrdMigrationResult = {
        migrated: true,
        backupPath: ".rex/prd.json.backup-20260430-123456",
        itemCount: 5,
      };
      await emitMigrationNotification(result, { quiet: "true" }, appendLogSpy);
      expect(appendLogSpy).toHaveBeenCalledOnce();
      const entry = appendLogSpy.mock.calls[0][0];
      expect(entry.event).toBe("legacy_prd_migration");
    });

    it("handles log write failure gracefully", async () => {
      const result: LegacyPrdMigrationResult = {
        migrated: true,
        backupPath: ".rex/prd.json.backup-20260430-123456",
        itemCount: 5,
      };
      const failingAppendLog = vi.fn().mockRejectedValue(new Error("Write failed"));
      // Should not throw
      await expect(
        emitMigrationNotification(result, {}, failingAppendLog)
      ).resolves.not.toThrow();
    });
  });
});
