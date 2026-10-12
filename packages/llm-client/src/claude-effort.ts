/**
 * Effort for Claude calls — `output_config.effort` on the Messages API, and
 * `--effort` on Claude Code CLI runs.
 *
 * The one place that decides what effort a Claude call sends, so the four
 * paths that send one (the llm-client API provider, hench's API agent loop,
 * the llm-client CLI provider and hench's CLI agent loop) cannot drift apart.
 *
 * Rules, in order:
 * 1. A configured `llm.effort` value that is not a known level is dropped
 *    with a warning, and the call behaves as if no rule matched.
 * 2. A configured value on a model that does not accept effort (Haiku 4.5,
 *    Sonnet 4.5 and older answer 400) is dropped with a warning.
 * 3. With no usable configured value, a model listed in
 *    {@link CLAUDE_DEFAULT_EFFORT} gets that default; any other model gets
 *    nothing, which is the API's own default.
 *
 * The CLI path shares rules 1 and 2 and stops before rule 3 — see
 * {@link resolveClaudeCliEffort}.
 */

import { warn } from "./output.js";

/** Effort levels the Messages API accepts. */
export const CLAUDE_EFFORT_LEVELS = ["low", "medium", "high", "xhigh", "max"] as const;

export type ClaudeEffort = (typeof CLAUDE_EFFORT_LEVELS)[number];

/**
 * Claude models that accept `output_config.effort`. Explicit rather than
 * pattern-matched: an id missing here loses effort (with a warning), while a
 * wrong pattern would send it to a model that rejects the whole request.
 * Dated `-YYYYMMDD` snapshots of these ids match too.
 */
export const EFFORT_CAPABLE_CLAUDE_MODELS: readonly string[] = [
  "claude-fable-5-1",
  "claude-fable-5",
  "claude-opus-5-5",
  "claude-opus-5",
  "claude-opus-4-8",
  "claude-opus-4-7",
  "claude-opus-4-6",
  "claude-sonnet-5-5",
  "claude-sonnet-5",
  "claude-sonnet-4-6",
];

/**
 * Effort sent when no `llm.effort` rule applies. Opus 5.5's API default is
 * `medium`, where Opus 5's was `high`; sending `high` keeps the heavy tier's
 * reasoning depth unchanged across the 5 → 5.5 move. Every key must be in
 * {@link EFFORT_CAPABLE_CLAUDE_MODELS}.
 */
export const CLAUDE_DEFAULT_EFFORT: Readonly<Record<string, ClaudeEffort>> = {
  "claude-opus-5-5": "high",
};

function undated(model: string): string {
  return model.replace(/-\d{8}$/, "");
}

export function isClaudeEffort(value: string): value is ClaudeEffort {
  return (CLAUDE_EFFORT_LEVELS as readonly string[]).includes(value);
}

/** Whether a Claude model id (or a dated snapshot of one) accepts effort. */
export function supportsClaudeEffort(model: string): boolean {
  return EFFORT_CAPABLE_CLAUDE_MODELS.includes(undated(model));
}

const warned = new Set<string>();

/** Warn once per distinct message, so a per-call check does not flood stderr. */
function warnOnce(message: string): void {
  if (warned.has(message)) return;
  warned.add(message);
  warn(message);
}

/** Forget which effort warnings were printed. For tests. */
export function resetClaudeEffortWarnings(): void {
  warned.clear();
}

/**
 * The effort a Claude Messages API request should send, or `undefined` to
 * send no `output_config` at all.
 *
 * @param model      Fully-resolved Claude model id the request goes to.
 * @param configured The `llm.effort` value matched for the task class
 *                   (`TaskModelResolution.effort`), if any.
 * @param taskClass  Named in warnings so the operator can find the rule.
 */
export function resolveClaudeApiEffort(
  model: string,
  configured: string | undefined,
  taskClass?: string,
): ClaudeEffort | undefined {
  const checked = checkConfiguredEffort(model, configured, taskClass);
  if (checked.value) return checked.value;
  // A model that rejects effort gets none, not the default: every key of
  // CLAUDE_DEFAULT_EFFORT is effort-capable today, so this is belt and braces,
  // but it keeps the rule true of the code rather than of a second list.
  if (checked.modelRejects) return undefined;
  return CLAUDE_DEFAULT_EFFORT[undated(model)];
}

/**
 * The effort a Claude Code CLI spawn should pass as `--effort`, or
 * `undefined` to pass no flag at all.
 *
 * Shares the validation of {@link resolveClaudeApiEffort} — an unknown level
 * or a model that does not accept effort is dropped with the same warning —
 * and deliberately stops there. {@link CLAUDE_DEFAULT_EFFORT} is *not*
 * applied: that default exists to hold the API's heavy tier at the depth it
 * had before Opus 5.5 lowered its own API default, and it is an answer to a
 * question about the API. Claude Code chooses its own default per model and
 * may change it; sending ours unasked would override that choice on every run
 * nobody configured, which is not what `llm.effort` was asked to do. With no
 * rule matched the flag is omitted and the CLI decides.
 *
 * @param model      Fully-resolved Claude model id the spawn runs.
 * @param configured The `llm.effort` value matched for the task class.
 * @param taskClass  Named in warnings so the operator can find the rule.
 */
export function resolveClaudeCliEffort(
  model: string,
  configured: string | undefined,
  taskClass?: string,
): ClaudeEffort | undefined {
  return checkConfiguredEffort(model, configured, taskClass).value;
}

/**
 * Rules 1 and 2, shared by both paths. Warns once per distinct message.
 *
 * `modelRejects` is kept separate from a plain undefined because the two
 * failures differ for the API path: an unusable *value* leaves the call to
 * fall back on the model's default, while an unusable *model* must send
 * nothing at all.
 */
function checkConfiguredEffort(
  model: string,
  configured: string | undefined,
  taskClass: string | undefined,
): { value?: ClaudeEffort; modelRejects: boolean } {
  if (configured === undefined) return { modelRejects: false };
  const where = taskClass ? `task class "${taskClass}"` : "this call";

  if (!isClaudeEffort(configured)) {
    warnOnce(
      `llm.effort value "${configured}" for ${where} is not one of ` +
        `${CLAUDE_EFFORT_LEVELS.join(", ")}; it was not sent.`,
    );
    return { modelRejects: false };
  }
  if (!supportsClaudeEffort(model)) {
    warnOnce(
      `llm.effort "${configured}" for ${where} was not sent: ${model} ` +
        `does not accept an effort setting.`,
    );
    return { modelRejects: true };
  }
  return { value: configured, modelRejects: false };
}
