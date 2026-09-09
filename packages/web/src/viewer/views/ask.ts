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
import { useCliName, useSvAnalyze } from "../hooks/index.js";
import { isDeployedMode } from "../deployed-mode.js";
import { clipboardFailureMessage, copyTextToClipboard } from "../utils/clipboard.js";
import { takePendingAskSeed, EXPLAIN_FINDING_PROMPT } from "../ask-seed.js";
import type { FindingSeed } from "../ask-seed.js";

/** Where the panel sends the prompt. */
const ASK_ENDPOINT = "/api/sourcevision/ask";

/** Where the panel files an answer as a PRD item. */
const CAPTURE_ENDPOINT = "/api/rex/capture-ask";

/** Where accepted PRD refinements are written, under the store lock. */
const APPLY_REFINEMENTS_ENDPOINT = "/api/rex/apply-refinements";

/** How long transient copy feedback stays on screen. */
const COPY_FEEDBACK_MS = 2000;

const PROMPT_INPUT_ID = "sv-ask-prompt";

/**
 * Heading per degraded mode.
 *
 * Each names the mode rather than the panel's disappointment: a user who reads
 * only the heading should already know whether to run an analysis, fix
 * credentials, or wait and try again.
 */
const ERROR_HEADING: Record<string, string> = {
  no_analysis: "No analysis to answer from",
  auth: "Credentials rejected",
  timeout: "The model timed out",
  rate_limit: "Rate limited",
  cli_not_found: "LLM CLI not found",
  provider_error: "The model call failed",
};

/**
 * A proposed change to one PRD item.
 *
 * Mirrors `RefinementProposal` in `server/ask-refinements.ts`; duplicated
 * because the viewer does not import from the server at runtime. `before` is
 * what the model was shown, and is checked against the item on disk when the
 * user accepts — a diff the reviewer can read, and a guard the applier can act
 * on.
 */
export interface RefinementProposal {
  id: string;
  kind: "description" | "acceptanceCriteria" | "priority" | "parent" | "merge";
  itemId: string;
  itemTitle: string;
  rationale: string;
  before: string[];
  after: string[];
}

/** Successful answer body from {@link ASK_ENDPOINT}. */
interface AskSuccessResponse {
  ok: true;
  answer: string;
  vendor: string;
  model: string;
  sources?: readonly string[];
  proposals?: RefinementProposal[];
}

/**
 * What went wrong and what to do about it.
 *
 * Mirrors `AskFailure` in `server/sourcevision-ask-diagnostics.ts`. Duplicated
 * rather than imported: the viewer is built separately and does not import from
 * the server at runtime, which is the boundary `boundary-check.test.ts` keeps.
 */
export interface AskFailureDetail {
  code: "no_analysis" | "auth" | "timeout" | "rate_limit" | "cli_not_found" | "provider_error";
  summary: string;
  remediation: string[];
  retryable: boolean;
}

/** Classified failure body — `reason` distinguishes auth from timeout etc. */
interface AskFailureResponse {
  ok: false;
  reason?: string;
  error?: string;
  failure?: AskFailureDetail;
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
      /** PRD changes the answer proposes. Empty unless the user asked for them. */
      proposals: RefinementProposal[];
    }
  /**
   * `failure` is what the panel renders; `message` is the one-line fallback for
   * a transport error that never reached the route and so has no diagnosis.
   */
  | { status: "error"; message: string; failure?: AskFailureDetail };

/** Transient outcome of a copy attempt, or `null` when there is nothing to say. */
type CopyFeedback =
  | { kind: "success" }
  | { kind: "error"; message: string }
  | null;

/**
 * A reviewer's verdict on one proposal.
 *
 * `pending` is the only state that can become a write. Rejecting is recorded
 * rather than just hiding the card, so the reviewer can see they have dealt
 * with every proposal before they apply anything.
 */
type ProposalVerdict = "pending" | "accepted" | "rejected";

