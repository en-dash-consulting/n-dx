// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import type { ZoneData, FileInfo, FileConnectionMap, FileZoneLink } from "../../../src/viewer/views/zone-types.js";
import {
  prioritizeConnectingFiles,
  applyConnectingFilesOrdering,
  buildConnectionsTooltip,
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
