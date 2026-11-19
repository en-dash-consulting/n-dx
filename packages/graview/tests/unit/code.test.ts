import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { deriveNextSteps } from "../../src/sourcevision-gateway.js";
import { RECOMMENDED_STEPS, readCode } from "../../src/sources/code.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function zone(id: string, cohesion: number, coupling: number) {
  return { id, name: id, description: "", files: [`src/${id}/a.ts`], entryPoints: [], cohesion, coupling };
}

/** Seven zones with a critical finding each (more than the Analysis page recommends), a global one, and two without findings. */
const ZONES = {
  zones: [
    ...Array.from({ length: 7 }, (_, i) => zone(`z${i}`, 0.8, 0.2)),
    zone("loose", 0.2, 0.1),
    zone("healthy", 0.9, 0.1),
  ],
  crossings: [],
  unzoned: [],
  findings: [
    { type: "anti-pattern", pass: 1, scope: "global", severity: "critical", text: "The whole thing is tangled" },
    ...Array.from({ length: 7 }, (_, i) => ({ type: "anti-pattern", pass: 1, scope: `z${i}`, severity: "critical", text: `Zone z${i} is broken` })),
  ],
};

function read(zones: unknown) {
  const dir = mkdtempSync(join(tmpdir(), "graview-code-"));
  dirs.push(dir);
  writeFileSync(join(dir, "zones.json"), JSON.stringify(zones));
  return readCode(dir, {}, () => {});
}

describe("readCode: the Analysis page's treatments", () => {
  it("marks needs-work exactly on the zones the recommended next steps name", () => {
    const zones = read(ZONES).nodes.filter((n) => n.kind === "zone");
    const recommended = deriveNextSteps(ZONES as Parameters<typeof deriveNextSteps>[0]).slice(0, RECOMMENDED_STEPS);
    const expected = new Set(recommended.map((s) => s.scope).filter((s) => s !== "global"));

    // Every zone says both, true or false.
    for (const z of zones) {
      expect(typeof z.needsWork, z.id).toBe("boolean");
      expect(typeof z.highlighted, z.id).toBe("boolean");
    }
    const needsWork = new Set(zones.filter((z) => z.needsWork).map((z) => z.id));
    expect(needsWork).toEqual(expected);
    // Steps past the tile's five mark nothing, so two of the seven broken zones stay unmarked.
    expect(needsWork.size).toBe(RECOMMENDED_STEPS);
    expect(["z0", "z1", "z2", "z3", "z4", "z5", "z6"].filter((id) => !needsWork.has(id))).toHaveLength(2);
    for (const z of zones.filter((n) => n.needsWork)) {
      expect(z.recommendation).toBe(recommended.find((s) => s.scope === z.id)!.title);
      expect(z.highlighted).toBe(false);
    }
  });

  it("highlights a zone needing attention that is not recommended, and leaves a healthy one plain", () => {
    const byId = new Map(read(ZONES).nodes.map((n) => [n.id, n]));
    expect(byId.get("loose")).toMatchObject({ needsWork: false, highlighted: true });
    expect(byId.get("loose")!.recommendation).toBeUndefined();
    expect(byId.get("healthy")).toMatchObject({ needsWork: false, highlighted: false });
  });

  it("never highlights a zone that needs work, even when it also needs attention", () => {
    const zones = { ...ZONES, zones: [zone("both", 0.1, 0.9)], findings: [{ type: "anti-pattern", pass: 1, scope: "both", severity: "critical", text: "Broken" }] };
    expect(read(zones).nodes.find((n) => n.id === "both")).toMatchObject({ needsWork: true, highlighted: false, recommendation: "Broken" });
  });

  it("lets a step scoped global mark no zone", () => {
    const zones = { ...ZONES, findings: [ZONES.findings[0]] };
    expect(read(zones).nodes.filter((n) => n.needsWork)).toEqual([]);
  });

  it("marks nothing as needing work when the analysis has no findings", () => {
    const zones = read({ ...ZONES, findings: undefined }).nodes.filter((n) => n.kind === "zone");
    expect(zones.some((z) => z.needsWork)).toBe(false);
  });
});
