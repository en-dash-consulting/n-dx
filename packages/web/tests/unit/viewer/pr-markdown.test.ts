// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { PRMarkdownView } from "../../../src/viewer/views/pr-markdown.js";

type PRAvailability = "ready" | "unsupported" | "no-repo" | "error";

interface StatePayload {
  signature: string;
  availability?: PRAvailability;
  message?: string | null;
  warning?: string | null;
  baseRange?: string | null;
  cacheStatus?: "missing" | "fresh" | "stale";
  generatedAt?: string | null;
  staleAfterMs?: number;
}

async function renderAndWait(root: HTMLDivElement) {
  await act(async () => {
    render(h(PRMarkdownView, null), root);
  });
  await new Promise<void>((r) => setTimeout(r, 0));
  await new Promise<void>((r) => queueMicrotask(r));
  await act(async () => {});
}

async function flushUi() {
  await act(async () => {
    await Promise.resolve();
  });
  await act(async () => {
    await Promise.resolve();
  });
}

function createFetchMock(state: StatePayload, markdown: string | null = null) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    if (url === "/api/sv/pr-markdown/state") {
      return {
        ok: true,
        json: async () => state,
      };
    }
    if (url === "/api/sv/pr-markdown") {
      return {
        ok: true,
        json: async () => ({ markdown }),
      };
    }
    if (url === "/api/sv/pr-markdown/refresh" && method === "POST") {
      return {
        ok: true,
        json: async () => ({ ...state, markdown, ok: true }),
      };
    }
    return {
      ok: false,
      status: 404,
      json: async () => ({}),
    };
  });
}

