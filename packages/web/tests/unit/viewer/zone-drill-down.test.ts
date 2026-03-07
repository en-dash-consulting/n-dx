// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { h, render } from "preact";
import type { Zone, ZoneCrossing } from "../../../src/schema/v1.js";
import type { ZoneData, FlowEdge, ZoneBreadcrumb } from "../../../src/viewer/views/zone-types.js";
import {
  convertSubZones,
  convertCrossings,
  ZoneBreadcrumbNav,
} from "../../../src/viewer/views/zones.js";

// ── Helpers ─────────────────────────────────────────────────────────────────

function renderToDiv(vnode: ReturnType<typeof h>) {
  const root = document.createElement("div");
  render(vnode, root);
  return root;
}

/** Minimal Zone factory — only the fields convertSubZones reads. */
function makeZone(overrides: Partial<Zone> & Pick<Zone, "id" | "name">): Zone {
  return {
    description: "",
    files: [],
    entryPoints: [],
    cohesion: 0.8,
    coupling: 0.2,
    ...overrides,
  };
}

/**
 * Replicate the drill-path walking logic from ZonesView so we can test it
 * as a pure function without mounting the full component tree.
 */
function resolveVisibleZones(
  drillPath: ZoneBreadcrumb[],
  zoneDataList: ZoneData[],
  flowEdges: FlowEdge[],
): { visibleZones: ZoneData[]; visibleCrossings: FlowEdge[] } {
  if (drillPath.length <= 1) {
    return { visibleZones: zoneDataList, visibleCrossings: flowEdges };
  }

  let currentZones: ZoneData[] = zoneDataList;
  let currentCrossings: FlowEdge[] = flowEdges;

  for (let i = 1; i < drillPath.length; i++) {
    const crumb = drillPath[i];
    const parent = currentZones.find((z) => z.id === crumb.zoneId);
    if (!parent?.subZones) {
      return { visibleZones: currentZones, visibleCrossings: currentCrossings };
    }
    currentZones = parent.subZones;
    currentCrossings = parent.subCrossings ?? [];
  }

  return { visibleZones: currentZones, visibleCrossings: currentCrossings };
}

const ROOT_BREADCRUMB: ZoneBreadcrumb = { zoneId: null, label: "All Zones" };

// ── Breadcrumb rendering ────────────────────────────────────────────────────

describe("ZoneBreadcrumbNav", () => {
  it("returns null at root level (single breadcrumb)", () => {
    const root = renderToDiv(
      h(ZoneBreadcrumbNav, {
        drillPath: [ROOT_BREADCRUMB],
        onNavigate: vi.fn(),
      }),
    );
    expect(root.innerHTML).toBe("");
  });

  it("renders breadcrumbs when drilled one level deep", () => {
    const drillPath: ZoneBreadcrumb[] = [
      ROOT_BREADCRUMB,
      { zoneId: "auth", label: "Auth" },
    ];

    const root = renderToDiv(
      h(ZoneBreadcrumbNav, { drillPath, onNavigate: vi.fn() }),
    );

    const nav = root.querySelector("nav");
    expect(nav).not.toBeNull();
    expect(nav?.getAttribute("aria-label")).toBe("Zone navigation");

    // Root crumb is a clickable button (ancestor)
    const buttons = root.querySelectorAll("button");
    expect(buttons.length).toBe(1);
    expect(buttons[0].textContent).toBe("All Zones");

    // Current level is plain text with aria-current
    const current = root.querySelector("[aria-current='location']");
    expect(current).not.toBeNull();
    expect(current?.textContent).toBe("Auth");
  });

  it("renders separator SVG between breadcrumbs", () => {
    const drillPath: ZoneBreadcrumb[] = [
      ROOT_BREADCRUMB,
      { zoneId: "auth", label: "Auth" },
    ];

    const root = renderToDiv(
      h(ZoneBreadcrumbNav, { drillPath, onNavigate: vi.fn() }),
    );

    const seps = root.querySelectorAll("svg.zone-breadcrumb-sep");
    expect(seps.length).toBe(1);
  });

  it("calls onNavigate with correct depth when ancestor crumb is clicked", () => {
    const onNavigate = vi.fn();
    const drillPath: ZoneBreadcrumb[] = [
      ROOT_BREADCRUMB,
      { zoneId: "auth", label: "Auth" },
      { zoneId: "auth-jwt", label: "JWT" },
    ];

    const root = renderToDiv(
      h(ZoneBreadcrumbNav, { drillPath, onNavigate }),
    );

    const buttons = root.querySelectorAll("button");
    // Two ancestor buttons: "All Zones" (depth 0) and "Auth" (depth 1)
    expect(buttons.length).toBe(2);

    // Click "All Zones" → depth 0
    buttons[0].click();
    expect(onNavigate).toHaveBeenCalledWith(0);

    // Click "Auth" → depth 1
    buttons[1].click();
    expect(onNavigate).toHaveBeenCalledWith(1);
  });

  it("marks the last crumb as current (not clickable)", () => {
    const drillPath: ZoneBreadcrumb[] = [
      ROOT_BREADCRUMB,
      { zoneId: "auth", label: "Auth" },
    ];

    const root = renderToDiv(
      h(ZoneBreadcrumbNav, { drillPath, onNavigate: vi.fn() }),
    );

    const items = root.querySelectorAll("li");
    const lastItem = items[items.length - 1];
    expect(lastItem.classList.contains("zone-breadcrumb-current")).toBe(true);
    expect(lastItem.querySelector("button")).toBeNull();
    expect(lastItem.querySelector("[aria-current='location']")).not.toBeNull();
  });
});

