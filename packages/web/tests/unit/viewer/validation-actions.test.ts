// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { ValidationActions } from "../../../src/viewer/views/validation.js";

function findButton(root: HTMLElement, text: string): HTMLButtonElement | undefined {
  return Array.from(root.querySelectorAll("button")).find((b) => b.textContent?.includes(text));
}

describe("ValidationActions", () => {
  let root: HTMLDivElement;
  let fetchMock: ReturnType<typeof vi.fn>;
  let onChanged: (() => void) & ReturnType<typeof vi.fn>;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    onChanged = vi.fn() as (() => void) & ReturnType<typeof vi.fn>;
    vi.useFakeTimers();
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function stub(handler: (url: string, init?: RequestInit) => { status: number; body: unknown }) {
    fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const { status, body } = handler(String(url), init);
      return { ok: status >= 200 && status < 300, status, json: async () => body };
    });
    vi.stubGlobal("fetch", fetchMock);
  }

  function mount() {
    act(() => {
      render(h(ValidationActions, { onChanged }), root);
    });
  }

  it("renders the three actions", () => {
    stub(() => ({ status: 200, body: {} }));
    mount();
    expect(findButton(root, "Preview fixes")).toBeTruthy();
    expect(findButton(root, "Run CI check")).toBeTruthy();
    expect(findButton(root, "Reshape PRD")).toBeTruthy();
  });

  it("previews fixes with dryRun before offering to apply", async () => {
    stub((url) => url.endsWith("/fix")
      ? { status: 200, body: { ok: true, dryRun: true, report: { fixed: 0, issues: [{ kind: "timestamp", id: "t1" }] } } }
      : { status: 200, body: {} });
    mount();

    await act(async () => {
      findButton(root, "Preview fixes")!.click();
      await vi.advanceTimersByTimeAsync(10);
    });

    const body = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(body).toEqual({ dryRun: true });
    expect(root.textContent).toContain("timestamp");
    // Preview must not have changed anything yet.
    expect(onChanged).not.toHaveBeenCalled();
    expect(findButton(root, "Apply fixes")).toBeTruthy();
  });

  it("applies fixes and notifies the parent to re-validate", async () => {
    stub((url) => url.endsWith("/fix")
      ? { status: 200, body: { ok: true, dryRun: false, report: { fixed: 2 } } }
      : { status: 200, body: {} });
    mount();

    await act(async () => {
      findButton(root, "Preview fixes")!.click();
      await vi.advanceTimersByTimeAsync(10);
    });
    await act(async () => {
      findButton(root, "Apply fixes")!.click();
      await vi.advanceTimersByTimeAsync(10);
    });

    const applyCall = fetchMock.mock.calls.find(
      ([, init]) => JSON.parse(String((init as RequestInit).body)).dryRun === false,
    );
    expect(applyCall).toBeTruthy();
    expect(onChanged).toHaveBeenCalled();
  });

  it("shows structured CI results after polling", async () => {
    let polls = 0;
    stub((url) => {
      if (url.endsWith("/ci")) return { status: 202, body: { ok: true } };
      if (url.endsWith("/ci/status")) {
        polls++;
        return polls >= 2
          ? { status: 200, body: { running: false, finishedAt: "t", report: { health: 82, findings: 4, passed: true }, output: "", error: null } }
          : { status: 200, body: { running: true, finishedAt: null, report: null, output: "", error: null } };
      }
      return { status: 200, body: {} };
    });
    mount();

    await act(async () => {
      findButton(root, "Run CI check")!.click();
      await vi.advanceTimersByTimeAsync(10);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(root.textContent).toContain("82");
    expect(root.textContent).toContain("4");
  });

  it("requires confirmation before applying a reshape", async () => {
    stub((url) => {
      if (url.endsWith("/reshape")) return { status: 202, body: { ok: true } };
      if (url.endsWith("/reshape/status")) {
        return { status: 200, body: { running: false, finishedAt: "t", report: { proposals: [{ action: "merge", ids: ["a", "b"] }] }, output: "", error: null } };
      }
      return { status: 200, body: {} };
    });
    mount();

    await act(async () => {
      findButton(root, "Reshape PRD")!.click();
      await vi.advanceTimersByTimeAsync(10);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    // Preview only — the first request must never carry accept.
    const first = JSON.parse(String((fetchMock.mock.calls[0][1] as RequestInit).body));
    expect(first.accept).not.toBe(true);
    expect(root.textContent).toContain("merge");

    const applyBtn = findButton(root, "Apply reshape")!;
    expect(applyBtn).toBeTruthy();
    await act(async () => {
      applyBtn.click();
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(fetchMock.mock.calls.some(
      ([u, init]) => String(u).endsWith("/reshape") && JSON.parse(String((init as RequestInit).body)).accept === true,
    )).toBe(true);
  });

  it("surfaces a failed action", async () => {
    stub((url) => url.endsWith("/fix")
      ? { status: 500, body: { error: "rex CLI not found" } }
      : { status: 200, body: {} });
    mount();
    await act(async () => {
      findButton(root, "Preview fixes")!.click();
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(root.querySelector('[role="alert"]')?.textContent).toContain("rex CLI not found");
  });
});
