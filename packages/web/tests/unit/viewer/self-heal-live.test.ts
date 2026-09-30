// @vitest-environment jsdom
/**
 * SelfHealPanel progress and stop, now sourced from the shared job tray.
 *
 * The panel used to run its own 2s poll of /api/commands/self-heal/status and
 * own the Stop request. Both moved to the tray, so what these tests pin is the
 * handover: the panel renders whatever the tray reports, and its Stop is the
 * tray's Stop. The iteration/phase parsing that used to live here moved with
 * the poll — it is covered in use-active-operations.test.ts.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { SelfHealPanel } from "../../../src/viewer/views/commands.js";
import { emptyJobTray, jobTrayWith, makeOperation } from "../../helpers/job-tray.js";
import type { ActiveOperation } from "../../../src/viewer/hooks/index.js";

/** A self-heal operation in the given state. */
function selfHealOp(overrides: Partial<ActiveOperation> = {}): ActiveOperation {
  return makeOperation({
    id: "self-heal:singleton",
    kind: "self-heal",
    label: "Self-heal",
    startedAt: "2026-08-14T10:00:00.000Z",
    stopUrl: "/api/commands/self-heal/stop",
    result: { view: "prd", label: "View PRD" },
    ...overrides,
  });
}

describe("SelfHealPanel live progress and stop control", () => {
  let root: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    act(() => { render(null, root); });
    root.remove();
    vi.unstubAllGlobals();
  });

  /** Mount, then click through the destructive-action gate. */
  function mountPanel(jobs: Parameters<typeof SelfHealPanel>[0]["jobs"]): void {
    act(() => { render(h(SelfHealPanel, { jobs }), root); });
    const proceed = Array.from(root.querySelectorAll("button"))
      .find((b) => b.textContent?.includes("I understand"))!;
    act(() => { proceed.click(); });
    act(() => { render(h(SelfHealPanel, { jobs }), root); });
  }

  it("shows the iteration and phase the tray reports, with no poll of its own", () => {
    mountPanel(jobTrayWith([selfHealOp({ detail: "iteration 2/3 · phase: recommend" })]));

    expect(root.textContent).toContain("iteration 2/3");
    expect(root.textContent?.toLowerCase()).toContain("recommend");
    expect(fetchMock.mock.calls.map((c) => String(c[0])))
      .not.toContain("/api/commands/self-heal/status");
  });

  it("offers a Stop while running and routes it through the tray", () => {
    const stopped: ActiveOperation[] = [];
    mountPanel(jobTrayWith([selfHealOp()], stopped));

    const stopBtn = Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.trim() === "Stop");
    expect(stopBtn).toBeTruthy();

    act(() => { stopBtn!.click(); });
    expect(stopped.map((op) => op.kind)).toEqual(["self-heal"]);
  });

  it("reports an operator stop as stopped, not as a failure", () => {
    mountPanel(jobTrayWith([selfHealOp({
      status: "done",
      finishedAt: "2026-08-14T10:05:00.000Z",
      stopped: true,
    })]));

    expect(root.textContent?.toLowerCase()).toContain("stopped");
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });

  it("reports a failed run as a failure", () => {
    mountPanel(jobTrayWith([selfHealOp({
      status: "failed",
      finishedAt: "2026-08-14T10:05:00.000Z",
      error: "no LLM credentials",
    })]));

    expect(root.querySelector('[role="alert"]')?.textContent).toContain("no LLM credentials");
  });

  it("starts the loop and asks the tray to re-read", async () => {
    const refreshed: number[] = [];
    const jobs = { ...emptyJobTray(), refresh: async () => { refreshed.push(1); } };
    mountPanel(jobs);

    const start = Array.from(root.querySelectorAll("button"))
      .find((b) => b.textContent?.match(/Run Self-Heal/))!;
    await act(async () => {
      start.click();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(fetchMock.mock.calls.some(
      ([u, init]) => String(u).endsWith("/api/commands/self-heal") && (init as RequestInit)?.method === "POST",
    )).toBe(true);
    expect(refreshed).toHaveLength(1);
  });
});
