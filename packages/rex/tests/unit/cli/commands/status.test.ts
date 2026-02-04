import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { cmdStatus } from "../../../../src/cli/commands/status.js";
import { CLIError } from "../../../../src/cli/errors.js";
import type { PRDDocument } from "../../../../src/schema/index.js";

function writePRD(dir: string, doc: PRDDocument): void {
  writeFileSync(join(dir, ".rex", "prd.json"), JSON.stringify(doc));
}

const EMPTY_PRD: PRDDocument = {
  schema: "rex/v1",
  title: "Test Project",
  items: [],
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
    },
  ],
};

describe("cmdStatus", () => {
  let tmp: string;
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "rex-status-test-"));
    mkdirSync(join(tmp, ".rex"));
    logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    logSpy.mockRestore();
    rmSync(tmp, { recursive: true });
  });

  function output(): string {
    return logSpy.mock.calls.map((c) => c[0] ?? "").join("\n");
  }

  describe("--format=tree", () => {
    it("shows full hierarchy with status icons", async () => {
      writePRD(tmp, POPULATED_PRD);
      await cmdStatus(tmp, { format: "tree" });
      const out = output();

      // All items visible
      expect(out).toContain("Auth System");
      expect(out).toContain("OAuth Flow");
      expect(out).toContain("Token Exchange");
      expect(out).toContain("Refresh Logic");
      expect(out).toContain("Session Store");
      expect(out).toContain("Dashboard");
    });

    it("shows status icons for each state", async () => {
      writePRD(tmp, POPULATED_PRD);
      await cmdStatus(tmp, { format: "tree" });
      const out = output();

      // completed icon
      expect(out).toContain("●");
      // in_progress icon
      expect(out).toContain("◐");
      // pending icon
      expect(out).toContain("○");
      // deferred icon
      expect(out).toContain("◌");
    });

    it("indents children under parents", async () => {
      writePRD(tmp, POPULATED_PRD);
      await cmdStatus(tmp, { format: "tree" });
      const lines = output().split("\n");

      // Epic-level items have no indentation
      const epicLine = lines.find((l) => l.includes("Auth System"));
      expect(epicLine).toBeDefined();
      expect(epicLine!.match(/^(\s*)/)?.[1].length).toBe(0);

      // Feature-level items are indented once
      const featureLine = lines.find((l) => l.includes("OAuth Flow"));
      expect(featureLine).toBeDefined();
      expect(featureLine!.match(/^(\s*)/)?.[1].length).toBeGreaterThan(0);

      // Task-level items are indented twice
      const taskLine = lines.find((l) => l.includes("Token Exchange"));
      expect(taskLine).toBeDefined();
      const featureIndent = featureLine!.match(/^(\s*)/)?.[1].length ?? 0;
      const taskIndent = taskLine!.match(/^(\s*)/)?.[1].length ?? 0;
      expect(taskIndent).toBeGreaterThan(featureIndent);
    });

    it("shows child completion counts for parents", async () => {
      writePRD(tmp, POPULATED_PRD);
      await cmdStatus(tmp, { format: "tree" });
      const lines = output().split("\n");

      // OAuth Flow has 2 children, 1 completed
      const oauthLine = lines.find((l) => l.includes("OAuth Flow"));
      expect(oauthLine).toContain("[1/2]");
    });

    it("shows priority when present", async () => {
      writePRD(tmp, POPULATED_PRD);
      await cmdStatus(tmp, { format: "tree" });
      const out = output();

      expect(out).toContain("[high]");
      expect(out).toContain("[critical]");
    });

    it("shows summary stats line", async () => {
      writePRD(tmp, POPULATED_PRD);
      await cmdStatus(tmp, { format: "tree" });
      const out = output();

      expect(out).toContain("complete");
      expect(out).toMatch(/\d+\/\d+/); // e.g. 1/5
    });

    it("shows empty state", async () => {
      writePRD(tmp, EMPTY_PRD);
      await cmdStatus(tmp, { format: "tree" });
      const out = output();

      expect(out).toContain("No items yet");
    });

    it("shows PRD title", async () => {
      writePRD(tmp, POPULATED_PRD);
      await cmdStatus(tmp, { format: "tree" });
      const out = output();

      expect(out).toContain("PRD: Test Project");
    });
  });

  describe("default format matches tree format", () => {
    it("produces same output as --format=tree", async () => {
      writePRD(tmp, POPULATED_PRD);

      await cmdStatus(tmp, { format: "tree" });
      const treeOut = output();

      logSpy.mockClear();

      await cmdStatus(tmp, {});
      const defaultOut = output();

      expect(defaultOut).toBe(treeOut);
    });
  });

  describe("unknown format", () => {
    it("throws CLIError for unrecognized format", async () => {
      writePRD(tmp, POPULATED_PRD);
      await expect(cmdStatus(tmp, { format: "csv" })).rejects.toThrow(CLIError);
      await expect(cmdStatus(tmp, { format: "csv" })).rejects.toThrow(
        /Unknown format/,
      );
    });

    it("suggests valid formats", async () => {
      writePRD(tmp, POPULATED_PRD);
      try {
        await cmdStatus(tmp, { format: "xml" });
      } catch (err) {
        expect(err).toBeInstanceOf(CLIError);
        expect((err as CLIError).suggestion).toContain("tree");
        expect((err as CLIError).suggestion).toContain("json");
      }
    });
  });
});
