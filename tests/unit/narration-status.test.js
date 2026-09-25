import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { formatNarrationStatus, readNarrationState } from "../../packages/core/narration-status.js";

const started = "2026-09-22T18:00:00.000Z";
const now = Date.parse(started) + 5 * 60_000;

describe("formatNarrationStatus", () => {
  it("says nothing when there is no narration or it finished", () => {
    expect(formatNarrationStatus(null)).toBeNull();
    expect(formatNarrationStatus({ status: "done", zones: ["a"], startedAt: started })).toBeNull();
  });

  it("reports a running narrator with its age, zone count and log", () => {
    const line = formatNarrationStatus(
      { status: "pending", zones: ["a", "b"], names: ["b", "c"], startedAt: started, pid: 1, log: ".sourcevision/.cache/narration.log" },
      { now, isAlive: () => true },
    );
    expect(line).toContain("running for 5m");
    expect(line).toContain("3 zones");
    expect(line).toContain(".sourcevision/.cache/narration.log");
  });

  it("reports a pending narration whose process is gone as exited", () => {
    const line = formatNarrationStatus(
      { status: "pending", zones: ["a"], startedAt: started, pid: 1 },
      { now, isAlive: () => false },
    );
    expect(line).toContain("exited without finishing");
    expect(line).toContain("1 zone)");
  });

  it("reports a failure with its reason and the remedy", () => {
    const line = formatNarrationStatus({ status: "failed", zones: ["a"], startedAt: started, reason: "superseded by a newer analysis" });
    expect(line).toContain("superseded by a newer analysis");
    expect(line).toContain("sv narrate .");
  });
});

describe("readNarrationState", () => {
  let dir;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "ndx-narration-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("returns null without a manifest, or with an unreadable one", () => {
    expect(readNarrationState(dir)).toBeNull();
    mkdirSync(join(dir, ".sourcevision"));
    writeFileSync(join(dir, ".sourcevision", "manifest.json"), "{not json");
    expect(readNarrationState(dir)).toBeNull();
  });

  it("returns the manifest's narration field", () => {
    mkdirSync(join(dir, ".sourcevision"));
    const narration = { status: "pending", zones: ["a"], startedAt: started };
    writeFileSync(join(dir, ".sourcevision", "manifest.json"), JSON.stringify({ narration }));
    expect(readNarrationState(dir)).toEqual(narration);
  });
});
