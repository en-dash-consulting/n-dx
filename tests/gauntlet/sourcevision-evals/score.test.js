import { describe, it, expect } from "vitest";
import { archetypeAccuracy, zonePartitionSimilarity, projectForScoring } from "./score.js";

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

  // Broadened from a case titled "treats null and missing archetype as
  // equivalent" that passed an explicit `null` on BOTH sides — so the `?? null`
  // coalescing in score.js, which is the actual "missing" branch, was never
  // reached and both operators could be deleted with the test still green
  // (AUDIT-2026-09.md defect D1). sv emits unclassified files as an absent key
  // in classifications.json, and medium-app's golden holds one such file, so
  // this equivalence is a live contract of the eval gate.
  describe("null and absent archetype are equivalent", () => {
    const withNull = { path: "src/a.ts", archetype: null };
    const withAbsent = { path: "src/a.ts" };

    it.for([
      ["null on both sides", withNull, withNull],
      ["absent on both sides", withAbsent, withAbsent],
      ["null in golden, absent in actual", withNull, withAbsent],
      ["absent in golden, null in actual", withAbsent, withNull],
    ])("scores 1.0 with %s", ([, goldenFile, actualFile]) => {
      expect(archetypeAccuracy({ files: [goldenFile] }, { files: [actualFile] })).toBe(1);
    });

    it.for([
      ["null in golden", withNull],
      ["absent in golden", withAbsent],
    ])("scores 0 when %s but actual assigned a real archetype", ([, goldenFile]) => {
      const actual = { files: [{ path: "src/a.ts", archetype: "utility" }] };
      expect(archetypeAccuracy({ files: [goldenFile] }, actual)).toBe(0);
    });
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

  it("returns 0.5 when a golden zone's files split evenly across two actual zones", () => {
    const golden = {
      zones: [{ id: "server", files: ["a.ts", "b.ts", "c.ts", "d.ts"] }],
    };
    const actual = {
      zones: [
        { id: "x", files: ["a.ts", "b.ts"] },
        { id: "y", files: ["c.ts", "d.ts"] },
      ],
    };
    // Exact value only. The `toBeGreaterThan(0)` / `toBeLessThan(1)` assertions
    // that used to precede it are subsumed by it (AUDIT-2026-09.md defect D2).
    expect(zonePartitionSimilarity(golden, actual)).toBe(0.5);
  });

  it("returns 0 when zones share no files", () => {
    const golden = { zones: [{ id: "a", files: ["x.ts"] }] };
    const actual = { zones: [{ id: "b", files: ["y.ts"] }] };
    expect(zonePartitionSimilarity(golden, actual)).toBe(0);
  });
});