/** The apply action's state, shared by the whole accepted batch. */
type ApplyState =
  | { status: "idle" }
  | { status: "applying" }
  | { status: "done"; applied: number; refused: { id: string; reason: string }[] }
  | { status: "error"; message: string };

/** Human label per proposal kind, used as the diff's heading. */
const PROPOSAL_KIND_LABEL: Record<RefinementProposal["kind"], string> = {
  description: "Description",
  acceptanceCriteria: "Acceptance criteria",
  priority: "Priority",
  parent: "Parent",
  merge: "Merge duplicate",
};

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
      proposals: Array.isArray(body.proposals) ? body.proposals : [],
    };
  }
  const failure = body as AskFailureResponse;
  return {
    status: "error",
    message: failure.error ?? "The request failed and the server did not say why.",
    ...(failure.failure ? { failure: failure.failure } : {}),
  };
}

/**
 * The last-resort failure, for a request that never reached the route.
 *
 * A rejected fetch has no server-side diagnosis, but it still has a cause worth
 * naming and an action worth offering — the server being down or the page being
 * offline is a retry-later situation, not an unexplained one. Without this the
 * transport path would be the one degraded mode that still rendered a bare
 * string.
 */
export function transportFailure(message: string): AskFailureDetail {
  return {
    code: "provider_error",
    summary: "The dashboard could not reach the n-dx server.",
    remediation: [
      `The request failed before it arrived: ${message}`,
      "Check that the server is still running, then ask again.",
    ],
    retryable: true,
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
  /** The finding this panel was opened to explain, if it was. */
  const [attachedFinding, setAttachedFinding] = useState<FindingSeed | null>(null);
  /** Whether the next question may propose PRD changes. */
  const [refinePrd, setRefinePrd] = useState(false);
  /** Per-proposal verdicts for the answer on screen. */
  const [verdicts, setVerdicts] = useState<Record<string, ProposalVerdict>>({});
  const [applyState, setApplyState] = useState<ApplyState>({ status: "idle" });
  const inFlightRef = useRef(false);
  const copyTimerRef = useRef<number | null>(null);
  const deployed = isDeployedMode();
  const cliName = useCliName();
  // The dashboard's one analyze action, shared with the enrichment gate.
  const analyze = useSvAnalyze();

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

  /**
   * Ask one question, optionally about a finding.
   *
   * Takes both explicitly rather than reading the textarea state, because the
   * seeded path submits in the same tick it sets them — reading state there
   * would send the values from before the seed arrived.
   */
  const submitQuestion = useCallback(async (
    question: string,
    finding: FindingSeed | null,
    wantsRefinements = false,
  ) => {
    // A blank prompt is a no-op, not an error: the user has not asked anything
    // yet, so there is nothing to report and nothing to spend a model call on.
    if (isBlankPrompt(question) || inFlightRef.current) return;

    const trimmed = question.trim();
    inFlightRef.current = true;
    setState({ status: "submitting" });
    // Both actions' feedback described the previous answer. Cleared here, at
    // the moment that makes it stale, rather than from an effect watching the
    // answer — an effect flushes on Preact's schedule and can land *after* a
    // click the user has already made, undoing it.
    showCopyFeedback(null);
    setCapture({ status: "idle" });
    // Verdicts belong to the answer that produced them; carrying them across
    // would let a click on the old answer's proposals write the new one's.
    setVerdicts({});
    setApplyState({ status: "idle" });
    try {
      const res = await fetch(ASK_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // The finding travels as named fields, not folded into the question:
        // the model reads the finding itself, and a test can assert its zone
        // and files arrived.
        body: JSON.stringify({
          prompt: trimmed,
          ...(finding ? { finding } : {}),
          ...(wantsRefinements ? { refinePrd: true } : {}),
        }),
      });
      const body = await res.json() as AskResponse;
      setState(stateForResponse(body, trimmed));
    } catch (err) {
      // A rejected fetch never reached the route, so the route's diagnosis is
      // not available — but the mode still gets named and offered a retry.
      const message = err instanceof Error ? err.message : "Failed to reach the Ask endpoint.";
      setState({ status: "error", message, failure: transportFailure(message) });
    } finally {
      inFlightRef.current = false;
    }
  }, [showCopyFeedback]);

  const handleSubmit = useCallback(
    () => submitQuestion(prompt, attachedFinding, refinePrd),
    [prompt, attachedFinding, refinePrd, submitQuestion],
  );

  /**
   * Write the accepted proposals.
   *
   * Only proposals the reviewer accepted are sent, and each carries the
   * `before` it was written against so the server can refuse one whose item has
   * moved on. Rejecting every proposal never reaches this: with nothing
   * accepted there is no request, so the tree is untouched.
   */
  const handleApplyRefinements = useCallback(async () => {
    if (state.status !== "answered") return;
    const accepted = state.proposals.filter((p) => verdicts[p.id] === "accepted");
    if (accepted.length === 0) return;

    setApplyState({ status: "applying" });
    try {
      const res = await fetch(APPLY_REFINEMENTS_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ proposals: accepted }),
      });
      const body = await res.json().catch(() => ({})) as {
        ok?: boolean;
        applied?: number;
        outcomes?: { id: string; applied: boolean; reason?: string }[];
        error?: string;
      };
      if (!res.ok || body.ok !== true) {
        // Includes the 409 a concurrent writer produces, whose message names
        // the process holding the lock.
        throw new Error(body.error ?? `The apply request failed (HTTP ${res.status}).`);
      }
      setApplyState({
        status: "done",
        applied: body.applied ?? 0,
        refused: (body.outcomes ?? [])
          .filter((o) => !o.applied)
          .map((o) => ({ id: o.id, reason: o.reason ?? "Refused." })),
      });
    } catch (err) {
      setApplyState({
        status: "error",
        message: err instanceof Error ? err.message : "Failed to apply the refinements.",
      });
    }
  }, [state, verdicts]);

  const setVerdict = useCallback((id: string, verdict: ProposalVerdict) => {
    setVerdicts((prev) => ({ ...prev, [id]: verdict }));
  }, []);

  /**
   * Pick up a finding left by Explain, and answer it without a second click.
   *
   * The user already said what they wanted by clicking Explain; making them
   * press Ask again would be asking twice. The question is still placed in the
   * textarea, editable, so a follow-up starts from it rather than from blank.
   *
   * The seed is taken even in the deployed export, where nothing can be asked:
   * taking clears it, and a seed left behind would attach itself to whatever
   * the user asked next in a later session.
   */
  useEffect(() => {
    const seed = takePendingAskSeed();
    if (!seed || deployed) return;
    setAttachedFinding(seed);
    setPrompt(EXPLAIN_FINDING_PROMPT);
    void submitQuestion(EXPLAIN_FINDING_PROMPT, seed);
  }, [deployed, submitQuestion]);

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

  const proposals = state.status === "answered" ? state.proposals : [];
  const acceptedCount = proposals.filter((p) => verdicts[p.id] === "accepted").length;
  const rejectedCount = proposals.filter((p) => verdicts[p.id] === "rejected").length;

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

    // What is being explained, shown rather than implied: the answer below
    // will talk about a zone and some files, and the user needs to be able to
    // see which finding sent them here — especially after editing the question.
    attachedFinding
      ? h("div", { class: "card ask-finding" },
          h("h3", { class: "section-header-sm" }, "Explaining a finding"),
          h("p", { class: "ask-finding-text" }, attachedFinding.message),
          h("ul", { class: "ask-finding-fields" },
            h("li", null, h("span", { class: "ask-finding-key" }, "Type: "), attachedFinding.type),
            attachedFinding.severity
              ? h("li", null,
                  h("span", { class: "ask-finding-key" }, "Severity: "),
                  attachedFinding.severity,
                )
              : null,
            h("li", null, h("span", { class: "ask-finding-key" }, "Zone: "), attachedFinding.zone),
            h("li", null,
              h("span", { class: "ask-finding-key" }, "Files: "),
              attachedFinding.files.length > 0
                ? attachedFinding.files.join(", ")
                : "none recorded",
            ),
          ),
          h("button", {
            type: "button",
            class: "btn ask-finding-detach-btn",
            onClick: () => setAttachedFinding(null),
            title: "Ask about the project generally instead of this finding",
          }, "Detach finding"),
        )
      : null,

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

        // Opt-in: an ordinary question should not come back with PRD rewrites
        // the user then has to read and reject.
        h("label", { class: "ask-refine-toggle" },
          h("input", {
            type: "checkbox",
            class: "ask-refine-checkbox",
            checked: refinePrd,
            onChange: (e: Event) => setRefinePrd((e.currentTarget as HTMLInputElement).checked),
          }),
          " Propose PRD changes",
        ),
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

    // Proposed PRD changes, one reviewable card each. Nothing here writes: the
    // verdicts are local until Apply sends the accepted ones, so a reviewer who
    // rejects everything leaves the tree exactly as it was.
    state.status === "answered" && state.proposals.length > 0
      ? h("div", { class: "card ask-proposals" },
          h("h3", { class: "section-header-sm" },
            `Proposed PRD changes (${state.proposals.length})`,
          ),
          h("p", { class: "section-sub" },
            "Each is reviewed on its own. Nothing is written until you apply what you accepted.",
          ),

          ...state.proposals.map((proposal) => {
            const verdict = verdicts[proposal.id] ?? "pending";
            return h("div", {
              key: proposal.id,
              class: `ask-proposal ask-proposal-${verdict}`,
            },
              h("div", { class: "ask-proposal-head" },
                h("span", { class: "ask-proposal-kind" }, PROPOSAL_KIND_LABEL[proposal.kind]),
                h("span", { class: "ask-proposal-item" }, proposal.itemTitle),
              ),
              proposal.rationale
                ? h("p", { class: "ask-proposal-rationale" }, proposal.rationale)
                : null,

              // Before and after, both shown: an edit that replaces text the
              // user cannot see is the thing this review exists to prevent.
              h("div", { class: "ask-proposal-diff" },
                h("div", { class: "ask-diff-side ask-diff-before" },
                  h("span", { class: "ask-diff-label" }, "Before"),
                  proposal.before.length > 0
                    ? proposal.before.map((line, i) =>
                        h("p", { key: i, class: "ask-diff-line" }, `− ${line}`))
                    : h("p", { class: "ask-diff-line ask-diff-empty" }, "(empty)"),
                ),
                h("div", { class: "ask-diff-side ask-diff-after" },
                  h("span", { class: "ask-diff-label" }, "After"),
                  proposal.after.length > 0
                    ? proposal.after.map((line, i) =>
                        h("p", { key: i, class: "ask-diff-line" }, `+ ${line}`))
                    : h("p", { class: "ask-diff-line ask-diff-empty" }, "(empty)"),
                ),
              ),

              h("div", { class: "ask-proposal-actions" },
                h("button", {
                  type: "button",
                  class: "btn ask-proposal-accept",
                  "aria-pressed": String(verdict === "accepted"),
                  "aria-label": `Accept: ${PROPOSAL_KIND_LABEL[proposal.kind]} of ${proposal.itemTitle}`,
                  onClick: () => setVerdict(proposal.id, verdict === "accepted" ? "pending" : "accepted"),
                }, verdict === "accepted" ? "✓ Accepted" : "Accept"),
                h("button", {
                  type: "button",
                  class: "btn ask-proposal-reject",
                  "aria-pressed": String(verdict === "rejected"),
                  "aria-label": `Reject: ${PROPOSAL_KIND_LABEL[proposal.kind]} of ${proposal.itemTitle}`,
                  onClick: () => setVerdict(proposal.id, verdict === "rejected" ? "pending" : "rejected"),
                }, verdict === "rejected" ? "✗ Rejected" : "Reject"),
              ),
            );
          }),

          h("div", { class: "ask-proposals-apply" },
            h("button", {
              type: "button",
              class: "btn ask-apply-btn",
              // Nothing accepted means nothing to write — not an empty write.
              "aria-disabled": String(acceptedCount === 0 || applyState.status === "applying"),
              onClick: () => { void handleApplyRefinements(); },
            }, applyState.status === "applying"
              ? "Applying…"
              : `Apply ${acceptedCount} accepted change${acceptedCount === 1 ? "" : "s"}`),
            h("span", { class: "section-sub" },
              `${acceptedCount} accepted · ${rejectedCount} rejected · ${state.proposals.length - acceptedCount - rejectedCount} undecided`,
            ),
          ),

          applyState.status === "done"
            ? h("div", { class: "ask-apply-result", role: "status", "aria-live": "polite" },
                h("p", null, `✓ Applied ${applyState.applied} change${applyState.applied === 1 ? "" : "s"} to the PRD.`),
                applyState.refused.length > 0
                  ? h("ul", { class: "ask-apply-refused" },
                      applyState.refused.map((r) => h("li", { key: r.id }, `⚠ ${r.reason}`)),
                    )
                  : null,
              )
            : null,
          applyState.status === "error"
            ? h("p", { class: "ask-apply-error", role: "alert" }, `⚠ ${applyState.message}`)
            : null,
        )
      : null,

    // Every degraded mode names itself and offers the action that fits it: run
    // an analysis, fix credentials, or try again. The prompt is untouched
    // throughout — a failure must never cost the user their question.
    state.status === "error"
      ? h("div", { class: `card ask-error ask-error-${state.failure?.code ?? "unknown"}` },
          h("h3", { class: "section-header-sm" },
            `⚠ ${state.failure ? ERROR_HEADING[state.failure.code] : "Unable to answer"}`,
          ),
          h("p", { class: "ask-error-summary" }, state.failure?.summary ?? state.message),

          state.failure && state.failure.remediation.length > 0
            ? h("ul", { class: "ask-error-remediation" },
                state.failure.remediation.map((line, i) =>
                  h("li", { key: i }, line),
                ),
              )
            : null,

          h("div", { class: "ask-error-actions" },
            // Retry only where retrying could plausibly work. Offering it for
            // bad credentials would invite the user to click until they gave up.
            state.failure?.retryable
              ? h("button", {
                  type: "button",
                  class: "btn ask-retry-btn",
                  onClick: () => { void handleSubmit(); },
                }, "Ask again")
              : null,

            // The analyze affordance the criterion asks for: the same action
            // the enrichment gate offers, not a printed command.
            state.failure?.code === "no_analysis"
              ? h("button", {
                  type: "button",
                  class: "btn ask-analyze-btn",
                  disabled: analyze.busy,
                  "aria-busy": analyze.busy ? "true" : "false",
                  onClick: () => { void analyze.start({ full: false }); },
                }, analyze.busy ? "Analyzing…" : "Run analysis")
              : null,
          ),

          state.failure?.code === "no_analysis"
            ? h("p", { class: "section-sub ask-analyze-status", role: "status", "aria-live": "polite" },
                analyze.busy
                  ? analyze.progress ?? "Analysis running — this can take a few minutes…"
                  : analyze.state === "done"
                    ? "✓ Analysis complete — ask again."
                    : analyze.error
                      ? `⚠ Analysis failed to start: ${analyze.error}`
                      : "",
              )
            : null,
        )
      : null,
  );
}
