import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import {
  generateZoneContext,
  buildZoneSummary,
  emitZoneOutputs,
  pruneStaleZoneFolders,
} from "../../../src/analyzers/zone-output.js";
import type {
  Inventory,
  Imports,
  ImportEdge,
  Zones,
  Zone,
  ZoneCrossing,
  Finding,
  FileEntry,
} from "../../../src/schema/index.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeFileEntry(path: string, overrides?: Partial<FileEntry>): FileEntry {
  return {
    path,
    size: 100,
    language: "TypeScript",
    lineCount: 10,
    hash: "abc123",
    role: "source",
    category: "misc",
    ...overrides,
  };
}

function makeInventory(files: FileEntry[]): Inventory {
  return {
    files,
    summary: {
      totalFiles: files.length,
      totalLines: files.reduce((s, f) => s + f.lineCount, 0),
      byLanguage: {},
      byRole: {},
      byCategory: {},
    },
  };
}

function makeEdge(from: string, to: string, symbols = ["default"]): ImportEdge {
  return { from, to, type: "static", symbols };
}

function makeImports(edges: ImportEdge[]): Imports {
  return {
    edges,
    external: [],
    summary: {
      totalEdges: edges.length,
      totalExternal: 0,
      circularCount: 0,
      circulars: [],
      mostImported: [],
      avgImportsPerFile: 0,
    },
  };
}

function makeZone(id: string, files: string[], overrides?: Partial<Zone>): Zone {
  return {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    description: `${files.length} files, primarily TypeScript`,
    files,
    entryPoints: [],
    cohesion: 0.8,
    coupling: 0.2,
    ...overrides,
  };
}

function makeZones(
  zones: Zone[],
  crossings: ZoneCrossing[] = [],
  opts?: { findings?: Finding[]; insights?: string[] }
): Zones {
  return {
    zones,
    crossings,
    unzoned: [],
    findings: opts?.findings,
    insights: opts?.insights,
  };
}

// ── generateZoneContext ─────────────────────────────────────────────────────

