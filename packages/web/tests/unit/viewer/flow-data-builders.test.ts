import { describe, it, expect } from "vitest";
import {
  buildFlowEdges,
  buildCallFlowEdges,
  buildFileToZoneMap,
} from "../../../src/viewer/visualization/flow.js";
import type { ZoneCrossing, CallEdge, Zones } from "../../../src/schema/v1.js";

// ── buildFlowEdges (from crossings) ─────────────────────────────────────────

describe("buildFlowEdges", () => {
  it("aggregates crossings into weighted zone-pair edges", () => {
    const crossings: ZoneCrossing[] = [
      { from: "src/a/x.ts", to: "src/b/y.ts", fromZone: "auth", toZone: "billing" },
      { from: "src/a/z.ts", to: "src/b/w.ts", fromZone: "auth", toZone: "billing" },
      { from: "src/b/y.ts", to: "src/c/p.ts", fromZone: "billing", toZone: "shop" },
    ];

    const edges = buildFlowEdges(crossings);

    expect(edges).toHaveLength(2);
    const authBilling = edges.find(e => e.from === "auth" && e.to === "billing");
    const billingShop = edges.find(e => e.from === "billing" && e.to === "shop");
    expect(authBilling?.weight).toBe(2);
    expect(billingShop?.weight).toBe(1);
  });

  it("returns empty array for empty crossings", () => {
    expect(buildFlowEdges([])).toEqual([]);
  });
});

// ── buildCallFlowEdges ───────────────────────────────────────────────────────

describe("buildCallFlowEdges", () => {
  it("produces edges only for cross-zone calls", () => {
    const fileToZoneMap = new Map([
      ["src/a.ts", { id: "zone-a", name: "Zone A", color: "#000" }],
      ["src/b.ts", { id: "zone-b", name: "Zone B", color: "#111" }],
    ]);
    const callEdges: CallEdge[] = [
      { callerFile: "src/a.ts", caller: "fnA", calleeFile: "src/b.ts", callee: "fnB" },
      { callerFile: "src/a.ts", caller: "fnA2", calleeFile: "src/a.ts", callee: "fnA3" }, // same zone
    ];

    const edges = buildCallFlowEdges(callEdges, fileToZoneMap);

    expect(edges).toHaveLength(1);
    expect(edges[0]).toEqual({ from: "zone-a", to: "zone-b", weight: 1 });
  });

  it("skips edges with missing calleeFile", () => {
    const fileToZoneMap = new Map([
      ["src/a.ts", { id: "zone-a", name: "Zone A", color: "#000" }],
    ]);
    const callEdges: CallEdge[] = [
      { callerFile: "src/a.ts", caller: "fnA", calleeFile: "", callee: "fnB" },
    ];

    const edges = buildCallFlowEdges(callEdges, fileToZoneMap);
    expect(edges).toHaveLength(0);
  });
});

// ── buildFileToZoneMap ───────────────────────────────────────────────────────

describe("buildFileToZoneMap", () => {
  it("maps files to their zone info", () => {
    const zones: Zones = {
      zones: [
        {
          id: "core",
          name: "Core",
          description: "",
          files: ["src/a.ts", "src/b.ts"],
          entryPoints: [],
          cohesion: 1,
          coupling: 0,
        },
      ],
      crossings: [],
      unzoned: [],
    };

    const map = buildFileToZoneMap(zones);

    expect(map.get("src/a.ts")?.id).toBe("core");
    expect(map.get("src/b.ts")?.name).toBe("Core");
    expect(map.has("src/c.ts")).toBe(false);
  });

  it("returns empty map for null zones", () => {
    expect(buildFileToZoneMap(null).size).toBe(0);
  });
});
