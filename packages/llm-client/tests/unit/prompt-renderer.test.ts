/**
 * Unit tests for the verbosity-aware prompt renderer.
 *
 * Coverage:
 * - Compact rendering (conditional sections stripped, auto-transforms applied)
 * - Verbose rendering (conditional sections unwrapped, no transforms)
 * - Template parameter substitution
 * - Edge cases: empty template, all-parameter template, unrecognised params
 * - Token count reduced ≥20% on a representative sample of 10 prompt templates
 */

import { describe, it, expect } from "vitest";
import {
  renderPrompt,
  applyCompactStyle,
  estimateTokenCount,
} from "../../src/prompt-renderer.js";
import type { PromptVerbosity } from "../../src/prompt-renderer.js";

// ── Helpers ───────────────────────────────────────────────────────────────────

function tokenReduction(verbose: string, compact: string): number {
  const vt = estimateTokenCount(verbose);
  const ct = estimateTokenCount(compact);
  return vt > 0 ? (vt - ct) / vt : 0;
}

// ── Compact rendering ─────────────────────────────────────────────────────────

describe("renderPrompt — compact mode", () => {
  it("strips {{verbose}} blocks entirely", () => {
    const template = "Core instruction.{{verbose}}\n\nExtended rationale.{{/verbose}}";
    const result = renderPrompt(template, { verbosity: "compact" });
    expect(result).toBe("Core instruction.");
    expect(result).not.toContain("Extended rationale");
    expect(result).not.toContain("{{verbose}}");
    expect(result).not.toContain("{{/verbose}}");
  });

  it("retains {{compact}} block content in compact mode", () => {
    const template = "Shared.{{compact}} Concise note.{{/compact}}";
    const result = renderPrompt(template, { verbosity: "compact" });
    expect(result).toContain("Concise note.");
    expect(result).not.toContain("{{compact}}");
  });

  it("strips {{compact}} markers but keeps nested content", () => {
    const template = "{{compact}}A{{/compact}}B";
    const result = renderPrompt(template, { verbosity: "compact" });
    expect(result).toBe("AB");
  });

  it("handles multiple {{verbose}} blocks in one template", () => {
    const template =
      "Step 1.{{verbose}}\nDetail A.{{/verbose}} Step 2.{{verbose}}\nDetail B.{{/verbose}} Step 3.";
    const result = renderPrompt(template, { verbosity: "compact" });
    expect(result).toBe("Step 1. Step 2. Step 3.");
    expect(result).not.toContain("Detail");
  });

  it("applies 'You are a/an' → 'You:' transform", () => {
    const result = renderPrompt("You are a PRD analyst.", { verbosity: "compact" });
    expect(result).toBe("You: PRD analyst.");
  });

  it("applies 'in order to' → 'to' transform", () => {
    const result = renderPrompt("Do this in order to ensure quality.", { verbosity: "compact" });
    expect(result).toBe("Do this to ensure quality.");
  });

  it("applies 'so that' → 'for' transform", () => {
    const result = renderPrompt("Configure it so that the agent can proceed.", { verbosity: "compact" });
    expect(result).toBe("Configure it for the agent can proceed.");
  });

  it("applies 'Respond with ONLY' → 'Output:' transform", () => {
    const result = renderPrompt(
      "Respond with ONLY a valid JSON array. No explanation, no markdown fences.",
      { verbosity: "compact" },
    );
    // "Respond with ONLY " is replaced by "Output: "
    expect(result).toContain("Output:");
    expect(result).not.toContain("Respond with ONLY");
    // ", no markdown fences" is stripped by the companion transform
    expect(result).not.toContain("no markdown fences");
  });

  it("strips ', no markdown fences, no commentary — just the JSON'", () => {
    const result = renderPrompt(
      "Return valid JSON. No explanation, no markdown fences, no commentary — just the JSON.",
      { verbosity: "compact" },
    );
    expect(result).not.toContain("no markdown fences");
    expect(result).not.toContain("just the JSON");
  });

  it("strips 'Please make sure that' preamble", () => {
    const result = renderPrompt(
      "Please make sure that all tasks have titles.",
      { verbosity: "compact" },
    );
    expect(result).not.toContain("Please make sure that");
    expect(result).toContain("all tasks have titles");
  });

  it("does not transform content inside backtick code spans", () => {
    const result = renderPrompt(
      "Run `in order to` and then proceed.",
      { verbosity: "compact" },
    );
    // The code span should be untouched
    expect(result).toContain("`in order to`");
  });

  it("does not transform content inside triple-backtick fences", () => {
    const result = renderPrompt(
      "Example:\n```\nYou are a bot. in order to respond...\n```\nDone.",
      { verbosity: "compact" },
    );
    expect(result).toContain("You are a bot. in order to respond...");
  });

  it("collapses 3+ consecutive newlines to 2", () => {
    const template =
      "Para 1.{{verbose}}\n\nVerbose block.{{/verbose}}\n\n\n\nPara 2.";
    const result = renderPrompt(template, { verbosity: "compact" });
    expect(result).not.toMatch(/\n{3,}/);
    expect(result).toContain("Para 1.");
    expect(result).toContain("Para 2.");
  });
});

