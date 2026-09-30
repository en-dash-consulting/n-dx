// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { RefreshPanel, CommandsView } from "../../../src/viewer/views/commands.js";
import { emptyJobTray, jobTrayWith, makeOperation } from "../../helpers/job-tray.js";
import type { ActiveOperation } from "../../../src/viewer/hooks/use-active-operations.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** A tray reporting a refresh in the given state. */
function refreshTray(overrides: Partial<ActiveOperation> = {}, stopped: ActiveOperation[] = []) {
  return jobTrayWith([makeOperation({
    id: "refresh:singleton",
    kind: "refresh",
    label: "Refresh",
    stopUrl: "/api/commands/refresh/stop",
    result: { view: "analysis", label: "View analysis" },
    ...overrides,
  })], stopped);
}

describe("RefreshPanel", () => {
  let root: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    // Unmount inside act() to match every act()-wrapped render/update above —
    // an unwrapped unmount still commits, which can re-arm preact's real
    // requestAnimationFrame/setTimeout(35) after-paint fallback instead of
    // flushing synchronously.
    act(() => { render(null, root); });
    root.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("renders the refresh trigger with fast-mode option", () => {
    act(() => {
      render(h(RefreshPanel, { jobs: emptyJobTray() }), root);
    });
    expect(root.textContent).toContain("Refresh Data");
    // CLI name is project-resolved; assert the command, not the binary name.
    expect(root.textContent).toContain("refresh --data-only");
    expect(root.querySelector('input[type="checkbox"]')).toBeTruthy();
    expect(root.querySelector("button")?.textContent).toBe("Refresh Data");
  });

  it("reports a running refresh from the shared job tray, not its own poll", () => {
    // The panel used to run a 2s setInterval against /api/commands/refresh/status.
    // Its running state now comes entirely from the tray, so a tray reporting a
    // run must be enough to show it — with no fetch of its own.
    act(() => {
      render(h(RefreshPanel, { jobs: refreshTray({ detail: "analyzing zones" }) }), root);
    });

    expect(root.textContent).toContain("analyzing zones");
    expect(root.querySelector("button")?.disabled).toBe(true);
    // useCliName's /api/project probe is the only call this panel may make.
    for (const call of fetchMock.mock.calls) {
      expect(String(call[0])).not.toContain("/api/commands/refresh/status");
    }
  });

  it("stops the running refresh through the tray", () => {
    const stopped: ActiveOperation[] = [];
    act(() => {
      render(h(RefreshPanel, { jobs: refreshTray({}, stopped) }), root);
    });

    const stop = [...root.querySelectorAll("button")].find((b) => b.textContent === "Stop");
    expect(stop).toBeTruthy();
    act(() => { (stop as HTMLButtonElement).click(); });
    expect(stopped.map((op) => op.kind)).toEqual(["refresh"]);
  });

  it("reports a stopped refresh as a request, not a failure", () => {
    act(() => {
      render(h(RefreshPanel, {
        jobs: refreshTray({ status: "done", finishedAt: "2026-08-26T10:05:00.000Z", stopped: true }),
      }), root);
    });
    expect(root.textContent).toContain("Refresh stopped by request.");
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });

  it("POSTs to /api/commands/refresh with the fast flag", async () => {
    // A factory, not a shared instance: RefreshPanel mounts useCliName(), whose
    // background effect also calls fetch("/api/project") against this same
    // mock. A Response body can only be read once, so a single shared
    // instance here means whichever of the two calls reads it second throws
    // "TypeError: Body is unusable: Body has already been read" — which
    // useCliName swallows, but which also lands RefreshPanel's own POST in
    // that same failure path if it loses the race, flipping its state to
    // "error" via a commit outside any act() call.
    fetchMock.mockImplementation(async () => jsonResponse(202, { ok: true, startedAt: "t" }));

    act(() => {
      render(h(RefreshPanel, { jobs: emptyJobTray() }), root);
    });
    const checkbox = root.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => {
      checkbox.checked = true;
      checkbox.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const button = root.querySelector("button") as HTMLButtonElement;
    await act(async () => {
      button.click();
    });

    expect(fetchMock).toHaveBeenCalledWith("/api/commands/refresh", expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ fast: true }),
    }));
    // The panel does not flip itself to "running" — the tray it was handed is
    // empty, and the tray is the only thing that decides a job is in flight.
    // What the panel owes the caller here is the refresh, so the next render
    // has the run to report.
    expect(root.textContent).toContain("Refresh Data");
  });

  it("shows an error when the trigger request fails", async () => {
    // Factory, not a shared instance — see the comment in the previous test.
    fetchMock.mockImplementation(async () => jsonResponse(500, { error: "refresh exploded" }));

    act(() => {
      render(h(RefreshPanel, { jobs: emptyJobTray() }), root);
    });
    const button = root.querySelector("button") as HTMLButtonElement;
    await act(async () => {
      button.click();
      // Flush the async click handler's fetch + json + state updates
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(root.querySelector('[role="alert"]')?.textContent).toContain("refresh exploded");
  });
});

describe("CommandsView", () => {
  it("includes the refresh panel alongside export and self-heal", () => {
    const root = document.createElement("div");
    document.body.appendChild(root);
    vi.stubGlobal("fetch", vi.fn());
    act(() => {
      render(h(CommandsView, { jobs: emptyJobTray() }), root);
    });
    expect(root.textContent).toContain("Refresh Data");
    expect(root.textContent).toContain("Export Dashboard");
    expect(root.textContent).toContain("Self-Heal");
    act(() => { render(null, root); });
    root.remove();
    vi.unstubAllGlobals();
  });
});
