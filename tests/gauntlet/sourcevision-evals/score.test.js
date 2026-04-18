import { describe, it, expect } from "vitest";
import { archetypeAccuracy, zonePartitionSimilarity } from "./score.js";

describe("archetypeAccuracy", () => {
  it("returns 1.0 when actual matches golden exactly", () => {
    const golden = {
      files: [
        { path: "src/a.ts", archetype: "utility" },
        { path: "src/b.ts", archetype: "component" },
      ],
    };
    expect(archetypeAccuracy(golden, golden)).toBe(1);
  });

  it("returns 0.5 when half the archetypes are perturbed", () => {
    const golden = {
      files: [
        { path: "src/a.ts", archetype: "utility" },
        { path: "src/b.ts", archetype: "component" },
      ],
    };
    const actual = {
      files: [
        { path: "src/a.ts", archetype: "utility" },
        { path: "src/b.ts", archetype: "service" },
      ],
    };
    expect(archetypeAccuracy(golden, actual)).toBe(0.5);
  });

  it("ignores files present only in actual (denominator = intersection)", () => {
    const golden = {
      files: [{ path: "src/a.ts", archetype: "utility" }],
    };
    const actual = {
      files: [
        { path: "src/a.ts", archetype: "utility" },
        { path: "src/new.ts", archetype: "component" },
      ],
    };
    expect(archetypeAccuracy(golden, actual)).toBe(1);
  });

  it("treats null and missing archetype as equivalent", () => {
    const golden = { files: [{ path: "src/a.ts", archetype: null }] };
    const actual = { files: [{ path: "src/a.ts", archetype: null }] };
    expect(archetypeAccuracy(golden, actual)).toBe(1);
  });
});

describe("zonePartitionSimilarity", () => {
  it("returns 1.0 when partitions match exactly", () => {
    const golden = {
      zones: [
        { id: "server", files: ["src/server/a.ts", "src/server/b.ts"] },
        { id: "client", files: ["src/client/x.tsx"] },
      ],
    };
    expect(zonePartitionSimilarity(golden, golden)).toBe(1);
  });

  it("survives zone-id relabeling — partition identity is what matters", () => {
    const golden = {
      zones: [{ id: "server", files: ["src/a.ts", "src/b.ts"] }],
    };
    const actual = {
      zones: [{ id: "backend", files: ["src/a.ts", "src/b.ts"] }],
    };
    expect(zonePartitionSimilarity(golden, actual)).toBe(1);
  });

  it("returns < 1 when a golden zone's files are split across actual zones", () => {
    const golden = {
      zones: [{ id: "server", files: ["a.ts", "b.ts", "c.ts", "d.ts"] }],
    };
    const actual = {
      zones: [
        { id: "x", files: ["a.ts", "b.ts"] },
        { id: "y", files: ["c.ts", "d.ts"] },
      ],
    };
    const score = zonePartitionSimilarity(golden, actual);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
    expect(score).toBe(0.5);
  });

  it("returns 0 when zones share no files", () => {
    const golden = { zones: [{ id: "a", files: ["x.ts"] }] };
    const actual = { zones: [{ id: "b", files: ["y.ts"] }] };
    expect(zonePartitionSimilarity(golden, actual)).toBe(0);
  });

  it("handles empty-on-both-sides as perfect match", () => {
    expect(zonePartitionSimilarity({ zones: [] }, { zones: [] })).toBe(1);
  });
});