// ── Verbose rendering ─────────────────────────────────────────────────────────

describe("renderPrompt — verbose mode", () => {
  it("unwraps {{verbose}} blocks (keeps content, removes markers)", () => {
    const template = "Core.{{verbose}}\n\nExtended rationale.{{/verbose}}";
    const result = renderPrompt(template, { verbosity: "verbose" });
    expect(result).toContain("Core.");
    expect(result).toContain("Extended rationale.");
    expect(result).not.toContain("{{verbose}}");
    expect(result).not.toContain("{{/verbose}}");
  });

  it("strips {{compact}} blocks entirely in verbose mode", () => {
    const template = "Full text.{{compact}} Short form.{{/compact}}";
    const result = renderPrompt(template, { verbosity: "verbose" });
    expect(result).not.toContain("Short form.");
    expect(result).toBe("Full text.");
  });

  it("does NOT apply compact auto-transforms in verbose mode", () => {
    const template = "You are a product requirements analyst. in order to decompose tasks.";
    const result = renderPrompt(template, { verbosity: "verbose" });
    expect(result).toContain("You are a product requirements analyst.");
    expect(result).toContain("in order to");
  });

  it("does NOT collapse content inside verbose blocks", () => {
    const template = "{{verbose}}\n\n- Point A\n- Point B\n\n{{/verbose}}";
    const result = renderPrompt(template, { verbosity: "verbose" });
    expect(result).toContain("- Point A");
    expect(result).toContain("- Point B");
  });
});

// ── Parameter substitution ────────────────────────────────────────────────────

describe("renderPrompt — parameter substitution", () => {
  it("substitutes a single {{param}} in verbose mode", () => {
    const template = "Analyse {{target}}.";
    const result = renderPrompt(template, {
      verbosity: "verbose",
      params: { target: "module-x" },
    });
    expect(result).toBe("Analyse module-x.");
  });

  it("substitutes multiple params", () => {
    const template = "Task {{id}}: {{title}}";
    const result = renderPrompt(template, {
      verbosity: "verbose",
      params: { id: "T-42", title: "Add retry logic" },
    });
    expect(result).toBe("Task T-42: Add retry logic");
  });

  it("substitutes the same param appearing multiple times", () => {
    const template = "Hello {{name}}. Welcome, {{name}}.";
    const result = renderPrompt(template, {
      verbosity: "verbose",
      params: { name: "Claude" },
    });
    expect(result).toBe("Hello Claude. Welcome, Claude.");
  });

  it("leaves unrecognised placeholders as-is", () => {
    const template = "Hello {{name}}.";
    const result = renderPrompt(template, { verbosity: "verbose" });
    expect(result).toBe("Hello {{name}}.");
  });

  it("substitutes params inside conditional blocks after unwrapping", () => {
    const template = "Core: {{x}}.{{verbose}} Detail: {{x}} more.{{/verbose}}";

    const verbose = renderPrompt(template, { verbosity: "verbose", params: { x: "alpha" } });
    expect(verbose).toContain("Core: alpha.");
    expect(verbose).toContain("Detail: alpha more.");

    const compact = renderPrompt(template, { verbosity: "compact", params: { x: "beta" } });
    expect(compact).toBe("Core: beta.");
  });

  it("substitutes params that contain regex-special characters in value", () => {
    const template = "Regex: {{pattern}}";
    const result = renderPrompt(template, {
      verbosity: "verbose",
      params: { pattern: "^(foo|bar)$" },
    });
    expect(result).toBe("Regex: ^(foo|bar)$");
  });
});

