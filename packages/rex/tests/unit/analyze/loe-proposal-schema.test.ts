import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  parseProposalResponse,
  buildAddPrompt,
  PRD_SCHEMA,
  FEW_SHOT_EXAMPLE,
  CONSOLIDATION_INSTRUCTION,
} from "../../../src/analyze/reason.js";
import type { Proposal, ProposalTask } from "../../../src/analyze/propose.js";

// ── Helpers ──

/** Build a minimal valid proposal JSON with LoE fields on tasks. */
function makeProposalJsonWithLoE(): string {
  return JSON.stringify([
    {
      epic: { title: "Infrastructure" },
      features: [
        {
          title: "Caching Layer",
          description: "Add Redis-backed caching",
          tasks: [
            {
              title: "Implement cache middleware",
              description: "Add transparent caching for API responses",
              acceptanceCriteria: ["Cache hit returns 200 within 5ms"],
              priority: "high",
              tags: ["infra"],
              loe: 1.5,
              loeRationale:
                "Standard middleware pattern; main effort is cache invalidation strategy.",
              loeConfidence: "medium",
            },
            {
              title: "Configure Redis connection pooling",
              description: "Set up connection pool with health checks",
              acceptanceCriteria: ["Pool recovers from connection loss"],
              priority: "medium",
              tags: ["infra"],
              loe: 0.5,
              loeRationale: "Well-documented Redis client configuration.",
              loeConfidence: "high",
            },
          ],
        },
      ],
    },
  ]);
}

/** Build a minimal valid proposal JSON without LoE fields. */
function makeProposalJsonWithoutLoE(): string {
  return JSON.stringify([
    {
      epic: { title: "UI" },
      features: [
        {
          title: "Dark Mode",
          tasks: [
            {
              title: "Add theme toggle",
              description: "Toggle between light and dark themes",
              acceptanceCriteria: ["Toggle persists across page reloads"],
              priority: "low",
            },
          ],
        },
      ],
    },
  ]);
}

// ── Zod schema: LoE fields parse correctly ──

describe("Proposal Zod schema — LoE fields", () => {
  it("parses proposals with all three LoE fields", () => {
    const proposals = parseProposalResponse(makeProposalJsonWithLoE());

    expect(proposals).toHaveLength(1);
    const task = proposals[0].features[0].tasks[0];
    expect(task.loe).toBe(1.5);
    expect(task.loeRationale).toBe(
      "Standard middleware pattern; main effort is cache invalidation strategy.",
    );
    expect(task.loeConfidence).toBe("medium");
  });

  it("parses proposals without LoE fields (backward compatible)", () => {
    const proposals = parseProposalResponse(makeProposalJsonWithoutLoE());

    expect(proposals).toHaveLength(1);
    const task = proposals[0].features[0].tasks[0];
    expect(task.loe).toBeUndefined();
    expect(task.loeRationale).toBeUndefined();
    expect(task.loeConfidence).toBeUndefined();
    // Other fields still work
    expect(task.title).toBe("Add theme toggle");
    expect(task.priority).toBe("low");
  });

  it("parses mixed proposals (some tasks with LoE, some without)", () => {
    const json = JSON.stringify([
      {
        epic: { title: "Mixed" },
        features: [
          {
            title: "Feature A",
            tasks: [
              {
                title: "With LoE",
                loe: 2,
                loeRationale: "Estimated two weeks",
                loeConfidence: "low",
              },
              {
                title: "Without LoE",
              },
            ],
          },
        ],
      },
    ]);

    const proposals = parseProposalResponse(json);
    const tasks = proposals[0].features[0].tasks;

    expect(tasks[0].loe).toBe(2);
    expect(tasks[0].loeRationale).toBe("Estimated two weeks");
    expect(tasks[0].loeConfidence).toBe("low");
    expect(tasks[1].loe).toBeUndefined();
    expect(tasks[1].loeRationale).toBeUndefined();
    expect(tasks[1].loeConfidence).toBeUndefined();
  });

  it("rejects invalid loeConfidence values", () => {
    const json = JSON.stringify([
      {
        epic: { title: "Bad" },
        features: [
          {
            title: "Feature",
            tasks: [
              {
                title: "Invalid confidence",
                loe: 1,
                loeConfidence: "very_high", // invalid
              },
            ],
          },
        ],
      },
    ]);

    // Lenient parsing skips broken items — should still parse the epic
    // with an empty feature (since the only task is invalid) or throw
    expect(() => parseProposalResponse(json)).toThrow();
  });

  it("rejects non-positive loe values", () => {
    const json = JSON.stringify([
      {
        epic: { title: "Bad" },
        features: [
          {
            title: "Feature",
            tasks: [
              {
                title: "Zero LoE",
                loe: 0,
              },
            ],
          },
        ],
      },
    ]);

    expect(() => parseProposalResponse(json)).toThrow();
  });
});

// ── LoE round-trip through normalizeProposals ──

