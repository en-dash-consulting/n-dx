// @vitest-environment jsdom
/**
 * Tests for the Overview NextStepsPanel component.
 *
 * Covers: hidden states (loading/empty/error), section styling, per-item
 * copy, copy-all as markdown, and the capture-to-PRD confirm flow with
 * success and error feedback.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { NextStepsPanel } from "../../../src/viewer/views/overview.js";

/** Poll until an assertion passes or timeout is reached. */
async function waitFor(fn: () => void, timeout = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      fn();
      return;
    } catch {
      await new Promise<void>((r) => setTimeout(r, 10));
    }
  }
  fn(); // Final attempt — let it throw
}

const STEPS = [
  { priority: "high", title: "Fix circular dependency", description: "Break the hench cycle", category: "fix" },
  { priority: "medium", title: "Extract shared helpers", description: "Reduce duplication", category: "extract" },
];

describe("NextStepsPanel", () => {
  let root: HTMLDivElement;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let clipboardWrite: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);

    fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    clipboardWrite = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: clipboardWrite },
      configurable: true,
    });
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function stubSteps(steps: unknown[] = STEPS) {
    fetchSpy.mockImplementation((url: string) => {
      if (String(url).startsWith("/api/sv/next-steps")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ steps }) });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    });
  }

  async function mount() {
    render(h(NextStepsPanel, null), root);
    await waitFor(() => {
      expect(root.querySelector(".overview-next-steps")).toBeTruthy();
    });
  }

  it("renders nothing while loading, on empty data, and on fetch error", async () => {
    // Error case
    fetchSpy.mockRejectedValue(new Error("network down"));
    render(h(NextStepsPanel, null), root);
    await new Promise((r) => setTimeout(r, 50));
    expect(root.querySelector(".overview-next-steps")).toBeNull();
    render(null, root);

    // Empty case
    stubSteps([]);
    render(h(NextStepsPanel, null), root);
    await new Promise((r) => setTimeout(r, 50));
    expect(root.querySelector(".overview-next-steps")).toBeNull();
  });

  it("renders steps inside a standard overview section with priority tags", async () => {
    stubSteps();
    await mount();

    const section = root.querySelector(".overview-next-steps")!;
    expect(section.classList.contains("overview-section")).toBe(true);
    expect(section.querySelector(".section-header-row h3")?.textContent).toBe("Next Steps");

    const items = section.querySelectorAll(".next-step-item");
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain("Fix circular dependency");
    expect(items[0].textContent).toContain("Break the hench cycle");
    expect(items[0].querySelector(".next-step-priority-high")).toBeTruthy();
    expect(items[1].querySelector(".next-step-priority-medium")).toBeTruthy();
  });

  it("copies a single step's title and description", async () => {
    stubSteps();
    await mount();

    const copyBtn = root.querySelector<HTMLButtonElement>(".next-step-item .next-step-copy")!;
    copyBtn.click();

    await waitFor(() => {
      expect(clipboardWrite).toHaveBeenCalledTimes(1);
    });
    const copied = clipboardWrite.mock.calls[0][0] as string;
    expect(copied).toContain("Fix circular dependency");
    expect(copied).toContain("Break the hench cycle");
  });

  it("copies all steps as a markdown list", async () => {
    stubSteps();
    await mount();

    const copyAll = root.querySelector<HTMLButtonElement>(".next-steps-copy-all")!;
    copyAll.click();

    await waitFor(() => {
      expect(clipboardWrite).toHaveBeenCalledTimes(1);
    });
    const md = clipboardWrite.mock.calls[0][0] as string;
    expect(md).toContain("1. **[high]** Fix circular dependency");
    expect(md).toContain("2. **[medium]** Extract shared helpers");
  });

  it("captures steps to the PRD after confirmation and shows the result", async () => {
    stubSteps();
    await mount();

    // No POST yet
    const captureBtn = root.querySelector<HTMLButtonElement>(".next-steps-capture-btn")!;
    captureBtn.click();

    // Confirmation step appears, still no POST
    await waitFor(() => {
      expect(root.querySelector(".next-steps-confirm")).toBeTruthy();
    });
    expect(fetchSpy.mock.calls.filter(([u]) => String(u).includes("capture-next-steps"))).toHaveLength(0);

    fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url) === "/api/rex/capture-next-steps" && init?.method === "POST") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true, created: 1, skipped: 1 }) });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    });

    const confirmBtn = root.querySelector<HTMLButtonElement>(".next-steps-confirm-btn")!;
    confirmBtn.click();

    await waitFor(() => {
      expect(root.textContent).toContain("Captured 1");
    });
    expect(root.textContent).toContain("1 duplicate");

    const call = fetchSpy.mock.calls.find(([u]) => String(u) === "/api/rex/capture-next-steps")!;
    const body = JSON.parse((call[1] as RequestInit).body as string);
    expect(body.steps).toHaveLength(2);
    expect(body.steps[0].title).toBe("Fix circular dependency");
  });

  it("cancelling the confirmation makes no request", async () => {
    stubSteps();
    await mount();

    root.querySelector<HTMLButtonElement>(".next-steps-capture-btn")!.click();
    await waitFor(() => {
      expect(root.querySelector(".next-steps-cancel-btn")).toBeTruthy();
    });

    root.querySelector<HTMLButtonElement>(".next-steps-cancel-btn")!.click();
    await waitFor(() => {
      expect(root.querySelector(".next-steps-confirm")).toBeNull();
    });
    expect(fetchSpy.mock.calls.filter(([u]) => String(u).includes("capture-next-steps"))).toHaveLength(0);
  });

  it("shows an error when capture fails", async () => {
    stubSteps();
    await mount();

    root.querySelector<HTMLButtonElement>(".next-steps-capture-btn")!.click();
    await waitFor(() => {
      expect(root.querySelector(".next-steps-confirm-btn")).toBeTruthy();
    });

    fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url) === "/api/rex/capture-next-steps" && init?.method === "POST") {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: "store unavailable" }) });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    });

    root.querySelector<HTMLButtonElement>(".next-steps-confirm-btn")!.click();
    await waitFor(() => {
      expect(root.querySelector('[role="alert"]')).toBeTruthy();
    });
    expect(root.textContent).toContain("store unavailable");
  });
});
