/**
 * Foundation-tier prompt assembly and per-section measurement.
 *
 * These cover the two additions that let rex and sourcevision adopt the
 * envelope: single-channel assembly, and the section-cost view that answers
 * "which part of this prompt is the cost?".
 *
 * @see packages/llm-client/src/prompt-diagnostics.ts
 * @see packages/llm-client/src/runtime-contract.ts — assemblePromptText
 */

import { describe, it, expect } from "vitest";
import {
  createPromptEnvelope,
  assemblePrompt,
  assemblePromptText,
} from "../../src/runtime-contract.js";
import {
  extractPromptSectionDiagnostics,
  promptSectionCosts,
  dominantPromptSections,
  formatPromptSectionCosts,
} from "../../src/prompt-diagnostics.js";

const MODEL = "claude-sonnet-5";

describe("assemblePromptText", () => {
  it("joins sections with a blank line, in declared order", () => {
    const envelope = createPromptEnvelope([
      { name: "role", content: "You are an analyst." },
      { name: "input", content: "Here is the input." },
      { name: "output", content: "Return JSON." },
    ]);

    expect(assemblePromptText(envelope)).toBe(
      "You are an analyst.\n\nHere is the input.\n\nReturn JSON.",
    );
  });

  it("preserves declared order rather than grouping system sections", () => {
    // The distinction from assemblePrompt: a `system` section declared last
    // stays last, because a single-channel vendor has nowhere else to put it.
    const envelope = createPromptEnvelope([
      { name: "brief", content: "BRIEF" },
      { name: "system", content: "SYSTEM" },
    ]);

    expect(assemblePromptText(envelope)).toBe("BRIEF\n\nSYSTEM");

    const grouped = assemblePrompt(envelope);
    expect(grouped.systemPrompt).toBe("SYSTEM");
    expect(grouped.taskPrompt).toBe("BRIEF");
  });

  it("trims each section so a self-padded block costs one separator", () => {
    const envelope = createPromptEnvelope([
      { name: "role", content: "ROLE" },
      { name: "placement", content: "\n## Placement\nPut it here.\n" },
      { name: "output", content: "OUTPUT" },
    ]);

    expect(assemblePromptText(envelope)).toBe(
      "ROLE\n\n## Placement\nPut it here.\n\nOUTPUT",
    );
  });

  it("drops a whitespace-only section entirely, leaving no doubled blank line", () => {
    // The failure mode the migration removed: an absent conditional block used
    // to leave its own padding behind.
    const envelope = createPromptEnvelope([
      { name: "role", content: "ROLE" },
      { name: "placement", content: "   \n  " },
      { name: "output", content: "OUTPUT" },
    ]);

    expect(assemblePromptText(envelope)).toBe("ROLE\n\nOUTPUT");
  });

  it("honours a custom separator", () => {
    const envelope = createPromptEnvelope([
      { name: "role", content: "A" },
      { name: "input", content: "B" },
    ]);

    expect(assemblePromptText(envelope, { separator: "\n" })).toBe("A\nB");
  });

  it("returns an empty string for an empty envelope", () => {
    expect(assemblePromptText(createPromptEnvelope([]))).toBe("");
  });
});

describe("extractPromptSectionDiagnostics", () => {
  it("reports exactly name and byteLength, in envelope order", () => {
    // The shape hench persists on run records. Widening it would change a
    // stored schema, which is why the cost view is a separate function.
    const envelope = createPromptEnvelope([
      { name: "system", content: "Hello" },
      { name: "brief", content: "café" },
    ]);

    expect(extractPromptSectionDiagnostics(envelope)).toEqual([
      { name: "system", byteLength: 5 },
      { name: "brief", byteLength: 5 },
    ]);
  });
});

describe("promptSectionCosts", () => {
  it("measures every section and reports shares totalling 100", () => {
    const envelope = createPromptEnvelope([
      { name: "schema", content: "x".repeat(800) },
      { name: "role", content: "x".repeat(200) },
    ]);

    const costs = promptSectionCosts(envelope, MODEL);

    expect(costs.map((c) => c.name)).toEqual(["schema", "role"]);
    expect(costs[0].charLength).toBe(800);
    expect(costs[0].tokenEstimate).toBeGreaterThan(costs[1].tokenEstimate);
    expect(costs.reduce((n, c) => n + c.sharePercent, 0)).toBeCloseTo(100, 6);
  });

  it("attributes the dominant share to the largest section", () => {
    const envelope = createPromptEnvelope([
      { name: "role", content: "short" },
      { name: "example", content: "x".repeat(4000) },
    ]);

    const [top] = dominantPromptSections(promptSectionCosts(envelope, MODEL));

    expect(top.name).toBe("example");
    expect(top.sharePercent).toBeGreaterThan(95);
  });

  it("reports zero shares rather than dividing by zero on an empty envelope", () => {
    expect(promptSectionCosts(createPromptEnvelope([]), MODEL)).toEqual([]);
  });

  it("distinguishes byte length from character length for multi-byte text", () => {
    const [cost] = promptSectionCosts(
      createPromptEnvelope([{ name: "input", content: "日本語" }]),
      MODEL,
    );

    expect(cost.charLength).toBe(3);
    expect(cost.byteLength).toBe(9);
  });
});

describe("formatPromptSectionCosts", () => {
  it("lists the most expensive section first and totals the rest", () => {
    const envelope = createPromptEnvelope([
      { name: "role", content: "x".repeat(40) },
      { name: "example", content: "x".repeat(4000) },
    ]);

    const lines = formatPromptSectionCosts(promptSectionCosts(envelope, MODEL), {
      label: "buildIdeasEnvelope",
    });

    expect(lines[0]).toContain("example");
    expect(lines[1]).toContain("role");
    expect(lines[2]).toContain("buildIdeasEnvelope");
    expect(lines[2]).toContain("2 sections");
  });

  it("singularises the section count", () => {
    const lines = formatPromptSectionCosts(
      promptSectionCosts(createPromptEnvelope([{ name: "role", content: "A" }]), MODEL),
    );

    expect(lines.at(-1)).toContain("1 section");
    expect(lines.at(-1)).not.toContain("1 sections");
  });
});