// ── Edge cases ────────────────────────────────────────────────────────────────

describe("renderPrompt — edge cases", () => {
  it("returns empty string for empty template (compact)", () => {
    expect(renderPrompt("", { verbosity: "compact" })).toBe("");
  });

  it("returns empty string for empty template (verbose)", () => {
    expect(renderPrompt("", { verbosity: "verbose" })).toBe("");
  });

  it("handles template that is all parameters", () => {
    const result = renderPrompt("{{a}}{{b}}{{c}}", {
      verbosity: "compact",
      params: { a: "x", b: "y", c: "z" },
    });
    expect(result).toBe("xyz");
  });

  it("handles template with no conditional blocks or params (passthrough)", () => {
    const plain = "Simple instruction.";
    const c = renderPrompt(plain, { verbosity: "compact" });
    const v = renderPrompt(plain, { verbosity: "verbose" });
    expect(c).toBe(plain);
    expect(v).toBe(plain);
  });

  it("handles template containing only a {{verbose}} block (compact → empty)", () => {
    const template = "{{verbose}}\nOnly in verbose.\n{{/verbose}}";
    const result = renderPrompt(template, { verbosity: "compact" });
    expect(result).toBe("");
  });

  it("handles non-nested conditional blocks correctly", () => {
    // Non-nested: two sequential {{verbose}} blocks
    const template = "{{verbose}}A{{/verbose}} mid {{verbose}}B{{/verbose}}";
    const verbose = renderPrompt(template, { verbosity: "verbose" });
    expect(verbose).toContain("A");
    expect(verbose).toContain("B");
    expect(verbose).not.toContain("{{verbose}}");
    expect(verbose).not.toContain("{{/verbose}}");

    const compact = renderPrompt(template, { verbosity: "compact" });
    expect(compact).not.toContain("A");
    expect(compact).not.toContain("B");
    expect(compact.trim()).toBe("mid");
  });

  it("handles param value that is an empty string", () => {
    const result = renderPrompt("x={{val}}", { verbosity: "verbose", params: { val: "" } });
    expect(result).toBe("x=");
  });
});

// ── applyCompactStyle unit tests ──────────────────────────────────────────────

describe("applyCompactStyle", () => {
  it("transforms 'You are a' → 'You:'", () => {
    expect(applyCompactStyle("You are a developer.")).toBe("You: developer.");
  });

  it("transforms 'You are an' → 'You:'", () => {
    expect(applyCompactStyle("You are an analyst.")).toBe("You: analyst.");
  });

  it("transforms 'in order to' → 'to'", () => {
    expect(applyCompactStyle("Use this in order to achieve the goal."))
      .toBe("Use this to achieve the goal.");
  });

  it("transforms 'so that' → 'for'", () => {
    expect(applyCompactStyle("Configure so that it works."))
      .toBe("Configure for it works.");
  });

  it("preserves code spans untouched", () => {
    const input = "Run `You are a bot` in order to start.";
    const result = applyCompactStyle(input);
    expect(result).toContain("`You are a bot`");
    // Prose outside the span is still transformed
    expect(result).toContain("to start.");
  });

  it("preserves fenced code blocks untouched", () => {
    const input = "Example:\n```\nYou are a bot\n```\nDone.";
    const result = applyCompactStyle(input);
    expect(result).toContain("You are a bot");
  });
});

// ── estimateTokenCount ────────────────────────────────────────────────────────

describe("estimateTokenCount", () => {
  it("returns 0 for empty string", () => {
    expect(estimateTokenCount("")).toBe(0);
  });

  it("returns positive count for non-empty text", () => {
    expect(estimateTokenCount("Hello")).toBeGreaterThan(0);
  });

  it("returns ceiling(length / 4)", () => {
    expect(estimateTokenCount("abcd")).toBe(1);      // 4 chars = 1 token
    expect(estimateTokenCount("abcde")).toBe(2);     // 5 chars = ceil(1.25) = 2
    expect(estimateTokenCount("abcdefgh")).toBe(2);  // 8 chars = 2 tokens
    expect(estimateTokenCount("abcdefghi")).toBe(3); // 9 chars = ceil(2.25) = 3
  });
});

