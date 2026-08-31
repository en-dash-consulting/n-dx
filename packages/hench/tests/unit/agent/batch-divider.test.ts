/**
 * Tests for the batch task-boundary divider.
 *
 * Batching's known cost is cross-task pollution: the next brief arrives as a
 * follow-up turn in a conversation that just finished a different task, so
 * without an explicit boundary the model may treat the finished task's plan as
 * still open. These assertions pin the three things the divider has to say —
 * the previous task is done, prior turns are background, re-read before
 * editing — since a divider that merely looked decorative would pass a
 * "contains a separator" test while doing nothing.
 */

import { describe, it, expect } from "vitest";
import { buildTaskBoundaryDivider } from "../../../src/agent/lifecycle/batch-divider.js";

describe("buildTaskBoundaryDivider", () => {
  it("states the task's position in the session", () => {
    const divider = buildTaskBoundaryDivider({ taskNumber: 2, tasksPerSession: 4 });
    expect(divider).toContain("task 2 of up to 4");
  });

  it("declares the previous task finished so its plan is not resumed", () => {
    const divider = buildTaskBoundaryDivider({ taskNumber: 2, tasksPerSession: 4 });
    expect(divider.toLowerCase()).toContain("finished");
    expect(divider.toLowerCase()).toMatch(/do not continue/);
  });

  it("names the previous task when it is known", () => {
    const divider = buildTaskBoundaryDivider({
      taskNumber: 3,
      tasksPerSession: 4,
      previousTaskTitle: "Add the batch strategy",
    });
    expect(divider).toContain('"Add the batch strategy"');
  });

  it("still reads correctly when the previous title is unknown", () => {
    const divider = buildTaskBoundaryDivider({ taskNumber: 2, tasksPerSession: 4 });
    expect(divider).toContain("The previous task is finished");
    expect(divider).not.toContain("undefined");
  });

  it("demotes earlier turns to background rather than instructions", () => {
    const divider = buildTaskBoundaryDivider({ taskNumber: 2, tasksPerSession: 4 });
    expect(divider.toLowerCase()).toContain("background only");
  });

  it("tells the model the working tree has moved since those turns", () => {
    // The failure this prevents: acting on a file's contents as remembered
    // from an earlier task, after the previous task changed it.
    const divider = buildTaskBoundaryDivider({ taskNumber: 2, tasksPerSession: 4 });
    expect(divider.toLowerCase()).toMatch(/re-read/);
    expect(divider.toLowerCase()).toMatch(/moved|changed/);
  });

  it("is visually unmissable in a transcript", () => {
    const divider = buildTaskBoundaryDivider({ taskNumber: 2, tasksPerSession: 4 });
    expect(divider).toContain("═".repeat(72));
    expect(divider).toContain("NEW TASK");
  });

  it("ends with a blank line so the brief does not run into it", () => {
    const divider = buildTaskBoundaryDivider({ taskNumber: 2, tasksPerSession: 4 });
    expect(divider.endsWith("\n")).toBe(true);
  });
});
