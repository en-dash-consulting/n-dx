import { describe, it, expect } from "vitest";
import type { ProposalTask } from "../../../../src/analyze/propose.js";
import { formatTaskLoE, formatTaskLoERationale } from "../../../../src/cli/commands/format-loe.js";

function makeTask(overrides: Partial<ProposalTask> = {}): ProposalTask {
  return {
    title: "Test task",
    source: "test",
    sourceFile: "src/test.ts",
    ...overrides,
  };
}

// ─── formatTaskLoE ────────────────────────────────────────────────────

describe("formatTaskLoE", () => {
  it("returns empty string when task has no LoE", () => {
    const task = makeTask();
    expect(formatTaskLoE(task)).toBe("");
  });

  it("returns empty string when loe is undefined even with threshold", () => {
    const task = makeTask({ loe: undefined });
    expect(formatTaskLoE(task, 2)).toBe("");
  });

  it("formats LoE without threshold", () => {
    const task = makeTask({ loe: 1.5 });
    expect(formatTaskLoE(task)).toBe(" (LoE: 1.5w)");
  });

  it("formats LoE within threshold", () => {
    const task = makeTask({ loe: 1 });
    expect(formatTaskLoE(task, 2)).toBe(" (LoE: 1w)");
  });

  it("formats LoE at threshold without flag", () => {
    const task = makeTask({ loe: 2 });
    expect(formatTaskLoE(task, 2)).toBe(" (LoE: 2w)");
  });

  it("flags LoE exceeding threshold", () => {
    const task = makeTask({ loe: 4 });
    const label = formatTaskLoE(task, 2);
    expect(label).toContain("4w");
    expect(label).toContain("exceeds 2w threshold");
  });

  it("uses correct threshold value in flag", () => {
    const task = makeTask({ loe: 3 });
    const label = formatTaskLoE(task, 1);
    expect(label).toContain("exceeds 1w threshold");
  });
});

// ─── formatTaskLoERationale ───────────────────────────────────────────

describe("formatTaskLoERationale", () => {
  it("returns empty string when task has no rationale", () => {
    const task = makeTask();
    expect(formatTaskLoERationale(task, "  ")).toBe("");
  });

  it("returns empty string when loeRationale is undefined", () => {
    const task = makeTask({ loe: 2, loeRationale: undefined });
    expect(formatTaskLoERationale(task, "  ")).toBe("");
  });

  it("formats rationale with confidence", () => {
    const task = makeTask({
      loeRationale: "Standard CRUD operations",
      loeConfidence: "high",
    });
    const line = formatTaskLoERationale(task, "    ");
    expect(line).toBe("    LoE rationale: Standard CRUD operations [high]");
  });

  it("formats rationale without confidence", () => {
    const task = makeTask({
      loeRationale: "Complex integration",
    });
    const line = formatTaskLoERationale(task, "  ");
    expect(line).toBe("  LoE rationale: Complex integration");
  });

  it("uses provided indent", () => {
    const task = makeTask({
      loeRationale: "Reason",
      loeConfidence: "low",
    });
    const line = formatTaskLoERationale(task, ">>>");
    expect(line).toMatch(/^>>>LoE rationale:/);
  });
});