// ── Sub-zone diagram rendering after drill-down ─────────────────────────────

describe("convertSubZones", () => {
  it("converts Zone[] to ZoneData[] with drill-down metadata", () => {
    const subZones: Zone[] = [
      makeZone({ id: "auth-jwt", name: "JWT", files: ["a.ts", "b.ts"] }),
      makeZone({ id: "auth-oauth", name: "OAuth", files: ["c.ts"] }),
    ];

    const result = convertSubZones(subZones);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("auth-jwt");
    expect(result[0].name).toBe("JWT");
    expect(result[0].totalFiles).toBe(2);
    expect(result[0].hasDrillDown).toBeUndefined();
    expect(result[1].id).toBe("auth-oauth");
    expect(result[1].totalFiles).toBe(1);
  });

  it("sets hasDrillDown when sub-zone has nested sub-zones", () => {
    const subZones: Zone[] = [
      makeZone({
        id: "auth-jwt",
        name: "JWT",
        files: ["a.ts"],
        subZones: [
          makeZone({ id: "auth-jwt-sign", name: "Sign", files: ["sign.ts"] }),
          makeZone({ id: "auth-jwt-verify", name: "Verify", files: ["verify.ts"] }),
        ],
      }),
    ];

    const result = convertSubZones(subZones);

    expect(result[0].hasDrillDown).toBe(true);
    expect(result[0].subZones).toHaveLength(2);
    expect(result[0].subZones![0].id).toBe("auth-jwt-sign");
    expect(result[0].subZones![1].id).toBe("auth-jwt-verify");
  });

  it("assigns colors from the palette by index", () => {
    const subZones: Zone[] = [
      makeZone({ id: "a", name: "A", files: [] }),
      makeZone({ id: "b", name: "B", files: [] }),
    ];

    const result = convertSubZones(subZones);

    // Each sub-zone should get a color string
    expect(result[0].color).toBeTruthy();
    expect(result[1].color).toBeTruthy();
    // Different indices should get (potentially) different colors
    expect(typeof result[0].color).toBe("string");
  });

  it("initializes files as empty and numeric fields as zero", () => {
    const subZones: Zone[] = [
      makeZone({ id: "a", name: "A", files: ["x.ts", "y.ts", "z.ts"] }),
    ];

    const result = convertSubZones(subZones);

    expect(result[0].files).toEqual([]);
    expect(result[0].totalFunctions).toBe(0);
    expect(result[0].internalCalls).toBe(0);
    expect(result[0].crossZoneCalls).toBe(0);
    expect(result[0].totalFiles).toBe(3);
  });
});

