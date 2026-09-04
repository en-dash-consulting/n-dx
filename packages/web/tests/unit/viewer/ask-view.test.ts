// @vitest-environment jsdom
/**
 * SourceVision Ask panel shell.
 *
 * Covers what a typecheck cannot see: the four display states and the
 * transitions between them, the empty-prompt no-op, the feature gate hiding
 * the tab, and the deep-link path from a URL segment to a rendered panel.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { AskView, ASK_ENDPOINT, isSubmittablePrompt } from "../../../src/viewer/views/ask.js";
import { Sidebar } from "../../../src/viewer/components/sidebar.js";
import { SOURCEVISION_TABS } from "../../../src/viewer/views/index.js";
import { renderActiveView, type ViewRenderContext } from "../../../src/viewer/views/view-registry.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";
import { buildValidViews } from "../../../src/shared/index.js";
import { resolveLocationRoute } from "../../../src/viewer/route-state.js";
import type { LoadedData, ViewId } from "../../../src/viewer/types.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Let the mounted effects and the fetch promise chain settle. */
async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await new Promise<void>((r) => setTimeout(r, 0));
    await new Promise<void>((r) => setTimeout(r, 0));
  });
}

describe("AskView", () => {
  let root: HTMLDivElement;
  /** Response served to the next POST /api/sourcevision/ask. */
  let askResponse: () => Promise<Response>;
  let fetchSpy: ReturnType<typeof vi.fn>;

  function mount() {
    root = document.createElement("div");
    document.body.appendChild(root);
    render(h(AskView, null), root);
    return root;
  }

  function textarea(): HTMLTextAreaElement {
    const el = root.querySelector<HTMLTextAreaElement>("textarea.sv-ask-textarea");
    if (!el) throw new Error("prompt textarea not rendered");
    return el;
  }

  function submitButton(): HTMLButtonElement {
    const el = root.querySelector<HTMLButtonElement>("button.sv-ask-submit");
    if (!el) throw new Error("submit control not rendered");
    return el;
  }

  /** Type into the prompt the way a user does — value plus an input event. */
  async function type(value: string): Promise<void> {
    const el = textarea();
    await act(async () => {
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  /**
   * Submit through the form rather than by clicking the button.
   *
   * The button is disabled for an unsubmittable prompt, so clicking it would
   * prove nothing about the guard inside the handler — which is the path an
   * Enter keypress or a programmatic submit takes.
   */
  async function submitForm(): Promise<void> {
    const form = root.querySelector<HTMLFormElement>("form.sv-ask-form");
    if (!form) throw new Error("form not rendered");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
  }

  beforeEach(() => {
    clearProjectMetadataCache();
    delete window.__NDX_DEPLOYED__;
    askResponse = async () => jsonResponse({ answer: "unset", vendor: "claude", model: "test-model" });
    fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === ASK_ENDPOINT) return askResponse();
      if (url === "/api/project") {
        return jsonResponse({ name: "n-dx", description: null, version: null, git: null, nameSource: "directory", cliName: "n-dx" });
      }
      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    if (root) render(null, root);
    if (root?.parentNode) root.parentNode.removeChild(root);
    document.body.innerHTML = "";
    // Vitest shares one worker process across test files, so a deployed-mode
    // flag left on `window` would silently hide every `requiresServer` tab in
    // whatever ran next — which is how the gate-on case below first failed.
    delete window.__NDX_DEPLOYED__;
    vi.unstubAllGlobals();
  });

  // ── State transitions ────────────────────────────────────────────

  it("starts idle: a prompt field, a disabled submit, and no request", () => {
    mount();

    expect(root.querySelector(".sv-ask-idle")).not.toBeNull();
    expect(root.querySelector(".sv-ask-answer")).toBeNull();
    expect(root.querySelector(".sv-ask-error")).toBeNull();
    expect(submitButton().disabled).toBe(true);
    expect(fetchSpy.mock.calls.filter(([u]) => String(u) === ASK_ENDPOINT)).toHaveLength(0);
  });

  it("labels the prompt textarea", () => {
    mount();
    const label = root.querySelector<HTMLLabelElement>("label.sv-ask-label");
    expect(label?.textContent).toBe("Your question");
    // The label points at the field it names, so clicking it focuses the field.
    expect(label?.getAttribute("for")).toBe(textarea().id);
    expect(textarea().id).toBeTruthy();
  });

  it("moves idle -> submitting -> answered and shows the answer", async () => {
    mount();
    await settle();

    // Hold the response open so the submitting state is observable.
    let release: (r: Response) => void = () => {};
    askResponse = () => new Promise<Response>((resolve) => { release = resolve; });

    await type("Which zones are most coupled?");
    expect(submitButton().disabled).toBe(false);

    const form = root.querySelector<HTMLFormElement>("form.sv-ask-form")!;
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    // submitting
    expect(root.querySelector(".sv-ask-status")).not.toBeNull();
    expect(root.querySelector(".sv-ask-idle")).toBeNull();
    expect(submitButton().disabled).toBe(true);
    expect(submitButton().textContent).toBe("Asking...");
    expect(textarea().disabled).toBe(true);

    await act(async () => {
      release(jsonResponse({
        answer: "web-viewer is the hub zone.",
        vendor: "claude",
        model: "claude-opus-5",
        contextSources: ["zones.json"],
      }));
      await settle();
    });

    // answered
    const answer = root.querySelector(".sv-ask-answer");
    expect(answer).not.toBeNull();
    expect(root.querySelector(".sv-ask-answer-body")?.textContent).toBe("web-viewer is the hub zone.");
    expect(root.querySelector(".sv-ask-status")).toBeNull();
    expect(root.querySelector(".sv-ask-error")).toBeNull();
    expect(root.querySelector(".sv-ask-question")?.textContent).toBe("Which zones are most coupled?");
    expect(root.querySelector(".sv-ask-answer-meta")?.textContent).toContain("claude-opus-5");
    expect(root.querySelector(".sv-ask-answer-meta")?.textContent).toContain("zones.json");
  });

  it("moves idle -> submitting -> error and reports the endpoint's wording", async () => {
    mount();
    await settle();

    askResponse = async () => jsonResponse({
      error: "No analysis data to answer from.",
      kind: "no_analysis",
      suggestion: "Run 'n-dx analyze .' first, then ask again.",
    }, 404);

    await type("What does this project do?");
    await submitForm();

    const error = root.querySelector(".sv-ask-error");
    expect(error).not.toBeNull();
    expect(root.querySelector(".sv-ask-error-message")?.textContent).toBe("No analysis data to answer from.");
    expect(error?.textContent).toContain("Run 'n-dx analyze .' first");
    expect(error?.getAttribute("role")).toBe("alert");
    expect(root.querySelector(".sv-ask-answer")).toBeNull();
    expect(root.querySelector(".sv-ask-status")).toBeNull();
    // The panel is usable again rather than stuck in the failed submit.
    expect(submitButton().disabled).toBe(false);
    expect(textarea().disabled).toBe(false);
  });

  it("reports a transport failure as an error rather than throwing", async () => {
    mount();
    await settle();

    askResponse = async () => { throw new Error("connect ECONNREFUSED 127.0.0.1:3117"); };

    await type("Anything?");
    await submitForm();

    expect(root.querySelector(".sv-ask-error-message")?.textContent).toContain("ECONNREFUSED");
  });

  it("treats a 200 with an empty answer as an error, not a blank answer", async () => {
    mount();
    await settle();

    askResponse = async () => jsonResponse({ answer: "   ", vendor: "claude", model: "m" });

    await type("Anything?");
    await submitForm();

    expect(root.querySelector(".sv-ask-error")).not.toBeNull();
    expect(root.querySelector(".sv-ask-answer")).toBeNull();
  });

  it("keeps a non-JSON failure body from producing an empty error card", async () => {
    mount();
    await settle();

    askResponse = async () => new Response("<html>502 Bad Gateway</html>", {
      status: 502,
      headers: { "Content-Type": "text/html" },
    });

    await type("Anything?");
    await submitForm();

    expect(root.querySelector(".sv-ask-error-message")?.textContent).toContain("502");
  });

  it("replaces a previous answer when a new question is asked", async () => {
    mount();
    await settle();

    askResponse = async () => jsonResponse({ answer: "First answer.", vendor: "claude", model: "m" });
    await type("First question?");
    await submitForm();
    expect(root.querySelector(".sv-ask-answer-body")?.textContent).toBe("First answer.");

    askResponse = async () => jsonResponse({ answer: "Second answer.", vendor: "claude", model: "m" });
    await type("Second question?");
    await submitForm();
    expect(root.querySelector(".sv-ask-answer-body")?.textContent).toBe("Second answer.");
  });

  // ── The empty-prompt no-op ───────────────────────────────────────

  it("issues no request for an empty or whitespace-only prompt", async () => {
    mount();
    await settle();

    const askCalls = () => fetchSpy.mock.calls.filter(([u]) => String(u) === ASK_ENDPOINT).length;

    // Never typed at all.
    await submitForm();
    expect(askCalls()).toBe(0);
    expect(root.querySelector(".sv-ask-idle")).not.toBeNull();

    // Whitespace only — the submit control refuses, and so does the handler
    // the Enter key reaches.
    for (const blank of ["   ", "\n\n", "\t "]) {
      await type(blank);
      expect(submitButton().disabled).toBe(true);
      await submitForm();
      expect(askCalls()).toBe(0);
      expect(root.querySelector(".sv-ask-status")).toBeNull();
      expect(root.querySelector(".sv-ask-idle")).not.toBeNull();
    }

    // A real question still goes through, so the guard is not simply broken.
    askResponse = async () => jsonResponse({ answer: "Yes.", vendor: "claude", model: "m" });
    await type("A real question?");
    await submitForm();
    expect(askCalls()).toBe(1);
  });

  it("sends the trimmed prompt as the request body", async () => {
    mount();
    await settle();

    askResponse = async () => jsonResponse({ answer: "Yes.", vendor: "claude", model: "m" });
    await type("  Which files are hubs?  ");
    await submitForm();

    const call = fetchSpy.mock.calls.find(([u]) => String(u) === ASK_ENDPOINT)!;
    const init = call[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ prompt: "Which files are hubs?" });
  });

  it("does not issue a second request while one is in flight", async () => {
    mount();
    await settle();

    let release: (r: Response) => void = () => {};
    askResponse = () => new Promise<Response>((resolve) => { release = resolve; });

    await type("Which zones are most coupled?");
    await act(async () => {
      const form = root.querySelector<HTMLFormElement>("form.sv-ask-form")!;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(fetchSpy.mock.calls.filter(([u]) => String(u) === ASK_ENDPOINT)).toHaveLength(1);

    await act(async () => {
      release(jsonResponse({ answer: "Once.", vendor: "claude", model: "m" }));
      await settle();
    });
  });

  it("rejects a prompt over the endpoint's character limit before sending", () => {
    expect(isSubmittablePrompt("")).toBe(false);
    expect(isSubmittablePrompt("   \n\t ")).toBe(false);
    expect(isSubmittablePrompt("ok")).toBe(true);
    expect(isSubmittablePrompt("x".repeat(4_000))).toBe(true);
    expect(isSubmittablePrompt("x".repeat(4_001))).toBe(false);
  });

  // ── Deployed mode ────────────────────────────────────────────────

  it("explains itself instead of offering a prompt in a static export", async () => {
    window.__NDX_DEPLOYED__ = { basePath: "/", exportedAt: "2026-01-01T00:00:00.000Z" };
    mount();
    await settle();

    expect(root.querySelector(".sv-ask-unavailable")).not.toBeNull();
    expect(root.querySelector("textarea.sv-ask-textarea")).toBeNull();
    expect(root.textContent).toContain("Not available in the exported dashboard");
    expect(fetchSpy.mock.calls.filter(([u]) => String(u) === ASK_ENDPOINT)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Registration and gating
// ---------------------------------------------------------------------------

describe("Ask view registration", () => {
  it("is a deep-linkable sourcevision view", () => {
    const valid = buildValidViews(null);
    expect(valid.has("ask" as ViewId)).toBe(true);
    expect(buildValidViews("sourcevision").has("ask" as ViewId)).toBe(true);
    // Not a rex view — a rex-scoped viewer must not resolve it.
    expect(buildValidViews("rex").has("ask" as ViewId)).toBe(false);
  });

  it("restores from a direct /ask URL", () => {
    const valid = buildValidViews("sourcevision");
    expect(resolveLocationRoute("/ask", "", valid)).toEqual({ view: "ask", subId: null });
    // And from the legacy hash form the older links use.
    expect(resolveLocationRoute("/overview", "#ask", valid)).toEqual({ view: "ask", subId: null });
  });

  it("renders through the view registry", () => {
    const ctx = {
      data: {} as LoadedData,
      setDetail: () => {},
      setPrdDetailContent: () => {},
      selectedFile: null,
      setSelectedFile: () => {},
      selectedZone: null,
      selectedRunId: null,
      selectedTaskId: null,
      navigateTo: () => {},
      isFeatureDisabled: () => false,
    } as unknown as ViewRenderContext;

    expect(renderActiveView("ask", ctx)).not.toBeNull();
  });

  it("appears in the tab registry after PR Markdown", () => {
    const ids = SOURCEVISION_TABS.map((t) => t.id);
    expect(ids.indexOf("ask")).toBe(ids.indexOf("pr-markdown") + 1);
  });
});

describe("Ask tab feature gate", () => {
  let root: HTMLDivElement;

  /** Boot the sidebar with `sourcevision.ask` reported at `enabled`. */
  async function renderSidebarWithGate(enabled: boolean): Promise<HTMLDivElement> {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/features") {
        return jsonResponse({
          toggles: [{
            key: "sourcevision.ask",
            label: "Ask Panel",
            description: "",
            impact: "",
            package: "sourcevision",
            stability: "experimental",
            defaultValue: false,
            enabled,
          }],
        });
      }
      if (url === "/api/project") {
        return jsonResponse({ name: "n-dx", description: null, version: null, git: null, nameSource: "directory", cliName: "n-dx" });
      }
      if (url === "/api/status") {
        return jsonResponse({
          sv: { freshness: "fresh", analyzedAt: null, minutesAgo: 0, modulesComplete: 0, modulesTotal: 0 },
          rex: { exists: false, percentComplete: 0, stats: null, hasInProgress: false, hasPending: false, nextTaskTitle: null },
          hench: { configured: false, totalRuns: 0, activeRuns: 0, staleRuns: 0 },
        });
      }
      return jsonResponse({}, 404);
    }));

    root = document.createElement("div");
    document.body.appendChild(root);
    await act(async () => {
      render(
        h(Sidebar, {
          view: "overview" as ViewId,
          onNavigate: () => {},
          manifest: null,
          zones: null,
          sidebarCollapsed: false,
          onToggleSidebar: () => {},
          scope: "sourcevision",
        }),
        root,
      );
    });
    // Two settles: the toggle fetch, then the re-render it triggers.
    for (let i = 0; i < 4; i += 1) {
      await act(async () => { await new Promise<void>((r) => setTimeout(r, 0)); });
    }
    return root;
  }

  /**
   * Nav item labels, excluding the icon and enrichment-badge spans.
   *
   * `textContent` on a `.nav-item` concatenates the icon glyph onto the label
   * ("▣Overview"), so an exact-match assertion has to read only the
   * element's own text nodes.
   */
  function navLabels(): string[] {
    return Array.from(root.querySelectorAll(".nav-item")).map((item) =>
      Array.from(item.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent ?? "")
        .join("")
        .trim(),
    );
  }

  beforeEach(() => {
    clearProjectMetadataCache();
    localStorage.clear();
    // The tab is `requiresServer`, so a stray deployed-mode flag would hide it
    // for reasons that have nothing to do with the gate under test.
    delete window.__NDX_DEPLOYED__;
  });

  afterEach(() => {
    if (root) render(null, root);
    if (root?.parentNode) root.parentNode.removeChild(root);
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  it("hides the Ask tab when the gate is off", async () => {
    await renderSidebarWithGate(false);
    expect(navLabels()).not.toContain("Ask");
    // The ungated sibling is still there, so this is the gate and not a
    // sidebar that failed to render its SourceVision section at all.
    expect(navLabels()).toContain("Overview");
  });

  it("shows the Ask tab when the gate is on", async () => {
    await renderSidebarWithGate(true);
    expect(navLabels()).toContain("Ask");
  });
});
