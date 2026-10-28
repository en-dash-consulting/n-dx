/** `rex change place` and `rex add` text: each candidate's strength, and a tie when the top two share a score. */

import { describe, it, expect } from "vitest";
import { formatPlacementSuggestion } from "../../../../src/cli/commands/v2-cli.js";
import type { PlacementSuggestion } from "../../../../src/core/change-place.js";

const targets: Record<string, { id: string; displayId: string; title: string }> = {
  a: { id: "a", displayId: "A1.1", title: "Pay by card" },
  b: { id: "b", displayId: "A1.2", title: "Refund an order" },
};

const suggestion = (tied: boolean): PlacementSuggestion => ({
  change: "ch",
  relation: "touches",
  tied,
  shortlist: [
    { target: "a", relation: "touches", score: 10, reasons: [], strength: "strong" },
    { target: "b", relation: "touches", score: tied ? 10 : 5, reasons: [], strength: tied ? "strong" : "weak" },
  ],
});

describe("formatPlacementSuggestion", () => {
  it("names each candidate's relation and strength", () => {
    const lines = formatPlacementSuggestion(suggestion(false), "CH-1", (id) => targets[id]);
    expect(lines).toContain("    A1.1 Pay by card (touches, strong)");
    expect(lines).toContain("    A1.2 Refund an order (touches, weak)");
    expect(lines.join("\n")).not.toMatch(/Tied/);
  });

  it("says the top two are tied when they share a score", () => {
    const lines = formatPlacementSuggestion(suggestion(true), "CH-1", (id) => targets[id]);
    expect(lines.join("\n")).toMatch(/Tied: the top two score the same/);
  });
});
