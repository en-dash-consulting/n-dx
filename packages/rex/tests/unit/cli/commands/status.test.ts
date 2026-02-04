import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  cmdStatus,
  renderProgressBar,
} from "../../../../src/cli/commands/status.js";
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

describe("renderProgressBar", () => {
  it("renders empty bar at 0%", () => {
    const bar = renderProgressBar(0, 20);
    expect(bar).toBe("░░░░░░░░░░░░░░░░░░░░");
    expect(bar.length).toBe(20);
  });

  it("renders full bar at 100%", () => {
    const bar = renderProgressBar(1, 20);
    expect(bar).toBe("████████████████████");
    expect(bar.length).toBe(20);
  });

  it("renders partial bar at 50%", () => {
    const bar = renderProgressBar(0.5, 20);
    expect(bar).toBe("██████████░░░░░░░░░░");
  });

  it("rounds filled count correctly", () => {
    // 33% of 12 = 3.96 → rounds to 4
    const bar = renderProgressBar(0.33, 12);
    expect(bar).toBe("████░░░░░░░░");
  });

  it("clamps ratio below 0 to 0", () => {
    const bar = renderProgressBar(-0.5, 10);
    expect(bar).toBe("░░░░░░░░░░");
  });

  it("clamps ratio above 1 to 1", () => {
    const bar = renderProgressBar(1.5, 10);
    expect(bar).toBe("██████████");
  });

  it("uses default width of 20", () => {
    const bar = renderProgressBar(0.5);
    expect(bar.length).toBe(20);
  });
});

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

    it("shows blocked icon for blocked items", async () => {
      const blockedPrd: PRDDocument = {
        schema: "rex/v1",
        title: "Test Project",
        items: [
          {
            id: "t1",
            title: "Blocked Task",
            level: "task",
            status: "blocked",
          },
        ],
      };
      writePRD(tmp, blockedPrd);
      await cmdStatus(tmp, { format: "tree" });
      const out = output();

      // blocked icon
      expect(out).toContain("⊘");
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

  describe("epic progress bars", () => {
    it("shows progress bar for epics with children", async () => {
      writePRD(tmp, POPULATED_PRD);
      await cmdStatus(tmp, { format: "tree" });
      const lines = output().split("\n");

      // Auth System has children, should show a progress bar
      const authLine = lines.find((l) => l.includes("Auth System"));
      expect(authLine).toBeDefined();
      expect(authLine).toMatch(/[█░]/);
    });

    it("does not show progress bar for epics without children", async () => {
      writePRD(tmp, POPULATED_PRD);
      await cmdStatus(tmp, { format: "tree" });
      const lines = output().split("\n");

      // Dashboard has no children, no progress bar
      const dashLine = lines.find((l) => l.includes("Dashboard"));
      expect(dashLine).toBeDefined();
      expect(dashLine).not.toMatch(/[█░]/);
    });

    it("shows accurate percentage for each epic", async () => {
      writePRD(tmp, POPULATED_PRD);
      await cmdStatus(tmp, { format: "tree" });
      const lines = output().split("\n");

      // Auth System: 1 completed out of 4 descendants = 25%
      const authLine = lines.find((l) => l.includes("Auth System"));
      expect(authLine).toContain("25%");
    });

    it("shows 100% bar for fully completed epic", async () => {
      const fullPrd: PRDDocument = {
        schema: "rex/v1",
        title: "Done Project",
        items: [
          {
            id: "e1",
            title: "Finished Epic",
            level: "epic",
            status: "completed",
            children: [
              {
                id: "t1",
                title: "Done Task",
                level: "task",
                status: "completed",
              },
              {
                id: "t2",
                title: "Also Done",
                level: "task",
                status: "completed",
              },
            ],
          },
        ],
      };
      writePRD(tmp, fullPrd);
      await cmdStatus(tmp, {});
      const lines = output().split("\n");

      const epicLine = lines.find((l) => l.includes("Finished Epic"));
      expect(epicLine).toContain("100%");
      expect(epicLine).toMatch(/█/);
      expect(epicLine).not.toMatch(/░/);
    });

    it("shows 0% bar for epic with no completed children", async () => {
      const emptyPrd: PRDDocument = {
        schema: "rex/v1",
        title: "Fresh Project",
        items: [
          {
            id: "e1",
            title: "New Epic",
            level: "epic",
            status: "pending",
            children: [
              {
                id: "t1",
                title: "Todo Task",
                level: "task",
                status: "pending",
              },
            ],
          },
        ],
      };
      writePRD(tmp, emptyPrd);
      await cmdStatus(tmp, {});
      const lines = output().split("\n");

      const epicLine = lines.find((l) => l.includes("New Epic"));
      expect(epicLine).toContain("0%");
      expect(epicLine).toMatch(/░/);
      expect(epicLine).not.toMatch(/█/);
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
