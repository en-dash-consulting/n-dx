import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  cmdStatus,
  renderProgressBar,
  formatTimestamp,
  renderTree,
} from "../../../../src/cli/commands/status.js";
import { CLIError } from "../../../../src/cli/errors.js";
import type { PRDDocument, PRDItem } from "../../../../src/schema/index.js";
import type { CoverageMap } from "../../../../src/cli/commands/status.js";

function writePRD(dir: string, doc: PRDDocument): void {
  writeFileSync(join(dir, ".rex", "prd.json"), JSON.stringify(doc));
}

function writeConfig(dir: string, config: Record<string, unknown>): void {
  writeFileSync(join(dir, ".rex", "config.json"), JSON.stringify(config));
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

describe("formatTimestamp", () => {
  it("formats an ISO string as MM-DD HH:MM", () => {
    expect(formatTimestamp("2025-03-15T14:30:00.000Z")).toMatch(/\d{2}-15 \d{2}:\d{2}/);
  });

  it("returns empty string for invalid date", () => {
    expect(formatTimestamp("not-a-date")).toBe("");
  });

  it("returns empty string for empty string", () => {
    expect(formatTimestamp("")).toBe("");
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

  describe("timestamps in tree output", () => {
    it("shows startedAt for in_progress items", async () => {
      const prd: PRDDocument = {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "t1",
            title: "Active Task",
            level: "task",
            status: "in_progress",
            startedAt: "2025-03-15T14:30:00.000Z",
          },
        ],
      };
      writePRD(tmp, prd);
      await cmdStatus(tmp, {});
      const out = output();

      expect(out).toContain("Active Task");
      expect(out).toMatch(/\(started \d{2}-15 \d{2}:\d{2}\)/);
    });

    it("shows completedAt for completed items", async () => {
      const prd: PRDDocument = {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "t1",
            title: "Done Task",
            level: "task",
            status: "completed",
            completedAt: "2025-06-20T09:15:00.000Z",
          },
        ],
      };
      writePRD(tmp, prd);
      await cmdStatus(tmp, {});
      const out = output();

      expect(out).toContain("Done Task");
      expect(out).toMatch(/\(done \d{2}-20 \d{2}:\d{2}\)/);
    });

    it("does not show timestamp for pending items", async () => {
      const prd: PRDDocument = {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "t1",
            title: "Pending Task",
            level: "task",
            status: "pending",
          },
        ],
      };
      writePRD(tmp, prd);
      await cmdStatus(tmp, {});
      const out = output();

      expect(out).toContain("Pending Task");
      expect(out).not.toContain("(started");
      expect(out).not.toContain("(done");
    });

    it("does not show timestamp when field is absent", async () => {
      const prd: PRDDocument = {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "t1",
            title: "No Timestamp",
            level: "task",
            status: "in_progress",
          },
        ],
      };
      writePRD(tmp, prd);
      await cmdStatus(tmp, {});
      const out = output();

      expect(out).toContain("No Timestamp");
      expect(out).not.toContain("(started");
    });

    it("shows timestamps in json output via document dump", async () => {
      const prd: PRDDocument = {
        schema: "rex/v1",
        title: "Test",
        items: [
          {
            id: "t1",
            title: "Tracked Task",
            level: "task",
            status: "completed",
            startedAt: "2025-03-15T14:30:00.000Z",
            completedAt: "2025-03-15T16:00:00.000Z",
          },
        ],
      };
      writePRD(tmp, prd);
      await cmdStatus(tmp, { format: "json" });
      const out = output();
      const parsed = JSON.parse(out);

      expect(parsed.items[0].startedAt).toBe("2025-03-15T14:30:00.000Z");
      expect(parsed.items[0].completedAt).toBe("2025-03-15T16:00:00.000Z");
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

  describe("--coverage flag", () => {
    const PRD_WITH_CRITERIA: PRDDocument = {
      schema: "rex/v1",
      title: "Test Project",
      items: [
        {
          id: "e1",
          title: "Auth System",
          level: "epic",
          status: "in_progress",
          children: [
            {
              id: "t1",
              title: "Login feature",
              level: "task",
              status: "pending",
              acceptanceCriteria: [
                "User can login successfully",
                "Shows error on invalid credentials",
              ],
            },
            {
              id: "t2",
              title: "Session store",
              level: "task",
              status: "completed",
            },
          ],
        },
      ],
    };

    it("shows coverage indicators on tasks with acceptance criteria", async () => {
      writePRD(tmp, PRD_WITH_CRITERIA);
      writeConfig(tmp, { schema: "rex/v1", project: "test", adapter: "file" });
      // Create a test file matching "login"
      mkdirSync(join(tmp, "tests"), { recursive: true });
      writeFileSync(join(tmp, "tests", "login.test.ts"), "");

      await cmdStatus(tmp, { coverage: "true" });
      const out = output();

      // Login feature should show a coverage indicator
      const loginLine = out.split("\n").find((l: string) => l.includes("Login feature"));
      expect(loginLine).toBeDefined();
      expect(loginLine).toMatch(/\[.*\d+\/\d+.*\]/); // coverage ratio like [1/2 covered]
    });

    it("does not show coverage indicators when flag is absent", async () => {
      writePRD(tmp, PRD_WITH_CRITERIA);
      writeConfig(tmp, { schema: "rex/v1", project: "test", adapter: "file" });
      mkdirSync(join(tmp, "tests"), { recursive: true });
      writeFileSync(join(tmp, "tests", "login.test.ts"), "");

      await cmdStatus(tmp, {});
      const out = output();

      // No coverage indicators
      expect(out).not.toContain("covered");
    });

    it("shows uncovered indicator when no tests match", async () => {
      writePRD(tmp, PRD_WITH_CRITERIA);
      writeConfig(tmp, { schema: "rex/v1", project: "test", adapter: "file" });
      // No test files created

      await cmdStatus(tmp, { coverage: "true" });
      const out = output();

      const loginLine = out.split("\n").find((l: string) => l.includes("Login feature"));
      expect(loginLine).toBeDefined();
      expect(loginLine).toContain("0/2 covered");
    });

    it("shows coverage summary at the bottom", async () => {
      writePRD(tmp, PRD_WITH_CRITERIA);
      writeConfig(tmp, { schema: "rex/v1", project: "test", adapter: "file" });
      mkdirSync(join(tmp, "tests"), { recursive: true });
      writeFileSync(join(tmp, "tests", "login.test.ts"), "");

      await cmdStatus(tmp, { coverage: "true" });
      const out = output();

      // Summary line
      expect(out).toMatch(/\d+\/\d+ criteria covered/);
    });

    it("skips tasks without acceptance criteria in coverage", async () => {
      writePRD(tmp, PRD_WITH_CRITERIA);
      writeConfig(tmp, { schema: "rex/v1", project: "test", adapter: "file" });

      await cmdStatus(tmp, { coverage: "true" });
      const out = output();

      // Session store (no acceptance criteria) should not have coverage indicator
      const sessionLine = out.split("\n").find((l: string) => l.includes("Session store"));
      expect(sessionLine).toBeDefined();
      expect(sessionLine).not.toContain("covered");
    });

    it("includes coverage data in JSON output when --coverage is used", async () => {
      writePRD(tmp, PRD_WITH_CRITERIA);
      writeConfig(tmp, { schema: "rex/v1", project: "test", adapter: "file" });
      mkdirSync(join(tmp, "tests"), { recursive: true });
      writeFileSync(join(tmp, "tests", "login.test.ts"), "");

      await cmdStatus(tmp, { format: "json", coverage: "true" });
      const out = output();
      const parsed = JSON.parse(out);

      expect(parsed.coverage).toBeDefined();
      expect(parsed.coverage.tasks).toBeInstanceOf(Array);
      expect(parsed.coverage.summary).toBeDefined();
      expect(parsed.coverage.summary.totalCriteria).toBe(2);
    });

    it("does not include coverage in JSON output when flag is absent", async () => {
      writePRD(tmp, PRD_WITH_CRITERIA);
      writeConfig(tmp, { schema: "rex/v1", project: "test", adapter: "file" });

      await cmdStatus(tmp, { format: "json" });
      const out = output();
      const parsed = JSON.parse(out);

      expect(parsed.coverage).toBeUndefined();
    });
  });
});