describe("convertCrossings", () => {
  it("aggregates crossings into weighted FlowEdge[]", () => {
    const crossings: ZoneCrossing[] = [
      { from: "a.ts", to: "b.ts", fromZone: "jwt", toZone: "oauth" },
      { from: "c.ts", to: "d.ts", fromZone: "jwt", toZone: "oauth" },
      { from: "e.ts", to: "f.ts", fromZone: "oauth", toZone: "session" },
    ];

    const edges = convertCrossings(crossings);

    expect(edges).toHaveLength(2);
    const jwtOauth = edges.find((e) => e.from === "jwt" && e.to === "oauth");
    const oauthSession = edges.find((e) => e.from === "oauth" && e.to === "session");
    expect(jwtOauth?.weight).toBe(2);
    expect(oauthSession?.weight).toBe(1);
  });

  it("returns empty array for undefined crossings", () => {
    expect(convertCrossings(undefined)).toEqual([]);
  });

  it("returns empty array for empty crossings", () => {
    expect(convertCrossings([])).toEqual([]);
  });
});

// ── Back navigation restoring parent view ───────────────────────────────────

describe("resolveVisibleZones — back navigation", () => {
  const childA: ZoneData = {
    id: "auth-jwt", name: "JWT", color: "#00E5B9",
    description: "", cohesion: 0.8, coupling: 0.2,
    files: [], totalFiles: 2, totalFunctions: 0, internalCalls: 0, crossZoneCalls: 0,
  };
  const childB: ZoneData = {
    id: "auth-oauth", name: "OAuth", color: "#6c41f0",
    description: "", cohesion: 0.7, coupling: 0.3,
    files: [], totalFiles: 1, totalFunctions: 0, internalCalls: 0, crossZoneCalls: 0,
  };
  const subCrossings: FlowEdge[] = [{ from: "auth-jwt", to: "auth-oauth", weight: 3 }];

  const parentZone: ZoneData = {
    id: "auth", name: "Auth", color: "#00E5B9",
    description: "", cohesion: 0.8, coupling: 0.2,
    files: [], totalFiles: 3, totalFunctions: 0, internalCalls: 0, crossZoneCalls: 0,
    subZones: [childA, childB],
    subCrossings,
    hasDrillDown: true,
  };
  const otherZone: ZoneData = {
    id: "billing", name: "Billing", color: "#6c41f0",
    description: "", cohesion: 0.9, coupling: 0.1,
    files: [], totalFiles: 5, totalFunctions: 0, internalCalls: 0, crossZoneCalls: 0,
  };

  const topLevelZones = [parentZone, otherZone];
  const topLevelEdges: FlowEdge[] = [{ from: "auth", to: "billing", weight: 7 }];

  it("at root level shows all top-level zones", () => {
    const result = resolveVisibleZones([ROOT_BREADCRUMB], topLevelZones, topLevelEdges);

    expect(result.visibleZones).toBe(topLevelZones);
    expect(result.visibleCrossings).toBe(topLevelEdges);
  });

  it("after drilling into auth shows its sub-zones", () => {
    const drillPath: ZoneBreadcrumb[] = [
      ROOT_BREADCRUMB,
      { zoneId: "auth", label: "Auth" },
    ];

    const result = resolveVisibleZones(drillPath, topLevelZones, topLevelEdges);

    expect(result.visibleZones).toEqual([childA, childB]);
    expect(result.visibleCrossings).toEqual(subCrossings);
  });

  it("navigating back to root restores parent view", () => {
    // Simulate: drilled into auth, then clicked root breadcrumb (depth 0 → slice to 1)
    const afterBack: ZoneBreadcrumb[] = [ROOT_BREADCRUMB];

    const result = resolveVisibleZones(afterBack, topLevelZones, topLevelEdges);

    expect(result.visibleZones).toBe(topLevelZones);
    expect(result.visibleCrossings).toBe(topLevelEdges);
  });

  it("falls back to parent level when drill target has no sub-zones", () => {
    const drillPath: ZoneBreadcrumb[] = [
      ROOT_BREADCRUMB,
      { zoneId: "billing", label: "Billing" }, // billing has no subZones
    ];

    const result = resolveVisibleZones(drillPath, topLevelZones, topLevelEdges);

    // Falls back to top level because billing has no sub-zones
    expect(result.visibleZones).toBe(topLevelZones);
    expect(result.visibleCrossings).toBe(topLevelEdges);
  });

  it("falls back gracefully when drill target doesn't exist", () => {
    const drillPath: ZoneBreadcrumb[] = [
      ROOT_BREADCRUMB,
      { zoneId: "nonexistent", label: "Ghost" },
    ];

    const result = resolveVisibleZones(drillPath, topLevelZones, topLevelEdges);

    // Falls back to top level because zone ID not found
    expect(result.visibleZones).toBe(topLevelZones);
    expect(result.visibleCrossings).toBe(topLevelEdges);
  });
});

