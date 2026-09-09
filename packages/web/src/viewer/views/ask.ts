/**
 * Ask panel — a prompt/response text exchange over the analysed project.
 *
 * The shell owns the prompt textarea, the submit control, and the four display
 * states below. It does not assemble context or call a model itself: that is
 * `POST /api/sourcevision/ask`, which grounds the answer in `.sourcevision/`
 * output and reports back the vendor and model that produced it.
 *
 * ## The four states are a union, not a set of booleans
 *
 * `idle`, `submitting`, `answered`, and `error` are mutually exclusive, and
 * modelling them as one discriminated union rather than three `useState` flags
 * makes that unrepresentable-by-construction. The sibling views here predate
 * that choice and carry a flag per concern (`pr-markdown.ts` holds fourteen),
 * which is why they each need a chain of `!loading && !error && …` guards to
 * decide what to render. A new panel does not have to inherit that.
 *
 * ## Answers render as preserved text, not markdown
 *
 * The model is asked for prose and it arrives as prose. Rendering it as
 * markdown needs a renderer the viewer does not yet share — `pr-markdown.ts`
 * has one, but it is private to that module and lifting it out is a refactor
 * of that view, not part of this shell. Until then the answer keeps its own
 * line breaks and nothing more, which is honest about what it is.
 *
 * ## The two answer actions
 *
 * Copy runs the shared clipboard workflow (`utils/clipboard.ts`), lifted out
 * of `pr-markdown.ts` when this panel needed the same execCommand fallback and
 * the same distinction between a permission denial and a generic failure.
 *
 * Capture-to-PRD is confirm-guarded, like the Overview Next Steps panel: the
 * click arms the action and a second click commits it, so no PRD write can
 * happen from one stray click. A failed capture leaves the answer exactly
 * where it was, still copyable, because the text is the thing the user would
 * otherwise lose.
 *
 * ## Announcing an answer that arrives whenever it arrives
 *
 * This panel has one accessibility requirement its sibling views do not: the
 * answer lands after an indeterminate delay, so it has to reach a screen reader
 * without the user losing their place. Two things follow, and neither is
 * optional.
 *
 * The announcement comes from a persistent pair of `sr-only` regions at the top
 * of the container, never from the state cards. A live region that mounts at
 * the same moment as its text is not reliably announced — the region has to
 * already be there when the text changes — so the cards are visual only and
 * {@link politeAnnouncement} / {@link assertiveAnnouncement} say what is heard.
 *
 * And nothing that has focus is ever disabled. Submitting used to disable both
 * the textarea and the button, which meant Ctrl+Enter — the documented submit
 * path — destroyed the focused element and dropped the user at `<body>`, right
 * before the thing they were waiting for appeared. The button reports itself
 * with `aria-disabled` instead, and the textarea stays live.
 *
 * @module web/viewer/views/ask
 * @see packages/web/src/server/routes-sourcevision-ask.ts — the endpoint
 * @see packages/web/src/viewer/utils/clipboard.ts — the shared copy workflow
 */

import { h } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { BrandedHeader } from "../components/index.js";
import { useCliName } from "../hooks/index.js";
import { isDeployedMode } from "../deployed-mode.js";
import { clipboardFailureMessage, copyTextToClipboard } from "../utils/clipboard.js";

/** Where the panel sends the prompt. */
const ASK_ENDPOINT = "/api/sourcevision/ask";

/** Where the panel files an answer as a PRD item. */
const CAPTURE_ENDPOINT = "/api/rex/capture-ask";

/** How long transient copy feedback stays on screen. */
const COPY_FEEDBACK_MS = 2000;

const PROMPT_INPUT_ID = "sv-ask-prompt";

/** Successful answer body from {@link ASK_ENDPOINT}. */
interface AskSuccessResponse {
  ok: true;
  answer: string;
  vendor: string;
  model: string;
  sources?: readonly string[];
}

/** Classified failure body — `reason` distinguishes auth from timeout etc. */
interface AskFailureResponse {
  ok: false;
  reason?: string;
  error?: string;
}

type AskResponse = AskSuccessResponse | AskFailureResponse;

/** Successful body from {@link CAPTURE_ENDPOINT}. */
interface CaptureSuccessResponse {
  ok: true;
  item: { id: string; title: string; level: string };
  parent: { id: string; title: string; level: string };
}

/** Failure body from {@link CAPTURE_ENDPOINT}. */
interface CaptureFailureResponse {
  ok?: false;
  error?: string;
}

type CaptureResponse = CaptureSuccessResponse | CaptureFailureResponse;

