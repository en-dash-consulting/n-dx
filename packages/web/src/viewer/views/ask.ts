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
 * ## Deliberately not here yet
 *
 * Copy and Capture-to-PRD actions on the answer, per-failure-mode wording
 * beyond what the endpoint supplies, and seeding the prompt from a finding
 * are separate PRD tasks under the same feature. The shell is shaped so each
 * lands in one place: an action row under the answer, a message map over
 * `AskErrorKind`, and an initial-prompt prop respectively.
 *
 * Markdown in the answer is currently shown as-is in a pre-wrapped block.
 * The renderer that would format it lives in `pr-markdown.ts` behind
 * `pr-markdown-*` class names; lifting it out is a shared-module change that
 * belongs with the answer-actions task rather than with the shell.
 *
 * @module web/viewer/views/ask
 * @see ../../server/routes-sourcevision-ask.ts -- the endpoint this consumes
 */

import { h } from "preact";
import { useCallback, useRef, useState } from "preact/hooks";
import { BrandedHeader } from "../components/index.js";
import { useCliName } from "../hooks/index.js";
import { isDeployedMode } from "../deployed-mode.js";

// ---------------------------------------------------------------------------
// Endpoint contract
// ---------------------------------------------------------------------------

/** Path of the Ask endpoint. Exported so tests assert on the real string. */
export const ASK_ENDPOINT = "/api/sourcevision/ask";

/** Mirrors the server's `MAX_PROMPT_CHARS` so the textarea refuses first. */
export const ASK_MAX_PROMPT_CHARS = 4_000;

const PROMPT_FIELD_ID = "sv-ask-prompt";

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

  /**
   * Guards a second submit while one is in flight. `state.status` cannot do
   * this job on its own: the setState that moves the panel to `submitting`
   * has not been applied yet when a double click's second handler runs.
   */
  const inFlightRef = useRef(false);

  const submit = useCallback(async () => {
    if (inFlightRef.current) return;
    // The no-op case: an empty or whitespace-only prompt issues no request.
    if (!isSubmittablePrompt(prompt)) return;

    const question = prompt.trim();
    inFlightRef.current = true;
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
  }, [prompt]);

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
        )
      : null,
  );
}