// ── Nested 3-level drill-down ───────────────────────────────────────────────

describe("resolveVisibleZones — 3-level deep drill-down", () => {
  const leaf1: ZoneData = {
    id: "auth-jwt-sign", name: "Sign", color: "#00E5B9",
    description: "", cohesion: 0.9, coupling: 0.1,
    files: [], totalFiles: 1, totalFunctions: 0, internalCalls: 0, crossZoneCalls: 0,
  };
  const leaf2: ZoneData = {
    id: "auth-jwt-verify", name: "Verify", color: "#6c41f0",
    description: "", cohesion: 0.9, coupling: 0.1,
    files: [], totalFiles: 1, totalFunctions: 0, internalCalls: 0, crossZoneCalls: 0,
  };
  const level2Crossings: FlowEdge[] = [
    { from: "auth-jwt-sign", to: "auth-jwt-verify", weight: 2 },
  ];

  const level1A: ZoneData = {
    id: "auth-jwt", name: "JWT", color: "#00E5B9",
    description: "", cohesion: 0.8, coupling: 0.2,
    files: [], totalFiles: 2, totalFunctions: 0, internalCalls: 0, crossZoneCalls: 0,
    subZones: [leaf1, leaf2],
    subCrossings: level2Crossings,
    hasDrillDown: true,
  };
  const level1B: ZoneData = {
    id: "auth-oauth", name: "OAuth", color: "#6c41f0",
    description: "", cohesion: 0.7, coupling: 0.3,
    files: [], totalFiles: 1, totalFunctions: 0, internalCalls: 0, crossZoneCalls: 0,
  };
  const level1Crossings: FlowEdge[] = [
    { from: "auth-jwt", to: "auth-oauth", weight: 4 },
  ];

  const topZone: ZoneData = {
    id: "auth", name: "Auth", color: "#00E5B9",
    description: "", cohesion: 0.8, coupling: 0.2,
    files: [], totalFiles: 3, totalFunctions: 0, internalCalls: 0, crossZoneCalls: 0,
    subZones: [level1A, level1B],
    subCrossings: level1Crossings,
    hasDrillDown: true,
  };

  const topLevelZones = [topZone];
  const topLevelEdges: FlowEdge[] = [];

  it("drills two levels deep to show leaf zones", () => {
    const drillPath: ZoneBreadcrumb[] = [
      ROOT_BREADCRUMB,
      { zoneId: "auth", label: "Auth" },
      { zoneId: "auth-jwt", label: "JWT" },
    ];

    const result = resolveVisibleZones(drillPath, topLevelZones, topLevelEdges);

    expect(result.visibleZones).toEqual([leaf1, leaf2]);
    expect(result.visibleCrossings).toEqual(level2Crossings);
  });

  it("navigating back one level shows level-1 sub-zones", () => {
    // Simulate clicking "Auth" breadcrumb from 3-level deep → truncate to depth 1
    const drillPath: ZoneBreadcrumb[] = [
      ROOT_BREADCRUMB,
      { zoneId: "auth", label: "Auth" },
    ];

    const result = resolveVisibleZones(drillPath, topLevelZones, topLevelEdges);

    expect(result.visibleZones).toEqual([level1A, level1B]);
    expect(result.visibleCrossings).toEqual(level1Crossings);
  });

  it("navigating back to root from 3 levels shows top-level", () => {
    const drillPath: ZoneBreadcrumb[] = [ROOT_BREADCRUMB];

    const result = resolveVisibleZones(drillPath, topLevelZones, topLevelEdges);

    expect(result.visibleZones).toBe(topLevelZones);
    expect(result.visibleCrossings).toBe(topLevelEdges);
  });

  it("breadcrumb renders 3 entries at deepest level", () => {
    const drillPath: ZoneBreadcrumb[] = [
      ROOT_BREADCRUMB,
      { zoneId: "auth", label: "Auth" },
      { zoneId: "auth-jwt", label: "JWT" },
    ];

    const root = renderToDiv(
      h(ZoneBreadcrumbNav, { drillPath, onNavigate: vi.fn() }),
    );

    const items = root.querySelectorAll("li");
    expect(items.length).toBe(3);

    // Two ancestor buttons + one current text
    const buttons = root.querySelectorAll("button");
    expect(buttons.length).toBe(2);
    expect(buttons[0].textContent).toBe("All Zones");
    expect(buttons[1].textContent).toBe("Auth");

    const current = root.querySelector("[aria-current='location']");
    expect(current?.textContent).toBe("JWT");
  });
});

