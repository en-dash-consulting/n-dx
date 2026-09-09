// @vitest-environment jsdom
/**
 * The Ask panel's three degraded modes.
 *
 * The task these tests come from exists to prevent one outcome: a bare
 * "request failed" for a situation that has a specific cause and a specific
 * fix. So each mode is checked for naming itself, saying what to do, and
 * offering the action that fits it — and every mode is checked for keeping the
 * user's question, because retyping it is the other way a failure costs them
 * something.
 *
 * @see packages/web/src/server/sourcevision-ask-diagnostics.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { AskView, transportFailure } from "../../../src/viewer/views/ask.js";
import type { AskFailureDetail } from "../../../src/viewer/views/ask.js";

/** Poll until an assertion passes or the timeout is reached. */
async function waitFor(fn: () => void, timeout = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try { fn(); return; } catch { await new Promise<void>((r) => setTimeout(r, 10)); }
  }
  fn();
}

const QUESTION = "Which zones carry the most coupling?";

/** The three modes the task names, as the route reports them. */
const MODES: Array<{
  label: string;
  status: number;
  body: { ok: false; reason: string; error: string; failure: AskFailureDetail };
  heading: RegExp;
  remediation: RegExp;
  retryable: boolean;
}> = [
  {
    label: "no analysis",
    status: 409,
    body: {
      ok: false,
      reason: "no-analysis",
      error: "This project has not been analyzed yet — no .sourcevision/CONTEXT.md.",
      failure: {
        code: "no_analysis",
        summary: "This project has not been analyzed yet, so there is nothing to ground an answer in.",
        remediation: ["Run an analysis: ndx analyze ."],
        retryable: false,
      },
    },
    heading: /no analysis/i,
    remediation: /ndx analyze/,
    retryable: false,
  },
  {
    label: "bad credentials",
    status: 401,
    body: {
      ok: false,
      reason: "auth",
      error: "LLM authentication failed: 401",
      failure: {
        code: "auth",
        summary: "Authentication failed for Claude — Invalid or expired credentials.",
        remediation: ["Re-authenticate: claude logout && claude login", "Verify credentials: ndx auth"],
        retryable: false,
      },
    },
    heading: /credentials/i,
    remediation: /ndx auth/,
    retryable: false,
  },
  {
    label: "rate limited",
    status: 429,
    body: {
      ok: false,
      reason: "rate-limit",
      error: "LLM rate limit reached: slow down",
      failure: {
        code: "rate_limit",
        summary: "claude is rate limiting this request.",
        remediation: ["Wait for the limit to reset, then ask again."],
        retryable: true,
      },
    },
    heading: /rate limited/i,
    remediation: /reset/,
    retryable: true,
  },
];

