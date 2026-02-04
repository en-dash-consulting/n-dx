import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildIdeasPrompt,
  reasonFromIdeasFile,
} from "../../../src/analyze/reason.js";

describe("buildIdeasPrompt", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-ideas-prompt-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("includes the brainstorming notes in the prompt", async () => {
    const prompt = await buildIdeasPrompt(
      "maybe add dark mode\nalso need better error handling\nwhat about caching?",
      [],
      tmpDir,
    );

    expect(prompt).toContain("dark mode");
    expect(prompt).toContain("better error handling");
    expect(prompt).toContain("caching");
  });

  it("is distinct from formal spec import prompts", async () => {
    const prompt = await buildIdeasPrompt(
      "rough notes here",
      [],
      tmpDir,
    );

    // Should mention brainstorming/ideas-specific language
    expect(prompt).toMatch(/[Bb]rainstorming|freeform|rough/);
    // Should instruct to capture every idea
    expect(prompt).toMatch(/[Ee]very idea|[Cc]apture/i);
  });

  it("includes existing PRD summary for dedup", async () => {
    const existing = [
      {
        id: "1",
        title: "User Authentication",
        level: "epic" as const,
        status: "pending" as const,
      },
    ];

    const prompt = await buildIdeasPrompt(
      "add login page",
      existing,
      tmpDir,
    );

    expect(prompt).toContain("User Authentication");
    expect(prompt).toContain("pending");
  });

  it("shows empty PRD indicator when no items exist", async () => {
    const prompt = await buildIdeasPrompt("ideas here", [], tmpDir);

    expect(prompt).toContain("(empty PRD)");
  });

  it("includes project context when docs exist", async () => {
    await writeFile(
      join(tmpDir, "CLAUDE.md"),
      "# MyApp\nA task management system",
    );

    const prompt = await buildIdeasPrompt("add reminders", [], tmpDir);

    expect(prompt).toContain("MyApp");
    expect(prompt).toContain("task management");
  });

  it("instructs LLM to return JSON array of proposals", async () => {
    const prompt = await buildIdeasPrompt("ideas", [], tmpDir);

    expect(prompt).toContain("JSON array");
    expect(prompt).toContain('"epic"');
    expect(prompt).toContain('"features"');
    expect(prompt).toContain('"tasks"');
  });

  it("includes few-shot example", async () => {
    const prompt = await buildIdeasPrompt("ideas", [], tmpDir);

    expect(prompt).toContain("Example output");
    expect(prompt).toContain("User Authentication");
  });

  it("includes parent constraint when provided", async () => {
    const existing = [
      {
        id: "epic-1",
        title: "Dashboard",
        level: "epic" as const,
        status: "pending" as const,
      },
    ];

    const prompt = await buildIdeasPrompt(
      "add charts and graphs",
      existing,
      tmpDir,
      { parentId: "epic-1" },
    );

    expect(prompt).toContain("Dashboard");
    expect(prompt).toContain("epic-1");
    expect(prompt).toMatch(/[Ss]cope|[Pp]arent|under/);
  });

  it("instructs LLM to handle ambiguous ideas", async () => {
    const prompt = await buildIdeasPrompt("vague ideas", [], tmpDir);

    expect(prompt).toMatch(/[Aa]mbiguous/);
  });
});

describe("reasonFromIdeasFile", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-ideas-file-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns empty proposals for zero files", async () => {
    const result = await reasonFromIdeasFile([], []);
    expect(result.proposals).toEqual([]);
    expect(result.tokenUsage.calls).toBe(0);
  });

  it("returns empty proposals when file is empty", async () => {
    const fp = join(tmpDir, "empty.txt");
    await writeFile(fp, "");

    const result = await reasonFromIdeasFile([fp], []);
    expect(result.proposals).toEqual([]);
  });

  it("returns empty proposals when file has only whitespace", async () => {
    const fp = join(tmpDir, "blank.txt");
    await writeFile(fp, "   \n  \n   ");

    const result = await reasonFromIdeasFile([fp], []);
    expect(result.proposals).toEqual([]);
  });

  it("throws on non-existent file", async () => {
    await expect(
      reasonFromIdeasFile([join(tmpDir, "nope.txt")], []),
    ).rejects.toThrow();
  });
});
