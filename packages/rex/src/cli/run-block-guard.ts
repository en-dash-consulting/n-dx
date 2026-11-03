/**
 * Who may save a `run` block.
 *
 * A saved `run` block decides how the next `ndx work` on an item executes —
 * its provider, gates and budgets. `ndx work` marks the agent session it
 * spawns with `NDX_AGENT_RUN`, and the rex MCP server that session talks to
 * inherits the variable, so an `add_item` or `edit_item` carrying `run` from
 * inside a run is the agent writing its own next run's settings. The block is
 * refused there; an operator saves it from their own shell or the dashboard.
 *
 * `null` on `edit_item` removes the block, which never widens anything, so it
 * is not a refusal.
 */

/** The variable `ndx work` sets on the agent session it spawns. */
export const AGENT_RUN_ENV = "NDX_AGENT_RUN";

/**
 * The refusal for a `run` argument, or undefined when the write may go ahead:
 * no block, a removal, or no agent session.
 */
export function runBlockRefusalInsideAgentRun(
  run: unknown,
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (run === undefined || run === null) return undefined;
  if (!env[AGENT_RUN_ENV]) return undefined;
  return (
    `Run settings cannot be saved from inside an agent run (${AGENT_RUN_ENV} is set). ` +
    "An operator saves them with 'rex update --run' or from the dashboard."
  );
}
