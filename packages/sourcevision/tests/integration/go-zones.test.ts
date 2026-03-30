import { describe, it, expect, beforeAll } from "vitest";
import { join } from "node:path";
import { analyzeInventory } from "../../src/analyzers/inventory.js";
import { analyzeImports } from "../../src/analyzers/imports.js";
import { analyzeZones } from "../../src/analyzers/zones.js";
import { goConfig } from "../../src/language/go.js";
import { validateZones } from "../../src/schema/validate.js";
import type { Imports, Zones } from "../../src/schema/v1.js";

const GO_FIXTURE = join(import.meta.dirname, "../fixtures/go-project");

describe("zone detection — Go fixture project", () => {
  let imports: Imports;
  let zones: Zones;

  beforeAll(async () => {
    const inventory = await analyzeInventory(GO_FIXTURE, {
      languageConfig: goConfig,
    });
    imports = await analyzeImports(GO_FIXTURE, inventory, { language: "go" });
    const result = await analyzeZones(inventory, imports, { enrich: false });
    zones = result.zones;
  });

  // ── Import graph guard ──────────────────────────────────────────────────────
  //
  // The zone detector produces degenerate output when the import graph is empty
  // (every file lands in one proximity-based mega-zone). This guard fails early
  // with a descriptive message so a silent upstream parser regression is caught
  // before it poisons zone assertions.

  it("import graph contains at least one edge (guards against silent parser failures)", () => {
    expect(
      imports.edges.length,
      "Import graph has zero edges — the Go parser may have failed silently. " +
        "Zone detection requires import edges to produce meaningful communities. " +
        "Check that packages/sourcevision/src/analyzers/imports.ts correctly " +
        "parses Go import statements from the fixture project.",
    ).toBeGreaterThan(0);
  });

  // ── Schema validation ───────────────────────────────────────────────────────

  it("produces schema-valid zones output", () => {
    const result = validateZones(zones);
    expect(result.ok).toBe(true);
  });

  // ── Zone count ──────────────────────────────────────────────────────────────

  it("produces at least 2 distinct zones from the Go import graph", () => {
    expect(
      zones.zones.length,
      `Expected at least 2 zones but got ${zones.zones.length}. ` +
        "The Go fixture has distinct package clusters (cmd/, internal/handler/, " +
        "internal/service/, internal/repository/, pkg/response/) that should " +
        "form separate communities under Louvain detection.",
    ).toBeGreaterThanOrEqual(2);
  });

  // ── Package boundary coverage ───────────────────────────────────────────────
  //
  // Each Go package boundary should be represented in the zone output. A file
  // from each package must appear in at least one zone — it doesn't matter
  // which zone, only that the package's files are not lost.

  const expectedPackageDirs = [
    { dir: "cmd/", label: "cmd" },
    { dir: "internal/handler/", label: "handler" },
    { dir: "internal/service/", label: "service" },
    { dir: "internal/repository/", label: "repository" },
  ];

  for (const { dir, label } of expectedPackageDirs) {
    it(`${label} package files appear in at least one zone`, () => {
      const allZonedFiles = zones.zones.flatMap((z) => z.files);
      const matchingFiles = allZonedFiles.filter((f) => f.startsWith(dir));
      expect(
        matchingFiles.length,
        `No files from ${dir} found in any zone. Expected at least one ` +
          `file from the "${label}" package to be assigned to a zone.`,
      ).toBeGreaterThan(0);
    });
  }

  // ── pkg/response coverage ─────────────────────────────────────────────────

  it("pkg/response files appear in at least one zone", () => {
    const allZonedFiles = zones.zones.flatMap((z) => z.files);
    const matchingFiles = allZonedFiles.filter((f) =>
      f.startsWith("pkg/response/"),
    );
    expect(
      matchingFiles.length,
      "No files from pkg/response/ found in any zone. " +
        "The dot-import edge from json_test.go should anchor this package " +
        "in the zone graph.",
    ).toBeGreaterThan(0);
  });

  // ── Cross-package separation ────────────────────────────────────────────────
  //
  // Files from packages that are NOT directly connected in the import graph
  // should not share a zone. The Go fixture has a clear linear dependency chain:
  //
  //   cmd → handler → service → repository
  //
  // Non-adjacent layers (e.g. cmd and repository) have no direct import edge,
  // so they should not be co-located in the same zone — unless Louvain merges
  // them due to transitive coupling (acceptable for very small graphs).
  //
  // We check that at least ONE pair of non-adjacent packages lives in separate
  // zones. This is a structural assertion, not a hard requirement for every
  // pair, since the algorithm may merge small communities.

  it("at least one pair of non-adjacent packages is separated into different zones", () => {
    // Pairs that have NO direct import edge between them
    const nonAdjacentPairs = [
      { a: "cmd/", b: "internal/repository/" },
      { a: "cmd/", b: "internal/service/" },
      { a: "internal/handler/", b: "internal/repository/" },
      { a: "pkg/response/", b: "cmd/" },
    ];

    const zoneForFile = new Map<string, string>();
    for (const zone of zones.zones) {
      for (const file of zone.files) {
        zoneForFile.set(file, zone.id);
      }
    }

    let hasSeparation = false;
    for (const { a, b } of nonAdjacentPairs) {
      const zonesA = new Set<string>();
      const zonesB = new Set<string>();

      for (const [file, zoneId] of zoneForFile) {
        if (file.startsWith(a)) zonesA.add(zoneId);
        if (file.startsWith(b)) zonesB.add(zoneId);
      }

      // Check if these two packages are in entirely different zones
      const overlap = [...zonesA].filter((z) => zonesB.has(z));
      if (overlap.length === 0 && zonesA.size > 0 && zonesB.size > 0) {
        hasSeparation = true;
        break;
      }
    }

    expect(
      hasSeparation,
      "All non-adjacent package pairs share a zone. Expected Louvain to " +
        "separate at least one pair of packages that have no direct import edge " +
        "(e.g. cmd/ and internal/repository/). This suggests the algorithm is " +
        "producing a single mega-zone instead of meaningful communities.",
    ).toBe(true);
  });

  // ── Zone metrics ────────────────────────────────────────────────────────────

  it("all zones have cohesion and coupling in valid range [0, 1]", () => {
    for (const zone of zones.zones) {
      expect(zone.cohesion).toBeGreaterThanOrEqual(0);
      expect(zone.cohesion).toBeLessThanOrEqual(1);
      expect(zone.coupling).toBeGreaterThanOrEqual(0);
      expect(zone.coupling).toBeLessThanOrEqual(1);
    }
  });

  it("every zone has a non-empty id and name", () => {
    for (const zone of zones.zones) {
      expect(zone.id, "zone id must be a non-empty string").toBeTruthy();
      expect(zone.name, "zone name must be a non-empty string").toBeTruthy();
    }
  });

  it("every zone contains at least one file", () => {
    for (const zone of zones.zones) {
      expect(
        zone.files.length,
        `Zone "${zone.id}" has no files`,
      ).toBeGreaterThan(0);
    }
  });

  // ── No duplicate file assignment ────────────────────────────────────────────

  it("no file appears in more than one zone", () => {
    const seen = new Map<string, string>();
    for (const zone of zones.zones) {
      for (const file of zone.files) {
        const previous = seen.get(file);
        expect(
          previous,
          `File "${file}" appears in both zone "${previous}" and "${zone.id}"`,
        ).toBeUndefined();
        seen.set(file, zone.id);
      }
    }
  });

  // ── Crossings ───────────────────────────────────────────────────────────────
  //
  // Go import edges target package directories (e.g. "internal/handler"), not
  // individual files. The resolver expands directory targets to their constituent
  // files so that cross-zone imports are correctly detected as crossings.

  it("produces non-zero crossings from Go directory-level imports", () => {
    expect(Array.isArray(zones.crossings)).toBe(true);
    expect(
      zones.crossings.length,
      "Expected non-zero crossings — the Go fixture has cross-package imports " +
        "(cmd→handler→service→repository) that should produce zone crossings " +
        "after directory-to-files resolution. Got 0 crossings.",
    ).toBeGreaterThan(0);
  });

  it("crossing targets are real file paths, not directory paths", () => {
    for (const crossing of zones.crossings) {
      expect(
        crossing.to,
        `Crossing target "${crossing.to}" looks like a directory — ` +
          "the resolver should expand directory targets to actual .go files.",
      ).toMatch(/\.\w+$/);
    }
  });

  it("at least one zone has non-zero coupling from Go cross-package imports", () => {
    const hasCoupling = zones.zones.some((z) => z.coupling > 0);
    expect(
      hasCoupling,
      "All zones have coupling === 0. The Go fixture has cross-package " +
        "imports (cmd→handler→service→repository) that should produce " +
        "non-zero coupling after directory edge resolution.",
    ).toBe(true);
  });

  it("all crossings reference valid zone IDs", () => {
    const zoneIds = new Set(zones.zones.map((z) => z.id));
    for (const crossing of zones.crossings) {
      expect(
        zoneIds.has(crossing.fromZone),
        `Crossing fromZone "${crossing.fromZone}" is not a valid zone ID`,
      ).toBe(true);
      expect(
        zoneIds.has(crossing.toZone),
        `Crossing toZone "${crossing.toZone}" is not a valid zone ID`,
      ).toBe(true);
    }
  });

  // ── Determinism ─────────────────────────────────────────────────────────────

  it("produces deterministic output across runs", async () => {
    const inventory = await analyzeInventory(GO_FIXTURE, {
      languageConfig: goConfig,
    });
    const imports2 = await analyzeImports(GO_FIXTURE, inventory, {
      language: "go",
    });
    const { zones: zones2 } = await analyzeZones(inventory, imports2, {
      enrich: false,
    });

    expect(zones2.zones.length).toBe(zones.zones.length);
    expect(zones2.zones.map((z) => z.id).sort()).toEqual(
      zones.zones.map((z) => z.id).sort(),
    );

    // File assignments must be identical
    for (const zone of zones.zones) {
      const zone2 = zones2.zones.find((z) => z.id === zone.id);
      expect(zone2, `Zone "${zone.id}" missing from second run`).toBeDefined();
      expect(zone2!.files.sort()).toEqual(zone.files.sort());
    }
  });
});
