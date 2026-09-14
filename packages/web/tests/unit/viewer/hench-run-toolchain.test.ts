// @vitest-environment jsdom
/**
 * Run detail shows which n-dx produced the run.
 *
 * Several checkouts of the toolchain are usually live at once, so a run's
 * version and launching CLI path are what let a reader tell one build's runs
 * from another's. Both are optional on the wire — records written before the
 * fields existed carry neither, and the panel must not render empty rows for
 * them.
 */
import { describe, it, expect } from "vitest";
import { h, render } from "preact";
import { RunDetailView, type RunDetail } from "../../../src/viewer/views/hench-runs.js";

const BASE_RUN: RunDetail = {
  id: "run-1",
  taskId: "task-1",
  taskTitle: "Test task",
  startedAt: "2026-01-01T10:00:00Z",
  finishedAt: "2026-01-01T10:05:00Z",
  status: "completed",
  turns: 3,
  model: "claude-sonnet-4-6",
  tokenUsage: { input: 100, output: 50 },
};

function renderRun(run: RunDetail): HTMLDivElement {
  const root = document.createElement("div");
  render(h(RunDetailView, { run, onBack: () => {} }), root);
  return root;
}

/** Text of the `.hench-info-value` that follows the row labelled `label`. */
function infoValue(root: HTMLDivElement, label: string): string | null {
  for (const row of Array.from(root.querySelectorAll(".hench-info-row"))) {
    if (row.querySelector(".hench-info-label")?.textContent === label) {
      return row.querySelector(".hench-info-value")?.textContent ?? null;
    }
  }
  return null;
}

describe("RunDetailView toolchain metadata", () => {
  it("renders the n-dx version and CLI path when present", () => {
    const root = renderRun({
      ...BASE_RUN,
      ndxVersion: "0.6.0",
      cliPath: "/Users/dev/ndx-core/n-dx/packages/core/cli.js",
    });
    expect(infoValue(root, "n-dx Version")).toBe("0.6.0");
    expect(infoValue(root, "CLI Path")).toBe("/Users/dev/ndx-core/n-dx/packages/core/cli.js");
  });

  // A long path would otherwise be unreadable once the column clips it.
  it("exposes the full CLI path as a title attribute", () => {
    const cliPath = "/Users/dev/ndx-core/n-dx/.claude/worktrees/some-branch/packages/core/cli.js";
    const root = renderRun({ ...BASE_RUN, cliPath });
    const cell = Array.from(root.querySelectorAll(".hench-info-value"))
      .find((el) => el.textContent === cliPath);
    expect(cell?.getAttribute("title")).toBe(cliPath);
  });

  it("omits both rows on a legacy record that carries neither", () => {
    const root = renderRun(BASE_RUN);
    expect(infoValue(root, "n-dx Version")).toBeNull();
    expect(infoValue(root, "CLI Path")).toBeNull();
  });

  it("renders each row independently of the other", () => {
    const root = renderRun({ ...BASE_RUN, ndxVersion: "0.6.0" });
    expect(infoValue(root, "n-dx Version")).toBe("0.6.0");
    expect(infoValue(root, "CLI Path")).toBeNull();
  });
});
