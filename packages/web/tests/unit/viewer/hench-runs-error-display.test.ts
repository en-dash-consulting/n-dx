/**
 * A run exported without transcripts has no `error` body — `ndx export` strips
 * it from both the per-run file and the `runs.json` index because a failure
 * body echoes whatever the agent read. The static run detail must still say
 * *something* where the Error section would be, or a failed run reads as a run
 * that failed for no reason at all.
 */

import { describe, it, expect } from "vitest";
import { runErrorDisplay } from "../../../src/viewer/views/hench-runs.js";

describe("runErrorDisplay", () => {
  it("shows the error body when the record carries one", () => {
    const d = runErrorDisplay({ status: "failed", error: "ENOENT: no such file" }, "ndx");
    expect(d).toEqual({ omitted: false, text: "ENOENT: no such file" });
  });

  it("explains the absence for a failed run whose transcript was stripped", () => {
    const d = runErrorDisplay({ status: "failed", transcriptOmitted: true }, "ndx");
    expect(d?.omitted).toBe(true);
    expect(d?.text).toContain("ndx export --include-transcripts");
    // The neutral marker names no failure detail of its own.
    expect(d?.text).not.toContain("ENOENT");
  });

  it("covers the `error` status the same way as `failed`", () => {
    expect(runErrorDisplay({ status: "error", transcriptOmitted: true }, "n-dx")?.omitted).toBe(true);
  });

  it("stays silent for a successful run, stripped or not", () => {
    expect(runErrorDisplay({ status: "completed", transcriptOmitted: true }, "ndx")).toBeNull();
    expect(runErrorDisplay({ status: "completed" }, "ndx")).toBeNull();
  });

  it("stays silent for a live-dashboard run that simply has no error", () => {
    expect(runErrorDisplay({ status: "failed" }, "ndx")).toBeNull();
  });

  it("prefers a present error body over the omission notice", () => {
    const d = runErrorDisplay({ status: "failed", error: "boom", transcriptOmitted: true }, "ndx");
    expect(d).toEqual({ omitted: false, text: "boom" });
  });
});
