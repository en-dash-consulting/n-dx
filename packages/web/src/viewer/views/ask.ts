/**
 * SourceVision Ask view -- a prompt/response text exchange over the analysed
 * project.
 *
 * This module is the panel shell: it owns the prompt textarea, the submit
 * control, and the four display states the exchange can be in. It does not
 * assemble context or talk to a model -- that is the server's job behind
 * `POST /api/sourcevision/ask`, which grounds every answer in the existing
 * `.sourcevision/` analysis.
 *
 * ## The four states
 *
 * `idle` | `submitting` | `answered` | `error`, held in one discriminated
 * union rather than the `loading`/`error`/`data` boolean triple the older
 * views use. Three booleans admit eight combinations for four legal states,
 * and the illegal ones ("submitting and answered") are exactly the renders
 * that look like a bug to the person waiting on an answer. A single state
 * value cannot express them.
 *
 * The panel holds one exchange at a time, so a new question replaces the
 * previous answer. Keeping a transcript is a product decision the feature has
 * not made; a single exchange is what the acceptance criteria describe, and
 * growing it into a list later is additive.
 *
 * ## Answer actions
 *
 * Two actions sit under an answer. **Copy** goes through
 * {@link copyTextToClipboard}, the copy path lifted out of `pr-markdown.ts`, so
 * both surfaces fall back to `execCommand` identically and word a permission
 * denial identically. **Capture to PRD** is confirm-guarded: the first press
 * only arms it, and nothing is written until Confirm — the same shape as the
 * Overview Next Steps panel, and for the same reason, since the action mutates
 * the PRD.
 *
 * Both kinds of feedback are transient and both are cleared when a new question
 * is submitted, so a "Copied" or "Captured" line can never be read as applying
 * to an answer it did not come from. Capture's window is much longer than
 * Copy's because its message names where the item landed, which the user needs
 * time to read; Copy's only confirms an action whose result is already on the
 * clipboard.
 *
 * ## Accessibility
 *
 * An async text exchange has one requirement the other SourceVision subviews
 * do not: the answer arrives after an indeterminate delay, so its arrival has
 * to be *announced* rather than merely rendered.
 *
 * Four decisions follow from that, and each is load-bearing:
 *
 * 1. **One persistent polite live region** ({@link askAnnouncement}), mounted
 *    on every render with empty text while idle. A region created in the same
 *    render as its content is not reliably announced, which is why the answer
 *    card cannot be the live region itself.
 * 2. **Arrival is announced, not content.** The region says an answer is
 *    ready and how long it is; the answer itself is a `role="region"` labelled
 *    by its heading, so the reader navigates to it when they choose. Piping
 *    hundreds of words through a live region buries the one fact the waiting
 *    user needs and talks over whatever they were reading.
 * 3. **Nothing is disabled while a request is in flight.** Disabling the
 *    element the user just activated moves focus to `<body>`, dropping a
 *    keyboard user back at the top of the document mid-wait. The textarea goes
 *    `readOnly` and the submit button carries `aria-disabled`; the real
 *    `disabled` attribute is reserved for the unsubmittable-prompt case, which
 *    can only be reached while focus is in the textarea.
 * 4. **State is never signalled by colour alone.** Every feedback line carries
 *    a shape marker ({@link FEEDBACK_MARK_OK} / {@link FEEDBACK_MARK_FAIL})
 *    alongside its colour, and a capture failure adds a screen-reader-only
 *    "Capture failed:" prefix because the reason itself comes from the server
 *    and may not read as a failure on its own.
 *
 * ## Deliberately not here yet
 *
 * Per-failure-mode wording beyond what the endpoint supplies, and seeding the
 * prompt from a finding, are separate PRD tasks under the same feature. The
 * shell is shaped so each lands in one place: a message map over
 * `AskErrorKind`, and an initial-prompt prop respectively.
 *
 * Markdown in the answer is currently shown as-is in a pre-wrapped block. The
 * renderer that would format it lives in `pr-markdown.ts` behind
 * `pr-markdown-*` class names; lifting it out is a separate shared-module
 * change, and unlike the clipboard path it has only one would-be second
 * consumer, so it stays where it is for now.
 *
 * @module web/viewer/views/ask
 * @see ../../server/routes-sourcevision-ask.ts -- the endpoint this consumes
 * @see ../../server/routes-rex-analysis.ts -- POST /api/rex/capture-ask
 */

