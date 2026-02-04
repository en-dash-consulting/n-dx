import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Mock spawnClaude before importing the module under test
vi.mock("../../../src/analyze/reason.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/analyze/reason.js")>();
  return {
    ...actual,
    spawnClaude: vi.fn(),
  };
});

import { clarify, generateSpecFromContext } from "../../../src/analyze/guided.js";
import type { GuidedContext } from "../../../src/analyze/guided.js";
import { spawnClaude } from "../../../src/analyze/reason.js";

const mockSpawnClaude = vi.mocked(spawnClaude);

describe("clarify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("parses a 'clarifying' response with questions", async () => {
    mockSpawnClaude.mockResolvedValue({
      text: JSON.stringify({
        status: "clarifying",
        questions: ["Who are the target users?", "What tech stack?"],
      }),
    });

    const context: GuidedContext = {
      description: "A task management app",
      exchanges: [],
    };

    const result = await clarify(context, "", "test-model");

    expect(result.status).toBe("clarifying");
    expect(result.questions).toEqual([
      "Who are the target users?",
      "What tech stack?",
    ]);
  });

  it("parses a 'ready' response with summary", async () => {
    mockSpawnClaude.mockResolvedValue({
      text: JSON.stringify({
        status: "ready",
        summary: "A React-based task manager for small teams",
      }),
    });

    const context: GuidedContext = {
      description: "A task management app",
      exchanges: [{ question: "Who are the users?", answer: "Small teams" }],
    };

    const result = await clarify(context, "", "test-model");

    expect(result.status).toBe("ready");
    expect(result.summary).toBe("A React-based task manager for small teams");
  });

  it("handles malformed LLM response gracefully by returning ready", async () => {
    mockSpawnClaude.mockResolvedValue({ text: "This is not valid JSON at all" });

    const context: GuidedContext = {
      description: "An app",
      exchanges: [],
    };

    const result = await clarify(context, "", "test-model");

    expect(result.status).toBe("ready");
  });

  it("handles markdown-fenced JSON response", async () => {
    mockSpawnClaude.mockResolvedValue({
      text: '```json\n{ "status": "clarifying", "questions": ["What framework?"] }\n```',
    });

    const context: GuidedContext = {
      description: "A web app",
      exchanges: [],
    };

    const result = await clarify(context, "", "test-model");

    expect(result.status).toBe("clarifying");
    expect(result.questions).toEqual(["What framework?"]);
  });

  it("includes previous exchanges in the prompt", async () => {
    mockSpawnClaude.mockResolvedValue({
      text: JSON.stringify({ status: "ready", summary: "Got it" }),
    });

    const context: GuidedContext = {
      description: "An e-commerce site",
      exchanges: [
        { question: "What products?", answer: "Digital downloads" },
        { question: "Payment provider?", answer: "Stripe" },
      ],
    };

    await clarify(context, "", "test-model");

    const prompt = mockSpawnClaude.mock.calls[0][0];
    expect(prompt).toContain("Digital downloads");
    expect(prompt).toContain("Stripe");
    expect(prompt).toContain("What products?");
    expect(prompt).toContain("Payment provider?");
  });

  it("includes project context in the prompt when provided", async () => {
    mockSpawnClaude.mockResolvedValue({
      text: JSON.stringify({ status: "ready", summary: "Got it" }),
    });

    const context: GuidedContext = {
      description: "An API service",
      exchanges: [],
    };

    await clarify(context, "This is a Node.js monorepo", "test-model");

    const prompt = mockSpawnClaude.mock.calls[0][0];
    expect(prompt).toContain("Node.js monorepo");
  });
});

describe("generateSpecFromContext", () => {
  let tmpDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    tmpDir = await mkdtemp(join(tmpdir(), "rex-guided-spec-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("includes description and all Q&A in the prompt", async () => {
    mockSpawnClaude.mockResolvedValue({
      text: JSON.stringify([
        {
          epic: { title: "Core" },
          features: [
            {
              title: "Auth",
              tasks: [{ title: "Implement login", description: "Login flow" }],
            },
          ],
        },
      ]),
    });

    const context: GuidedContext = {
      description: "A blog platform",
      exchanges: [
        { question: "What CMS?", answer: "Headless" },
        { question: "Auth needed?", answer: "Yes, OAuth" },
      ],
    };

    await generateSpecFromContext(context, "", "test-model");

    const prompt = mockSpawnClaude.mock.calls[0][0];
    expect(prompt).toContain("A blog platform");
    expect(prompt).toContain("What CMS?");
    expect(prompt).toContain("Headless");
    expect(prompt).toContain("Auth needed?");
    expect(prompt).toContain("Yes, OAuth");
  });

  it("returns valid ReasonResult from LLM response", async () => {
    mockSpawnClaude.mockResolvedValue({
      text: JSON.stringify([
        {
          epic: { title: "User Management" },
          features: [
            {
              title: "Registration",
              description: "User signup flow",
              tasks: [
                {
                  title: "Implement signup form",
                  description: "Build the registration page",
                  acceptanceCriteria: ["Email validation", "Password strength"],
                  priority: "high",
                },
                {
                  title: "Add email verification",
                  description: "Send verification emails",
                  priority: "medium",
                },
              ],
            },
          ],
        },
      ]),
      tokenUsage: { input: 500, output: 200 },
    });

    const context: GuidedContext = {
      description: "A SaaS platform",
      exchanges: [],
    };

    const result = await generateSpecFromContext(context, "", "test-model");

    expect(result.proposals).toHaveLength(1);
    expect(result.proposals[0].epic.title).toBe("User Management");
    expect(result.proposals[0].features).toHaveLength(1);
    expect(result.proposals[0].features[0].title).toBe("Registration");
    expect(result.proposals[0].features[0].tasks).toHaveLength(2);
    expect(result.proposals[0].features[0].tasks[0].title).toBe("Implement signup form");
    expect(result.proposals[0].features[0].tasks[0].priority).toBe("high");
    expect(result.tokenUsage.calls).toBe(1);
    expect(result.tokenUsage.inputTokens).toBe(500);
    expect(result.tokenUsage.outputTokens).toBe(200);
  });

  it("includes project context when provided", async () => {
    mockSpawnClaude.mockResolvedValue({
      text: JSON.stringify([
        {
          epic: { title: "API" },
          features: [
            { title: "Endpoints", tasks: [{ title: "Create GET /users" }] },
          ],
        },
      ]),
    });

    const context: GuidedContext = {
      description: "An API",
      exchanges: [],
    };

    await generateSpecFromContext(
      context,
      "Express.js backend with PostgreSQL",
      "test-model",
    );

    const prompt = mockSpawnClaude.mock.calls[0][0];
    expect(prompt).toContain("Express.js backend with PostgreSQL");
  });

  it("includes few-shot example in the prompt", async () => {
    mockSpawnClaude.mockResolvedValue({
      text: JSON.stringify([
        {
          epic: { title: "Test" },
          features: [{ title: "F", tasks: [{ title: "T" }] }],
        },
      ]),
    });

    const context: GuidedContext = {
      description: "Anything",
      exchanges: [],
    };

    await generateSpecFromContext(context, "", "test-model");

    const prompt = mockSpawnClaude.mock.calls[0][0];
    expect(prompt).toContain("Example output");
    expect(prompt).toContain("User Authentication");
  });
});
