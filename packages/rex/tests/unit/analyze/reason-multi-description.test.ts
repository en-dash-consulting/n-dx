import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildMultiAddPrompt,
  reasonFromDescriptions,
} from "../../../src/analyze/reason.js";

describe("buildMultiAddPrompt", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-multi-prompt-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("includes all descriptions in the prompt", async () => {
    const prompt = await buildMultiAddPrompt(
      [
        "Add user authentication with OAuth2",
        "Build an admin dashboard",
        "Implement rate limiting",
      ],
      [],
      tmpDir,
    );

    expect(prompt).toContain("Add user authentication with OAuth2");
    expect(prompt).toContain("Build an admin dashboard");
    expect(prompt).toContain("Implement rate limiting");
  });

  it("numbers the descriptions", async () => {
    const prompt = await buildMultiAddPrompt(
      ["First idea", "Second idea"],
      [],
      tmpDir,
    );

    expect(prompt).toContain("1. First idea");
    expect(prompt).toContain("2. Second idea");
  });

  it("mentions the description count", async () => {
    const prompt = await buildMultiAddPrompt(
      ["Desc A", "Desc B", "Desc C"],
      [],
      tmpDir,
    );

    expect(prompt).toContain("3 separate descriptions");
  });

  it("instructs LLM to group related and separate unrelated", async () => {
    const prompt = await buildMultiAddPrompt(
      ["Add login", "Add signup"],
      [],
      tmpDir,
    );

    expect(prompt).toMatch(/[Gg]roup related/);
    expect(prompt).toMatch(/separate epics/i);
  });

  it("instructs LLM to avoid cross-description duplicates", async () => {
    const prompt = await buildMultiAddPrompt(
      ["Add auth", "Add login"],
      [],
      tmpDir,
    );

    expect(prompt).toMatch(/[Dd]uplicate/);
    expect(prompt).toMatch(/merge/i);
  });

  it("includes existing PRD summary for dedup", async () => {
    const existing = [
      {
        id: "1",
        title: "API Gateway",
        level: "epic" as const,
        status: "pending" as const,
        children: [
          {
            id: "2",
            title: "Rate Limiting",
            level: "feature" as const,
            status: "in_progress" as const,
          },
        ],
      },
    ];

    const prompt = await buildMultiAddPrompt(
      ["Add caching", "Add logging"],
      existing,
      tmpDir,
    );

    expect(prompt).toContain("API Gateway");
    expect(prompt).toContain("Rate Limiting");
  });

  it("shows empty PRD indicator when no items exist", async () => {
    const prompt = await buildMultiAddPrompt(["Add auth"], [], tmpDir);

    expect(prompt).toContain("(empty PRD)");
  });

  it("includes project context when docs exist", async () => {
    await writeFile(
      join(tmpDir, "CLAUDE.md"),
      "# MyProject\nThis is a billing system",
    );

    const prompt = await buildMultiAddPrompt(
      ["Add invoices"],
      [],
      tmpDir,
    );

    expect(prompt).toContain("MyProject");
    expect(prompt).toContain("billing system");
  });

  it("instructs LLM to return JSON array of proposals", async () => {
    const prompt = await buildMultiAddPrompt(
      ["Add feature X"],
      [],
      tmpDir,
    );

    expect(prompt).toContain("JSON array");
    expect(prompt).toContain('"epic"');
    expect(prompt).toContain('"features"');
    expect(prompt).toContain('"tasks"');
  });

  it("includes few-shot example in prompt", async () => {
    const prompt = await buildMultiAddPrompt(
      ["Add feature X"],
      [],
      tmpDir,
    );

    expect(prompt).toContain("Example output");
    expect(prompt).toContain("User Authentication");
    expect(prompt).toContain("acceptanceCriteria");
  });

  it("includes parent constraint when provided", async () => {
    const existing = [
      {
        id: "epic-1",
        title: "Auth",
        level: "epic" as const,
        status: "pending" as const,
      },
    ];

    const prompt = await buildMultiAddPrompt(
      ["Add login flow", "Add password reset"],
      existing,
      tmpDir,
      { parentId: "epic-1" },
    );

    expect(prompt).toContain("Auth");
    expect(prompt).toContain("epic-1");
    expect(prompt).toMatch(/[Ss]cope|[Pp]arent|under/);
  });
});

describe("reasonFromDescriptions", () => {
  it("returns empty proposals for zero descriptions", async () => {
    const result = await reasonFromDescriptions([], []);
    expect(result.proposals).toEqual([]);
    expect(result.tokenUsage.calls).toBe(0);
  });
});
