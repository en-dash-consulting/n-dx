/**
 * Spin detection for agent loops.
 *
 * Detects when an agent is producing text-only responses without making
 * any tool calls — burning tokens while making no progress. This typically
 * happens when the model hits max_tokens repeatedly and keeps generating
 * text without ever dispatching a tool.
 *
 * Pure functions, no side effects — mirrors the stuck.ts pattern.
 *
 * @module agent/analysis/spin
 */

/** Consecutive empty turns (no tool calls) before the agent is aborted. */
export const DEFAULT_SPIN_THRESHOLD = 5;

/**
 * Update the consecutive empty-turn counter.
 *
 * Resets to 0 when the turn included tool calls; increments otherwise.
 */
export function updateEmptyTurnCount(
  current: number,
  hadToolCalls: boolean,
): number {
  return hadToolCalls ? 0 : current + 1;
}

/**
 * Check whether a completed run looks like a spin (many turns, zero tool calls).
 *
 * Used by the CLI loop for post-run spin detection, since the CLI provider
 * doesn't have per-turn visibility during execution.
 */
export function isSpinningRun(
  turns: number,
  toolCallCount: number,
  threshold: number = DEFAULT_SPIN_THRESHOLD,
): boolean {
  return turns >= threshold && toolCallCount === 0;
}
