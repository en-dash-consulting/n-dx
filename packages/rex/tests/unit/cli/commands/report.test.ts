import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { cmdReport } from "../../../../src/cli/commands/report.js";
import type { PRDDocument } from "../../../../src/schema/index.js";

function writePRD(dir: string, doc: PRDDocument): void {
  writeFileSync(join(dir, ".rex", "prd.json"), JSON.stringify(doc));
}

function writeConfig(dir: string, config: Record<string, unknown>): void {
  writeFileSync(join(dir, ".rex", "config.json"), JSON.stringify(config));
}

const VALID_CONFIG = {
  schema: "rex/v1",
  project: "test-report",
  adapter: "file",
};

const POPULATED_PRD: PRDDocument = {
  schema: "rex/v1",
  title: "Test Project",
  items: [
    {
      id: "e1",
      title: "Auth System",
      level: "epic",
      status: "in_progress",
      priority: "high",
      children: [
        {
          id: "f1",
          title: "OAuth Flow",
          level: "feature",
          status: "in_progress",
          children: [
            {
              id: "t1",
              title: "Token Exchange",
              level: "task",
              status: "completed",
              priority: "critical",
              completedAt: "2025-06-01T10:00:00.000Z",
            },
            {
              id: "t2",
              title: "Refresh Logic",
              level: "task",
              status: "pending",
            },
          ],
        },
        {
          id: "f2",
          title: "Session Store",
          level: "feature",
          status: "deferred",
        },
      ],
    },
    {
      id: "e2",
      title: "Dashboard",
      level: "epic",
      status: "pending",
      children: [
        {
          id: "t3",
          title: "Layout",
          level: "task",
          status: "blocked",
          blockedBy: ["t2"],
        },
      ],
    },
  ],
};