describe("generateZoneContext", () => {
  it("includes zone header with metrics", () => {
    const zone = makeZone("auth", ["src/auth/login.ts", "src/auth/session.ts"], {
      cohesion: 0.85,
      coupling: 0.15,
      entryPoints: ["src/auth/login.ts"],
    });
    const inventory = makeInventory([
      makeFileEntry("src/auth/login.ts", { lineCount: 50 }),
      makeFileEntry("src/auth/session.ts", { lineCount: 30 }),
    ]);
    const imports = makeImports([]);
    const zones = makeZones([zone]);

    const result = generateZoneContext(zone, inventory, imports, zones);

    expect(result).toContain("# Auth — Zone Context");
    expect(result).toContain("`auth`");
    expect(result).toContain("Cohesion: 0.85");
    expect(result).toContain("Coupling: 0.15");
    expect(result).toContain("Entry points: src/auth/login.ts");
    expect(result).toContain("Lines: 80");
  });

  it("lists all zone files with metadata", () => {
    const zone = makeZone("core", ["src/core/a.ts", "src/core/b.ts"]);
    const inventory = makeInventory([
      makeFileEntry("src/core/a.ts", { language: "TypeScript", lineCount: 20, role: "source" }),
      makeFileEntry("src/core/b.ts", { language: "TypeScript", lineCount: 15, role: "source" }),
      makeFileEntry("src/other/c.ts"), // not in zone
    ]);
    const imports = makeImports([]);
    const zones = makeZones([zone]);

    const result = generateZoneContext(zone, inventory, imports, zones);

    expect(result).toContain("src/core/a.ts (TypeScript, 20 lines, source)");
    expect(result).toContain("src/core/b.ts (TypeScript, 15 lines, source)");
    expect(result).not.toContain("src/other/c.ts");
  });

  it("shows internal imports", () => {
    const zone = makeZone("core", ["src/core/a.ts", "src/core/b.ts"]);
    const imports = makeImports([
      makeEdge("src/core/a.ts", "src/core/b.ts", ["foo", "bar"]),
    ]);
    const inventory = makeInventory([
      makeFileEntry("src/core/a.ts"),
      makeFileEntry("src/core/b.ts"),
    ]);
    const zones = makeZones([zone]);

    const result = generateZoneContext(zone, inventory, imports, zones);

    expect(result).toContain("Internal:");
    expect(result).toContain("src/core/a.ts → src/core/b.ts {foo, bar}");
  });

  it("shows boundary crossings grouped by zone", () => {
    const coreZone = makeZone("core", ["src/core/a.ts"]);
    const authZone = makeZone("auth", ["src/auth/b.ts"]);
    const crossings: ZoneCrossing[] = [
      { from: "src/core/a.ts", to: "src/auth/b.ts", fromZone: "core", toZone: "auth" },
      { from: "src/auth/b.ts", to: "src/core/a.ts", fromZone: "auth", toZone: "core" },
    ];
    const imports = makeImports([]);
    const inventory = makeInventory([
      makeFileEntry("src/core/a.ts"),
      makeFileEntry("src/auth/b.ts"),
    ]);
    const zones = makeZones([coreZone, authZone], crossings);

    const result = generateZoneContext(coreZone, inventory, imports, zones);

    expect(result).toContain("Outgoing (this zone → other zones):");
    expect(result).toContain("→ auth:");
    expect(result).toContain("Incoming (other zones → this zone):");
    expect(result).toContain("← auth:");
  });

  it("shows zone-scoped findings", () => {
    const zone = makeZone("core", ["src/core/a.ts"]);
    const findings: Finding[] = [
      { type: "anti-pattern", pass: 1, scope: "core", text: "Too many deps", severity: "warning" },
      { type: "observation", pass: 0, scope: "global", text: "Global thing" },
      { type: "pattern", pass: 2, scope: "auth", text: "Auth pattern" },
    ];
    const inventory = makeInventory([makeFileEntry("src/core/a.ts")]);
    const imports = makeImports([]);
    const zones = makeZones([zone], [], { findings });

    const result = generateZoneContext(zone, inventory, imports, zones);

    expect(result).toContain("[anti-pattern] [warning] Too many deps");
    expect(result).not.toContain("Global thing");
    expect(result).not.toContain("Auth pattern");
  });

  it("shows zone insights", () => {
    const zone = makeZone("core", ["src/core/a.ts"], {
      insights: ["High cohesion (0.9)", "Well-structured module"],
    });
    const inventory = makeInventory([makeFileEntry("src/core/a.ts")]);
    const imports = makeImports([]);
    const zones = makeZones([zone]);

    const result = generateZoneContext(zone, inventory, imports, zones);

    expect(result).toContain("<insights>");
    expect(result).toContain("- High cohesion (0.9)");
    expect(result).toContain("- Well-structured module");
  });

  it("omits empty sections", () => {
    const zone = makeZone("core", ["src/core/a.ts"]);
    const inventory = makeInventory([makeFileEntry("src/core/a.ts")]);
    const imports = makeImports([]);
    const zones = makeZones([zone]);

    const result = generateZoneContext(zone, inventory, imports, zones);

    expect(result).not.toContain("<findings>");
    expect(result).not.toContain("<insights>");
    // No imports for this zone
    expect(result).not.toContain("<imports>");
  });

  it("shows sub-crossings section with counts grouped by zone pair", () => {
    const subA = makeZone("parent/sub-a", ["src/parent/a1.ts", "src/parent/a2.ts"]);
    const subB = makeZone("parent/sub-b", ["src/parent/b1.ts", "src/parent/b2.ts"]);
    const zone = makeZone("parent", ["src/parent/a1.ts", "src/parent/a2.ts", "src/parent/b1.ts", "src/parent/b2.ts"], {
      subZones: [subA, subB],
      subCrossings: [
        { from: "src/parent/a1.ts", to: "src/parent/b1.ts", fromZone: "parent/sub-a", toZone: "parent/sub-b" },
        { from: "src/parent/a2.ts", to: "src/parent/b2.ts", fromZone: "parent/sub-a", toZone: "parent/sub-b" },
        { from: "src/parent/b1.ts", to: "src/parent/a1.ts", fromZone: "parent/sub-b", toZone: "parent/sub-a" },
      ],
    });
    const inventory = makeInventory([
      makeFileEntry("src/parent/a1.ts"),
      makeFileEntry("src/parent/a2.ts"),
      makeFileEntry("src/parent/b1.ts"),
      makeFileEntry("src/parent/b2.ts"),
    ]);
    const imports = makeImports([]);
    const zones = makeZones([zone]);

    const result = generateZoneContext(zone, inventory, imports, zones);

    expect(result).toContain("<sub-crossings>");
    expect(result).toContain("</sub-crossings>");
    expect(result).toContain("parent/sub-a → parent/sub-b: 2");
    expect(result).toContain("parent/sub-b → parent/sub-a: 1");
  });

  it("omits sub-crossings section when no sub-crossings exist", () => {
    const subA = makeZone("parent/sub-a", ["src/parent/a1.ts"]);
    const subB = makeZone("parent/sub-b", ["src/parent/b1.ts"]);
    const zone = makeZone("parent", ["src/parent/a1.ts", "src/parent/b1.ts"], {
      subZones: [subA, subB],
    });
    const inventory = makeInventory([
      makeFileEntry("src/parent/a1.ts"),
      makeFileEntry("src/parent/b1.ts"),
    ]);
    const imports = makeImports([]);
    const zones = makeZones([zone]);

    const result = generateZoneContext(zone, inventory, imports, zones);

    expect(result).not.toContain("<sub-crossings>");
  });

  it("omits sub-crossings section when subCrossings is empty array", () => {
    const zone = makeZone("parent", ["src/parent/a1.ts"], {
      subZones: [makeZone("parent/child", ["src/parent/a1.ts"])],
      subCrossings: [],
    });
    const inventory = makeInventory([makeFileEntry("src/parent/a1.ts")]);
    const imports = makeImports([]);
    const zones = makeZones([zone]);

    const result = generateZoneContext(zone, inventory, imports, zones);

    expect(result).not.toContain("<sub-crossings>");
  });
});

