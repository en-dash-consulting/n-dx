/**
 * The difference between two analyses: zones added, merged, renamed or
 * removed, findings added and resolved by severity, file and import counts.
 *
 * Everything here is a pure read of the two runs' recorded outcomes plus the
 * zone facts `sv analyze` writes — no LLM call and no filesystem.
 */

import { describe, it, expect } from "vitest";
import { computeAnalysisChanges, type AnalysisOutcome, type ZoneShapeInput } from "../../../src/server/analysis-changes.js";

const PREVIOUS_AT = "2026-10-01T09:00:00.000Z";

function outcome(over: Partial<AnalysisOutcome> = {}): AnalysisOutcome {
  return { files: 400, importEdges: 1200, zoneIds: ["web-server", "rex-cli"], findings: {}, ...over };
}

function shape(over: Partial<ZoneShapeInput> = {}): ZoneShapeInput {
  return { zones: [{ id: "web-server", name: "Web Server" }, { id: "rex-cli", name: "Rex CLI" }], ...over };
}

describe("counts", () => {
  it("reports each count with the direction it moved", () => {
    const changes = computeAnalysisChanges(
      outcome({ files: 412, importEdges: 1150 }),
      outcome({ files: 400, importEdges: 1200 }),
      PREVIOUS_AT,
      shape(),
    );
    expect(changes.previousAt).toBe(PREVIOUS_AT);
    expect(changes.files).toEqual({ now: 412, was: 400 });
    expect(changes.importEdges).toEqual({ now: 1150, was: 1200 });
  });

  it("leaves the previous side unknown rather than zero without a previous run", () => {
    // A first analysis did not add every zone and finding in the project; it
    // has no measurement to compare with, which is a different statement.
    const changes = computeAnalysisChanges(outcome({ findings: { critical: ["a"] } }), null, null, shape());
    expect(changes.previousAt).toBeNull();
    expect(changes.files.was).toBeNull();
    expect(changes.importEdges.was).toBeNull();
    expect(changes.zones).toEqual({ total: 2, added: [], removed: [], merged: [], renamed: [] });
    expect(changes.findings).toEqual({ now: { critical: 1 }, added: {}, resolved: {} });
  });
});

