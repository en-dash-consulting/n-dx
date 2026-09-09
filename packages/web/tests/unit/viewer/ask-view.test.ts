// @vitest-environment jsdom
/**
 * Tests for the SourceVision Ask panel shell.
 *
 * Covers the four display states and the transitions between them, that a
 * blank prompt never reaches the network, and that the tab stays hidden while
 * the `sourcevision.ask` gate is off.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { AskView, isBlankPrompt, stateForResponse } from "../../../src/viewer/views/ask.js";
import { SOURCEVISION_TABS } from "../../../src/viewer/views/index.js";
import { renderActiveView, type ViewRenderContext } from "../../../src/viewer/views/view-registry.js";
import { Sidebar } from "../../../src/viewer/components/sidebar.js";
import { SOURCEVISION_SCOPE_VIEWS, buildValidViews, isKnownViewPath } from "../../../src/shared/index.js";
import type { LoadedData } from "../../../src/viewer/types.js";

/** Minimal render context — the Ask view takes no props from it. */
function askRenderContext(): ViewRenderContext {
  const data: LoadedData = {
    manifest: null,
    inventory: null,
    imports: null,
    zones: null,
    components: null,
    callGraph: null,
  };
  return {
    data,
    setDetail: () => {},
    setPrdDetailContent: () => {},
    selectedFile: null,
    setSelectedFile: () => {},
    selectedZone: null,
    selectedRunId: null,
    selectedTaskId: null,
    navigateTo: () => {},
    isFeatureDisabled: () => false,
  };
}

/** Poll until an assertion passes or the timeout is reached. */
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

const ANSWER_BODY = {
  ok: true,
  answer: "web-viewer is the hub zone; everything else imports through it.",
  vendor: "claude",
  model: "claude-opus-5",
  sources: ["CONTEXT.md"],
};