/**
 * The panel's display state.
 *
 * Exported so tests and future callers (the "explain this finding" entry point)
 * can name a state rather than infer it from rendered text.
 *
 * The `answered` state keeps the `question` that produced the answer, not the
 * current textarea contents: the user can edit the prompt while reading, and
 * capturing an answer under a question it did not answer would file a wrong
 * pairing into the PRD.
 */
export type AskState =
  | { status: "idle" }
  | { status: "submitting" }
  | {
      status: "answered";
      question: string;
      answer: string;
      vendor: string;
      model: string;
      sources: readonly string[];
    }
  | { status: "error"; message: string };

/** Transient outcome of a copy attempt, or `null` when there is nothing to say. */
type CopyFeedback =
  | { kind: "success" }
  | { kind: "error"; message: string }
  | null;

/** The capture action's own state — `confirm` is the guard before any write. */
type CaptureState =
  | { status: "idle" }
  | { status: "confirm" }
  | { status: "capturing" }
  | { status: "done"; message: string }
  | { status: "error"; message: string };

/** True when `prompt` has nothing a model could answer. */
export function isBlankPrompt(prompt: string): boolean {
  return prompt.trim() === "";
}

/**
 * Reduce an endpoint response to the next display state.
 *
 * A body that is neither a well-formed success nor a well-formed failure still
 * has to land somewhere the user can act on, so it becomes an `error` naming
 * that fact rather than an `answered` state holding `undefined`.
 */
export function stateForResponse(body: AskResponse, question: string): AskState {
  if (body.ok === true && typeof body.answer === "string") {
    return {
      status: "answered",
      question,
      answer: body.answer,
      vendor: body.vendor,
      model: body.model,
      sources: body.sources ?? [],
    };
  }
  const failure = body as AskFailureResponse;
  return {
    status: "error",
    message: failure.error ?? "The request failed and the server did not say why.",
  };
}

/**
 * Report where a captured answer landed.
 *
 * Names both the item and its parent: the epic is created on first capture, so
 * the user has no other way to learn where to look for it.
 */
export function captureResultMessage(body: CaptureSuccessResponse): string {
  return `✓ Captured "${body.item.title}" under ${body.parent.title}.`;
}

/**
 * What the polite live region should currently say.
 *
 * The answer arrives after an indeterminate delay, so a screen reader user has
 * to be told it arrived — and the region announcing it must already be in the
 * document when the text lands, which is why this feeds a persistent node
 * rather than the answer card itself. A card that mounts together with its own
 * `aria-live` is not reliably announced at all.
 *
 * Action feedback outranks the state: a copy or capture that just succeeded is
 * newer news than an answer the user has been reading.
 */
export function politeAnnouncement(
  state: AskState,
  copySucceeded: boolean,
  captureMessage: string | null,
): string {
  if (copySucceeded) return "Copied answer to clipboard.";
  if (captureMessage) return captureMessage;
  if (state.status === "submitting") return "Asking. Waiting on the model.";
  if (state.status === "answered") return `Answer received from ${state.vendor} ${state.model}.`;
  return "";
}

/**
 * What the assertive live region should currently say.
 *
 * Failures interrupt; successes wait their turn. The glyphs the visible nodes
 * carry are deliberately absent here — they are a substitute for colour, not
 * something to read aloud.
 */
export function assertiveAnnouncement(
  state: AskState,
  copyError: string | null,
  captureError: string | null,
): string {
  if (state.status === "error") return `Unable to answer: ${state.message}`;
  if (copyError) return copyError;
  if (captureError) return `Could not capture the answer: ${captureError}`;
  return "";
}