describe("LoE round-trip through parseProposalResponse", () => {
  it("preserves all LoE fields from LLM JSON to ProposalTask", () => {
    const proposals = parseProposalResponse(makeProposalJsonWithLoE());
    const task0 = proposals[0].features[0].tasks[0];
    const task1 = proposals[0].features[0].tasks[1];

    // First task
    expect(task0.loe).toBe(1.5);
    expect(task0.loeRationale).toContain("cache invalidation");
    expect(task0.loeConfidence).toBe("medium");
    expect(task0.source).toBe("llm");

    // Second task
    expect(task1.loe).toBe(0.5);
    expect(task1.loeRationale).toContain("Redis client");
    expect(task1.loeConfidence).toBe("high");
  });

  it("round-trips LoE fields through markdown-fenced JSON", () => {
    const raw = `\`\`\`json
${makeProposalJsonWithLoE()}
\`\`\``;

    const proposals = parseProposalResponse(raw);
    const task = proposals[0].features[0].tasks[0];
    expect(task.loe).toBe(1.5);
    expect(task.loeRationale).toBeDefined();
    expect(task.loeConfidence).toBe("medium");
  });

  it("round-trips LoE fields through prose-prefixed JSON", () => {
    const raw = `Here are the proposals:

${makeProposalJsonWithLoE()}

Hope this helps!`;

    const proposals = parseProposalResponse(raw);
    const task = proposals[0].features[0].tasks[0];
    expect(task.loe).toBe(1.5);
    expect(task.loeConfidence).toBe("medium");
  });
});

// ── Prompt content: PRD_SCHEMA includes LoE fields ──

describe("PRD_SCHEMA constant — LoE fields", () => {
  it("mentions loe field in the schema description", () => {
    expect(PRD_SCHEMA).toContain('"loe"');
  });

  it("mentions loeRationale field", () => {
    expect(PRD_SCHEMA).toContain('"loeRationale"');
  });

  it("mentions loeConfidence field with valid values", () => {
    expect(PRD_SCHEMA).toContain('"loeConfidence"');
    expect(PRD_SCHEMA).toContain('"low"');
    expect(PRD_SCHEMA).toContain('"medium"');
    expect(PRD_SCHEMA).toContain('"high"');
  });

  it("describes loe as engineer-weeks", () => {
    expect(PRD_SCHEMA).toContain("engineer-weeks");
  });
});

// ── Prompt content: FEW_SHOT_EXAMPLE includes LoE worked example ──

describe("FEW_SHOT_EXAMPLE — LoE worked example", () => {
  it("includes loe numeric values in the example", () => {
    expect(FEW_SHOT_EXAMPLE).toContain('"loe"');
    // Should have at least one concrete numeric LoE value
    expect(FEW_SHOT_EXAMPLE).toMatch(/"loe":\s*\d/);
  });

  it("includes loeRationale with substantive text", () => {
    expect(FEW_SHOT_EXAMPLE).toContain('"loeRationale"');
    // Rationale should be more than just a placeholder
    expect(FEW_SHOT_EXAMPLE).toMatch(/"loeRationale":\s*"[^"]{10,}"/);
  });

  it("includes loeConfidence with a valid value", () => {
    expect(FEW_SHOT_EXAMPLE).toMatch(/"loeConfidence":\s*"(low|medium|high)"/);
  });
});

// ── CONSOLIDATION_INSTRUCTION constant ──

describe("CONSOLIDATION_INSTRUCTION constant", () => {
  it("is a non-empty string", () => {
    expect(typeof CONSOLIDATION_INSTRUCTION).toBe("string");
    expect(CONSOLIDATION_INSTRUCTION.length).toBeGreaterThan(50);
  });

  it("instructs consolidated proposals (3–7 items)", () => {
    expect(CONSOLIDATION_INSTRUCTION).toMatch(/3.{0,3}7/);
  });

  it("discourages micro-tasks", () => {
    expect(CONSOLIDATION_INSTRUCTION).toMatch(/micro/i);
  });

  it("advises merging related findings", () => {
    expect(CONSOLIDATION_INSTRUCTION).toMatch(/[Mm]erge/);
  });
});

// ── Prompt wiring: CONSOLIDATION_INSTRUCTION appears in prompts ──

describe("Prompt wiring — consolidation and LoE in buildAddPrompt", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "rex-loe-prompt-"));
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("buildAddPrompt includes CONSOLIDATION_INSTRUCTION", async () => {
    const prompt = await buildAddPrompt("Add search feature", [], tmpDir);

    // Should contain key phrases from CONSOLIDATION_INSTRUCTION
    expect(prompt).toContain("Consolidation");
    expect(prompt).toContain("sprint-sized");
  });

  it("buildAddPrompt includes LoE schema description", async () => {
    const prompt = await buildAddPrompt("Add search feature", [], tmpDir);

    expect(prompt).toContain('"loe"');
    expect(prompt).toContain('"loeRationale"');
    expect(prompt).toContain('"loeConfidence"');
    expect(prompt).toContain("engineer-weeks");
  });

  it("buildAddPrompt includes LoE worked example", async () => {
    const prompt = await buildAddPrompt("Add search feature", [], tmpDir);

    // The FEW_SHOT_EXAMPLE with LoE values should be in the prompt
    expect(prompt).toMatch(/"loe":\s*\d/);
    expect(prompt).toMatch(/"loeRationale":\s*"/);
  });
});