// ── Token reduction ≥20% on 10 representative templates ──────────────────────

/**
 * Representative prompt templates drawn from patterns across hench, rex, and
 * sourcevision. Each includes {{verbose}}…{{/verbose}} blocks that mirror the
 * extended guidance, rationale, and constraint sections present in the existing
 * codebase prompts. Compact rendering strips those blocks and applies
 * auto-transforms, achieving the ≥20% token reduction target.
 */

const REPRESENTATIVE_TEMPLATES: ReadonlyArray<{ name: string; template: string }> = [
  // 1. Based on hench system prompt (agent identity + rules section)
  {
    name: "hench-system-prompt",
    template: `You are Hench, an autonomous AI agent that implements software tasks.
You receive a task brief and use tools to implement it.

## Rules
1. Read existing code before modifying it. Understand context first.
2. Make minimal, focused changes. Don't refactor unrelated code.
3. Follow existing code patterns and conventions.
4. Run tests after making changes if a test command is configured.
5. Commit your work with clear commit messages.
6. Never modify .hench/, .rex/, or .git/ directories directly.
7. Stay within the project directory. Do not access files outside it.
{{verbose}}

## Extended Context
These notes supplement the rules above with additional rationale and guidance.

### Why minimal changes matter
- Every line changed is a line that can break unrelated functionality.
- Refactoring outside task scope adds noise to diffs and makes review harder.
- When in doubt, do less and document what you did not change and why.

### Why tests come first
- A failing test proves the problem exists and defines the success condition.
- Writing the test first ensures you understand the acceptance criteria before touching production code.
- Green tests before committing are a hard requirement — do not skip.

### Error handling discipline
- Never swallow errors silently. Every catch block must either re-throw, log, or return a typed error.
- Pre-existing test failures are still your responsibility to fix.
- Build failures block the whole team — fix them before committing anything else.
{{/verbose}}`,
  },

  // 2. Based on rex decomposition prompt
  {
    name: "rex-decomposition",
    template: `You are a product requirements analyst.{{verbose}} Your role is to analyse task complexity and break down oversized work items into smaller, independently deliverable components that fit within the project estimation threshold.{{/verbose}} The following task has a level-of-effort (LoE) estimate that exceeds the project's threshold of {{threshold}} engineer-weeks. Break it down into smaller, independently deliverable child tasks.

Task to decompose:
{{taskJson}}

Rules:
- Each child task MUST have an LoE at or below {{threshold}} engineer-weeks.
- Each child task MUST include "loe", "loeRationale", and "loeConfidence".
- The sum of child LoE values should approximate the parent's LoE.
- Each child MUST have a verb-first title, a description, and acceptanceCriteria.
{{verbose}}
- Distribute the parent's acceptance criteria among children — do not lose any.
- Keep priorities consistent with the parent task.
- Preserve tags from the parent where relevant.
- Do NOT add entirely new functionality — only decompose what exists.
{{/verbose}}
- Produce 2–5 child tasks.

Respond with ONLY a valid JSON array. No explanation, no markdown fences, no commentary — just the JSON.`,
  },

  // 3. Based on rex task quality rules
  {
    name: "rex-task-quality",
    template: `Task quality:
- Task titles MUST be specific and actionable, verb-first (e.g. "Implement OAuth2 callback handler", NOT "OAuth2" or "Authentication stuff").
- Every task MUST have BOTH a description AND acceptanceCriteria. Omit neither.
{{verbose}}
- Descriptions explain the "why" and expected outcome — not just restating the title. Give enough context for someone unfamiliar with the codebase to understand the intent.
- Acceptance criteria MUST be concrete, verifiable pass/fail checks. Avoid subjective criteria like "works well" or "is fast".
{{/verbose}}
- Each task should represent a single unit of work completable in one focused session (1–4 hours).
- Assign priority based on: blocking dependencies → user-facing impact → technical debt.`,
  },

  // 4. Based on sourcevision meta-evaluation constraints
  {
    name: "sourcevision-meta-evaluation",
    template: `META-EVALUATION: Review all {{findingCount}} findings from previous analysis passes.

IMPORTANT CONSTRAINTS:
- Findings annotated "pass 0: automated heuristic" come from deterministic code analysis. Do NOT escalate their severity unless corroborated by MULTIPLE independent findings pointing to the same root cause.
- Do NOT generate specific file decomposition suggestions unless the underlying metric exceeds 2x its detection threshold.
{{verbose}}
- When referencing metrics from existing findings, preserve the exact numeric values as written. Do not round, estimate, or modify measurement values from heuristic findings.
- Positive findings describing good architecture, clean patterns, or successful design choices must have severity "info". Only problems, risks, and anti-patterns warrant "warning" or "critical".
- Test files coupling to implementation internals is expected by design (unit tests). Do not flag test-to-implementation coupling as an anti-pattern.
{{/verbose}}

Your tasks:
1. SEVERITY REASSESSMENT: Re-evaluate findings where severity should change.
2. META-PATTERNS: Identify higher-order patterns across ALL findings.
3. ACTIONABLE SUGGESTIONS: Convert vague observations into specific refactoring steps.
4. CONTRADICTIONS: Flag findings that contradict each other.

Respond with ONLY a JSON object (no markdown, no explanation).`,
  },

  // 5. Based on sourcevision pass config — zone naming pass
  {
    name: "sourcevision-zone-naming",
    template: `For each zone, provide:
1. A meaningful, descriptive name (not generic like "utilities" or "misc").
2. A one-sentence description of the zone's architectural purpose.
3. 2–3 actionable observations about its role and quality.
{{verbose}}
Zone naming convention: the '-tests' suffix is reserved for zones that contain ONLY test files. If a zone contains any production source files alongside test files, name it after its production purpose (e.g. 'prd-tree-lifecycle', not 'prd-tree-lifecycle-tests'). This prevents tooling from misclassifying production code as test-only.

Severity guide: most observations are "info". Flag zones with low cohesion (<0.4) or high coupling (>0.6) as "warning". Positive observations about good architecture or clean design are always "info" — never "warning" or "critical".
{{/verbose}}`,
  },

  // 6. Based on hench Go language context
  {
    name: "hench-go-context",
    template: `## Language: Go

### Toolchain
- Build: \`go build ./...\`
- Test: \`go test ./...\`
- Vet: \`go vet ./...\`
- Lint: \`golangci-lint run\`
{{verbose}}

### Naming Conventions
- Exported identifiers use PascalCase (e.g. \`HandleRequest\`, \`UserService\`).
- Unexported identifiers use camelCase (e.g. \`parseInput\`, \`defaultTimeout\`).
- Error handling uses explicit return values — no try/catch. Check every returned \`error\`.
- Acronyms are all-caps when exported (\`HTTPClient\`, \`ID\`) and all-lower when unexported (\`httpClient\`, \`id\`).

### Project Structure
- \`cmd/\` — main packages (one subdirectory per binary).
- \`internal/\` — private packages (not importable by other modules).
- \`pkg/\` — public library packages (importable by external modules).
- \`go.mod\` / \`go.sum\` — module definition and dependency checksums.

### Test Conventions
- Test files use the \`_test.go\` suffix in the same package.
- Test functions accept \`*testing.T\` (e.g. \`func TestParseInput(t *testing.T)\`).
- Prefer table-driven tests with \`t.Run\` subtests for comprehensive coverage.
{{/verbose}}`,
  },

  // 7. Based on rex output + schema instruction (shared across prompts)
  {
    name: "rex-output-schema",
    template: `Each element must be an object with:
- "epic": \`{ "title": string, "existingId"?: string }\`
- "features": array of feature objects
- "tasks": array of task objects with title, description, acceptanceCriteria, and priority
{{verbose}}
The optional "existingId" on epics and features references an existing PRD item by ID — use it to place new items under existing containers instead of creating duplicates.
The optional "status" field defaults to "pending". Set to "completed" when the code already implements the described functionality.

Level-of-Effort (LoE) fields on tasks:
- "loe": estimated effort in engineer-weeks (positive number, e.g. 0.5, 1, 2, 4).
- "loeRationale": one-sentence explanation justifying the estimate.
- "loeConfidence": your confidence in the estimate — "low", "medium", or "high".
Include all three LoE fields on every task.
{{/verbose}}

Respond with ONLY a valid JSON array. No explanation, no markdown fences, no commentary — just the JSON.`,
  },

  // 8. Based on hench error handling + tool notes section
  {
    name: "hench-error-tool-notes",
    template: `## Error Handling
- If tests fail after your changes, read the failure output carefully, fix the issue, and re-run.
- If you encounter a test failure you did NOT cause (pre-existing), note it in the log and continue.
- If validation/build fails, fix it before committing — never commit broken code.
- If you're stuck after 3 attempts at the same problem, log what you tried and move on.
{{verbose}}

## Tool Notes
- File paths are relative to the project root.
- Allowed shell commands: {{allowedCommands}}
- Max file size: {{maxFileSize}} bytes
- If a tool returns [GUARD], you hit a safety constraint. Adjust your approach.
- If a tool returns [ERROR], something failed. Check your inputs and retry or adjust.
{{/verbose}}`,
  },

  // 9. Based on sourcevision cross-zone relationships pass
  {
    name: "sourcevision-relationships-pass",
    template: `Focus on relationships BETWEEN zones:
- What architectural patterns exist? (e.g. layered architecture, hub-and-spoke, circular dependencies)
- Where are the clean boundaries? Which zone pairs have well-defined interfaces?
- Where are the leaky abstractions?
{{verbose}}
Severity guide: clean relationships are "info". Leaky abstractions or missing interfaces are "warning". Circular dependencies between zones are "critical". Positive observations (e.g., "clean separation", "well-defined interfaces") are always "info".

When identifying leaky abstractions, check whether the import graph shows zones reaching into each other's internal modules rather than consuming a declared public API surface. This is a stronger signal than coupling metrics alone.
{{/verbose}}`,
  },

  // 10. Based on hench self-heal mode instructions
  {
    name: "hench-self-heal",
    template: `## Self-Heal Mode
You are fixing a structural code issue found by static analysis.
- Make source code changes that address the root cause. Move files, extract modules, remove cross-zone imports, reduce coupling.
- Do NOT write ADR documents, markdown files, or architectural documentation as your primary deliverable.
{{verbose}}
- Configuration-only changes (eslint rules, tsconfig, zone pins) are acceptable only when they directly fix the detected issue.
- If the issue requires changes beyond a single task scope, set status to "deferred" with a specific reason. Do not fake completion.
- When moving files between zones, update ALL import paths — including test files that reference the moved module.
- Verify the fix by re-running the static analysis tool (e.g. \`pnpm test\`) after changes.
{{/verbose}}`,
  },
];

