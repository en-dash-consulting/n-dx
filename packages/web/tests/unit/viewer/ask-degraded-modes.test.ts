// @vitest-environment jsdom
/**
 * The Ask panel's three ways of being unusable.
 *
 * No analysis, no credentials, and the provider failing are three different
 * problems with three different fixes, and a user who is told "request
 * failed" for any of them learns nothing. These tests assert that each mode
 * names itself, carries remediation authored by whoever knows the fix, and
 * offers an action where one exists — and that none of them degrades to a
 * bare generic string.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import {
  AskView,
  ASK_ENDPOINT,
  askFailureHeading,
  askFailureSteps,
  parseAskFailure,
} from "../../../src/viewer/views/ask.js";
import type { AskFailureCategory } from "../../../src/viewer/views/ask.js";
import { authFailureGuidance, VERIFY_CREDENTIALS_STEP } from "@n-dx/llm-client";
import { clearPendingAskSeed } from "../../../src/viewer/ask-seed.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";

const ANALYZE_ENDPOINT = "/api/commands/sv-analyze";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise<void>((r) => setTimeout(r, 0));
  });
}

/** A body shaped like the endpoint's error responses. */
function errorBody(over: Partial<{
  error: string; category: string; suggestion: string; retryable: boolean;
}> = {}) {
  return {
    error: "something went wrong",
    category: "unknown",
    suggestion: "try again",
    retryable: false,
    ...over,
  };
}

