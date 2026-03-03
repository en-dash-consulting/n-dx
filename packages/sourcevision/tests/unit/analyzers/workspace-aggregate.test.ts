import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  loadWorkspaceConfig,
  saveWorkspaceConfig,
  resolveWorkspaceMembers,
  aggregateInventory,
  aggregateImports,
  aggregateZones,
  writeWorkspaceOutput,
  getWorkspaceStatus,
  resolveMembers,
} from "../../../src/analyzers/workspace-aggregate.js";
import type { SubAnalysis } from "../../../src/analyzers/workspace.js";
import type {
  Zone,
  ZoneCrossing,
  Zones,
  Inventory,
  FileEntry,
  Imports,
  ExternalImport,
  ImportEdge,
  Manifest,
  WorkspaceConfig,
} from "../../../src/schema/index.js";

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
    entryPoints: files.length > 0 ? [files[0]] : [],
    cohesion: 0.8,
    coupling: 0.2,
    ...overrides,
  };
}

function makeZones(zones: Zone[], crossings: ZoneCrossing[] = []): Zones {
  return { zones, crossings, unzoned: [] };
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

function makeImports(
  edges: ImportEdge[] = [],
  externals: ExternalImport[] = [],
): Imports {
  return {
    edges,
    external: externals,
    summary: {
      totalEdges: edges.length,
      totalExternal: externals.length,
      circularCount: 0,
      circulars: [],
      mostImported: [],
      avgImportsPerFile: 0,
    },
  };
}

function makeSubAnalysis(
  id: string,
  prefix: string,
  zones: Zone[],
  opts?: {
    externals?: ExternalImport[];
    crossings?: ZoneCrossing[];
    edges?: ImportEdge[];
    inventoryFiles?: string[];
    unzoned?: string[];
  },
): SubAnalysis {
  const allFiles = opts?.inventoryFiles ?? zones.flatMap((z) => z.files);
  return {
    id,
    prefix,
    svDir: `/workspace/${prefix}/.sourcevision`,
    manifest: makeManifest({ targetPath: `/workspace/${prefix}` }),
    zones: {
      ...makeZones(zones, opts?.crossings),
      unzoned: opts?.unzoned ?? [],
    },
    inventory: makeInventory(allFiles),
    imports: makeImports(opts?.edges, opts?.externals),
  };
}

// ── Temp dir management ─────────────────────────────────────────────────────

let tmpDir: string;

function createTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "sv-ws-test-"));
}

function setupMemberDir(
  rootDir: string,
  memberPath: string,
  manifest?: Manifest,
  zones?: Zones,
  inventory?: Inventory,
): void {
  const memberDir = join(rootDir, memberPath);
  const svDir = join(memberDir, ".sourcevision");
  mkdirSync(svDir, { recursive: true });

  writeFileSync(
    join(svDir, "manifest.json"),
    JSON.stringify(manifest ?? makeManifest({ targetPath: memberDir }), null, 2),
  );

  if (zones) {
    writeFileSync(join(svDir, "zones.json"), JSON.stringify(zones, null, 2));
  }
  if (inventory) {
    writeFileSync(join(svDir, "inventory.json"), JSON.stringify(inventory, null, 2));
  }
}

// ── loadWorkspaceConfig ─────────────────────────────────────────────────────

