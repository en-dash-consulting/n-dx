import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { cmdFix } from "../../../../src/cli/commands/fix.js";
import { readPRD, writeConfig, writePRD } from "../../../helpers/rex-dir-test-support.js";

const VALID_CONFIG = {
  schema: "rex/v1",
  project: "test-fix",
  adapter: "file",
};

describe("cmdFix", () => {
  let tmpDir: string;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "rex-fix-test-"));
    mkdirSync(join(tmpDir, ".rex"), { recursive: true });
    writeFileSync(join(tmpDir, ".rex", "execution-log.jsonl"), "");
    stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    stdoutSpy.mockRestore();
  });

  // ── No issues ──────────────────────────────────────────────────────────────

  describe("clean PRD", () => {
    it("reports no issues (text mode)", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "e1",
            title: "Epic",
            level: "epic",
            status: "pending",
            children: [
              {
                id: "t1",
                title: "Task",
                level: "task",
                status: "completed",
                startedAt: "2026-01-01T00:00:00.000Z",
                completedAt: "2026-01-02T00:00:00.000Z",
              },
            ],
          },
        ],
      });

      await cmdFix(tmpDir, {});
      const output = stdoutSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("No issues found.");
    });

    it("reports no issues (JSON mode)", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "t1",
            title: "Task",
            level: "task",
            status: "pending",
          },
        ],
      });

      await cmdFix(tmpDir, { format: "json" });
      const jsonCall = stdoutSpy.mock.calls.find((c) => {
        try { JSON.parse(c[0]); return true; } catch { return false; }
      });
      expect(jsonCall).toBeDefined();
      const report = JSON.parse(jsonCall![0]);
      expect(report.actions).toHaveLength(0);
      expect(report.summary.total).toBe(0);
    });
  });

  // ── Timestamp fixes ────────────────────────────────────────────────────────

  describe("timestamp fixes", () => {
    it("adds completedAt to completed items", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "t1",
            title: "Done Task",
            level: "task",
            status: "completed",
            startedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      });

      await cmdFix(tmpDir, {});
      const doc = readPRD(tmpDir);
      expect(doc.items[0].completedAt).toBeDefined();
    });

    it("adds startedAt to in_progress items", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "t1",
            title: "Active Task",
            level: "task",
            status: "in_progress",
          },
        ],
      });

      await cmdFix(tmpDir, {});
      const doc = readPRD(tmpDir);
      expect(doc.items[0].startedAt).toBeDefined();
    });

    it("clears stale completedAt from non-completed items", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "t1",
            title: "Task",
            level: "task",
            status: "pending",
            completedAt: "2026-01-01T00:00:00.000Z",
          },
        ],
      });

      await cmdFix(tmpDir, {});
      const doc = readPRD(tmpDir);
      expect(doc.items[0].completedAt).toBeUndefined();
    });
  });

  // ── Orphan blockedBy fixes ─────────────────────────────────────────────────

  describe("orphan blockedBy fixes", () => {
    it("removes references to non-existent IDs", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "t1",
            title: "Task",
            level: "task",
            status: "pending",
          },
          {
            id: "t2",
            title: "Blocked Task",
            level: "task",
            status: "blocked",
            blockedBy: ["t1", "nonexistent-id"],
          },
        ],
      });

      await cmdFix(tmpDir, {});
      const doc = readPRD(tmpDir);
      const t2 = doc.items.find(i => i.id === "t2");
      expect(t2?.blockedBy).toEqual(["t1"]);
    });

    it("removes blockedBy array entirely when all refs are orphaned", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "t1",
            title: "Task",
            level: "task",
            status: "blocked",
            blockedBy: ["gone1", "gone2"],
          },
        ],
      });

      await cmdFix(tmpDir, {});
      const doc = readPRD(tmpDir);
      expect(doc.items[0].blockedBy).toBeUndefined();
    });
  });

  // ── Parent-child alignment ─────────────────────────────────────────────────

  describe("parent-child alignment", () => {
    it("resets completed parent with non-terminal children", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "e1",
            title: "Epic",
            level: "epic",
            status: "completed",
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-10T00:00:00.000Z",
            children: [
              {
                id: "t1",
                title: "Still Pending",
                level: "task",
                status: "pending",
              },
            ],
          },
        ],
      });

      await cmdFix(tmpDir, {});
      const doc = readPRD(tmpDir);
      expect(doc.items[0].status).toBe("in_progress");
      expect(doc.items[0].completedAt).toBeUndefined();
    });
  });

  // ── Dry-run mode ───────────────────────────────────────────────────────────

  describe("dry-run mode", () => {
    it("previews fixes without mutating (text mode)", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "t1",
            title: "Completed no ts",
            level: "task",
            status: "completed",
          },
        ],
      });

      await cmdFix(tmpDir, { "dry-run": "true" });

      const output = stdoutSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("Would fix:");

      // PRD should not be modified
      const doc = readPRD(tmpDir);
      expect(doc.items[0].completedAt).toBeUndefined();
    });

    it("returns structured JSON in dry-run mode", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "t1",
            title: "Completed no ts",
            level: "task",
            status: "completed",
          },
        ],
      });

      await cmdFix(tmpDir, { "dry-run": "true", format: "json" });

      const jsonCall = stdoutSpy.mock.calls.find((c) => {
        try { JSON.parse(c[0]); return true; } catch { return false; }
      });
      expect(jsonCall).toBeDefined();
      const report = JSON.parse(jsonCall![0]);
      expect(report.dryRun).toBe(true);
      expect(report.actions.length).toBeGreaterThan(0);
      expect(report.summary.mutated).toBe(0);
    });

    it("dry-run reports no issues for clean PRD", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "t1",
            title: "Task",
            level: "task",
            status: "pending",
          },
        ],
      });

      await cmdFix(tmpDir, { "dry-run": "true", format: "json" });

      const jsonCall = stdoutSpy.mock.calls.find((c) => {
        try { JSON.parse(c[0]); return true; } catch { return false; }
      });
      const report = JSON.parse(jsonCall![0]);
      expect(report.actions).toHaveLength(0);
    });
  });

  // ── JSON output ────────────────────────────────────────────────────────────

  describe("JSON output", () => {
    it("includes summary with byKind breakdown", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "e1",
            title: "Epic",
            level: "epic",
            status: "completed",
            children: [
              {
                id: "t1",
                title: "Pending Task",
                level: "task",
                status: "pending",
                blockedBy: ["nonexistent"],
              },
            ],
          },
        ],
      });

      await cmdFix(tmpDir, { format: "json" });

      const jsonCall = stdoutSpy.mock.calls.find((c) => {
        try { JSON.parse(c[0]); return true; } catch { return false; }
      });
      expect(jsonCall).toBeDefined();
      const report = JSON.parse(jsonCall![0]);
      expect(report.dryRun).toBe(false);
      expect(report.summary.total).toBeGreaterThan(0);
      expect(report.summary.byKind).toBeDefined();
      expect(report.summary.mutated).toBeGreaterThan(0);
    });
  });

  // ── Logging ────────────────────────────────────────────────────────────────

  describe("logging", () => {
    it("appends to execution log when fixes are applied", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "t1",
            title: "Task",
            level: "task",
            status: "completed",
          },
        ],
      });

      await cmdFix(tmpDir, {});

      const logContent = readFileSync(join(tmpDir, ".rex", "execution-log.jsonl"), "utf-8");
      expect(logContent).toContain("auto_fix");
    });

    it("does not log when no fixes needed", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "t1",
            title: "Task",
            level: "task",
            status: "pending",
          },
        ],
      });

      await cmdFix(tmpDir, {});

      const logContent = readFileSync(join(tmpDir, ".rex", "execution-log.jsonl"), "utf-8");
      expect(logContent).not.toContain("auto_fix");
    });
  });
});