import { h } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { BrandedHeader } from "../components/index.js";
import { useCliName } from "../hooks/index.js";
import { isDeployedMode } from "../deployed-mode.js";
import {
  clipboardFailureMessage,
  clipboardSuccessMessage,
  copyTextToClipboard,
  type ClipboardFailureReason,
} from "../utils/clipboard.js";

// ---------------------------------------------------------------------------
// Endpoint contract
// ---------------------------------------------------------------------------

/** Path of the Ask endpoint. Exported so tests assert on the real string. */
export const ASK_ENDPOINT = "/api/sourcevision/ask";

/**
 * Path of the capture endpoint. On the rex prefix, not the sourcevision one:
 * the request writes a PRD item, and the route that does that lives with the
 * other PRD writers so it shares their store resolution and cache refresh.
 */
export const ASK_CAPTURE_ENDPOINT = "/api/rex/capture-ask";

/** Mirrors the server's `MAX_PROMPT_CHARS` so the textarea refuses first. */
export const ASK_MAX_PROMPT_CHARS = 4_000;

const PROMPT_FIELD_ID = "sv-ask-prompt";

/** Labels the answer region, so a reader can find it by name. */
const ANSWER_HEADING_ID = "sv-ask-answer-heading";

/** Success marker. A shape, so colour is never the only success cue. */
export const FEEDBACK_MARK_OK = "✓";

/** Failure marker. A shape, so colour is never the only failure cue. */
export const FEEDBACK_MARK_FAIL = "⚠";

/** What the copy action's manual-copy guidance tells the user to select. */
const COPY_SUBJECT = "answer";

/** How long a "Copied" confirmation stays up. Matches the PR Markdown view. */
const COPY_FEEDBACK_MS = 2_000;

/**
 * How long a capture result stays up.
 *
 * Five times the copy window: this message names the item and the epic it
 * landed under, and a confirmation that disappears before it can be read is
 * indistinguishable from one that never appeared.
 */
const CAPTURE_FEEDBACK_MS = 10_000;

/** Success payload of `POST /api/sourcevision/ask`. */
interface AskSuccessPayload {
  answer: string;
  vendor?: string;
  model?: string;
  contextSources?: string[];
}

/** Failure payload of `POST /api/sourcevision/ask`. */
interface AskErrorPayload {
  error?: string;
  kind?: string;
  suggestion?: string;
}

/** Payload of `POST /api/rex/capture-ask`, success or failure. */
interface AskCapturePayload {
  item?: { id?: string; title?: string };
  parent?: { title?: string; created?: boolean };
  error?: string;
}

// ---------------------------------------------------------------------------
// Panel state
// ---------------------------------------------------------------------------

/** The answered/error variants carry the question they belong to. */
export type AskState =
  | { status: "idle" }
  | { status: "submitting"; question: string }
  | { status: "answered"; question: string; answer: string; vendor: string | null; model: string | null; contextSources: string[] }
  | { status: "error"; question: string; message: string; kind: string | null; suggestion: string | null };

/**
 * True when `prompt` is worth sending.
 *
 * Whitespace-only input is not a request: the endpoint would reject it as
 * `invalid_request` after a round trip, and the user would have paid a
 * network hop to be told they typed nothing.
 */
export function isSubmittablePrompt(prompt: string): boolean {
  const trimmed = prompt.trim();
  return trimmed.length > 0 && trimmed.length <= ASK_MAX_PROMPT_CHARS;
}

/**
 * What the panel's polite live region says for a given state.
 *
 * `answered` reports arrival and length rather than the answer, because a
 * live region reads its entire text: a 400-word answer announced in full
 * buries "it is here now" and talks over whatever the reader was on. The
 * length is what tells them whether to jump to the region straight away or
 * finish the sentence they were reading first.
 *
 * `idle` and `error` are deliberately silent. Idle is the state the panel
 * renders in, so there is no transition to announce; the error card is a
 * `role="alert"`, which announces itself, and repeating it here would read
 * the same failure twice.
 */
export function askAnnouncement(state: AskState): string {
  switch (state.status) {
    case "submitting":
      return "Reading the analysis and composing an answer.";
    case "answered": {
      const words = state.answer.trim().split(/\s+/).filter((word) => word.length > 0).length;
      return `Answer ready, ${words} ${words === 1 ? "word" : "words"}.`
        + " It is in the Answer region below the question.";
    }
    default:
      return "";
  }
}

