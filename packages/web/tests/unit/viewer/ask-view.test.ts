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
import {
  AskView,
  ASK_ENDPOINT,
  ASK_CAPTURE_ENDPOINT,
  describeCapture,
  isSubmittablePrompt,
} from "../../../src/viewer/views/ask.js";
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

/**
 * Install (or remove) `navigator.clipboard`.
 *
 * `configurable: true` matters: the modern-API and no-API cases both run in
 * the same worker, so the property has to be replaceable between tests.
 */
function setClipboard(writeText: ReturnType<typeof vi.fn> | null): void {
  Object.defineProperty(navigator, "clipboard", {
    value: writeText === null ? undefined : { writeText },
    configurable: true,
    writable: true,
  });
}

describe("AskView", () => {
  let root: HTMLDivElement;
  /** Response served to the next POST /api/sourcevision/ask. */
  let askResponse: () => Promise<Response>;
  /** Response served to the next POST /api/rex/capture-ask. */
  let captureResponse: () => Promise<Response>;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let clipboardWriteText: ReturnType<typeof vi.fn>;
  /** Set when a test installs a fake execCommand, so afterEach can remove it. */
  let stubbedExecCommand = false;

  /** Stub `document.execCommand("copy")`, which jsdom does not implement. */
  function stubExecCommand(result: boolean): ReturnType<typeof vi.fn> {
    const spy = vi.fn(() => result);
    (document as unknown as { execCommand: unknown }).execCommand = spy;
    stubbedExecCommand = true;
    return spy;
  }

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
    captureResponse = async () => jsonResponse({
      ok: true,
      item: { id: "task-1", title: "Which zones are most coupled?", level: "task" },
      parent: { id: "epic-1", title: "SourceVision Ask", level: "epic", created: true },
    });
    fetchSpy = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === ASK_ENDPOINT) return askResponse();
      if (url === ASK_CAPTURE_ENDPOINT) return captureResponse();
      if (url === "/api/project") {
        return jsonResponse({ name: "n-dx", description: null, version: null, git: null, nameSource: "directory", cliName: "n-dx" });
      }
      return jsonResponse({}, 404);
    });
    vi.stubGlobal("fetch", fetchSpy);
    clipboardWriteText = vi.fn(async () => {});
    setClipboard(clipboardWriteText);
  });

  afterEach(() => {
    if (root) render(null, root);
    if (root?.parentNode) root.parentNode.removeChild(root);
    document.body.innerHTML = "";
    // Vitest shares one worker process across test files, so a deployed-mode
    // flag left on `window` would silently hide every `requiresServer` tab in
    // whatever ran next — which is how the gate-on case below first failed.
    delete window.__NDX_DEPLOYED__;
    // jsdom ships no execCommand; leaving a fake behind would make the
    // permission-denied case in another file silently succeed via the fallback.
    if (stubbedExecCommand) {
      delete (document as unknown as { execCommand?: unknown }).execCommand;
      stubbedExecCommand = false;
    }
    setClipboard(null);
    // Restored here as well as in the tests that install them: a fake clock
    // abandoned by a timed-out test deadlocks every later `settle()`, which
    // presents as a dozen unrelated failures rather than as one.
    vi.useRealTimers();
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
    expect(submitButton().textContent).toBe("Asking...");
    // Neither control is hard-disabled while the request is in flight — see
    // the focus-retention test below for why. They report unavailable instead.
    expect(submitButton().getAttribute("aria-disabled")).toBe("true");
    expect(textarea().readOnly).toBe(true);

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
    expect(submitButton().getAttribute("aria-disabled")).toBeNull();
    expect(textarea().readOnly).toBe(false);
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

    // The status is mapped onto a mode rather than shown as one — see the
    // degraded-mode section below for what the card says instead.
    expect(root.querySelector(".sv-ask-error-message")?.textContent?.trim().length)
      .toBeGreaterThan(0);
    expect(root.querySelector(".sv-ask-error h3")?.textContent?.trim().length)
      .toBeGreaterThan(0);
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

  // ── Degraded modes ───────────────────────────────────────────────
  //
  // Three distinct ways to be unusable, three distinct cards. The assertions
  // below are about what the user is told and what they can do next, not about
  // which HTTP status arrived — that mapping is covered in ask-failure.test.ts.

  /** Text of every guidance step in the error card. */
  function errorSteps(): string[] {
    return Array.from(root.querySelectorAll(".sv-ask-error-steps li"))
      .map((li) => li.textContent ?? "");
  }

  function errorKind(): string | null {
    return root.querySelector(".sv-ask-error")?.getAttribute("data-ask-error-kind") ?? null;
  }

  function retryButton(): HTMLButtonElement | null {
    return root.querySelector<HTMLButtonElement>("button.sv-ask-retry-btn");
  }

  /** Drive one failed exchange and leave the error card on screen. */
  async function failWith(response: () => Promise<Response>, question = "Which zones are most coupled?"): Promise<void> {
    mount();
    await settle();
    askResponse = response;
    await type(question);
    await submitForm();
  }

  it("offers the analysis run itself when there is nothing to answer from", async () => {
    await failWith(async () => jsonResponse({
      error: "No analysis data to answer from.",
      kind: "no_analysis",
      suggestion: "Run 'n-dx analyze .' first, then ask again.",
    }, 404));

    expect(errorKind()).toBe("no_analysis");
    // The affordance, not just the command name: the same control the Overview
    // uses, so the user can start the run without leaving the panel.
    const analyze = root.querySelector(".sv-ask-error-analyze .overview-reanalyze");
    expect(analyze).not.toBeNull();
    expect(analyze?.textContent).toContain("Re-analyze");
    expect(analyze?.textContent).toContain("Full analysis");
    // Retrying the question would hit the same absent data.
    expect(retryButton()).toBeNull();
  });

  it("shows the endpoint's canonical credential steps for an auth failure", async () => {
    // Exactly what the route sends: authFailureGuidance(vendor).remediation,
    // ending in VERIFY_CREDENTIALS_STEP. The panel renders them; it does not
    // author credential wording of its own.
    await failWith(async () => jsonResponse({
      error: "Authentication failed for Claude — Invalid or expired credentials.",
      kind: "auth",
      suggestion: "Re-authenticate: claude logout && claude login  Verify credentials: ndx auth",
      remediation: [
        "Re-authenticate: claude logout && claude login",
        "Verify credentials: ndx auth",
      ],
    }, 401));

    expect(errorKind()).toBe("auth");
    expect(errorSteps()).toContain("Re-authenticate: claude logout && claude login");
    expect(errorSteps()).toContain("Verify credentials: ndx auth");
    // Neither an analysis nor a retry fixes a rejected credential.
    expect(retryButton()).toBeNull();
    expect(root.querySelector(".sv-ask-error-analyze")).toBeNull();
  });

  it("names a timeout as itself and offers a retry", async () => {
    await failWith(async () => jsonResponse({
      error: "Ask request timed out after 120s.",
      kind: "timeout",
    }, 504));

    expect(errorKind()).toBe("timeout");
    expect(root.querySelector(".sv-ask-error h3")?.textContent).toMatch(/time/i);
    expect(retryButton()).not.toBeNull();
  });

  it("names a rate limit as itself and states the delay the vendor asked for", async () => {
    await failWith(async () => jsonResponse({
      error: "Rate limit exceeded — the API is temporarily throttling requests.",
      kind: "rate_limit",
      retryAfterMs: 30_000,
    }, 429));

    expect(errorKind()).toBe("rate_limit");
    expect(root.querySelector(".sv-ask-error h3")?.textContent).toMatch(/rate limit/i);
    expect(errorSteps().join(" ")).toContain("30-second");
    expect(retryButton()).not.toBeNull();
  });

  it("names a provider error as itself without offering a retry", async () => {
    await failWith(async () => jsonResponse({
      error: "The API is temporarily overloaded or experiencing errors.",
      kind: "llm_error",
    }, 502));

    expect(errorKind()).toBe("llm_error");
    expect(root.querySelector(".sv-ask-error h3")?.textContent).toMatch(/provider/i);
    expect(retryButton()).toBeNull();
    // Still not a dead end: the card says what to do instead.
    expect(errorSteps().length).toBeGreaterThan(0);
  });

  it("re-sends the question that failed when Retry is pressed", async () => {
    await failWith(async () => jsonResponse({ error: "timed out", kind: "timeout" }, 504), "Why is checkout coupled?");

    askResponse = async () => jsonResponse({ answer: "Because of the pipeline file.", vendor: "claude", model: "m" });
    await act(async () => {
      retryButton()!.click();
      await settle();
    });

    const bodies = fetchSpy.mock.calls
      .filter(([u]) => String(u) === ASK_ENDPOINT)
      .map(([, init]) => JSON.parse((init as RequestInit).body as string));
    expect(bodies).toHaveLength(2);
    expect(bodies[1].prompt).toBe("Why is checkout coupled?");
    expect(root.querySelector(".sv-ask-answer-body")?.textContent).toBe("Because of the pipeline file.");
  });

  it("keeps the question in the textarea through every degraded mode", async () => {
    const question = "Which zones are most coupled, and what is driving it?";
    const failures: Array<() => Promise<Response>> = [
      async () => jsonResponse({ error: "no analysis", kind: "no_analysis" }, 404),
      async () => jsonResponse({ error: "auth", kind: "auth", remediation: ["Verify credentials: ndx auth"] }, 401),
      async () => jsonResponse({ error: "timed out", kind: "timeout" }, 504),
      async () => jsonResponse({ error: "throttled", kind: "rate_limit" }, 429),
      async () => { throw new TypeError("Failed to fetch"); },
      async () => new Response("<html>502</html>", { status: 502, headers: { "Content-Type": "text/html" } }),
    ];

    mount();
    await settle();
    await type(question);
    for (const response of failures) {
      askResponse = response;
      await submitForm();
      expect(root.querySelector(".sv-ask-error")).not.toBeNull();
      // The whole point: a failure never costs the user their question.
      expect(textarea().value).toBe(question);
      expect(submitButton().disabled).toBe(false);
    }
  });

  it("names a mode rather than a status code when the body is not ours", async () => {
    // A proxy's HTML 502 used to render as "The Ask request failed (502)".
    await failWith(async () => new Response("<html>502 Bad Gateway</html>", {
      status: 502,
      headers: { "Content-Type": "text/html" },
    }));

    expect(errorKind()).toBe("llm_error");
    const message = root.querySelector(".sv-ask-error-message")?.textContent ?? "";
    expect(message).not.toMatch(/^The Ask request failed/);
    expect(message.trim().length).toBeGreaterThan(0);
    expect(errorSteps().length).toBeGreaterThan(0);
  });

  it("reports a transport failure as unreachable, not as the raw fetch text alone", async () => {
    await failWith(async () => { throw new TypeError("Failed to fetch"); });

    expect(errorKind()).toBe("network");
    // The thrown text is kept as detail, but the heading is what names the fault.
    expect(root.querySelector(".sv-ask-error h3")?.textContent).toMatch(/reach/i);
    expect(retryButton()).not.toBeNull();
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

  // ── Answer actions: Copy ─────────────────────────────────────────

  /** Get to an answered panel with `answer` on screen. */
  async function askAndAnswer(answer = "web-viewer is the hub zone."): Promise<void> {
    mount();
    await settle();
    askResponse = async () => jsonResponse({ answer, vendor: "claude", model: "m" });
    await type("Which zones are most coupled?");
    await submitForm();
  }

  function copyButton(): HTMLButtonElement {
    const el = root.querySelector<HTMLButtonElement>("button.sv-ask-copy-btn");
    if (!el) throw new Error("copy control not rendered");
    return el;
  }

  function captureButton(): HTMLButtonElement {
    const el = root.querySelector<HTMLButtonElement>("button.sv-ask-capture-btn");
    if (!el) throw new Error("capture control not rendered");
    return el;
  }

  async function click(el: HTMLButtonElement): Promise<void> {
    await act(async () => { el.click(); });
    await settle();
  }

  function copyFeedback(): string {
    return root.querySelector(".sv-ask-copy-feedback")?.textContent ?? "";
  }

  function captureFeedback(): string {
    return root.querySelector(".sv-ask-capture-feedback")?.textContent ?? "";
  }

  it("offers no actions until there is an answer to act on", async () => {
    mount();
    await settle();
    expect(root.querySelector(".sv-ask-actions")).toBeNull();
    expect(root.querySelector("button.sv-ask-copy-btn")).toBeNull();
    expect(root.querySelector("button.sv-ask-capture-btn")).toBeNull();
  });

  it("copies the raw answer text through the clipboard API", async () => {
    await askAndAnswer("## Coupling\n\n`web-viewer` is the hub.");
    await click(copyButton());

    // The raw text, not the rendered node text — a markdown answer must round
    // trip through the clipboard unchanged.
    expect(clipboardWriteText).toHaveBeenCalledWith("## Coupling\n\n`web-viewer` is the hub.");
    expect(copyFeedback()).toBe("Copied answer to clipboard.");
    expect(copyButton().textContent).toBe("Copied");
  });

  it("falls back to execCommand when the clipboard API is unavailable", async () => {
    setClipboard(null);
    const execCommand = stubExecCommand(true);

    await askAndAnswer("Fallback body.");
    await click(copyButton());

    expect(execCommand).toHaveBeenCalledWith("copy");
    expect(copyFeedback()).toBe("Copied answer to clipboard.");
  });

  it("falls back to execCommand when the clipboard API rejects", async () => {
    clipboardWriteText.mockRejectedValueOnce(new Error("write failed"));
    const execCommand = stubExecCommand(true);

    await askAndAnswer("Fallback body.");
    await click(copyButton());

    expect(clipboardWriteText).toHaveBeenCalled();
    expect(execCommand).toHaveBeenCalledWith("copy");
    // A fallback that worked is a successful copy, whatever the API said.
    expect(copyFeedback()).toBe("Copied answer to clipboard.");
  });

  it("reports a permission denial distinctly from a generic failure", async () => {
    const denied = new Error("Permission denied");
    denied.name = "NotAllowedError";
    clipboardWriteText.mockRejectedValueOnce(denied);
    // No execCommand stub: the fallback must fail too, or the denial never
    // reaches the message.

    await askAndAnswer("Denied body.");
    await click(copyButton());

    expect(copyFeedback()).toBe(
      "Clipboard access was blocked by browser permissions. "
      + "Copy manually: select the answer and press Cmd+C (macOS) or Ctrl+C (Windows/Linux).",
    );
    // Same wording as the PR Markdown view, which is the point of sharing the
    // helper — and distinct from the generic case asserted next.
    expect(copyFeedback()).not.toContain("Failed to copy answer");
  });

  it("reports a non-permission failure with generic wording", async () => {
    clipboardWriteText.mockRejectedValueOnce(new Error("clipboard is on fire"));
    stubExecCommand(false);

    await askAndAnswer("Broken body.");
    await click(copyButton());

    expect(copyFeedback()).toBe(
      "Failed to copy answer to clipboard. "
      + "Copy manually: select the answer and press Cmd+C (macOS) or Ctrl+C (Windows/Linux).",
    );
    expect(copyFeedback()).not.toContain("browser permissions");
  });

  it("clears copy feedback on its own", async () => {
    // `shouldAdvanceTime` keeps the real clock driving the zero-delay timers
    // that `settle()` awaits. Without it the harness deadlocks and the test
    // times out before it can assert anything — and the abandoned fake clock
    // then deadlocks every test after it in the file.
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await askAndAnswer("Body.");
      await click(copyButton());
      expect(copyFeedback()).toContain("Copied answer");

      await act(async () => { vi.advanceTimersByTime(2_000); });
      expect(copyFeedback()).toBe("");
      expect(copyButton().textContent).toBe("Copy answer");
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Answer actions: Capture to PRD ───────────────────────────────

  it("writes nothing until the capture is confirmed", async () => {
    await askAndAnswer();

    const captureCalls = () => fetchSpy.mock.calls.filter(([u]) => String(u) === ASK_CAPTURE_ENDPOINT).length;
    expect(captureCalls()).toBe(0);

    // Arming the action is not the action.
    await click(captureButton());
    expect(captureCalls()).toBe(0);
    expect(root.querySelector(".sv-ask-capture-confirm")).not.toBeNull();
    expect(root.textContent).toContain("File this answer as a PRD task?");
    // The arming button is replaced while armed, so it cannot be pressed twice.
    expect(root.querySelector("button.sv-ask-capture-btn")).toBeNull();

    const confirm = root.querySelector<HTMLButtonElement>("button.sv-ask-capture-confirm-btn")!;
    await click(confirm);
    expect(captureCalls()).toBe(1);
  });

  it("cancels without writing and can be armed again", async () => {
    await askAndAnswer();

    await click(captureButton());
    const cancel = root.querySelector<HTMLButtonElement>("button.sv-ask-capture-cancel-btn")!;
    await click(cancel);

    expect(fetchSpy.mock.calls.filter(([u]) => String(u) === ASK_CAPTURE_ENDPOINT)).toHaveLength(0);
    expect(root.querySelector(".sv-ask-capture-confirm")).toBeNull();
    expect(captureFeedback()).toBe("");
    // Cancelling returns the action to its resting state rather than consuming it.
    expect(root.querySelector("button.sv-ask-capture-btn")).not.toBeNull();
  });

  it("sends the question and answer, and reports the item and its parent", async () => {
    await askAndAnswer("Split the hub zone.");

    await click(captureButton());
    await click(root.querySelector<HTMLButtonElement>("button.sv-ask-capture-confirm-btn")!);

    const call = fetchSpy.mock.calls.find(([u]) => String(u) === ASK_CAPTURE_ENDPOINT)!;
    const init = call[1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(String(init.body))).toEqual({
      question: "Which zones are most coupled?",
      answer: "Split the hub zone.",
    });

    expect(captureFeedback()).toBe(
      'Captured "Which zones are most coupled?" under "SourceVision Ask" (new epic).',
    );
  });

  it("surfaces a capture failure and leaves the answer re-copyable", async () => {
    captureResponse = async () => jsonResponse({ error: "PRD is locked by pid 4212" }, 409);

    await askAndAnswer("Answer worth keeping.");
    await click(captureButton());
    await click(root.querySelector<HTMLButtonElement>("button.sv-ask-capture-confirm-btn")!);

    expect(root.querySelector(".sv-ask-capture-error")?.textContent).toBe("PRD is locked by pid 4212");
    // The alert is the line, not the message span, so the marker and the
    // screen-reader prefix are announced with the reason rather than after it.
    const alert = root.querySelector("p[role='alert'].sv-ask-feedback-error");
    expect(alert).not.toBeNull();
    expect(alert?.querySelector(".sv-ask-capture-error")).not.toBeNull();

    // The answer survived the failed write, and Copy still works on it.
    expect(root.querySelector(".sv-ask-answer-body")?.textContent).toBe("Answer worth keeping.");
    await click(copyButton());
    expect(clipboardWriteText).toHaveBeenCalledWith("Answer worth keeping.");
    expect(copyFeedback()).toContain("Copied answer");
  });

  it("names the status code when a capture failure carries no message", async () => {
    captureResponse = async () => new Response("<html>502</html>", {
      status: 502,
      headers: { "Content-Type": "text/html" },
    });

    await askAndAnswer();
    await click(captureButton());
    await click(root.querySelector<HTMLButtonElement>("button.sv-ask-capture-confirm-btn")!);

    expect(root.querySelector(".sv-ask-capture-error")?.textContent).toContain("502");
  });

  it("does not write twice when Confirm is pressed twice", async () => {
    let release: (r: Response) => void = () => {};
    captureResponse = () => new Promise<Response>((resolve) => { release = resolve; });

    await askAndAnswer();
    await click(captureButton());

    const confirm = root.querySelector<HTMLButtonElement>("button.sv-ask-capture-confirm-btn")!;
    await act(async () => {
      confirm.click();
      confirm.click();
    });

    expect(fetchSpy.mock.calls.filter(([u]) => String(u) === ASK_CAPTURE_ENDPOINT)).toHaveLength(1);
    expect(root.querySelector(".sv-ask-capture-busy")).not.toBeNull();

    await act(async () => {
      release(jsonResponse({ item: { title: "T" }, parent: { title: "SourceVision Ask" } }));
      await settle();
    });
  });

  it("clears capture feedback on its own", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      await askAndAnswer();
      await click(captureButton());
      await click(root.querySelector<HTMLButtonElement>("button.sv-ask-capture-confirm-btn")!);
      expect(captureFeedback()).toContain("Captured");

      await act(async () => { vi.advanceTimersByTime(10_000); });
      expect(captureFeedback()).toBe("");
    } finally {
      vi.useRealTimers();
    }
  });

  // ── Feedback does not outlive its answer ─────────────────────────

  it("drops both kinds of feedback when a new question is asked", async () => {
    await askAndAnswer("First answer.");

    await click(copyButton());
    await click(captureButton());
    await click(root.querySelector<HTMLButtonElement>("button.sv-ask-capture-confirm-btn")!);
    expect(copyFeedback()).toContain("Copied answer");
    expect(captureFeedback()).toContain("Captured");

    askResponse = async () => jsonResponse({ answer: "Second answer.", vendor: "claude", model: "m" });
    await type("A different question?");
    await submitForm();

    expect(root.querySelector(".sv-ask-answer-body")?.textContent).toBe("Second answer.");
    expect(copyFeedback()).toBe("");
    expect(captureFeedback()).toBe("");
    expect(copyButton().textContent).toBe("Copy answer");
  });

  it("drops feedback even when the new question fails", async () => {
    await askAndAnswer("First answer.");
    await click(copyButton());
    expect(copyFeedback()).toContain("Copied answer");

    askResponse = async () => jsonResponse({ error: "Vendor refused.", kind: "rate_limit" }, 429);
    await type("A doomed question?");
    await submitForm();

    // The answer card is gone, so the feedback lines are gone with it — the
    // assertion that matters is that neither reappears attached to the error.
    expect(root.querySelector(".sv-ask-answer")).toBeNull();
    expect(root.textContent).not.toContain("Copied answer to clipboard.");
  });

  // ── Capture result wording ───────────────────────────────────────

  it("describes a capture from whatever the endpoint returned", () => {
    expect(describeCapture({
      item: { title: "Split the hub" },
      parent: { title: "SourceVision Ask", created: false },
    })).toBe('Captured "Split the hub" under "SourceVision Ask".');

    expect(describeCapture({
      item: { title: "Split the hub" },
      parent: { title: "SourceVision Ask", created: true },
    })).toBe('Captured "Split the hub" under "SourceVision Ask" (new epic).');

    // A 200 that names nothing still reports that something was written,
    // rather than rendering `Captured "undefined" under "undefined"`.
    expect(describeCapture({})).toBe('Captured "the answer" to the PRD.');
    expect(describeCapture({ item: { title: "   " } })).toBe('Captured "the answer" to the PRD.');
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
