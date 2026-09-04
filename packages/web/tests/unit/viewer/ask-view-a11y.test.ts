// @vitest-environment jsdom
/**
 * Accessibility tests for the SourceVision Ask panel (WCAG 2.1 §1.3.1, §1.4.1,
 * §2.1.1, §2.4.3, §4.1.3).
 *
 * The Ask panel has one requirement its sibling SourceVision subviews do not:
 * the answer arrives after an indeterminate delay. Everything here follows
 * from that, and each assertion pins a failure mode that is invisible to a
 * typecheck and easy to reintroduce:
 *
 *  - The live region must be the *same element* before and after the answer
 *    arrives. A region inserted alongside its content is not reliably
 *    announced, so `toBe` on the node identity is the assertion that matters —
 *    an equal-looking replacement would pass a `not.toBeNull()` check and fail
 *    a screen reader.
 *  - Nothing may be `disabled` while the request is in flight. Disabling the
 *    focused element moves focus to `<body>`, which is how a keyboard user
 *    loses their place mid-wait; the tests therefore assert on
 *    `document.activeElement` across the whole submit cycle, not on attributes.
 *  - Success and failure must differ by more than hue.
 *
 * Runs entirely in jsdom against a stubbed `fetch`: no live server, no vendor
 * call, no credential.
 *
 * @see ../../../src/viewer/views/ask.ts — the "Accessibility" section of the
 *   module docblock records why each choice is the way it is.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { h, render } from "preact";
import { act } from "preact/test-utils";
import {
  AskView,
  ASK_ENDPOINT,
  ASK_CAPTURE_ENDPOINT,
  askAnnouncement,
  FEEDBACK_MARK_OK,
  FEEDBACK_MARK_FAIL,
  type AskState,
} from "../../../src/viewer/views/ask.js";
import { clearProjectMetadataCache } from "../../../src/viewer/hooks/use-project-metadata.js";

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AskView a11y", () => {
  let root: HTMLDivElement;
  let askResponse: () => Promise<Response>;
  let captureResponse: () => Promise<Response>;
  let clipboardWriteText: ReturnType<typeof vi.fn>;

  /** Let the mounted effects and the fetch promise chain settle. */
  async function settle(): Promise<void> {
    await act(async () => {
      await Promise.resolve();
      await new Promise<void>((r) => setTimeout(r, 0));
      await new Promise<void>((r) => setTimeout(r, 0));
    });
  }

  function mount(): HTMLDivElement {
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

  /** The panel's single polite live region. */
  function announcer(): HTMLElement {
    const el = root.querySelector<HTMLElement>(".sv-ask-announcer");
    if (!el) throw new Error("live region not rendered");
    return el;
  }

  async function type(value: string): Promise<void> {
    const el = textarea();
    await act(async () => {
      el.value = value;
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  /** Submit the way the Enter key does — through the form, not the button. */
  async function submitForm(): Promise<void> {
    const form = root.querySelector<HTMLFormElement>("form.sv-ask-form");
    if (!form) throw new Error("form not rendered");
    await act(async () => {
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    await settle();
  }

  async function click(el: HTMLButtonElement): Promise<void> {
    await act(async () => { el.click(); });
    await settle();
  }

  /** Reach an answered panel showing `answer`. */
  async function askAndAnswer(answer = "web-viewer is the hub zone."): Promise<void> {
    mount();
    await settle();
    askResponse = async () => jsonResponse({ answer, vendor: "claude", model: "m" });
    await type("Which zones are most coupled?");
    await submitForm();
  }

  beforeEach(() => {
    clearProjectMetadataCache();
    delete window.__NDX_DEPLOYED__;
    askResponse = async () => jsonResponse({ answer: "unset", vendor: "claude", model: "m" });
    captureResponse = async () => jsonResponse({
      item: { id: "task-1", title: "Which zones are most coupled?" },
      parent: { id: "epic-1", title: "SourceVision Ask", created: false },
    });
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === ASK_ENDPOINT) return askResponse();
      if (url === ASK_CAPTURE_ENDPOINT) return captureResponse();
      if (url === "/api/project") {
        return jsonResponse({
          name: "n-dx", description: null, version: null, git: null,
          nameSource: "directory", cliName: "n-dx",
        });
      }
      return jsonResponse({}, 404);
    }));
    clipboardWriteText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: clipboardWriteText },
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    if (root) render(null, root);
    if (root?.parentNode) root.parentNode.removeChild(root);
    document.body.innerHTML = "";
    delete window.__NDX_DEPLOYED__;
    Object.defineProperty(navigator, "clipboard", {
      value: undefined,
      configurable: true,
      writable: true,
    });
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  // ── The prompt field and the submit control ──────────────────────

  it("gives the prompt textarea a programmatic label and a described-by hint", () => {
    mount();

    const label = root.querySelector<HTMLLabelElement>("label.sv-ask-label");
    expect(label?.getAttribute("for")).toBe(textarea().id);
    expect(textarea().id).toBeTruthy();
    expect(label?.textContent?.trim()).toBeTruthy();

    // The character budget is announced with the field rather than being left
    // as a visual-only note beside it.
    const describedBy = textarea().getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(root.querySelector(`#${describedBy}`)?.textContent).toContain("characters remaining");
  });

  it("keeps the prompt and submit control in the tab order", () => {
    mount();

    // A native textarea and a native submit button are keyboard-operable
    // without any handler of ours; the failure mode this pins is a later
    // change to a div, or a tabindex that removes them from the sequence.
    expect(textarea().getAttribute("tabindex")).toBeNull();
    expect(submitButton().tagName.toLowerCase()).toBe("button");
    expect(submitButton().type).toBe("submit");
    expect(submitButton().getAttribute("tabindex")).toBeNull();
    // An empty prompt disables the control natively, so `aria-disabled` must
    // be absent rather than a standing "false" contradicting it.
    expect(submitButton().disabled).toBe(true);
    expect(submitButton().getAttribute("aria-disabled")).toBeNull();
  });

  it("submits from the keyboard alone, with no pointer event involved", async () => {
    mount();
    await settle();
    askResponse = async () => jsonResponse({ answer: "Keyboard answer.", vendor: "claude", model: "m" });

    // Implicit form submission — what Enter in the textarea does.
    await type("Which zones are most coupled?");
    await submitForm();

    expect(root.querySelector(".sv-ask-answer-body")?.textContent).toBe("Keyboard answer.");
  });

  // ── Announcing arrival ───────────────────────────────────────────

  it("mounts one polite live region before there is anything to announce", () => {
    mount();

    const live = announcer();
    expect(live.getAttribute("role")).toBe("status");
    expect(live.getAttribute("aria-live")).toBe("polite");
    // Atomic: the region is re-read whole, so "Answer ready" is never spliced
    // into the middle of the previous announcement.
    expect(live.getAttribute("aria-atomic")).toBe("true");
    // Visually hidden — it duplicates text the sighted user can already see.
    expect(live.classList.contains("sr-only")).toBe(true);
    // Silent while idle: the panel renders in this state, so there is no
    // transition to report.
    expect(live.textContent).toBe("");
  });

  it("announces the loading state and then the answer through that same region", async () => {
    mount();
    await settle();
    const live = announcer();

    let release: (r: Response) => void = () => {};
    askResponse = () => new Promise<Response>((resolve) => { release = resolve; });

    await type("Which zones are most coupled?");
    await act(async () => {
      root.querySelector<HTMLFormElement>("form.sv-ask-form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    // The loading state is announced, not merely rendered.
    expect(announcer()).toBe(live);
    expect(live.textContent).toContain("composing an answer");

    await act(async () => {
      release(jsonResponse({ answer: "web-viewer is the hub zone.", vendor: "claude", model: "m" }));
      await settle();
    });

    // Node identity, deliberately: a region created in the same render as its
    // content is not reliably announced, so an equal-looking replacement is a
    // regression that `not.toBeNull()` would not catch.
    expect(announcer()).toBe(live);
    expect(live.textContent).toContain("Answer ready");
  });

  it("announces that the answer arrived without reading the answer out", async () => {
    await askAndAnswer("web-viewer is the hub zone and everything routes through it.");

    const announced = announcer().textContent ?? "";
    expect(announced).toContain("Answer ready");
    // The answer body can run to hundreds of words. Reading it into a live
    // region buries the one fact the waiting user needs and talks over
    // whatever they were on.
    expect(announced).not.toContain("web-viewer is the hub zone");
    // It says where to find it instead.
    expect(announced).toContain("Answer region");
  });

  it("reports the answer's length so the reader can decide when to go to it", () => {
    const answered = (answer: string): AskState => ({
      status: "answered", question: "q", answer, vendor: null, model: null, contextSources: [],
    });

    expect(askAnnouncement(answered("one two three"))).toContain("3 words");
    expect(askAnnouncement(answered("  spaced   out  words "))).toContain("3 words");
    expect(askAnnouncement(answered("solo"))).toContain("1 word");
    expect(askAnnouncement(answered("solo"))).not.toContain("1 words");
  });

  it("stays silent for idle and for error, which the alert already carries", async () => {
    expect(askAnnouncement({ status: "idle" })).toBe("");
    expect(askAnnouncement({
      status: "error",
      question: "q",
      failure: {
        kind: "rate_limit",
        message: "Vendor refused.",
        suggestion: null,
        remediation: [],
        retryAfterMs: null,
      },
    })).toBe("");

    // And in the rendered panel: the failure is announced exactly once, by the
    // error card's own alert role.
    mount();
    await settle();
    askResponse = async () => jsonResponse({ error: "Vendor refused.", kind: "rate_limit" }, 429);
    await type("A doomed question?");
    await submitForm();

    expect(root.querySelector(".sv-ask-error")?.getAttribute("role")).toBe("alert");
    expect(announcer().textContent).toBe("");
  });

  it("presents the answer as a labelled region rather than a live one", async () => {
    await askAndAnswer();

    const answer = root.querySelector<HTMLElement>(".sv-ask-answer")!;
    expect(answer.getAttribute("role")).toBe("region");

    // Labelled by its own heading, so it appears by name in a reader's region
    // list and can be jumped to on demand.
    const labelledBy = answer.getAttribute("aria-labelledby");
    expect(labelledBy).toBeTruthy();
    expect(root.querySelector(`#${labelledBy}`)?.textContent).toBe("Answer");

    // Not itself live: a live ancestor claims every descendant update, so the
    // whole answer plus its metadata, its buttons, and each later "Copied"
    // line would be re-read on any change inside the card.
    expect(answer.getAttribute("aria-live")).toBeNull();
    expect(answer.querySelector("[aria-live]")).not.toBe(answer);
  });

  // ── Focus is never stolen ────────────────────────────────────────

  it("leaves focus in the textarea across the whole submit cycle", async () => {
    mount();
    await settle();

    let release: (r: Response) => void = () => {};
    askResponse = () => new Promise<Response>((resolve) => { release = resolve; });

    const field = textarea();
    field.focus();
    await type("Which zones are most coupled?");
    expect(document.activeElement).toBe(field);

    await act(async () => {
      root.querySelector<HTMLFormElement>("form.sv-ask-form")!
        .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    // The regression this pins: `disabled: submitting` on the textarea. The
    // browser blurs a disabled element, so focus would be on <body> here and
    // the user's place in the panel would be gone.
    expect(document.activeElement).toBe(field);
    expect(field.readOnly).toBe(true);
    expect(field.disabled).toBe(false);
    expect(root.querySelector("form.sv-ask-form")?.getAttribute("aria-busy")).toBe("true");

    await act(async () => {
      release(jsonResponse({ answer: "Answered.", vendor: "claude", model: "m" }));
      await settle();
    });

    expect(document.activeElement).toBe(field);
    expect(field.readOnly).toBe(false);
    // The prompt is still there to edit and re-ask from.
    expect(field.value).toBe("Which zones are most coupled?");
  });

  it("leaves focus on the submit button when the request runs", async () => {
    mount();
    await settle();

    let release: (r: Response) => void = () => {};
    askResponse = () => new Promise<Response>((resolve) => { release = resolve; });

    await type("Which zones are most coupled?");
    const button = submitButton();
    button.focus();
    expect(document.activeElement).toBe(button);

    await click(button);

    // Same hazard from the other side: a keyboard user who tabbed to Ask and
    // pressed Enter must not be dropped to <body> by the button disabling
    // itself. It reports unavailable instead, and the handler refuses the
    // second request.
    expect(document.activeElement).toBe(button);
    expect(submitButton().disabled).toBe(false);
    expect(submitButton().getAttribute("aria-disabled")).toBe("true");

    await act(async () => {
      release(jsonResponse({ answer: "Answered.", vendor: "claude", model: "m" }));
      await settle();
    });
  });

  it("keeps the answer's controls after the prompt in the tab order", async () => {
    await askAndAnswer();

    const order = Array.from(root.querySelectorAll<HTMLElement>("textarea, button"))
      .filter((el) => el.className.includes("sv-ask-"))
      .filter((el) => !(el as HTMLButtonElement).disabled)
      .map((el) => el.className.split(/\s+/).find((c) => c.startsWith("sv-ask-")));

    // Answer actions follow the form rather than preceding it, so tabbing
    // forward from the prompt reaches Ask, then the actions on its answer.
    expect(order).toEqual([
      "sv-ask-textarea",
      "sv-ask-submit",
      "sv-ask-copy-btn",
      "sv-ask-capture-btn",
    ]);
  });

  // ── Answer actions are operable and their outcome is announced ───

  it("renders the answer actions as native buttons that cannot submit the form", async () => {
    await askAndAnswer();

    for (const selector of ["button.sv-ask-copy-btn", "button.sv-ask-capture-btn"]) {
      const button = root.querySelector<HTMLButtonElement>(selector);
      expect(button, selector).not.toBeNull();
      // type="button": these sit outside the form, but a later refactor that
      // moves them inside it must not turn Enter on Copy into a re-ask.
      expect(button!.type).toBe("button");
      expect(button!.disabled).toBe(false);
      expect(button!.getAttribute("tabindex")).toBeNull();
    }

    // The confirm pair, once armed, is keyboard-reachable on the same terms.
    await click(root.querySelector<HTMLButtonElement>("button.sv-ask-capture-btn")!);
    for (const selector of ["button.sv-ask-capture-confirm-btn", "button.sv-ask-capture-cancel-btn"]) {
      const button = root.querySelector<HTMLButtonElement>(selector);
      expect(button, selector).not.toBeNull();
      expect(button!.type).toBe("button");
      expect(button!.getAttribute("tabindex")).toBeNull();
    }
  });

  it("announces a copy result through a region that pre-exists it", async () => {
    await askAndAnswer();

    const line = root.querySelector<HTMLElement>(".sv-ask-copy-feedback")!.parentElement!;
    expect(line.getAttribute("role")).toBe("status");
    expect(line.getAttribute("aria-live")).toBe("polite");
    expect(root.querySelector(".sv-ask-copy-feedback")?.textContent).toBe("");

    await click(root.querySelector<HTMLButtonElement>("button.sv-ask-copy-btn")!);

    expect(root.querySelector<HTMLElement>(".sv-ask-copy-feedback")!.parentElement).toBe(line);
    expect(line.textContent).toContain("Copied answer to clipboard.");
  });

  it("announces a capture result through a region that pre-exists it", async () => {
    await askAndAnswer();

    const line = root.querySelector<HTMLElement>(".sv-ask-capture-feedback")!.parentElement!;
    expect(line.getAttribute("role")).toBe("status");
    expect(line.getAttribute("aria-live")).toBe("polite");

    await click(root.querySelector<HTMLButtonElement>("button.sv-ask-capture-btn")!);
    await click(root.querySelector<HTMLButtonElement>("button.sv-ask-capture-confirm-btn")!);

    expect(root.querySelector<HTMLElement>(".sv-ask-capture-feedback")!.parentElement).toBe(line);
    expect(line.textContent).toContain("Captured");
  });

  // ── Colour is not the only signal ────────────────────────────────

  it("marks a successful copy by shape as well as by colour", async () => {
    await askAndAnswer();
    await click(root.querySelector<HTMLButtonElement>("button.sv-ask-copy-btn")!);

    const line = root.querySelector<HTMLElement>(".sv-ask-copy-feedback")!.parentElement!;
    expect(line.classList.contains("sv-ask-feedback-success")).toBe(true);
    const mark = line.querySelector(".sv-ask-feedback-mark");
    expect(mark?.textContent).toBe(FEEDBACK_MARK_OK);
    // The message beside it already names the outcome, so the glyph would only
    // add noise to a reader.
    expect(mark?.getAttribute("aria-hidden")).toBe("true");
  });

  it("marks a failed copy by a different shape, not just a different colour", async () => {
    clipboardWriteText.mockRejectedValueOnce(new Error("clipboard is on fire"));

    await askAndAnswer();
    await click(root.querySelector<HTMLButtonElement>("button.sv-ask-copy-btn")!);

    const line = root.querySelector<HTMLElement>(".sv-ask-copy-feedback")!.parentElement!;
    expect(line.classList.contains("sv-ask-feedback-error")).toBe(true);
    expect(line.querySelector(".sv-ask-feedback-mark")?.textContent).toBe(FEEDBACK_MARK_FAIL);
    // Distinct from the success glyph — the whole point of the marker.
    expect(FEEDBACK_MARK_FAIL).not.toBe(FEEDBACK_MARK_OK);
  });

  it("names a capture failure in words as well as in red", async () => {
    captureResponse = async () => jsonResponse({ error: "PRD is locked by pid 4212" }, 409);

    await askAndAnswer();
    await click(root.querySelector<HTMLButtonElement>("button.sv-ask-capture-btn")!);
    await click(root.querySelector<HTMLButtonElement>("button.sv-ask-capture-confirm-btn")!);

    const line = root.querySelector<HTMLElement>("p[role='alert'].sv-ask-feedback-error")!;
    expect(line.querySelector(".sv-ask-feedback-mark")?.textContent).toBe(FEEDBACK_MARK_FAIL);
    // The reason is the server's and states a fact rather than a failure, so
    // the outcome is spelled out for a reader who gets no colour at all.
    expect(line.querySelector(".sr-only")?.textContent).toBe("Capture failed: ");
    expect(line.textContent).toContain("PRD is locked by pid 4212");
  });

  it("distinguishes the error card from the answer card by heading, not hue", async () => {
    await askAndAnswer();
    expect(root.querySelector(".sv-ask-answer .section-header-sm")?.textContent).toBe("Answer");

    askResponse = async () => jsonResponse({ error: "Vendor refused.", kind: "rate_limit" }, 429);
    await type("A doomed question?");
    await submitForm();

    // The heading names the mode rather than repeating one generic line, so a
    // reader who lands on it by heading navigation already knows which failure
    // this is and whether it is theirs to fix.
    const heading = root.querySelector(".sv-ask-error .section-header-sm")?.textContent ?? "";
    expect(heading).toMatch(/rate limit/i);
    expect(heading).not.toBe("Answer");
  });
});
