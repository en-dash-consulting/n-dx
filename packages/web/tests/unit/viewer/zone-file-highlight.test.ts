// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import type { ZoneData, FileInfo, BoxRect, FileConnectionMap, ExpandedSubZones } from "../../../src/viewer/views/zone-types.js";
import {
  computeFileRowRect,
  buildFileHighlightEdges,
} from "../../../src/viewer/views/zones.js";

// Layout constants mirrored from zones.ts rendering
const BOX_H_COLLAPSED = 80;
const FILE_ROW_H = 22;
const FILE_ROWS_MAX = 15;
const SUBZONE_ROW_H = 28;
const SUBZONE_FILE_INDENT = 12;

// ── Helpers ─────────────────────────────────────────────────────────────────

function makeFileInfo(path: string): FileInfo {
  return { path, functions: [], internalCalls: 0, crossZoneCalls: 0 };
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

function makeBox(x = 40, y = 40, h = 200): BoxRect {
  return { x, y, w: 200, h, gridCol: 0, gridRow: 0 };
}

// ── computeFileRowRect ──────────────────────────────────────────────────────

describe("computeFileRowRect", () => {
  const files = Array.from({ length: 20 }, (_, i) => makeFileInfo(`file-${i}.ts`));
  const zone = makeZoneData({ id: "z1", name: "Zone 1", files });
  const box = makeBox();

  it("computes the rect of a visible file row by index", () => {
    const rect0 = computeFileRowRect(zone, box, "file-0.ts");
    expect(rect0).toEqual({
      x: box.x + 8,
      y: box.y + BOX_H_COLLAPSED - 4,
      w: box.w - 16,
      h: FILE_ROW_H - 2,
      gridCol: box.gridCol,
      gridRow: box.gridRow,
    });

    const rect3 = computeFileRowRect(zone, box, "file-3.ts");
    expect(rect3?.y).toBe(box.y + BOX_H_COLLAPSED - 4 + 3 * FILE_ROW_H);
  });

  it("returns null for files beyond the visible row cap", () => {
    expect(computeFileRowRect(zone, box, `file-${FILE_ROWS_MAX}.ts`)).toBeNull();
  });

  it("returns null for files not in the zone", () => {
    expect(computeFileRowRect(zone, box, "elsewhere.ts")).toBeNull();
  });

  it("computes rects for files nested in an expanded subzone", () => {
    const withSubs = makeZoneData({
      id: "parent",
      name: "Parent",
      subZones: [
        makeZoneData({ id: "sz1", name: "Sub 1", files: [makeFileInfo("a.ts"), makeFileInfo("b.ts")] }),
        makeZoneData({ id: "sz2", name: "Sub 2", files: [makeFileInfo("c.ts")] }),
      ],
    });
    const expanded = new Set(["sz1", "sz2"]);

    // sz1 row, then a.ts, b.ts
    const rectB = computeFileRowRect(withSubs, box, "b.ts", expanded);
    expect(rectB).toEqual({
      x: box.x + SUBZONE_FILE_INDENT + 8,
      y: box.y + BOX_H_COLLAPSED - 4 + SUBZONE_ROW_H + FILE_ROW_H,
      w: box.w - SUBZONE_FILE_INDENT - 16,
      h: FILE_ROW_H - 2,
      gridCol: box.gridCol,
      gridRow: box.gridRow,
    });

    // c.ts sits after sz1's row + 2 files + sz2's row
    const rectC = computeFileRowRect(withSubs, box, "c.ts", expanded);
    expect(rectC?.y).toBe(box.y + BOX_H_COLLAPSED - 4 + 2 * SUBZONE_ROW_H + 2 * FILE_ROW_H);
  });

  it("returns null for files whose subzone is collapsed", () => {
    const withSubs = makeZoneData({
      id: "parent",
      name: "Parent",
      subZones: [makeZoneData({ id: "sz1", name: "Sub 1", files: [makeFileInfo("a.ts")] })],
    });
    expect(computeFileRowRect(withSubs, box, "a.ts", new Set())).toBeNull();
    expect(computeFileRowRect(withSubs, box, "a.ts", undefined)).toBeNull();
  });
});

// ── buildFileHighlightEdges ─────────────────────────────────────────────────

describe("buildFileHighlightEdges", () => {
  const source = makeZoneData({
    id: "src",
    name: "Source",
    color: "#111111",
    files: [makeFileInfo("bridge.ts"), makeFileInfo("internal.ts")],
  });
  const targetA = makeZoneData({ id: "ta", name: "Target A", color: "#aa0000" });
  const targetB = makeZoneData({ id: "tb", name: "Target B", color: "#00bb00" });

  const zoneById = new Map([["src", source], ["ta", targetA], ["tb", targetB]]);
  const boxes = new Map<string, BoxRect>([
    ["src", makeBox(40, 40, 400)],
    ["ta", makeBox(400, 40, 80)],
    ["tb", makeBox(400, 300, 80)],
  ]);
  const noSubZones: ExpandedSubZones = new Map();
  const connections: FileConnectionMap = new Map([
    ["bridge.ts", [
      { targetZoneId: "ta", weight: 3 },
      { targetZoneId: "tb", weight: 1 },
      { targetZoneId: "src", weight: 5 }, // self link — must be ignored
      { targetZoneId: "offscreen", weight: 2 }, // no box — must be ignored
    ]],
  ]);

  it("builds one edge per on-screen target zone and collects highlight ids", () => {
    const result = buildFileHighlightEdges(
      { path: "bridge.ts", zoneId: "src" },
      zoneById, boxes, new Set(["src"]), noSubZones, connections,
    );
    expect(result).not.toBeNull();
    expect(result!.targetZoneIds).toEqual(new Set(["ta", "tb"]));
    expect(result!.edges).toHaveLength(2);

    const edgeA = result!.edges.find((e) => e.key === "hl-bridge.ts-ta")!;
    expect(edgeA.color).toBe("#aa0000");
    expect(edgeA.weight).toBe(3);
    expect(edgeA.d).toMatch(/^M .+ Q .+$/);
  });

  it("draws edges whether the target zone is collapsed or expanded", () => {
    const collapsed = buildFileHighlightEdges(
      { path: "bridge.ts", zoneId: "src" },
      zoneById, boxes, new Set(["src"]), noSubZones, connections,
    );
    const expandedBoxes = new Map(boxes);
    expandedBoxes.set("ta", makeBox(400, 40, 300)); // taller expanded box
    const expanded = buildFileHighlightEdges(
      { path: "bridge.ts", zoneId: "src" },
      zoneById, expandedBoxes, new Set(["src", "ta"]), noSubZones, connections,
    );
    expect(collapsed!.edges).toHaveLength(2);
    expect(expanded!.edges).toHaveLength(2);
    // Path anchors to the box rect, so the taller box changes the geometry
    const dCollapsed = collapsed!.edges.find((e) => e.key === "hl-bridge.ts-ta")!.d;
    const dExpanded = expanded!.edges.find((e) => e.key === "hl-bridge.ts-ta")!.d;
    expect(dExpanded).not.toBe(dCollapsed);
  });

  it("returns null when the source zone is not expanded", () => {
    const result = buildFileHighlightEdges(
      { path: "bridge.ts", zoneId: "src" },
      zoneById, boxes, new Set(), noSubZones, connections,
    );
    expect(result).toBeNull();
  });

  it("returns null when the file has no cross-zone connections", () => {
    const result = buildFileHighlightEdges(
      { path: "internal.ts", zoneId: "src" },
      zoneById, boxes, new Set(["src"]), noSubZones, connections,
    );
    expect(result).toBeNull();
  });

  it("returns null when the file row is not visible in its zone", () => {
    const result = buildFileHighlightEdges(
      { path: "not-in-zone.ts", zoneId: "src" },
      zoneById, boxes, new Set(["src"]), noSubZones, connections,
    );
    expect(result).toBeNull();
  });
});
