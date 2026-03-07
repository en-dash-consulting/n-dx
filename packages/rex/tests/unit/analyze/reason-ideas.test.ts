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
    // Should NOT use formal spec language like "Read the following document"
    expect(prompt).not.toContain("Read the following document");
    expect(prompt).not.toContain("Document to analyze");
    // Should reference notes-specific concepts
    expect(prompt).toContain("Brainstorming notes");
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

    // Should mention ambiguity handling
    expect(prompt).toMatch(/[Aa]mbiguous/);
    // Should instruct to note assumptions for unclear ideas
    expect(prompt).toMatch(/[Aa]ssum/);
  });

  it("instructs LLM to handle questions as feature requests", async () => {
    const prompt = await buildIdeasPrompt("what about dark mode?", [], tmpDir);

    expect(prompt).toMatch(/[Qq]uestions/);
    expect(prompt).toMatch(/feature request/i);
  });

  it("instructs LLM to expand shorthand and abbreviations", async () => {
    const prompt = await buildIdeasPrompt("auth perf caching", [], tmpDir);

    expect(prompt).toMatch(/[Ss]horthand|[Aa]bbreviation/);
  });

  it("instructs LLM to handle contradictory notes", async () => {
    const prompt = await buildIdeasPrompt("use Redis; no external deps", [], tmpDir);

    expect(prompt).toMatch(/[Cc]ontradictory/);
  });

  it("instructs LLM to turn problems into investigative tasks", async () => {
    const prompt = await buildIdeasPrompt("login is slow", [], tmpDir);

    expect(prompt).toMatch(/problem|investigat/i);
  });

  it("instructs LLM to flesh out vague ideas into concrete tasks", async () => {
    const prompt = await buildIdeasPrompt("make it better", [], tmpDir);

    expect(prompt).toMatch(/[Vv]ague/);
    expect(prompt).toMatch(/concrete|actionable|flesh/i);
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

  describe("markdown local extraction (no LLM)", () => {
    it("parses well-structured markdown files locally without LLM", async () => {
      const fp = join(tmpDir, "requirements.md");
      await writeFile(
        fp,
        `# User Authentication
## Login Flow
- Implement email/password login
- Add OAuth2 support

## Password Reset
- Build reset request form
- Send reset email
`,
      );

      const result = await reasonFromIdeasFile([fp], []);
      expect(result.proposals.length).toBeGreaterThan(0);
      expect(result.tokenUsage.calls).toBe(0);

      const epic = result.proposals[0].epic;
      expect(epic.title).toBe("User Authentication");
    });

    it("extracts headers as epic/feature titles", async () => {
      const fp = join(tmpDir, "spec.md");
      await writeFile(
        fp,
        `# Dashboard
## Analytics Panel
- Display charts
- Filter by date

## User Settings
- Edit profile
- Change password
`,
      );

      const result = await reasonFromIdeasFile([fp], []);
      expect(result.tokenUsage.calls).toBe(0);

      const epicTitles = result.proposals.map((p) => p.epic.title);
      expect(epicTitles).toContain("Dashboard");

      const featureTitles = result.proposals.flatMap((p) =>
        p.features.map((f) => f.title),
      );
      expect(featureTitles).toContain("Analytics Panel");
      expect(featureTitles).toContain("User Settings");
    });

    it("extracts bullets as tasks", async () => {
      const fp = join(tmpDir, "tasks.md");
      await writeFile(
        fp,
        `# Project
## Feature A
- Implement login form
- Add form validation
- Handle error states
`,
      );

      const result = await reasonFromIdeasFile([fp], []);
      expect(result.tokenUsage.calls).toBe(0);

      const taskTitles = result.proposals.flatMap((p) =>
        p.features.flatMap((f) => f.tasks.map((t) => t.title)),
      );
      expect(taskTitles).toEqual([
        "Implement login form",
        "Add form validation",
        "Handle error states",
      ]);
    });

    it("extracts numbered list items as tasks", async () => {
      const fp = join(tmpDir, "numbered.md");
      await writeFile(
        fp,
        `# Project
## Feature
1. Set up database schema
2. Create API endpoints
3. Write integration tests
`,
      );

      const result = await reasonFromIdeasFile([fp], []);
      expect(result.tokenUsage.calls).toBe(0);

      const taskTitles = result.proposals.flatMap((p) =>
        p.features.flatMap((f) => f.tasks.map((t) => t.title)),
      );
      expect(taskTitles).toEqual([
        "Set up database schema",
        "Create API endpoints",
        "Write integration tests",
      ]);
    });

    it("extracts bullets under task headings as acceptance criteria", async () => {
      const fp = join(tmpDir, "ac.md");
      await writeFile(
        fp,
        `# Epic
## Feature
### Implement rate limiting
- Returns 429 when limit exceeded
- Configurable per-route limits
- Supports IP-based limiting
`,
      );

      const result = await reasonFromIdeasFile([fp], []);
      expect(result.tokenUsage.calls).toBe(0);

      const task = result.proposals[0].features[0].tasks[0];
      expect(task.title).toBe("Implement rate limiting");
      expect(task.acceptanceCriteria).toEqual([
        "Returns 429 when limit exceeded",
        "Configurable per-route limits",
        "Supports IP-based limiting",
      ]);
    });

    it("deduplicates against existing PRD items", async () => {
      const fp = join(tmpDir, "dedup.md");
      await writeFile(
        fp,
        `# Project
## Feature A
- Implement login
- Add caching
`,
      );

      const existing = [
        {
          id: "1",
          title: "Implement login",
          level: "task" as const,
          status: "completed" as const,
        },
      ];

      const result = await reasonFromIdeasFile([fp], existing);
      expect(result.tokenUsage.calls).toBe(0);

      const taskTitles = result.proposals.flatMap((p) =>
        p.features.flatMap((f) => f.tasks.map((t) => t.title)),
      );
      expect(taskTitles).toEqual(["Add caching"]);
    });

    it("sets source to file-import on extracted items", async () => {
      const fp = join(tmpDir, "source.md");
      await writeFile(
        fp,
        `# Epic
## Feature
- Task
`,
      );

      const result = await reasonFromIdeasFile([fp], []);
      expect(result.tokenUsage.calls).toBe(0);

      expect(result.proposals[0].epic.source).toBe("file-import");
      expect(result.proposals[0].features[0].source).toBe("file-import");
      expect(result.proposals[0].features[0].tasks[0].source).toBe(
        "file-import",
      );
    });

    it("handles multiple markdown files with local extraction", async () => {
      const fp1 = join(tmpDir, "auth.md");
      const fp2 = join(tmpDir, "billing.md");
      await writeFile(
        fp1,
        `# Authentication
## Login
- Build login form
`,
      );
      await writeFile(
        fp2,
        `# Billing
## Payments
- Integrate Stripe
`,
      );

      const result = await reasonFromIdeasFile([fp1, fp2], []);
      expect(result.tokenUsage.calls).toBe(0);

      const epicTitles = result.proposals.map((p) => p.epic.title);
      expect(epicTitles).toContain("Authentication");
      expect(epicTitles).toContain("Billing");
    });

    it("handles JSON files with structured parsing (no LLM)", async () => {
      const fp = join(tmpDir, "items.json");
      await writeFile(
        fp,
        JSON.stringify([
          {
            epic: { title: "Auth" },
            features: [
              {
                title: "Login",
                tasks: [{ title: "Build form" }],
              },
            ],
          },
        ]),
      );

      const result = await reasonFromIdeasFile([fp], []);
      expect(result.tokenUsage.calls).toBe(0);
      expect(result.proposals.length).toBeGreaterThan(0);
    });

    it("handles YAML files with structured parsing (no LLM)", async () => {
      const fp = join(tmpDir, "items.yaml");
      await writeFile(
        fp,
        `title: Authentication
description: User auth system
title: Dashboard
description: Main dashboard
`,
      );

      const result = await reasonFromIdeasFile([fp], []);
      expect(result.tokenUsage.calls).toBe(0);
      expect(result.proposals.length).toBeGreaterThan(0);
    });
  });
});