describe("loadWorkspaceConfig", () => {
  beforeEach(() => { tmpDir = createTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("returns null when .n-dx.json does not exist", () => {
    expect(loadWorkspaceConfig(tmpDir)).toBeNull();
  });

  it("returns null when .n-dx.json has no sourcevision key", () => {
    writeFileSync(join(tmpDir, ".n-dx.json"), JSON.stringify({ rex: {} }));
    expect(loadWorkspaceConfig(tmpDir)).toBeNull();
  });

  it("returns null when sourcevision has no workspace key", () => {
    writeFileSync(join(tmpDir, ".n-dx.json"), JSON.stringify({
      sourcevision: { archetypes: {} },
    }));
    expect(loadWorkspaceConfig(tmpDir)).toBeNull();
  });

  it("returns null when workspace has no members array", () => {
    writeFileSync(join(tmpDir, ".n-dx.json"), JSON.stringify({
      sourcevision: { workspace: {} },
    }));
    expect(loadWorkspaceConfig(tmpDir)).toBeNull();
  });

  it("loads workspace config with members", () => {
    const config: WorkspaceConfig = {
      members: [
        { path: "packages/api", name: "api" },
        { path: "packages/web" },
      ],
    };
    writeFileSync(join(tmpDir, ".n-dx.json"), JSON.stringify({
      sourcevision: { workspace: config },
    }));

    const result = loadWorkspaceConfig(tmpDir);
    expect(result).toEqual(config);
  });

  it("returns config with empty members array", () => {
    writeFileSync(join(tmpDir, ".n-dx.json"), JSON.stringify({
      sourcevision: { workspace: { members: [] } },
    }));

    const result = loadWorkspaceConfig(tmpDir);
    expect(result).toEqual({ members: [] });
  });
});

// ── saveWorkspaceConfig ─────────────────────────────────────────────────────

describe("saveWorkspaceConfig", () => {
  beforeEach(() => { tmpDir = createTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("creates .n-dx.json when it does not exist", () => {
    saveWorkspaceConfig(tmpDir, { members: [{ path: "packages/api" }] });

    const result = loadWorkspaceConfig(tmpDir);
    expect(result).toEqual({ members: [{ path: "packages/api" }] });
  });

  it("preserves existing config keys", () => {
    writeFileSync(join(tmpDir, ".n-dx.json"), JSON.stringify({
      rex: { someKey: "value" },
      sourcevision: { archetypes: { custom: [] } },
    }));

    saveWorkspaceConfig(tmpDir, { members: [{ path: "packages/web" }] });

    const raw = JSON.parse(
      require("node:fs").readFileSync(join(tmpDir, ".n-dx.json"), "utf-8"),
    );
    expect(raw.rex).toEqual({ someKey: "value" });
    expect(raw.sourcevision.archetypes).toEqual({ custom: [] });
    expect(raw.sourcevision.workspace.members).toEqual([{ path: "packages/web" }]);
  });
});

// ── resolveWorkspaceMembers ─────────────────────────────────────────────────

describe("resolveWorkspaceMembers", () => {
  beforeEach(() => { tmpDir = createTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("loads members with manifest, zones, inventory", () => {
    const zones = makeZones([makeZone("core", ["src/index.ts"])]);
    const inventory = makeInventory(["src/index.ts"]);
    setupMemberDir(tmpDir, "packages/api", undefined, zones, inventory);

    const members = resolveWorkspaceMembers(tmpDir, {
      members: [{ path: "packages/api", name: "api" }],
    });

    expect(members).toHaveLength(1);
    expect(members[0].id).toBe("api");
    expect(members[0].prefix).toBe("packages/api");
    expect(members[0].zones).toBeDefined();
    expect(members[0].inventory).toBeDefined();
  });

  it("throws when member has no .sourcevision/manifest.json", () => {
    mkdirSync(join(tmpDir, "packages/api"), { recursive: true });

    expect(() =>
      resolveWorkspaceMembers(tmpDir, {
        members: [{ path: "packages/api" }],
      }),
    ).toThrow(/has not been analyzed/);
  });

  it("uses directory basename as name when not specified", () => {
    setupMemberDir(tmpDir, "packages/my-api");

    const members = resolveWorkspaceMembers(tmpDir, {
      members: [{ path: "packages/my-api" }],
    });

    expect(members[0].id).toBe("my-api");
  });

  it("sorts members by prefix", () => {
    setupMemberDir(tmpDir, "packages/web");
    setupMemberDir(tmpDir, "packages/api");

    const members = resolveWorkspaceMembers(tmpDir, {
      members: [
        { path: "packages/web" },
        { path: "packages/api" },
      ],
    });

    expect(members[0].prefix).toBe("packages/api");
    expect(members[1].prefix).toBe("packages/web");
  });
});

// ── aggregateInventory ──────────────────────────────────────────────────────

describe("aggregateInventory", () => {
  it("prefixes file paths with member prefix", () => {
    const api = makeSubAnalysis("api", "packages/api", [
      makeZone("core", ["src/index.ts", "src/utils.ts"]),
    ]);

    const result = aggregateInventory([api]);

    expect(result.files.map((f) => f.path)).toEqual([
      "packages/api/src/index.ts",
      "packages/api/src/utils.ts",
    ]);
  });

  it("merges inventories from multiple members", () => {
    const api = makeSubAnalysis("api", "packages/api", [
      makeZone("core", ["src/index.ts"]),
    ]);
    const web = makeSubAnalysis("web", "packages/web", [
      makeZone("ui", ["src/app.tsx"]),
    ]);

    const result = aggregateInventory([api, web]);

    expect(result.files).toHaveLength(2);
    expect(result.summary.totalFiles).toBe(2);
  });

  it("computes correct summary", () => {
    const api = makeSubAnalysis("api", "packages/api", [
      makeZone("core", ["src/index.ts", "src/utils.ts"]),
    ]);

    const result = aggregateInventory([api]);

    expect(result.summary.totalFiles).toBe(2);
    expect(result.summary.totalLines).toBe(20); // 10 lines per file
    expect(result.summary.byLanguage.TypeScript).toBe(2);
  });

  it("sorts files by path", () => {
    const api = makeSubAnalysis("api", "packages/api", [
      makeZone("core", ["src/z.ts", "src/a.ts"]),
    ]);

    const result = aggregateInventory([api]);

    expect(result.files[0].path).toBe("packages/api/src/a.ts");
    expect(result.files[1].path).toBe("packages/api/src/z.ts");
  });

  it("handles members with no inventory", () => {
    const api: SubAnalysis = {
      id: "api",
      prefix: "packages/api",
      svDir: "/test/.sourcevision",
      manifest: makeManifest(),
    };

    const result = aggregateInventory([api]);
    expect(result.files).toHaveLength(0);
  });
});

// ── aggregateImports ────────────────────────────────────────────────────────

describe("aggregateImports", () => {
  it("prefixes internal edge paths", () => {
    const api = makeSubAnalysis("api", "packages/api", [], {
      edges: [
        { from: "src/index.ts", to: "src/utils.ts", type: "static", symbols: [] },
      ],
    });

    const result = aggregateImports([api]);

    expect(result.edges).toHaveLength(1);
    expect(result.edges[0].from).toBe("packages/api/src/index.ts");
    expect(result.edges[0].to).toBe("packages/api/src/utils.ts");
  });

  it("merges external imports with prefixed importedBy", () => {
    const api = makeSubAnalysis("api", "packages/api", [], {
      externals: [
        { package: "lodash", importedBy: ["src/utils.ts"], symbols: ["get"] },
      ],
    });
    const web = makeSubAnalysis("web", "packages/web", [], {
      externals: [
        { package: "lodash", importedBy: ["src/app.tsx"], symbols: ["map"] },
      ],
    });

    const result = aggregateImports([api, web]);

    expect(result.external).toHaveLength(1);
    expect(result.external[0].package).toBe("lodash");
    expect(result.external[0].importedBy).toContain("packages/api/src/utils.ts");
    expect(result.external[0].importedBy).toContain("packages/web/src/app.tsx");
    expect(result.external[0].symbols).toContain("get");
    expect(result.external[0].symbols).toContain("map");
  });

  it("handles members with no imports", () => {
    const api: SubAnalysis = {
      id: "api",
      prefix: "packages/api",
      svDir: "/test/.sourcevision",
      manifest: makeManifest(),
    };

    const result = aggregateImports([api]);
    expect(result.edges).toHaveLength(0);
    expect(result.external).toHaveLength(0);
  });

  it("computes summary with most imported files", () => {
    const api = makeSubAnalysis("api", "packages/api", [], {
      edges: [
        { from: "src/a.ts", to: "src/utils.ts", type: "static", symbols: [] },
        { from: "src/b.ts", to: "src/utils.ts", type: "static", symbols: [] },
      ],
    });

    const result = aggregateImports([api]);

    expect(result.summary.totalEdges).toBe(2);
    expect(result.summary.mostImported[0].path).toBe("packages/api/src/utils.ts");
    expect(result.summary.mostImported[0].count).toBe(2);
  });
});

// ── aggregateZones ──────────────────────────────────────────────────────────

describe("aggregateZones", () => {
  it("promotes zones with prefixed IDs", () => {
    const api = makeSubAnalysis("api", "packages/api", [
      makeZone("core", ["src/index.ts"]),
    ]);

    const result = aggregateZones([api]);

    expect(result.zones).toHaveLength(1);
    expect(result.zones[0].id).toBe("api:core");
  });

  it("prefixes zone file paths", () => {
    const api = makeSubAnalysis("api", "packages/api", [
      makeZone("core", ["src/index.ts", "src/utils.ts"]),
    ]);

    const result = aggregateZones([api]);

    expect(result.zones[0].files).toContain("packages/api/src/index.ts");
    expect(result.zones[0].files).toContain("packages/api/src/utils.ts");
  });

  it("promotes intra-member crossings", () => {
    const api = makeSubAnalysis("api", "packages/api", [
      makeZone("auth", ["src/auth.ts"]),
      makeZone("routes", ["src/routes.ts"]),
    ], {
      crossings: [
        { from: "src/routes.ts", to: "src/auth.ts", fromZone: "routes", toZone: "auth" },
      ],
    });

    const result = aggregateZones([api]);

    expect(result.crossings.length).toBeGreaterThanOrEqual(1);
    const crossing = result.crossings.find(
      (c) => c.fromZone === "api:routes" && c.toZone === "api:auth",
    );
    expect(crossing).toBeDefined();
    expect(crossing!.from).toBe("packages/api/src/routes.ts");
  });

  it("prefixes unzoned files", () => {
    const api = makeSubAnalysis("api", "packages/api", [
      makeZone("core", ["src/index.ts"]),
    ], { unzoned: ["README.md"] });

    const result = aggregateZones([api]);

    expect(result.unzoned).toContain("packages/api/README.md");
  });

  it("merges zones from multiple members", () => {
    const api = makeSubAnalysis("api", "packages/api", [
      makeZone("core", ["src/index.ts"]),
    ]);
    const web = makeSubAnalysis("web", "packages/web", [
      makeZone("ui", ["src/app.tsx"]),
    ]);

    const result = aggregateZones([api, web]);

    expect(result.zones).toHaveLength(2);
    expect(result.zones.map((z) => z.id).sort()).toEqual(["api:core", "web:ui"]);
  });

  it("handles members with no zones", () => {
    const api: SubAnalysis = {
      id: "api",
      prefix: "packages/api",
      svDir: "/test/.sourcevision",
      manifest: makeManifest(),
    };

    const result = aggregateZones([api]);
    expect(result.zones).toHaveLength(0);
  });
});

// ── writeWorkspaceOutput ────────────────────────────────────────────────────

describe("writeWorkspaceOutput", () => {
  beforeEach(() => { tmpDir = createTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("writes all output files", () => {
    const api = makeSubAnalysis("api", "packages/api", [
      makeZone("core", ["src/index.ts"]),
    ]);

    const result = writeWorkspaceOutput(tmpDir, [api]);

    const fs = require("node:fs");
    const svDir = join(tmpDir, ".sourcevision");
    expect(fs.existsSync(join(svDir, "manifest.json"))).toBe(true);
    expect(fs.existsSync(join(svDir, "inventory.json"))).toBe(true);
    expect(fs.existsSync(join(svDir, "imports.json"))).toBe(true);
    expect(fs.existsSync(join(svDir, "zones.json"))).toBe(true);

    expect(result.zoneCount).toBe(1);
    expect(result.fileCount).toBe(1);
  });

  it("sets workspace: true in manifest", () => {
    const api = makeSubAnalysis("api", "packages/api", [
      makeZone("core", ["src/index.ts"]),
    ]);

    writeWorkspaceOutput(tmpDir, [api]);

    const fs = require("node:fs");
    const manifest = JSON.parse(
      fs.readFileSync(join(tmpDir, ".sourcevision/manifest.json"), "utf-8"),
    );
    expect(manifest.workspace).toBe(true);
  });

  it("includes children refs in manifest", () => {
    const api = makeSubAnalysis("api", "packages/api", [
      makeZone("core", ["src/index.ts"]),
    ]);
    const web = makeSubAnalysis("web", "packages/web", [
      makeZone("ui", ["src/app.tsx"]),
    ]);

    writeWorkspaceOutput(tmpDir, [api, web]);

    const fs = require("node:fs");
    const manifest = JSON.parse(
      fs.readFileSync(join(tmpDir, ".sourcevision/manifest.json"), "utf-8"),
    );
    expect(manifest.children).toHaveLength(2);
    expect(manifest.children[0].id).toBe("api");
    expect(manifest.children[1].id).toBe("web");
  });

  it("generates llms.txt and CONTEXT.md", () => {
    const api = makeSubAnalysis("api", "packages/api", [
      makeZone("core", ["src/index.ts"]),
    ]);

    writeWorkspaceOutput(tmpDir, [api]);

    const fs = require("node:fs");
    const svDir = join(tmpDir, ".sourcevision");
    expect(fs.existsSync(join(svDir, "llms.txt"))).toBe(true);
    expect(fs.existsSync(join(svDir, "CONTEXT.md"))).toBe(true);
  });
});

// ── getWorkspaceStatus ──────────────────────────────────────────────────────

describe("getWorkspaceStatus", () => {
  beforeEach(() => { tmpDir = createTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("reports analyzed members", () => {
    setupMemberDir(tmpDir, "packages/api", makeManifest({
      analyzedAt: "2024-06-01T00:00:00Z",
    }));

    const status = getWorkspaceStatus(tmpDir, {
      members: [{ path: "packages/api", name: "api" }],
    });

    expect(status).toHaveLength(1);
    expect(status[0].analyzed).toBe(true);
    expect(status[0].analyzedAt).toBe("2024-06-01T00:00:00Z");
  });

  it("reports unanalyzed members", () => {
    mkdirSync(join(tmpDir, "packages/api"), { recursive: true });

    const status = getWorkspaceStatus(tmpDir, {
      members: [{ path: "packages/api", name: "api" }],
    });

    expect(status).toHaveLength(1);
    expect(status[0].analyzed).toBe(false);
  });

  it("reports zone and file counts", () => {
    const zones = makeZones([
      makeZone("core", ["src/a.ts", "src/b.ts"]),
      makeZone("utils", ["src/c.ts"]),
    ]);
    const inventory = makeInventory(["src/a.ts", "src/b.ts", "src/c.ts"]);
    setupMemberDir(tmpDir, "packages/api", undefined, zones, inventory);

    const status = getWorkspaceStatus(tmpDir, {
      members: [{ path: "packages/api", name: "api" }],
    });

    expect(status[0].zoneCount).toBe(2);
    expect(status[0].fileCount).toBe(3);
  });

  it("uses directory basename when name not specified", () => {
    setupMemberDir(tmpDir, "packages/my-api");

    const status = getWorkspaceStatus(tmpDir, {
      members: [{ path: "packages/my-api" }],
    });

    expect(status[0].name).toBe("my-api");
  });
});

// ── resolveMembers ──────────────────────────────────────────────────────────

describe("resolveMembers", () => {
  beforeEach(() => { tmpDir = createTmpDir(); });
  afterEach(() => { rmSync(tmpDir, { recursive: true, force: true }); });

  it("returns null when no config and no sub-analyses", () => {
    expect(resolveMembers(tmpDir)).toBeNull();
  });

  it("uses config when available", () => {
    setupMemberDir(tmpDir, "packages/api");
    writeFileSync(join(tmpDir, ".n-dx.json"), JSON.stringify({
      sourcevision: {
        workspace: {
          members: [{ path: "packages/api", name: "api" }],
        },
      },
    }));

    const result = resolveMembers(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.source).toBe("config");
    expect(result!.members).toHaveLength(1);
  });

  it("falls back to auto-detection when no config", () => {
    // Set up a nested .sourcevision dir
    setupMemberDir(tmpDir, "packages/api");

    const result = resolveMembers(tmpDir);
    expect(result).not.toBeNull();
    expect(result!.source).toBe("auto-detect");
  });

  it("prefers config over auto-detection", () => {
    // Both exist: config and auto-detected sub-analysis
    setupMemberDir(tmpDir, "packages/api");
    setupMemberDir(tmpDir, "packages/web");
    writeFileSync(join(tmpDir, ".n-dx.json"), JSON.stringify({
      sourcevision: {
        workspace: {
          members: [{ path: "packages/api", name: "api" }],
        },
      },
    }));

    const result = resolveMembers(tmpDir);
    expect(result!.source).toBe("config");
    // Only the config member, not auto-detected
    expect(result!.members).toHaveLength(1);
    expect(result!.members[0].id).toBe("api");
  });
});
