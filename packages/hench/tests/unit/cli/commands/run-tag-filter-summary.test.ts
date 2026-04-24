import { describe, it, expect, afterEach } from "vitest";

/**
 * Tests for formatTagFilterCompletionSummary — the completion-summary
 * formatter emitted when a tag-filtered hench loop (e.g. self-heal mode)
 * finishes processing all matching items.
 *
 * The formatter is a pure function that returns an array of display lines,
 * making it straightforward to assert on content and structure without
 * mocking I/O.
 */

// ANSI escape prefix used to detect coloured output.
const ANSI_PREFIX = "\x1b[";
const GREEN = "\x1b[32m";
const RED = "\x1b[31m";

async function resetColor() {
  const { resetColorCache } = await import("@n-dx/llm-client");
  resetColorCache();
}

function setColorMode(mode: "force" | "none" | "clear") {
  if (mode === "force") {
    process.env.FORCE_COLOR = "1";
    delete process.env.NO_COLOR;
  } else if (mode === "none") {
    process.env.NO_COLOR = "1";
    delete process.env.FORCE_COLOR;
  } else {
    delete process.env.FORCE_COLOR;
    delete process.env.NO_COLOR;
  }
}

describe("formatTagFilterCompletionSummary", () => {
  afterEach(async () => {
    setColorMode("clear");
    await resetColor();
  });

  // ── Header line ────────────────────────────────────────────────────────────

  it("first line names the tag filter and processed count", async () => {
    setColorMode("none");
    await resetColor();
    const { formatTagFilterCompletionSummary } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const lines = formatTagFilterCompletionSummary(["self-heal"], [], 3);
    expect(lines[0]).toContain("[self-heal]");
    expect(lines[0]).toContain("3 task(s) processed");
  });

  it("first line includes all tag names when multiple tags are provided", async () => {
    setColorMode("none");
    await resetColor();
    const { formatTagFilterCompletionSummary } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const lines = formatTagFilterCompletionSummary(["self-heal", "hotfix"], [], 1);
    expect(lines[0]).toContain("[self-heal, hotfix]");
  });

  // ── Empty items ────────────────────────────────────────────────────────────

  it("returns only the header line when no items were processed", async () => {
    setColorMode("none");
    await resetColor();
    const { formatTagFilterCompletionSummary } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const lines = formatTagFilterCompletionSummary(["self-heal"], [], 0);
    expect(lines).toHaveLength(1);
  });

  // ── Per-item lines ─────────────────────────────────────────────────────────

  it("includes a header plus one line per item", async () => {
    setColorMode("none");
    await resetColor();
    const { formatTagFilterCompletionSummary } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const items = [
      { title: "Fix circular dependency", status: "completed" },
      { title: "Remove unused exports", status: "failed" },
    ];
    const lines = formatTagFilterCompletionSummary(["self-heal"], items, 2);
    // header + "Resolved tasks:" + 2 item lines
    expect(lines).toHaveLength(4);
  });

  it("item line contains task title and status", async () => {
    setColorMode("none");
    await resetColor();
    const { formatTagFilterCompletionSummary } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const items = [{ title: "Fix circular dependency", status: "completed" }];
    const lines = formatTagFilterCompletionSummary(["self-heal"], items, 1);
    const itemLine = lines.find((l) => l.includes("Fix circular dependency"));
    expect(itemLine).toBeDefined();
    expect(itemLine).toContain("completed");
  });

  // ── Color: completed uses green, other statuses use red ───────────────────

  it("completed item uses green check (✓) when color is forced", async () => {
    setColorMode("force");
    await resetColor();
    const { formatTagFilterCompletionSummary } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const items = [{ title: "Fix it", status: "completed" }];
    const lines = formatTagFilterCompletionSummary(["self-heal"], items, 1);
    const itemLine = lines.find((l) => l.includes("Fix it"))!;
    expect(itemLine).toContain(GREEN);
    expect(itemLine).toContain("✓");
  });

  it("non-completed item uses red cross (✗) when color is forced", async () => {
    setColorMode("force");
    await resetColor();
    const { formatTagFilterCompletionSummary } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const items = [{ title: "Fix it", status: "failed" }];
    const lines = formatTagFilterCompletionSummary(["self-heal"], items, 1);
    const itemLine = lines.find((l) => l.includes("Fix it"))!;
    expect(itemLine).toContain(RED);
    expect(itemLine).toContain("✗");
  });

  it("all lines are plain text when NO_COLOR=1", async () => {
    setColorMode("none");
    await resetColor();
    const { formatTagFilterCompletionSummary } = await import(
      "../../../../src/cli/commands/run.js"
    );
    const items = [
      { title: "Task A", status: "completed" },
      { title: "Task B", status: "failed" },
    ];
    const lines = formatTagFilterCompletionSummary(["self-heal"], items, 2);
    for (const line of lines) {
      expect(line).not.toContain(ANSI_PREFIX);
    }
  });
});