/**
 * Where the copy action stands. `error` carries a reason so the message can
 * distinguish a blocked clipboard from a copy that simply did not work.
 */
type CopyState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; reason: ClipboardFailureReason };

/**
 * Where the capture action stands.
 *
 * `confirm` is the whole point of the type: the button that starts a capture
 * only moves the action into `confirm`, and no request is issued until the
 * separate Confirm control is pressed. A boolean "capturing" flag could not
 * express the armed-but-not-yet-written state that the acceptance criterion
 * requires.
 */
type CaptureState =
  | { status: "idle" }
  | { status: "confirm" }
  | { status: "capturing" }
  | { status: "done"; message: string }
  | { status: "error"; message: string };

/**
 * Describe a completed capture in terms of what was created and where.
 *
 * The parent is named because "Captured to PRD" leaves the user hunting for
 * the item; naming the epic tells them which branch of the tree to open, and
 * whether that epic is new tells them why they have not seen it before.
 */
export function describeCapture(payload: AskCapturePayload): string {
  const title = typeof payload.item?.title === "string" && payload.item.title.trim().length > 0
    ? payload.item.title.trim()
    : "the answer";
  const parent = typeof payload.parent?.title === "string" && payload.parent.title.trim().length > 0
    ? payload.parent.title.trim()
    : null;
  if (!parent) return `Captured "${title}" to the PRD.`;
  const suffix = payload.parent?.created === true ? " (new epic)" : "";
  return `Captured "${title}" under "${parent}"${suffix}.`;
}

/**
 * Read a failed response into user-facing wording.
 *
 * The endpoint names every failure it can (`kind`, `error`, `suggestion`), so
 * the shell reports what it was told rather than re-deriving it from the
 * status code. A body that is not the documented shape still yields a
 * message, because a proxy returning HTML on a 502 must not surface as an
 * empty error card.
 */
