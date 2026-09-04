/**
 * How the Ask panel presents each way it can be unusable.
 *
 * The panel has several distinct degraded modes and they are not
 * interchangeable: "there is no analysis to answer from" is fixed by running
 * an analysis, "the provider rejected our credentials" is fixed outside the
 * dashboard, and "the request timed out" is fixed by asking again. A single
 * "request failed" card collapses all of them into one dead end, which is
 * exactly what this module exists to prevent.
 *
 * ## What lives here and what does not
 *
 * This module decides **naming, guidance, and which affordance to offer**. It
 * does not invent the *reason* — that comes from the endpoint, which classifies
 * the failure at the point where the vendor error is still typed
 * (`routes-sourcevision-ask.ts`). Credential wording in particular is never
 * authored here: it arrives as {@link AskFailure.remediation}, which the
 * endpoint fills from `@n-dx/llm-client`'s `authFailureGuidance`, ending in its
 * `VERIFY_CREDENTIALS_STEP`. The viewer cannot import the foundation tier —
 * it is a browser bundle — so re-typing that wording here would create a second
 * copy free to drift from the one every CLI surface shows.
 *
 * The per-kind text below is therefore the **floor**: what the panel says when
 * the endpoint said nothing, because something between the browser and the
 * server answered instead (a proxy's HTML 502, a dev-server 404). Those are
 * precisely the responses that used to render as a bare status code.
 *
 * ## Retry
 *
 * Retry is offered only where retrying is the actual fix. A timeout and a rate
 * limit are transient by definition, and a transport failure means the request
 * never reached a model at all. The rest are not: re-sending a question that a
 * provider rejected, or that no analysis can ground, spends tokens to reach the
 * same wall. Those modes get the affordance that *does* fix them — the analysis
 * run for `no_analysis`, and the prompt itself, which survives every failure.
 *
 * @module web/viewer/views/ask-failure
 * @see ../../server/routes-sourcevision-ask.ts — where `kind` is decided
 */

/** The named failure modes of `POST /api/sourcevision/ask`. */
export type AskFailureKind =
  | "invalid_request"
  | "no_analysis"
  | "no_prd"
  | "timeout"
  | "rate_limit"
  | "auth"
  | "network"
  | "llm_error";

/** What the panel learned about a failed exchange. */
export interface AskFailure {
  kind: AskFailureKind;
  /** The endpoint's own wording, when it supplied any. */
  message: string | null;
  /** The endpoint's one-line suggestion, when it supplied one. */
  suggestion: string | null;
  /**
   * Ordered remediation steps from the endpoint. For an auth failure these are
   * `authFailureGuidance(vendor).remediation` verbatim.
   */
  remediation: string[];
  /** Vendor-supplied retry delay, when a rate limit named one. */
  retryAfterMs: number | null;
}

/** Everything the error card renders, decided in one place. */
export interface AskFailurePresentation {
  kind: AskFailureKind;
  /** Names the mode as itself, so the heading alone identifies the fault. */
  title: string;
  /** Never empty: the endpoint's wording, or this module's floor for the kind. */
  message: string;
  /** Ordered, actionable. Never empty. */
  steps: string[];
  /** Whether to offer a Retry control for the question that failed. */
  canRetry: boolean;
  /** Whether to offer the analyze/refresh affordance. */
  needsAnalysis: boolean;
}

/** Every kind the endpoint can name. Exported so tests can enumerate them. */
export const ASK_FAILURE_KINDS: readonly AskFailureKind[] = [
  "invalid_request",
  "no_analysis",
  "no_prd",
  "timeout",
  "rate_limit",
  "auth",
  "network",
  "llm_error",
] as const;

interface KindPresentation {
  title: string;
  /** Used when the endpoint supplied no message of its own. */
  message: string;
  /** Always shown: what to do *in this panel*, whatever the endpoint said. */
  steps: string[];
  canRetry: boolean;
  needsAnalysis: boolean;
}

/**
 * Per-mode naming and guidance.
 *
 * Each `title` states the fault rather than the symptom, because the heading is
 * the only part a user reliably reads before deciding what to do. Each `steps`
 * entry is something doable from here — the endpoint's own suggestion is often
 * written for the CLI (`--model`), so it is rendered separately rather than
 * standing in for panel-local guidance.
 */
