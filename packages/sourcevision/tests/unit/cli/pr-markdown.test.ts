import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { cmdPrMarkdown, toBranchWorkRecord, generatePrMarkdownFile, PR_MARKDOWN_FILENAME } from "../../../src/cli/commands/pr-markdown.js";
import { CLIError } from "../../../src/cli/errors.js";
import type { BranchWorkResult } from "../../../src/analyzers/branch-work-collector.js";
import { existsSync } from "node:fs";

function git(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf-8" }).trim();
}

function writePRD(dir: string, items: unknown[]): void {
  mkdirSync(join(dir, ".rex"), { recursive: true });
  writeFileSync(
    join(dir, ".rex", "prd.json"),
    JSON.stringify({ schema: "1.0.0", title: "Test Project", items }, null, 2),
    "utf-8",
  );
}

// ── toBranchWorkRecord (pure conversion) ────────────────────────────────────

describe("toBranchWorkRecord", () => {
  it("converts a BranchWorkResult with items to a BranchWorkRecord", () => {
    const result: BranchWorkResult = {
      branch: "feature/test",
      baseBranch: "main",
      collectedAt: "2026-01-01T00:00:00.000Z",
      items: [
        {
          id: "task-1",
          title: "Task One",
          level: "task",
          completedAt: "2026-01-01T00:00:00.000Z",
          priority: "high",
          tags: ["refactor"],
          description: "A test task",
          acceptanceCriteria: ["Tests pass"],
          parentChain: [
            { id: "epic-1", title: "Epic One", level: "epic" },
            { id: "feature-1", title: "Feature One", level: "feature" },
          ],
        },
      ],
      epicSummaries: [
        { id: "epic-1", title: "Epic One", completedCount: 1 },
      ],
    };

    const record = toBranchWorkRecord(result);

    expect(record.schemaVersion).toBe("1.0.0");
    expect(record.branch).toBe("feature/test");
    expect(record.baseBranch).toBe("main");
    expect(record.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(record.updatedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(record.items).toHaveLength(1);
    expect(record.items[0].id).toBe("task-1");
    expect(record.items[0].completedAt).toBe("2026-01-01T00:00:00.000Z");
    expect(record.items[0].priority).toBe("high");
    expect(record.items[0].tags).toEqual(["refactor"]);
    expect(record.items[0].description).toBe("A test task");
    expect(record.items[0].acceptanceCriteria).toEqual(["Tests pass"]);
    expect(record.items[0].parentChain).toEqual([
      { id: "epic-1", title: "Epic One", level: "epic" },
      { id: "feature-1", title: "Feature One", level: "feature" },
    ]);
    expect(record.epicSummaries).toHaveLength(1);
    expect(record.epicSummaries[0].title).toBe("Epic One");
    expect(record.epicSummaries[0].completedCount).toBe(1);
  });

  it("uses collectedAt as fallback for missing completedAt", () => {
    const result: BranchWorkResult = {
      branch: "feature/test",
      baseBranch: "main",
      collectedAt: "2026-02-01T12:00:00.000Z",
      items: [
        {
          id: "task-1",
          title: "Task Without Timestamp",
          level: "task",
          parentChain: [],
        },
      ],
    };

    const record = toBranchWorkRecord(result);
    expect(record.items[0].completedAt).toBe("2026-02-01T12:00:00.000Z");
  });

  it("handles empty result with no items or epic summaries", () => {
    const result: BranchWorkResult = {
      branch: "unknown",
      baseBranch: "main",
      collectedAt: "2026-01-01T00:00:00.000Z",
      items: [],
    };

    const record = toBranchWorkRecord(result);
    expect(record.items).toHaveLength(0);
    expect(record.epicSummaries).toHaveLength(0);
    expect(record.branch).toBe("unknown");
  });

  it("omits optional fields when not present on source items", () => {
    const result: BranchWorkResult = {
      branch: "feature/minimal",
      baseBranch: "main",
      collectedAt: "2026-01-01T00:00:00.000Z",
      items: [
        {
          id: "task-1",
          title: "Minimal Task",
          level: "task",
          parentChain: [],
        },
      ],
    };

    const record = toBranchWorkRecord(result);
    const item = record.items[0];
    expect(item).not.toHaveProperty("priority");
    expect(item).not.toHaveProperty("tags");
    expect(item).not.toHaveProperty("description");
    expect(item).not.toHaveProperty("acceptanceCriteria");
  });

  it("classifies items with breaking change tags", () => {
    const result: BranchWorkResult = {
      branch: "feature/breaking",
      baseBranch: "main",
      collectedAt: "2026-01-01T00:00:00.000Z",
      items: [
        {
          id: "task-1",
          title: "Remove legacy API",
          level: "task",
          tags: ["breaking"],
          parentChain: [],
        },
      ],
    };

    const record = toBranchWorkRecord(result);
    expect(record.items[0].breakingChange).toBe(true);
    expect(record.items[0].changeSignificance).toBe("major");
  });

  it("classifies epic-level items as major", () => {
    const result: BranchWorkResult = {
      branch: "feature/epic",
      baseBranch: "main",
      collectedAt: "2026-01-01T00:00:00.000Z",
      items: [
        {
          id: "epic-1",
          title: "Complete auth system",
          level: "epic",
          parentChain: [],
        },
      ],
    };

    const record = toBranchWorkRecord(result);
    expect(record.items[0].changeSignificance).toBe("major");
    expect(record.items[0].breakingChange).toBe(false);
  });

  it("classifies normal tasks as patch", () => {
    const result: BranchWorkResult = {
      branch: "feature/normal",
      baseBranch: "main",
      collectedAt: "2026-01-01T00:00:00.000Z",
      items: [
        {
          id: "task-1",
          title: "Add unit tests",
          level: "task",
          parentChain: [],
        },
      ],
    };

    const record = toBranchWorkRecord(result);
    expect(record.items[0].changeSignificance).toBe("patch");
    expect(record.items[0].breakingChange).toBe(false);
  });

  it("elevates tasks under large epics using epic summaries", () => {
    const result: BranchWorkResult = {
      branch: "feature/large-epic",
      baseBranch: "main",
      collectedAt: "2026-01-01T00:00:00.000Z",
      items: [
        {
          id: "task-1",
          title: "One of many tasks",
          level: "task",
          parentChain: [{ id: "epic-1", title: "Large Epic", level: "epic" }],
        },
      ],
      epicSummaries: [
        { id: "epic-1", title: "Large Epic", completedCount: 8 },
      ],
    };

    const record = toBranchWorkRecord(result);
    expect(record.items[0].changeSignificance).toBe("minor");
  });
});

// ── cmdPrMarkdown (integration) ─────────────────────────────────────────────

describe("cmdPrMarkdown", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sv-pr-markdown-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("throws when .sourcevision directory is missing", async () => {
    await expect(cmdPrMarkdown(tmpDir)).rejects.toThrow(CLIError);
    await expect(cmdPrMarkdown(tmpDir)).rejects.toThrow(/Sourcevision directory not found/);
  });

  it("generates markdown from rex PRD data on a feature branch", async () => {
    mkdirSync(join(tmpDir, ".sourcevision"), { recursive: true });

    git(tmpDir, ["init", "-b", "main"]);
    git(tmpDir, ["config", "user.email", "test@example.com"]);
    git(tmpDir, ["config", "user.name", "Test User"]);
    writeFileSync(join(tmpDir, "base.txt"), "base\n", "utf-8");
    git(tmpDir, ["add", "."]);
    git(tmpDir, ["commit", "-m", "base"]);

    git(tmpDir, ["checkout", "-b", "feature/rex-pr"]);

    writePRD(tmpDir, [
      {
        id: "epic-1",
        title: "Auth System",
        level: "epic",
        status: "in_progress",
        children: [
          {
            id: "feature-1",
            title: "Login Flow",
            level: "feature",
            status: "in_progress",
            children: [
              {
                id: "task-1",
                title: "Implement JWT tokens",
                level: "task",
                status: "completed",
                completedAt: "2026-01-15T10:00:00.000Z",
                priority: "high",
              },
              {
                id: "task-2",
                title: "Add refresh token rotation",
                level: "task",
                status: "completed",
                completedAt: "2026-01-16T14:00:00.000Z",
              },
            ],
          },
        ],
      },
    ]);

    git(tmpDir, ["add", "."]);
    git(tmpDir, ["commit", "-m", "add rex data"]);

    await cmdPrMarkdown(tmpDir);

    const markdown = readFileSync(join(tmpDir, ".sourcevision", "pr-markdown.md"), "utf-8");

    // Rex-based content sections
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("## Completed Work");
    expect(markdown).toContain("Auth System");
    expect(markdown).toContain("**Login Flow**");
    expect(markdown).toContain("Implement JWT tokens");
    expect(markdown).toContain("Add refresh token rotation");
    expect(markdown).toContain("`feature/rex-pr`");
    expect(markdown).toContain("`main`");

    // No git-diff based sections
    expect(markdown).not.toContain("## PR Overview");
    expect(markdown).not.toContain("## Important Changes");
    expect(markdown).not.toContain("Diff footprint");
    expect(markdown).not.toContain("workstream");
    expect(markdown).not.toContain("## Modified But Unstaged Files");
    expect(markdown).not.toContain("## Untracked Files");
  });

  it("generates meaningful output when rex data is missing", async () => {
    mkdirSync(join(tmpDir, ".sourcevision"), { recursive: true });

    git(tmpDir, ["init", "-b", "main"]);
    git(tmpDir, ["config", "user.email", "test@example.com"]);
    git(tmpDir, ["config", "user.name", "Test User"]);
    writeFileSync(join(tmpDir, "base.txt"), "base\n", "utf-8");
    git(tmpDir, ["add", "."]);
    git(tmpDir, ["commit", "-m", "init"]);

    git(tmpDir, ["checkout", "-b", "feature/no-rex"]);

    await cmdPrMarkdown(tmpDir);

    const markdown = readFileSync(join(tmpDir, ".sourcevision", "pr-markdown.md"), "utf-8");
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("## Completed Work");
    expect(markdown).toContain("No completed work items on this branch.");
    expect(markdown).toContain("**Completed items:** 0");
  });

  it("works without git history (non-git directory)", async () => {
    mkdirSync(join(tmpDir, ".sourcevision"), { recursive: true });

    writePRD(tmpDir, [
      {
        id: "epic-1",
        title: "Setup",
        level: "epic",
        status: "in_progress",
        children: [
          {
            id: "feature-1",
            title: "Init",
            level: "feature",
            status: "in_progress",
            children: [
              {
                id: "task-1",
                title: "Bootstrap project",
                level: "task",
                status: "completed",
                completedAt: "2026-01-01T00:00:00.000Z",
              },
            ],
          },
        ],
      },
    ]);

    await cmdPrMarkdown(tmpDir);

    const markdown = readFileSync(join(tmpDir, ".sourcevision", "pr-markdown.md"), "utf-8");
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("## Completed Work");
    expect(markdown).toContain("Bootstrap project");
    expect(markdown).toContain("Setup");
    // Branch is "unknown" when git is unavailable
    expect(markdown).toContain("`unknown`");
  });

  it("renders epic grouping with stable ordering from PRD hierarchy", async () => {
    mkdirSync(join(tmpDir, ".sourcevision"), { recursive: true });

    git(tmpDir, ["init", "-b", "main"]);
    git(tmpDir, ["config", "user.email", "test@example.com"]);
    git(tmpDir, ["config", "user.name", "Test User"]);
    writeFileSync(join(tmpDir, "base.txt"), "base\n", "utf-8");
    git(tmpDir, ["add", "."]);
    git(tmpDir, ["commit", "-m", "base"]);
    git(tmpDir, ["checkout", "-b", "feature/multi-epic"]);

    writePRD(tmpDir, [
      {
        id: "epic-2",
        title: "Epic Zebra",
        level: "epic",
        status: "in_progress",
        children: [{
          id: "feature-2",
          title: "Feature Z",
          level: "feature",
          status: "in_progress",
          children: [
            { id: "task-2a", title: "Task Z1", level: "task", status: "completed", completedAt: "2026-01-01T00:00:00.000Z" },
            { id: "task-2b", title: "Task Z2", level: "task", status: "completed", completedAt: "2026-01-02T00:00:00.000Z" },
          ],
        }],
      },
      {
        id: "epic-1",
        title: "Epic Alpha",
        level: "epic",
        status: "in_progress",
        children: [{
          id: "feature-1",
          title: "Feature A",
          level: "feature",
          status: "in_progress",
          children: [
            { id: "task-1", title: "Task A1", level: "task", status: "completed", completedAt: "2026-01-03T00:00:00.000Z" },
          ],
        }],
      },
    ]);

    git(tmpDir, ["add", "."]);
    git(tmpDir, ["commit", "-m", "add prd"]);

    await cmdPrMarkdown(tmpDir);

    const markdown = readFileSync(join(tmpDir, ".sourcevision", "pr-markdown.md"), "utf-8");

    expect(markdown).toContain("### Epic Alpha");
    expect(markdown).toContain("### Epic Zebra");
    expect(markdown).toContain("Task A1");
    expect(markdown).toContain("Task Z1");
    expect(markdown).toContain("Task Z2");

    // Epics are sorted alphabetically by the template
    const alphaIndex = markdown.indexOf("### Epic Alpha");
    const zebraIndex = markdown.indexOf("### Epic Zebra");
    expect(alphaIndex).toBeGreaterThan(-1);
    expect(zebraIndex).toBeGreaterThan(-1);
    expect(alphaIndex).toBeLessThan(zebraIndex);

    // Stable: running again produces identical output
    await cmdPrMarkdown(tmpDir);
    const rerendered = readFileSync(join(tmpDir, ".sourcevision", "pr-markdown.md"), "utf-8");
    expect(rerendered).toBe(markdown);
  });

  it("includes epic summary table with completion counts", async () => {
    mkdirSync(join(tmpDir, ".sourcevision"), { recursive: true });

    git(tmpDir, ["init", "-b", "main"]);
    git(tmpDir, ["config", "user.email", "test@example.com"]);
    git(tmpDir, ["config", "user.name", "Test User"]);
    writeFileSync(join(tmpDir, "base.txt"), "base\n", "utf-8");
    git(tmpDir, ["add", "."]);
    git(tmpDir, ["commit", "-m", "base"]);
    git(tmpDir, ["checkout", "-b", "feature/summary"]);

    writePRD(tmpDir, [
      {
        id: "epic-1",
        title: "Core",
        level: "epic",
        status: "in_progress",
        children: [{
          id: "feature-1",
          title: "API",
          level: "feature",
          status: "in_progress",
          children: [
            { id: "t-1", title: "Endpoint A", level: "task", status: "completed", completedAt: "2026-01-01T00:00:00.000Z" },
            { id: "t-2", title: "Endpoint B", level: "task", status: "completed", completedAt: "2026-01-02T00:00:00.000Z" },
            { id: "t-3", title: "Endpoint C", level: "task", status: "pending" },
          ],
        }],
      },
    ]);

    git(tmpDir, ["add", "."]);
    git(tmpDir, ["commit", "-m", "add prd"]);

    await cmdPrMarkdown(tmpDir);

    const markdown = readFileSync(join(tmpDir, ".sourcevision", "pr-markdown.md"), "utf-8");

    // Summary section contains epic table
    expect(markdown).toContain("| Epic | Completed |");
    expect(markdown).toContain("| Core | 2 |");
    expect(markdown).toContain("**Completed items:** 2");
  });

  it("produces valid output when .rex/prd.json exists but is empty", async () => {
    mkdirSync(join(tmpDir, ".sourcevision"), { recursive: true });
    mkdirSync(join(tmpDir, ".rex"), { recursive: true });

    writeFileSync(join(tmpDir, ".rex", "prd.json"), "", "utf-8");

    await cmdPrMarkdown(tmpDir);

    const markdown = readFileSync(join(tmpDir, ".sourcevision", "pr-markdown.md"), "utf-8");
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("No completed work items on this branch.");
  });

  it("produces valid output when .rex/prd.json contains invalid JSON", async () => {
    mkdirSync(join(tmpDir, ".sourcevision"), { recursive: true });
    mkdirSync(join(tmpDir, ".rex"), { recursive: true });

    writeFileSync(join(tmpDir, ".rex", "prd.json"), "{ invalid json", "utf-8");

    await cmdPrMarkdown(tmpDir);

    const markdown = readFileSync(join(tmpDir, ".sourcevision", "pr-markdown.md"), "utf-8");
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("No completed work items on this branch.");
  });

  it("only includes branch-specific completions when diffing against base", async () => {
    mkdirSync(join(tmpDir, ".sourcevision"), { recursive: true });

    git(tmpDir, ["init", "-b", "main"]);
    git(tmpDir, ["config", "user.email", "test@example.com"]);
    git(tmpDir, ["config", "user.name", "Test User"]);

    // Base branch has one completed task
    writePRD(tmpDir, [
      {
        id: "epic-1",
        title: "Core",
        level: "epic",
        status: "in_progress",
        children: [{
          id: "feature-1",
          title: "Foundation",
          level: "feature",
          status: "in_progress",
          children: [
            { id: "task-base", title: "Base task", level: "task", status: "completed", completedAt: "2026-01-01T00:00:00.000Z" },
            { id: "task-branch", title: "Branch task", level: "task", status: "pending" },
          ],
        }],
      },
    ]);

    git(tmpDir, ["add", "."]);
    git(tmpDir, ["commit", "-m", "base with one completed task"]);

    // Feature branch adds another completion
    git(tmpDir, ["checkout", "-b", "feature/diff"]);

    writePRD(tmpDir, [
      {
        id: "epic-1",
        title: "Core",
        level: "epic",
        status: "in_progress",
        children: [{
          id: "feature-1",
          title: "Foundation",
          level: "feature",
          status: "in_progress",
          children: [
            { id: "task-base", title: "Base task", level: "task", status: "completed", completedAt: "2026-01-01T00:00:00.000Z" },
            { id: "task-branch", title: "Branch task", level: "task", status: "completed", completedAt: "2026-01-15T00:00:00.000Z" },
          ],
        }],
      },
    ]);

    git(tmpDir, ["add", "."]);
    git(tmpDir, ["commit", "-m", "complete branch task"]);

    await cmdPrMarkdown(tmpDir);

    const markdown = readFileSync(join(tmpDir, ".sourcevision", "pr-markdown.md"), "utf-8");

    // Only the branch-specific task should appear
    expect(markdown).toContain("Branch task");
    expect(markdown).not.toContain("Base task");
    expect(markdown).toContain("**Completed items:** 1");
  });
});

// ── generatePrMarkdownFile (shared core logic) ──────────────────────────────

describe("generatePrMarkdownFile", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sv-pr-gen-"));
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("writes pr-markdown.md to the specified svDir", async () => {
    const svDir = join(tmpDir, ".sourcevision");
    mkdirSync(svDir, { recursive: true });

    writePRD(tmpDir, [
      {
        id: "epic-1",
        title: "Core",
        level: "epic",
        status: "in_progress",
        children: [{
          id: "feature-1",
          title: "API",
          level: "feature",
          status: "in_progress",
          children: [
            { id: "t-1", title: "Task A", level: "task", status: "completed", completedAt: "2026-01-01T00:00:00.000Z" },
          ],
        }],
      },
    ]);

    const result = await generatePrMarkdownFile(tmpDir, svDir);

    expect(result.outputPath).toBe(join(svDir, PR_MARKDOWN_FILENAME));
    expect(result.itemCount).toBe(1);
    expect(result.warnings).toEqual([]);
    expect(existsSync(result.outputPath)).toBe(true);

    const markdown = readFileSync(result.outputPath, "utf-8");
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("Task A");
  });

  it("returns zero itemCount when no PRD exists", async () => {
    const svDir = join(tmpDir, ".sourcevision");
    mkdirSync(svDir, { recursive: true });

    const result = await generatePrMarkdownFile(tmpDir, svDir);

    expect(result.itemCount).toBe(0);
    expect(existsSync(result.outputPath)).toBe(true);

    const markdown = readFileSync(result.outputPath, "utf-8");
    expect(markdown).toContain("No completed work items on this branch.");
  });

  it("returns warnings from corrupted PRD", async () => {
    const svDir = join(tmpDir, ".sourcevision");
    mkdirSync(svDir, { recursive: true });
    mkdirSync(join(tmpDir, ".rex"), { recursive: true });
    writeFileSync(join(tmpDir, ".rex", "prd.json"), "{ broken", "utf-8");

    const result = await generatePrMarkdownFile(tmpDir, svDir);

    expect(result.itemCount).toBe(0);
    expect(result.warnings.length).toBeGreaterThanOrEqual(0);
    expect(existsSync(result.outputPath)).toBe(true);
  });

  it("overwrites existing pr-markdown.md", async () => {
    const svDir = join(tmpDir, ".sourcevision");
    mkdirSync(svDir, { recursive: true });
    const outputPath = join(svDir, PR_MARKDOWN_FILENAME);
    writeFileSync(outputPath, "old stale content", "utf-8");

    writePRD(tmpDir, [
      {
        id: "epic-1",
        title: "Fresh",
        level: "epic",
        status: "in_progress",
        children: [{
          id: "feature-1",
          title: "New Feature",
          level: "feature",
          status: "in_progress",
          children: [
            { id: "t-1", title: "New Task", level: "task", status: "completed", completedAt: "2026-01-01T00:00:00.000Z" },
          ],
        }],
      },
    ]);

    await generatePrMarkdownFile(tmpDir, svDir);

    const markdown = readFileSync(outputPath, "utf-8");
    expect(markdown).not.toContain("old stale content");
    expect(markdown).toContain("New Task");
  });
});