describe("cmdReport", () => {
  let tmpDir: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "rex-report-test-"));
    mkdirSync(join(tmpDir, ".rex"), { recursive: true });
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as never);
    stdoutSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    exitSpy.mockRestore();
    stdoutSpy.mockRestore();
  });

  function parseOutput(): unknown {
    const jsonCall = stdoutSpy.mock.calls.find((c) => {
      try {
        JSON.parse(c[0]);
        return true;
      } catch {
        return false;
      }
    });
    expect(jsonCall).toBeDefined();
    return JSON.parse(jsonCall![0]);
  }

  // ── Output structure ──────────────────────────────────────────────────────

  describe("report structure", () => {
    it("outputs valid JSON", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, POPULATED_PRD);

      await cmdReport(tmpDir, {});
      const report = parseOutput() as Record<string, unknown>;

      expect(report).toBeDefined();
      expect(typeof report).toBe("object");
    });

    it("includes timestamp", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, POPULATED_PRD);

      await cmdReport(tmpDir, {});
      const report = parseOutput() as Record<string, unknown>;

      expect(report.timestamp).toBeDefined();
      expect(typeof report.timestamp).toBe("string");
      // Should be a valid ISO date
      expect(new Date(report.timestamp as string).toISOString()).toBe(report.timestamp);
    });

    it("includes ok field", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, POPULATED_PRD);

      await cmdReport(tmpDir, {});
      const report = parseOutput() as Record<string, unknown>;

      expect(typeof report.ok).toBe("boolean");
    });

    it("includes validation section", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, POPULATED_PRD);

      await cmdReport(tmpDir, {});
      const report = parseOutput() as Record<string, unknown>;
      const validation = report.validation as Record<string, unknown>;

      expect(validation).toBeDefined();
      expect(validation.ok).toBe(true);
      expect(validation.checks).toBeInstanceOf(Array);
      expect(validation.summary).toBeDefined();
    });

    it("includes stats section", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, POPULATED_PRD);

      await cmdReport(tmpDir, {});
      const report = parseOutput() as Record<string, unknown>;
      const stats = report.stats as Record<string, unknown>;

      // Counts tasks/subtasks + childless features (f2 is childless and deferred)
      expect(stats).toBeDefined();
      expect(stats.total).toBe(4); // t1, t2, t3, f2
      expect(stats.completed).toBe(1); // t1
      expect(stats.inProgress).toBe(0);
      expect(stats.pending).toBe(1); // t2
      expect(stats.deferred).toBe(1); // f2 (childless feature)
      expect(stats.blocked).toBe(1); // t3
    });

    it("includes progress section with percentage", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, POPULATED_PRD);

      await cmdReport(tmpDir, {});
      const report = parseOutput() as Record<string, unknown>;
      const progress = report.progress as Record<string, unknown>;

      // Counts tasks/subtasks + childless features
      expect(progress).toBeDefined();
      expect(typeof progress.percent).toBe("number");
      expect(progress.percent).toBe(25); // 1/4 = 25% (f2 is childless and deferred)
      expect(progress.completed).toBe(1);
      expect(progress.total).toBe(4);
    });

    it("includes breakdown by level", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, POPULATED_PRD);

      await cmdReport(tmpDir, {});
      const report = parseOutput() as Record<string, unknown>;
      const breakdown = report.breakdown as Record<string, Record<string, number>>;

      expect(breakdown).toBeDefined();
      expect(breakdown.epic).toBeDefined();
      expect(breakdown.epic.total).toBe(2);
      expect(breakdown.feature).toBeDefined();
      expect(breakdown.feature.total).toBe(2);
      expect(breakdown.task).toBeDefined();
      expect(breakdown.task.total).toBe(3);
    });
  });

  // ── Health status ─────────────────────────────────────────────────────────

  describe("health status", () => {
    it("ok is true for valid PRD", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, POPULATED_PRD);

      await cmdReport(tmpDir, {});
      const report = parseOutput() as Record<string, unknown>;

      expect(report.ok).toBe(true);
    });

    it("ok is false when validation has errors", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "sub1",
            title: "Orphan Subtask",
            level: "subtask",
            status: "pending",
          },
        ],
      });

      await cmdReport(tmpDir, {});
      const report = parseOutput() as Record<string, unknown>;

      expect(report.ok).toBe(false);
      const validation = report.validation as Record<string, unknown>;
      expect(validation.ok).toBe(false);
    });

    it("does not exit non-zero on validation errors", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "sub1",
            title: "Orphan Subtask",
            level: "subtask",
            status: "pending",
          },
        ],
      });

      // report always exits 0 — it's informational, not a gate
      await cmdReport(tmpDir, {});
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("includes warnings without affecting ok status", async () => {
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
                title: "Stuck Task",
                level: "task",
                status: "in_progress",
                // no startedAt → stuck warning
              },
            ],
          },
        ],
      });

      await cmdReport(tmpDir, {});
      const report = parseOutput() as Record<string, unknown>;

      // Warnings don't fail health
      expect(report.ok).toBe(true);
      const validation = report.validation as Record<string, unknown>;
      const summary = validation.summary as Record<string, number>;
      expect(summary.warnings).toBeGreaterThan(0);
    });
  });

  // ── Breakdown by level ────────────────────────────────────────────────────

  describe("level breakdown", () => {
    it("counts items per level and status", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, POPULATED_PRD);

      await cmdReport(tmpDir, {});
      const report = parseOutput() as Record<string, unknown>;
      const breakdown = report.breakdown as Record<string, Record<string, number>>;

      // 2 epics: 1 in_progress, 1 pending
      expect(breakdown.epic.total).toBe(2);
      expect(breakdown.epic.completed).toBe(0);
      expect(breakdown.epic.inProgress).toBe(1);
      expect(breakdown.epic.pending).toBe(1);

      // 2 features: 1 in_progress, 1 deferred
      expect(breakdown.feature.total).toBe(2);
      expect(breakdown.feature.inProgress).toBe(1);
      expect(breakdown.feature.deferred).toBe(1);

      // 3 tasks: t1 completed, t2 pending, t3 blocked
      expect(breakdown.task.total).toBe(3);
      expect(breakdown.task.completed).toBe(1);
      expect(breakdown.task.pending).toBe(1);
      expect(breakdown.task.blocked).toBe(1);
    });

    it("omits levels with zero items", async () => {
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
          },
        ],
      });

      await cmdReport(tmpDir, {});
      const report = parseOutput() as Record<string, unknown>;
      const breakdown = report.breakdown as Record<string, unknown>;

      expect(breakdown.epic).toBeDefined();
      expect(breakdown.feature).toBeUndefined();
      expect(breakdown.task).toBeUndefined();
      expect(breakdown.subtask).toBeUndefined();
    });
  });

  // ── Empty PRD ─────────────────────────────────────────────────────────────

  describe("empty PRD", () => {
    it("handles empty items array", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Empty Project",
        items: [],
      });

      await cmdReport(tmpDir, {});
      const report = parseOutput() as Record<string, unknown>;

      expect(report.ok).toBe(true);
      const stats = report.stats as Record<string, number>;
      expect(stats.total).toBe(0);

      const progress = report.progress as Record<string, number>;
      expect(progress.percent).toBe(0);
      expect(progress.total).toBe(0);
    });
  });

  // ── Exit code behavior ────────────────────────────────────────────────────

  describe("exit codes", () => {
    it("exits 1 when --fail-on-error and health is bad", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "sub1",
            title: "Orphan",
            level: "subtask",
            status: "pending",
          },
        ],
      });

      await expect(
        cmdReport(tmpDir, { "fail-on-error": "true" }),
      ).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits 0 when --fail-on-error and health is good", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, POPULATED_PRD);

      await cmdReport(tmpDir, { "fail-on-error": "true" });
      expect(exitSpy).not.toHaveBeenCalled();
    });
  });
});