describe("AskView", () => {
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
    act(() => {
      render(h(AskView, null), root);
    });
  }

  function promptInput(): HTMLTextAreaElement {
    const el = root.querySelector<HTMLTextAreaElement>(".ask-prompt-input");
    if (!el) throw new Error("prompt textarea is not rendered");
    return el;
  }

  function submitButton(): HTMLButtonElement {
    const el = root.querySelector<HTMLButtonElement>(".ask-submit-btn");
    if (!el) throw new Error("submit button is not rendered");
    return el;
  }

  function typePrompt(value: string) {
    const input = promptInput();
    act(() => {
      input.value = value;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  /** Resolve `fetch` only when told to, so the submitting state is observable. */
  function deferredJson(body: unknown) {
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    fetchSpy.mockImplementation(async () => {
      await gate;
      return { ok: true, status: 200, json: async () => body };
    });
    return { release: () => release() };
  }

  it("renders a labelled textarea wired to the submit control", () => {
    mount();

    const label = root.querySelector<HTMLLabelElement>(".ask-prompt-label");
    expect(label).not.toBeNull();
    expect(label?.htmlFor).toBe(promptInput().id);
    expect(promptInput().id).toBeTruthy();
    expect(submitButton().textContent).toBe("Ask");
  });

  it("starts in the idle state", () => {
    mount();

    expect(root.querySelector(".ask-idle")).not.toBeNull();
    expect(root.querySelector(".ask-submitting")).toBeNull();
    expect(root.querySelector(".ask-answered")).toBeNull();
    expect(root.querySelector(".ask-error")).toBeNull();
  });

  it("transitions idle → submitting → answered", async () => {
    const pending = deferredJson(ANSWER_BODY);
    mount();
    typePrompt("Which zone is the hub?");

    act(() => { submitButton().click(); });

    await waitFor(() => expect(root.querySelector(".ask-submitting")).not.toBeNull());
    expect(root.querySelector(".ask-idle")).toBeNull();
    expect(submitButton().disabled).toBe(true);
    expect(promptInput().disabled).toBe(true);

    pending.release();

    await waitFor(() => expect(root.querySelector(".ask-answered")).not.toBeNull());
    expect(root.querySelector(".ask-submitting")).toBeNull();
    expect(root.querySelector(".ask-answer")?.textContent).toBe(ANSWER_BODY.answer);
    expect(root.querySelector(".ask-answer-meta")?.textContent).toContain("claude-opus-5");
    expect(root.querySelector(".ask-answer-meta")?.textContent).toContain("CONTEXT.md");
  });

  it("transitions to the error state on a classified failure, naming the reason", async () => {
    fetchSpy.mockResolvedValue({
      ok: false,
      status: 429,
      json: async () => ({ ok: false, reason: "rate-limit", error: "LLM rate limit reached: slow down" }),
    });
    mount();
    typePrompt("Why is coupling high?");

    act(() => { submitButton().click(); });

    await waitFor(() => expect(root.querySelector(".ask-error")).not.toBeNull());
    expect(root.querySelector(".ask-error")?.textContent).toContain("LLM rate limit reached");
    expect(root.querySelector(".ask-answered")).toBeNull();
    // The control comes back — a rate limit is worth retrying.
    expect(submitButton().disabled).toBe(false);
  });

  it("reports a rejected fetch as an error rather than hanging in submitting", async () => {
    fetchSpy.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:3117"));
    mount();
    typePrompt("Anything");

    act(() => { submitButton().click(); });

    await waitFor(() => expect(root.querySelector(".ask-error")).not.toBeNull());
    expect(root.querySelector(".ask-error")?.textContent).toContain("ECONNREFUSED");
  });

  it("replaces a previous answer when asked again", async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ANSWER_BODY });
    mount();
    typePrompt("First question");
    act(() => { submitButton().click(); });
    await waitFor(() => expect(root.querySelector(".ask-answered")).not.toBeNull());

    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ ...ANSWER_BODY, answer: "A different answer." }),
    });
    typePrompt("Second question");
    act(() => { submitButton().click(); });

    await waitFor(() => {
      expect(root.querySelector(".ask-answer")?.textContent).toBe("A different answer.");
    });
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("issues no request for an empty or whitespace-only prompt", () => {
    mount();

    // Empty — the button is disabled, and a click on it does nothing.
    expect(submitButton().disabled).toBe(true);
    act(() => { submitButton().click(); });

    // Whitespace only — same, even though the field is non-empty.
    typePrompt("   \n\t  ");
    expect(submitButton().disabled).toBe(true);
    act(() => { submitButton().click(); });

    // And via the keyboard shortcut, which bypasses the disabled attribute.
    act(() => {
      promptInput().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
      );
    });

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(root.querySelector(".ask-idle")).not.toBeNull();
  });

  it("submits on Cmd/Ctrl+Enter and sends the trimmed prompt", async () => {
    fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ANSWER_BODY });
    mount();
    typePrompt("  Which zone is the hub?  ");

    act(() => {
      promptInput().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", metaKey: true, bubbles: true }),
      );
    });

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/sourcevision/ask");
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({ prompt: "Which zone is the hub?" });
  });

  it("does not issue a second request while one is in flight", async () => {
    const pending = deferredJson(ANSWER_BODY);
    mount();
    typePrompt("Which zone is the hub?");

    act(() => { submitButton().click(); });
    await waitFor(() => expect(root.querySelector(".ask-submitting")).not.toBeNull());
    act(() => {
      promptInput().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
      );
    });

    pending.release();
    await waitFor(() => expect(root.querySelector(".ask-answered")).not.toBeNull());
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("AskView in deployed mode", () => {
  let root: HTMLDivElement;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    window.__NDX_DEPLOYED__ = { basePath: "/", exportedAt: "2026-09-09T00:00:00.000Z" };
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    delete window.__NDX_DEPLOYED__;
  });

  it("explains itself instead of offering a control that cannot work", () => {
    act(() => {
      render(h(AskView, null), root);
    });

    expect(root.querySelector(".ask-unavailable")).not.toBeNull();
    expect(root.querySelector(".ask-prompt-input")).toBeNull();
    expect(root.querySelector(".ask-submit-btn")).toBeNull();
  });
});

