import { describe, it, expect } from "vitest";
import { formatSystemMemory } from "../../../../src/cli/commands/run.js";

const GB = 1024 * 1024 * 1024;

describe("formatSystemMemory — end-of-run memory line", () => {
  it("reports available / total GB for a known reading", () => {
    expect(formatSystemMemory({
      peakRssBytes: 0,
      systemAvailableAtStartBytes: 4 * GB,
      systemAvailableAtEndBytes: 3.9 * GB,
      systemTotalBytes: 16 * GB,
    })).toBe("system: 3.9 / 16.0 GB available");
  });

  it("says unknown, not a number, when the end reading was unknown (-1)", () => {
    const line = formatSystemMemory({
      peakRssBytes: 0,
      systemAvailableAtStartBytes: -1,
      systemAvailableAtEndBytes: -1,
      systemTotalBytes: 16 * GB,
    });
    expect(line).toBe("system: available memory unknown / 16.0 GB");
    expect(line).not.toMatch(/-?\d+(\.\d+)? \//);
  });
});
