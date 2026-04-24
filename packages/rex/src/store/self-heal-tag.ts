/**
 * Self-heal tag helpers.
 *
 * `ndx self-heal` sets `NDX_SELF_HEAL=1` on its child processes so that any
 * PRD item created during the self-heal cycle — whether via `rex add`, via
 * `rex recommend --accept`, or via MCP `add_item` calls — is stamped with the
 * `self-heal` tag at creation time.
 *
 * The tag is only applied to *new* items. Existing items left untouched by a
 * self-heal run keep whatever tags they already had.
 *
 * @module store/self-heal-tag
 */

/** Tag applied to PRD items created during a self-heal run. */
export const SELF_HEAL_TAG = "self-heal";

/** Environment variable signalling that the current process is part of a self-heal run. */
export const SELF_HEAL_ENV_VAR = "NDX_SELF_HEAL";

/**
 * True when the current process is running inside `ndx self-heal`.
 *
 * The core CLI sets {@link SELF_HEAL_ENV_VAR} to `"1"` before spawning the
 * sub-commands (`rex recommend --accept`, `hench run`) that make up each
 * self-heal iteration. Because child processes inherit the parent's
 * environment, the flag propagates down through the claude / codex CLI into
 * the stdio rex MCP server that services `add_item` calls.
 */
export function isSelfHealRun(): boolean {
  const value = process.env[SELF_HEAL_ENV_VAR];
  return value === "1" || value === "true";
}

/**
 * Return a copy of `item` with {@link SELF_HEAL_TAG} appended to `tags`, if
 * the current process is a self-heal run and the tag is not already present.
 *
 * Returns the input unchanged otherwise, so callers can thread this helper
 * through both self-heal and non-self-heal code paths without branching.
 */
export function withSelfHealTag<T extends { tags?: string[] }>(item: T): T {
  if (!isSelfHealRun()) return item;
  const existing = item.tags ?? [];
  if (existing.includes(SELF_HEAL_TAG)) return item;
  return { ...item, tags: [...existing, SELF_HEAL_TAG] };
}
