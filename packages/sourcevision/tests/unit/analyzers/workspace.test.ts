import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  detectSubAnalyses,
  promoteZones,
  promoteCrossings,
  getSubAnalyzedFiles,
  buildSubAnalysisRefs,
  type SubAnalysis,
} from "../../../src/analyzers/workspace.js";
import type { Manifest, Zone, ZoneCrossing, Zones, Inventory, FileEntry } from "../../../src/schema/index.js";
import * as fs from "node:fs";
import * as path from "node:path";

// Mock node:fs
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    existsSync: vi.fn(actual.existsSync),
    readdirSync: vi.fn(actual.readdirSync),
    readFileSync: vi.fn(actual.readFileSync),
    statSync: vi.fn(actual.statSync),
  };
});

const mockedExistsSync = vi.mocked(fs.existsSync);
const mockedReaddirSync = vi.mocked(fs.readdirSync);
const mockedReadFileSync = vi.mocked(fs.readFileSync);
const mockedStatSync = vi.mocked(fs.statSync);

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeManifest(overrides?: Partial<Manifest>): Manifest {
  return {
    schemaVersion: "1.0.0",
    toolVersion: "0.1.0",
    analyzedAt: "2024-01-01T00:00:00Z",
    targetPath: "/test",
    modules: {},
    ...overrides,
  };
}

function makeZone(id: string, files: string[], overrides?: Partial<Zone>): Zone {
  return {
    id,
    name: id.charAt(0).toUpperCase() + id.slice(1),
    description: `${files.length} files`,
    files,
    entryPoints: [files[0]],
    cohesion: 0.8,
    coupling: 0.2,
    ...overrides,
  };
}

function makeZones(zones: Zone[], crossings: ZoneCrossing[] = []): Zones {
  return {
    zones,
    crossings,
    unzoned: [],
  };
}

function makeFileEntry(filePath: string): FileEntry {
  return {
    path: filePath,
    size: 100,
    language: "TypeScript",
    lineCount: 10,
    hash: "abc123",
    role: "source",
    category: "misc",
  };
}

function makeInventory(files: string[]): Inventory {
  return {
    files: files.map(makeFileEntry),
    summary: {
      totalFiles: files.length,
      totalLines: files.length * 10,
      byLanguage: {},
      byRole: {},
      byCategory: {},
    },
  };
}

