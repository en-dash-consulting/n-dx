// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { RunDetailView, type RunDetail } from "../../../src/viewer/views/hench-runs.js";

const root = document.createElement("div");
afterEach(() => { act(() => { render(null, root); }); });

describe("run detail session reasons", () => {
  it.each([
    ["fork-unsupported", "this CLI or provider cannot fork an orientation session"],
    ["identity-unavailable", "the Codex account or execution identity could not be verified"],
    ["identity-changed", "the checkout, policy or execution identity changed"],
    ["future-reason", "future-reason"],
  ])("explains %s without denying resume support", (reason, prose) => {
    const run: RunDetail = {
      id: "run-1", taskId: "task-1", taskTitle: "Test task",
      startedAt: "2026-11-16T10:00:00Z", finishedAt: "2026-11-16T10:05:00Z",
      status: "completed", turns: 1, model: "gpt-6-astra", vendor: "codex",
      tokenUsage: { input: 100, output: 50 },
      session: { strategy: "cold", outcome: "miss", reason },
    };
    act(() => { render(h(RunDetailView, { run, onBack: () => {} }), root); });
    const row = Array.from(root.querySelectorAll(".hench-diag-item"))
      .find(item => item.querySelector(".hench-diag-label")?.textContent === "Reason");
    expect(row?.querySelector(".hench-diag-value")?.textContent).toBe(prose);
    expect(root.textContent).not.toContain("cannot resume a session by id");
  });
});
