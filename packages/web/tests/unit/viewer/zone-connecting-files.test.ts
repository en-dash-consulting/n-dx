// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import type { ZoneData, FileInfo, FileConnectionMap, FileZoneLink } from "../../../src/viewer/views/zone-types.js";
import type { CallGraph, CallEdge, ExternalImport, Zone, Zones } from "../../../src/schema/v1.js";
import {
  prioritizeConnectingFiles,
  applyConnectingFilesOrdering,
  buildConnectionsTooltip,
  buildXZoneBarSegments,
  buildFileConnectionMap,
} from "../../../src/viewer/views/zones.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeFileInfo(path: string, crossZoneCalls = 0): FileInfo {
  return {
    path,
    functions: [],
    internalCalls: 0,
    crossZoneCalls,
  };
}

function makeZoneData(overrides: Partial<ZoneData> & Pick<ZoneData, "id" | "name">): ZoneData {
  return {
    color: "#00E5B9",
    description: "",
    cohesion: 0.8,
    coupling: 0.2,
    files: [],
    totalFiles: 0,
    totalFunctions: 0,
    internalCalls: 0,
    crossZoneCalls: 0,
    ...overrides,
  };
}

function connections(...paths: string[]): FileConnectionMap {
  return new Map(paths.map((p) => [p, [{ targetZoneId: "other", weight: 1 }]]));
}

// ── prioritizeConnectingFiles ────────────────────────────────────────────────

describe("prioritizeConnectingFiles", () => {
  const files = [
    makeFileInfo("internal-1.ts"),
    makeFileInfo("bridge-1.ts"),
    makeFileInfo("internal-2.ts"),
    makeFileInfo("bridge-2.ts"),
  ];

  it("sorts connecting files before internal-only files", () => {
    const result = prioritizeConnectingFiles(files, connections("bridge-1.ts", "bridge-2.ts"), false);
    expect(result.map((f) => f.path)).toEqual([
      "bridge-1.ts", "bridge-2.ts", "internal-1.ts", "internal-2.ts",
    ]);
  });

  it("preserves relative order within each group (stable partition)", () => {
    const many = [
      makeFileInfo("i-a.ts"),
      makeFileInfo("c-a.ts"),
      makeFileInfo("i-b.ts"),
      makeFileInfo("c-b.ts"),
      makeFileInfo("c-c.ts"),
      makeFileInfo("i-c.ts"),
    ];
    const result = prioritizeConnectingFiles(many, connections("c-a.ts", "c-b.ts", "c-c.ts"), false);
    expect(result.map((f) => f.path)).toEqual([
      "c-a.ts", "c-b.ts", "c-c.ts", "i-a.ts", "i-b.ts", "i-c.ts",
    ]);
  });

  it("filters to connecting files only when connectingOnly is true", () => {
    const result = prioritizeConnectingFiles(files, connections("bridge-1.ts", "bridge-2.ts"), true);
    expect(result.map((f) => f.path)).toEqual(["bridge-1.ts", "bridge-2.ts"]);
  });

  it("returns files unchanged when no connections exist", () => {
    const result = prioritizeConnectingFiles(files, new Map(), false);
    expect(result.map((f) => f.path)).toEqual([
      "internal-1.ts", "bridge-1.ts", "internal-2.ts", "bridge-2.ts",
    ]);
  });

  it("ignores files with an empty connection list", () => {
    const fc: FileConnectionMap = new Map([["bridge-1.ts", []]]);
    const result = prioritizeConnectingFiles(files, fc, true);
    expect(result).toEqual([]);
  });

  it("does not mutate the input array", () => {
    const input = [...files];
    prioritizeConnectingFiles(input, connections("bridge-2.ts"), false);
    expect(input.map((f) => f.path)).toEqual([
      "internal-1.ts", "bridge-1.ts", "internal-2.ts", "bridge-2.ts",
    ]);
  });
});

// ── applyConnectingFilesOrdering ─────────────────────────────────────────────

