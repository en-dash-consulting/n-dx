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
 * @module web/viewer/views/ask
 * @see packages/web/src/server/routes-sourcevision-ask.ts — the endpoint
 */

import { h } from "preact";
import { useCallback, useRef, useState } from "preact/hooks";
import { BrandedHeader } from "../components/index.js";
import { useCliName } from "../hooks/index.js";
import { isDeployedMode } from "../deployed-mode.js";

/** Where the panel sends the prompt. */
const ASK_ENDPOINT = "/api/sourcevision/ask";

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

/**
 * The panel's display state.
 *
 * Exported so tests and future callers (the "explain this finding" entry point)
 * can name a state rather than infer it from rendered text.
 */
export type AskState =
  | { status: "idle" }
  | { status: "submitting" }
  | {
      status: "answered";
      answer: string;
      vendor: string;
      model: string;
      sources: readonly string[];
    }
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
export function stateForResponse(body: AskResponse): AskState {
  if (body.ok === true && typeof body.answer === "string") {
    return {
      status: "answered",
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

export function AskView() {
  const [prompt, setPrompt] = useState("");
  const [state, setState] = useState<AskState>({ status: "idle" });
  const inFlightRef = useRef(false);
  const deployed = isDeployedMode();
  const cliName = useCliName();

  const handleSubmit = useCallback(async () => {
    // A blank prompt is a no-op, not an error: the user has not asked anything
    // yet, so there is nothing to report and nothing to spend a model call on.
    if (isBlankPrompt(prompt) || inFlightRef.current) return;

    inFlightRef.current = true;
    setState({ status: "submitting" });
    try {
      const res = await fetch(ASK_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: prompt.trim() }),
      });
      const body = await res.json() as AskResponse;
      setState(stateForResponse(body));
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
  }, [prompt]);

  const submitting = state.status === "submitting";
  const submitDisabled = submitting || isBlankPrompt(prompt);

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
    header,
    h("p", { class: "section-sub" },
      "Ask a question about this project. Answers are grounded in the existing ",
      h("code", null, ".sourcevision/"),
      " analysis — run an analysis first if it is stale.",
    ),

    h("div", { class: "card ask-form" },
      h("label", { class: "ask-prompt-label", for: PROMPT_INPUT_ID }, "Your question"),
      h("textarea", {
        id: PROMPT_INPUT_ID,
        class: "ask-prompt-input",
        rows: 4,
        value: prompt,
        placeholder: "Which zones carry the most coupling, and why?",
        disabled: submitting,
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
        h("button", {
          type: "button",
          class: "btn ask-submit-btn",
          disabled: submitDisabled,
          onClick: () => { void handleSubmit(); },
        }, submitting ? "Asking…" : "Ask"),
        h("span", { class: "section-sub ask-submit-hint" }, "⌘/Ctrl + Enter"),
      ),
    ),

    state.status === "idle"
      ? h("div", { class: "card ask-idle", role: "status", "aria-live": "polite" },
          h("h3", { class: "section-header-sm" }, "No question asked yet"),
          h("p", null, "The answer appears here once you ask something."),
        )
      : null,

    state.status === "submitting"
      ? h("div", { class: "card ask-submitting", role: "status", "aria-live": "polite" },
          h("h3", { class: "section-header-sm" }, "Asking…"),
          h("p", null, "Assembling analysis context and waiting on the model."),
        )
      : null,

    state.status === "answered"
      ? h("div", { class: "card ask-answered", role: "status", "aria-live": "polite" },
          h("h3", { class: "section-header-sm" }, "Answer"),
          h("div", { class: "ask-answer" }, state.answer),
          h("p", { class: "section-sub ask-answer-meta" },
            `${state.vendor} / ${state.model}`,
            state.sources.length > 0 ? ` · grounded in ${state.sources.join(", ")}` : "",
          ),
        )
      : null,

    state.status === "error"
      ? h("div", { class: "card ask-error", role: "alert" },
          h("h3", { class: "section-header-sm" }, "Unable to answer"),
          h("p", null, state.message),
        )
      : null,
  );
}
