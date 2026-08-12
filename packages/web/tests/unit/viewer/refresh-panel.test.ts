// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { RefreshPanel, CommandsView } from "../../../src/viewer/views/commands.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
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
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("renders the refresh trigger with fast-mode option", () => {
    act(() => {
      render(h(RefreshPanel, null), root);
    });
    expect(root.textContent).toContain("Refresh Data");
    expect(root.textContent).toContain("ndx refresh --data-only");
    expect(root.querySelector('input[type="checkbox"]')).toBeTruthy();
    expect(root.querySelector("button")?.textContent).toBe("Refresh Data");
  });

  it("POSTs to /api/commands/refresh with the fast flag", async () => {
    fetchMock.mockResolvedValue(jsonResponse(202, { ok: true, startedAt: "t" }));

    act(() => {
      render(h(RefreshPanel, null), root);
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
    expect(root.querySelector("button")?.disabled).toBe(true);
    expect(root.textContent).toContain("Refreshing");
  });

  it("shows an error when the trigger request fails", async () => {
    fetchMock.mockResolvedValue(jsonResponse(500, { error: "refresh exploded" }));

    act(() => {
      render(h(RefreshPanel, null), root);
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
      render(h(CommandsView, null), root);
    });
    expect(root.textContent).toContain("Refresh Data");
    expect(root.textContent).toContain("Export Dashboard");
    expect(root.textContent).toContain("Self-Heal");
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });
});
