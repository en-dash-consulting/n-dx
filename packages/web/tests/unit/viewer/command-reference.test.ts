// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { CommandReferenceView } from "../../../src/viewer/views/command-reference.js";

const MANIFEST = {
  cliName: "myapp",
  groups: [
    {
      id: "setup", label: "Setup", commands: [
        { name: "init", invocation: "myapp init", description: "Initialize project", status: "available" },
      ],
    },
    {
      id: "analysis", label: "Analysis", commands: [
        {
          name: "analyze", invocation: "myapp analyze", description: "Run analysis", status: "available",
          trigger: { endpoint: "/api/commands/sv-analyze", method: "POST" },
        },
        {
          name: "refresh", invocation: "myapp refresh", description: "Refresh data", status: "available",
          trigger: { endpoint: "/api/commands/refresh", method: "POST", statusEndpoint: "/api/commands/refresh/status" },
        },
        {
          name: "locked", invocation: "myapp locked", description: "Needs setup first", status: "needs-init",
          trigger: { endpoint: "/api/commands/locked", method: "POST" },
        },
      ],
    },
    {
      id: "execution", label: "Execution", commands: [
        { name: "work", invocation: "myapp work", description: "Execute the next task", status: "needs-llm" },
        // A command the component has never heard of — must render anyway
        // (server-driven manifest contract).
        { name: "teleport", invocation: "myapp teleport", description: "Beam the repo somewhere", status: "needs-init" },
      ],
    },
  ],
};

describe("CommandReferenceView", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.unstubAllGlobals();
  });

  async function renderWith(response: unknown, status = 200) {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => response,
    })));
    act(() => {
      render(h(CommandReferenceView, null), root);
    });
    await new Promise((r) => setTimeout(r, 10));
    await act(async () => {});
  }

  it("renders groups and rows straight from the manifest", async () => {
    await renderWith(MANIFEST);
    expect(root.textContent).toContain("Setup");
    expect(root.textContent).toContain("Execution");
    expect(root.textContent).toContain("myapp init");
    expect(root.textContent).toContain("Initialize project");
    // Unknown command renders without any component change
    expect(root.textContent).toContain("myapp teleport");
    expect(root.textContent).toContain("Beam the repo somewhere");
  });

  it("shows an accessible availability status per row", async () => {
    await renderWith(MANIFEST);
    const statuses = Array.from(root.querySelectorAll(".cmdref-status")).map((el) => el.textContent);
    expect(statuses.some((s) => s?.includes("available"))).toBe(true);
    expect(statuses.some((s) => s?.includes("needs LLM"))).toBe(true);
    expect(statuses.some((s) => s?.includes("needs init"))).toBe(true);
  });

  it("shows an error state when the manifest cannot load", async () => {
    await renderWith({ error: "boom" }, 500);
    expect(root.querySelector('[role="alert"]')?.textContent).toBeTruthy();
  });

  function rowFor(name: string): HTMLTableRowElement {
    return Array.from(root.querySelectorAll("tbody tr"))
      .find((tr) => tr.textContent?.includes(`myapp ${name}`)) as HTMLTableRowElement;
  }

  it("renders a Run button only for trigger-bearing available commands", async () => {
    await renderWith(MANIFEST);
    expect(rowFor("analyze").querySelector("button.cmdref-run")).toBeTruthy();
    // Trigger present but status needs-init → button disabled
    const lockedBtn = rowFor("locked").querySelector("button.cmdref-run") as HTMLButtonElement;
    expect(lockedBtn?.disabled).toBe(true);
    // No trigger → read-only row
    expect(rowFor("work").querySelector("button.cmdref-run")).toBeNull();
    expect(rowFor("teleport").querySelector("button.cmdref-run")).toBeNull();
  });

  it("Run POSTs the declared endpoint and records a last-run outcome", async () => {
    const fetchMock = vi.fn(async (url: string) => ({
      ok: true,
      status: 200,
      json: async () => (String(url).endsWith("/manifest") ? MANIFEST : { ok: true }),
    }));
    vi.stubGlobal("fetch", fetchMock);
    act(() => {
      render(h(CommandReferenceView, null), root);
    });
    await new Promise((r) => setTimeout(r, 10));
    await act(async () => {});

    const runBtn = rowFor("analyze").querySelector("button.cmdref-run") as HTMLButtonElement;
    await act(async () => {
      runBtn.click();
      await new Promise((r) => setTimeout(r, 0));
    });

    expect(fetchMock.mock.calls.some(
      ([u, init]) => String(u) === "/api/commands/sv-analyze" && (init as RequestInit)?.method === "POST",
    )).toBe(true);
    expect(rowFor("analyze").textContent).toContain("last run");
  });

  it("async triggers poll the status endpoint until finished", async () => {
    let statusCalls = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      const u = String(url);
      if (u.endsWith("/manifest")) return { ok: true, status: 200, json: async () => MANIFEST };
      if (u.endsWith("/refresh") && init?.method === "POST") {
        return { ok: true, status: 202, json: async () => ({ ok: true, startedAt: "t" }) };
      }
      if (u.endsWith("/refresh/status")) {
        statusCalls++;
        return {
          ok: true, status: 200,
          json: async () => (statusCalls >= 2
            ? { running: false, finishedAt: "t2", error: null }
            : { running: true, finishedAt: null, error: null }),
        };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.useFakeTimers();
    act(() => {
      render(h(CommandReferenceView, null), root);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20);
    });

    const runBtn = rowFor("refresh").querySelector("button.cmdref-run") as HTMLButtonElement;
    await act(async () => {
      runBtn.click();
      await vi.advanceTimersByTimeAsync(10);
    });
    expect(rowFor("refresh").textContent).toContain("running");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(statusCalls).toBeGreaterThanOrEqual(2);
    expect(rowFor("refresh").textContent).toContain("last run");
    vi.useRealTimers();
  });
});
