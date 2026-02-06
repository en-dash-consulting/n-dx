import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { writeFile, mkdtemp, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseProposalResponse,
  buildAddPrompt,
} from "../../../src/analyze/reason.js";

describe("buildAddPrompt", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-add-prompt-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("includes the user description in the prompt", async () => {
    const prompt = await buildAddPrompt(
      "Add user authentication with OAuth2",
      [],
      tmpDir,
    );

    expect(prompt).toContain("Add user authentication with OAuth2");
  });

  it("includes existing PRD summary when items exist", async () => {
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

    const prompt = await buildAddPrompt("Add caching", existing, tmpDir);

    expect(prompt).toContain("API Gateway");
    expect(prompt).toContain("Rate Limiting");
    expect(prompt).toContain("pending");
    expect(prompt).toContain("in_progress");
  });

  it("shows empty PRD indicator when no items exist", async () => {
    const prompt = await buildAddPrompt("Add auth", [], tmpDir);

    expect(prompt).toContain("(empty PRD)");
  });

  it("includes project context when docs exist", async () => {
    await writeFile(
      join(tmpDir, "CLAUDE.md"),
      "# MyProject\nThis is a billing system",
    );

    const prompt = await buildAddPrompt("Add invoices", [], tmpDir);

    expect(prompt).toContain("MyProject");
    expect(prompt).toContain("billing system");
  });

  it("instructs LLM to return JSON array of proposals", async () => {
    const prompt = await buildAddPrompt("Add feature X", [], tmpDir);

    expect(prompt).toContain("JSON array");
    expect(prompt).toContain('"epic"');
    expect(prompt).toContain('"features"');
    expect(prompt).toContain('"tasks"');
  });

  it("includes few-shot example in prompt", async () => {
    const prompt = await buildAddPrompt("Add feature X", [], tmpDir);

    expect(prompt).toContain("Example output");
    expect(prompt).toContain("User Authentication");
    expect(prompt).toContain("acceptanceCriteria");
  });

  it("includes quality guidance about task descriptions", async () => {
    const prompt = await buildAddPrompt("Add feature X", [], tmpDir);

    expect(prompt).toMatch(/description|acceptanceCriteria/);
    expect(prompt).toMatch(/actionable/);
    // Should guide on description quality — explain the "why", not restate the title
    expect(prompt).toMatch(/why/i);
    expect(prompt).toMatch(/outcome/i);
    // Should guide on verifiable acceptance criteria
    expect(prompt).toMatch(/verifiable/i);
  });

  it("instructs LLM to avoid duplicates against existing PRD", async () => {
    const prompt = await buildAddPrompt("Add feature X", [], tmpDir);

    expect(prompt).toMatch(/[Dd]o NOT include items that duplicate/);
  });

  it("instructs LLM to avoid duplicates within generated output", async () => {
    const prompt = await buildAddPrompt("Add feature X", [], tmpDir);

    // Should instruct to merge overlapping tasks within its own response
    expect(prompt).toMatch(/duplicate tasks within/i);
    expect(prompt).toMatch(/merge/i);
  });

  it("instructs LLM to create multiple epics for broad descriptions", async () => {
    const prompt = await buildAddPrompt(
      "Overhaul the frontend and backend architecture",
      [],
      tmpDir,
    );

    // Should guide the LLM to produce multiple epics when description is broad
    expect(prompt).toMatch(/multiple epics/i);
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

    const prompt = await buildAddPrompt(
      "Add login flow",
      existing,
      tmpDir,
      { parentId: "epic-1" },
    );

    expect(prompt).toContain("Auth");
    expect(prompt).toContain("epic-1");
    // Should instruct LLM to scope within parent
    expect(prompt).toMatch(/[Ss]cope|[Pp]arent|under/);
  });
});

describe("parseProposalResponse for add command", () => {
  it("parses a single-epic response with features and tasks", () => {
    const json = JSON.stringify([
      {
        epic: { title: "User Authentication" },
        features: [
          {
            title: "OAuth2 Integration",
            description: "Support Google and GitHub OAuth",
            tasks: [
              {
                title: "Set up OAuth2 provider config",
                description: "Create provider configuration for Google and GitHub",
                acceptanceCriteria: [
                  "Google OAuth works end-to-end",
                  "GitHub OAuth works end-to-end",
                ],
                priority: "high",
              },
              {
                title: "Implement callback handlers",
                priority: "high",
              },
              {
                title: "Add token refresh logic",
                priority: "medium",
              },
            ],
          },
          {
            title: "Session Management",
            tasks: [
              {
                title: "Implement JWT tokens",
                priority: "high",
              },
            ],
          },
        ],
      },
    ]);

    const proposals = parseProposalResponse(json);

    expect(proposals).toHaveLength(1);
    expect(proposals[0].epic.title).toBe("User Authentication");
    expect(proposals[0].features).toHaveLength(2);
    expect(proposals[0].features[0].title).toBe("OAuth2 Integration");
    expect(proposals[0].features[0].tasks).toHaveLength(3);
    expect(proposals[0].features[1].title).toBe("Session Management");
  });

  it("handles response with multiple epics for broader descriptions", () => {
    const json = JSON.stringify([
      {
        epic: { title: "Frontend" },
        features: [{ title: "Dark Mode", tasks: [] }],
      },
      {
        epic: { title: "Backend" },
        features: [{ title: "API Versioning", tasks: [] }],
      },
    ]);

    const proposals = parseProposalResponse(json);

    expect(proposals).toHaveLength(2);
  });
});