describe("Ask panel degraded modes", () => {
  let root: HTMLDivElement;
  let fetchSpy: ReturnType<typeof vi.fn>;
  let askQueue: Array<() => Promise<Response>>;
  let analyzeQueue: Array<() => Promise<Response>>;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    clearPendingAskSeed();
    clearProjectMetadataCache();
    askQueue = [];
    analyzeQueue = [];
    fetchSpy = vi.fn((url: unknown) => {
      const target = String(url);
      if (target === ASK_ENDPOINT) {
        const scripted = askQueue.shift();
        return scripted ? scripted() : Promise.resolve(jsonResponse(errorBody(), 502));
      }
      if (target === ANALYZE_ENDPOINT) {
        const scripted = analyzeQueue.shift();
        return scripted ? scripted() : Promise.resolve(jsonResponse({ started: true }, 202));
      }
      if (target.startsWith(`${ANALYZE_ENDPOINT}/status`)) {
        return Promise.resolve(jsonResponse({
          running: true, startedAt: "now", finishedAt: null, recentOutput: "", error: null,
        }));
      }
      return Promise.resolve(new Response("{}", { status: 404 }));
    });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    clearPendingAskSeed();
    clearProjectMetadataCache();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function mount() {
    act(() => { render(h(AskView, null), root); });
  }

  function textarea(): HTMLTextAreaElement {
    return root.querySelector<HTMLTextAreaElement>("textarea#ask-prompt")!;
  }

  function type(value: string) {
    act(() => {
      textarea().value = value;
      textarea().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function submitForm() {
    act(() => {
      root.querySelector("form.ask-form")!.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
    });
  }

  /** Ask once, with the endpoint scripted to fail as given. */
  async function failWith(body: ReturnType<typeof errorBody>, status: number, question = "why?") {
    mount();
    type(question);
    askQueue.push(async () => jsonResponse(body, status));
    submitForm();
    await settle();
  }

  function card(): HTMLElement {
    const el = root.querySelector<HTMLElement>(".ask-error");
    if (!el) throw new Error("no failure card rendered");
    return el;
  }

  function askCalls(): number {
    return fetchSpy.mock.calls.filter(([u]) => String(u) === ASK_ENDPOINT).length;
  }

  // ── Mode 1: no analysis ────────────────────────────────────────────

  describe("no analysis data", () => {
    const body = errorBody({
      error: "No sourcevision analysis found in this project.",
      category: "analysis-missing",
      suggestion: "Run `ndx analyze .` (or use the dashboard's Refresh action) and ask again.",
      retryable: false,
    });

    it("says analysis must run first, rather than 'request failed'", async () => {
      await failWith(body, 409);
      expect(card().dataset.askFailure).toBe("analysis-missing");
      expect(card().textContent).toContain("No analysis to ground an answer in");
      expect(card().textContent).toContain("No sourcevision analysis found");
    });

    it("offers the analyze action, not only the command name", async () => {
      await failWith(body, 409);
      const run = root.querySelector<HTMLButtonElement>("button.ask-run-analysis");
      expect(run).toBeTruthy();
      expect(run!.textContent).toContain("Run analysis");
    });

    it("starts a full analysis through the shared command endpoint", async () => {
      await failWith(body, 409);
      await act(async () => { root.querySelector<HTMLElement>("button.ask-run-analysis")!.click(); });
      await settle();

      const call = fetchSpy.mock.calls.find(([u]) => String(u) === ANALYZE_ENDPOINT)!;
      expect(call).toBeTruthy();
      expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ full: true });
    });

    it("reports the run as it goes rather than going quiet", async () => {
      await failWith(body, 409);
      await act(async () => { root.querySelector<HTMLElement>("button.ask-run-analysis")!.click(); });
      await settle();

      const status = root.querySelector(".ask-analyze-status")!;
      expect(status.getAttribute("aria-live")).toBe("polite");
      expect(status.textContent).toContain("Analysis running");
      expect(root.querySelector<HTMLButtonElement>("button.ask-run-analysis")!
        .getAttribute("aria-disabled")).toBe("true");
    });

    it("says so when the analysis will not even start", async () => {
      await failWith(body, 409);
      analyzeQueue.push(async () => jsonResponse({ error: "another analysis is running" }, 500));
      await act(async () => { root.querySelector<HTMLElement>("button.ask-run-analysis")!.click(); });
      await settle();

      const err = root.querySelector(".ask-analyze-error")!;
      expect(err.getAttribute("role")).toBe("alert");
      expect(err.textContent).toContain("another analysis is running");
    });

    it("offers no retry, because retrying cannot help until analysis exists", async () => {
      await failWith(body, 409);
      expect(root.querySelector("button.ask-retry")).toBeNull();
    });
  });

  // ── Mode 2: credentials ────────────────────────────────────────────

  describe("missing or invalid credentials", () => {
    /** Exactly what the endpoint sends: classifyLLMError's auth branch. */
    function authBody(vendor: string) {
      const guidance = authFailureGuidance(vendor);
      return errorBody({
        error: guidance.headline,
        category: "auth",
        suggestion: guidance.remediation.join("  "),
        retryable: false,
      });
    }

    it("names the mode and uses llm-client's headline verbatim", async () => {
      await failWith(authBody("claude"), 401);
      expect(card().dataset.askFailure).toBe("auth");
      expect(card().textContent).toContain("The provider rejected these credentials");
      expect(card().textContent).toContain(authFailureGuidance("claude").headline);
    });

    it("shows each remediation step from authFailureGuidance as its own step", async () => {
      await failWith(authBody("claude"), 401);
      const steps = [...root.querySelectorAll(".ask-error-steps li")].map((li) => li.textContent);
      expect(steps).toEqual(authFailureGuidance("claude").remediation);
      // Including the canonical verification step, unmodified.
      expect(steps).toContain(VERIFY_CREDENTIALS_STEP);
    });

    it("carries each vendor's own guidance rather than one hardcoded set", async () => {
      for (const vendor of ["claude", "codex", "google", "local"]) {
        render(null, root);
        askQueue.length = 0;
        await failWith(authBody(vendor), 401);
        const steps = [...root.querySelectorAll(".ask-error-steps li")].map((li) => li.textContent);
        expect(steps).toEqual(authFailureGuidance(vendor).remediation);
      }
    });

    it("offers no retry — the same credentials will fail again", async () => {
      await failWith(authBody("claude"), 401);
      expect(root.querySelector("button.ask-retry")).toBeNull();
    });
  });

  // ── Mode 3: the provider failed ────────────────────────────────────

  describe("LLM failure at request time", () => {
    it("names a timeout as a timeout and offers a retry", async () => {
      await failWith(errorBody({
        error: "The provider did not answer within 120000ms.",
        category: "timeout",
        suggestion: "Retry, or ask a narrower question.",
        retryable: true,
      }), 504);

      expect(card().dataset.askFailure).toBe("timeout");
      expect(card().textContent).toContain("The provider ran out of time");
      expect(root.querySelector("button.ask-retry")).toBeTruthy();
    });

    it("names a rate limit as a rate limit and offers a retry", async () => {
      await failWith(errorBody({
        error: "Rate limited — retry in 30s",
        category: "rate-limit",
        suggestion: "Wait a few minutes and try again",
        retryable: true,
      }), 429);

      expect(card().dataset.askFailure).toBe("rate-limit");
      expect(card().textContent).toContain("Rate limited by the provider");
      expect(root.querySelector("button.ask-retry")).toBeTruthy();
    });

    it("names a provider error as itself", async () => {
      await failWith(errorBody({
        error: "The provider returned 500.",
        category: "server",
        suggestion: "Check the provider's status page.",
        retryable: true,
      }), 502);

      expect(card().dataset.askFailure).toBe("server");
      expect(card().textContent).toContain("The provider returned an error");
    });

    it("retries the same question without the user retyping it", async () => {
      await failWith(errorBody({ category: "timeout", retryable: true }), 504, "the original question");
      expect(askCalls()).toBe(1);

      await act(async () => { root.querySelector<HTMLElement>("button.ask-retry")!.click(); });
      await settle();

      expect(askCalls()).toBe(2);
      const second = fetchSpy.mock.calls.filter(([u]) => String(u) === ASK_ENDPOINT)[1];
      expect(JSON.parse(String((second[1] as RequestInit).body)).prompt).toBe("the original question");
    });

    it("does not offer a retry where retrying cannot help", async () => {
      await failWith(errorBody({ category: "budget", retryable: false }), 429);
      expect(root.querySelector("button.ask-retry")).toBeNull();
    });
  });

  // ── The question survives ──────────────────────────────────────────

  describe("the prompt survives every failure", () => {
    const modes: Array<[AskFailureCategory, number]> = [
      ["analysis-missing", 409],
      ["auth", 401],
      ["timeout", 504],
      ["rate-limit", 429],
      ["server", 502],
      ["invalid-request", 400],
    ];

    for (const [category, status] of modes) {
      it(`keeps the question in the box after a ${category} failure`, async () => {
        await failWith(errorBody({ category }), status, "a question worth keeping");
        expect(textarea().value).toBe("a question worth keeping");
      });
    }

    it("keeps the question when the request never reaches the server", async () => {
      mount();
      type("a question worth keeping");
      askQueue.push(async () => { throw new Error("offline"); });
      submitForm();
      await settle();

      expect(card().dataset.askFailure).toBe("transport");
      expect(textarea().value).toBe("a question worth keeping");
    });
  });

  // ── No mode degrades to a bare string ──────────────────────────────

  describe("no degraded path renders a bare generic error", () => {
    const everyCategory: AskFailureCategory[] = [
      "analysis-missing", "analysis-error", "invalid-request", "auth", "rate-limit",
      "budget", "timeout", "network", "server", "parse", "unknown", "transport",
    ];

    it("gives every category a heading that names it", () => {
      const headings = everyCategory.map(askFailureHeading);
      for (const heading of headings) {
        expect(heading.trim().length).toBeGreaterThan(0);
        expect(heading.toLowerCase()).not.toBe("error");
        expect(heading.toLowerCase()).not.toContain("request failed");
      }
      // Every mode reads differently — a shared heading would be the same
      // failure to distinguish as no heading at all.
      expect(new Set(headings).size).toBe(headings.length);
    });

    it("renders a named heading and remediation for all three modes", async () => {
      for (const category of ["analysis-missing", "auth", "timeout"] as const) {
        render(null, root);
        askQueue.length = 0;
        await failWith(errorBody({ category, suggestion: "do the thing" }), 500);

        const heading = card().querySelector("h3")!.textContent ?? "";
        expect(heading).toContain(askFailureHeading(category));
        expect(card().textContent).toContain("do the thing");
        expect(card().textContent).not.toMatch(/^\s*(error|request failed)\s*$/i);
      }
    });

    it("names a mode even when the server sends an unrecognized category", () => {
      const failure = parseAskFailure({ error: "odd", category: "sideways" }, 500);
      expect(failure.category).toBe("unknown");
      expect(askFailureHeading(failure.category)).toContain("unrecognized reason");
    });

    it("falls back to a stated message when the body carries none", () => {
      const failure = parseAskFailure(null, 503);
      expect(failure.message).toContain("503");
      expect(failure.suggestion.trim().length).toBeGreaterThan(0);
    });
  });

  // ── Remediation splitting ──────────────────────────────────────────

  describe("askFailureSteps", () => {
    it("splits joined auth remediation back into llm-client's own steps", () => {
      const guidance = authFailureGuidance("codex");
      expect(askFailureSteps({
        category: "auth",
        message: guidance.headline,
        suggestion: guidance.remediation.join("  "),
        retryable: false,
      })).toEqual(guidance.remediation);
    });

    it("leaves a one-sentence suggestion whole", () => {
      expect(askFailureSteps({
        category: "timeout",
        message: "m",
        suggestion: "Retry, or ask a narrower question.  It may just be long.",
        retryable: true,
      })).toEqual(["Retry, or ask a narrower question.  It may just be long."]);
    });

    it("returns nothing when there is no suggestion to give", () => {
      expect(askFailureSteps({ category: "unknown", message: "m", suggestion: "", retryable: false }))
        .toEqual([]);
    });
  });
});