describe("applyConnectingFilesOrdering", () => {
  const fc = connections("bridge.ts", "sub-bridge.ts");

  function makeZones(): ZoneData[] {
    return [
      makeZoneData({
        id: "z1",
        name: "Zone 1",
        files: [makeFileInfo("internal.ts"), makeFileInfo("bridge.ts")],
        totalFiles: 2,
        subZones: [
          makeZoneData({
            id: "z1-sub",
            name: "Sub",
            files: [makeFileInfo("sub-internal.ts"), makeFileInfo("sub-bridge.ts")],
            totalFiles: 2,
          }),
        ],
      }),
      makeZoneData({
        id: "z2",
        name: "Zone 2",
        files: [makeFileInfo("other-internal.ts"), makeFileInfo("bridge.ts")],
        totalFiles: 2,
      }),
    ];
  }

  it("orders connecting files first in every zone", () => {
    const result = applyConnectingFilesOrdering(makeZones(), fc, new Set());
    expect(result[0].files.map((f) => f.path)).toEqual(["bridge.ts", "internal.ts"]);
    expect(result[1].files.map((f) => f.path)).toEqual(["bridge.ts", "other-internal.ts"]);
  });

  it("orders nested sub-zone file rows too", () => {
    const result = applyConnectingFilesOrdering(makeZones(), fc, new Set());
    expect(result[0].subZones?.[0].files.map((f) => f.path)).toEqual([
      "sub-bridge.ts", "sub-internal.ts",
    ]);
  });

  it("filters only zones present in connectingOnlyZones", () => {
    const result = applyConnectingFilesOrdering(makeZones(), fc, new Set(["z1"]));
    expect(result[0].files.map((f) => f.path)).toEqual(["bridge.ts"]);
    // z2 not toggled — full list, reordered
    expect(result[1].files.map((f) => f.path)).toEqual(["bridge.ts", "other-internal.ts"]);
  });

  it("applies the zone-level filter to nested sub-zone files", () => {
    const result = applyConnectingFilesOrdering(makeZones(), fc, new Set(["z1"]));
    expect(result[0].subZones?.[0].files.map((f) => f.path)).toEqual(["sub-bridge.ts"]);
  });

  it("preserves totalFiles when filtering", () => {
    const result = applyConnectingFilesOrdering(makeZones(), fc, new Set(["z1"]));
    expect(result[0].totalFiles).toBe(2);
    expect(result[0].files).toHaveLength(1);
  });

  it("does not mutate input zones", () => {
    const zones = makeZones();
    applyConnectingFilesOrdering(zones, fc, new Set(["z1"]));
    expect(zones[0].files.map((f) => f.path)).toEqual(["internal.ts", "bridge.ts"]);
    expect(zones[0].subZones?.[0].files.map((f) => f.path)).toEqual([
      "sub-internal.ts", "sub-bridge.ts",
    ]);
  });
});

// ── buildConnectionsTooltip ──────────────────────────────────────────────────

describe("buildConnectionsTooltip", () => {
  const zoneNameById = new Map([
    ["z-server", "Web Server"],
    ["z-shared", "Web Shared"],
    ["z-crash", "Crash"],
  ]);

  it("lists each target zone name with its weight, sorted by weight descending", () => {
    const links: FileZoneLink[] = [
      { targetZoneId: "z-shared", weight: 2 },
      { targetZoneId: "z-server", weight: 9 },
      { targetZoneId: "z-crash", weight: 5 },
    ];
    const tooltip = buildConnectionsTooltip(links, zoneNameById);
    expect(tooltip).toBe(
      "→ Web Server · 9 calls\n→ Crash · 5 calls\n→ Web Shared · 2 calls",
    );
  });

  it("uses singular 'call' for weight 1", () => {
    const tooltip = buildConnectionsTooltip(
      [{ targetZoneId: "z-crash", weight: 1 }],
      zoneNameById,
    );
    expect(tooltip).toBe("→ Crash · 1 call");
  });

  it("returns null for undefined or empty links", () => {
    expect(buildConnectionsTooltip(undefined, zoneNameById)).toBeNull();
    expect(buildConnectionsTooltip([], zoneNameById)).toBeNull();
  });

  it("omits links whose target zone is not in the rendered zone list", () => {
    const links: FileZoneLink[] = [
      { targetZoneId: "z-unknown", weight: 10 },
      { targetZoneId: "z-shared", weight: 3 },
    ];
    expect(buildConnectionsTooltip(links, zoneNameById)).toBe("→ Web Shared · 3 calls");
  });

  it("returns null when no link resolves to a rendered zone", () => {
    const links: FileZoneLink[] = [{ targetZoneId: "z-unknown", weight: 10 }];
    expect(buildConnectionsTooltip(links, zoneNameById)).toBeNull();
  });

  it("does not mutate the input links array", () => {
    const links: FileZoneLink[] = [
      { targetZoneId: "z-shared", weight: 2 },
      { targetZoneId: "z-server", weight: 9 },
    ];
    buildConnectionsTooltip(links, zoneNameById);
    expect(links.map((l) => l.targetZoneId)).toEqual(["z-shared", "z-server"]);
  });
});