describe("zones", () => {
  it("names a zone that appeared", () => {
    const changes = computeAnalysisChanges(
      outcome({ zoneIds: ["web-server", "rex-cli", "hench-guard"] }),
      outcome(),
      PREVIOUS_AT,
      shape({ zones: [...shape().zones!, { id: "hench-guard", name: "Hench Guard" }] }),
    );
    expect(changes.zones.added).toEqual([{ id: "hench-guard", name: "Hench Guard", related: null }]);
    expect(changes.zones.removed).toEqual([]);
    expect(changes.zones.total).toBe(3);
  });

  it("reads a new id carrying previousIds as a rename, not a removal plus an addition", () => {
    const changes = computeAnalysisChanges(
      outcome({ zoneIds: ["web-server", "viewer-hub"] }),
      outcome({ zoneIds: ["web-server", "zone-7"] }),
      PREVIOUS_AT,
      shape({ zones: [{ id: "web-server", name: "Web Server" }, { id: "viewer-hub", name: "Viewer Hub", previousIds: ["zone-7"] }] }),
    );
    expect(changes.zones.renamed).toEqual([{ id: "viewer-hub", name: "Viewer Hub", related: "zone-7" }]);
    expect(changes.zones.added).toEqual([]);
    expect(changes.zones.removed).toEqual([]);
  });

  it("reads a gone zone whose files mostly went to one survivor as merged into it", () => {
    const changes = computeAnalysisChanges(
      outcome({ zoneIds: ["core"] }),
      outcome({ zoneIds: ["core", "cli-orchestration"] }),
      PREVIOUS_AT,
      {
        zones: [{ id: "core", name: "Core" }],
        stability: {
          reassignedFiles: [
            ["a.js", "cli-orchestration", "core"],
            ["b.js", "cli-orchestration", "core"],
            ["c.js", "cli-orchestration", "core"],
          ],
        },
      },
    );
    expect(changes.zones.merged).toEqual([{ id: "cli-orchestration", name: null, related: "core" }]);
    expect(changes.zones.removed).toEqual([]);
  });

  it("reads a gone zone whose files scattered as removed, not merged", () => {
    // Two survivors took one file each: it went nowhere in particular.
    const changes = computeAnalysisChanges(
      outcome({ zoneIds: ["core", "rex-cli"] }),
      outcome({ zoneIds: ["core", "rex-cli", "misc"] }),
      PREVIOUS_AT,
      {
        zones: [{ id: "core", name: "Core" }, { id: "rex-cli", name: "Rex CLI" }],
        stability: { reassignedFiles: [["a.js", "misc", "core"], ["b.js", "misc", "rex-cli"]] },
      },
    );
    expect(changes.zones.removed).toEqual([{ id: "misc", name: null, related: null }]);
    expect(changes.zones.merged).toEqual([]);
  });

  it("ignores reassignments into a zone this run does not have", () => {
    const changes = computeAnalysisChanges(
      outcome({ zoneIds: ["core"] }),
      outcome({ zoneIds: ["core", "misc"] }),
      PREVIOUS_AT,
      { zones: [{ id: "core", name: "Core" }], stability: { reassignedFiles: [["a.js", "misc", "also-gone"]] } },
    );
    expect(changes.zones.removed).toEqual([{ id: "misc", name: null, related: null }]);
  });

  it("walks sub-zones and survives zones.json saying nothing about shape", () => {
    const changes = computeAnalysisChanges(
      outcome({ zoneIds: ["web-server", "web-server-routes"] }),
      outcome({ zoneIds: ["web-server"] }),
      PREVIOUS_AT,
      { zones: [{ id: "web-server", name: "Web Server", subZones: [{ id: "web-server-routes", name: "Routes" }] }] },
    );
    expect(changes.zones.added).toEqual([{ id: "web-server-routes", name: "Routes", related: null }]);
    expect(computeAnalysisChanges(outcome(), outcome(), PREVIOUS_AT, {}).zones.added).toEqual([]);
  });

  it("falls back to the id when a zone has no name", () => {
    const changes = computeAnalysisChanges(
      outcome({ zoneIds: ["web-server", "rex-cli", "zone-9"] }),
      outcome(),
      PREVIOUS_AT,
      shape({ zones: [...shape().zones!, { id: "zone-9" }] }),
    );
    expect(changes.zones.added).toEqual([{ id: "zone-9", name: "zone-9", related: null }]);
  });
});

describe("findings", () => {
  it("counts added and resolved separately, by the severity each held", () => {
    // Same total either side, and nothing in common: a net count would call
    // this run a no-op.
    const changes = computeAnalysisChanges(
      outcome({ findings: { critical: ["new1"], warning: ["kept"], info: ["new2"] } }),
      outcome({ findings: { critical: ["gone1", "gone2"], warning: ["kept"] } }),
      PREVIOUS_AT,
      shape(),
    );
    expect(changes.findings.now).toEqual({ critical: 1, warning: 1, info: 1 });
    expect(changes.findings.added).toEqual({ critical: 1, info: 1 });
    expect(changes.findings.resolved).toEqual({ critical: 2 });
  });

  it("treats a finding that changed severity as added at the new one and resolved at the old", () => {
    const changes = computeAnalysisChanges(
      outcome({ findings: { critical: ["k"] } }),
      outcome({ findings: { warning: ["k"] } }),
      PREVIOUS_AT,
      shape(),
    );
    // The key is unchanged, so it is in neither list: the finding is still open.
    expect(changes.findings.added).toEqual({});
    expect(changes.findings.resolved).toEqual({});
    expect(changes.findings.now).toEqual({ critical: 1 });
  });

  it("says nothing moved when both runs found the same things", () => {
    const findings = { critical: ["a"], info: ["b", "c"] };
    const changes = computeAnalysisChanges(outcome({ findings }), outcome({ findings }), PREVIOUS_AT, shape());
    expect(changes.findings).toEqual({ now: { critical: 1, info: 2 }, added: {}, resolved: {} });
  });
});
