import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cmdPrMarkdown } from "../../src/cli/commands/pr-markdown.js";

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

describe("pr-markdown rex-based output", () => {
  let tmpDir: string;

  afterEach(() => {
    vi.restoreAllMocks();
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
  });

  it("renders completed work items grouped by epic without file/line enumerations", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "sv-pr-markdown-integration-"));
    vi.spyOn(console, "log").mockImplementation(() => {});

    mkdirSync(join(tmpDir, ".sourcevision"), { recursive: true });

    git(tmpDir, ["init", "-b", "main"]);
    git(tmpDir, ["config", "user.email", "test@example.com"]);
    git(tmpDir, ["config", "user.name", "Test User"]);
    writeFileSync(join(tmpDir, "base.txt"), "base\n", "utf-8");
    git(tmpDir, ["add", "."]);
    git(tmpDir, ["commit", "-m", "base"]);

    git(tmpDir, ["checkout", "-b", "feature/reviewer-first-pr-markdown"]);

    writePRD(tmpDir, [
      {
        id: "epic-1",
        title: "API Improvements",
        level: "epic",
        status: "in_progress",
        children: [{
          id: "feature-1",
          title: "Profile Endpoint",
          level: "feature",
          status: "in_progress",
          children: [
            {
              id: "task-1",
              title: "Add v2 fetch with conditional logic",
              level: "task",
              status: "completed",
              completedAt: "2026-01-15T10:00:00.000Z",
              description: "Updated fetchProfile to support v2 responses",
            },
          ],
        }],
      },
      {
        id: "epic-2",
        title: "Infrastructure",
        level: "epic",
        status: "in_progress",
        children: [{
          id: "feature-2",
          title: "Workstream Setup",
          level: "feature",
          status: "in_progress",
          children: [
            { id: "task-2", title: "Configure alpha package", level: "task", status: "completed", completedAt: "2026-01-15T11:00:00.000Z" },
            { id: "task-3", title: "Configure beta package", level: "task", status: "completed", completedAt: "2026-01-15T12:00:00.000Z" },
          ],
        }],
      },
    ]);

    git(tmpDir, ["add", "."]);
    git(tmpDir, ["commit", "-m", "mixed workstream updates"]);

    await cmdPrMarkdown(tmpDir);

    const markdown = readFileSync(join(tmpDir, ".sourcevision", "pr-markdown.md"), "utf-8");

    // Rex-based output contains structured work items
    expect(markdown).toContain("## Summary");
    expect(markdown).toContain("## Completed Work");
    expect(markdown).toContain("### API Improvements");
    expect(markdown).toContain("### Infrastructure");
    expect(markdown).toContain("Add v2 fetch with conditional logic");
    expect(markdown).toContain("Configure alpha package");
    expect(markdown).toContain("Configure beta package");

    // Guard against noisy file-by-file or line-count summaries
    expect(markdown).not.toContain("## Scope of Work");
    expect(markdown).not.toContain("## Notable Changes");
    expect(markdown).not.toContain("## Workstream Breakdown");
    expect(markdown).not.toContain("| Status | Path | + | - |");
    expect(markdown).not.toMatch(/^- `[^`]+`: \d+ file\(s\), \+\d+ \/ -\d+/m);
  });

  it("produces deterministic output regardless of git config or working tree state", async () => {
    tmpDir = mkdtempSync(join(tmpdir(), "sv-pr-markdown-integration-"));
    vi.spyOn(console, "log").mockImplementation(() => {});

    mkdirSync(join(tmpDir, ".sourcevision"), { recursive: true });

    git(tmpDir, ["init", "-b", "main"]);
    git(tmpDir, ["config", "user.email", "test@example.com"]);
    git(tmpDir, ["config", "user.name", "Test User"]);
    writeFileSync(join(tmpDir, "base.txt"), "base\n", "utf-8");
    git(tmpDir, ["add", "."]);
    git(tmpDir, ["commit", "-m", "base"]);

    git(tmpDir, ["checkout", "-b", "feature/deterministic-diff"]);

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
            { id: "task-1", title: "Initial setup", level: "task", status: "completed", completedAt: "2026-01-01T00:00:00.000Z" },
          ],
        }],
      },
    ]);

    git(tmpDir, ["add", "."]);
    git(tmpDir, ["commit", "-m", "feature update"]);

    await cmdPrMarkdown(tmpDir);
    const baselineMarkdown = readFileSync(join(tmpDir, ".sourcevision", "pr-markdown.md"), "utf-8");

    // Configure external diff tools that would break git-diff-based generation
    git(tmpDir, ["config", "diff.external", "/usr/bin/false"]);

    // Regenerate — should produce identical output since we use rex data, not git diff
    await cmdPrMarkdown(tmpDir);
    const deterministicMarkdown = readFileSync(join(tmpDir, ".sourcevision", "pr-markdown.md"), "utf-8");

    expect(deterministicMarkdown).toBe(baselineMarkdown);
  });
});