describe("AskView degraded modes", () => {
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

  /** Ask a question and settle on whatever the stubbed route returned. */
  async function askAndFail(mode: (typeof MODES)[number]) {
    fetchSpy.mockImplementation(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/sourcevision/ask") {
        return { ok: false, status: mode.status, json: async () => mode.body };
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    act(() => { render(h(AskView, null), root); });
    const input = root.querySelector<HTMLTextAreaElement>(".ask-prompt-input")!;
    act(() => {
      input.value = QUESTION;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => { root.querySelector<HTMLButtonElement>(".ask-submit-btn")!.click(); });
    await waitFor(() => expect(root.querySelector(".ask-error")).not.toBeNull());
  }

  function errorCard(): HTMLElement {
    return root.querySelector<HTMLElement>(".ask-error")!;
  }

  for (const mode of MODES) {
    describe(mode.label, () => {
      it("names the mode in the heading", async () => {
        await askAndFail(mode);

        expect(errorCard().querySelector("h3")?.textContent).toMatch(mode.heading);
      });

      it("says what to do about it", async () => {
        await askAndFail(mode);

        const remediation = errorCard().querySelector(".ask-error-remediation");
        expect(remediation).not.toBeNull();
        expect(remediation!.textContent).toMatch(mode.remediation);
        expect(remediation!.querySelectorAll("li").length).toBeGreaterThan(0);
      });

      it("is not a bare generic error", async () => {
        await askAndFail(mode);

        const text = errorCard().textContent ?? "";
        // The specific outcome this task exists to prevent.
        expect(text).not.toMatch(/^\W*(unable to answer|request failed)\W*$/i);
        expect(text.length).toBeGreaterThan(40);
        expect(errorCard().className).toContain(`ask-error-${mode.body.failure.code}`);
      });

      it(`${mode.retryable ? "offers" : "withholds"} a retry`, async () => {
        await askAndFail(mode);

        // Retrying bad credentials would invite clicking until the user gave up.
        expect(root.querySelector(".ask-retry-btn") !== null).toBe(mode.retryable);
      });

      it("keeps the question so it never has to be retyped", async () => {
        await askAndFail(mode);

        expect(root.querySelector<HTMLTextAreaElement>(".ask-prompt-input")!.value).toBe(QUESTION);
      });
    });
  }

  it("offers the analyze action, not just the command, when there is no analysis", async () => {
    const noAnalysis = MODES[0]!;
    await askAndFail(noAnalysis);

    const analyzeBtn = root.querySelector<HTMLButtonElement>(".ask-analyze-btn");
    expect(analyzeBtn).not.toBeNull();

    act(() => { analyzeBtn!.click(); });

    // The dashboard's existing analyze endpoint — the same one the enrichment
    // gate posts to — rather than a second way to start an analysis.
    await waitFor(() => {
      expect(fetchSpy.mock.calls.map(([url]) => String(url))).toContain("/api/commands/sv-analyze");
    });
  });

  it("offers no analyze action for a failure analysis cannot fix", async () => {
    await askAndFail(MODES[1]!);

    expect(root.querySelector(".ask-analyze-btn")).toBeNull();
  });

  it("retries the same question when asked again", async () => {
    await askAndFail(MODES[2]!);

    act(() => { root.querySelector<HTMLButtonElement>(".ask-retry-btn")!.click(); });

    await waitFor(() => {
      const asks = fetchSpy.mock.calls.filter(([url]) => String(url) === "/api/sourcevision/ask");
      expect(asks).toHaveLength(2);
      expect(JSON.parse(String((asks[1]![1] as RequestInit).body)).prompt).toBe(QUESTION);
    });
  });

  it("names the transport when the request never reached the server", async () => {
    fetchSpy.mockRejectedValue(new Error("connect ECONNREFUSED 127.0.0.1:3117"));

    act(() => { render(h(AskView, null), root); });
    const input = root.querySelector<HTMLTextAreaElement>(".ask-prompt-input")!;
    act(() => {
      input.value = QUESTION;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => { root.querySelector<HTMLButtonElement>(".ask-submit-btn")!.click(); });

    await waitFor(() => expect(root.querySelector(".ask-error")).not.toBeNull());
    // No server-side diagnosis exists for this one, so the panel supplies its
    // own rather than falling back to a bare line.
    expect(errorCard().textContent).toMatch(/could not reach the n-dx server/i);
    expect(errorCard().textContent).toContain("ECONNREFUSED");
    expect(root.querySelector(".ask-retry-btn")).not.toBeNull();
    expect(root.querySelector<HTMLTextAreaElement>(".ask-prompt-input")!.value).toBe(QUESTION);
  });
});

describe("transportFailure", () => {
  it("keeps what the transport said while naming the mode", () => {
    const failure = transportFailure("connect ECONNREFUSED 127.0.0.1:3117");

    expect(failure.summary).toMatch(/could not reach/i);
    expect(failure.remediation.join(" ")).toContain("ECONNREFUSED");
    expect(failure.retryable).toBe(true);
  });
});
