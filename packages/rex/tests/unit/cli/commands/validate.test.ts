import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { cmdValidate } from "../../../../src/cli/commands/validate.js";
import type { PRDDocument } from "../../../../src/schema/index.js";

function writePRD(dir: string, doc: PRDDocument): void {
  writeFileSync(join(dir, ".rex", "prd.json"), JSON.stringify(doc));
}

function writeConfig(dir: string, config: Record<string, unknown>): void {
  writeFileSync(join(dir, ".rex", "config.json"), JSON.stringify(config));
}

const VALID_CONFIG = {
  schema: "rex/v1",
  project: "test-validate",
  adapter: "file",
};

const VALID_PRD: PRDDocument = {
  schema: "rex/v1",
  title: "Test Project",
  items: [
    {
      id: "e1",
      title: "Epic One",
      level: "epic",
      status: "pending",
      priority: "medium",
      children: [
        {
          id: "t1",
          title: "Task One",
          level: "task",
          status: "completed",
          priority: "medium",
          startedAt: "2026-01-01T00:00:00.000Z",
          completedAt: "2026-01-02T00:00:00.000Z",
        },
      ],
    },
  ],
};

describe("cmdValidate", () => {
  let tmpDir: string;
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let stdoutSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "rex-validate-test-"));
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

  // ── Exit code behavior ────────────────────────────────────────────────────

  describe("exit codes", () => {
    it("exits 0 when all checks pass (text mode)", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, VALID_PRD);

      await cmdValidate(tmpDir, {});
      // No process.exit call means exit code 0
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("exits 0 when all checks pass (JSON mode)", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, VALID_PRD);

      await cmdValidate(tmpDir, { format: "json" });
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("exits 1 on schema validation errors (text mode)", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writeFileSync(
        join(tmpDir, ".rex", "prd.json"),
        JSON.stringify({ invalid: true }),
      );

      await expect(cmdValidate(tmpDir, {})).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits 1 on schema validation errors (JSON mode)", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writeFileSync(
        join(tmpDir, ".rex", "prd.json"),
        JSON.stringify({ invalid: true }),
      );

      await expect(cmdValidate(tmpDir, { format: "json" })).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits 1 on orphaned items", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      // Task at root level is an orphan — tasks must be under feature or epic
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

      await expect(cmdValidate(tmpDir, {})).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits 1 on orphaned items (JSON mode)", async () => {
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

      await expect(cmdValidate(tmpDir, { format: "json" })).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits 0 when only warnings exist (stuck tasks)", async () => {
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

      // Warnings do not cause exit(1)
      await cmdValidate(tmpDir, {});
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("exits 0 when only warnings exist (JSON mode)", async () => {
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
              },
            ],
          },
        ],
      });

      await cmdValidate(tmpDir, { format: "json" });
      expect(exitSpy).not.toHaveBeenCalled();
    });

    it("exits 1 on DAG errors (duplicate IDs)", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "e1",
            title: "Epic A",
            level: "epic",
            status: "pending",
          },
          {
            id: "e1",
            title: "Epic B (duplicate)",
            level: "epic",
            status: "pending",
          },
        ],
      });

      await expect(cmdValidate(tmpDir, {})).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it("exits 1 on blockedBy cycles", async () => {
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
                title: "Task A",
                level: "task",
                status: "pending",
                blockedBy: ["t2"],
              },
              {
                id: "t2",
                title: "Task B",
                level: "task",
                status: "pending",
                blockedBy: ["t1"],
              },
            ],
          },
        ],
      });

      await expect(cmdValidate(tmpDir, {})).rejects.toThrow("process.exit");
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });

  // ── Error reporting ───────────────────────────────────────────────────────

  describe("error reporting", () => {
    it("reports validation errors clearly in text mode", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writeFileSync(
        join(tmpDir, ".rex", "prd.json"),
        JSON.stringify({ invalid: true }),
      );

      await expect(cmdValidate(tmpDir, {})).rejects.toThrow("process.exit");

      const output = stdoutSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("✗ prd.json schema");
      expect(output).toContain("Validation failed.");
    });

    it("reports orphaned items clearly in text mode", async () => {
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

      await expect(cmdValidate(tmpDir, {})).rejects.toThrow("process.exit");

      const output = stdoutSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("✗ hierarchy placement");
      expect(output).toContain("sub1");
    });

    it("reports errors in JSON output with pass=false", async () => {
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

      await expect(cmdValidate(tmpDir, { format: "json" })).rejects.toThrow("process.exit");

      // Find the JSON output call
      const jsonCall = stdoutSpy.mock.calls.find((c) => {
        try {
          JSON.parse(c[0]);
          return true;
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeDefined();
      const report = JSON.parse(jsonCall![0]);
      const hierarchyCheck = report.checks.find((c: { name: string }) => c.name === "hierarchy placement");
      expect(hierarchyCheck).toBeDefined();
      expect(hierarchyCheck.pass).toBe(false);
      expect(hierarchyCheck.errors.length).toBeGreaterThan(0);
      expect(hierarchyCheck.errors[0]).toContain("sub1");
    });

    it("warns are shown but do not appear as failures in JSON", async () => {
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
                title: "Stuck",
                level: "task",
                status: "in_progress",
              },
            ],
          },
        ],
      });

      await cmdValidate(tmpDir, { format: "json" });

      const jsonCall = stdoutSpy.mock.calls.find((c) => {
        try {
          JSON.parse(c[0]);
          return true;
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeDefined();
      const report = JSON.parse(jsonCall![0]);
      const stuckCheck = report.checks.find((c: { name: string }) => c.name === "stuck tasks");
      expect(stuckCheck).toBeDefined();
      expect(stuckCheck.pass).toBe(false);
      expect(stuckCheck.severity).toBe("warn");
    });

    it("reports timestamp inconsistency warnings in text mode", async () => {
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
                title: "Completed no timestamp",
                level: "task",
                status: "completed",
              },
            ],
          },
        ],
      });

      await cmdValidate(tmpDir, {});
      const output = stdoutSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("⚠ timestamp consistency");
      expect(output).toContain("completedAt");
    });

    it("reports parent-child inconsistency warnings in text mode", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "e1",
            title: "Completed epic",
            level: "epic",
            status: "completed",
            startedAt: "2026-01-01T00:00:00.000Z",
            completedAt: "2026-01-10T00:00:00.000Z",
            children: [
              {
                id: "t1",
                title: "Still pending",
                level: "task",
                status: "pending",
              },
            ],
          },
        ],
      });

      await cmdValidate(tmpDir, {});
      const output = stdoutSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("⚠ parent-child status consistency");
      expect(output).toContain("non-terminal");
    });

    it("reports timestamp warnings in JSON output with severity=warn", async () => {
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
                title: "Completed no ts",
                level: "task",
                status: "completed",
              },
            ],
          },
        ],
      });

      await cmdValidate(tmpDir, { format: "json" });

      const jsonCall = stdoutSpy.mock.calls.find((c) => {
        try {
          JSON.parse(c[0]);
          return true;
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeDefined();
      const report = JSON.parse(jsonCall![0]);
      const tsCheck = report.checks.find((c: { name: string }) => c.name === "timestamp consistency");
      expect(tsCheck).toBeDefined();
      expect(tsCheck.pass).toBe(false);
      expect(tsCheck.severity).toBe("warn");
      // Warnings don't cause failure
      expect(report.ok).toBe(true);
    });

    it("reports empty container warnings in text mode", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "e1",
            title: "Empty Epic",
            level: "epic",
            status: "pending",
          },
        ],
      });

      await cmdValidate(tmpDir, {});
      const output = stdoutSpy.mock.calls.map((c) => c[0]).join("\n");
      expect(output).toContain("⚠ empty containers");
      expect(output).toContain("e1");
    });

    it("reports empty container warnings in JSON output with severity=warn", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "e1",
            title: "Empty Epic",
            level: "epic",
            status: "pending",
          },
        ],
      });

      await cmdValidate(tmpDir, { format: "json" });

      const jsonCall = stdoutSpy.mock.calls.find((c) => {
        try {
          JSON.parse(c[0]);
          return true;
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeDefined();
      const report = JSON.parse(jsonCall![0]);
      const ecCheck = report.checks.find((c: { name: string }) => c.name === "empty containers");
      expect(ecCheck).toBeDefined();
      expect(ecCheck.pass).toBe(false);
      expect(ecCheck.severity).toBe("warn");
      expect(ecCheck.errors[0]).toContain("e1");
      // Warnings don't cause failure
      expect(report.ok).toBe(true);
    });

    it("does not warn about epics with children", async () => {
      writeConfig(tmpDir, VALID_CONFIG);
      writePRD(tmpDir, VALID_PRD);

      await cmdValidate(tmpDir, { format: "json" });

      const jsonCall = stdoutSpy.mock.calls.find((c) => {
        try {
          JSON.parse(c[0]);
          return true;
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeDefined();
      const report = JSON.parse(jsonCall![0]);
      const ecCheck = report.checks.find((c: { name: string }) => c.name === "empty containers");
      expect(ecCheck).toBeDefined();
      expect(ecCheck.pass).toBe(true);
    });

    it("includes a summary field in JSON output", async () => {
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

      await expect(cmdValidate(tmpDir, { format: "json" })).rejects.toThrow("process.exit");

      const jsonCall = stdoutSpy.mock.calls.find((c) => {
        try {
          const parsed = JSON.parse(c[0]);
          return parsed && typeof parsed === "object" && "ok" in parsed;
        } catch {
          return false;
        }
      });
      expect(jsonCall).toBeDefined();
      const report = JSON.parse(jsonCall![0]);
      expect(report.ok).toBe(false);
      expect(report.checks).toBeDefined();
      expect(report.summary).toBeDefined();
      expect(report.summary.failed).toBeGreaterThan(0);
    });
  });
});
