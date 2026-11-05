// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { OutcomesPanel } from "../../../src/viewer/views/outcomes-panel.js";

async function waitFor(fn: () => void, timeout = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { fn(); return; } catch { await new Promise<void>((r) => setTimeout(r, 10)); }
  }
  fn();
}

function run(over: Record<string, unknown>) {
  return { startedAt: new Date().toISOString(), status: "completed", vendor: "claude", weight: "standard", model: "m", ...over };
}

describe("OutcomesPanel", () => {
  let root: HTMLDivElement;
  let fetchSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  function stubRuns(runs: unknown[]) {
    fetchSpy.mockResolvedValue({ ok: true, json: () => Promise.resolve({ runs }) });
  }

  it("shows a bar per vendor and tier, the ungated count, and the machine-local window", async () => {
    stubRuns([
      run({ gate: "passed" }), run({ gate: "failed" }), run({ gate: undefined }),
      run({ vendor: "codex", weight: "light", gate: "passed" }),
    ]);
    render(h(OutcomesPanel, null), root);
    await waitFor(() => expect(root.querySelectorAll(".outcomes-row")).toHaveLength(2));

    const claude = root.querySelector<HTMLElement>('[data-vendor="claude"][data-tier="standard"]')!;
    expect(claude.querySelector(".outcomes-rate")?.textContent).toBe("50%");
    expect(claude.querySelector(".outcomes-runs")?.textContent).toBe("3 runs");
    expect(root.querySelector('[data-vendor="codex"] .outcomes-rate')?.textContent).toBe("100%");
    expect(root.querySelector(".outcomes-ungated")?.textContent).toContain("1 run without a gate result");
    const note = root.querySelector(".outcomes-note:last-child")?.textContent ?? "";
    expect(note).toContain("Runs on this machine");
    expect(note).toContain("last 30 days");
  });

  it("says so when the window holds no runs", async () => {
    stubRuns([]);
    render(h(OutcomesPanel, null), root);
    await waitFor(() => expect(root.querySelector(".outcomes-empty")).toBeTruthy());
    expect(root.textContent).toContain("Runs on this machine");
  });

  it("reports a read failure", async () => {
    fetchSpy.mockRejectedValue(new Error("down"));
    render(h(OutcomesPanel, null), root);
    await waitFor(() => expect(root.textContent).toContain("Could not read run records"));
  });
});