// ── buildFileConnectionMap ───────────────────────────────────────────────────

function callEdge(callerFile: string, calleeFile: string | null): CallEdge {
  return { callerFile, caller: "fn", calleeFile, callee: "gn", type: "direct", line: 1, column: 0 };
}

function makeCallGraph(edges: CallEdge[]): CallGraph {
  return {
    functions: [],
    edges,
    summary: {
      totalFunctions: 0,
      totalCalls: edges.length,
      filesWithCalls: 0,
      mostCalled: [],
      mostCalling: [],
      cycleCount: 0,
    },
  };
}

function makeZone(id: string, files: string[]): Zone {
  return { id, name: id, description: "", files, entryPoints: [], cohesion: 0.8, coupling: 0.2 };
}

function makeZones(...zones: Zone[]): Zones {
  return { zones, crossings: [], unzoned: [] };
}

function extImport(pkg: string, importedBy: string[]): ExternalImport {
  return { package: pkg, importedBy, symbols: [] };
}

describe("buildFileConnectionMap", () => {
  const zoneEntry = (id: string) => ({ id, name: id, color: "#00E5B9" });
  const fileToZoneMap = new Map([
    ["a/one.ts", zoneEntry("za")],
    ["a/two.ts", zoneEntry("za")],
    ["b/one.ts", zoneEntry("zb")],
  ]);

  it("records a bidirectional connection with weight 1 for a cross-zone call edge", () => {
    const map = buildFileConnectionMap(
      makeCallGraph([callEdge("a/one.ts", "b/one.ts")]),
      [],
      fileToZoneMap,
      null,
    );
    expect(map.get("a/one.ts")).toEqual([{ targetZoneId: "zb", weight: 1 }]);
    expect(map.get("b/one.ts")).toEqual([{ targetZoneId: "za", weight: 1 }]);
    expect(map.size).toBe(2);
  });

  it("accumulates weight across repeated edges to the same target zone", () => {
    const map = buildFileConnectionMap(
      makeCallGraph([
        callEdge("a/one.ts", "b/one.ts"),
        callEdge("a/one.ts", "b/one.ts"),
        callEdge("a/two.ts", "b/one.ts"),
      ]),
      [],
      fileToZoneMap,
      null,
    );
    expect(map.get("a/one.ts")).toEqual([{ targetZoneId: "zb", weight: 2 }]);
    expect(map.get("a/two.ts")).toEqual([{ targetZoneId: "zb", weight: 1 }]);
    // Callee side aggregates all three inbound calls from zone za
    expect(map.get("b/one.ts")).toEqual([{ targetZoneId: "za", weight: 3 }]);
  });

  it("ignores same-zone edges, unresolved callees, and unzoned files", () => {
    const map = buildFileConnectionMap(
      makeCallGraph([
        callEdge("a/one.ts", "a/two.ts"),   // same zone
        callEdge("a/one.ts", null),          // external/unresolved callee
        callEdge("a/one.ts", "orphan.ts"),  // callee not in any zone
        callEdge("orphan.ts", "b/one.ts"),  // caller not in any zone
      ]),
      [],
      fileToZoneMap,
      null,
    );
    expect(map.size).toBe(0);
  });

  it("maps @n-dx/-scoped external imports to the zone owning the package directory", () => {
    const zones = makeZones(
      makeZone("z-core", ["packages/core/cli.js"]),
      makeZone("z-llm", ["packages/llm-client/src/api.ts"]),
    );
    const map = buildFileConnectionMap(
      makeCallGraph([]),
      [extImport("@n-dx/llm-client", ["packages/core/cli.js"])],
      new Map([["packages/core/cli.js", zoneEntry("z-core")]]),
      zones,
    );
    // Import-derived connections are one-directional: importer → target zone
    expect(map.get("packages/core/cli.js")).toEqual([{ targetZoneId: "z-llm", weight: 1 }]);
    expect(map.size).toBe(1);
  });

  it("maps bare package names to the zone owning packages/<name>", () => {
    const zones = makeZones(makeZone("z-rex", ["packages/rex/src/store.ts"]));
    const map = buildFileConnectionMap(
      makeCallGraph([]),
      [extImport("rex", ["packages/hench/src/gateway.ts"])],
      new Map([["packages/hench/src/gateway.ts", zoneEntry("z-hench")]]),
      zones,
    );
    expect(map.get("packages/hench/src/gateway.ts")).toEqual([{ targetZoneId: "z-rex", weight: 1 }]);
  });

  it("prefers the zone owning src/ files when a package spans multiple zones", () => {
    const zones = makeZones(
      makeZone("z-tests", ["packages/llm-client/tests/api.test.ts"]),
      makeZone("z-lib", ["packages/llm-client/src/api.ts"]),
    );
    const map = buildFileConnectionMap(
      makeCallGraph([]),
      [extImport("@n-dx/llm-client", ["packages/core/cli.js"])],
      new Map([["packages/core/cli.js", zoneEntry("z-core")]]),
      zones,
    );
    expect(map.get("packages/core/cli.js")).toEqual([{ targetZoneId: "z-lib", weight: 1 }]);
  });

  it("skips external imports whose importer is inside the target zone", () => {
    const zones = makeZones(makeZone("z-lib", ["packages/llm-client/src/api.ts"]));
    const map = buildFileConnectionMap(
      makeCallGraph([]),
      [extImport("@n-dx/llm-client", ["packages/llm-client/src/other.ts"])],
      new Map([["packages/llm-client/src/other.ts", zoneEntry("z-lib")]]),
      zones,
    );
    expect(map.size).toBe(0);
  });

  it("combines call-edge and external-import weights per target zone", () => {
    const zones = makeZones(
      makeZone("z-beta", ["packages/beta/src/b.ts"]),
      makeZone("za", ["a/one.ts"]),
    );
    const ftz = new Map([
      ["a/one.ts", zoneEntry("za")],
      ["packages/beta/src/b.ts", zoneEntry("z-beta")],
    ]);
    const map = buildFileConnectionMap(
      makeCallGraph([callEdge("a/one.ts", "packages/beta/src/b.ts")]),
      [extImport("beta", ["a/one.ts"])],
      ftz,
      zones,
    );
    expect(map.get("a/one.ts")).toEqual([{ targetZoneId: "z-beta", weight: 2 }]);
    expect(map.get("packages/beta/src/b.ts")).toEqual([{ targetZoneId: "za", weight: 1 }]);
  });

  it("returns an empty map when there are no edges or imports", () => {
    const map = buildFileConnectionMap(makeCallGraph([]), [], fileToZoneMap, makeZones());
    expect(map.size).toBe(0);
  });
});

