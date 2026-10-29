/**
 * Every place that recognises write_file as a file change also recognises
 * edit_file — otherwise an API or local run that edits instead of rewriting
 * reads as "no progress", "plan only" or "no files changed".
 */
import { describe, it, expect } from "vitest";
import type { ToolCallRecord } from "../../../src/schema/v1.js";
import { isProgressTool } from "../../../src/agent/analysis/livelock.js";
import { detectPlanOnlyIteration, runHasCodeModifications, createExecutionReminder } from "../../../src/agent/analysis/plan-only-detection.js";
import { buildRunSummary } from "../../../src/agent/analysis/summary.js";
import { classifyChangedFiles } from "../../../src/store/file-classifier.js";
import { classifyFileTool } from "../../../src/store/run-events.js";

const edit: ToolCallRecord = {
  turn: 1,
  tool: "edit_file",
  input: { path: "src/index.ts", old_string: "a", new_string: "b" },
  output: "Edited src/index.ts: replaced 1 occurrence (first at line 1)",
  durationMs: 5,
};

describe("edit_file is a file change everywhere write_file is", () => {
  it("counts as livelock progress", () => {
    expect(isProgressTool("edit_file")).toBe(true);
  });

  it("is a code-modifying call for plan-only detection", () => {
    expect(runHasCodeModifications([edit])).toBe(true);
    expect(detectPlanOnlyIteration([{ type: "tool_use", id: "t1", name: "edit_file", input: {} }] as never).isPlanOnly).toBe(false);
    expect(createExecutionReminder()).toContain("edit_file");
  });

  it("puts the path in the run summary's changed files", () => {
    expect(buildRunSummary([edit]).filesChanged).toEqual(["src/index.ts"]);
  });

  it("is a changed file for the completion gate's classifier", () => {
    expect(classifyChangedFiles([edit]).get("code")).toEqual(["src/index.ts"]);
  });

  it("is an edit for the run's file events", () => {
    expect(classifyFileTool("edit_file")).toBe("edit");
  });
});