// Generalised from a single case ("handles empty-on-both-sides as perfect
// match") that covered one two-line early return in one scorer and was
// classified too niche to keep on its own merits (AUDIT-2026-09.md case A#9).
// The concern — what the scorers do when an input side is empty or the two
// sides do not overlap — is valid and broader than the original case: it is
// the whole class of inputs on which a floor of 1.0 can pass vacuously.
describe("degenerate inputs", () => {
  it.for([
    ["both sides empty", [], [], 1],
    ["golden empty, actual has zones", [], [{ id: "a", files: ["x.ts"] }], 0],
    ["golden has zones, actual empty", [{ id: "a", files: ["x.ts"] }], [], 0],
  ])("zonePartitionSimilarity scores %s as %s", ([, goldenZones, actualZones, expected]) => {
    expect(zonePartitionSimilarity({ zones: goldenZones }, { zones: actualZones })).toBe(expected);
  });

  it.for([
    ["both sides empty", [], []],
    ["golden empty, actual has files", [], [{ path: "x.ts", archetype: "utility" }]],
    ["golden has files, actual empty", [{ path: "x.ts", archetype: "utility" }], []],
  ])("archetypeAccuracy scores %s as 1 (empty intersection is vacuously perfect)", ([, goldenFiles, actualFiles]) => {
    expect(archetypeAccuracy({ files: goldenFiles }, { files: actualFiles })).toBe(1);
  });

  // KNOWN HAZARD, pinned deliberately rather than asserted as desirable.
  //
  // Goldens store POSIX separators and the scorers key Maps on the path string
  // byte-exactly, which is what makes the eval gate a de-facto check that
  // `sv analyze` normalises separators on Windows (see evals.test.js). But the
  // two scorers do NOT fail alike on a separator regression: every path misses
  // the golden Map, so archetypeAccuracy's intersection is empty and its
  // `total === 0` guard returns a PERFECT 1.0, clearing its 1.0 floor. Only
  // zonePartitionSimilarity drops to 0 and reddens the gate.
  //
  // So the gate detects that regression through exactly one of its four
  // assertions. Do not "simplify" the zone scorer's floor or its early return
  // without replacing this coverage. AUDIT-2026-09.md previously claimed both
  // scores would drop to 0; that was wrong, and this test is the evidence.
  it("archetypeAccuracy passes at 1.0 when every path mismatches on separators", () => {
    const golden = { files: [{ path: "src/client/App.tsx", archetype: "component" }] };
    const windowsActual = { files: [{ path: "src\\client\\App.tsx", archetype: "component" }] };

    expect(archetypeAccuracy(golden, windowsActual)).toBe(1);
    expect(zonePartitionSimilarity(
      { zones: [{ id: "client", files: ["src/client/App.tsx"] }] },
      { zones: [{ id: "client", files: ["src\\client\\App.tsx"] }] },
    )).toBe(0);
  });
});

// D3: projectForScoring had no test at all, despite being the sole adapter
// between raw `sv analyze` output and the scorers. score.test.js feeds the
// scorers pre-projected literals, so a shape change in classifications.json or
// zones.json breaks the gate while leaving every case above green — and
// evals.test.js, which would catch it, never runs in CI.
describe("projectForScoring", () => {
  const raw = {
    classifications: {
      files: [
        { path: "src/a.ts", archetype: "utility", role: "helper", language: "ts" },
        { path: "src/b.ts", archetype: null },
        { path: "src/c.ts" },
      ],
    },
    zones: {
      zones: [
        { id: "core", files: ["src/a.ts", "src/b.ts"], description: "dropped", cohesion: 0.8 },
        { id: "edge", files: ["src/c.ts"] },
      ],
    },
  };

  it("reduces raw output to the minimal shape the scorers accept", () => {
    expect(projectForScoring(raw)).toEqual({
      files: [
        { path: "src/a.ts", archetype: "utility" },
        { path: "src/b.ts", archetype: null },
        { path: "src/c.ts", archetype: null },
      ],
      zones: [
        { id: "core", files: ["src/a.ts", "src/b.ts"] },
        { id: "edge", files: ["src/c.ts"] },
      ],
    });
  });

  it("coerces an absent archetype to null so scorers see one 'unclassified' value", () => {
    const { files } = projectForScoring(raw);
    expect(files.every((f) => "archetype" in f)).toBe(true);
    expect(files.filter((f) => f.archetype === null)).toHaveLength(2);
  });

  it("preserves path strings verbatim — normalising here would blind the gate", () => {
    // The projection is the last place a separator could be silently repaired
    // before comparison. If it ever does normalise, the eval gate stops being
    // able to see a Windows separator regression at all.
    const projected = projectForScoring({
      classifications: { files: [{ path: "src\\client\\App.tsx", archetype: "component" }] },
      zones: { zones: [{ id: "client", files: ["src\\client\\App.tsx"] }] },
    });
    expect(projected.files[0].path).toBe("src\\client\\App.tsx");
    expect(projected.zones[0].files[0]).toBe("src\\client\\App.tsx");
  });

  it("copies zone file arrays so scoring cannot mutate the analyser output", () => {
    const projected = projectForScoring(raw);
    projected.zones[0].files.push("src/injected.ts");
    expect(raw.zones.zones[0].files).toEqual(["src/a.ts", "src/b.ts"]);
  });
});