function makeSubAnalysis(id: string, prefix: string, zones: Zone[]): SubAnalysis {
  return {
    id,
    prefix,
    svDir: `${prefix}/.sourcevision`,
    manifest: makeManifest({ targetPath: prefix }),
    zones: makeZones(zones),
    inventory: makeInventory(zones.flatMap((z) => z.files)),
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("promoteZones", () => {
  it("prefixes zone IDs with sub-analysis ID", () => {
    const sub = makeSubAnalysis("packages-rex", "packages/rex", [
      makeZone("api", ["src/api/routes.ts", "src/api/handlers.ts"]),
      makeZone("core", ["src/core/engine.ts"]),
    ]);

    const promoted = promoteZones(sub);

    expect(promoted).toHaveLength(2);
    expect(promoted[0].id).toBe("packages-rex:api");
    expect(promoted[1].id).toBe("packages-rex:core");
  });

  it("prefixes file paths with sub-analysis prefix", () => {
    const sub = makeSubAnalysis("packages-rex", "packages/rex", [
      makeZone("api", ["src/api/routes.ts", "src/api/handlers.ts"]),
    ]);

    const promoted = promoteZones(sub);

    expect(promoted[0].files).toEqual([
      "packages/rex/src/api/routes.ts",
      "packages/rex/src/api/handlers.ts",
    ]);
    expect(promoted[0].entryPoints).toEqual(["packages/rex/src/api/routes.ts"]);
  });

  it("sets childId and depth on promoted zones", () => {
    const sub = makeSubAnalysis("packages-rex", "packages/rex", [
      makeZone("api", ["src/api.ts"]),
    ]);

    const promoted = promoteZones(sub);

    expect(promoted[0].childId).toBe("packages-rex");
    expect(promoted[0].depth).toBe(1);
  });

  it("returns empty array if no zones", () => {
    const sub: SubAnalysis = {
      id: "empty",
      prefix: "empty",
      svDir: "empty/.sourcevision",
      manifest: makeManifest(),
    };

    const promoted = promoteZones(sub);
    expect(promoted).toEqual([]);
  });
});

describe("promoteCrossings", () => {
  it("prefixes zone IDs in crossings", () => {
    const sub = makeSubAnalysis("packages-rex", "packages/rex", [
      makeZone("api", ["src/api/routes.ts"]),
      makeZone("core", ["src/core/engine.ts"]),
    ]);
    sub.zones!.crossings = [
      { from: "src/api/routes.ts", to: "src/core/engine.ts", fromZone: "api", toZone: "core" },
    ];

    const promoted = promoteCrossings(sub);

    expect(promoted).toHaveLength(1);
    expect(promoted[0].fromZone).toBe("packages-rex:api");
    expect(promoted[0].toZone).toBe("packages-rex:core");
  });

  it("prefixes file paths in crossings", () => {
    const sub = makeSubAnalysis("packages-rex", "packages/rex", [
      makeZone("api", ["src/api/routes.ts"]),
      makeZone("core", ["src/core/engine.ts"]),
    ]);
    sub.zones!.crossings = [
      { from: "src/api/routes.ts", to: "src/core/engine.ts", fromZone: "api", toZone: "core" },
    ];

    const promoted = promoteCrossings(sub);

    expect(promoted[0].from).toBe("packages/rex/src/api/routes.ts");
    expect(promoted[0].to).toBe("packages/rex/src/core/engine.ts");
  });

  it("returns empty array if no crossings", () => {
    const sub = makeSubAnalysis("packages-rex", "packages/rex", []);

    const promoted = promoteCrossings(sub);
    expect(promoted).toEqual([]);
  });
});

describe("getSubAnalyzedFiles", () => {
  it("returns all files from sub-analysis inventories", () => {
    const subAnalyses = [
      makeSubAnalysis("packages-rex", "packages/rex", [
        makeZone("api", ["src/api.ts", "src/handlers.ts"]),
      ]),
      makeSubAnalysis("packages-hench", "packages/hench", [
        makeZone("core", ["src/core.ts"]),
      ]),
    ];

    const files = getSubAnalyzedFiles(subAnalyses);

    expect(files.size).toBe(3);
    expect(files.has("packages/rex/src/api.ts")).toBe(true);
    expect(files.has("packages/rex/src/handlers.ts")).toBe(true);
    expect(files.has("packages/hench/src/core.ts")).toBe(true);
  });

  it("falls back to zone files if inventory unavailable", () => {
    const sub: SubAnalysis = {
      id: "packages-rex",
      prefix: "packages/rex",
      svDir: "packages/rex/.sourcevision",
      manifest: makeManifest(),
      zones: makeZones([makeZone("api", ["src/api.ts"])]),
      // No inventory
    };

    const files = getSubAnalyzedFiles([sub]);

    expect(files.size).toBe(1);
    expect(files.has("packages/rex/src/api.ts")).toBe(true);
  });

  it("returns empty set for empty sub-analyses", () => {
    const files = getSubAnalyzedFiles([]);
    expect(files.size).toBe(0);
  });
});

describe("buildSubAnalysisRefs", () => {
  it("builds refs with id, prefix, and manifestPath", () => {
    const subAnalyses = [
      makeSubAnalysis("packages-rex", "packages/rex", []),
      makeSubAnalysis("packages-hench", "packages/hench", []),
    ];

    const refs = buildSubAnalysisRefs(subAnalyses);

    expect(refs).toHaveLength(2);
    expect(refs[0]).toEqual({
      id: "packages-rex",
      prefix: "packages/rex",
      manifestPath: "packages/rex/.sourcevision/manifest.json",
    });
    expect(refs[1]).toEqual({
      id: "packages-hench",
      prefix: "packages/hench",
      manifestPath: "packages/hench/.sourcevision/manifest.json",
    });
  });
});

describe("detectSubAnalyses", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.resetAllMocks();
  });

  it("returns empty array when no sub-analyses exist", () => {
    mockedReaddirSync.mockReturnValue([]);

    const result = detectSubAnalyses("/root");

    expect(result).toEqual([]);
  });

  it("detects a subdirectory with .sourcevision", () => {
    const n = (s: string) => s.replace(/\\/g, "/");
    // Root directory
    mockedReaddirSync.mockImplementation((dir: any) => {
      const d = n(String(dir));
      if (d === "/root") return ["packages"] as any;
      if (d === "/root/packages") return ["rex"] as any;
      if (d === "/root/packages/rex") return [".sourcevision"] as any;
      return [] as any;
    });

    mockedStatSync.mockImplementation((p: any) => {
      return { isDirectory: () => true } as any;
    });

    mockedExistsSync.mockImplementation((p: any) => {
      const s = n(String(p));
      if (s === "/root/packages/rex/.sourcevision") return true;
      if (s === "/root/packages/rex/.sourcevision/manifest.json") return true;
      return false;
    });

    const manifest = makeManifest({ targetPath: "/root/packages/rex" });
    mockedReadFileSync.mockImplementation((p: any) => {
      if (String(p).includes("manifest.json")) {
        return JSON.stringify(manifest);
      }
      return "";
    });

    const result = detectSubAnalyses("/root");

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("packages-rex");
    expect(result[0].prefix).toBe("packages/rex");
  });

  it("skips excluded directories like node_modules", () => {
    const n = (s: string) => s.replace(/\\/g, "/");
    mockedReaddirSync.mockImplementation((dir: any) => {
      const d = n(String(dir));
      if (d === "/root") return ["node_modules", "packages"] as any;
      if (d === "/root/packages") return ["rex"] as any;
      return [] as any;
    });

    mockedStatSync.mockImplementation((p: any) => {
      return { isDirectory: () => true } as any;
    });

    mockedExistsSync.mockReturnValue(false);

    const result = detectSubAnalyses("/root");

    // Should not try to read node_modules — check with normalized path
    const readdirCalls = mockedReaddirSync.mock.calls.map((c) => n(String(c[0])));
    expect(readdirCalls).not.toContain("/root/node_modules");
    expect(result).toEqual([]);
  });

  it("skips root .sourcevision directory", () => {
    const n = (s: string) => s.replace(/\\/g, "/");
    mockedReaddirSync.mockImplementation((dir: any) => {
      const d = n(String(dir));
      if (d === "/root") return [".sourcevision", "packages"] as any;
      if (d === "/root/packages") return [] as any;
      return [] as any;
    });

    mockedStatSync.mockImplementation((p: any) => {
      return { isDirectory: () => true } as any;
    });

    mockedExistsSync.mockReturnValue(false);

    const result = detectSubAnalyses("/root");

    // Root's .sourcevision should be skipped
    expect(result).toEqual([]);
  });

  it("loads zones and inventory if available", () => {
    const n = (s: string) => s.replace(/\\/g, "/");
    mockedReaddirSync.mockImplementation((dir: any) => {
      const d = n(String(dir));
      if (d === "/root") return ["packages"] as any;
      if (d === "/root/packages") return ["rex"] as any;
      if (d === "/root/packages/rex") return [".sourcevision"] as any;
      return [] as any;
    });

    mockedStatSync.mockImplementation(() => ({ isDirectory: () => true } as any));

    mockedExistsSync.mockImplementation((p: any) => {
      const pathStr = n(String(p));
      return (
        pathStr.includes(".sourcevision") ||
        pathStr.includes("manifest.json") ||
        pathStr.includes("zones.json") ||
        pathStr.includes("inventory.json")
      );
    });

    const manifest = makeManifest();
    const zones = makeZones([makeZone("api", ["src/api.ts"])]);
    const inventory = makeInventory(["src/api.ts"]);

    mockedReadFileSync.mockImplementation((p: any) => {
      const pathStr = n(String(p));
      if (pathStr.includes("manifest.json")) return JSON.stringify(manifest);
      if (pathStr.includes("zones.json")) return JSON.stringify(zones);
      if (pathStr.includes("inventory.json")) return JSON.stringify(inventory);
      return "";
    });

    const result = detectSubAnalyses("/root");

    expect(result).toHaveLength(1);
    expect(result[0].zones).toBeDefined();
    expect(result[0].inventory).toBeDefined();
  });

  it("sorts results by prefix", () => {
    const n = (s: string) => s.replace(/\\/g, "/");
    // Setup: /root/packages/{zulu,alpha}/.sourcevision/
    mockedReaddirSync.mockImplementation((dir: any) => {
      const d = n(String(dir));
      if (d === "/root") return ["packages"] as any;
      if (d === "/root/packages") return ["zulu", "alpha"] as any;
      // Return empty for subdirs so it checks for .sourcevision inside them
      return [] as any;
    });

    mockedStatSync.mockImplementation(() => ({ isDirectory: () => true } as any));

    mockedExistsSync.mockImplementation((p: any) => {
      const pathStr = n(String(p));
      // .sourcevision dirs exist inside alpha and zulu
      if (pathStr === "/root/packages/alpha/.sourcevision") return true;
      if (pathStr === "/root/packages/zulu/.sourcevision") return true;
      if (pathStr === "/root/packages/alpha/.sourcevision/manifest.json") return true;
      if (pathStr === "/root/packages/zulu/.sourcevision/manifest.json") return true;
      return false;
    });

    const manifest = makeManifest();
    mockedReadFileSync.mockReturnValue(JSON.stringify(manifest));

    const result = detectSubAnalyses("/root");

    expect(result).toHaveLength(2);
    expect(result[0].prefix).toBe("packages/alpha");
    expect(result[1].prefix).toBe("packages/zulu");
  });
});
