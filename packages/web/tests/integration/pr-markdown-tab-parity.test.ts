// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface PrStatePayload {
  signature: string;
  availability?: "ready" | "unsupported" | "no-repo" | "error";
  message?: string | null;
  warning?: string | null;
  baseRange?: string | null;
}

interface MockApiOptions {
  scope?: string | null;
  state?: PrStatePayload;
  markdown?: string | null;
}

function createStorageStub(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

function ensureBrowserStubs(): void {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: createStorageStub(),
  });
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: globalThis.localStorage,
  });

  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      configurable: true,
      value: (query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => {},
        removeListener: () => {},
        addEventListener: () => {},
        removeEventListener: () => {},
        dispatchEvent: () => false,
      }),
    });
  }

  if (typeof HTMLElement.prototype.scrollTo !== "function") {
    Object.defineProperty(HTMLElement.prototype, "scrollTo", {
      configurable: true,
      value: () => {},
    });
  }
}

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function wait(ms: number = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(predicate: () => boolean, timeoutMs: number = 8_000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) return;
    if (vi.isFakeTimers()) {
      await vi.advanceTimersByTimeAsync(20);
    } else {
      await wait(20);
    }
  }
  throw new Error(`Timed out after ${timeoutMs}ms`);
}

function findNavItem(label: string): HTMLElement | null {
  const navItems = Array.from(document.querySelectorAll(".nav-item"));
  return (navItems.find((item) => item.textContent?.includes(label)) ?? null) as HTMLElement | null;
}

async function bootViewer(url: string, fetchImpl: typeof fetch): Promise<void> {
  document.body.innerHTML = '<div id="app"></div>';
  window.history.replaceState({}, "", url);
  vi.stubGlobal("fetch", fetchImpl);

  vi.resetModules();
  await import("../../src/viewer/main.js");

  await waitFor(() => document.querySelector(".sidebar") !== null);
}

function createMockApi(options: MockApiOptions = {}): typeof fetch {
  const scope = options.scope ?? "sourcevision";
  const state: PrStatePayload = options.state ?? { signature: "sig-1", availability: "ready" };
  const markdown = options.markdown ?? "## Initial PR markdown";

  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);

    if (url === "/api/config") return jsonResponse({ scope });
    if (url === "/api/features") {
      return jsonResponse({
        toggles: [
          {
            key: "sourcevision.prMarkdown",
            label: "PR Markdown Page",
            description: "Show the SourceVision PR Markdown page in navigation.",
            impact: "",
            package: "sourcevision",
            stability: "experimental",
            defaultValue: false,
            enabled: true,
          },
        ],
      });
    }
    if (url === "/api/project") return jsonResponse({ name: "n-dx", description: null, version: null, git: null, nameSource: "directory" });
    if (url === "/api/status") {
      return jsonResponse({
        sv: { freshness: "fresh", analyzedAt: null, minutesAgo: 0, modulesComplete: 0, modulesTotal: 0 },
        rex: { exists: false, percentComplete: 0, stats: null, hasInProgress: false, hasPending: false, nextTaskTitle: null },
        hench: { configured: false, totalRuns: 0, activeRuns: 0, staleRuns: 0 },
      });
    }

    if (url === "/data") return jsonResponse({}, 404);
    if (url === "/api/sv/pr-markdown/state") return jsonResponse(state);
    if (url === "/api/sv/pr-markdown") return jsonResponse({ markdown });

    return jsonResponse({}, 404);
  }) as unknown as typeof fetch;
}

describe("PR Markdown tab parity integration", { timeout: 120_000 }, () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    ensureBrowserStubs();
    localStorage.removeItem("sidebar-collapsed");
    localStorage.removeItem("sidebar-expanded-section");
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows PR Markdown as a SourceVision tab and selects it like existing tabs", async () => {
    await bootViewer("/overview", createMockApi());

    await waitFor(() => findNavItem("PR Markdown") !== null);
    const mapItem = findNavItem("Map");
    const prMarkdownItem = findNavItem("PR Markdown");
    expect(mapItem).not.toBeNull();
    expect(prMarkdownItem).not.toBeNull();

    mapItem?.click();
    await waitFor(() => window.location.pathname === "/graph");
    await waitFor(() => document.querySelector(".nav-item.active")?.textContent?.includes("Map") ?? false);

    prMarkdownItem?.click();
    await waitFor(() => window.location.pathname === "/pr-markdown");
    await waitFor(() => document.querySelector(".section-header")?.textContent === "PR Markdown");
    expect(document.querySelector(".nav-item.active")?.textContent).toContain("PR Markdown");
  });

  it("selects PR Markdown view from direct hash navigation", async () => {
    await bootViewer("/overview#pr-markdown", createMockApi());

    await waitFor(() => window.location.pathname === "/pr-markdown");
    await waitFor(() => document.querySelector(".section-header")?.textContent === "PR Markdown");
    expect(document.querySelector(".nav-item.active")?.textContent).toContain("PR Markdown");
  });

  it("renders unavailable diagnostics for no-repo, unresolved base branch, and endpoint failures", async () => {
    await bootViewer("/pr-markdown", createMockApi({
      state: {
        signature: "no-repo",
        availability: "no-repo",
        message: "This directory is not a git repository. Open a repository to generate PR markdown.",
      },
      markdown: null,
    }));
    await waitFor(() => document.body.textContent?.includes("No git repository detected") ?? false);
    expect(document.body.textContent).toContain("Open a repository");

    await bootViewer("/pr-markdown", createMockApi({
      state: {
        signature: "degraded",
        availability: "ready",
        warning: "Could not resolve base branch (`main` or `origin/main`). PR markdown generation is limited.",
        message: "Repository metadata is available, but PR markdown needs a resolvable base branch.",
        baseRange: null,
      },
      markdown: null,
    }));
    await waitFor(() => document.body.textContent?.includes("Partial git metadata only") ?? false);
    expect(document.body.textContent).toContain("Base range: unresolved");

    const failingFetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/config") return jsonResponse({ scope: "sourcevision" });
      if (url === "/api/features") return jsonResponse({ toggles: [] });
      if (url === "/api/project") return jsonResponse({ name: "n-dx", description: null, version: null, git: null, nameSource: "directory" });
      if (url === "/api/status") {
        return jsonResponse({
          sv: { freshness: "fresh", analyzedAt: null, minutesAgo: 0, modulesComplete: 0, modulesTotal: 0 },
          rex: { exists: false, percentComplete: 0, stats: null, hasInProgress: false, hasPending: false, nextTaskTitle: null },
          hench: { configured: false, totalRuns: 0, activeRuns: 0, staleRuns: 0 },
        });
      }
      if (url === "/data") return jsonResponse({}, 404);
      if (url === "/api/sv/pr-markdown/state") throw new Error("connect ECONNREFUSED 127.0.0.1:3000");
      return jsonResponse({}, 404);
    }) as unknown as typeof fetch;

    await bootViewer("/pr-markdown", failingFetch);
    await waitFor(() => document.body.textContent?.includes("Unable to load PR markdown") ?? false);
  });

  it("does not render a manual refresh button", async () => {
    await bootViewer("/pr-markdown", createMockApi());
    await waitFor(() => document.body.textContent?.includes("PR markdown ready") ?? false);

    expect(document.body.querySelector(".pr-markdown-refresh-btn")).toBeNull();
    expect(document.body.textContent).toContain("sourcevision analyze");
  });
});
