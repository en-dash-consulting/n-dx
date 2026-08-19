// @vitest-environment jsdom
/**
 * Tests for the EnrichmentGate component — the unlock page shown for
 * pass-gated SourceVision views (Architecture P2, Problems P3,
 * Suggestions P4).
 *
 * Covers: rendering, the targeted-unlock and full-analysis triggers,
 * status polling to completion, 409 handling, and error feedback.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { EnrichmentGate } from "../../../src/viewer/components/enrichment-gate.js";

/** Poll until an assertion passes or timeout is reached. */
async function waitFor(fn: () => void, timeout = 3000) {
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

describe("EnrichmentGate", () => {
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
    vi.restoreAllMocks();
  });

  function mount() {
    render(h(EnrichmentGate, { title: "Problems", requiredPass: 3, currentPass: 1, pollIntervalMs: 20 }), root);
  }

  function postCalls() {
    return fetchSpy.mock.calls.filter(([u, init]) =>
      String(u) === "/api/commands/sv-analyze" && (init as RequestInit | undefined)?.method === "POST");
  }

  it("renders the locked heading, pass requirement, and both actions", () => {
    mount();
    expect(root.querySelector(".locked-view")).toBeTruthy();
    expect(root.textContent).toContain("Problems");
    expect(root.textContent).toContain("Requires enrichment pass 3");
    expect(root.textContent).toContain("(current: 1");
    expect(root.querySelector(".enrichment-gate-unlock")?.textContent).toContain("to pass 3");
    expect(root.querySelector(".enrichment-gate-full")?.textContent).toContain("full analysis");
  });

  it("targeted unlock POSTs targetPass and polls status to completion", async () => {
    let statusResponse = { running: true, startedAt: "now", finishedAt: null as string | null, recentOutput: "Enrichment pass 2...", error: null as string | null };
    fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url) === "/api/commands/sv-analyze" && init?.method === "POST") {
        return Promise.resolve({ ok: true, status: 202, json: () => Promise.resolve({ ok: true }) });
      }
      if (String(url) === "/api/commands/sv-analyze/status") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(statusResponse) });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    });

    mount();
    (root.querySelector(".enrichment-gate-unlock") as HTMLButtonElement).click();

    await waitFor(() => {
      expect(postCalls()).toHaveLength(1);
    });
    const body = JSON.parse((postCalls()[0][1] as RequestInit).body as string);
    expect(body).toEqual({ targetPass: 3 });

    // Buttons disabled while running
    await waitFor(() => {
      expect((root.querySelector(".enrichment-gate-unlock") as HTMLButtonElement).disabled).toBe(true);
      expect((root.querySelector(".enrichment-gate-full") as HTMLButtonElement).disabled).toBe(true);
    });

    // Finish the run; the next poll tick observes completion
    statusResponse = { ...statusResponse, running: false, finishedAt: "now", error: null };
    await waitFor(() => {
      expect(root.textContent).toContain("Analysis complete");
    });
    expect((root.querySelector(".enrichment-gate-unlock") as HTMLButtonElement).disabled).toBe(false);
  });

  it("full analysis POSTs full: true", async () => {
    fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url) === "/api/commands/sv-analyze" && init?.method === "POST") {
        return Promise.resolve({ ok: true, status: 202, json: () => Promise.resolve({ ok: true }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ running: true, startedAt: "now", finishedAt: null, recentOutput: "", error: null }) });
    });

    mount();
    (root.querySelector(".enrichment-gate-full") as HTMLButtonElement).click();

    await waitFor(() => {
      expect(postCalls()).toHaveLength(1);
    });
    const body = JSON.parse((postCalls()[0][1] as RequestInit).body as string);
    expect(body).toEqual({ full: true });
  });

  it("a 409 (already running) keeps polling instead of erroring", async () => {
    fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url) === "/api/commands/sv-analyze" && init?.method === "POST") {
        return Promise.resolve({ ok: false, status: 409, json: () => Promise.resolve({ error: "A full analysis is already running" }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ running: true, startedAt: "now", finishedAt: null, recentOutput: "", error: null }) });
    });

    mount();
    (root.querySelector(".enrichment-gate-unlock") as HTMLButtonElement).click();

    await waitFor(() => {
      expect((root.querySelector(".enrichment-gate-unlock") as HTMLButtonElement).disabled).toBe(true);
    });
    expect(root.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows an error when the run fails to start", async () => {
    fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url) === "/api/commands/sv-analyze" && init?.method === "POST") {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({ error: "sourcevision binary not found" }) });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    });

    mount();
    (root.querySelector(".enrichment-gate-unlock") as HTMLButtonElement).click();

    await waitFor(() => {
      expect(root.querySelector('[role="alert"]')?.textContent).toContain("sourcevision binary not found");
    });
  });

  it("shows the analyzer's error when a run finishes with a failure", async () => {
    let statusResponse = { running: true, startedAt: "now", finishedAt: null as string | null, recentOutput: "", error: null as string | null };
    fetchSpy.mockImplementation((url: string, init?: RequestInit) => {
      if (String(url) === "/api/commands/sv-analyze" && init?.method === "POST") {
        return Promise.resolve({ ok: true, status: 202, json: () => Promise.resolve({ ok: true }) });
      }
      if (String(url) === "/api/commands/sv-analyze/status") {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(statusResponse) });
      }
      return Promise.resolve({ ok: false, status: 404, json: () => Promise.resolve({}) });
    });

    mount();
    (root.querySelector(".enrichment-gate-unlock") as HTMLButtonElement).click();
    await waitFor(() => {
      expect(postCalls()).toHaveLength(1);
    });

    statusResponse = { running: false, startedAt: "now", finishedAt: "now", recentOutput: "", error: "no LLM credentials" };
    await waitFor(() => {
      expect(root.querySelector('[role="alert"]')?.textContent).toContain("no LLM credentials");
    });
  });
});
