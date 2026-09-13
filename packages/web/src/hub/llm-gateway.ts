/**
 * Gateway module: ALL hub imports from @n-dx/llm-client flow through here.
 *
 * The hub zone (`src/hub/`) is import-restricted by design: node built-ins,
 * hub siblings, `src/shared/` (through the barrel), and the llm-client exec
 * helpers via this file — nothing else. Web→llm-client is ungated at the
 * monorepo level (foundation tier), so this gateway exists for the hub's own
 * auditability, not for domain-isolation: the hub is a daemon that manages
 * child processes, and every process-spawning primitive it uses must be
 * visible in one place. Enforced by boundary-check.test.ts ("hub zone
 * containment").
 *
 * Re-export only — no logic.
 */

export { spawnManaged, killWithFallback } from "@n-dx/llm-client";
export type { ManagedChild, SpawnToolResult } from "@n-dx/llm-client";