describe("PRMarkdownView", () => {
  let root: HTMLDivElement;
  let clipboardWriteText: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    window.sessionStorage.clear();
    clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText: clipboardWriteText },
    });
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("shows empty state when API returns null markdown", async () => {
    const fetchMock = createFetchMock({ signature: "sig-1", availability: "ready" }, null);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await renderAndWait(root);

    expect(root.textContent).toContain("PR markdown has not been generated yet");
    expect(root.textContent).toContain("Click Refresh to generate and cache PR markdown.");
    expect(root.textContent).toContain("Refresh");
  });

  it("shows stale state guidance when cached markdown exceeds threshold", async () => {
    const fetchMock = createFetchMock({
      signature: "sig-stale",
      availability: "ready",
      cacheStatus: "stale",
      generatedAt: "2026-02-20T00:00:00.000Z",
      staleAfterMs: 30 * 60 * 1000,
    }, "## Snapshot");
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await renderAndWait(root);

    expect(root.textContent).toContain("Cached PR markdown is stale");
    expect(root.textContent).toContain("Use Refresh to regenerate");
  });

  it("shows unsupported-state messaging when git is unavailable", async () => {
    const fetchMock = createFetchMock({
      signature: "unsupported",
      availability: "unsupported",
      message: "Git is not available on PATH. Install git and restart SourceVision.",
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await renderAndWait(root);

    expect(root.textContent).toContain("Git is unavailable");
    expect(root.textContent).toContain("Git is not available on PATH");
  });

  it("shows no-repo messaging outside repositories", async () => {
    const fetchMock = createFetchMock({
      signature: "no-repo",
      availability: "no-repo",
      message: "This directory is not a git repository. Open a repository to generate PR markdown.",
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await renderAndWait(root);

    expect(root.textContent).toContain("No git repository detected");
    expect(root.textContent).toContain("Open a repository");
  });

  it("shows degraded warning with partial metadata when base branch is unresolved", async () => {
    const fetchMock = createFetchMock({
      signature: "abc123def4567890",
      availability: "ready",
      warning: "Could not resolve base branch (`main` or `origin/main`). PR markdown generation is limited.",
      message: "Repository metadata is available, but PR markdown needs a resolvable base branch.",
      baseRange: null,
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await renderAndWait(root);

    expect(root.textContent).toContain("Partial git metadata only");
    expect(root.textContent).toContain("Could not resolve base branch");
    expect(root.textContent).toContain("Base range: unresolved");
  });

  it("switches between preview and raw markdown with explicit toggle controls", async () => {
    const fetchMock = createFetchMock(
      { signature: "sig-ready", availability: "ready" },
      "## Summary\n\n- Added tab\n\n```ts\nconsole.log('ok');\n```",
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await renderAndWait(root);

    expect(root.textContent).toContain("PR markdown ready");
    const previewToggle = root.querySelector('button[aria-controls="pr-markdown-panel-preview"]') as HTMLButtonElement | null;
    const rawToggle = root.querySelector('button[aria-controls="pr-markdown-panel-raw"]') as HTMLButtonElement | null;
    expect(previewToggle).toBeTruthy();
    expect(rawToggle).toBeTruthy();
    expect(previewToggle?.getAttribute("aria-pressed")).toBe("true");
    expect(rawToggle?.getAttribute("aria-pressed")).toBe("false");
    expect(root.querySelector(".pr-markdown-preview h2")?.textContent).toBe("Summary");
    expect(root.querySelector(".pr-markdown-preview ul li")?.textContent).toBe("Added tab");
    expect(root.querySelector(".pr-markdown-preview code")?.textContent).toContain("console.log('ok');");

    await act(async () => {
      rawToggle?.click();
    });
    await flushUi();

    expect(previewToggle?.getAttribute("aria-pressed")).toBe("false");
    expect(rawToggle?.getAttribute("aria-pressed")).toBe("true");
    expect(root.querySelector(".pr-markdown-preview")).toBeNull();
    expect(root.querySelector(".pr-markdown-raw")?.textContent).toContain("## Summary");
    expect(root.querySelector(".pr-markdown-raw")?.textContent).toContain("```ts");
  });

  it("persists selected mode across remounts in the same session", async () => {
    const markdown = "## Snapshot\n\n- Persist mode";
    const fetchMock = createFetchMock({ signature: "sig-mode", availability: "ready" }, markdown);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await renderAndWait(root);
    const rawToggle = root.querySelector('button[aria-controls="pr-markdown-panel-raw"]') as HTMLButtonElement;

    await act(async () => {
      rawToggle.click();
    });
    await flushUi();

    expect(root.querySelector(".pr-markdown-raw")?.textContent).toContain("## Snapshot");
    expect(window.sessionStorage.getItem("sv:pr-markdown:view-mode")).toBe("raw");

    await act(async () => {
      render(null, root);
      render(h(PRMarkdownView, null), root);
    });
    await flushUi();

    expect(root.querySelector('button[aria-controls="pr-markdown-panel-preview"]')?.getAttribute("aria-pressed")).toBe("false");
    expect(root.querySelector('button[aria-controls="pr-markdown-panel-raw"]')?.getAttribute("aria-pressed")).toBe("true");
    expect(root.querySelector(".pr-markdown-raw")?.textContent).toContain("## Snapshot");
  });

  it("exposes keyboard-focusable toggle controls with ARIA pressed states", async () => {
    const fetchMock = createFetchMock({ signature: "sig-a11y", availability: "ready" }, "## Accessibility");
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await renderAndWait(root);
    const previewToggle = root.querySelector('button[aria-controls="pr-markdown-panel-preview"]') as HTMLButtonElement;
    const rawToggle = root.querySelector('button[aria-controls="pr-markdown-panel-raw"]') as HTMLButtonElement;

    rawToggle.focus();
    expect(document.activeElement).toBe(rawToggle);
    expect(previewToggle.getAttribute("aria-pressed")).toBe("true");
    expect(rawToggle.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      rawToggle.click();
    });
    await flushUi();

    expect(previewToggle.getAttribute("aria-pressed")).toBe("false");
    expect(rawToggle.getAttribute("aria-pressed")).toBe("true");
  });

  it("shows error state when request fails", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error("network down"));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await renderAndWait(root);

    expect(root.textContent).toContain("Unable to load PR markdown");
    expect(root.textContent).toContain("network down");
  });

  it("shows refresh error and keeps last successful output visible", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/sv/pr-markdown/state") {
        return {
          ok: true,
          json: async () => ({ signature: "sig-ready", availability: "ready", cacheStatus: "fresh" }),
        };
      }
      if (url === "/api/sv/pr-markdown") {
        return {
          ok: true,
          json: async () => ({ markdown: "## Working snapshot" }),
        };
      }
      if (url === "/api/sv/pr-markdown/refresh" && method === "POST") {
        throw new Error("refresh command failed");
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
      };
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await renderAndWait(root);
    expect(root.textContent).toContain("Working snapshot");

    await act(async () => {
      (root.querySelector(".pr-markdown-refresh-btn") as HTMLButtonElement).click();
    });
    await flushUi();

    expect(root.textContent).toContain("Refresh failed");
    expect(root.textContent).toContain("refresh command failed");
    expect(root.textContent).toContain("Last successful PR markdown is still shown below.");
    expect(root.textContent).toContain("Working snapshot");
  });

  it("shows degraded diagnostics without generic refresh failure copy", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/sv/pr-markdown/state") {
        return {
          ok: true,
          json: async () => ({ signature: "sig-ready", availability: "ready", cacheStatus: "fresh" }),
        };
      }
      if (url === "/api/sv/pr-markdown") {
        return {
          ok: true,
          json: async () => ({ markdown: "## Cached summary\n\n- Keep this" }),
        };
      }
      if (url === "/api/sv/pr-markdown/refresh" && method === "POST") {
        return {
          ok: true,
          json: async () => ({
            ok: false,
            status: "degraded",
            signature: "sig-degraded",
            availability: "ready",
            cacheStatus: "fresh",
            markdown: "## Cached summary\n\n- Keep this",
            diagnostics: [{
              code: "fetch_failed",
              message: "Failure for fetch_failed",
              hints: ["Run `git fetch origin main` manually and verify remote connectivity."],
              guidance: {
                category: "fetch_retry",
                summary: "Remote fetch failed. Resolve connectivity/credentials, then retry refresh.",
                commands: ["git fetch origin main", "sourcevision pr-markdown <project-dir>"],
              },
            }],
          }),
        };
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
      };
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await renderAndWait(root);
    expect(root.textContent).toContain("Cached summary");

    await act(async () => {
      (root.querySelector(".pr-markdown-refresh-btn") as HTMLButtonElement).click();
    });
    await flushUi();

    expect(root.textContent).toContain("Refresh diagnostics");
    expect(root.textContent).toContain("Fetching base branch failed");
    expect(root.textContent).toContain("Failure for fetch_failed");
    expect(root.textContent).toContain("Retry guidance: remote fetch");
    expect(root.textContent).toContain("git fetch origin main");
    expect(root.textContent).not.toContain("Refresh failed");
    expect(root.textContent).toContain("Cached summary");
  });

  it("renders remediation hints in server order when diagnostics are hint-only", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/sv/pr-markdown/state") {
        return {
          ok: true,
          json: async () => ({ signature: "sig-ready", availability: "ready", cacheStatus: "fresh" }),
        };
      }
      if (url === "/api/sv/pr-markdown") {
        return {
          ok: true,
          json: async () => ({ markdown: "## Cached summary\n\n- Keep this" }),
        };
      }
      if (url === "/api/sv/pr-markdown/refresh" && method === "POST") {
        return {
          ok: true,
          json: async () => ({
            ok: false,
            status: "degraded",
            signature: "sig-degraded",
            availability: "ready",
            cacheStatus: "fresh",
            markdown: "## Cached summary\n\n- Keep this",
            diagnostics: [{
              hints: ["First remediation step", "Second remediation step", "Third remediation step"],
            }],
          }),
        };
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
      };
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await renderAndWait(root);

    await act(async () => {
      (root.querySelector(".pr-markdown-refresh-btn") as HTMLButtonElement).click();
    });
    await flushUi();

    const hintItems = Array.from(root.querySelectorAll(".pr-markdown-diagnostic-hints li"))
      .map((node) => node.textContent);
    expect(hintItems).toEqual(["First remediation step", "Second remediation step", "Third remediation step"]);
  });

  it("hides remediation hints list when degraded diagnostics include no hints", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/sv/pr-markdown/state") {
        return {
          ok: true,
          json: async () => ({ signature: "sig-ready", availability: "ready", cacheStatus: "fresh" }),
        };
      }
      if (url === "/api/sv/pr-markdown") {
        return {
          ok: true,
          json: async () => ({ markdown: "## Cached summary\n\n- Keep this" }),
        };
      }
      if (url === "/api/sv/pr-markdown/refresh" && method === "POST") {
        return {
          ok: true,
          json: async () => ({
            ok: false,
            status: "degraded",
            signature: "sig-degraded",
            availability: "ready",
            cacheStatus: "fresh",
            markdown: "## Cached summary\n\n- Keep this",
            diagnostics: [{
              code: "fetch_failed",
              message: "Failure for fetch_failed",
            }],
          }),
        };
      }
      return {
        ok: false,
        status: 404,
        json: async () => ({}),
      };
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await renderAndWait(root);

    await act(async () => {
      (root.querySelector(".pr-markdown-refresh-btn") as HTMLButtonElement).click();
    });
    await flushUi();

    expect(root.querySelector(".pr-markdown-diagnostic-hints")).toBeNull();
  });

  it("refreshes markdown only when refresh action is invoked", async () => {
    let stateSignature = "sig-1";
    let markdown = "## First";
    const generatedAt = "2026-02-21T13:04:05.000Z";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/sv/pr-markdown/state") {
        return {
          ok: true,
          json: async () => ({
            signature: stateSignature,
            availability: "ready",
            generatedAt,
            cacheStatus: "fresh",
          }),
        };
      }
      if (url === "/api/sv/pr-markdown/refresh" && method === "POST") {
        return {
          ok: true,
          json: async () => ({
            signature: stateSignature,
            availability: "ready",
            generatedAt,
            cacheStatus: "fresh",
            markdown,
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({ markdown }),
      };
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await renderAndWait(root);

    const markdownCallsAfterInitial = fetchMock.mock.calls
      .filter(([url]) => String(url) === "/api/sv/pr-markdown").length;
    expect(markdownCallsAfterInitial).toBe(1);
    expect(root.textContent).toContain("First");

    stateSignature = "sig-2";
    markdown = "## Second";
    await flushUi();

    const markdownCallsBeforeManualRefresh = fetchMock.mock.calls
      .filter(([url]) => String(url) === "/api/sv/pr-markdown").length;
    expect(markdownCallsBeforeManualRefresh).toBe(1);
    const refreshCallsBeforeManualRefresh = fetchMock.mock.calls
      .filter(([url, init]) => String(url) === "/api/sv/pr-markdown/refresh" && (init as RequestInit | undefined)?.method === "POST").length;
    expect(refreshCallsBeforeManualRefresh).toBe(0);
    expect(root.textContent).not.toContain("Second");

    await act(async () => {
      (root.querySelector(".pr-markdown-refresh-btn") as HTMLButtonElement).click();
    });
    await flushUi();

    const refreshCalls = fetchMock.mock.calls
      .filter(([url, init]) => String(url) === "/api/sv/pr-markdown/refresh" && (init as RequestInit | undefined)?.method === "POST").length;
    expect(refreshCalls).toBe(1);

    const markdownCallsAfterManualRefresh = fetchMock.mock.calls
      .filter(([url]) => String(url) === "/api/sv/pr-markdown").length;
    expect(markdownCallsAfterManualRefresh).toBe(1);
    expect(root.textContent).toContain("Second");
    expect(root.textContent).toContain("Last refreshed: Feb 21, 2026, 13:04:05 UTC");
  });

  it("keeps last refreshed timestamp text stable across remounts", async () => {
    const generatedAt = "2026-02-21T13:04:05.000Z";
    const fetchMock = createFetchMock({
      signature: "sig-stable",
      availability: "ready",
      cacheStatus: "fresh",
      generatedAt,
    }, "## Snapshot");
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await renderAndWait(root);
    const firstText = root.querySelector(".pr-markdown-refreshed-at")?.textContent;
    expect(firstText).toBe("Last refreshed: Feb 21, 2026, 13:04:05 UTC");

    await act(async () => {
      render(null, root);
      render(h(PRMarkdownView, null), root);
    });
    await flushUi();

    const secondText = root.querySelector(".pr-markdown-refreshed-at")?.textContent;
    expect(secondText).toBe(firstText);
  });

  it("disables refresh button and prevents duplicate clicks while refresh is running", async () => {
    let resolveRefresh: (() => void) | null = null;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url === "/api/sv/pr-markdown/state") {
        return {
          ok: true,
          json: async () => ({ signature: "sig-1", availability: "ready", cacheStatus: "fresh" }),
        };
      }
      if (url === "/api/sv/pr-markdown") {
        return {
          ok: true,
          json: async () => ({ markdown: "## Initial" }),
        };
      }
      if (url === "/api/sv/pr-markdown/refresh" && method === "POST") {
        await new Promise<void>((resolve) => { resolveRefresh = resolve; });
        return {
          ok: true,
          json: async () => ({
            signature: "sig-2",
            availability: "ready",
            cacheStatus: "fresh",
            generatedAt: "2026-02-21T01:00:00.000Z",
            markdown: "## Updated",
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await renderAndWait(root);
    const refreshButton = root.querySelector(".pr-markdown-refresh-btn") as HTMLButtonElement;
    expect(refreshButton.disabled).toBe(false);

    await act(async () => {
      refreshButton.click();
    });
    expect(refreshButton.disabled).toBe(true);
    expect(refreshButton.textContent).toBe("Refreshing...");

    await act(async () => {
      refreshButton.click();
    });

    const refreshCallsWhilePending = fetchMock.mock.calls
      .filter(([url, reqInit]) => String(url) === "/api/sv/pr-markdown/refresh" && (reqInit as RequestInit | undefined)?.method === "POST").length;
    expect(refreshCallsWhilePending).toBe(1);

    resolveRefresh?.();
    await flushUi();

    expect(refreshButton.disabled).toBe(false);
    expect(root.textContent).toContain("Updated");
  });

  it("does not fetch markdown while availability is unavailable", async () => {
    vi.useFakeTimers();
    const fetchMock = createFetchMock({
      signature: "unsupported",
      availability: "unsupported",
      message: "Git is not available on PATH. Install git and restart SourceVision.",
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await act(async () => {
      render(h(PRMarkdownView, null), root);
    });
    await act(async () => {
      await Promise.resolve();
    });
    await vi.advanceTimersByTimeAsync(3000);

    const markdownCalls = fetchMock.mock.calls
      .filter(([url]) => String(url) === "/api/sv/pr-markdown").length;
    expect(markdownCalls).toBe(0);
    expect(root.textContent).toContain("Git is unavailable");
  });

  it("copies full raw markdown payload exactly and renders feedback region", async () => {
    const markdown = [
      "",
      "## Overview",
      "",
      "1. Step one",
      "2. Step two",
      "",
      "```ts",
      "const value = 42;",
      "```",
      "",
    ].join("\n");
    const fetchMock = createFetchMock({ signature: "sig-copy", availability: "ready" }, markdown);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await renderAndWait(root);
    await act(async () => {
      (root.querySelector('button[aria-controls="pr-markdown-panel-raw"]') as HTMLButtonElement).click();
    });
    await flushUi();
    await act(async () => {
      (root.querySelector(".pr-markdown-copy-btn") as HTMLButtonElement).click();
    });
    await flushUi();

    expect(root.querySelector(".pr-markdown-raw")?.textContent).toBe(markdown);
    expect(clipboardWriteText).toHaveBeenCalledWith(markdown);
    expect(root.querySelector(".pr-markdown-copy-feedback")?.textContent).toContain("Copied markdown to clipboard.");
  });

  it("shows manual guidance when clipboard permission is denied", async () => {
    const deniedError = new Error("Permission denied");
    deniedError.name = "NotAllowedError";
    clipboardWriteText.mockRejectedValueOnce(deniedError);
    const fetchMock = createFetchMock({ signature: "sig-fail-copy", availability: "ready" }, "## Overview");
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await renderAndWait(root);
    await act(async () => {
      (root.querySelector('button[aria-controls="pr-markdown-panel-raw"]') as HTMLButtonElement).click();
    });
    await flushUi();
    await act(async () => {
      (root.querySelector(".pr-markdown-copy-btn") as HTMLButtonElement).click();
    });
    await flushUi();

    expect(clipboardWriteText).toHaveBeenCalledWith("## Overview");
    expect(root.querySelector(".pr-markdown-copy-feedback")?.textContent)
      .toContain("Clipboard access was blocked by browser permissions.");
    expect(root.querySelector(".pr-markdown-copy-feedback")?.textContent)
      .toContain("Copy manually: select the markdown and press Cmd+C (macOS) or Ctrl+C (Windows/Linux).");
  });
});
