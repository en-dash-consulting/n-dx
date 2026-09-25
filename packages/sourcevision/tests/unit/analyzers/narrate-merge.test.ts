import { describe, it, expect } from "vitest";
import type { Finding, Manifest, Zone, Zones } from "../../../src/schema/index.js";
import { mergeNarration, isSuperseded, applyGeneratedNames } from "../../../src/cli/commands/narrate.js";

function zone(id: string, extra: Partial<Zone> = {}): Zone {
  return { id, name: id, description: "", files: [`${id}/a.ts`], entryPoints: [], cohesion: 0.5, coupling: 0.5, ...extra };
}
const stored: Zones = {
  zones: [zone("core", { insights: ["old"] }), zone("ui")],
  crossings: [],
  unzoned: [],
  findings: [
    { type: "observation", pass: 0, scope: "core", text: "12 entry points", severity: "warning" },
    { type: "pattern", pass: 1, scope: "ui", text: "Exemplary clean separation", severity: "info" },
  ],
};

describe("mergeNarration", () => {
  it("replaces narrated zones' insights and hash, dedupes findings against the stored ones, and runs severity rules last", () => {
    const narrated = [zone("core", { insights: ["old", "new"], structureHash: "h9" })];
    const judged: Finding[] = [
      { type: "anti-pattern", pass: 2, scope: "core", text: "Core has no barrel.", severity: "warning", confidence: 0.8 },
      { type: "pattern", pass: 2, scope: "ui", text: "Exemplary clean separation", severity: "critical" }, // duplicate of a stored finding
    ];

    const out = mergeNarration(stored, narrated, judged);

    expect(out.narratedIds).toEqual(["core"]);
    expect(out.zones.zones.find((z) => z.id === "core")).toMatchObject({ insights: ["old", "new"], structureHash: "h9" });
    expect(out.zones.zones.find((z) => z.id === "ui")!.insights).toBeUndefined();
    const texts = out.zones.findings!.map((f) => f.text);
    expect(texts).toContain("Core has no barrel.");
    expect(texts.filter((t) => t === "Exemplary clean separation")).toHaveLength(1);
    // Positive-language finding cannot end above info, whatever the judged copy said.
    expect(out.zones.findings!.find((f) => f.text === "Exemplary clean separation")!.severity).toBe("info");
    expect(out.zones.crossings).toBe(stored.crossings);
  });
});

describe("isSuperseded", () => {
  const manifest = { analyzedAt: "2026-09-22T10:00:00.000Z" } as Manifest;
  it("is true only when analyzedAt moved since narration started", () => {
    expect(isSuperseded("2026-09-22T10:00:00.000Z", manifest)).toBe(false);
    expect(isSuperseded("2026-09-22T09:00:00.000Z", manifest)).toBe(true);
    expect(isSuperseded(undefined, manifest)).toBe(false);
  });
});

describe("applyGeneratedNames", () => {
  it("applies new names to their zones, leaves the rest, and keeps names unique", () => {
    const named = [zone("ui", { name: "Web Viewer" }), zone("core", { name: "core" })];
    const out = applyGeneratedNames(stored, named);
    expect(out.renamed).toEqual(["ui"]);
    expect(out.zones.zones.find((z) => z.id === "ui")!.name).toBe("Web Viewer");
    expect(out.zones.zones.find((z) => z.id === "core")!.name).toBe("core");
    // A generated name colliding with an existing one falls back for the smaller zone.
    const clash = applyGeneratedNames({ ...stored, zones: [zone("core", { name: "Core", files: ["a", "b"] }), zone("ui", { files: ["c"] })] }, [zone("ui", { name: "Core" })]);
    expect(clash.zones.zones.map((z) => z.name)).toEqual(["Core", "Ui"]);
  });
});
