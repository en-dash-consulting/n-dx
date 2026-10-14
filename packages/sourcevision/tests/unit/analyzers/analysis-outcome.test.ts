/**
 * What an analysis records about its own result, so the next run can be
 * measured against it: counts, zone ids and one stable key per finding.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { findingKey, readAnalysisOutcome } from "../../../src/analyzers/analysis-outcome.js";

let svDir: string;

function write(file: string, value: unknown): void {
  writeFileSync(join(svDir, file), JSON.stringify(value));
}

beforeEach(() => {
  svDir = mkdtempSync(join(tmpdir(), "sv-outcome-"));
  mkdirSync(svDir, { recursive: true });
});

afterEach(() => {
  rmSync(svDir, { recursive: true, force: true });
});

describe("findingKey", () => {
  it("is the same for the same type, scope and text", () => {
    const finding = { type: "anti-pattern", scope: "web-server", text: "Circular import between routes and store" };
    expect(findingKey(finding)).toBe(findingKey({ ...finding }));
  });

  it("separates the parts, so a shift across the boundary is a different finding", () => {
    expect(findingKey({ type: "a", scope: "bc", text: "d" })).not.toBe(findingKey({ type: "ab", scope: "c", text: "d" }));
  });

  it("ignores the pass that produced the finding", () => {
    // The same problem reached by a different enrichment pass is the same
    // problem; keying on the pass would report it resolved and re-added
    // whenever the route changed.
    const key = findingKey({ type: "observation", scope: "global", text: "Low cohesion" });
    expect(key).toBe(findingKey({ type: "observation", scope: "global", text: "Low cohesion" }));
    expect(key).toHaveLength(10);
  });
});

describe("readAnalysisOutcome", () => {
  it("reduces the analysis files to counts, zone ids and finding keys", () => {
    write("inventory.json", { summary: { totalFiles: 412 } });
    write("imports.json", { summary: { totalEdges: 1203 } });
    write("zones.json", {
      zones: [
        { id: "web-server", subZones: [{ id: "web-server-routes" }] },
        { id: "rex-cli" },
      ],
      findings: [
        { type: "anti-pattern", pass: 3, scope: "web-server", text: "God object", severity: "critical" },
        { type: "observation", pass: 0, scope: "rex-cli", text: "High cohesion" },
      ],
    });

    const outcome = readAnalysisOutcome(svDir);

    expect(outcome).not.toBeNull();
    expect(outcome?.files).toBe(412);
    expect(outcome?.importEdges).toBe(1203);
    expect(outcome?.zoneIds).toEqual(["web-server", "web-server-routes", "rex-cli"]);
    expect(outcome?.findings.critical).toEqual([findingKey({ type: "anti-pattern", scope: "web-server", text: "God object" })]);
    // A finding with no severity is an observation; zones.json leaves the field off.
    expect(outcome?.findings.info).toEqual([findingKey({ type: "observation", scope: "rex-cli", text: "High cohesion" })]);
  });

  it("is null when zones.json is unreadable", () => {
    // Recording zero zones and zero findings would read to the next run as
    // every zone having been removed.
    write("inventory.json", { summary: { totalFiles: 10 } });
    expect(readAnalysisOutcome(svDir)).toBeNull();

    writeFileSync(join(svDir, "zones.json"), "{ truncated");
    expect(readAnalysisOutcome(svDir)).toBeNull();
  });

  it("reports zero for a count file that is missing or has no summary", () => {
    write("zones.json", { zones: [{ id: "only" }] });
    const outcome = readAnalysisOutcome(svDir);
    expect(outcome).toEqual({ files: 0, importEdges: 0, zoneIds: ["only"], findings: {} });
  });

  it("skips a finding missing any part of its key", () => {
    write("zones.json", {
      zones: [],
      findings: [
        { type: "observation", scope: "global" },
        null,
        { type: "observation", scope: "global", text: "Kept", severity: "warning" },
      ],
    });
    expect(readAnalysisOutcome(svDir)?.findings).toEqual({
      warning: [findingKey({ type: "observation", scope: "global", text: "Kept" })],
    });
  });
});
