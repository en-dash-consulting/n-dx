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
  const canSubmit = isSubmittablePrompt(prompt) && !submitting;
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

    h("form", {
      class: "card sv-ask-form",
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
        disabled: submitting,
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
          disabled: !canSubmit,
        }, submitting ? "Asking..." : "Ask"),
      ),
    ),

    state.status === "idle"
      ? h("div", { class: "card sv-ask-idle", role: "status", "aria-live": "polite" },
          h("h3", { class: "section-header-sm" }, "No question asked yet"),
          h("p", null, "Type a question above to get an answer grounded in the analysis."),
        )
      : null,

    submitting
      ? h("div", { class: "sv-ask-status", role: "status", "aria-live": "polite" },
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
      ? h("div", { class: "card sv-ask-answer", role: "status", "aria-live": "polite" },
          h("h3", { class: "section-header-sm" }, "Answer"),
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
          // its content is not reliably announced.
          h("p", {
            class: "section-sub sv-ask-copy-feedback",
            role: "status",
            "aria-live": "polite",
          },
            copy.status === "success"
              ? clipboardSuccessMessage(COPY_SUBJECT)
              : copy.status === "error"
                ? clipboardFailureMessage(copy.reason, COPY_SUBJECT)
                : "",
          ),
          h("p", {
            class: "section-sub sv-ask-capture-feedback",
            role: "status",
            "aria-live": "polite",
          },
            capture.status === "done" ? capture.message : "",
          ),
          // A failed write is an alert, not a status: it needs the interruption
          // that a polite live region deliberately does not give it.
          capture.status === "error"
            ? h("p", { class: "section-sub sv-ask-capture-error", role: "alert" }, capture.message)
            : null,
        )
      : null,
  );
}