// ── buildFlowEdges working with sub-crossings ───────────────────────────────

describe("convertSubZones with sub-crossings integration", () => {
  it("attaches aggregated subCrossings as FlowEdge[]", () => {
    const subZones: Zone[] = [
      makeZone({ id: "core-a", name: "Core A", files: ["a.ts"] }),
      makeZone({ id: "core-b", name: "Core B", files: ["b.ts"] }),
    ];
    const subCrossings: ZoneCrossing[] = [
      { from: "a.ts", to: "b.ts", fromZone: "core-a", toZone: "core-b" },
      { from: "a2.ts", to: "b2.ts", fromZone: "core-a", toZone: "core-b" },
      { from: "b.ts", to: "a.ts", fromZone: "core-b", toZone: "core-a" },
    ];

    // Simulate what buildExplorerData does: zone with sub-zones + sub-crossings
    const parentZone: Zone = makeZone({
      id: "core",
      name: "Core",
      files: ["a.ts", "b.ts"],
      subZones,
      subCrossings,
    });

    const result = convertSubZones(parentZone.subZones!);
    const edges = convertCrossings(parentZone.subCrossings);

    // Sub-zones converted correctly
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("core-a");
    expect(result[1].id).toBe("core-b");

    // Crossings aggregated into weighted edges
    expect(edges).toHaveLength(2);
    const aToB = edges.find((e) => e.from === "core-a" && e.to === "core-b");
    const bToA = edges.find((e) => e.from === "core-b" && e.to === "core-a");
    expect(aToB?.weight).toBe(2);
    expect(bToA?.weight).toBe(1);
  });

  it("propagates subCrossings through recursive sub-zones", () => {
    const innerCrossings: ZoneCrossing[] = [
      { from: "x.ts", to: "y.ts", fromZone: "inner-a", toZone: "inner-b" },
    ];

    const parentZone: Zone = makeZone({
      id: "outer",
      name: "Outer",
      files: ["x.ts", "y.ts"],
      subZones: [
        makeZone({
          id: "mid",
          name: "Mid",
          files: ["x.ts", "y.ts"],
          subZones: [
            makeZone({ id: "inner-a", name: "Inner A", files: ["x.ts"] }),
            makeZone({ id: "inner-b", name: "Inner B", files: ["y.ts"] }),
          ],
          subCrossings: innerCrossings,
        }),
      ],
    });

    const result = convertSubZones(parentZone.subZones!);

    // Mid zone should have drill-down
    expect(result[0].hasDrillDown).toBe(true);
    expect(result[0].subZones).toHaveLength(2);
    expect(result[0].subCrossings).toHaveLength(1);
    expect(result[0].subCrossings![0]).toEqual({
      from: "inner-a",
      to: "inner-b",
      weight: 1,
    });
  });

  it("handles zone with subZones but no subCrossings", () => {
    const parentZone: Zone = makeZone({
      id: "core",
      name: "Core",
      files: ["a.ts"],
      subZones: [
        makeZone({ id: "core-a", name: "Core A", files: ["a.ts"] }),
      ],
      // No subCrossings set
    });

    const result = convertSubZones(parentZone.subZones!);
    const edges = convertCrossings(parentZone.subCrossings);

    expect(result).toHaveLength(1);
    // No hasDrillDown because core-a has no nested sub-zones
    expect(result[0].hasDrillDown).toBeUndefined();
    expect(edges).toEqual([]);
  });
});
