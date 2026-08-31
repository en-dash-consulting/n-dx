/**
 * Escalation ladder for validated LLM calls.
 *
 * ## What it replaces
 *
 * The retry path resent a byte-identical prompt up to three times and told the
 * model nothing about why the previous answer was rejected. A model that
 * produced unparseable JSON once will usually produce it again given the exact
 * same input, so the retries were close to free failures — three calls billed
 * for one answer.
 *
 * ## The two independent wins
 *
 * **Error feedback** helps every class: attempt N+1 carries the validation
 * error verbatim, so the model is told what was wrong instead of guessing.
 * Together with the attempt number this also guarantees no two attempts send
 * an identical prompt, even when the same error repeats.
 *
 * **Model escalation** helps light-routed classes: the first attempt uses the
 * class's routed tier, and every retry runs on the standard tier. That is what
 * makes cheap-first routing safe — a light model that cannot satisfy the
 * contract hands off rather than failing the command. For a class already
 * routed standard, escalation is a no-op on the model and the feedback is
 * still the win.
 *
 * ## Which failures escalate
 *
 * Only validation failures — the answer arrived and was wrong. Transport,
 * auth, and rate-limit errors propagate immediately: retrying those on a
 * different model neither diagnoses nor fixes anything, and the caller has
 * better remediation to offer.
 *
 * Sourcevision's prompt-degradation ladder is deliberately untouched. It
 * shortens the prompt on the same model, which is the right response to a
 * context-overflow failure; this escalates the model on the same prompt, which
 * is the right response to a capability failure. The failure class decides
 * which ladder applies, and neither subsumes the other.
 *
 * @module rex/analyze/escalate
 */

import { spawnClaude } from "./llm-bridge.js";
import { MAX_RETRIES, emptyAnalyzeTokenUsage, accumulateTokenUsage } from "./analyze-shared.js";
import type { AnalyzeTokenUsage } from "../schema/index.js";

/** Per-class escalation tallies, for spotting a class routed too cheaply. */
const escalationStats = new Map<string, { calls: number; escalated: number }>();

/**
 * Escalation counts by task class since process start.
 *
 * The design's review trigger is a class escalating on more than a fifth of
 * its calls: that is a class whose light routing is not paying for itself, and
 * its default belongs on standard. Exposed rather than logged-and-forgotten so
 * a command can report it.
 */
export function getEscalationStats(): Array<{
  taskClass: string;
  calls: number;
  escalated: number;
  rate: number;
}> {
  return [...escalationStats.entries()].map(([taskClass, { calls, escalated }]) => ({
    taskClass,
    calls,
    escalated,
    rate: calls > 0 ? escalated / calls : 0,
  }));
}

/** Reset the tallies. Test seam; not used in production paths. */
export function resetEscalationStats(): void {
  escalationStats.clear();
}

function recordAttempt(taskClass: string, escalated: boolean): void {
  const entry = escalationStats.get(taskClass) ?? { calls: 0, escalated: 0 };
  entry.calls += 1;
  if (escalated) entry.escalated += 1;
  escalationStats.set(taskClass, entry);
}

/**
 * Append the validation failure to a prompt for the next attempt.
 *
 * The attempt number is included so consecutive attempts differ even when the
 * error text is identical — the property the old loop violated.
 */
export function buildValidationFeedback(
  prompt: string,
  error: string,
  attempt: number,
): string {
  return [
    prompt,
    "",
    "---",
    `ATTEMPT ${attempt}: your previous response was rejected.`,
    "",
    "Reason:",
    error,
    "",
    "Return a corrected response that fixes exactly this problem. Do not",
    "explain the correction or apologize — return only the response in the",
    "format originally requested.",
    "---",
  ].join("\n");
}

export interface EscalationOptions<T> {
  /** Prompt for the first attempt. */
  prompt: string;
  /** Task class routing the first attempt. */
  taskClass: string;
  /** Explicit model override; wins over routing on every attempt. */
  model?: string;
  /**
   * Parse and check the response. Throw to reject — the thrown message is
   * what the next attempt is told. Pure code: no LLM call, no I/O.
   */
  validate: (text: string) => T;
  /**
   * Total attempts, including the first. Defaults to the existing retry
   * budget so this changes how retries behave, not how many there are.
   */
  maxAttempts?: number;
  /**
   * Classify a thrown error as a validation failure (retry) rather than
   * transport (propagate). Defaults to treating everything from `validate`
   * as a validation failure, since `validate` is the only thing that throws
   * on a well-formed response.
   */
  isValidationError?: (err: Error) => boolean;
  /** Called once per escalation, for operator-visible reporting. */
  onEscalate?: (info: { taskClass: string; attempt: number; error: string }) => void;
}

export interface EscalationResult<T> {
  value: T;
  /** True when the accepted answer came from an escalated attempt. */
  escalated: boolean;
  /** Attempts made, including the accepted one. */
  attempts: number;
  tokenUsage: AnalyzeTokenUsage;
}

/**
 * Run a validated LLM call, escalating the model and feeding the validation
 * error back on each retry.
 *
 * @throws the last validation error when every attempt is rejected, or
 *         immediately for a non-validation failure.
 */
export async function withEscalation<T>(
  opts: EscalationOptions<T>,
): Promise<EscalationResult<T>> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? MAX_RETRIES + 1);
  const tokenUsage = emptyAnalyzeTokenUsage();
  let prompt = opts.prompt;
  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const escalated = attempt > 1;
    // Attempt 1 routes by class. Retries pass the bare "standard" weight,
    // which resolves the standard tier for the active vendor — the escalation
    // target — while still honoring an explicit model override.
    const route = escalated ? ("standard" as const) : { taskClass: opts.taskClass };

    let text: string;
    try {
      const result = await spawnClaude(prompt, opts.model, undefined, route);
      accumulateTokenUsage(tokenUsage, result.tokenUsage);
      text = result.text;
    } catch (err) {
      // Transport, auth, rate limit: escalating neither diagnoses nor fixes
      // it, and the caller has better remediation to offer.
      throw err;
    }

    try {
      const value = opts.validate(text);
      recordAttempt(opts.taskClass, escalated);
      return { value, escalated, attempts: attempt, tokenUsage };
    } catch (err) {
      const error = err as Error;
      if (opts.isValidationError && !opts.isValidationError(error)) throw error;
      lastError = error;

      if (attempt < maxAttempts) {
        prompt = buildValidationFeedback(opts.prompt, error.message, attempt + 1);
        opts.onEscalate?.({
          taskClass: opts.taskClass,
          attempt: attempt + 1,
          error: error.message,
        });
      }
    }
  }

  recordAttempt(opts.taskClass, true);
  throw lastError ?? new Error(`${opts.taskClass}: no response accepted`);
}
