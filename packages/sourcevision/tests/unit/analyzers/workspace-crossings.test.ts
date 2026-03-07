import { describe, it, expect, vi } from "vitest";
import {
  buildPackageMap,
  resolveEntryFile,
  computeCrossRepoCrossings,
  readMemberPackageInfo,
  type MemberPackageInfo,
} from "../../../src/analyzers/workspace-crossings.js";
import type { SubAnalysis } from "../../../src/analyzers/workspace.js";
import type {
  Zone,
  ZoneCrossing,
  Zones,
  Inventory,
  FileEntry,
  Imports,
  ExternalImport,
  Manifest,
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

function makeImports(externals: ExternalImport[] = []): Imports {
  return {
    edges: [],
    external: externals,
    summary: {
      totalEdges: 0,
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
  opts?: { externals?: ExternalImport[]; crossings?: ZoneCrossing[] },
): SubAnalysis {
  const allFiles = zones.flatMap((z) => z.files);
  return {
    id,
    prefix,
    svDir: `/workspace/${prefix}/.sourcevision`,
    manifest: makeManifest({ targetPath: `/workspace/${prefix}` }),
    zones: makeZones(zones, opts?.crossings),
    inventory: makeInventory(allFiles),
    imports: opts?.externals ? makeImports(opts.externals) : undefined,
  };
}

/** Create promoted zones from a sub-analysis (same logic as promoteZones). */
function promote(sub: SubAnalysis): Zone[] {
  if (!sub.zones?.zones) return [];
  return sub.zones.zones.map((zone) => ({
    ...zone,
    id: `${sub.id}:${zone.id}`,
    files: zone.files.map((f) => `${sub.prefix}/${f}`),
    entryPoints: zone.entryPoints.map((f) => `${sub.prefix}/${f}`),
    childId: sub.id,
    depth: 1,
  }));
}

// ── buildPackageMap ─────────────────────────────────────────────────────────

describe("buildPackageMap", () => {
  it("maps package names to members", () => {
    const api = makeSubAnalysis("api", "packages/api", [makeZone("core", ["src/index.ts"])]);
    const web = makeSubAnalysis("web", "packages/web", [makeZone("ui", ["src/app.tsx"])]);

    const infoMap = new Map<string, MemberPackageInfo>([
      ["api", { name: "@myapp/api" }],
      ["web", { name: "@myapp/web" }],
    ]);

    const result = buildPackageMap([api, web], (m) => infoMap.get(m.id) ?? null);

    expect(result.size).toBe(2);
    expect(result.get("@myapp/api")?.member).toBe(api);
    expect(result.get("@myapp/web")?.member).toBe(web);
  });

  it("handles scoped and unscoped package names", () => {
    const api = makeSubAnalysis("api", "packages/api", [makeZone("core", ["src/index.ts"])]);
    const utils = makeSubAnalysis("utils", "packages/utils", [makeZone("lib", ["src/index.ts"])]);

    const infoMap = new Map<string, MemberPackageInfo>([
      ["api", { name: "@scope/api" }],
      ["utils", { name: "my-utils" }],
    ]);

    const result = buildPackageMap([api, utils], (m) => infoMap.get(m.id) ?? null);

    expect(result.has("@scope/api")).toBe(true);
    expect(result.has("my-utils")).toBe(true);
  });

  it("includes entry file when available", () => {
    const api = makeSubAnalysis("api", "packages/api", [makeZone("core", ["src/public.ts"])]);

    const result = buildPackageMap([api], () => ({
      name: "@myapp/api",
      entryFile: "src/public.ts",
    }));

    expect(result.get("@myapp/api")?.entryFile).toBe("src/public.ts");
  });

  it("skips members without package info", () => {
    const api = makeSubAnalysis("api", "packages/api", [makeZone("core", ["src/index.ts"])]);

    const result = buildPackageMap([api], () => null);

    expect(result.size).toBe(0);
  });

  it("skips members without a name field", () => {
    const api = makeSubAnalysis("api", "packages/api", [makeZone("core", ["src/index.ts"])]);

    const result = buildPackageMap([api], () => ({ name: "" }));

    expect(result.size).toBe(0);
  });
});

// ── resolveEntryFile ────────────────────────────────────────────────────────

describe("resolveEntryFile", () => {
  const zoneFiles = ["src/public.ts", "src/core/engine.ts", "src/utils/helpers.ts"];

  it("resolves exports['.'] string to source file", () => {
    const result = resolveEntryFile(
      { exports: { ".": "./dist/public.js" } },
      zoneFiles,
    );
    expect(result).toBe("src/public.ts");
  });

  it("resolves exports['.'] import condition to source file", () => {
    const result = resolveEntryFile(
      { exports: { ".": { import: "./dist/public.js", require: "./dist/public.cjs" } } },
      zoneFiles,
    );
    expect(result).toBe("src/public.ts");
  });

  it("resolves main field to source file", () => {
    const result = resolveEntryFile(
      { main: "dist/public.js" },
      zoneFiles,
    );
    expect(result).toBe("src/public.ts");
  });

  it("resolves module field to source file", () => {
    const result = resolveEntryFile(
      { module: "dist/public.mjs" },
      zoneFiles,
    );
    expect(result).toBe("src/public.ts");
  });

  it("falls back to src/index.ts if present in zone files", () => {
    const result = resolveEntryFile({}, ["src/index.ts", "src/app.ts"]);
    expect(result).toBe("src/index.ts");
  });

  it("falls back to src/public.ts if present in zone files", () => {
    const result = resolveEntryFile({}, ["src/public.ts", "src/core.ts"]);
    expect(result).toBe("src/public.ts");
  });

  it("falls back to index.ts if present", () => {
    const result = resolveEntryFile({}, ["index.ts", "lib/core.ts"]);
    expect(result).toBe("index.ts");
  });

  it("returns null when no entry file can be resolved", () => {
    const result = resolveEntryFile({}, ["src/core/engine.ts", "src/utils/helpers.ts"]);
    expect(result).toBeNull();
  });

  it("strips leading ./ from export paths", () => {
    const result = resolveEntryFile(
      { exports: { ".": "./dist/core/engine.js" } },
      ["src/core/engine.ts"],
    );
    expect(result).toBe("src/core/engine.ts");
  });

  it("handles .mjs and .cjs extensions", () => {
    const result = resolveEntryFile(
      { main: "dist/public.mjs" },
      ["src/public.ts"],
    );
    expect(result).toBe("src/public.ts");
  });
});

// ── computeCrossRepoCrossings ───────────────────────────────────────────────

describe("computeCrossRepoCrossings", () => {
  it("creates crossings for external imports between sibling members", () => {
    const api = makeSubAnalysis("api", "packages/api", [
      makeZone("routes", ["src/routes.ts", "src/public.ts"], {
        entryPoints: ["src/public.ts"],
      }),
    ]);
    const web = makeSubAnalysis("web", "packages/web", [
      makeZone("ui", ["src/app.tsx", "src/client.ts"]),
    ], {
      externals: [
        { package: "@myapp/api", importedBy: ["src/client.ts"], symbols: ["fetchData"] },
      ],
    });

    const promotedZones = [...promote(api), ...promote(web)];
    const packageMap = new Map([
      ["@myapp/api", { member: api, entryFile: "src/public.ts" }],
    ]);

    const crossings = computeCrossRepoCrossings([api, web], promotedZones, packageMap);

    expect(crossings).toHaveLength(1);
    expect(crossings[0]).toEqual({
      from: "packages/web/src/client.ts",
      to: "packages/api/src/public.ts",
      fromZone: "web:ui",
      toZone: "api:routes",
    });
  });

  it("handles multiple importing files from one member", () => {
    const api = makeSubAnalysis("api", "packages/api", [
      makeZone("core", ["src/index.ts"]),
    ]);
    const web = makeSubAnalysis("web", "packages/web", [
      makeZone("pages", ["src/home.tsx", "src/about.tsx"]),
    ], {
      externals: [
        { package: "@myapp/api", importedBy: ["src/home.tsx", "src/about.tsx"], symbols: [] },
      ],
    });

    const promotedZones = [...promote(api), ...promote(web)];
    const packageMap = new Map([
      ["@myapp/api", { member: api, entryFile: "src/index.ts" }],
    ]);

    const crossings = computeCrossRepoCrossings([api, web], promotedZones, packageMap);

    expect(crossings).toHaveLength(2);
    expect(crossings[0].from).toBe("packages/web/src/home.tsx");
    expect(crossings[1].from).toBe("packages/web/src/about.tsx");
    expect(crossings.every((c) => c.toZone === "api:core")).toBe(true);
  });

  it("handles bidirectional cross-repo imports", () => {
    const api = makeSubAnalysis("api", "packages/api", [
      makeZone("core", ["src/api.ts"]),
    ], {
      externals: [
        { package: "@myapp/shared", importedBy: ["src/api.ts"], symbols: [] },
      ],
    });
    const shared = makeSubAnalysis("shared", "packages/shared", [
      makeZone("lib", ["src/index.ts"]),
    ], {
      externals: [
        { package: "@myapp/api", importedBy: ["src/index.ts"], symbols: [] },
      ],
    });

    const promotedZones = [...promote(api), ...promote(shared)];
    const packageMap = new Map([
      ["@myapp/api", { member: api, entryFile: "src/api.ts" }],
      ["@myapp/shared", { member: shared, entryFile: "src/index.ts" }],
    ]);

    const crossings = computeCrossRepoCrossings([api, shared], promotedZones, packageMap);

    expect(crossings).toHaveLength(2);

    const apiToShared = crossings.find((c) => c.fromZone === "api:core");
    const sharedToApi = crossings.find((c) => c.fromZone === "shared:lib");
    expect(apiToShared).toBeDefined();
    expect(apiToShared!.toZone).toBe("shared:lib");
    expect(sharedToApi).toBeDefined();
    expect(sharedToApi!.toZone).toBe("api:core");
  });

  it("resolves to target zone entry point when no explicit entry file", () => {
    const api = makeSubAnalysis("api", "packages/api", [
      makeZone("routes", ["src/routes.ts", "src/handlers.ts"], {
        entryPoints: ["src/routes.ts"],
      }),
    ]);
    const web = makeSubAnalysis("web", "packages/web", [
      makeZone("ui", ["src/app.tsx"]),
    ], {
      externals: [
        { package: "@myapp/api", importedBy: ["src/app.tsx"], symbols: [] },
      ],
    });

    const promotedZones = [...promote(api), ...promote(web)];
    // No entryFile in packageMap — should fall back to zone entry points
    const packageMap = new Map([
      ["@myapp/api", { member: api }],
    ]);

    const crossings = computeCrossRepoCrossings([api, web], promotedZones, packageMap);

    expect(crossings).toHaveLength(1);
    expect(crossings[0].toZone).toBe("api:routes");
    // The to file should be the zone's entry point (prefixed)
    expect(crossings[0].to).toBe("packages/api/src/routes.ts");
  });

  it("produces zero crossings when member has no resolvable cross-repo imports", () => {
    const api = makeSubAnalysis("api", "packages/api", [
      makeZone("core", ["src/index.ts"]),
    ], {
      externals: [
        // lodash is not a workspace member
        { package: "lodash", importedBy: ["src/index.ts"], symbols: ["get"] },
      ],
    });

    const promotedZones = promote(api);
    const packageMap = new Map<string, { member: SubAnalysis; entryFile?: string }>();

    const crossings = computeCrossRepoCrossings([api], promotedZones, packageMap);

    expect(crossings).toEqual([]);
  });

  it("skips self-imports (member importing its own package)", () => {
    const api = makeSubAnalysis("api", "packages/api", [
      makeZone("core", ["src/index.ts"]),
    ], {
      externals: [
        { package: "@myapp/api", importedBy: ["src/test.ts"], symbols: [] },
      ],
    });

    const promotedZones = promote(api);
    const packageMap = new Map([
      ["@myapp/api", { member: api, entryFile: "src/index.ts" }],
    ]);

    const crossings = computeCrossRepoCrossings([api], promotedZones, packageMap);

    expect(crossings).toEqual([]);
  });

  it("skips importing files not assigned to any zone", () => {
    const api = makeSubAnalysis("api", "packages/api", [
      makeZone("core", ["src/index.ts"]),
    ]);
    const web = makeSubAnalysis("web", "packages/web", [
      makeZone("ui", ["src/app.tsx"]),
    ], {
      externals: [
        // "src/unzoned.ts" is not in any zone
        { package: "@myapp/api", importedBy: ["src/unzoned.ts"], symbols: [] },
      ],
    });

    const promotedZones = [...promote(api), ...promote(web)];
    const packageMap = new Map([
      ["@myapp/api", { member: api, entryFile: "src/index.ts" }],
    ]);

    const crossings = computeCrossRepoCrossings([api, web], promotedZones, packageMap);

    expect(crossings).toEqual([]);
  });

  it("skips members without imports data", () => {
    const api = makeSubAnalysis("api", "packages/api", [
      makeZone("core", ["src/index.ts"]),
    ]);
    // web has no imports loaded
    const web: SubAnalysis = {
      id: "web",
      prefix: "packages/web",
      svDir: "/workspace/packages/web/.sourcevision",
      manifest: makeManifest(),
      zones: makeZones([makeZone("ui", ["src/app.tsx"])]),
      // No imports
    };

    const promotedZones = [...promote(api), ...promote(web)];
    const packageMap = new Map([
      ["@myapp/api", { member: api, entryFile: "src/index.ts" }],
    ]);

    const crossings = computeCrossRepoCrossings([api, web], promotedZones, packageMap);

    expect(crossings).toEqual([]);
  });

  it("handles multiple target zones by picking first with entry point file", () => {
    const api = makeSubAnalysis("api", "packages/api", [
      makeZone("internal", ["src/internal.ts"]),
      makeZone("public-api", ["src/public.ts", "src/types.ts"], {
        entryPoints: ["src/public.ts"],
      }),
    ]);
    const web = makeSubAnalysis("web", "packages/web", [
      makeZone("ui", ["src/app.tsx"]),
    ], {
      externals: [
        { package: "@myapp/api", importedBy: ["src/app.tsx"], symbols: [] },
      ],
    });

    const promotedZones = [...promote(api), ...promote(web)];
    const packageMap = new Map([
      ["@myapp/api", { member: api, entryFile: "src/public.ts" }],
    ]);

    const crossings = computeCrossRepoCrossings([api, web], promotedZones, packageMap);

    expect(crossings).toHaveLength(1);
    expect(crossings[0].toZone).toBe("api:public-api");
    expect(crossings[0].to).toBe("packages/api/src/public.ts");
  });

  it("uses {memberId}:{zoneId} namespace for zone IDs", () => {
    const api = makeSubAnalysis("packages-api", "packages/api", [
      makeZone("auth", ["src/auth.ts"]),
    ]);
    const web = makeSubAnalysis("packages-web", "packages/web", [
      makeZone("dashboard", ["src/dashboard.tsx"]),
    ], {
      externals: [
        { package: "@myapp/api", importedBy: ["src/dashboard.tsx"], symbols: [] },
      ],
    });

    const promotedZones = [...promote(api), ...promote(web)];
    const packageMap = new Map([
      ["@myapp/api", { member: api, entryFile: "src/auth.ts" }],
    ]);

    const crossings = computeCrossRepoCrossings([api, web], promotedZones, packageMap);

    expect(crossings).toHaveLength(1);
    expect(crossings[0].fromZone).toBe("packages-web:dashboard");
    expect(crossings[0].toZone).toBe("packages-api:auth");
  });

  it("deduplicates identical crossings", () => {
    const api = makeSubAnalysis("api", "packages/api", [
      makeZone("core", ["src/index.ts"]),
    ]);
    const web = makeSubAnalysis("web", "packages/web", [
      makeZone("ui", ["src/app.tsx"]),
    ], {
      externals: [
        // Same file imported twice via different external entries (e.g., subpath exports)
        { package: "@myapp/api", importedBy: ["src/app.tsx"], symbols: ["foo"] },
        { package: "@myapp/api", importedBy: ["src/app.tsx"], symbols: ["bar"] },
      ],
    });

    const promotedZones = [...promote(api), ...promote(web)];
    const packageMap = new Map([
      ["@myapp/api", { member: api, entryFile: "src/index.ts" }],
    ]);

    const crossings = computeCrossRepoCrossings([api, web], promotedZones, packageMap);

    // Should deduplicate: same from→to→fromZone→toZone
    expect(crossings).toHaveLength(1);
  });
});

// ── readMemberPackageInfo ───────────────────────────────────────────────────

describe("readMemberPackageInfo", () => {
  it("is exported and callable", () => {
    expect(typeof readMemberPackageInfo).toBe("function");
  });
});
