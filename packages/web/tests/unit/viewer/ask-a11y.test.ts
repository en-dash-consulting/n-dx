// @vitest-environment jsdom
/**
 * Ask panel accessibility.
 *
 * An async text exchange has one requirement the other SourceVision
 * subviews do not: the answer arrives after an indeterminate wait, so a
 * screen reader user has to be told it arrived without losing their place.
 * These tests pin that, plus the parts of the panel that are easy to
 * regress silently — the programmatic label, keyboard operability, focus
 * retention across the in-flight transition, and the fact that no state is
 * distinguished by colour alone.
 *
 * Everything runs against a mocked fetch in jsdom: no server, no provider.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import {
  AskView,
  ASK_ENDPOINT,
  ASK_CAPTURE_ENDPOINT,
  askAnnouncement,
} from "../../../src/viewer/views/ask.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";

const ANSWER_BODY = {
  answer: "The web package imports rex through `src/server/rex-gateway.ts`.",
  vendor: "claude",
  model: "claude-opus-5",
  tier: "deep",
  context: { sections: ["CONTEXT.md"], missing: [] },
  tokens: { input: 4000, output: 900 },
  durationMs: 2400,
};

const CAPTURE_BODY = {
  ok: true,
  item: { id: "task-1", title: "Why does web depend on rex?", level: "task" },
  parent: { id: "epic-1", title: "SourceVision Ask Captures", created: true },
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await new Promise<void>((r) => setTimeout(r, 0));
  });
}

describe("Ask panel accessibility", () => {
  let root: HTMLDivElement;
  let askQueue: Array<() => Promise<Response>>;
  let captureQueue: Array<() => Promise<Response>>;

  beforeEach(() => {
    root = document.createElement("div");
    document.body.appendChild(root);
    clearProjectMetadataCache();
    askQueue = [];
    captureQueue = [];
    vi.stubGlobal("fetch", vi.fn((url: unknown) => {
      const target = String(url);
      if (target === ASK_CAPTURE_ENDPOINT) {
        const scripted = captureQueue.shift();
        return scripted ? scripted() : Promise.resolve(jsonResponse(CAPTURE_BODY));
      }
      if (target !== ASK_ENDPOINT) return Promise.resolve(new Response("{}", { status: 404 }));
      const scripted = askQueue.shift();
      return scripted ? scripted() : Promise.resolve(jsonResponse(ANSWER_BODY));
    }));
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: vi.fn(async () => {}) },
      configurable: true,
    });
    (document as unknown as { execCommand: unknown }).execCommand = vi.fn(() => true);
  });

  afterEach(() => {
    render(null, root);
    root.remove();
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    delete (document as unknown as { execCommand?: unknown }).execCommand;
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

  function submitBtn(): HTMLButtonElement {
    return root.querySelector<HTMLButtonElement>("button.ask-submit")!;
  }

  /** The persistent polite region. */
  function liveRegion(): HTMLElement {
    const el = root.querySelector<HTMLElement>('[role="status"][aria-live="polite"]');
    if (!el) throw new Error("no persistent polite live region");
    return el;
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

  async function answered() {
    type("why does web depend on rex?");
    submitForm();
    await settle();
  }

  // ── Labelling ──────────────────────────────────────────────────────

  describe("labelling", () => {
    it("labels the textarea programmatically, not just visually", () => {
      mount();
      const label = root.querySelector<HTMLLabelElement>("label.ask-prompt-label")!;
      expect(label.getAttribute("for")).toBe("ask-prompt");
      expect(textarea().id).toBe("ask-prompt");
      expect(label.textContent?.trim()).toBeTruthy();
    });

    it("describes the textarea and the submit control with the same hint", () => {
      mount();
      const hintId = "ask-prompt-hint";
      expect(textarea().getAttribute("aria-describedby")).toBe(hintId);
      expect(submitBtn().getAttribute("aria-describedby")).toBe(hintId);
      expect(root.querySelector(`#${hintId}`)).toBeTruthy();
    });

    it("explains why submit is unavailable rather than only dimming it", () => {
      mount();
      expect(submitBtn().getAttribute("aria-disabled")).toBe("true");
      expect(root.querySelector("#ask-prompt-hint")!.textContent).toContain("Type a question");
    });
  });

  // ── Keyboard operability ───────────────────────────────────────────

  describe("keyboard operability", () => {
    it("keeps the textarea and submit control in the tab order", () => {
      mount();
      // Neither carries a negative tabindex nor the `disabled` attribute
      // that would remove it from sequential navigation.
      for (const el of [textarea(), submitBtn()]) {
        expect(el.hasAttribute("disabled")).toBe(false);
        expect(el.getAttribute("tabindex")).not.toBe("-1");
      }
    });

    it("submits from the keyboard alone, via the form", () => {
      mount();
      type("a question");
      // A native submit-type button in a form is activated by Enter/Space
      // without a mouse; the form's submit handler is what runs.
      expect(submitBtn().getAttribute("type")).toBe("submit");
      submitForm();
      expect(root.querySelector(".ask-state-submitting")).toBeTruthy();
    });

    it("keeps the submit control focusable while a question is in flight", async () => {
      mount();
      type("a question");
      let release!: () => void;
      askQueue.push(() => new Promise<Response>((res) => { release = () => res(jsonResponse(ANSWER_BODY)); }));

      submitForm();
      // aria-disabled, not disabled: a disabled control loses focus.
      expect(submitBtn().hasAttribute("disabled")).toBe(false);
      expect(submitBtn().getAttribute("aria-disabled")).toBe("true");

      release();
      await settle();
    });

    it("gives the response actions real buttons, not clickable divs", async () => {
      mount();
      await answered();
      const copy = root.querySelector("button.ask-copy")!;
      const capture = root.querySelector("button.ask-capture")!;
      expect(copy.tagName).toBe("BUTTON");
      expect(capture.tagName).toBe("BUTTON");
      // Not submit buttons: activating them must not re-post the question.
      expect(copy.getAttribute("type")).toBe("button");
      expect(capture.getAttribute("type")).toBe("button");
    });

    it("gives the confirm gate real buttons too", async () => {
      mount();
      await answered();
      act(() => { root.querySelector<HTMLElement>("button.ask-capture")!.click(); });
      for (const sel of ["button.ask-capture-confirm-btn", "button.ask-capture-cancel-btn"]) {
        const el = root.querySelector(sel)!;
        expect(el.tagName).toBe("BUTTON");
        expect(el.getAttribute("type")).toBe("button");
      }
    });
  });

  // ── Announcements ──────────────────────────────────────────────────

  describe("announcements", () => {
    it("renders the polite live region before anything happens", () => {
      mount();
      // The region must already be in the DOM and monitored; a live region
      // that arrives with its own content is not reliably announced.
      const region = liveRegion();
      expect(region.classList.contains("sr-only")).toBe(true);
      expect(region.getAttribute("aria-atomic")).toBe("true");
      expect(region.textContent).toBe("");
    });

    it("announces the loading state", () => {
      mount();
      type("a question");
      askQueue.push(() => new Promise<Response>(() => { /* never settles */ }));
      submitForm();
      expect(liveRegion().textContent).toContain("Asking");
    });

    it("announces that the answer arrived", async () => {
      mount();
      await answered();
      expect(liveRegion().textContent).toContain("Answer received");
    });

    it("keeps the same live region element across the transition", async () => {
      mount();
      const before = liveRegion();
      await answered();
      // Preact must reuse the node, or the announcement rides on an
      // insertion again and the whole point is lost.
      expect(liveRegion()).toBe(before);
    });

    it("announces a successful copy", async () => {
      mount();
      await answered();
      await act(async () => { root.querySelector<HTMLElement>("button.ask-copy")!.click(); });
      await settle();
      expect(liveRegion().textContent).toContain("copied");
    });

    it("announces capture progress and its result", async () => {
      mount();
      await answered();
      act(() => { root.querySelector<HTMLElement>("button.ask-capture")!.click(); });

      let release!: () => void;
      captureQueue.push(() => new Promise<Response>((res) => { release = () => res(jsonResponse(CAPTURE_BODY)); }));
      act(() => { root.querySelector<HTMLElement>("button.ask-capture-confirm-btn")!.click(); });
      expect(liveRegion().textContent).toContain("Capturing");

      release();
      await settle();
      expect(liveRegion().textContent).toContain("Captured as");
      expect(liveRegion().textContent).toContain("SourceVision Ask Captures");
    });

    it("routes failures through role=alert, which fires on insertion", async () => {
      mount();
      type("a question");
      askQueue.push(async () => jsonResponse({ error: "No analysis on disk." }, 409));
      submitForm();
      await settle();

      const alert = root.querySelector('.ask-error[role="alert"]')!;
      expect(alert).toBeTruthy();
      // Not also duplicated into the polite region — that would announce
      // the same failure twice.
      expect(liveRegion().textContent).toBe("");
    });

    it("does not leave a stale announcement standing after a new question", async () => {
      mount();
      await answered();
      expect(liveRegion().textContent).toContain("Answer received");

      type("second question");
      askQueue.push(() => new Promise<Response>(() => { /* never settles */ }));
      submitForm();
      expect(liveRegion().textContent).toContain("Asking");
    });
  });

  // ── Focus behaviour ────────────────────────────────────────────────

  describe("focus", () => {
    it("does not steal focus from the textarea while the user types", () => {
      mount();
      textarea().focus();
      type("a question being typed");
      expect(document.activeElement).toBe(textarea());
    });

    it("keeps focus in the textarea across submit and answer arrival", async () => {
      mount();
      type("a question");
      textarea().focus();
      expect(document.activeElement).toBe(textarea());

      submitForm();
      // The field goes read-only rather than disabled, so it keeps focus for
      // the length of the call.
      expect(document.activeElement).toBe(textarea());
      expect(textarea().readOnly).toBe(true);

      await settle();
      expect(document.activeElement).toBe(textarea());
      expect(textarea().readOnly).toBe(false);
    });

    it("does not move focus when the answer renders", async () => {
      mount();
      type("a question");
      submitBtn().focus();
      submitForm();
      await settle();

      expect(root.querySelector(".ask-answer")).toBeTruthy();
      expect(document.activeElement).toBe(submitBtn());
    });

    it("puts the answer and its actions after the form in DOM order", async () => {
      mount();
      await answered();
      const form = root.querySelector("form.ask-form")!;
      const answer = root.querySelector(".ask-answer")!;
      // Tab order follows DOM order here (no positive tabindex anywhere), so
      // reaching the answer's actions means passing the form first.
      expect(form.compareDocumentPosition(answer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(root.querySelector("[tabindex]:not([tabindex='0']):not([tabindex='-1'])")).toBeNull();
    });

    it("moves focus into the confirm gate, which replaces the trigger", async () => {
      mount();
      await answered();
      const capture = root.querySelector<HTMLButtonElement>("button.ask-capture")!;
      capture.focus();
      act(() => { capture.click(); });

      // Opening the gate unmounts the trigger. Following the interaction is
      // the only way focus does not end up on <body>; this is a response to
      // the user's own activation, not a steal.
      const confirm = root.querySelector<HTMLButtonElement>("button.ask-capture-confirm-btn")!;
      expect(confirm).toBeTruthy();
      expect(document.activeElement).toBe(confirm);
    });

    it("returns focus to the trigger when the gate is cancelled", async () => {
      mount();
      await answered();
      act(() => { root.querySelector<HTMLButtonElement>("button.ask-capture")!.click(); });
      act(() => { root.querySelector<HTMLButtonElement>("button.ask-capture-cancel-btn")!.click(); });

      expect(document.activeElement).toBe(root.querySelector("button.ask-capture"));
      expect(document.activeElement).not.toBe(document.body);
    });

    it("returns focus to the trigger after a capture completes", async () => {
      mount();
      await answered();
      act(() => { root.querySelector<HTMLButtonElement>("button.ask-capture")!.click(); });
      await act(async () => { root.querySelector<HTMLButtonElement>("button.ask-capture-confirm-btn")!.click(); });
      await settle();

      // The trigger stays mounted precisely so focus has somewhere to land.
      const trigger = root.querySelector<HTMLButtonElement>("button.ask-capture")!;
      expect(trigger).toBeTruthy();
      expect(document.activeElement).toBe(trigger);
      expect(trigger.getAttribute("aria-disabled")).toBe("true");
    });

    it("returns focus to the trigger after a capture fails", async () => {
      mount();
      await answered();
      captureQueue.push(async () => jsonResponse({ error: "locked" }, 409));
      act(() => { root.querySelector<HTMLButtonElement>("button.ask-capture")!.click(); });
      await act(async () => { root.querySelector<HTMLButtonElement>("button.ask-capture-confirm-btn")!.click(); });
      await settle();

      const trigger = root.querySelector<HTMLButtonElement>("button.ask-capture")!;
      expect(document.activeElement).toBe(trigger);
      expect(trigger.textContent).toContain("Retry capture");
    });

    it("does not reopen the gate for an answer already captured", async () => {
      mount();
      await answered();
      act(() => { root.querySelector<HTMLButtonElement>("button.ask-capture")!.click(); });
      await act(async () => { root.querySelector<HTMLButtonElement>("button.ask-capture-confirm-btn")!.click(); });
      await settle();

      // aria-disabled does not block activation, so the handler must.
      act(() => { root.querySelector<HTMLButtonElement>("button.ask-capture")!.click(); });
      expect(root.querySelector("button.ask-capture-confirm-btn")).toBeNull();
    });

    it("does not pull focus to the capture trigger when a new question resets it", async () => {
      mount();
      await answered();
      act(() => { root.querySelector<HTMLButtonElement>("button.ask-capture")!.click(); });
      expect(document.activeElement).toBe(root.querySelector("button.ask-capture-confirm-btn"));

      // A new question resets capture state while the user is in the
      // textarea; the focus-return must not fire and steal their place.
      textarea().focus();
      type("second question");
      askQueue.push(() => new Promise<Response>(() => { /* never settles */ }));
      submitForm();

      expect(document.activeElement).toBe(textarea());
    });
  });

  // ── Not colour alone ───────────────────────────────────────────────

  describe("state is not signalled by colour alone", () => {
    it("names the failure in text as well as red", async () => {
      mount();
      type("a question");
      askQueue.push(async () => jsonResponse({ error: "No analysis on disk." }, 409));
      submitForm();
      await settle();

      const card = root.querySelector(".ask-error")!;
      expect(card.textContent).toContain("Could not answer that");
      expect(card.querySelector(".ask-marker")).toBeTruthy();
    });

    it("marks a copy failure with a glyph, not only colour", async () => {
      mount();
      await answered();
      (navigator.clipboard.writeText as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("no"));
      (document as unknown as { execCommand: unknown }).execCommand = vi.fn(() => false);
      await act(async () => { root.querySelector<HTMLElement>("button.ask-copy")!.click(); });
      await settle();

      const error = root.querySelector(".ask-copy-error")!;
      expect(error.querySelector(".ask-marker")).toBeTruthy();
      expect(error.textContent).toContain("Failed to copy");
    });

    it("marks a capture failure with a glyph, not only colour", async () => {
      mount();
      await answered();
      captureQueue.push(async () => jsonResponse({ error: "locked" }, 409));
      act(() => { root.querySelector<HTMLElement>("button.ask-capture")!.click(); });
      await act(async () => { root.querySelector<HTMLElement>("button.ask-capture-confirm-btn")!.click(); });
      await settle();

      const error = root.querySelector(".ask-capture-error")!;
      expect(error.querySelector(".ask-marker")).toBeTruthy();
      expect(error.textContent).toContain("Could not capture");
    });

    it("distinguishes success by text too, and hides the decorative glyph from AT", async () => {
      mount();
      await answered();
      act(() => { root.querySelector<HTMLElement>("button.ask-capture")!.click(); });
      await act(async () => { root.querySelector<HTMLElement>("button.ask-capture-confirm-btn")!.click(); });
      await settle();

      expect(root.querySelector(".ask-capture-done")!.textContent).toContain("Captured as");
      // The glyphs are decoration; the words carry the meaning.
      for (const marker of root.querySelectorAll(".ask-marker")) {
        expect(marker.getAttribute("aria-hidden")).toBe("true");
      }
    });

    it("marks the in-flight state busy as well as showing a card", () => {
      mount();
      type("a question");
      askQueue.push(() => new Promise<Response>(() => { /* never settles */ }));
      submitForm();

      expect(root.querySelector('.ask-state-submitting[aria-busy="true"]')).toBeTruthy();
      expect(textarea().getAttribute("aria-busy")).toBe("true");
    });
  });
});

// ── The announcement text itself ─────────────────────────────────────

describe("askAnnouncement", () => {
  const base = { status: "idle" as const, copied: false, capture: "idle" as const, captureResult: null };

  it("says nothing at rest", () => {
    expect(askAnnouncement(base)).toBe("");
  });

  it("announces loading and arrival", () => {
    expect(askAnnouncement({ ...base, status: "submitting" })).toContain("Asking");
    expect(askAnnouncement({ ...base, status: "answered" })).toContain("Answer received");
  });

  it("says nothing for a failure — role=alert owns that", () => {
    expect(askAnnouncement({ ...base, status: "error" })).toBe("");
  });

  it("prefers the latest interaction over the answer's arrival", () => {
    const answered = { ...base, status: "answered" as const };
    expect(askAnnouncement({ ...answered, copied: true })).toContain("copied");
    expect(askAnnouncement({ ...answered, copied: true, capture: "capturing" })).toContain("Capturing");
    expect(askAnnouncement({
      ...answered,
      copied: true,
      capture: "done",
      captureResult: { itemTitle: "A task", parentTitle: "An epic", parentCreated: true },
    })).toBe("Captured as A task under An epic.");
  });

  it("falls back rather than announcing a done capture with no result", () => {
    expect(askAnnouncement({ ...base, status: "answered", capture: "done" })).toContain("Answer received");
  });
});
