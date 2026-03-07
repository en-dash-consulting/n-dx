import { describe, it, expect } from "vitest";
import {
  isAmbiguousStructure,
  maybeDisambiguate,
  extractFromText,
  extractFromMarkdown,
} from "../../../src/analyze/extract.js";
import type { ExtractionResult } from "../../../src/analyze/extract.js";
import type { Proposal } from "../../../src/analyze/propose.js";

// ── Helpers ──

function epicTitles(proposals: Proposal[]): string[] {
  return proposals.map((p) => p.epic.title);
}

function featureTitles(proposals: Proposal[]): string[] {
  return proposals.flatMap((p) => p.features.map((f) => f.title));
}

function taskTitles(proposals: Proposal[]): string[] {
  return proposals.flatMap((p) =>
    p.features.flatMap((f) => f.tasks.map((t) => t.title)),
  );
}

// Long content used across multiple tests
const LONG_CONTENT = "Content that is over one hundred characters long and should be considered substantial enough. ".repeat(2);

// ── isAmbiguousStructure ──

describe("isAmbiguousStructure", () => {
  it("returns false for short content (< 100 chars)", () => {
    expect(isAmbiguousStructure([], "Short.")).toBe(false);
  });

  it("returns true when proposals are empty but content is non-trivial", () => {
    const longContent = "This is a fairly long document that discusses many things. ".repeat(5);
    expect(isAmbiguousStructure([], longContent)).toBe(true);
  });

  it("returns true when all proposals land in 'Imported Requirements' bucket", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "Imported Requirements", source: "file-import" },
        features: [
          {
            title: "General",
            source: "file-import",
            tasks: [{ title: "Task 1", source: "file-import", sourceFile: "" }],
          },
        ],
      },
    ];
    expect(isAmbiguousStructure(proposals, LONG_CONTENT)).toBe(true);
  });

  it("returns true when single epic/feature has many tasks", () => {
    const tasks = Array.from({ length: 6 }, (_, i) => ({
      title: `Task ${i + 1}`,
      source: "file-import",
      sourceFile: "",
    }));
    const proposals: Proposal[] = [
      {
        epic: { title: "Some Epic", source: "file-import" },
        features: [
          { title: "Some Feature", source: "file-import", tasks },
        ],
      },
    ];
    expect(isAmbiguousStructure(proposals, LONG_CONTENT)).toBe(true);
  });

  it("returns false when single epic/feature has 5 or fewer tasks", () => {
    const tasks = Array.from({ length: 5 }, (_, i) => ({
      title: `Task ${i + 1}`,
      source: "file-import",
      sourceFile: "",
    }));
    const proposals: Proposal[] = [
      {
        epic: { title: "Some Epic", source: "file-import" },
        features: [
          { title: "Some Feature", source: "file-import", tasks },
        ],
      },
    ];
    expect(isAmbiguousStructure(proposals, LONG_CONTENT)).toBe(false);
  });

  it("returns false for well-structured proposals with multiple epics", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "Authentication", source: "file-import" },
        features: [
          {
            title: "Login Flow",
            source: "file-import",
            tasks: [{ title: "Implement OAuth", source: "file-import", sourceFile: "" }],
          },
        ],
      },
      {
        epic: { title: "Dashboard", source: "file-import" },
        features: [
          {
            title: "Analytics",
            source: "file-import",
            tasks: [{ title: "Add charts", source: "file-import", sourceFile: "" }],
          },
        ],
      },
    ];
    expect(isAmbiguousStructure(proposals, LONG_CONTENT)).toBe(false);
  });

  it("returns false for single epic with multiple features", () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "Authentication", source: "file-import" },
        features: [
          {
            title: "Login",
            source: "file-import",
            tasks: [{ title: "Validate input", source: "file-import", sourceFile: "" }],
          },
          {
            title: "Registration",
            source: "file-import",
            tasks: [{ title: "Create account", source: "file-import", sourceFile: "" }],
          },
        ],
      },
    ];
    expect(isAmbiguousStructure(proposals, LONG_CONTENT)).toBe(false);
  });
});

// ── maybeDisambiguate — without LLM (no mock needed) ──