const PRESENTATION: Record<AskFailureKind, KindPresentation> = {
  no_analysis: {
    title: "No analysis to answer from",
    message: "This panel answers only from the project's .sourcevision analysis, and there is none to read yet.",
    steps: ["Run the analysis below, then ask the question again."],
    canRetry: false,
    needsAnalysis: true,
  },
  no_prd: {
    title: "There is no PRD to refine",
    message: "Refine mode proposes changes to existing PRD items, and this project has none yet.",
    // Not `needsAnalysis`: running an analysis would not create PRD items
    // either. The fix is to build a PRD, which happens on the Rex surface.
    steps: [
      "Build a PRD first — capture an answer with Capture to PRD, or run a plan from the Rex views.",
      "Ask without refine mode to get an answer about the code alone.",
    ],
    canRetry: false,
    needsAnalysis: false,
  },
  auth: {
    title: "The provider rejected the credentials",
    message: "The configured LLM vendor refused the request before it produced an answer.",
    // Deliberately navigation, not credential advice: the fix wording is
    // canonical and arrives from the endpoint as `remediation`.
    steps: ["Open the LLM Provider view to see which vendor and model this project is configured for."],
    canRetry: false,
    needsAnalysis: false,
  },
  timeout: {
    title: "The model did not answer in time",
    message: "The request outlived this panel's time budget, so no answer arrived.",
    steps: [
      "Retry — a timeout is usually transient.",
      "If it keeps timing out, ask a narrower question, or raise sourcevision.ask.timeoutMs in .n-dx.json.",
    ],
    canRetry: true,
    needsAnalysis: false,
  },
  rate_limit: {
    title: "The provider is rate limiting this project",
    message: "The vendor refused the request because too many have been sent recently.",
    steps: ["Wait, then retry the same question."],
    canRetry: true,
    needsAnalysis: false,
  },
  network: {
    title: "Could not reach the n-dx server",
    message: "The request never completed, so it may not have reached a model at all.",
    steps: [
      "Check that the n-dx server is still running, then retry.",
    ],
    canRetry: true,
    needsAnalysis: false,
  },
  llm_error: {
    title: "The provider returned an error",
    message: "The vendor answered with an error instead of an answer.",
    // No retry: unlike a timeout or a 429 this is not known to be transient,
    // and an automatic retry would spend the same tokens on the same fault. The
    // prompt survives, so asking again stays one keypress away when the user
    // judges it worth it.
    steps: ["Rephrase the question and ask again, or check the LLM Provider view for the model in use."],
    canRetry: false,
    needsAnalysis: false,
  },
  invalid_request: {
    title: "That question could not be sent",
    message: "The question was rejected before it reached a model.",
    steps: ["Edit the question above and submit it again."],
    canRetry: false,
    needsAnalysis: false,
  },
};

/**
 * Infer a mode from an HTTP status.
 *
 * Needed when the body is not the endpoint's documented shape — a proxy's HTML
 * 502, a dev server's own 404. Mirrors `KIND_TO_STATUS` in the route, so a
 * response that our own server did send is recovered exactly; anything else at
 * least lands on the closest true statement rather than on a bare status code.
 *
 * The one place the mirror cannot be injective is 404, which the route uses for
 * both `no_analysis` and `no_prd`. That costs nothing in practice: a 404 our
 * own server sent carries its `kind` in the body and never reaches this
 * function, and a 404 from anything else is far likelier to mean the endpoint
 * is missing than that the PRD is empty.
 */
export function askFailureKindFromStatus(status: number): AskFailureKind {
  switch (status) {
    case 400:
      return "invalid_request";
    case 401:
    case 403:
      return "auth";
    case 404:
      return "no_analysis";
    case 408:
    case 504:
      return "timeout";
    case 429:
      return "rate_limit";
    default:
      return "llm_error";
  }
}

/** True when `value` is one of the kinds this module knows how to present. */
export function isAskFailureKind(value: unknown): value is AskFailureKind {
  return typeof value === "string" && (ASK_FAILURE_KINDS as readonly string[]).includes(value);
}

/** Render a vendor-supplied retry delay as a step the user can act on. */
function retryAfterStep(retryAfterMs: number): string {
  const seconds = Math.max(1, Math.round(retryAfterMs / 1_000));
  return seconds >= 120
    ? `The provider asked for a ${Math.round(seconds / 60)}-minute wait before the next request.`
    : `The provider asked for a ${seconds}-second wait before the next request.`;
}

/**
 * Turn a failure into everything the error card needs.
 *
 * The endpoint's message is preferred over the floor because it carries the
 * provider's own detail (a quota name, a model that does not exist); the floor
 * is what keeps a response the endpoint never wrote from rendering as a status
 * code. Both paths always yield a non-empty title, message, and step list —
 * that invariant is what "no bare generic error" means here, and it is asserted
 * over every kind rather than over the three that prompted the work.
 */
export function describeAskFailure(failure: AskFailure): AskFailurePresentation {
  const spec = PRESENTATION[failure.kind];
  const message = failure.message?.trim();

  const steps = [
    ...(failure.retryAfterMs != null && failure.retryAfterMs > 0
      ? [retryAfterStep(failure.retryAfterMs)]
      : []),
    ...spec.steps,
    ...failure.remediation.filter((step) => step.trim().length > 0),
  ];

  return {
    kind: failure.kind,
    title: spec.title,
    message: message && message.length > 0 ? message : spec.message,
    steps,
    canRetry: spec.canRetry,
    needsAnalysis: spec.needsAnalysis,
  };
}