// ── buildZoneSummary ────────────────────────────────────────────────────────

describe("buildZoneSummary", () => {
  it("computes correct file count and line count", () => {
    const zone = makeZone("core", ["src/a.ts", "src/b.ts"], {
      entryPoints: ["src/a.ts"],
      cohesion: 0.9,
      coupling: 0.1,
    });
    const inventory = makeInventory([
      makeFileEntry("src/a.ts", { lineCount: 100 }),
      makeFileEntry("src/b.ts", { lineCount: 200 }),
      makeFileEntry("src/c.ts", { lineCount: 50 }), // not in zone
    ]);

    const summary = buildZoneSummary(zone, inventory);

    expect(summary.id).toBe("core");
    expect(summary.name).toBe("Core");
    expect(summary.fileCount).toBe(2);
    expect(summary.lineCount).toBe(300);
    expect(summary.cohesion).toBe(0.9);
    expect(summary.coupling).toBe(0.1);
    expect(summary.entryPoints).toEqual(["src/a.ts"]);
    expect(summary.files).toEqual(["src/a.ts", "src/b.ts"]);
  });
});

// ── emitZoneOutputs ─────────────────────────────────────────────────────────

describe("emitZoneOutputs", () => {
  const tmpDir = join(process.cwd(), "tests/.tmp-zone-output-test");

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates zone directories with context.md and summary.json", () => {
    const zone = makeZone("core", ["src/a.ts", "src/b.ts"]);
    const inventory = makeInventory([
      makeFileEntry("src/a.ts", { lineCount: 50 }),
      makeFileEntry("src/b.ts", { lineCount: 30 }),
    ]);
    const imports = makeImports([
      makeEdge("src/a.ts", "src/b.ts"),
    ]);
    const zones = makeZones([zone]);

    emitZoneOutputs(tmpDir, inventory, imports, zones);

    const zoneDir = join(tmpDir, "zones", "core");
    expect(existsSync(join(zoneDir, "context.md"))).toBe(true);
    expect(existsSync(join(zoneDir, "summary.json"))).toBe(true);

    // Verify context.md content
    const context = readFileSync(join(zoneDir, "context.md"), "utf-8");
    expect(context).toContain("# Core — Zone Context");
    expect(context).toContain("src/a.ts");

    // Verify summary.json shape
    const summary = JSON.parse(readFileSync(join(zoneDir, "summary.json"), "utf-8"));
    expect(summary.id).toBe("core");
    expect(summary.fileCount).toBe(2);
    expect(summary.lineCount).toBe(80);
  });

  it("creates directories for multiple zones", () => {
    const core = makeZone("core", ["src/core/a.ts"]);
    const auth = makeZone("auth", ["src/auth/b.ts"]);
    const inventory = makeInventory([
      makeFileEntry("src/core/a.ts"),
      makeFileEntry("src/auth/b.ts"),
    ]);
    const imports = makeImports([]);
    const zones = makeZones([core, auth]);

    emitZoneOutputs(tmpDir, inventory, imports, zones);

    expect(existsSync(join(tmpDir, "zones", "core", "context.md"))).toBe(true);
    expect(existsSync(join(tmpDir, "zones", "auth", "context.md"))).toBe(true);
    expect(existsSync(join(tmpDir, "zones", "core", "summary.json"))).toBe(true);
    expect(existsSync(join(tmpDir, "zones", "auth", "summary.json"))).toBe(true);
  });

  it("handles zones with no imports gracefully", () => {
    const zone = makeZone("isolated", ["src/isolated/a.ts"]);
    const inventory = makeInventory([makeFileEntry("src/isolated/a.ts")]);
    const imports = makeImports([]);
    const zones = makeZones([zone]);

    emitZoneOutputs(tmpDir, inventory, imports, zones);

    const context = readFileSync(join(tmpDir, "zones", "isolated", "context.md"), "utf-8");
    expect(context).toContain("# Isolated — Zone Context");
    expect(context).not.toContain("<imports>");
  });

  it("emits sub-zones to nested directories", () => {
    const subZone1 = makeZone("parent/child1", ["src/parent/child1/a.ts"]);
    const subZone2 = makeZone("parent/child2", ["src/parent/child2/b.ts"]);
    const parentZone = makeZone("parent", ["src/parent/main.ts"], {
      subZones: [subZone1, subZone2],
    });

    const inventory = makeInventory([
      makeFileEntry("src/parent/main.ts"),
      makeFileEntry("src/parent/child1/a.ts"),
      makeFileEntry("src/parent/child2/b.ts"),
    ]);
    const imports = makeImports([]);
    const zones = makeZones([parentZone]);

    emitZoneOutputs(tmpDir, inventory, imports, zones);

    // Parent zone files
    expect(existsSync(join(tmpDir, "zones", "parent", "context.md"))).toBe(true);
    expect(existsSync(join(tmpDir, "zones", "parent", "summary.json"))).toBe(true);

    // Sub-zone directories should be nested under parent/zones/
    expect(existsSync(join(tmpDir, "zones", "parent", "zones", "child1", "context.md"))).toBe(true);
    expect(existsSync(join(tmpDir, "zones", "parent", "zones", "child1", "summary.json"))).toBe(true);
    expect(existsSync(join(tmpDir, "zones", "parent", "zones", "child2", "context.md"))).toBe(true);
    expect(existsSync(join(tmpDir, "zones", "parent", "zones", "child2", "summary.json"))).toBe(true);
  });

  it("shows sub-zones section in parent context", () => {
    const subZone = makeZone("parent/child", ["src/parent/child/a.ts"], {
      cohesion: 0.9,
      coupling: 0.1,
    });
    const parentZone = makeZone("parent", ["src/parent/main.ts"], {
      subZones: [subZone],
    });

    const inventory = makeInventory([
      makeFileEntry("src/parent/main.ts"),
      makeFileEntry("src/parent/child/a.ts"),
    ]);
    const imports = makeImports([]);
    const zones = makeZones([parentZone]);

    emitZoneOutputs(tmpDir, inventory, imports, zones);

    const context = readFileSync(join(tmpDir, "zones", "parent", "context.md"), "utf-8");
    expect(context).toContain("<sub-zones>");
    expect(context).toContain("This zone has 1 sub-zone(s)");
    expect(context).toContain("**Parent/child**"); // Name derived from ID
    expect(context).toContain("`parent/child`");
    expect(context).toContain("cohesion 0.9");
  });

  it("prunes stale zone folders from previous runs", () => {
    const zonesDir = join(tmpDir, "zones");

    // Simulate previous run: create stale folders
    mkdirSync(join(zonesDir, "old-zone"), { recursive: true });
    writeFileSync(join(zonesDir, "old-zone", "context.md"), "stale");
    mkdirSync(join(zonesDir, "another-stale"), { recursive: true });
    writeFileSync(join(zonesDir, "another-stale", "summary.json"), "{}");

    // Current run has only "core" zone
    const zone = makeZone("core", ["src/a.ts"]);
    const inventory = makeInventory([makeFileEntry("src/a.ts")]);
    const imports = makeImports([]);
    const zones = makeZones([zone]);

    emitZoneOutputs(tmpDir, inventory, imports, zones);

    // Active zone should exist
    expect(existsSync(join(zonesDir, "core", "context.md"))).toBe(true);
    // Stale folders should be removed
    expect(existsSync(join(zonesDir, "old-zone"))).toBe(false);
    expect(existsSync(join(zonesDir, "another-stale"))).toBe(false);
  });

  it("preserves zone folders that match current zones", () => {
    const zonesDir = join(tmpDir, "zones");

    // Pre-create folders for both current zones
    mkdirSync(join(zonesDir, "core"), { recursive: true });
    writeFileSync(join(zonesDir, "core", "context.md"), "old content");
    mkdirSync(join(zonesDir, "auth"), { recursive: true });
    writeFileSync(join(zonesDir, "auth", "context.md"), "old content");

    const core = makeZone("core", ["src/a.ts"]);
    const auth = makeZone("auth", ["src/b.ts"]);
    const inventory = makeInventory([
      makeFileEntry("src/a.ts"),
      makeFileEntry("src/b.ts"),
    ]);
    const imports = makeImports([]);
    const zones = makeZones([core, auth]);

    emitZoneOutputs(tmpDir, inventory, imports, zones);

    expect(existsSync(join(zonesDir, "core", "context.md"))).toBe(true);
    expect(existsSync(join(zonesDir, "auth", "context.md"))).toBe(true);
  });
});

// ── pruneStaleZoneFolders ────────────────────────────────────────────────────

describe("pruneStaleZoneFolders", () => {
  const tmpDir2 = join(process.cwd(), "tests/.tmp-prune-test");

  beforeEach(() => {
    mkdirSync(tmpDir2, { recursive: true });
  });

  afterEach(() => {
    rmSync(tmpDir2, { recursive: true, force: true });
  });

  it("does nothing when zones directory does not exist", () => {
    const zones = makeZones([makeZone("core", ["a.ts"])]);
    // Should not throw
    pruneStaleZoneFolders(join(tmpDir2, "nonexistent"), zones);
  });

  it("ignores non-directory entries", () => {
    // Create a file (not a directory) in the zones dir
    writeFileSync(join(tmpDir2, "not-a-dir.txt"), "hello");

    const zones = makeZones([makeZone("core", ["a.ts"])]);
    pruneStaleZoneFolders(tmpDir2, zones);

    // File should not be deleted (we only remove directories)
    expect(existsSync(join(tmpDir2, "not-a-dir.txt"))).toBe(true);
  });
});