describe("ask state helpers", () => {
  it("treats whitespace-only prompts as blank", () => {
    expect(isBlankPrompt("")).toBe(true);
    expect(isBlankPrompt("   \n\t ")).toBe(true);
    expect(isBlankPrompt(" a ")).toBe(false);
  });

  it("maps a success body to the answered state", () => {
    expect(stateForResponse(ANSWER_BODY)).toEqual({
      status: "answered",
      answer: ANSWER_BODY.answer,
      vendor: "claude",
      model: "claude-opus-5",
      sources: ["CONTEXT.md"],
    });
  });

  it("maps a failure body to the error state", () => {
    expect(stateForResponse({ ok: false, reason: "auth", error: "LLM authentication failed: no key" }))
      .toEqual({ status: "error", message: "LLM authentication failed: no key" });
  });

  it("does not report a malformed body as an answer", () => {
    // A 200 with no `answer` would otherwise render an empty answered card.
    const state = stateForResponse({ ok: true } as unknown as Parameters<typeof stateForResponse>[0]);
    expect(state.status).toBe("error");
  });
});

describe("Ask tab gating", () => {
  it("is registered behind the sourcevision.ask feature gate", () => {
    const tab = SOURCEVISION_TABS.find((t) => t.id === "ask");
    expect(tab).toBeDefined();
    expect(tab?.featureGate).toBe("sourcevision.ask");
    expect(tab?.label).toBe("Ask");
    expect(tab?.minPass).toBe(0);
  });

  it("is deep-linkable in the sourcevision scope", () => {
    expect(SOURCEVISION_SCOPE_VIEWS).toContain("ask");
    expect(buildValidViews("sourcevision").has("ask")).toBe(true);
    expect(buildValidViews(null).has("ask")).toBe(true);
    expect(isKnownViewPath("ask")).toBe(true);
  });

  it("has a registry renderer, so a direct URL resolves to the view", () => {
    expect(renderActiveView("ask", askRenderContext())).toBeTruthy();
  });
});

/**
 * The gate-off case, asserted against the real sidebar rather than a restated
 * predicate — the failure this guards is the tab being *added* to the strip
 * without its gate reaching the sidebar's map, which a re-implemented filter
 * would happily pass.
 */
describe("Ask tab visibility in the sidebar", () => {
  let root: HTMLDivElement;

  function stubFeatures(askEnabled: boolean) {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/features") {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            toggles: [{ key: "sourcevision.ask", enabled: askEnabled }],
          }),
        };
      }
      return { ok: false, status: 404, json: async () => ({}) };
    }));
  }

  async function renderSidebar() {
    root = document.createElement("div");
    document.body.appendChild(root);
    act(() => {
      render(
        h(Sidebar, {
          view: "overview" as const,
          onNavigate: () => {},
          manifest: null,
          zones: null,
          sidebarCollapsed: false,
          onToggleSidebar: () => {},
        }),
        root,
      );
    });
    // The gate arrives from /api/features, so wait for the nav strip to settle
    // rather than for a fixed number of ticks — the toggle fetch resolves on
    // its own schedule and a tick count that happens to work is a flake.
    await waitFor(() => expect(root.querySelectorAll(".nav-item").length).toBeGreaterThan(0));
    return root;
  }

  function navLabels(): string[] {
    return Array.from(root.querySelectorAll(".nav-item")).map((el) => el.textContent ?? "");
  }

  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    if (root) render(null, root);
    root?.remove();
    vi.unstubAllGlobals();
  });

  it("hides the Ask tab while the gate is off", async () => {
    stubFeatures(false);
    await renderSidebar();

    expect(navLabels().some((label) => label.includes("Ask"))).toBe(false);
    // The ungated sibling is still there, so this is the gate and not a
    // sidebar that failed to render.
    expect(navLabels().some((label) => label.includes("Overview"))).toBe(true);
  });

  it("shows the Ask tab once the gate is on", async () => {
    stubFeatures(true);
    await renderSidebar();

    await waitFor(() => {
      expect(navLabels().some((label) => label.includes("Ask"))).toBe(true);
    });
  });
});