// ── buildXZoneBarSegments ────────────────────────────────────────────────────

describe("buildXZoneBarSegments", () => {
  const zoneColorById = new Map([
    ["z-red", "#ff0000"],
    ["z-green", "#00ff00"],
    ["z-blue", "#0000ff"],
  ]);
  const BAR_H = 20;

  it("renders a single full-height segment in the target zone's color", () => {
    const segments = buildXZoneBarSegments(
      [{ targetZoneId: "z-red", weight: 3 }],
      zoneColorById,
      BAR_H,
    );
    expect(segments).toEqual([{ y: 0, h: BAR_H, color: "#ff0000" }]);
  });

  it("splits multi-target files into weight-proportional contiguous segments", () => {
    const segments = buildXZoneBarSegments(
      [
        { targetZoneId: "z-green", weight: 1 },
        { targetZoneId: "z-red", weight: 3 },
      ],
      zoneColorById,
      BAR_H,
    );
    // Sorted by weight descending, like the tooltip
    expect(segments).toEqual([
      { y: 0, h: 15, color: "#ff0000" },
      { y: 15, h: 5, color: "#00ff00" },
    ]);
    // Contiguous and full-height
    const total = segments.reduce((s, seg) => s + seg.h, 0);
    expect(total).toBe(BAR_H);
  });

  it("omits links whose target zone is not in the color map", () => {
    const segments = buildXZoneBarSegments(
      [
        { targetZoneId: "z-unknown", weight: 5 },
        { targetZoneId: "z-blue", weight: 1 },
      ],
      zoneColorById,
      BAR_H,
    );
    expect(segments).toEqual([{ y: 0, h: BAR_H, color: "#0000ff" }]);
  });

  it("returns empty for undefined, empty, or fully-unresolvable links", () => {
    expect(buildXZoneBarSegments(undefined, zoneColorById, BAR_H)).toEqual([]);
    expect(buildXZoneBarSegments([], zoneColorById, BAR_H)).toEqual([]);
    expect(buildXZoneBarSegments(
      [{ targetZoneId: "z-unknown", weight: 2 }],
      zoneColorById,
      BAR_H,
    )).toEqual([]);
  });
});
