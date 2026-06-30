import { describe, it, expect } from "vitest";
import {
  computeInputFingerprint,
  ZONE_ALGORITHM_VERSION,
} from "../../../src/analyzers/zones.js";
import { makeFileEntry, makeInventory } from "./zones-helpers.js";

// Regression coverage for the zone-partition cache-busting fingerprint.
//
// `analyzeZones` reuses the previous partition when the input fingerprint is
// unchanged. Before the algorithm version was folded in, a sourcevision
// upgrade that changed the partitioning algorithm left stale partitions
// cached forever (unchanged files → unchanged fingerprint → reuse), which
// surfaced as e.g. an empty codebase map until the user deleted .sourcevision.
describe("computeInputFingerprint", () => {
  const inventory = makeInventory([
    makeFileEntry("src/a.ts", { hash: "h-a" }),
    makeFileEntry("src/b.ts", { hash: "h-b" }),
  ]);

  it("is deterministic for identical inputs", () => {
    expect(computeInputFingerprint(inventory)).toBe(
      computeInputFingerprint(inventory),
    );
  });

  it("changes when the zone-algorithm version changes", () => {
    const v1 = computeInputFingerprint(inventory, undefined, undefined, undefined, undefined, 1);
    const v2 = computeInputFingerprint(inventory, undefined, undefined, undefined, undefined, 2);
    expect(v1).not.toBe(v2);
  });

  it("defaults to the current ZONE_ALGORITHM_VERSION", () => {
    const explicit = computeInputFingerprint(
      inventory, undefined, undefined, undefined, undefined, ZONE_ALGORITHM_VERSION,
    );
    expect(computeInputFingerprint(inventory)).toBe(explicit);
  });

  it("still varies with file content (hash) at a fixed algorithm version", () => {
    const changed = makeInventory([
      makeFileEntry("src/a.ts", { hash: "h-a" }),
      makeFileEntry("src/b.ts", { hash: "h-b-CHANGED" }),
    ]);
    expect(computeInputFingerprint(inventory)).not.toBe(
      computeInputFingerprint(changed),
    );
  });
});