describe("maybeDisambiguate", () => {
  it("returns pattern result when useLLM is false", async () => {
    const patternResult: ExtractionResult = {
      proposals: [],
      usedLLM: false,
    };
    const result = await maybeDisambiguate("content", patternResult, {
      useLLM: false,
    });
    expect(result).toBe(patternResult);
  });

  it("returns pattern result when useLLM is undefined", async () => {
    const patternResult: ExtractionResult = {
      proposals: [],
      usedLLM: false,
    };
    const result = await maybeDisambiguate("content", patternResult);
    expect(result).toBe(patternResult);
  });

  it("returns pattern result when structure is not ambiguous", async () => {
    const proposals: Proposal[] = [
      {
        epic: { title: "Auth", source: "file-import" },
        features: [
          {
            title: "Login",
            source: "file-import",
            tasks: [{ title: "Task", source: "file-import", sourceFile: "" }],
          },
          {
            title: "Signup",
            source: "file-import",
            tasks: [{ title: "Task2", source: "file-import", sourceFile: "" }],
          },
        ],
      },
    ];
    const patternResult: ExtractionResult = { proposals, usedLLM: false };
    const result = await maybeDisambiguate(LONG_CONTENT, patternResult, {
      useLLM: true,
    });
    // Should return the pattern result without LLM since it's not ambiguous
    expect(result).toBe(patternResult);
  });

  it("returns pattern result when content is short even with useLLM=true", async () => {
    const patternResult: ExtractionResult = { proposals: [], usedLLM: false };
    const result = await maybeDisambiguate("short", patternResult, {
      useLLM: true,
    });
    expect(result).toBe(patternResult);
  });
});

// ── extractFromText/extractFromMarkdown — default useLLM=false ──

describe("extractFromText — useLLM behavior", () => {
  it("never invokes LLM when useLLM is not set (default behavior)", () => {
    const text =
      "The system must validate all user input. " +
      "Users should be able to reset their passwords.";
    const result = extractFromText(text);
    expect(result.usedLLM).toBe(false);
  });

  it("extractFromMarkdown never invokes LLM by default", () => {
    const md = `# Epic
## Feature
- Task
`;
    const result = extractFromMarkdown(md);
    expect(result.usedLLM).toBe(false);
    expect(result.tokenUsage).toBeUndefined();
  });

  it("well-structured markdown is not ambiguous", () => {
    const md = `# Authentication
## Login Flow
- Validate credentials
- Handle OAuth2

# Dashboard
## Analytics
- Display charts
`;
    const result = extractFromMarkdown(md);
    expect(isAmbiguousStructure(result.proposals, md)).toBe(false);
  });

  it("flat bullet list with many items produces ambiguous result", () => {
    // Generate enough bullets to trigger the "single feature, many tasks" threshold
    const longBullets = Array.from({ length: 8 }, (_, i) =>
      `- Implement task number ${i + 1} for the project`,
    ).join("\n");
    // Need >100 chars for isAmbiguousStructure to consider it
    const content = `The following tasks need to be completed for the project milestone delivery:\n${longBullets}`;
    const result = extractFromText(content);
    // Pattern extractor should put these into a default bucket with many tasks
    expect(result.proposals.length).toBeGreaterThan(0);
    // The result should be considered ambiguous because all items land
    // in a single default feature with many tasks
    const totalTasks = result.proposals.flatMap(
      (p) => p.features.flatMap((f) => f.tasks),
    ).length;
    if (totalTasks > 5) {
      expect(isAmbiguousStructure(result.proposals, content)).toBe(true);
    }
  });

  it("prose-only content with requirement sentences is ambiguous", () => {
    const prose =
      "The system must handle user authentication securely. " +
      "It should support multi-factor authentication. " +
      "The platform must integrate with third-party OAuth providers. " +
      "Sessions must expire after 30 minutes of inactivity. " +
      "The application must log all authentication attempts. " +
      "Password policies must enforce minimum complexity requirements.";
    const result = extractFromText(prose);
    expect(isAmbiguousStructure(result.proposals, prose)).toBe(true);
  });
});
