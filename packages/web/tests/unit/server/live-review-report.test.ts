/**
 * The review report as the Review tab reads it: typed locally, every field
 * optional, unknown values passed through as written.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeReviewReport, readLiveReviewReport } from "../../../src/server/live-review-report.js";

describe("normalizeReviewReport", () => {
  it("keeps a full report as written", () => {
    const report = normalizeReviewReport({
      taskId: "t1", fixesApplied: true, summary: "Attacked the diff.",
      findings: [{
        title: "Race", location: "a.ts:3", severity: "high", verdict: "must-fix", scenario: "two writers",
        action: "fixed", itemId: "i1", note: "n", disposition: "fixed", reason: "r",
      }],
    });
    expect(report).toEqual({
      taskId: "t1", fixesApplied: true, summary: "Attacked the diff.",
      findings: [{
        title: "Race", location: "a.ts:3", severity: "high", verdict: "must-fix", scenario: "two writers",
        action: "fixed", itemId: "i1", note: "n", disposition: "fixed", reason: "r",
      }],
    });
  });

  it("renders unrecognised severity, verdict, action and disposition as their raw text", () => {
    const [finding] = normalizeReviewReport({
      findings: [{ title: "T", severity: "catastrophic", verdict: "maybe", action: "escalated", disposition: "someday" }],
    })!.findings;
    expect(finding).toMatchObject({ severity: "catastrophic", verdict: "maybe", action: "escalated", disposition: "someday" });
  });

  it("keeps findings with missing fields, and a report with no findings array", () => {
    expect(normalizeReviewReport({ findings: [{}, { title: 7 }, "bare title", null, 3] })!.findings).toEqual([
      expect.objectContaining({ title: null, severity: null, action: null }),
      expect.objectContaining({ title: null }),
      expect.objectContaining({ title: "bare title" }),
    ]);
    expect(normalizeReviewReport({})).toEqual({ taskId: null, findings: [], fixesApplied: null, summary: null });
  });

  it("is null when the file is not an object", () => {
    expect(normalizeReviewReport([])).toBeNull();
    expect(normalizeReviewReport("x")).toBeNull();
    expect(normalizeReviewReport(null)).toBeNull();
  });
});

describe("readLiveReviewReport", () => {
  let dir: string;
  beforeEach(() => { dir = realpathSync.native(mkdtempSync(join(tmpdir(), "ndx-review-report-"))); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it("reads .hench/reviews/<runId>.json, and is null before it is written or when it is not JSON", () => {
    expect(readLiveReviewReport(dir, "r1")).toBeNull();
    mkdirSync(join(dir, "reviews"));
    writeFileSync(join(dir, "reviews", "r1.json"), "{ not json");
    expect(readLiveReviewReport(dir, "r1")).toBeNull();
    writeFileSync(join(dir, "reviews", "r1.json"), JSON.stringify({ findings: [] }));
    expect(readLiveReviewReport(dir, "r1")).toMatchObject({ findings: [] });
  });

  it("refuses a run id that is not a plain id", () => {
    expect(readLiveReviewReport(dir, "../r1")).toBeNull();
  });
});