describe("token reduction — ≥20% on representative prompt sample", () => {
  for (const { name, template } of REPRESENTATIVE_TEMPLATES) {
    it(`${name}: compact mode reduces token count by ≥20%`, () => {
      const verboseRendered = renderPrompt(template, {
        verbosity: "verbose",
        params: {
          threshold: "2",
          taskJson: '{"title":"Example task","loe":4}',
          findingCount: "42",
          allowedCommands: "npm, git, tsc",
          maxFileSize: "1048576",
        },
      });

      const compactRendered = renderPrompt(template, {
        verbosity: "compact",
        params: {
          threshold: "2",
          taskJson: '{"title":"Example task","loe":4}',
          findingCount: "42",
          allowedCommands: "npm, git, tsc",
          maxFileSize: "1048576",
        },
      });

      const verboseTokens = estimateTokenCount(verboseRendered);
      const compactTokens = estimateTokenCount(compactRendered);
      const reduction = tokenReduction(verboseRendered, compactRendered);

      // Compact must be strictly smaller
      expect(compactTokens).toBeLessThan(verboseTokens);

      // Reduction must be at least 20%
      expect(reduction).toBeGreaterThanOrEqual(0.2);
    });
  }
});

// ── Type export contract ──────────────────────────────────────────────────────

describe("type exports", () => {
  it("PromptVerbosity accepts 'compact' and 'verbose'", () => {
    const compact: PromptVerbosity = "compact";
    const verbose: PromptVerbosity = "verbose";
    expect(compact).toBe("compact");
    expect(verbose).toBe("verbose");
  });
});
