// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  bootViewer,
  ensureBrowserStubs,
  jsonResponse,
  teardownViewer,
  waitFor,
} from "../helpers/viewer-boot.js";

interface MockApiOptions {
  scope?: string | null;
}

function createMockApi(options: MockApiOptions = {}): typeof fetch {
  const scope = options.scope ?? "rex";

  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url === "/api/config") return jsonResponse({ scope });
    if (url === "/api/project") return jsonResponse({ name: "n-dx", description: null, version: null, git: null, nameSource: "directory" });
    if (url === "/api/status") {
      return jsonResponse({
        sv: { freshness: "fresh", analyzedAt: null, minutesAgo: 0, modulesComplete: 0, modulesTotal: 0 },
        rex: { exists: true, percentComplete: 0, stats: null, hasInProgress: false, hasPending: false, nextTaskTitle: null },
        hench: { configured: false, totalRuns: 0, activeRuns: 0, staleRuns: 0 },
      });
    }

    if (url === "/data") return jsonResponse({}, 404);

    if (url.startsWith("/api/token/utilization?")) {
      return jsonResponse({
        configured: { vendor: "openai", model: "gpt-5" },
        source: { rex: "ok", hench: "ok", sourcevision: "ok" },
        period: "day",
        window: { since: null, until: null },
        usage: {
          packages: {
            rex: { inputTokens: 2000, outputTokens: 500, calls: 3 },
            hench: { inputTokens: 1000, outputTokens: 250, calls: 2 },
            sv: { inputTokens: 500, outputTokens: 100, calls: 1 },
          },
          totalInputTokens: 3500,
          totalOutputTokens: 850,
          totalCalls: 6,
        },
        cost: { total: "$0.25", totalRaw: 0.25, inputCost: 0.18, outputCost: 0.07 },
        byVendorModel: [],
        trend: [],
        commands: [],
        budget: { severity: "ok", warnings: [] },
        eventCount: 6,
      });
    }

    return jsonResponse({}, 404);
  }) as unknown as typeof fetch;
}

describe("token usage route regression", { timeout: 120_000 }, () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    ensureBrowserStubs();
    localStorage.removeItem("sidebar-collapsed");
    localStorage.removeItem("sidebar-expanded-section");
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  afterEach(async () => {
    await teardownViewer();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("renders Token Usage from direct canonical /token-usage navigation", async () => {
    await bootViewer("/token-usage", createMockApi());

    await waitFor(() => window.location.pathname === "/token-usage");
    await waitFor(() => document.querySelector(".token-usage-container") !== null);
    await waitFor(() => document.querySelector(".token-header h2")?.textContent === "LLM Utilization");

    expect(document.querySelector(".nav-item.active")?.textContent).toContain("Token Usage");
    expect(window.history.state?.view).toBe("token-usage");
    expect(document.querySelector(".breadcrumb-current")?.textContent).toContain("Token Usage");
    expect(document.querySelector(".breadcrumb-product-rex")).toBeNull();
    expect(document.title).toContain("Token Usage");
    expect(document.title).toContain("Global");
  });

  it("redirects legacy Rex token links to canonical global /token-usage", async () => {
    await bootViewer("/rex-dashboard/token-usage", createMockApi());

    await waitFor(() => window.location.pathname === "/token-usage");
    await waitFor(() => document.querySelector(".token-usage-container") !== null);

    expect(window.location.pathname).toBe("/token-usage");
    expect(window.location.pathname.startsWith("/rex-dashboard/")).toBe(false);
    expect(window.history.state?.view).toBe("token-usage");
    expect(document.querySelector(".nav-item.active")?.textContent).toContain("Token Usage");
  });

  it("renders token usage in non-rex scoped viewers because it is global", async () => {
    await bootViewer("/token-usage", createMockApi({ scope: "sourcevision" }));

    await waitFor(() => window.location.pathname === "/token-usage");
    await waitFor(() => document.querySelector(".token-usage-container") !== null);

    expect(window.history.state?.view).toBe("token-usage");
    expect(document.querySelector(".nav-item.active")?.textContent).toContain("Token Usage");
  });
});