export function AskView() {
  const [prompt, setPrompt] = useState("");
  const [state, setState] = useState<AskState>({ status: "idle" });
  const [copyFeedback, setCopyFeedback] = useState<CopyFeedback>(null);
  const [capture, setCapture] = useState<CaptureState>({ status: "idle" });
  const inFlightRef = useRef(false);
  const copyTimerRef = useRef<number | null>(null);
  const deployed = isDeployedMode();
  const cliName = useCliName();

  /** Show copy feedback and take it away again, replacing any pending timer. */
  const showCopyFeedback = useCallback((next: CopyFeedback) => {
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
      copyTimerRef.current = null;
    }
    setCopyFeedback(next);
    if (next !== null) {
      copyTimerRef.current = window.setTimeout(() => {
        setCopyFeedback(null);
        copyTimerRef.current = null;
      }, COPY_FEEDBACK_MS);
    }
  }, []);

  useEffect(() => () => {
    if (copyTimerRef.current !== null) window.clearTimeout(copyTimerRef.current);
  }, []);

  const handleSubmit = useCallback(async () => {
    // A blank prompt is a no-op, not an error: the user has not asked anything
    // yet, so there is nothing to report and nothing to spend a model call on.
    if (isBlankPrompt(prompt) || inFlightRef.current) return;

    const question = prompt.trim();
    inFlightRef.current = true;
    setState({ status: "submitting" });
    // Both actions' feedback described the previous answer. Cleared here, at
    // the moment that makes it stale, rather than from an effect watching the
    // answer — an effect flushes on Preact's schedule and can land *after* a
    // click the user has already made, undoing it.
    showCopyFeedback(null);
    setCapture({ status: "idle" });
    try {
      const res = await fetch(ASK_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: question }),
      });
      const body = await res.json() as AskResponse;
      setState(stateForResponse(body, question));
    } catch (err) {
      // A rejected fetch never reached the route, so there is no classified
      // reason to report — only what the transport said.
      setState({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to reach the Ask endpoint.",
      });
    } finally {
      inFlightRef.current = false;
    }
  }, [prompt, showCopyFeedback]);

  const handleCopy = useCallback(async () => {
    if (state.status !== "answered") return;
    const result = await copyTextToClipboard(state.answer);
    showCopyFeedback(result.ok
      ? { kind: "success" }
      : { kind: "error", message: clipboardFailureMessage(result.kind, "answer") });
  }, [state, showCopyFeedback]);

  const handleCapture = useCallback(async () => {
    if (state.status !== "answered") return;
    setCapture({ status: "capturing" });
    try {
      const res = await fetch(CAPTURE_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: state.question, answer: state.answer }),
      });
      const body = await res.json().catch(() => ({})) as CaptureResponse;
      if (!res.ok || body.ok !== true) {
        const failure = body as CaptureFailureResponse;
        throw new Error(failure.error ?? `The capture request failed (HTTP ${res.status}).`);
      }
      setCapture({ status: "done", message: captureResultMessage(body) });
    } catch (err) {
      // The answer card stays exactly as it is, so a failed capture costs the
      // user nothing — they can retry, or copy the text and file it by hand.
      setCapture({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to capture the answer.",
      });
    }
  }, [state]);

  const submitting = state.status === "submitting";
  const submitUnavailable = submitting || isBlankPrompt(prompt);

  const copyError = copyFeedback?.kind === "error" ? copyFeedback.message : null;
  const politeMessage = politeAnnouncement(
    state,
    copyFeedback?.kind === "success",
    capture.status === "done" ? capture.message : null,
  );
  const assertiveMessage = assertiveAnnouncement(
    state,
    copyError,
    capture.status === "error" ? capture.message : null,
  );

  const header = h("div", { class: "view-header" },
    h(BrandedHeader, { product: "sourcevision", title: "SourceVision", class: "branded-header-sv" }),
    h("h2", { class: "section-header" }, "Ask"),
  );

  // The tab is hidden in a static export, but a direct URL still reaches this
  // view — say why it cannot work here instead of failing on first submit.
  if (deployed) {
    return h("div", { class: "ask-container" },
      header,
      h("div", { class: "card ask-unavailable", role: "status" },
        h("h3", { class: "section-header-sm" }, "Not available in the exported dashboard"),
        h("p", null,
          "Answering a question needs a live model call, which the n-dx server makes and a static export cannot. ",
          "Run ", h("code", null, `${cliName} start .`), " on the project and open this view there.",
        ),
      ),
    );
  }

  return h("div", { class: "ask-container" },
    // Mounted before there is anything to announce, and never unmounted — the
    // house idiom (see hench-runs.ts, prd-tree.ts). Polite carries progress and
    // the answer; assertive carries failures, which interrupt.
    h("div", { class: "sr-only", "aria-live": "polite", "aria-atomic": "true" }, politeMessage),
    h("div", { class: "sr-only", "aria-live": "assertive", "aria-atomic": "true" }, assertiveMessage),

    header,
    h("p", { class: "section-sub" },
      "Ask a question about this project. Answers are grounded in the existing ",
      h("code", null, ".sourcevision/"),
      " analysis — run an analysis first if it is stale.",
    ),

    h("div", { class: "card ask-form" },
      h("label", { class: "ask-prompt-label", for: PROMPT_INPUT_ID }, "Your question"),
      // Deliberately NOT disabled while a question is in flight. Ctrl+Enter
      // from here is the documented submit path, so disabling it would destroy
      // the focused element and drop the user at <body> — and there is nothing
      // to protect: handleSubmit snapshots the question, so an edit made during
      // the flight cannot change what was asked.
      h("textarea", {
        id: PROMPT_INPUT_ID,
        class: "ask-prompt-input",
        rows: 4,
        value: prompt,
        placeholder: "Which zones carry the most coupling, and why?",
        onInput: (e: Event) => setPrompt((e.currentTarget as HTMLTextAreaElement).value),
        onKeyDown: (e: KeyboardEvent) => {
          // Cmd/Ctrl+Enter submits — Enter alone stays a newline, because the
          // prompt is prose and multi-line questions are the norm.
          if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
            e.preventDefault();
            void handleSubmit();
          }
        },
      }),
      h("div", { class: "ask-form-actions" },
        // aria-disabled, not disabled: a disabled control loses focus and
        // leaves the tab order, so submitting by keyboard would strand the user
        // at <body> exactly when the answer they are waiting for arrives.
        // handleSubmit already no-ops on a blank prompt and on a second click
        // during a flight, so the control being clickable costs nothing.
        h("button", {
          type: "button",
          class: "btn ask-submit-btn",
          "aria-disabled": String(submitUnavailable),
          onClick: () => { void handleSubmit(); },
        }, submitting ? "Asking…" : "Ask"),
        h("span", { class: "section-sub ask-submit-hint" }, "⌘/Ctrl + Enter"),
      ),
    ),

    // None of the state cards is a live region: they mount at the same moment
    // as their text, which is the one shape a live region cannot announce
    // reliably. The persistent pair at the top of the container speaks for
    // them, and having both would read every answer twice.
    state.status === "idle"
      ? h("div", { class: "card ask-idle" },
          h("h3", { class: "section-header-sm" }, "No question asked yet"),
          h("p", null, "The answer appears here once you ask something."),
        )
      : null,

    state.status === "submitting"
      ? h("div", { class: "card ask-submitting" },
          h("h3", { class: "section-header-sm" }, "Asking…"),
          h("p", null, "Assembling analysis context and waiting on the model."),
        )
      : null,

    state.status === "answered"
      ? h("div", { class: "card ask-answered" },
          h("h3", { class: "section-header-sm" }, "Answer"),
          h("div", { class: "ask-answer" }, state.answer),
          h("p", { class: "section-sub ask-answer-meta" },
            `${state.vendor} / ${state.model}`,
            state.sources.length > 0 ? ` · grounded in ${state.sources.join(", ")}` : "",
          ),

          h("div", { class: "ask-answer-actions" },
            h("button", {
              type: "button",
              class: "btn ask-copy-btn",
              onClick: () => { void handleCopy(); },
              title: "Copy the answer text to the clipboard",
            }, copyFeedback?.kind === "success" ? "✓ Copied" : "Copy"),

            capture.status === "capturing"
              ? h("span", { class: "ask-capture-progress", "aria-busy": "true" }, "Capturing…")
              : capture.status === "confirm"
                ? h("span", { class: "ask-capture-confirm" },
                    "File this answer as a PRD item?",
                    h("button", {
                      type: "button",
                      class: "btn ask-capture-confirm-btn",
                      onClick: () => { void handleCapture(); },
                    }, "Confirm"),
                    h("button", {
                      type: "button",
                      class: "btn ask-capture-cancel-btn",
                      onClick: () => setCapture({ status: "idle" }),
                    }, "Cancel"),
                  )
                : h("button", {
                    type: "button",
                    class: "btn ask-capture-btn",
                    onClick: () => setCapture({ status: "confirm" }),
                    title: "File this answer as a PRD item so it can be worked on",
                  }, "Capture to PRD"),
          ),

          // Visible feedback only — the live regions above do the announcing.
          // The ✓ and ⚠ are what tells success from failure when green and red
          // are indistinguishable; the announcements omit them, because a
          // glyph read aloud is noise, not information.
          h("p", { class: "ask-copy-feedback" },
            copyFeedback?.kind === "success"
              ? "✓ Copied answer to clipboard."
              : capture.status === "done" ? capture.message : "",
          ),
          copyError !== null
            ? h("p", { class: "ask-copy-error" }, `⚠ ${copyError}`)
            : null,
          capture.status === "error"
            ? h("p", { class: "ask-capture-error" },
                `⚠ Could not capture the answer: ${capture.message}`,
              )
            : null,
        )
      : null,

    state.status === "error"
      ? h("div", { class: "card ask-error" },
          h("h3", { class: "section-header-sm" }, "⚠ Unable to answer"),
          h("p", null, state.message),
        )
      : null,
  );
}