async function readErrorPayload(res: Response): Promise<{ message: string; kind: string | null; suggestion: string | null }> {
  let payload: AskErrorPayload | null = null;
  try {
    payload = await res.json() as AskErrorPayload;
  } catch {
    payload = null;
  }
  const message = typeof payload?.error === "string" && payload.error.trim().length > 0
    ? payload.error
    : `The Ask request failed (${res.status}).`;
  return {
    message,
    kind: typeof payload?.kind === "string" ? payload.kind : null,
    suggestion: typeof payload?.suggestion === "string" ? payload.suggestion : null,
  };
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

export function AskView() {
  const deployed = isDeployedMode();
  const cliName = useCliName();

  const [prompt, setPrompt] = useState("");
  const [state, setState] = useState<AskState>({ status: "idle" });
  const [copy, setCopy] = useState<CopyState>({ status: "idle" });
  const [capture, setCapture] = useState<CaptureState>({ status: "idle" });

  /**
   * Guards a second submit while one is in flight. `state.status` cannot do
   * this job on its own: the setState that moves the panel to `submitting`
   * has not been applied yet when a double click's second handler runs.
   */
  const inFlightRef = useRef(false);

  /** The same guard for capture — a double-pressed Confirm must write once. */
  const capturingRef = useRef(false);

  const copyTimerRef = useRef<number | null>(null);
  const captureTimerRef = useRef<number | null>(null);

  /** Show `next` and schedule it away, replacing any pending clear. */
  const showCopyFeedback = useCallback((next: CopyState) => {
    setCopy(next);
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    copyTimerRef.current = null;
    if (next.status !== "idle") {
      copyTimerRef.current = window.setTimeout(() => {
        setCopy({ status: "idle" });
        copyTimerRef.current = null;
      }, COPY_FEEDBACK_MS);
    }
  }, []);

  /**
   * Move the capture action to `next`, auto-clearing only its terminal stages.
   *
   * `confirm` and `capturing` are stages the user is inside and must not time
   * out from underneath them; `done` and `error` are results, and those do
   * clear themselves.
   */
  const setCaptureStage = useCallback((next: CaptureState) => {
    setCapture(next);
    if (captureTimerRef.current !== null) window.clearTimeout(captureTimerRef.current);
    captureTimerRef.current = null;
    if (next.status === "done" || next.status === "error") {
      captureTimerRef.current = window.setTimeout(() => {
        setCapture({ status: "idle" });
        captureTimerRef.current = null;
      }, CAPTURE_FEEDBACK_MS);
    }
  }, []);

  /**
   * Drop both actions back to idle and cancel their pending clears.
   *
   * Called when a question is submitted rather than from an effect keyed on
   * the answer: the reset must happen even when the request fails, and it must
   * be observable in the same render as the `submitting` state, so that no
   * intermediate frame can show the previous answer's "Copied" line.
   */
  const resetActions = useCallback(() => {
    showCopyFeedback({ status: "idle" });
    setCaptureStage({ status: "idle" });
  }, [showCopyFeedback, setCaptureStage]);

  // A timer that outlives the panel would set state on an unmounted component.
  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
    if (captureTimerRef.current !== null) window.clearTimeout(captureTimerRef.current);
  }, []);

  const submit = useCallback(async () => {
    if (inFlightRef.current) return;
    // The no-op case: an empty or whitespace-only prompt issues no request.
    if (!isSubmittablePrompt(prompt)) return;

    const question = prompt.trim();
    inFlightRef.current = true;
    resetActions();
    setState({ status: "submitting", question });

    try {
      const res = await fetch(ASK_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: question }),
      });

      if (!res.ok) {
        const failure = await readErrorPayload(res);
        setState({ status: "error", question, ...failure });
        return;
      }

      const payload = await res.json() as AskSuccessPayload;
      const answer = typeof payload.answer === "string" ? payload.answer : "";
      if (answer.trim().length === 0) {
        // A 200 with nothing in it is a failure the user can act on (ask
        // again, or check the vendor), not an answer to display as blank.
        setState({
          status: "error",
          question,
          message: "The model returned an empty answer.",
          kind: "llm_error",
          suggestion: "Try asking again, or rephrase the question.",
        });
        return;
      }

      setState({
        status: "answered",
        question,
        answer,
        vendor: typeof payload.vendor === "string" ? payload.vendor : null,
        model: typeof payload.model === "string" ? payload.model : null,
        contextSources: Array.isArray(payload.contextSources) ? payload.contextSources : [],
      });
    } catch (err) {
      setState({
        status: "error",
        question,
        message: err instanceof Error ? err.message : "The Ask request failed.",
        kind: "network",
        suggestion: null,
      });
    } finally {
      inFlightRef.current = false;
    }
  }, [prompt, resetActions]);

  const answerText = state.status === "answered" ? state.answer : null;

  const handleCopy = useCallback(async () => {
    if (answerText === null) return;
    const result = await copyTextToClipboard(answerText);
    showCopyFeedback(result.ok ? { status: "success" } : { status: "error", reason: result.reason });
  }, [answerText, showCopyFeedback]);

  const handleCapture = useCallback(async () => {
    if (state.status !== "answered") return;
    if (capturingRef.current) return;
    capturingRef.current = true;
    setCapture({ status: "capturing" });

    try {
      const res = await fetch(ASK_CAPTURE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: state.question, answer: state.answer }),
      });
      let payload: AskCapturePayload = {};
      try {
        payload = await res.json() as AskCapturePayload;
      } catch {
        payload = {};
      }
      if (!res.ok) {
        // The endpoint's own wording when it supplied any, the status code
        // otherwise -- a proxy returning HTML must still name what went wrong.
        const reason = typeof payload.error === "string" && payload.error.trim().length > 0
          ? payload.error
          : `The capture request failed (${res.status}).`;
        setCaptureStage({ status: "error", message: reason });
        return;
      }
      setCaptureStage({ status: "done", message: describeCapture(payload) });
    } catch (err) {
      setCaptureStage({
        status: "error",
        message: err instanceof Error ? err.message : "The capture request failed.",
      });
    } finally {
      capturingRef.current = false;
    }
  }, [state, setCaptureStage]);

  const header = h("div", { class: "view-header" },
    h(BrandedHeader, { product: "sourcevision", title: "SourceVision", class: "branded-header-sv" }),
    h("h2", { class: "section-header" }, "Ask"),
  );

  if (deployed) {
    return h("div", { class: "sv-ask-container" },
      header,
      h("p", { class: "section-sub" },
        "Ask a question about this project and get an answer grounded in the analysis.",
      ),
      h("div", { class: "card sv-ask-unavailable", role: "status" },
        h("h3", { class: "section-header-sm" }, "Not available in the exported dashboard"),
        h("p", null,
          "Answering a question calls a model from the n-dx server, which is not part of a static export. ",
          "Run ", h("code", null, `${cliName} start .`), " on the project and open this view there.",
        ),
      ),
    );
  }

  const submitting = state.status === "submitting";
  const tooLong = prompt.trim().length > ASK_MAX_PROMPT_CHARS;

  // The state modifier is namespaced `sv-ask-state-*` rather than `sv-ask-*`:
  // the latter collides with the `sv-ask-error` card class, which put the
  // error card's red border on the whole container and made a `.sv-ask-error`
  // query resolve to the container instead of the card.
  return h("div", { class: `sv-ask-container sv-ask-state-${state.status}` },
    header,
    h("p", { class: "section-sub" },
      "Answers come from this project's ",
      h("code", null, ".sourcevision"),
      " analysis. Run an analysis first for anything it does not yet cover.",
    ),

    // The panel's one live region, mounted on every render with empty text
    // while there is nothing to say. A region inserted alongside its content
    // is not reliably announced, so it cannot be created when the answer is.
    h("p", {
      class: "sr-only sv-ask-announcer",
      role: "status",
      "aria-live": "polite",
      "aria-atomic": "true",
    }, askAnnouncement(state)),

    h("form", {
      class: "card sv-ask-form",
      "aria-busy": submitting ? "true" : "false",
      onSubmit: (e: Event) => {
        e.preventDefault();
        void submit();
      },
    },
      h("label", { class: "sv-ask-label", for: PROMPT_FIELD_ID }, "Your question"),
      h("textarea", {
        id: PROMPT_FIELD_ID,
        class: "sv-ask-textarea",
        rows: 4,
        value: prompt,
        placeholder: "Which zones are most coupled, and what is driving it?",
        // `readOnly`, not `disabled`: disabling the field the user is typing
        // in moves focus to <body>, so pressing Enter to submit would cost a
        // keyboard user their place and their way back to the prompt. Read-only
        // still refuses edits while the answer is in flight.
        readOnly: submitting,
        "aria-describedby": "sv-ask-prompt-hint",
        onInput: (e: Event) => setPrompt((e.target as HTMLTextAreaElement).value),
      }),
      h("div", { class: "sv-ask-form-footer" },
        h("p", { class: "section-sub sv-ask-hint", id: "sv-ask-prompt-hint" },
          tooLong
            ? `That question is ${prompt.trim().length} characters; the limit is ${ASK_MAX_PROMPT_CHARS}.`
            : `${ASK_MAX_PROMPT_CHARS - prompt.trim().length} characters remaining.`,
        ),
        h("button", {
          type: "submit",
          class: "btn sv-ask-submit",
          // The real `disabled` attribute is reserved for a prompt that cannot
          // be sent — a state only reachable while focus is in the textarea,
          // so it can never take focus away from this button. While a request
          // is in flight the control stays focusable and merely reports itself
          // unavailable, because disabling the button a keyboard user just
          // pressed drops their focus to <body>. `submit()` refuses the second
          // request either way.
          //
          // Set only while submitting, never as a standing `"false"`: paired
          // with the native `disabled` above that would be a control claiming
          // to be both unavailable and available at once.
          disabled: !isSubmittablePrompt(prompt),
          "aria-disabled": submitting ? "true" : undefined,
        }, submitting ? "Asking..." : "Ask"),
      ),
    ),

    // No live semantics on either of the next two: the announcer above owns
    // every state transition. Marking these as regions too would announce the
    // same transition a second time.
    state.status === "idle"
      ? h("div", { class: "card sv-ask-idle" },
          h("h3", { class: "section-header-sm" }, "No question asked yet"),
          h("p", null, "Type a question above to get an answer grounded in the analysis."),
        )
      : null,

    submitting
      ? h("div", { class: "sv-ask-status" },
          h("p", { class: "loading" }, "Reading the analysis and composing an answer..."),
        )
      : null,

    state.status === "error"
      ? h("div", { class: "card sv-ask-error", role: "alert" },
          h("h3", { class: "section-header-sm" }, "Could not answer that question"),
          h("p", { class: "sv-ask-error-message" }, state.message),
          state.suggestion ? h("p", { class: "section-sub" }, state.suggestion) : null,
        )
      : null,

    state.status === "answered"
      // A labelled region rather than a live one: the announcer has already
      // said the answer arrived, and this is where the reader goes to read it
      // at their own pace. Making the card itself live would read the whole
      // answer -- plus its metadata, its buttons, and every later "Copied"
      // line, since a live ancestor claims all of its descendants' updates.
      ? h("div", {
          class: "card sv-ask-answer",
          role: "region",
          "aria-labelledby": ANSWER_HEADING_ID,
        },
          h("h3", { class: "section-header-sm", id: ANSWER_HEADING_ID }, "Answer"),
          h("p", { class: "section-sub sv-ask-question" }, state.question),
          h("div", { class: "sv-ask-answer-body" }, state.answer),
          state.model
            ? h("p", { class: "section-sub sv-ask-answer-meta" },
                `${state.vendor ?? "llm"} / ${state.model}`,
                state.contextSources.length > 0
                  ? ` · grounded in ${state.contextSources.join(", ")}`
                  : "",
              )
            : null,

          h("div", { class: "sv-ask-actions" },
            h("button", {
              type: "button",
              class: "btn sv-ask-copy-btn",
              onClick: () => { void handleCopy(); },
            }, copy.status === "success" ? "Copied" : "Copy answer"),

            capture.status === "idle" || capture.status === "done" || capture.status === "error"
              ? h("button", {
                  type: "button",
                  class: "btn sv-ask-capture-btn",
                  title: "File this answer as a PRD task so it can be worked on",
                  onClick: () => { setCaptureStage({ status: "confirm" }); },
                }, "Capture to PRD")
              : null,

            capture.status === "confirm"
              ? h("span", { class: "sv-ask-capture-confirm" },
                  h("span", { class: "sv-ask-capture-confirm-prompt" },
                    "File this answer as a PRD task?",
                  ),
                  h("button", {
                    type: "button",
                    class: "btn sv-ask-capture-confirm-btn",
                    onClick: () => { void handleCapture(); },
                  }, "Confirm"),
                  h("button", {
                    type: "button",
                    class: "btn sv-ask-capture-cancel-btn",
                    onClick: () => { setCaptureStage({ status: "idle" }); },
                  }, "Cancel"),
                )
              : null,

            capture.status === "capturing"
              ? h("span", { class: "sv-ask-capture-busy", "aria-busy": "true" }, "Capturing...")
              : null,
          ),

          // Both feedback lines are always mounted so their live regions exist
          // before the text arrives -- a region created in the same render as
          // its content is not reliably announced. The marker span carries the
          // outcome as a shape so colour is not the only signal; it is
          // aria-hidden because the message beside it already says which
          // outcome this is.
          h("p", {
            class: `sv-ask-feedback sv-ask-feedback-${copy.status}`,
            role: "status",
            "aria-live": "polite",
          },
            h("span", { class: "sv-ask-feedback-mark", "aria-hidden": "true" },
              copy.status === "success"
                ? FEEDBACK_MARK_OK
                : copy.status === "error" ? FEEDBACK_MARK_FAIL : "",
            ),
            h("span", { class: "section-sub sv-ask-copy-feedback" },
              copy.status === "success"
                ? clipboardSuccessMessage(COPY_SUBJECT)
                : copy.status === "error"
                  ? clipboardFailureMessage(copy.reason, COPY_SUBJECT)
                  : "",
            ),
          ),
          h("p", {
            class: `sv-ask-feedback sv-ask-feedback-${capture.status === "done" ? "success" : "idle"}`,
            role: "status",
            "aria-live": "polite",
          },
            h("span", { class: "sv-ask-feedback-mark", "aria-hidden": "true" },
              capture.status === "done" ? FEEDBACK_MARK_OK : "",
            ),
            h("span", { class: "section-sub sv-ask-capture-feedback" },
              capture.status === "done" ? capture.message : "",
            ),
          ),
          // A failed write is an alert, not a status: it needs the interruption
          // that a polite live region deliberately does not give it.
          //
          // The message is the server's, so it may not read as a failure on its
          // own -- "PRD is locked by pid 4212" states a fact. The marker says
          // so by shape and the screen-reader prefix says so in words, which is
          // what keeps the red from being the only thing carrying the outcome.
          capture.status === "error"
            ? h("p", { class: "sv-ask-feedback sv-ask-feedback-error", role: "alert" },
                h("span", { class: "sv-ask-feedback-mark", "aria-hidden": "true" }, FEEDBACK_MARK_FAIL),
                h("span", { class: "sr-only" }, "Capture failed: "),
                h("span", { class: "section-sub sv-ask-capture-error" }, capture.message),
              )
            : null,
        )
      : null,
  );
}