describe("renderTree with coverage", () => {
  it("annotates tasks that have coverage data", () => {
    const items: PRDItem[] = [
      {
        id: "t1",
        title: "Login feature",
        level: "task",
        status: "pending",
        acceptanceCriteria: ["User can login", "Shows errors"],
      },
    ];
    const coverage: CoverageMap = new Map([
      ["t1", { covered: 1, total: 2 }],
    ]);

    const lines = renderTree(items, 0, coverage);
    expect(lines[0]).toContain("[1/2 covered]");
  });

  it("shows full coverage with checkmark", () => {
    const items: PRDItem[] = [
      {
        id: "t1",
        title: "Login feature",
        level: "task",
        status: "completed",
        acceptanceCriteria: ["User can login"],
      },
    ];
    const coverage: CoverageMap = new Map([
      ["t1", { covered: 1, total: 1 }],
    ]);

    const lines = renderTree(items, 0, coverage);
    expect(lines[0]).toContain("✓");
  });

  it("shows zero coverage with warning", () => {
    const items: PRDItem[] = [
      {
        id: "t1",
        title: "Login feature",
        level: "task",
        status: "pending",
        acceptanceCriteria: ["User can login"],
      },
    ];
    const coverage: CoverageMap = new Map([
      ["t1", { covered: 0, total: 1 }],
    ]);

    const lines = renderTree(items, 0, coverage);
    expect(lines[0]).toContain("✗");
    expect(lines[0]).toContain("0/1 covered");
  });

  it("does not annotate tasks without coverage data", () => {
    const items: PRDItem[] = [
      {
        id: "t1",
        title: "Simple task",
        level: "task",
        status: "pending",
      },
    ];

    const coverage: CoverageMap = new Map();
    const lines = renderTree(items, 0, coverage);
    expect(lines[0]).not.toContain("covered");
  });

  it("renders normally when no coverage map is provided", () => {
    const items: PRDItem[] = [
      {
        id: "t1",
        title: "Simple task",
        level: "task",
        status: "pending",
      },
    ];

    const lines = renderTree(items);
    expect(lines[0]).toContain("Simple task");
    expect(lines[0]).not.toContain("covered");
  });
});
